import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore, closeModal, setState, toast } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { errMsg } from '../lib/format'
import { Icon } from './Icon'
import { PrefsModal, RepoPrefsModal, ShortcutsModal } from './PrefsModal'
import { GITIGNORE_TEMPLATES, LICENSES, licenseText } from '../lib/templates'
import type { Remote, PullMode, ProviderId } from '@shared/types'
import { CloneModal, InitModal } from './RepoModals'
import { BranchCleanupModal } from './BranchCleanup'
import { HostKeyChangedModal, InvalidSslModal } from './K2Modals'

export function Modals() {
  const modal = useStore((s) => s.modal)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && modal) closeModal() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [modal])
  if (!modal) return null
  const p = modal.props ?? {}
  let body: ReactNode = null
  switch (modal.kind) {
    case 'prompt': body = <PromptModal {...(p as unknown as PromptProps)} />; break
    case 'clone': body = <CloneModal url={p.url as string | undefined} />; break
    case 'init': body = <InitModal />; break
    case 'prefs': body = <PrefsModal section={p.section as string | undefined} />; break
    case 'repoPrefs': body = <RepoPrefsModal path={p.path as string} section={p.section as string | undefined} />; break
    case 'shortcuts': body = <ShortcutsModal />; break
    case 'activity': body = <ActivityModal />; break
    case 'push': body = <PushModal path={p.path as string} branch={p.branch as string} />; break
    case 'remote': body = <RemoteModal path={p.path as string} remote={p.remote as Remote | undefined} />; break
    case 'branchCleanup': body = <BranchCleanupModal path={p.path as string} />; break
    case 'hostKeyChanged': body = <HostKeyChangedModal host={p.host as string} remote={p.remote as string | undefined} detail={p.detail as string} />; break
    case 'invalidSsl': body = <InvalidSslModal url={p.url as string} detail={p.detail as string} path={p.path as string | null} />; break
  }
  return (
    <div className={`modal-overlay${modal.kind === 'prefs' || modal.kind === 'repoPrefs' ? ' prefs-overlay' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget && modal.kind !== 'branchCleanup') closeModal() }}>
      {body}
    </div>
  )
}

function ModalFrame({ title, children, width, footer }: { title: string; children: ReactNode; width?: number; footer?: ReactNode }) {
  return (
    <div className="modal" style={{ width }}>
      <div className="modal-header">
        <span>{title}</span>
        <span className="modal-close" onClick={closeModal}><Icon name="times" /></span>
      </div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-footer">{footer}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

interface Field { name: string; label: string; value?: string; placeholder?: string; multiline?: boolean; options?: string[] }
interface PromptProps { title: string; okLabel?: string; fields: Field[]; onOk: (v: Record<string, string>) => unknown }

function PromptModal({ title, okLabel, fields, onOk }: PromptProps) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])))
  const submit = () => {
    if (!vals[fields[0].name]?.trim()) return
    closeModal()
    void onOk(vals)
  }
  return (
    <ModalFrame title={title} width={480} footer={<><button className="btn btn-default btn-medium" onClick={closeModal}>Cancel</button><button className="btn btn-success btn-medium" onClick={submit}>{okLabel ?? 'OK'}</button></>}>
      {fields.map((f, i) => (
        <label key={f.name} className="form-row">
          <span className="form-label">{f.label}</span>
          {f.multiline ? (
            <textarea className="form-control" rows={5} value={vals[f.name]} placeholder={f.placeholder} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) submit() }} />
          ) : (
            <>
              <input className="form-control" autoFocus={i === 0} list={f.options ? `opts-${f.name}` : undefined} value={vals[f.name]} placeholder={f.placeholder} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} onFocus={(e) => e.target.select()} />
              {f.options ? <datalist id={`opts-${f.name}`}>{f.options.map((o) => <option key={o} value={o} />)}</datalist> : null}
            </>
          )}
        </label>
      ))}
    </ModalFrame>
  )
}

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------

function PushModal({ path, branch }: { path: string; branch: string }) {
  const remotes = A.snap(path).remotes
  const [remote, setRemote] = useState(remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name ?? '')
  const [name, setName] = useState(branch)
  const submit = () => { closeModal(); void A.doPush(path, { remote, branch, remoteBranch: name.trim() || branch, setUpstream: true }) }
  return (
    <ModalFrame title={`Push ${branch}`} width={520} footer={<><button className="btn btn-default btn-medium" onClick={closeModal}>Cancel</button><button className="btn btn-success btn-medium" onClick={submit}>Submit</button></>}>
      <div className="text-secondary mb2">What remote/branch should "{branch}" push to and pull from?</div>
      <div className="push-row">
        <select className="form-control" value={remote} onChange={(e) => setRemote(e.target.value)}>
          {remotes.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
        </select>
        <span>/</span>
        <input className="form-control" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      </div>
    </ModalFrame>
  )
}

function RemoteModal({ path, remote }: { path: string; remote?: Remote }) {
  const [name, setName] = useState(remote?.name ?? '')
  const [fetchUrl, setFetchUrl] = useState(remote?.fetchUrl ?? '')
  const [pushUrl, setPushUrl] = useState(remote?.pushUrl ?? '')
  const submit = async () => {
    if (!name.trim() || !fetchUrl.trim()) return
    closeModal()
    if (remote) await A.run(path, () => api.editRemote(path, remote.name, name.trim(), fetchUrl.trim(), pushUrl.trim()))
    else {
      await A.run(path, () => api.addRemote(path, name.trim(), fetchUrl.trim()))
      await A.run(path, () => api.fetchRemote(path, name.trim()), { busy: 'Fetching' })
    }
  }
  return (
    <ModalFrame title={remote ? `Edit ${remote.name}` : 'Add Remote'} width={560} footer={<><button className="btn btn-default btn-medium" onClick={closeModal}>Cancel</button><button className="btn btn-success btn-medium" onClick={submit}>{remote ? 'Save Remote' : 'Add Remote'}</button></>}>
      <div className="form-grid-row"><span className="form-label">Name</span><input className="form-control" autoFocus value={name} onChange={(e) => setName(e.target.value)} /><span /></div>
      <div className="form-grid-row"><span className="form-label">Pull URL</span><input className="form-control" value={fetchUrl} onChange={(e) => { setFetchUrl(e.target.value); if (!name && !remote) setName('origin') }} /><span /></div>
      <div className="form-grid-row"><span className="form-label">Push URL</span><input className="form-control" placeholder="(same as pull URL)" value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} /><span /></div>
    </ModalFrame>
  )
}

/** the git commands SuperGit ran, newest first (failures always included) */
function ActivityModal() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.activityLog>> | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    const load = () => { void api.activityLog().then(setRows) }
    load()
    const t = window.setInterval(load, 2000)
    return () => window.clearInterval(t)
  }, [])
  const shown = (rows ?? []).filter((r) => !q.trim() || `${r.repo} ${r.args}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <ModalFrame title="Activity Logs" width={860}>
      <input className="form-control mb2" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="activity-list">
        {shown.map((r, i) => (
          <div key={i} className={`activity-row${r.code ? ' failed' : ''}`} title={r.error}>
            <span className="activity-time">{new Date(r.time).toLocaleTimeString()}</span>
            <span className="activity-repo truncate">{r.repo}</span>
            <span className="activity-cmd truncate">git {r.args}</span>
            <span className="activity-ms">{r.ms} ms</span>
            {r.code ? <span className="activity-error truncate">{r.error || `exit code ${r.code}`}</span> : null}
          </div>
        ))}
        {rows && !shown.length ? <div className="text-secondary">Nothing logged yet.</div> : null}
      </div>
    </ModalFrame>
  )
}
