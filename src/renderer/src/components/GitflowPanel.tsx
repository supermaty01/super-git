import { useState } from 'react'
import type { RepoView } from '../store'
import { updateRepo, toast, useStore } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { Icon } from './Icon'
import { Checkbox } from './Checkbox'
import { k2Of, saveK2 } from './ConflictDetection'
import type { K2Settings } from '@shared/k2'
import '../styles/k2.css'

export type GitflowType = 'feature' | 'release' | 'hotfix'
export type GitflowForm = { kind: 'gitflow'; mode: 'start' | 'finish'; type: GitflowType; name?: string }

const cap = (t: string) => t[0].toUpperCase() + t.slice(1)

/** the original's Gitflow slide-out forms: Start Feature / Release / Hotfix and Finish Feature / Release / Hotfix */
export function GitflowPanel({ repo, form }: { repo: RepoView; form: GitflowForm }) {
  const path = repo.path
  const s = repo.snapshot!
  const cfg = s.gitflow
  const k2 = useStore((st) => k2Of(st.settings))
  const gf = k2.gitflow ?? {}
  const setGf = (patch: NonNullable<K2Settings['gitflow']>) => saveK2((k) => ({ ...k, gitflow: { ...k.gitflow, ...patch } }), k2)
  const has = (b: string) => s.refs.some((r) => r.type === 'head' && r.short === b)
  const hasDevelop = has(cfg.develop)
  const hasMaster = has(cfg.master)
  const prefix = cfg[form.type]
  const branches = s.refs.filter((r) => r.type === 'head' && r.short.startsWith(prefix)).map((r) => r.short).sort()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState(form.name ? prefix + form.name : branches[0] ?? '')
  const [tagMessage, setTagMessage] = useState('')
  const close = () => updateRepo(path, { slidey: null })
  const T = cap(form.type)

  // ---- start
  if (form.mode === 'start') {
    const startKey = form.type === 'feature' ? 'featureStartAt' : 'releaseStartAt'
    const fromDevelop = form.type !== 'hotfix' && hasDevelop && (gf[startKey] ?? 'develop') === 'develop'
    const invalid = !name.trim() || /[\s~^:?*[\\]|\.\.|@\{|\/$|\.lock$/.test(name.trim())
    const error = form.type === 'hotfix' && !hasMaster ? `${cfg.master} branch is required to start hotfix` : null
    const submit = async () => {
      if (invalid || error) return
      const n = name.trim()
      close()
      const fromHead = form.type === 'hotfix' ? false : !fromDevelop
      await A.run(path, () => api.gitflowStart2(path, form.type, n, fromHead), { errorTitle: `Failed to start ${form.type} '${n}'`, success: `Started ${form.type}: '${n}'` })
    }
    return (
      <Frame close={close}>
        <h4 className="k2-gf-title">Start {T}</h4>
        <div className="k2-gf-prefixed">
          <span className="k2-gf-prefix">{prefix}</span>
          <input className="form-control slidey-input" autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') close() }} />
        </div>
        {form.type !== 'hotfix' ? (
          <div className="k2-gf-radios">
            <label className={`k2-gf-radio${hasDevelop ? '' : ' disabled'}`}><input type="radio" name="startAt" checked={fromDevelop} disabled={!hasDevelop} onChange={() => setGf({ [startKey]: 'develop' })} /> Latest {cfg.develop}</label>
            <label className="k2-gf-radio"><input type="radio" name="startAt" checked={!fromDevelop} onChange={() => setGf({ [startKey]: 'active' })} /> Current branch</label>
          </div>
        ) : null}
        <Submit label={`Start ${T}`} error={error} disabled={invalid} onSubmit={submit} onCancel={close} />
      </Frame>
    )
  }

  // ---- finish
  const delKey = form.type === 'feature' ? 'featureDelete' : form.type === 'release' ? 'releaseDelete' : 'hotfixDelete'
  const del = gf[delKey] ?? true
  const rebase = gf.featureRebase ?? false
  const short = picked.startsWith(prefix) ? picked.slice(prefix.length) : ''
  const missing = (n: string[]) => (n.length === 2 ? `${n[0]} and ${n[1]} branch required to finish ${form.type}` : `${n[0]} branch is required to finish ${form.type}`)
  const error = !short ? `No ${form.type} to finish`
    : form.type === 'feature' ? (hasDevelop ? null : missing([cfg.develop]))
      : !hasDevelop || !hasMaster ? missing([...(!hasDevelop ? [cfg.develop] : []), ...(!hasMaster ? [cfg.master] : [])]) : null
  const submit = async () => {
    if (error) return
    close()
    await A.runOp(path, () => api.gitflowFinish2(path, form.type, short, { deleteBranch: del, rebase: form.type === 'feature' && rebase, tagMessage: tagMessage.trim() || undefined }),
      `Finish ${form.type}`, 'Finishing', { title: `Finished ${form.type}: '${short}'` })
  }
  return (
    <Frame close={close}>
      {form.name ? <h4 className="k2-gf-title">Finish {prefix + form.name}</h4> : <>
        <h4 className="k2-gf-title">Finish {T}</h4>
        <select className="form-control slidey-input" value={picked} onChange={(e) => setPicked(e.target.value)}>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </>}
      {form.type !== 'feature' ? (
        <input className="form-control slidey-input k2-gf-tag" autoFocus placeholder="tag message" value={tagMessage} onChange={(e) => setTagMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') close() }} />
      ) : null}
      <div className="k2-gf-checks">
        {form.type === 'feature' ? <Checkbox checked={rebase} onChange={(v) => setGf({ featureRebase: v })}>Rebase on {cfg.develop}</Checkbox> : null}
        <Checkbox checked={del} onChange={(v) => setGf({ [delKey]: v })}>Delete branch</Checkbox>
      </div>
      <Submit label={`Finish ${T}`} error={error} onSubmit={submit} onCancel={close} />
    </Frame>
  )
}

function Frame({ close, children }: { close: () => void; children: React.ReactNode }) {
  return (
    <div className="slidey-panel k2-gf">
      <div className="slidey-header">
        <Icon name="merge" className="text-disabled mr2" />
        <span>Gitflow</span>
        <span className="grow" />
        <button className="slidey-close" title="Close" onClick={close}><Icon name="times" /></button>
      </div>
      <div className="slidey-body">{children}</div>
    </div>
  )
}

function Submit({ label, error, disabled, onSubmit, onCancel }: { label: string; error: string | null; disabled?: boolean; onSubmit: () => unknown; onCancel: () => void }) {
  return (
    <>
      {error ? <div className="slidey-msg color-red">{error}</div> : null}
      <div className="k2-gf-buttons">
        <button className="btn btn-sm btn-success slidey-submit" disabled={!!error || disabled} onClick={() => void onSubmit()}>{label}</button>
        <button className="btn btn-sm btn-default slidey-submit" onClick={onCancel}>Cancel</button>
      </div>
    </>
  )
}

/** used by the left panel, menus and palette */
export function openGitflowForm(path: string, mode: 'start' | 'finish', type: GitflowType, name?: string): void {
  if (!A.snap(path).gitflow.initialized) { toast({ kind: 'error', title: 'Gitflow is not initialized', message: 'Initialize it in Repo-Specific Preferences > Gitflow.' }); return }
  updateRepo(path, { slidey: { kind: 'gitflow', mode, type, name } })
}
