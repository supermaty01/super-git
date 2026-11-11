import { useEffect, useRef, useState } from 'react'
import type { RepoView } from '../store'
import { useStore, setState, getState } from '../store'
import * as A from '../actions'
import { api } from '../lib/api'
import { Icon } from './Icon'
import { Dropdown } from './Dropdown'
import * as A2 from '../actions2'
import type { PullMode } from '@shared/types'

const PULL_LABELS: Record<PullMode, string> = {
  fetch: 'Fetch All',
  ff: 'Pull (fast-forward if possible)',
  'ff-only': 'Pull (fast-forward only)',
  rebase: 'Pull (rebase)'
}

const LFS_ITEMS: Array<[string, 'fetch' | 'checkout' | 'pull' | 'push' | 'prune']> = [
  ['Fetch all LFS files', 'fetch'], ['Checkout all LFS files', 'checkout'], ['Pull all LFS files', 'pull'],
  ['Push all LFS files', 'push'], ['Prune local LFS repository', 'prune']
]

function TB({ title, icon, onClick, disabled, badge, busy, active, tip }: { title: string; icon: string; onClick?: () => void; disabled?: boolean; badge?: number; busy?: boolean; active?: boolean; tip?: string }) {
  return (
    <button className={`toolbar-btn${disabled ? ' disabled' : ''}${active ? ' active' : ''}`} disabled={disabled} onClick={onClick} title={tip}>
      <span className="toolbar-title">{title}</span>
      <span className="toolbar-icon">
        <Icon name={busy ? 'spinner' : icon} spin={busy} />
        {badge ? <span className="toolbar-badge">{badge}</span> : null}
      </span>
    </button>
  )
}

