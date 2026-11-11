import { useMemo, useState } from 'react'
import { useStore, openModal, setState } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import * as A2 from '../actions2'
import { relTime } from '../lib/format'
import { Icon } from './Icon'

export function RepoManagement() {
  const tabs = useStore((s) => s.tabs)
  const repos = useStore((s) => s.repos)
  const settings = useStore((s) => s.settings!)
  const [q, setQ] = useState('')
  const [openSec, setOpenSec] = useState({ open: true, fav: true, recent: true })

  const match = (name: string, p: string) => !q.trim() || name.toLowerCase().includes(q.toLowerCase()) || p.toLowerCase().includes(q.toLowerCase())
  const favorites = settings.favorites
  const recent = useMemo(() => settings.recent.filter((r) => match(r.name, r.path)), [settings.recent, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const browse = async () => {
    const dir = await api.pickDirectory('Open a repository')
    if (dir) await A.openRepo(dir)
  }
  const toggleFav = (p: string) => {
    const next = favorites.includes(p) ? favorites.filter((x) => x !== p) : [...favorites, p]
    setState((s) => ({ settings: { ...s.settings!, favorites: next } }))
    void api.setSettings({ favorites: next })
  }
  const removeRecent = (p: string) => {
    const next = settings.recent.filter((r) => r.path !== p)
    setState((s) => ({ settings: { ...s.settings!, recent: next } }))
    void api.setSettings({ recent: next })
  }

  const row = (name: string, p: string, extra?: React.ReactNode, actions?: React.ReactNode) => (
    <div key={p} className="rm-row" onDoubleClick={() => A.openRepo(p)}>
      <span className="rm-fav" title={favorites.includes(p) ? 'Unfavorite' : 'Favorite'} onClick={() => toggleFav(p)}>
        <Icon name={favorites.includes(p) ? 'check' : 'square'} />
      </span>
      <span className="rm-name" onClick={() => A.openRepo(p)}>{name}</span>
      <span className="rm-path truncate">{p}</span>
      <span className="rm-extra">{extra}</span>
      <span className="rm-actions">
        {actions}
        <span className="rm-action" title="Open" onClick={() => A.openRepo(p)}><Icon name="external" /></span>
        <span className="rm-action" title="Show in folder" onClick={() => api.showInFolder(p)}><Icon name="folder" /></span>
      </span>
    </div>
  )

  const section = (key: keyof typeof openSec, title: string, count: number, children: React.ReactNode, right?: React.ReactNode) => (
    <div className="rm-section">
      <div className="rm-section-header" onClick={() => setOpenSec((s) => ({ ...s, [key]: !s[key] }))}>
        <Icon name={openSec[key] ? 'chevron-down' : 'chevron-right'} />
        <span className="rm-section-title">{title}</span>
        <span className="rm-count">{count}</span>
        <span className="grow" />
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {openSec[key] ? <div className="rm-section-body">{count ? children : <div className="rm-empty">No matches</div>}</div> : null}
    </div>
  )

  const openTabs = tabs.filter((t) => match(t.name, t.path))
  return (
    <div className="repo-management">
      <div className="rm-title">Repository Management</div>
      <div className="rm-buttons">
        <button className="btn btn-primary btn-medium" onClick={browse}><Icon name="folder-open" /> Browse</button>
        <button className="btn btn-primary btn-medium" onClick={() => openModal('clone')}><Icon name="cloud" /> Clone</button>
        <button className="btn btn-primary btn-medium" onClick={() => openModal('init')}><Icon name="plus" /> Init</button>
        <span className="grow" />
        <button className="btn btn-default btn-medium" title="Open the repositories GitKraken has open, with the same branches and stashes hidden" onClick={() => void A2.importFromGitKraken()}><Icon name="download" /> Import from GitKraken</button>
        <button className="btn btn-default btn-medium" onClick={() => openModal('prefs', { section: 'integrations' })}><Icon name="link" /> Integrations{Object.keys(settings.integrations).length ? ` (${Object.keys(settings.integrations).length} connected)` : ''}</button>
      </div>
      <div className="rm-search">
        <Icon name="search" />
        <input placeholder="Search repositories" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="rm-scroll">
        {section('open', 'Open repositories', openTabs.length, openTabs.map((t) => {
          const s = repos[t.path]?.snapshot
          const n = s ? new Set([...s.status.staged, ...s.status.unstaged].map((f) => f.path)).size : 0
          return row(t.name, t.path,
            s ? <><span className="rm-branch"><Icon name="code-branch" /> {s.head.branch ?? s.head.sha.slice(0, 7)}</span>{n ? <span className="rm-wip"><Icon name="pencil" className="color-orange" /> {n}</span> : null}</> : null,
            <span className="rm-action" title="Close tab" onClick={() => A.closeTab(t.id)}><Icon name="times" /></span>)
        }), openTabs.length ? <>
          <span className="rm-link" title="Fetch every open repository" onClick={() => void A2.fetchAllRepos(tabs.map((t) => t.path))}><Icon name="refresh" /> Fetch all</span>
          <span className="rm-link" title="Pull every open repository" onClick={() => void A2.pullAllRepos(tabs.map((t) => t.path))}><Icon name="pull" /> Pull all</span>
          <span className="rm-link" onClick={async () => { for (const t of tabs) await A.closeTab(t.id) }}><Icon name="times" /> Close all tabs</span>
        </> : null)}
        {section('fav', 'Favorites', favorites.filter((p) => match(p, p)).length, favorites.filter((p) => match(p, p)).map((p) => row(p.split(/[\\/]/).pop() ?? p, p)),
          favorites.length ? <span className="rm-link" title="Open every favorite in a tab" onClick={async () => { for (const f of favorites) await A.openRepo(f) }}><Icon name="external" /> Open all</span> : null)}
        {section('recent', 'Recent repositories', recent.length, recent.map((r) => row(r.name, r.path, <span className="text-secondary">{relTime(r.lastOpened)}</span>,
          <span className="rm-action" title="Remove from list" onClick={() => removeRecent(r.path)}><Icon name="times" /></span>)),
        recent.length ? <span className="rm-link" onClick={() => { setState((s) => ({ settings: { ...s.settings!, recent: [] } })); void api.setSettings({ recent: [] }) }}><Icon name="times" /> Remove all</span> : null)}
      </div>
    </div>
  )
}
