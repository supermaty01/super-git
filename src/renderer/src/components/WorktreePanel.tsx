import { useEffect, useMemo, useRef, useState } from 'react'
import type { RepoView } from '../store'
import { updateRepo, showPrompt } from '../store'
import * as A from '../actions'
import * as A2 from '../actions2'
import { api } from '../lib/api'
import { Icon } from './Icon'

const HEADS = 'refs/heads/'
const REMOTES = 'refs/remotes/'
const shortOf = (ref: string) => (ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref.startsWith(REMOTES) ? ref.slice(REMOTES.length) : ref)

/**
 * "Create Worktree" slide-out panel, like the original: reference to checkout (any branch, or a typed ref / sha),
 * the branch to create (suggested from the reference), the working directory (default <repo>.worktrees/<branch>).
 */
export function WorktreePanel({ repo, initialRef }: { repo: RepoView; initialRef: string }) {
  const s = repo.snapshot!
  const path = repo.path
  const remotes = useMemo(() => new Set(s.remotes.map((r) => r.name)), [s.remotes])
  const options = useMemo(() => s.refs.filter((r) => r.type === 'head' || r.type === 'remote').map((r) => r.name)
    .sort((a, b) => shortOf(a).localeCompare(shortOf(b), undefined, { sensitivity: 'base' })), [s.refs])
  const main = (s.worktrees.find((w) => w.isMain)?.path ?? path).replace(/[\\/]+$/, '')
  const [ref, setRef] = useState(initialRef)
  const [query, setQuery] = useState<string | null>(null)
  const [branch, setBranch] = useState('')
  const [dir, setDir] = useState('')
  const [error, setError] = useState<{ level: 'error' | 'warning'; message: string } | null>(null)
  const seq = useRef(0)

  const close = () => updateRepo(path, { slidey: null })
  // suggested branch: the branch itself, or the remote branch's name (prefixed with the remote when taken)
  const suggested = useMemo(() => {
    if (!options.includes(ref)) return ''
    const short = shortOf(ref)
    let name = short
    if (ref.startsWith(REMOTES)) { const remote = [...remotes].find((r) => short.startsWith(r + '/')); if (remote) name = short.slice(remote.length + 1) }
    if (ref === HEADS + name) return name
    if (options.includes(HEADS + name)) return `${short.split('/')[0]}-${name}`
    return name
  }, [ref, options, remotes])
  const effBranch = branch || suggested
  const createBranch = ref !== HEADS + effBranch
  const suggestedDir = effBranch ? `${main.replace(/\\/g, '/')}.worktrees/${effBranch}` : ''
  const effDir = dir || suggestedDir

  useEffect(() => {
    const n = ++seq.current
    const t = window.setTimeout(() => {
      void api.validateWorktree(path, { ref, branch: effBranch, createBranch, dir: effDir }).then((e) => { if (n === seq.current) setError(e) }).catch(() => {})
    }, 250)
    return () => window.clearTimeout(t)
  }, [path, ref, effBranch, createBranch, effDir])

  const disabled = error?.level === 'error' || !effBranch || !ref || !effDir
  const submit = async () => {
    if (disabled) return
    close()
    const done = await A.run(path, async () => {
      await api.addWorktree(path, effDir, createBranch ? { newBranch: effBranch, commit: ref } : { branch: effBranch })
      return true
    }, { busy: 'Creating worktree', errorTitle: 'Could not create worktree' })
    if (!done) return
    showPrompt({
      kind: 'confirm', message: `Do you want to open Worktree "${effBranch}" now?`,
      buttons: [
        { label: 'Open Now', style: 'success', run: () => A2.openInThisTab(path, effDir) },
        { label: 'Open in New Tab', style: 'success', run: () => A.openRepo(effDir) }
      ]
    })
  }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') close() }

  return (
    <div className="slidey-panel">
      <div className="slidey-header">
        <Icon name="tree-o" className="text-disabled mr2" />
        <span>Create Worktree</span>
        <span className="grow" />
        <button className="slidey-close" title="Close" onClick={close}><Icon name="times" /></button>
      </div>
      <div className="slidey-body">
        <div className="slidey-row">
          <label>Reference to checkout</label>
          <RefPicker value={ref} query={query} setQuery={setQuery} options={options} remotes={remotes}
            onChange={(v) => { setRef(v); setQuery(null) }} />
        </div>
        <div className="slidey-row">
          <label>Worktree branch to create</label>
          <input className="form-control slidey-input" value={branch} placeholder={suggested} onChange={(e) => setBranch(e.target.value)} onKeyDown={onKey} />
        </div>
        <div className="slidey-row">
          <label>Working directory</label>
          <div className="slidey-path">
            <input className="form-control slidey-input" value={dir} placeholder={suggestedDir} onChange={(e) => setDir(e.target.value)} onKeyDown={onKey} />
            <button className="btn btn-primary" onClick={async () => { const d = await api.pickDirectory('Working directory', effDir || main); if (d) setDir(d) }}>Browse</button>
          </div>
        </div>
        <div className={`slidey-msg${error ? (error.level === 'error' ? ' color-red' : ' color-orange') : ''}`}>{error?.message ?? ' '}</div>
        <button className={`btn btn-sm btn-${error?.level === 'error' ? 'danger' : error?.level === 'warning' ? 'warning' : 'success'} slidey-submit`} disabled={disabled} onClick={() => void submit()}>Create Worktree</button>
      </div>
    </div>
  )
}