export function Toolbar({ repo }: { repo: RepoView }) {
  const s = repo.snapshot
  const path = repo.path
  const pullMode = useStore((st) => st.settings?.defaultPullMode ?? 'ff')
  const recent = useStore((st) => st.settings?.recent ?? [])
  const showLabels = useStore((st) => st.settings?.showToolbarLabels ?? true)
  const [repoOpen, setRepoOpen] = useState(false)
  const [lfsOpen, setLfsOpen] = useState(false)
  const [lfs, setLfs] = useState(false)
  useEffect(() => { let on = true; void api.lfsInfo(path).then((i) => { if (on) setLfs(i.installed && i.patterns.length > 0) }).catch(() => {}); return () => { on = false } }, [path])
  const [branchOpen, setBranchOpen] = useState(false)
  const repoBtn = useRef<HTMLButtonElement>(null)
  const branchBtn = useRef<HTMLButtonElement>(null)

  const head = s?.head
  const cur = s?.refs.find((r) => r.type === 'head' && r.isCurrent)
  const dirty = !!s && s.status.staged.length + s.status.unstaged.length > 0
  const branchLabel = head ? head.branch ?? `${head.sha.slice(0, 7)} (detached)` : ''
  const busy = repo.busy
  // like the original, the main actions wait while another operation runs
  const locked = !!busy

  const pullMenu = () => {
    const items = (Object.keys(PULL_LABELS) as PullMode[]).map((m) => ({
      label: PULL_LABELS[m],
      checked: m === pullMode,
      act: () => {
        void api.setSettings({ defaultPullMode: m }).then((settings) => setState({ settings }))
        void A.pull(path, m)
      }
    }))
    void A.popup(items)
  }

  return (
    <div className={`toolbar${showLabels ? '' : ' no-labels'}`}>
      <div className="toolbar-left">
        <div className="bread-crumb">
          <button ref={repoBtn} className="crumb" onClick={() => setRepoOpen((v) => !v)}>
            <span className="crumb-help">repository</span>
            <span className="crumb-text repo">{s?.name ?? '…'} <Icon name="caret-down" className="crumb-caret" /></span>
          </button>
          <Icon name="chevron-right" className="crumb-sep" />
          <button ref={branchBtn} className="crumb" onClick={() => setBranchOpen((v) => !v)}>
            <span className="crumb-help">branch</span>
            <span className="crumb-text">{branchLabel} <Icon name="caret-down" className="crumb-caret" /></span>
          </button>
        </div>
        {repoOpen ? (
          <Dropdown
            anchor={repoBtn.current}
            onClose={() => setRepoOpen(false)}
            header="Recently opened"
            items={recent.map((r) => ({ key: r.path, label: r.name, hint: r.path }))}
            footer={{ label: 'View all repositories', run: () => A.activateTab('__repo_management__') }}
            onPick={(k) => A.openRepo(k)}
          />
        ) : null}
        {branchOpen && s ? (
          <Dropdown
            anchor={branchBtn.current}
            onClose={() => setBranchOpen(false)}
            header="Local branches"
            items={s.refs.filter((r) => r.type === 'head').map((r) => ({ key: r.short, label: r.short, current: r.isCurrent }))}
            onPick={(k) => { const r = s.refs.find((x) => x.type === 'head' && x.short === k); if (r) void A.checkoutRef(path, r) }}
          />
        ) : null}
      </div>

      <div className="btn-toolbar">
        <TB title="Undo" tip={repo.undo.undo ? `Undo ${repo.undo.undo}` : 'Undo'} icon="undo" disabled={locked || !repo.undo.undo} onClick={() => A.undo(path)} />
        <TB title="Redo" tip={repo.undo.redo ? `Redo ${repo.undo.redo}` : 'Redo'} icon="redo" disabled={locked || !repo.undo.redo} onClick={() => A.redo(path)} />
        <div className="toolbar-split">
          <TB title={pullMode === 'fetch' ? 'Fetch' : 'Pull'} tip={PULL_LABELS[pullMode]} icon="pull" badge={cur?.behind || undefined} busy={busy === 'Pulling' || busy === 'Fetching'} disabled={locked || !s?.remotes.length} onClick={() => A.pull(path)} />
          <button className="toolbar-caret" disabled={locked || !s?.remotes.length} onClick={pullMenu}><Icon name="caret-down" /></button>
        </div>
        <TB title="Push" tip={cur?.upstream ? `Push to ${cur.upstream.replace(/^refs\/remotes\//, '')}` : 'Push'} icon="push" badge={cur?.ahead || undefined} busy={busy === 'Pushing'} disabled={locked || !s?.remotes.length || !head?.branch} onClick={() => A.push(path)} />
        <TB title="Branch" tip="Branch" icon="code-branch" disabled={locked || !head?.sha} onClick={() => A.startCreateRef(path, 'branch')} />
        <TB title="Stash" tip="Stash" icon="stash" busy={busy === 'Stashing'} disabled={locked || !dirty} onClick={() => A.stashSave(path)} />
        <TB title="Pop" tip="Pop Stash" icon="pop" busy={busy === 'Popping stash'} disabled={locked || !s?.stashes.length} onClick={() => A.stashPop(path, 0)} />
        <span className="toolbar-gap" />
        <TB title="Terminal" tip="Show/Hide Terminal" icon="terminal" active={repo.terminal} onClick={() => A2.toggleTerminal(path)} />
        {lfs ? (
          <div className="toolbar-lfs" style={{ position: 'relative', display: 'flex' }}>
            <button className={`toolbar-btn lfs-btn${lfsOpen ? ' active' : ''}`} onClick={() => setLfsOpen((v) => !v)}>LFS <Icon name="caret-down" /></button>
            {lfsOpen ? (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 499 }} onClick={() => setLfsOpen(false)} />
                <ul className="lfs-dropdown">
                  {LFS_ITEMS.map(([label, cmd]) => (
                    <li key={cmd} onClick={() => { setLfsOpen(false); void A.run(path, () => api.lfsCommand(path, cmd), { busy: 'LFS', success: label.replace(/ all LFS files| local LFS repository/, ' complete') , errorTitle: `${label} failed` }) }}>{label}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="toolbar-right">
        <TB title="Actions" icon="actions" onClick={() => setState({ palette: true })} />
        <TB title="Search" icon="search" onClick={() => {
          const v = getState().repos[path]
          setState((st) => ({ repos: { ...st.repos, [path]: { ...v, search: { ...v.search, open: true } } } }))
          setTimeout(() => document.querySelector<HTMLInputElement>('.graph-search input')?.focus(), 30)
        }} />
      </div>
    </div>
  )
}
