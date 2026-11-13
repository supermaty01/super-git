import { useEffect, useMemo, useRef, useState, type ReactNode, type DragEvent, type MouseEvent as RME } from 'react'
import { tagAnnotation } from '../lib/tagNote'
import type { RepoView } from '../store'
import { updateRepo, setState, getState, openModal } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import * as A2 from '../actions2'
import { useStore } from '../store'
import { parseStash, stashKey } from '../lib/format'
import { refMenu, remoteMenu, stashMenu, worktreeMenu, tagMenu, dropMenu, folderMenu, sectionMenu, submoduleMenu } from '../menus'
import { Icon } from './Icon'
import { LoadingOverlay } from './LoadingOverlay'
import { fuzzyMatch, parseFilter, slice, runs } from '../lib/lpfilter'
import { useLpSel, toggleSelection, clearSelection, multiBranchMenu, multiStashMenu } from '../lpMulti'
import '../styles/leftpanel.css'
import { MIN_BRANCHES_FOR_CLEANUP } from '@shared/k2logic'
import { openWorktree } from '../k2worktree'
import type { Ref, Remote, Submodule, Stash, Worktree } from '@shared/types'

interface TreeNode { name: string; path: string; ref?: Ref; children: TreeNode[] }

function buildTree(refs: Ref[], strip: (r: Ref) => string): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const r of refs) {
    const parts = strip(r).split('/')
    let node = root
    parts.forEach((p, i) => {
      const isLeaf = i === parts.length - 1
      if (isLeaf) { node.children.push({ name: p, path: node.path + p, ref: r, children: [] }); return }
      let next = node.children.find((c) => !c.ref && c.name === p)
      if (!next) { next = { name: p, path: node.path + p + '/', children: [] }; node.children.push(next) }
      node = next
    })
  }
  const sort = (n: TreeNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); n.children.forEach(sort) }
  sort(root)
  return root.children
}

const DND = 'application/x-supergit-ref'
export function refDragProps(path: string, ref: Ref) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData(DND, ref.name); e.dataTransfer.effectAllowed = 'move' },
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DND)) { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('drop-target') } },
    onDragLeave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('drop-target'),
    onDrop: (e: DragEvent) => {
      (e.currentTarget as HTMLElement).classList.remove('drop-target')
      const name = e.dataTransfer.getData(DND)
      const src = A.snap(path).refs.find((r) => r.name === name)
      if (src) { e.preventDefault(); void dropMenu(path, src, ref) }
    }
  }
}

function focusCommit(path: string, sha: string) {
  A.selectCommit(path, sha)
  updateRepo(path, { focus: { sha, t: Date.now() } })
}

const SECTIONS = [
  { id: 'gitflow', label: 'GITFLOW', icon: 'swap' },
  { id: 'local', label: 'LOCAL', icon: 'laptop-o' },
  { id: 'remote', label: 'REMOTE', icon: 'cloud-o' },
  { id: 'worktrees', label: 'WORKTREES', icon: 'tree-o' },
  { id: 'stashes', label: 'STASHES', icon: 'inbox-o' },
  { id: 'tags', label: 'TAGS', icon: 'tag-o' },
  { id: 'submodules', label: 'SUBMODULES', icon: 'folder-tree' }
] as const

const NONE: string[] = []
const INDENT = 15
const MIN_SECTION = 138
const DEFAULT_SECTION = 162

function readJson<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
function writeJson(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* private window / blocked storage */ }
}
/** state remembered in localStorage: the section layout survives reloads and tab switches */
function usePersisted<T>(key: string, init: T): [T, (f: (p: T) => T) => void] {
  const [v, setV] = useState<T>(() => readJson(key, init))
  return [v, (f) => setV((p) => { const n = f(p); writeJson(key, n); return n })]
}

