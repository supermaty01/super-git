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
  const branchLabel = head ? head.branch ?? 'HEAD' : ''
  const busy = repo.busy
  // like the original, the main actions wait while another operation runs (and while an interactive rebase is being planned)
  const locked = !!busy || repo.center.kind === 'rebase'

  const [pullOpen, setPullOpen] = useState(false)
  const pullRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pullOpen) return
    const h = (e: MouseEvent) => { if (!pullRef.current?.contains(e.target as Node)) setPullOpen(false) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [pullOpen])
  // like the original: a row runs that operation; the radio makes it the button's default
  const setDefaultPull = (m: PullMode) => { void api.setSettings({ defaultPullMode: m }).then((settings) => setState({ settings })) }

  return (
    <div className={`toolbar${showLabels ? '' : ' no-labels'}`}>
      <div className="toolbar-left">
        <div className="bread-crumb">
          <button ref={repoBtn} className="crumb" onClick={() => setRepoOpen((v) => !v)}>
            <span className="crumb-help">repository</span>
            <span className="crumb-text repo">{s?.name ?? '…'} <Icon name={repoOpen ? 'caret-up' : 'caret-down'} className="crumb-caret" /></span>
          </button>
          <Icon name="chevron-right" className="crumb-sep" />
          <button ref={branchBtn} className="crumb" onClick={() => setBranchOpen((v) => !v)}>
            <span className="crumb-help">branch</span>
            <span className="crumb-text">{branchLabel} <Icon name={branchOpen ? 'caret-up' : 'caret-down'} className="crumb-caret" /></span>
          </button>
        </div>
        {repoOpen ? (
          <Dropdown
            anchor={repoBtn.current}
            onClose={() => setRepoOpen(false)}
            header="Recently opened"
            items={recent.filter((r) => r.path.toLowerCase() !== path.toLowerCase()).map((r) => ({ key: r.path, label: r.name, hint: r.path }))}
            footer={{ label: 'View all repositories', run: () => A.activateTab('__repo_management__') }}
            onPick={(k) => A.openRepo(k)}
          />
        ) : null}
        {branchOpen && s ? (
          <Dropdown
            anchor={branchBtn.current}
            onClose={() => setBranchOpen(false)}
            items={s.refs.filter((r) => r.type === 'head').map((r) => ({ key: r.short, label: r.short, current: r.isCurrent, icon: 'code-branch' }))}
            onPick={(k) => { const r = s.refs.find((x) => x.type === 'head' && x.short === k); if (r) void A.checkoutRef(path, r) }}
          />
        ) : null}
      </div>

      <div className="btn-toolbar">
        <TB title="Undo" tip={repo.undo.undo.tip} icon="undo" disabled={locked || !repo.undo.undo.valid} onClick={() => A.undo(path)} />
        <TB title="Redo" tip={repo.undo.redo.tip} icon="redo" disabled={locked || !repo.undo.redo.valid} onClick={() => A.redo(path)} />
        <div className={`toolbar-split${pullOpen ? ' open' : ''}`} ref={pullRef} style={{ position: 'relative' }}>
          <TB title={pullMode === 'fetch' ? 'Fetch' : 'Pull'} tip={head?.detached && pullMode !== 'fetch' ? `${PULL_LABELS[pullMode]} is not available when in a detached HEAD state` : PULL_LABELS[pullMode]} icon="pull" busy={busy === 'Pulling' || busy === 'Fetching'} disabled={locked || !s?.remotes.length || (!!head?.detached && pullMode !== 'fetch')} onClick={() => A.pull(path)} />
          <button className="toolbar-caret" disabled={locked || !s?.remotes.length} onClick={() => setPullOpen((v) => !v)}><Icon name={pullOpen ? 'caret-up' : 'caret-down'} /></button>
          {pullOpen ? (
            <div className="toolbar-popover">
              <div className="toolbar-popover-header">Select a default pull/fetch operation to execute when clicking this button</div>
              {(Object.keys(PULL_LABELS) as PullMode[]).map((m) => {
                const off = !!head?.detached && m !== 'fetch'
                return (
                  <div key={m} className={`toolbar-popover-option${m === pullMode ? ' default' : ''}${off ? ' disabled' : ''}`}
                    title={off ? `${PULL_LABELS[m]} is not available when in a detached HEAD state` : undefined}
                    onClick={() => { if (off) return; setPullOpen(false); void A.pull(path, m) }}>
                    <span className="radio" title={m === pullMode ? 'Default' : 'Set as default'} onClick={(e) => { e.stopPropagation(); setDefaultPull(m) }}><Icon name={m === pullMode ? 'dot-circle-o' : 'circle-o'} /></span>
                    <span>{PULL_LABELS[m]}</span>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
        <TB title="Push" tip={head?.detached ? 'Push is not available when in a detached HEAD state' : cur?.upstream ? `Push to ${cur.upstream.replace(/^refs\/remotes\//, '')}` : 'Push'} icon="push" busy={busy === 'Pushing'} disabled={locked || !s?.remotes.length || !head?.branch} onClick={() => A.push(path)} />
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
        <TB title="Actions" tip="Command Palette (Ctrl + P)" icon="actions" onClick={() => setState({ palette: true })} />
        <TB title="Search" tip="Search Commits (Ctrl + F)" icon="search" onClick={() => {
          const v = getState().repos[path]
          setState((st) => ({ repos: { ...st.repos, [path]: { ...v, search: { ...v.search, open: true } } } }))
          setTimeout(() => document.querySelector<HTMLInputElement>('.graph-search input')?.focus(), 30)
        }} />
      </div>
    </div>
  )
}
