import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore, closeModal, setState, toast } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { errMsg } from '../lib/format'
import { Icon } from './Icon'
import { PrefsModal, RepoPrefsModal, ShortcutsModal } from './PrefsModal'
import { GITIGNORE_TEMPLATES, LICENSES, licenseText } from '../lib/templates'
import type { Remote, PullMode, ProviderId } from '@shared/types'
import { PROVIDERS, ProviderRepos } from './Integrations'

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
    case 'clone': body = <CloneModal />; break
    case 'init': body = <InitModal />; break
    case 'prefs': body = <PrefsModal section={p.section as string | undefined} />; break
    case 'repoPrefs': body = <RepoPrefsModal path={p.path as string} section={p.section as string | undefined} />; break
    case 'shortcuts': body = <ShortcutsModal />; break
    case 'push': body = <PushModal path={p.path as string} branch={p.branch as string} />; break
    case 'remote': body = <RemoteModal path={p.path as string} remote={p.remote as Remote | undefined} />; break
    case 'worktree': body = <WorktreeModal path={p.path as string} branch={p.branch as string | undefined} commit={p.commit as string | undefined} dir={p.dir as string} />; break
  }
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal() }}>
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

function repoNameFromUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  const last = clean.split(/[/:]/).pop() ?? ''
  try { return decodeURIComponent(last) } catch { return last }
}

function useCloneProgress(active: boolean) {
  const progress = useStore((s) => s.progress)
  return active ? progress?.text ?? 'Starting…' : ''
}