/** the original's thin long arrows */
function Long({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg className="lp-long" viewBox="0 0 6.3 10" width="6.3" height="10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'up' ? <path d="M3.15 9.5V.7M.7 3.1 3.15.7 5.6 3.1" /> : <path d="M3.15.5v8.8M.7 6.9l2.45 2.4 2.45-2.4" />}
    </svg>
  )
}
/** thin vertical ellipsis */
function Dots() {
  return <svg className="lp-dots" viewBox="0 0 3.5 14" width="3.5" height="14" fill="currentColor"><circle cx="1.75" cy="1.9" r="1.5" /><circle cx="1.75" cy="7" r="1.5" /><circle cx="1.75" cy="12.1" r="1.5" /></svg>
}

/** "2↑ 1↓" with the original's titles */
function AheadBehind({ ahead, behind }: { ahead?: number; behind?: number }) {
  if (!ahead && !behind) return null
  return (
    <span className="lp-track upstream-status">
      {ahead ? <span className="ahead" title={`${ahead} ahead`}>{ahead}<Long dir="up" /></span> : null}
      {behind ? <span className="behind" title={`${behind} behind`}>{behind}<Long dir="down" /></span> : null}
    </span>
  )
}

/** highlight the matched characters one by one, like the original's filter */
function hlText(text: string, marks: Set<number>): ReactNode {
  if (!marks.size) return text
  return <>{runs(text, marks).map((r, i) => (r.match ? <span key={i} className="filter-match">{r.text}</span> : r.text))}</>
}

/** all branch refs below a tree node */
function refsUnder(nodes: TreeNode[]): Ref[] {
  return nodes.flatMap((n) => (n.ref ? [n.ref] : refsUnder(n.children)))
}

interface RowProps {
  depth: number
  icon: ReactNode
  children: ReactNode
  className?: string
  current?: boolean
  /** highlight as current without the check mark (worktrees) */
  noCheck?: boolean
  /** eye toggle in the lead column; undefined = no eye */
  hidden?: boolean
  onEye?: () => void
  right?: ReactNode
  /** replaces the lead column content (worktree lock) */
  lead?: ReactNode
  onMenu?: (e: RME) => void
  title?: string
  onClick?: (e: RME) => void
  /** part of the Ctrl+click selection */
  selected?: boolean
  onDoubleClick?: () => void
  extra?: Record<string, unknown>
}

/** one left panel row: [lead column: check / eye] [indent] [icon] [name] [right] [⋮] */
function Row(p: RowProps) {
  return (
    <div
      className={`lp-row${p.current ? ' current' : ''}${p.hidden ? ' is-hidden' : ''}${p.selected ? ' selected' : ''}${p.className ? ' ' + p.className : ''}`}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      onContextMenu={(e) => { if (p.onMenu) { e.preventDefault(); p.onMenu(e) } }}
      {...(p.extra ?? {})}
    >
      <span className="lp-lead">
        {p.lead ? p.lead : p.current && !p.noCheck ? <span className="lp-current-badge"><Icon name="check" /></span> : p.onEye ? (
          <span className={`lp-eye${p.hidden ? ' always' : ''}`} onClick={(e) => { e.stopPropagation(); p.onEye!() }}>
            <Icon name={p.hidden ? 'eye-slash' : 'eye'} />
          </span>
        ) : null}
      </span>
      <span className="lp-indent" style={{ width: p.depth * INDENT }} />
      <span className="lp-icon">{p.icon}</span>
      <span className="lp-label" title={p.title}>{p.children}</span>
      {p.right ? <span className="lp-right">{p.right}</span> : null}
      {p.onMenu ? <span className="lp-ellipsis" onClick={(e) => { e.stopPropagation(); p.onMenu!(e) }}><Dots /></span> : null}
    </div>
  )
}

