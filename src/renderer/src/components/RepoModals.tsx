// The original's "Clone a Repository" and "Initialize a Repository" dialogs: 1000px wide, a 250px tab column on the left.
import { useState, type ReactNode } from 'react'
import { useStore, closeModal, setState, toast } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { errMsg } from '../lib/format'
import { Icon } from './Icon'
import { GITIGNORE_TEMPLATES, LICENSES, licenseText } from '../lib/templates'
import type { ProviderId } from '@shared/types'
import { sinceDateError } from '@shared/clone'
import { ProviderRepos } from './Integrations'
import { Checkbox } from './Checkbox'

/** the original's service tabs, in its order and wording */
const CLONE_SERVICES: Array<{ id: ProviderId; name: string; icon: string }> = [
  { id: 'github', name: 'GitHub.com', icon: 'github' },
  { id: 'github-enterprise', name: 'GitHub Enterprise Server', icon: 'github' },
  { id: 'gitlab', name: 'GitLab.com', icon: 'gitlab' },
  { id: 'gitlab-self', name: 'GitLab (Self-Managed)', icon: 'gitlab' },
  { id: 'bitbucket', name: 'Bitbucket.org', icon: 'bitbucket' },
  { id: 'bitbucket-server', name: 'Bitbucket Data Center', icon: 'bitbucket' },
  { id: 'azure', name: 'Azure DevOps', icon: 'ado' }
]

const DEFAULT_SHALLOW_DEPTH = 50

function repoNameFromUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  const last = clean.split(/[/:]/).pop() ?? ''
  try { return decodeURIComponent(last) } catch { return last }
}

