// The original's Repository Management tab: Open repositories, Favorites (drag to reorder, Ctrl+Alt+1-9),
// Recent repositories and the user's projects folders, each a rounded group with its own toolbar.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faStar as fasStar, faCodeBranch, faCode, faArrowUpRightFromSquare, faEllipsisVertical, faXmark, faFolderPlus, faArrowsRotate, faArrowDown } from '@fortawesome/free-solid-svg-icons'
import { faStar as farStar } from '@fortawesome/free-regular-svg-icons'
import { useStore, openModal } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import * as A2 from '../actions2'
import { basename } from '../lib/format'
import { Icon } from './Icon'
import { Fa } from './NewTab'
import { Checkbox } from './Checkbox'
import type { RepoSummary } from '@shared/repoSummary'

type Summaries = Record<string, RepoSummary | null | undefined>
interface Item { path: string; name: string; tabId?: string }

const HIDDEN_KEY = 'sg-rm-hidden-groups'
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') } catch { return [] } }
const writeHidden = (v: string[]) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(v)) } catch { /* not available */ } }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** branch, ahead / behind and WIP counts for the listed repositories, refreshed every 30 s */
function useSummaries(paths: string[], enabled: boolean): Summaries {
  const [sum, setSum] = useState<Summaries>({})
  const key = paths.join('|')
  useEffect(() => {
    let alive = true
    const load = async () => {
      for (const p of paths) {
        const s = await api.repoSummary(p).catch(() => null)
        if (!alive) return
        setSum((cur) => ({ ...cur, [p]: s }))
      }
    }
    void load()
    const t = window.setInterval(() => void load(), 30000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => { alive = false; window.clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [key, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return sum
}

/** repositories found in each projects folder */
function useProjects(folders: string[]): [Record<string, string[] | null>, (f: string) => void] {
  const [found, setFound] = useState<Record<string, string[] | null>>({})
  const scan = (f: string) => {
    setFound((cur) => ({ ...cur, [f]: null }))
    void api.scanRepos(f).then((r) => setFound((cur) => ({ ...cur, [f]: r })), () => setFound((cur) => ({ ...cur, [f]: [] })))
  }
  useEffect(() => { for (const f of folders) if (!(f in found)) scan(f) }, [folders.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  return [found, scan]
}

function IconBtn({ icon, fa, title, onClick, disabled }: { icon?: string; fa?: IconDefinition; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <span className={`rmg-icon-btn${disabled ? ' disabled' : ''}`} title={title} onClick={(e) => { e.stopPropagation(); if (!disabled) onClick() }}>
      {fa ? <Fa icon={fa} /> : <Icon name={icon!} />}
    </span>
  )
}

export function RepoManagement() {
  const tabs = useStore((s) => s.tabs)
  const settings = useStore((s) => s.settings!)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [hidden, setHidden] = useState<string[]>(readHidden)
  const [sel, setSel] = useState<Record<string, string[]>>({})
  const wip = settings.repoWipSummary !== false
  const favorites = settings.favorites
  const folders = settings.projectFolders ?? []
  const [projects, rescan] = useProjects(folders)
  const searchRef = useRef<HTMLInputElement>(null)

  const openItems: Item[] = tabs.filter((t) => t.path).map((t) => ({ path: t.path, name: t.name, tabId: t.id }))
  const favItems: Item[] = favorites.map((p) => ({ path: p, name: basename(p) }))
  const recentItems: Item[] = settings.recent.map((r) => ({ path: r.path, name: r.name }))
  const groups = useMemo(() => {
    const g: Array<{ id: string; title: string; items: Item[]; kind: 'open' | 'fav' | 'recent' | 'folder'; folder?: string }> = [
      { id: 'open', title: 'Open repositories', items: openItems, kind: 'open' },
      { id: 'fav', title: 'Favorites', items: favItems, kind: 'fav' },
      { id: 'recent', title: 'Recent repositories', items: recentItems, kind: 'recent' }
    ]
    for (const f of folders) g.push({ id: `folder:${f}`, title: basename(f), items: (projects[f] ?? []).map((p) => ({ path: p, name: basename(p) })), kind: 'folder', folder: f })
    return g
  }, [tabs, favorites, settings.recent, folders.join('|'), projects]) // eslint-disable-line react-hooks/exhaustive-deps

  const allPaths = useMemo(() => [...new Set(groups.flatMap((g) => g.items.map((i) => i.path)))], [groups])
  const sums = useSummaries(allPaths, wip)
  const term = q.trim().toLowerCase()
  const match = (i: Item) => !term || i.name.toLowerCase().includes(term)

  const setFavs = (next: string[]) => A2.saveSettings({ favorites: next })
  const toggleFav = (p: string) => setFavs(favorites.some((f) => same(f, p)) ? favorites.filter((f) => !same(f, p)) : [...favorites, p])
  const removeRecent = (paths: string[]) => A2.saveSettings({ recent: settings.recent.filter((r) => !paths.includes(r.path)) })
  const hide = (id: string, on: boolean) => { const next = on ? [...hidden, id] : hidden.filter((h) => h !== id); setHidden(next); writeHidden(next) }
  const openAll = async (paths: string[]) => { for (const p of paths) await A.openRepo(p) }
  const closeTabs = async (items: Item[]) => { for (const i of items) if (i.tabId) await A.closeTab(i.tabId) }

  const browse = async () => {
    const dir = await api.pickDirectory('Open a repository')
    if (dir) await A.openRepo(dir)
  }
  const addFolder = async () => {
    const dir = await api.pickDirectory('Browse for project directory')
    if (!dir || folders.some((f) => same(f, dir))) return
    A2.saveSettings({ projectFolders: [...folders, dir] })
  }
  const removeFolder = (f: string) => A2.saveSettings({ projectFolders: folders.filter((x) => x !== f) })

  // drag and drop to reorder favorites (their order is the Ctrl+Alt+1-9 shortcuts)
  const [dragFav, setDragFav] = useState<number | null>(null)
  const dropFav = (to: number) => {
    if (dragFav === null || dragFav === to) return
    const next = [...favorites]
    const [f] = next.splice(dragFav, 1)
    next.splice(to, 0, f)
    setFavs(next)
    setDragFav(null)
  }

  const row = (g: (typeof groups)[number], i: Item, idx: number) => {
    const s = sums[i.path]
    const unreachable = s === null
    const isFav = favorites.some((f) => same(f, i.path))
    const checked = (sel[g.id] ?? []).includes(i.path)
    const toggleSel = (v: boolean) => setSel((cur) => ({ ...cur, [g.id]: v ? [...(cur[g.id] ?? []), i.path] : (cur[g.id] ?? []).filter((p) => p !== i.path) }))
    const favDrag = g.kind === 'fav' && !term
    return (
      <div key={i.path} className={`rmg-row${unreachable ? ' unreachable' : ''}${favDrag && dragFav === idx ? ' dragging' : ''}`}
        draggable={favDrag} onDragStart={() => setDragFav(idx)} onDragEnd={() => setDragFav(null)}
        onDragOver={(e) => { if (favDrag && dragFav !== null) e.preventDefault() }} onDrop={() => dropFav(idx)}
        onDoubleClick={() => { if (!unreachable) void A.openRepo(i.path) }}>
        <span className={`rmg-star${isFav ? ' on' : ''}`} title={isFav ? 'Remove repository from favorites' : 'Add repository to favorites'} onClick={() => toggleFav(i.path)}>
          <Fa icon={isFav ? fasStar : farStar} />
        </span>
        <Checkbox checked={checked} onChange={toggleSel} />
        <span className="rmg-name truncate" title={i.path}>
          {unreachable ? <span className="rmg-unreachable" title="Repo is unreachable and may have been deleted"><Icon name="warning" /></span> : null}
          {i.name}
        </span>
        <span className="rmg-col truncate">{g.kind === 'fav' && idx < 9 ? <span className="rmg-shortcut">Ctrl + Alt + {idx + 1}</span> : null}</span>
        <span className="rmg-status">
          {s ? <>
            <span className="rmg-pill"><Fa icon={faCodeBranch} /> {s.branch ?? 'HEAD'}</span>
            {wip && (s.ahead || s.behind) ? <span className="rmg-pill">{s.ahead ? <span className="color-green">↑{s.ahead}</span> : null}{s.behind ? <span className="color-red">↓{s.behind}</span> : null}</span> : null}
            {wip && (s.modified || s.added) ? <span className="rmg-pill">{s.modified ? <span className="color-orange"><Icon name="pencil" /> {s.modified}</span> : null}{s.added ? <span className="color-green"><Icon name="plus" /> {s.added}</span> : null}</span> : null}
          </> : null}
        </span>
        <span className="rmg-actions">
          <IconBtn fa={faArrowUpRightFromSquare} title="Open in new tab" disabled={unreachable} onClick={() => void A.openRepo(i.path)} />
          <IconBtn fa={faCode} title="Open in external editor" disabled={unreachable} onClick={() => void A2.openInEditor(i.path, null)} />
          <IconBtn icon="folder" title="Open in file manager" disabled={unreachable} onClick={() => void api.showInFolder(i.path)} />
          {g.kind === 'open' ? <IconBtn fa={faXmark} title="Close repository" onClick={() => void closeTabs([i])} />
            : g.kind === 'recent' ? <IconBtn fa={faXmark} title="Remove repository" onClick={() => removeRecent([i.path])} />
            : g.kind === 'fav' ? <IconBtn fa={faXmark} title="Remove repository from favorites" onClick={() => toggleFav(i.path)} />
            : <span className="rmg-icon-btn placeholder" />}
        </span>
      </div>
    )
  }

  const group = (g: (typeof groups)[number]) => {
    if (hidden.includes(g.id)) return null
    const shown = g.items.filter(match)
    const chosen = g.items.filter((i) => (sel[g.id] ?? []).includes(i.path))
    const target = chosen.length ? chosen : g.items
    const n = chosen.length
    const reachable = target.filter((i) => sums[i.path] !== null).map((i) => i.path)
    const open = !collapsed[g.id]
    const scanning = g.kind === 'folder' && projects[g.folder!] === null
    return (
      <div key={g.id} className="rmg-group">
        <div className="rmg-group-header" onClick={() => setCollapsed((c) => ({ ...c, [g.id]: open }))}>
          <span className="rmg-chevron"><Icon name={open ? 'chevron-down' : 'chevron-right'} /></span>
          {g.kind === 'folder' ? <Icon name="folder" className="rmg-group-icon" /> : null}
          <span className="rmg-group-title" title={g.folder}>{g.title}</span>
          <span className="gk-badge">{g.items.length}</span>
          {g.kind === 'fav' ? <span className="rmg-subtext">Drag and drop to reorder favorites and configure shortcuts</span> : null}
          <span className="grow" />
          <span className="rmg-group-tools" onClick={(e) => e.stopPropagation()}>
            {g.kind === 'open' && g.items.length ? <span className="rmg-text-btn" onClick={() => void closeTabs(target)}><Fa icon={faXmark} /> {n ? `Close ${n} repositories` : 'Close all tabs'}</span> : null}
            {g.kind === 'recent' && g.items.length ? <span className="rmg-text-btn" onClick={() => removeRecent(target.map((i) => i.path))}><Fa icon={faXmark} /> {n ? `Remove ${n} repositories` : 'Remove all'}</span> : null}
            <IconBtn fa={faArrowsRotate} title={n ? `Fetch ${n} repositories` : 'Fetch all repositories'} disabled={!reachable.length} onClick={() => void A2.fetchAllRepos(reachable)} />
            <IconBtn fa={faArrowDown} title={n ? `Pull ${n} repositories` : 'Pull all repositories'} disabled={!reachable.length} onClick={() => void A2.pullAllRepos(reachable)} />
            <IconBtn fa={faArrowUpRightFromSquare} title={n ? `Open ${n} repositories` : 'Open all repos in new tabs'} disabled={!reachable.length || g.kind === 'open'} onClick={() => void openAll(reachable)} />
            <IconBtn fa={faEllipsisVertical} title="More" onClick={() => void A.popup([
              ...(g.kind === 'folder' ? [{ label: 'Search again', act: () => rescan(g.folder!) }, { label: 'Open in file manager', act: () => void api.showInFolder(g.folder!) }, { label: 'Remove projects folder', act: () => removeFolder(g.folder!) }, '-' as const] : []),
              { label: 'Hide', act: () => hide(g.id, true) }
            ])} />
          </span>
        </div>
        {open ? (
          <div className="rmg-group-body">
            {scanning ? <div className="rmg-empty">Looking for repos…</div>
              : shown.length ? shown.map((i) => row(g, i, g.items.indexOf(i)))
              : <div className="rmg-empty">{term ? 'No results found' : g.kind === 'fav' ? 'No repositories have been favorited.' : g.kind === 'folder' ? 'SuperGit did not find any repositories.' : 'No repositories'}</div>}
          </div>
        ) : null}
      </div>
    )
  }

  const hiddenCount = hidden.filter((h) => groups.some((g) => g.id === h)).length
  const showAll = (v: boolean) => setCollapsed(Object.fromEntries(groups.map((g) => [g.id, !v])))
  return (
    <div className="rmg">
      <div className="rmg-header">
        <h1 className="rmg-title">Repository Management</h1>
        <div className="rmg-buttons">
          <button className="btn btn-primary rmg-btn" onClick={browse}><Icon name="folder-open" /> Browse</button>
          <button className="btn btn-primary rmg-btn" onClick={() => openModal('clone')}><Icon name="cloud" /> Clone</button>
          <button className="btn btn-primary rmg-btn" onClick={() => openModal('init')}><Icon name="plus" /> Init</button>
          <button className="btn btn-default rmg-btn" title="Add a folder in which you keep multiple repositories, so SuperGit can help you open them quickly" onClick={addFolder}><Fa icon={faFolderPlus} /> Add a Projects Folder</button>
          <button className="btn btn-default rmg-btn" onClick={() => openModal('prefs', { section: 'integrations' })}><Icon name="github" /> Integrations</button>
          <span className="grow" />
          <button className="btn btn-default rmg-btn" title="Open the repositories GitKraken has open, with the same branches and stashes hidden" onClick={() => void A2.importFromGitKraken()}><Icon name="download" /> Import from GitKraken</button>
        </div>
        <div className="rmg-search-row">
          <button className="rmg-plain" onClick={() => showAll(false)}><span className="rmg-stack"><Icon name="chevron-down" /><Icon name="chevron-up" /></span> Collapse</button>
          <button className="rmg-plain" onClick={() => showAll(true)}><span className="rmg-stack"><Icon name="chevron-up" /><Icon name="chevron-down" /></span> Expand</button>
          <div className="rmg-search">
            <Icon name="search" className="rmg-search-icon" />
            <input ref={searchRef} placeholder="Search repositories" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ('') }} />
          </div>
          <span title="Display WIP summary for all repos. Note: large repos may take longer to load this data.">
            <Checkbox checked={wip} onChange={(v) => A2.saveSettings({ repoWipSummary: v })}>WIP summary</Checkbox>
          </span>
        </div>
      </div>
      <div className="rmg-scroll">
        {groups.map(group)}
        {hiddenCount ? (
          <div className="rmg-hidden-note">
            {hiddenCount === 1 ? '1 group is hidden' : `${hiddenCount} groups are hidden`}
            <span className="btn-link" onClick={() => { setHidden([]); writeHidden([]) }}>Unhide all</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