export function LeftPanel({ repo, collapsed, width }: { repo: RepoView; collapsed: boolean; width: number }) {
  const s = repo.snapshot
  const path = repo.path
  const [open, setOpen] = usePersisted<Record<string, boolean>>('sg.lp.open', { gitflow: true, local: true, remote: true })
  const [allClosed, setAllClosed] = usePersisted<Record<string, Record<string, boolean>>>('sg.lp.folders', {})
  const closedFolders = allClosed[path] ?? {}
  const [heights, setHeights] = usePersisted<Record<string, number>>('sg.lp.heights', {})
  // the box shows what is typed; the list follows 500 ms after the last keystroke, like the original
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('')
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const typeFilter = (v: string) => {
    setText(v)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { timer.current = null; setFilter(v) }, 500)
  }
  const clearFilter = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    setText('')
    setFilter('')
  }
  const hidden = useStore((st) => st.settings?.hiddenRefs[path] ?? NONE)
  const solo = useStore((st) => st.settings?.soloRefs[path] ?? NONE)
  const picked = useLpSel((st) => st.sel[path]) ?? NONE
  const hiddenSections = useStore((st) => st.settings?.hiddenSections ?? NONE)

  const data = useMemo(() => {
    if (!s) return null
    const fq = parseFilter(filter, s.remotes.map((r) => r.name))
    const on = !!filter.trim()
    const idx = new Map<string, number[]>()
    const hit = (key: string, t: string): boolean => {
      const m = fuzzyMatch(t, fq.text)
      if (!m) return false
      if (m.length) idx.set(key, m)
      return true
    }
    // `origin:` / `origin/` limits the filter to that remote's branches
    const scoped = !!fq.remote
    const locals = s.refs.filter((r) => r.type === 'head' && (!on || (!scoped && hit(r.name, r.short))))
    const remoteRefs = s.refs.filter((r) => r.type === 'remote' && !r.short.endsWith('/HEAD') && (!on || !scoped || r.remote === fq.remote))
    const remotes = s.remotes
      .map((rm) => {
        const mine = remoteRefs.filter((r) => r.remote === rm.name).filter((r) => !on || hit(r.name, r.short.slice(rm.name.length + 1)))
        return { remote: rm, tree: buildTree(mine, (r) => r.short.slice(rm.name.length + 1)) }
      })
      // a remote none of whose branches match is hidden while filtering
      .filter((r) => !on || r.tree.length > 0)
    const tags = s.refs.filter((r) => r.type === 'tag' && (!on || (!scoped && hit(r.name, r.short)))).sort((a, b) => b.short.localeCompare(a.short, undefined, { numeric: true }))
    const folderOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
    const worktrees = s.worktrees.filter((w) => !on || (!scoped && (hit('wt:' + w.path, w.branch ?? folderOf(w.path)) || fuzzyMatch(folderOf(w.path), fq.text) !== null)))
    const stashes = s.stashes.filter((st) => !on || (!scoped && hit(stashKey(st.sha), parseStash(st.message, true).msg)))
    const submodules = s.submodules.filter((m) => !on || (!scoped && hit('sm:' + m.path, m.path)))
    return { localTree: buildTree(locals, (r) => r.short), remotes, worktrees, stashes, tags, submodules, idx }
  }, [s, filter])

  if (!s || !data) return null

  const counts: Record<string, number> = {
    gitflow: s.refs.filter((r) => r.type === 'head').length,
    local: s.refs.filter((r) => r.type === 'head').length,
    remote: s.refs.filter((r) => r.type === 'remote' && !r.short.endsWith('/HEAD')).length,
    worktrees: s.worktrees.length,
    stashes: s.stashes.length,
    tags: s.refs.filter((r) => r.type === 'tag').length,
    submodules: s.submodules.length
  }
  // "Viewing" counts the branches and tags shown in the graph, as "shown/total" once some are hidden
  const viewable = s.refs.filter((r) => r.type === 'head' || r.type === 'tag' || (r.type === 'remote' && !r.short.endsWith('/HEAD')))
  const viewing = (solo.length ? viewable.filter((r) => solo.includes(r.name)) : viewable.filter((r) => !hidden.includes(r.name))).length
  // a section with hidden entries shows "shown/total", like the Viewing counter
  const isShown = (r: Ref) => (solo.length ? solo.includes(r.name) : !hidden.includes(r.name))
  const countLabel = (id: string): string => {
    const type = id === 'local' || id === 'gitflow' ? 'head' : id === 'remote' ? 'remote' : id === 'tags' ? 'tag' : null
    if (!type) return String(counts[id])
    const all = viewable.filter((r) => r.type === type)
    const n = all.filter(isShown).length
    return n === all.length ? String(all.length) : `${n}/${all.length}`
  }
  const shown = (id: string) => !hiddenSections.includes(id) && (id !== 'gitflow' || s.gitflow.initialized)

  const toggleLeft = (v: boolean) => {
    setState((st) => ({ settings: { ...st.settings!, layout: { ...st.settings!.layout, leftOpen: v } } }))
    void api.setSettings({ layout: { ...getState().settings!.layout, leftOpen: v } })
  }

  if (collapsed) {
    return (
      <div className="left-strip">
        <div className="strip-item" onClick={() => { if (repo.center.kind === 'file') A.closeCenter(path); toggleLeft(true) }}>
          <Icon name="chevron-circle-right" />
        </div>
        {SECTIONS.filter((sec) => shown(sec.id)).map((sec) => (
          <div key={sec.id} className="strip-item" onClick={() => { if (repo.center.kind === 'file') A.closeCenter(path); toggleLeft(true); setOpen((o) => ({ ...o, [sec.id]: true })) }}>
            <Icon name={sec.icon} />
            <span className="strip-count">{counts[sec.id]}</span>
          </div>
        ))}
      </div>
    )
  }

  const filtering = !!filter.trim()
  /** the matched characters among the `len` characters of a (stripped) ref name starting at `start` */
  const marksOf = (key: string, start: number, len: number) => slice(data.idx.get(key), start, len)
  const matchedCount: Record<string, number> = {
    gitflow: refsUnder(data.localTree).length,
    local: refsUnder(data.localTree).length,
    remote: data.remotes.reduce((n, r) => n + refsUnder(r.tree).length, 0),
    worktrees: data.worktrees.length,
    stashes: data.stashes.length,
    tags: data.tags.length,
    submodules: data.submodules.length
  }
  // like the original, "Filtering n/total" counts the matches of every section
  const matchedViewable = matchedCount.local + matchedCount.remote + matchedCount.tags + matchedCount.worktrees + matchedCount.stashes + matchedCount.submodules
  const isOpen = (id: string) => filtering || !!open[id]
  const folderOpen = (key: string) => filtering || !closedFolders[key]
  const toggleFolder = (key: string) => setAllClosed((all) => ({ ...all, [path]: { ...(all[path] ?? {}), [key]: !(all[path] ?? {})[key] } }))
  const maximize = (id: string) => setOpen(() => Object.fromEntries(SECTIONS.map((x) => [x.id, x.id === id])))
  const gf = s.gitflow

  const gitflowType = (r: Ref): 'feature' | 'release' | 'hotfix' | null => {
    if (!gf.initialized) return null
    for (const t of ['feature', 'release', 'hotfix'] as const) if (gf[t] && r.short.startsWith(gf[t])) return t
    return null
  }

  const branchMenu = (r: Ref, inGitflow: boolean) => {
    const t = inGitflow ? gitflowType(r) : null
    if (!t) return void refMenu(path, r, { inLeftPanel: true })
    const name = r.short.slice(gf[t].length)
    void A.popup([
      { label: `Finish ${t} ${name}`, act: () => A2.gitflowFinish(path, t, name) },
      '-',
      { label: `Checkout ${r.short}`, act: () => A.checkoutRef(path, r), enabled: !r.isCurrent },
      { label: `Delete ${r.short}`, act: () => A.deleteLocalBranch(path, r), enabled: !r.isCurrent }
    ])
  }

  const renderTree = (nodes: TreeNode[], depth: number, keyPrefix: string, gitflow = false): ReactNode[] =>
    nodes.flatMap((n) => {
      if (n.ref) {
        const r = n.ref
        const isHidden = hidden.includes(r.name)
        const soloed = solo.includes(r.name)
        return [
          <Row key={keyPrefix + r.name} depth={depth} current={r.isCurrent} hidden={isHidden} onEye={() => A2.setHidden(path, [r.name], !isHidden)}
            className={`lp-branch${soloed ? ' is-soloed' : ''}`}
            icon={<Icon name="code-branch" />}
            title={r.short}
            selected={picked.includes(r.name)}
            onClick={(e) => { if (e.ctrlKey || e.metaKey) { toggleSelection(path, r.name); return } clearSelection(path); focusCommit(path, r.sha) }}
            onDoubleClick={() => A.checkoutRef(path, r)}
            onMenu={() => picked.length > 1 && picked.includes(r.name) ? void multiBranchMenu(path, s.refs.filter((x) => picked.includes(x.name))) : branchMenu(r, gitflow)}
            extra={refDragProps(path, r)}
            right={<>
              {r.type === 'head' ? <AheadBehind ahead={r.ahead} behind={r.behind} /> : null}
              {soloed ? <span className="lp-solo-badge" title="Soloed — click to stop soloing" onClick={(e) => { e.stopPropagation(); A2.setSolo(path, [r.name], false) }}>S</span> : null}
              {gitflow && gitflowType(r) ? (
                <button className="btn btn-success btn-xs lp-finish" onClick={(e) => { e.stopPropagation(); const t = gitflowType(r)!; void A2.gitflowFinish(path, t, r.short.slice(gf[t].length)) }}>Finish</button>
              ) : null}
            </>}
          >
            <span className="lp-name">{hlText(n.name, marksOf(r.name, n.path.length - n.name.length, n.name.length))}</span>
          </Row>
        ]
      }
      const key = keyPrefix + n.path
      const o = folderOpen(key)
      const inner = refsUnder(n.children)
      const names = inner.map((r) => r.name)
      const allHidden = names.length > 0 && names.every((x) => hidden.includes(x))
      const flowType = gitflow && depth === 0 ? (['feature', 'release', 'hotfix'] as const).find((t) => gf[t] === n.path) : undefined
      const folderMarks = new Set<number>()
      if (filtering) for (const r of inner) for (const i of marksOf(r.name, n.path.length - 1 - n.name.length, n.name.length)) folderMarks.add(i)
      return [
        <Row key={key} depth={depth} hidden={allHidden} onEye={() => A2.setHidden(path, names, !allHidden)} className="lp-folder"
          icon={<Icon name="folder" />}
          onClick={() => toggleFolder(key)}
          onMenu={() => {
            if (flowType) void A.popup([{ label: `Start ${flowType}`, act: () => A2.gitflowStartDialog(path, flowType) }])
            else void folderMenu(path, n.path.replace(/\/$/, ''), inner)
          }}
        >
          <span className="lp-name">{hlText(n.name, folderMarks)}</span>
        </Row>,
        ...(o ? renderTree(n.children, depth + 1, keyPrefix, gitflow) : [])
      ]
    })

  const header = (id: string, extra?: ReactNode) => {
    const sec = SECTIONS.find((x) => x.id === id)!
    return (
      <div className={`lp-header hover-target${isOpen(id) ? ' open' : ''}`} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
        onContextMenu={(e) => {
          e.preventDefault()
          const openIds = SECTIONS.filter((x) => (x.id === 'local' || shown(x.id)) && isOpen(x.id)).map((x) => x.id)
          void sectionMenu(path, id, () => maximize(id), !(openIds.length === 1 && openIds[0] === id))
        }}>
        <Icon name={isOpen(id) ? 'chevron-down' : 'chevron-right'} className="lp-chevron" />
        <Icon name={sec.icon} className="lp-header-icon" />
        <span className="lp-caps">{sec.label}</span>
        {extra ? <span className="hover-show" onClick={(e) => e.stopPropagation()}>{extra}</span> : null}
        {filtering
          ? <span className={`lp-count lp-count-filtered${extra ? ' hover-hide' : ''}`}><Icon name="filter" /> {matchedCount[id] ?? 0}</span>
          : <span className={`lp-count${extra ? ' hover-hide' : ''}`}>{countLabel(id)}</span>}
      </div>
    )
  }

  // every open section is its own scrolling area with its own (persisted) height, at least 138px;
  // the last open one takes the spare room
  const lastOpen = [...SECTIONS].reverse().find((x) => (x.id === 'local' || shown(x.id)) && isOpen(x.id))?.id
  const secClass = (id: string) => `lp-section${isOpen(id) ? ' open' : ''}`
  const secStyle = (id: string) => (isOpen(id) ? { flex: `${id === lastOpen ? 1 : 0} 1 ${heights[id] ?? DEFAULT_SECTION}px` } : undefined)
  const handle = (id: string) => !isOpen(id) ? null : (
    <div className="lp-resize-handle resizable-handle-horizontal" onMouseDown={(e) => {
      e.preventDefault()
      const startY = e.clientY
      const startH = (e.currentTarget.parentElement as HTMLElement).offsetHeight
      const move = (ev: MouseEvent) => { const h = Math.max(MIN_SECTION, Math.round(startH + ev.clientY - startY)); setHeights((p) => (p[id] === h ? p : { ...p, [id]: h })) }
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('resizing-rows') }
      document.body.classList.add('resizing-rows')
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }} />
  )

  const localCount = (s?.refs ?? []).filter((r) => r.type === 'head').length
  const gitflowStart = () => A.popup([
    { label: 'Start Feature', act: () => A2.gitflowStartDialog(path, 'feature') },
    { label: 'Start Release', act: () => A2.gitflowStartDialog(path, 'release') },
    { label: 'Start Hotfix', act: () => A2.gitflowStartDialog(path, 'hotfix') },
    '-',
    { label: 'Gitflow settings…', act: () => openModal('repoPrefs', { path, section: 'gitflow' }) }
  ])

  return (
    <div className="left-panel" style={{ width }}>
      <div className="lp-top">
        <div className={`lp-viewing${filtering ? ' filtering' : ''}`}>
          <span className="lp-collapse" title="Collapse left panel" onClick={() => toggleLeft(false)}><Icon name="chevron-circle-left" /></span>
          {filtering ? <>
            Filtering <span className="lp-viewing-count">{matchedViewable}/{viewable.length}</span>
            <span className="lp-show-all" onClick={clearFilter}>Clear filter</span>
          </> : <>
            Viewing <span className="lp-viewing-count">{viewing === viewable.length ? viewing : `${viewing}/${viewable.length}`}</span>
            {viewing !== viewable.length ? <span className="lp-show-all" onClick={() => { A2.setHidden(path, hidden.filter((n) => !n.startsWith('stash:')), false); if (solo.length) A2.setSolo(path, solo, false) }}>Show All</span> : null}
          </>}
        </div>
        <div className="lp-filter">
          <input placeholder="Filter (Ctrl + Alt + f)" value={text} onChange={(e) => typeFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { clearFilter(); e.currentTarget.blur() } }} />
          <span className={`lp-filter-icon${text ? ' clear' : ''}`} onClick={text ? clearFilter : undefined}><Icon name={text ? 'times' : 'search'} /></span>
        </div>
      </div>
      {repo.busy === A.CHECKING_OUT || repo.busy === A.DELETING ? <LoadingOverlay message={repo.busy} delay={repo.busy === A.CHECKING_OUT ? 500 : 0} /> : null}
      <div className="lp-scroll">
        {shown('gitflow') ? (
          <div className={secClass('gitflow')} style={secStyle('gitflow')}>
            {header('gitflow', <button className="btn btn-success btn-small" title="Start a gitflow branch" onClick={gitflowStart}><Icon name="plus" /></button>)}
            {isOpen('gitflow') ? <div className="lp-body">{renderTree(data.localTree, 0, 'g:', true)}</div> : null}
            {handle('gitflow')}
          </div>
        ) : null}

        <div className={secClass('local')} style={secStyle('local')}>
          {header('local', localCount >= MIN_BRANCHES_FOR_CLEANUP ? <button className="btn btn-primary btn-small lp-cleanup-btn" title="Clean up local branches" onClick={() => openModal('branchCleanup', { path })}><Icon name="broom" /></button> : undefined)}
          {isOpen('local') ? <div className="lp-body">{renderTree(data.localTree, 0, 'l:')}</div> : null}
          {handle('local')}
        </div>

        {shown('remote') ? (
          <div className={secClass('remote')} style={secStyle('remote')}>
            {header('remote', <button className="btn btn-success btn-small" title="Add Remote" onClick={() => openModal('remote', { path })}><Icon name="plus" /></button>)}
            {isOpen('remote') ? <div className="lp-body">{data.remotes.map(({ remote, tree }) => {
              const names = refsUnder(tree).map((r) => r.name)
              const allHidden = names.length > 0 && names.every((x) => hidden.includes(x))
              const key = 'r:' + remote.name
              return (
                <div key={remote.name}>
                  <RemoteRow path={path} remote={remote} hidden={allHidden} onEye={() => A2.setHidden(path, names, !allHidden)} onToggle={() => toggleFolder(key)} />
                  {folderOpen(key) ? renderTree(tree, 1, `r:${remote.name}/`) : null}
                </div>
              )
            })}</div> : null}
            {handle('remote')}
          </div>
        ) : null}

        {shown('worktrees') ? (
          <div className={secClass('worktrees')} style={secStyle('worktrees')}>
            {header('worktrees', <>
              <button className="btn btn-primary btn-small mr1" title="Refresh WIPs" onClick={() => void A.refresh(path)}><Icon name="refresh" /></button>
              <button className="btn btn-success btn-small" title="Add a new worktree" onClick={() => A.addWorktreeDialog(path)}><Icon name="plus" /></button>
            </>)}
            {isOpen('worktrees') ? <div className="lp-body">{data.worktrees.map((w) => <WorktreeRow key={w.path} path={path} w={w} marks={marksOf('wt:' + w.path, 0, (w.branch ?? '').length)} />)}</div> : null}
            {handle('worktrees')}
          </div>
        ) : null}

        {shown('stashes') ? (
          <div className={secClass('stashes')} style={secStyle('stashes')}>
            {header('stashes')}
            {isOpen('stashes') ? <div className="lp-body">{data.stashes.map((st) => <StashRow key={st.sha} path={path} st={st} picked={picked} hidden={hidden.includes(stashKey(st.sha))} marks={marksOf(stashKey(st.sha), 0, 1000)} />)}</div> : null}
            {handle('stashes')}
          </div>
        ) : null}

        {shown('tags') ? (
          <div className={secClass('tags')} style={secStyle('tags')}>
            {header('tags')}
            {isOpen('tags') ? <div className="lp-body">{data.tags.map((t) => {
              const isHidden = hidden.includes(t.name)
              return (
                <Row key={t.name} depth={0} hidden={isHidden} onEye={() => A2.setHidden(path, [t.name], !isHidden)} icon={<Icon name="tag-o" />}
                  title={tagAnnotation(t, s.commits)}
                  onClick={() => focusCommit(path, t.sha)}
                  onDoubleClick={() => A.checkoutCommit(path, t.sha)}
                  onMenu={() => void tagMenu(path, t, { inLeftPanel: true })}>
                  <span className="lp-name">{hlText(t.short, marksOf(t.name, 0, t.short.length))}</span>
                </Row>
              )
            })}</div> : null}
            {handle('tags')}
          </div>
        ) : null}

        {shown('submodules') ? (
          <div className={secClass('submodules')} style={secStyle('submodules')}>
            {header('submodules', <button className="btn btn-success btn-small" title="Add a new submodule" onClick={() => A2.submoduleAddDialog(path)}><Icon name="plus" /></button>)}
            {isOpen('submodules') ? <div className="lp-body">{data.submodules.map((sm) => <SubmoduleRow key={sm.path} path={path} sm={sm} marks={marksOf('sm:' + sm.path, 0, sm.path.length)} />)}</div> : null}
            {handle('submodules')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RemoteRow({ path, remote, hidden, onEye, onToggle }: { path: string; remote: Remote; hidden: boolean; onEye: () => void; onToggle: () => void }) {
  const u = remote.fetchUrl
  const host = /dev\.azure\.com|visualstudio\.com/.test(u) ? 'ado' : /github/i.test(u) ? 'github' : /gitlab/i.test(u) ? 'gitlab' : /bitbucket/i.test(u) ? 'bitbucket' : null
  return (
    <Row depth={0} hidden={hidden} onEye={onEye} className="lp-remote" title={remote.fetchUrl}
      icon={host === 'ado' ? <span className="remote-avatar"><Icon name="ado" /></span> : <Icon name={host ?? 'globe'} />}
      onClick={onToggle} onMenu={() => void remoteMenu(path, remote)}>
      <span className="lp-name">{remote.name}</span>
    </Row>
  )
}

function WorktreeRow({ path, w, marks }: { path: string; w: Worktree; marks: Set<number> }) {
  const dirty = useStore((st) => { const t = st.repos[path]?.snapshot?.status; return !!t && (t.staged.length + t.unstaged.length) > 0 })
  // ahead / behind of the worktree's branch
  const branchRef = useStore((st) => (w.branch ? st.repos[path]?.snapshot?.refs.find((r) => r.type === 'head' && r.short === w.branch!.replace(/^refs\/heads\//, '')) : undefined))
  const folder = w.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return (
    <Row depth={0} current={w.isCurrent} noCheck className="lp-worktree" icon={<Icon name={w.isMain ? 'house-o' : 'tree-o'} />} title={w.path}
      onClick={() => w.sha && focusCommit(path, w.sha)}
      onDoubleClick={() => { if (!w.isCurrent) void openWorktree(path, w.path, true) }}
      onMenu={() => void worktreeMenu(path, w)}
      lead={w.locked ? <span className="lp-lock" title="Locked"><Icon name="lock" /></span> : null}
      right={<>
        <AheadBehind ahead={branchRef?.ahead} behind={branchRef?.behind} />
        {w.isCurrent && dirty ? <span className="lp-wip-dot" title="Uncommitted changes" /> : null}
      </>}>
      <Icon name="code-branch" className="lp-inline-icon" />
      <span className="lp-name">{hlText(w.branch ?? `${w.sha.slice(0, 7)} (detached)`, marks)}</span>
      <Icon name="folder" className="lp-inline-icon dim" />
      <span className="lp-sub">{folder}</span>
    </Row>
  )
}

function StashRow({ path, st, hidden, marks, picked }: { path: string; st: Stash; hidden: boolean; marks: Set<number>; picked: readonly string[] }) {
  const { msg, branch } = parseStash(st.message, true)
  return (
    <Row depth={0} hidden={hidden} onEye={() => A2.setHidden(path, [stashKey(st.sha)], !hidden)} icon={<Icon name="inbox-o" />} title={st.message}
      selected={picked.includes(stashKey(st.sha))}
      onClick={(e) => { if (e.ctrlKey || e.metaKey) { toggleSelection(path, stashKey(st.sha)); return } clearSelection(path); focusCommit(path, st.sha) }}
      onDoubleClick={() => A.stashApply(path, st.index)}
      onMenu={() => picked.length > 1 && picked.includes(stashKey(st.sha)) ? void multiStashMenu(path, A.snap(path).stashes.filter((x) => picked.includes(stashKey(x.sha)))) : void stashMenu(path, st)}>
      <span className="lp-name">{hlText(msg, marks)}{branch ? <span className="lp-on-branch">{`  on: ${branch}`}</span> : null}</span>
    </Row>
  )
}

function SubmoduleRow({ path, sm, marks }: { path: string; sm: Submodule; marks: Set<number> }) {
  const label = sm.state === '-' ? 'not initialized' : sm.state === '+' ? 'modified (different commit)' : sm.state === 'U' ? 'merge conflict' : sm.describe ?? ''
  return (
    <Row depth={0} title={`${sm.path}\n${sm.url ?? ''}\n${label}`}
      icon={<Icon name="folder-tree" className={sm.state === '+' ? 'color-orange' : sm.state === '-' ? 'dim' : sm.state === 'U' ? 'color-red' : ''} />}
      onDoubleClick={() => (sm.state === '-' ? A2.submoduleUpdate(path, sm.path) : A2.openSubmodule(path, sm.path))}
      onMenu={() => void submoduleMenu(path, sm)}>
      <span className="lp-name">{hlText(sm.path, marks)}</span>
      <span className="lp-sub">{sm.state === '-' ? 'not initialized' : sm.sha.slice(0, 7)}</span>
    </Row>
  )
}