const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '').replace(/\//g, '\\')}\\${name}`

function RepoModalFrame({ title, nav, children, onClose }: { title: string; nav: ReactNode; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal repo-modal">
      <div className="repo-modal-header">
        <span>{title}</span>
        <span className="repo-modal-close" onClick={onClose ?? closeModal}><Icon name="times" /></span>
      </div>
      <div className="repo-modal-layout">
        <div className="repo-modal-nav">{nav}</div>
        <div className="repo-modal-content">{children}</div>
      </div>
    </div>
  )
}

function NavItem({ active, icon, label, onClick, extra }: { active: boolean; icon: string; label: string; onClick: () => void; extra?: ReactNode }) {
  return <div className={`repo-modal-nav-item${active ? ' active' : ''}`} onClick={onClick}><Icon name={icon} className="repo-modal-nav-icon" />{label}{extra}</div>
}

function Row({ label, children, after, top }: { label: ReactNode; children: ReactNode; after?: ReactNode; top?: boolean }) {
  return (
    <div className={`rmodal-row${top ? ' top' : ''}`}>
      <label className="rmodal-label">{label}</label>
      <div className={`rmodal-control${after ? '' : ' wide'}`}>{children}</div>
      {after}
    </div>
  )
}

/** a row of the shallow-clone / sparse-checkout sub-forms: label, control, help line under it */
function SubRow({ label, children, help, error }: { label: string; children: ReactNode; help?: ReactNode; error?: string }) {
  return (
    <div className="rmodal-subrow">
      <label className="rmodal-sublabel">{label}</label>
      <div className="rmodal-subcontrol">
        {children}
        {error ? <div className="rmodal-error">{error}</div> : null}
        {help ? <div className="rmodal-help">{help}</div> : null}
      </div>
    </div>
  )
}

const Mono = ({ children }: { children: ReactNode }) => <span className="rmodal-mono">{children}</span>

/** `url`: prefilled, e.g. from a supergit:// link to a repository that is not on this computer */
export function CloneModal({ url: initialUrl }: { url?: string } = {}) {
  const settings = useStore((s) => s.settings!)
  const integrations = settings.integrations
  const [tab, setTab] = useState<'url' | ProviderId>('url')
  const [dir, setDir] = useState(settings.defaultCloneDir)
  const [url, setUrl] = useState(initialUrl ?? '')
  const [shallow, setShallow] = useState(false)
  const [by, setBy] = useState<'depth' | 'since'>('depth')
  const [depth, setDepth] = useState('')
  const [since, setSince] = useState('')
  const [branch, setBranch] = useState('')
  const [flags, setFlags] = useState('')
  const [sparse, setSparse] = useState(false)
  const [paths, setPaths] = useState('')
  const [blobless, setBlobless] = useState(false)
  const [busy, setBusy] = useState(false)
  const progressText = useStore((s) => s.progress?.text)
  const progress = busy ? progressText ?? 'Starting…' : ''
  const name = repoNameFromUrl(url)
  const sinceError = shallow && by === 'since' ? sinceDateError(since) : ''

  const clone = async (u = url, n = name) => {
    if (!u.trim() || !n || sinceError) return
    const dest = joinPath(dir, n)
    setBusy(true)
    try {
      await api.cloneRepo(u.trim(), dest, {
        // like the original, submodules are cloned along with the repository
        recurse: true,
        ...(shallow && tab === 'url' ? { shallow: true, depth: by === 'depth' ? Number(depth) || DEFAULT_SHALLOW_DEPTH : undefined, since: by === 'since' ? since : undefined, branch, flags } : {}),
        ...(sparse && tab === 'url' ? { sparse: paths.split('\n').map((p) => p.trim()).filter(Boolean), blobless } : {})
      })
      void api.setSettings({ defaultCloneDir: dir })
      setState((s) => ({ settings: { ...s.settings!, defaultCloneDir: dir }, progress: null }))
      closeModal()
      toast({ kind: 'success', title: `Successfully cloned repo '${n}'` })
      await A.openRepo(dest)
    } catch (e) {
      const msg = errMsg(e)
      if (msg.startsWith('SUBMODULES:')) {
        // the repository itself is there: open it and say which part failed
        void api.setSettings({ defaultCloneDir: dir })
        closeModal()
        toast({ kind: 'info', title: `Cloned '${n}', but some submodules could not be fetched`, message: msg.slice('SUBMODULES:'.length).trim().slice(0, 300) }, 10000)
        await A.openRepo(dest)
      } else toast({ kind: 'error', title: 'Clone Failed', message: msg.split('\n').slice(0, 4).join('\n').slice(0, 400) })
    } finally {
      setBusy(false)
      setState({ progress: null })
    }
  }

  const dirRow = (
    <Row label="Where to clone to" after={<button className="btn btn-primary rmodal-browse" onClick={async () => { const d = await api.pickDirectory('Where to clone to', dir); if (d) setDir(d) }}>Browse</button>}>
      <input className="rmodal-input" value={dir} onChange={(e) => setDir(e.target.value)} />
    </Row>
  )

  return (
    <RepoModalFrame
      title="Clone a Repository"
      onClose={() => !busy && closeModal()}
      nav={<>
        <NavItem active={tab === 'url'} icon="globe" label="Clone with URL" onClick={() => setTab('url')} />
        {CLONE_SERVICES.map((p) => (
          <NavItem key={p.id} active={tab === p.id} icon={p.icon} label={p.name} onClick={() => setTab(p.id)} extra={integrations[p.id] ? <span className="integrations-dot" /> : null} />
        ))}
      </>}
    >
      {tab === 'url' ? (
        <>
          <div className="rmodal-title">Clone a Repo</div>
          {dirRow}
          <Row label="URL">
            <input className="rmodal-input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void clone() }} />
          </Row>
          {name ? <Row label="Full path"><span className="rmodal-fullpath">{joinPath(dir, name)}</span></Row> : null}
          <Row label="Shallow Clone"><Checkbox checked={shallow} onChange={setShallow} /></Row>
          {shallow ? (
            <div className="rmodal-subform">
              <SubRow label="Branch to clone" help={<>The default branch is usually <Mono>main</Mono> or <Mono>master</Mono>, but you can specify a different one.</>}>
                <input className="rmodal-input" placeholder="default branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
              </SubRow>
              <SubRow label="Limit history by">
                <div className="rmodal-radios">
                  <label><input type="radio" name="clone-limit" checked={by === 'depth'} onChange={() => setBy('depth')} /> Commit depth</label>
                  <label><input type="radio" name="clone-limit" checked={by === 'since'} onChange={() => setBy('since')} /> Since date</label>
                </div>
              </SubRow>
              {by === 'depth' ? (
                <SubRow label="Depth" help="How many commits to clone from the target branch.">
                  <input className="rmodal-input" type="number" min={1} placeholder={String(DEFAULT_SHALLOW_DEPTH)} value={depth} onChange={(e) => setDepth(e.target.value)} />
                </SubRow>
              ) : (
                <SubRow label="Since date" help="Commits older than this date will not be cloned." error={since ? sinceError : ''}>
                  <input className="rmodal-input" placeholder="YYYY-MM-DD" value={since} onChange={(e) => setSince(e.target.value)} />
                </SubRow>
              )}
              <SubRow label="Custom flags" help={<>Here you can pass any additional flags you may need to <Mono>git clone</Mono>. Enter them exactly as you would on the command line.</>}>
                <input className="rmodal-input" value={flags} onChange={(e) => setFlags(e.target.value)} />
              </SubRow>
            </div>
          ) : null}
          <Row label="Sparse Checkout"><Checkbox checked={sparse} onChange={setSparse} /></Row>
          {sparse ? (
            <div className="rmodal-subform">
              <SubRow label="Blobless clone" help="Fetches trees and commits without blobs initially, reducing clone size. Blobs are fetched on-demand when needed.">
                <Checkbox checked={blobless} onChange={setBlobless} />
              </SubRow>
              <SubRow label="Paths to include" help="Enter one path per line. Only these paths will be checked out in your working directory. If no paths are provided, only root files will be checked out.">
                <textarea className="rmodal-input rmodal-textarea" rows={6} placeholder={'e.g.\nsrc/\ndocs/\nREADME.md'} value={paths} onChange={(e) => setPaths(e.target.value)} />
              </SubRow>
            </div>
          ) : null}
          <div className="rmodal-actions">
            {busy ? <span className="clone-progress"><Icon name="spinner" spin /> {progress}</span> : null}
            <button className="btn btn-success rmodal-submit" disabled={busy || !name || !!sinceError} onClick={() => clone()}>Clone the repo!</button>
          </div>
        </>
      ) : (
        <div className="rmodal-provider">
          <ProviderRepos key={tab} provider={tab} dirRow={dirRow} busy={busy} progress={progress} onClone={(r) => clone(r.cloneUrl, r.name)} />
        </div>
      )}
    </RepoModalFrame>
  )
}

export function InitModal() {
  const settings = useStore((s) => s.settings!)
  const [dir, setDir] = useState(settings.defaultCloneDir)
  const [name, setName] = useState('')
  const [gitignore, setGitignore] = useState('None')
  const [license, setLicense] = useState('None')
  const [lfs, setLfs] = useState(false)
  const [branch, setBranch] = useState('')
  const full = joinPath(dir, name)
  const init = async () => {
    if (!name) return
    try {
      const there = await api.resolveRepo(full).catch(() => null)
      if (there && there.root.replace(/[\\/]+/g, '/').toLowerCase() === full.replace(/[\\/]+/g, '/').toLowerCase()) {
        toast({ kind: 'error', title: 'Init failed', message: `A repository already exists at ${full}` })
        return
      }
      const files: Record<string, string> = {}
      if (gitignore !== 'None') files['.gitignore'] = GITIGNORE_TEMPLATES[gitignore]
      if (license !== 'None') files['LICENSE'] = licenseText(license, (await api.gitConfigGet('user.name')) ?? '')
      await api.initRepo(full, { defaultBranch: branch.trim() || 'main', files, initialCommit: Object.keys(files).length > 0 })
      if (lfs) await api.lfsInstall(full)
      closeModal()
      await A.openRepo(full)
    } catch (e) { toast({ kind: 'error', title: 'Init failed', message: errMsg(e) }) }
  }
  return (
    <RepoModalFrame title="Initialize a Repository" nav={<NavItem active icon="laptop" label="Local Only" onClick={() => {}} />}>
      <div className="rmodal-title">Initialize a Repo</div>
      <Row label="Name">
        <input className="rmodal-input" autoFocus value={name} onChange={(e) => setName(e.target.value.replace(/[\\/:*?"<>|]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void init() }} />
      </Row>
      <Row label="Initialize in" after={<button className="btn btn-primary rmodal-browse" onClick={async () => { const d = await api.pickDirectory('Initialize in', dir); if (d) setDir(d) }}>Browse</button>}>
        <input className="rmodal-input" value={dir} onChange={(e) => setDir(e.target.value)} />
      </Row>
      <Row label="Full path"><span className="rmodal-fullpath">{full}</span></Row>
      <Row label="Default branch name">
        <input className="rmodal-input" placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value.replace(/\s/g, '-'))} />
      </Row>
      <Row label=".gitignore Template (optional)">
        <select className={`rmodal-input rmodal-select${gitignore === 'None' ? ' placeholder' : ''}`} value={gitignore} onChange={(e) => setGitignore(e.target.value)}>
          <option value="None">Select...</option>
          {Object.keys(GITIGNORE_TEMPLATES).filter((k) => k !== 'None').map((k) => <option key={k}>{k}</option>)}
        </select>
      </Row>
      <Row label="License (optional)">
        <select className={`rmodal-input rmodal-select${license === 'None' ? ' placeholder' : ''}`} value={license} onChange={(e) => setLicense(e.target.value)}>
          <option value="None">Select...</option>
          {LICENSES.filter((k) => k !== 'None').map((k) => <option key={k}>{k}</option>)}
        </select>
      </Row>
      <Row label="Initialize with LFS"><Checkbox checked={lfs} onChange={setLfs} /></Row>
      <div className="rmodal-actions">
        <button className="btn btn-success rmodal-submit" disabled={!name} onClick={init}>Create Repository</button>
      </div>
    </RepoModalFrame>
  )
}