function CloneModal() {
  const settings = useStore((s) => s.settings!)
  const integrations = settings.integrations
  const [tab, setTab] = useState<'url' | ProviderId>('url')
  const [dir, setDir] = useState(settings.defaultCloneDir)
  const [url, setUrl] = useState('')
  const [shallow, setShallow] = useState(false)
  const [branch, setBranch] = useState('')
  const [recurse, setRecurse] = useState(true)
  const [busy, setBusy] = useState(false)
  const progress = useCloneProgress(busy)
  const name = repoNameFromUrl(url)
  const full = name ? `${dir.replace(/[\\/]+$/, '')}\\${name}` : ''

  const clone = async (u = url, n = name) => {
    if (!u.trim() || !n) return
    const dest = `${dir.replace(/[\\/]+$/, '')}\\${n}`
    setBusy(true)
    try {
      await api.cloneRepo(u.trim(), dest, { shallow, branch: branch.trim() || undefined, recurse })
      void api.setSettings({ defaultCloneDir: dir })
      setState((s) => ({ settings: { ...s.settings!, defaultCloneDir: dir }, progress: null }))
      closeModal()
      toast({ kind: 'success', title: `Cloned ${n}` })
      await A.openRepo(dest)
    } catch (e) {
      toast({ kind: 'error', title: 'Clone failed', message: errMsg(e) })
    } finally {
      setBusy(false)
      setState({ progress: null })
    }
  }

  const dirRow = (
    <div className="form-grid-row">
      <span className="form-label">Where to clone to</span>
      <input className="form-control" value={dir} onChange={(e) => setDir(e.target.value)} />
      <button className="btn btn-primary btn-small" onClick={async () => { const d = await api.pickDirectory('Where to clone to', dir); if (d) setDir(d) }}>Browse</button>
    </div>
  )

  return (
    <div className="modal clone-modal">
      <div className="modal-header">
        <span>Clone a Repository</span>
        <span className="modal-close" onClick={() => !busy && closeModal()}><Icon name="times" /></span>
      </div>
      <div className="clone-layout">
        <div className="clone-nav">
          <div className={`clone-nav-item${tab === 'url' ? ' active' : ''}`} onClick={() => setTab('url')}><Icon name="link" /> Clone with URL</div>
          {PROVIDERS.map((p) => (
            <div key={p.id} className={`clone-nav-item${tab === p.id ? ' active' : ''}`} onClick={() => setTab(p.id)}>
              <Icon name={p.icon} /> {p.name}{integrations[p.id] ? <span className="integrations-dot" /> : null}
            </div>
          ))}
        </div>
        <div className="clone-content">
          {tab === 'url' ? (
            <>
              <div className="clone-title">Clone a Repo</div>
              {dirRow}
              <div className="form-grid-row">
                <span className="form-label">URL</span>
                <input className="form-control" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void clone() }} />
                <span />
              </div>
              <div className="form-grid-row">
                <span className="form-label">Branch</span>
                <input className="form-control" placeholder="(default branch)" value={branch} onChange={(e) => setBranch(e.target.value)} />
                <span />
              </div>
              <div className="form-grid-row">
                <span className="form-label">Shallow Clone</span>
                <input type="checkbox" checked={shallow} onChange={(e) => setShallow(e.target.checked)} />
                <span />
              </div>
              <div className="form-grid-row">
                <span className="form-label">Include submodules</span>
                <input type="checkbox" checked={recurse} onChange={(e) => setRecurse(e.target.checked)} />
                <span />
              </div>
              {full ? <div className="form-grid-row"><span className="form-label">Full path</span><span className="text-secondary">{full}</span><span /></div> : null}
              <div className="clone-actions">
                {busy ? <span className="clone-progress"><Icon name="spinner" spin /> {progress}</span> : null}
                <button className="btn btn-success btn-small" disabled={busy || !name} onClick={() => clone()}>Clone the repo!</button>
              </div>
            </>
          ) : (
            <ProviderRepos key={tab} provider={tab} dirRow={dirRow} busy={busy} progress={progress} onClone={(r) => clone(r.cloneUrl, r.name)} />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

function InitModal() {
  const settings = useStore((s) => s.settings!)
  const [dir, setDir] = useState(settings.defaultCloneDir)
  const [name, setName] = useState('')
  const [gitignore, setGitignore] = useState('None')
  const [license, setLicense] = useState('None')
  const [readme, setReadme] = useState(true)
  const [branch, setBranch] = useState('main')
  const full = name ? `${dir.replace(/[\\/]+$/, '')}\\${name}` : ''
  const init = async () => {
    if (!full) return
    try {
      const files: Record<string, string> = {}
      if (gitignore !== 'None') files['.gitignore'] = GITIGNORE_TEMPLATES[gitignore]
      if (license !== 'None') files['LICENSE'] = licenseText(license, (await api.gitConfigGet('user.name')) ?? '')
      if (readme) files['README.md'] = `# ${name}\n`
      await api.initRepo(full, { defaultBranch: branch.trim() || 'main', files, initialCommit: Object.keys(files).length > 0 })
      closeModal()
      await A.openRepo(full)
    } catch (e) { toast({ kind: 'error', title: 'Init failed', message: errMsg(e) }) }
  }
  return (
    <ModalFrame title="Initialize a Repository" width={620} footer={<button className="btn btn-success btn-medium" disabled={!name} onClick={init}>Create Repository</button>}>
      <div className="form-grid-row">
        <span className="form-label">Name</span>
        <input className="form-control" autoFocus value={name} onChange={(e) => setName(e.target.value.replace(/[\\/:*?"<>|]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void init() }} />
        <span />
      </div>
      <div className="form-grid-row">
        <span className="form-label">Initialize in</span>
        <input className="form-control" value={dir} onChange={(e) => setDir(e.target.value)} />
        <button className="btn btn-primary btn-small" onClick={async () => { const d = await api.pickDirectory('Initialize in', dir); if (d) setDir(d) }}>Browse</button>
      </div>
      <div className="form-grid-row">
        <span className="form-label">Default branch</span>
        <input className="form-control narrow" value={branch} onChange={(e) => setBranch(e.target.value.replace(/\s/g, '-'))} />
        <span />
      </div>
      <div className="form-grid-row">
        <span className="form-label">.gitignore template</span>
        <select className="form-control" value={gitignore} onChange={(e) => setGitignore(e.target.value)}>
          {Object.keys(GITIGNORE_TEMPLATES).map((k) => <option key={k}>{k}</option>)}
        </select>
        <span />
      </div>
      <div className="form-grid-row">
        <span className="form-label">License</span>
        <select className="form-control" value={license} onChange={(e) => setLicense(e.target.value)}>
          {LICENSES.map((k) => <option key={k}>{k}</option>)}
        </select>
        <span />
      </div>
      <div className="form-grid-row">
        <span className="form-label">README.md</span>
        <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} />
        <span />
      </div>
      {full ? <div className="form-grid-row"><span className="form-label">Full path</span><span className="text-secondary">{full}</span><span /></div> : null}
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

function WorktreeModal({ path, branch, commit, dir: initialDir }: { path: string; branch?: string; commit?: string; dir: string }) {
  const s = A.snap(path)
  const locals = s.refs.filter((r) => r.type === 'head' && !r.isCurrent && !s.worktrees.some((w) => w.branch === r.short))
  const [mode, setMode] = useState<'existing' | 'new' | 'detached'>(branch ? 'existing' : commit ? 'new' : 'existing')
  const [existing, setExisting] = useState(branch ?? locals[0]?.short ?? '')
  const [newName, setNewName] = useState('')
  const [dir, setDir] = useState(initialDir)
  const [openAfter, setOpenAfter] = useState(true)
  const submit = async () => {
    closeModal()
    const opts = mode === 'existing' ? { branch: existing } : mode === 'new' ? { newBranch: newName.trim(), commit: commit ?? s.head.sha } : { commit: commit ?? s.head.sha }
    const ok = await A.run(path, async () => { await api.addWorktree(path, dir, opts); return true }, { errorTitle: 'Could not create worktree' })
    if (ok && openAfter) await A.openRepo(dir)
  }
  return (
    <ModalFrame title="Create Worktree" width={620} footer={<><button className="btn btn-default btn-medium" onClick={closeModal}>Cancel</button><button className="btn btn-success btn-medium" disabled={(mode === 'existing' && !existing) || (mode === 'new' && !newName.trim())} onClick={submit}>Create Worktree</button></>}>
      <div className="form-grid-row"><span className="form-label">Folder</span>
        <input className="form-control" value={dir} onChange={(e) => setDir(e.target.value)} />
        <button className="btn btn-primary btn-small" onClick={async () => { const d = await api.pickDirectory('Worktree folder', dir); if (d) setDir(d) }}>Browse</button>
      </div>
      <div className="form-grid-row"><span className="form-label">Checkout</span>
        <select className="form-control" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="existing">Existing branch</option>
          <option value="new">New branch {commit ? `at ${commit.slice(0, 7)}` : 'at HEAD'}</option>
          <option value="detached">Detached {commit ? commit.slice(0, 7) : 'HEAD'}</option>
        </select><span />
      </div>
      {mode === 'existing' ? (
        <div className="form-grid-row"><span className="form-label">Branch</span>
          <select className="form-control" value={existing} onChange={(e) => setExisting(e.target.value)}>
            {branch && !locals.some((l) => l.short === branch) ? <option value={branch}>{branch}</option> : null}
            {locals.map((l) => <option key={l.short} value={l.short}>{l.short}</option>)}
          </select><span />
        </div>
      ) : mode === 'new' ? (
        <div className="form-grid-row"><span className="form-label">New branch name</span><input className="form-control" autoFocus value={newName} onChange={(e) => setNewName(e.target.value.replace(/\s/g, '-'))} /><span /></div>
      ) : null}
      <label className="form-check"><input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} /> Open the worktree in a new tab</label>
    </ModalFrame>
  )
}