function RefLabel({ value, remotes }: { value: string; remotes: Set<string> }) {
  if (value.startsWith(HEADS)) return <span className="ref-opt"><span className="ref-opt-icon"><Icon name="laptop-o" /></span>{value.slice(HEADS.length)}</span>
  if (value.startsWith(REMOTES)) {
    const short = value.slice(REMOTES.length)
    const remote = [...remotes].find((r) => short.startsWith(r + '/')) ?? short.split('/')[0]
    return <span className="ref-opt"><span className="ref-opt-icon"><Icon name="cloud-o" /></span><span className="text-accent">{remote}/</span>{short.slice(remote.length + 1)}</span>
  }
  return <span className="ref-opt">{value}</span>
}

/** searchable, creatable select (type any ref or sha) */
function RefPicker({ value, query, setQuery, options, remotes, onChange }: {
  value: string; query: string | null; setQuery: (q: string | null) => void; options: string[]; remotes: Set<string>; onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const q = (query ?? '').trim().toLowerCase()
  const list = options.filter((o) => !q || shortOf(o).toLowerCase().includes(q))
  const rows = q && !options.some((o) => shortOf(o).toLowerCase() === q) ? [...list, `create:${query!.trim()}`] : list
  useEffect(() => { inputRef.current?.focus() }, [])
  const pick = (v: string) => { onChange(v.startsWith('create:') ? v.slice(7) : v); setOpen(false); inputRef.current?.blur() }
  return (
    <div className={`ref-picker${open ? ' open' : ''}`} title={shortOf(value)}>
      <div className="ref-picker-control" onMouseDown={(e) => { if (e.target !== inputRef.current) { e.preventDefault(); inputRef.current?.focus() } setOpen((o) => !o) }}>
        {query === null && value ? <span className="ref-picker-value"><RefLabel value={value} remotes={remotes} /></span> : null}
        <input ref={inputRef} className="ref-picker-input" value={query ?? ''} onBlur={() => { setOpen(false); setQuery(null) }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setHi((h) => Math.min(rows.length - 1, h + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)) }
            else if (e.key === 'Enter' && open && rows[hi]) { e.preventDefault(); pick(rows[hi]) }
            else if (e.key === 'Backspace' && !query && value) onChange('')
          }} />
        {value ? <span className="ref-picker-clear" onMouseDown={(e) => { e.preventDefault(); onChange('') }}><Icon name="times" /></span> : null}
        <span className="ref-picker-sep" />
        <span className="ref-picker-arrow"><Icon name="chevron-down" /></span>
      </div>
      {open ? (
        <div className="ref-picker-menu">
          {rows.map((o, i) => (
            <div key={o} className={`ref-picker-option${i === hi ? ' focused' : ''}${o === value ? ' selected' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o) }}>
              {o.startsWith('create:') ? <span>Create "{o.slice(7)}"</span> : <RefLabel value={o} remotes={remotes} />}
            </div>
          ))}
          {!rows.length ? <div className="ref-picker-empty">No options</div> : null}
        </div>
      ) : null}
    </div>
  )
}
