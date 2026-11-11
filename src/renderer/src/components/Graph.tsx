import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { RepoView } from '../store'
import { useStore, setState, updateRepo } from '../store'
import { searchEntry, queryParts, matchesQuery } from '../lib/commitSearch'
import { AuthorFilter } from './AuthorFilter'
import { api } from '../lib/api'
import * as A from '../actions'
import * as A2 from '../actions2'
import { commitMenu, wipMenu, stashMenu, refGroupMenu, graphHeaderMenu } from '../menus'
import { computeLayout, type Edge, type LayoutRow } from '../graph/layout'
import { laneColor, laneAlpha, laneMix } from '../graph/colors'
import { visibleCommits, refIsShown, highlightCommits, smartRefs } from '../graph/visibility'
import { avatarUrl } from '../lib/avatar'
import { relTime, fullDate, parseStash, stashKey } from '../lib/format'
import { Icon } from './Icon'
import { Resizer } from './Resizer'
import { refDragProps } from './LeftPanel'
import type { Commit, Ref, RepoSnapshot, Stash, CommitStat, GraphColumns } from '@shared/types'

const ROW = 28
const NONE: string[] = []
const PAD = 28

interface Geo { lane: number; pad: number; compact: boolean }
const laneX = (g: Geo, l: number) => g.pad + g.lane / 2 + l * g.lane

type GRow =
  | { kind: 'wip'; key: string }
  | { kind: 'commit'; key: string; commit: Commit }
  | { kind: 'stash'; key: string; commit: Commit; stash: Stash }

export interface RefGroup { key: string; label: string; local?: Ref; remotes: Ref[]; tag?: Ref; current: boolean; primary: Ref; refs: Ref[] }

function groupRefs(refs: Ref[]): Map<string, RefGroup[]> {
  const bySha = new Map<string, RefGroup[]>()
  const push = (sha: string, g: RefGroup) => { const l = bySha.get(sha) ?? []; l.push(g); bySha.set(sha, l) }
  const locals = refs.filter((r) => r.type === 'head')
  const remotes = refs.filter((r) => r.type === 'remote')
  const used = new Set<string>()
  for (const l of locals) {
    const upstreamShort = l.upstream?.replace(/^refs\/remotes\//, '')
    const same = remotes.filter((r) => r.sha === l.sha && (r.short === upstreamShort || r.short.slice((r.remote?.length ?? 0) + 1) === l.short))
    same.forEach((r) => used.add(r.name))
    push(l.sha, { key: l.name, label: l.short, local: l, remotes: same, current: !!l.isCurrent, primary: l, refs: [l, ...same] })
  }
  for (const r of remotes) {
    if (used.has(r.name)) continue
    push(r.sha, { key: r.name, label: r.short.slice((r.remote?.length ?? 0) + 1) || r.short, remotes: [r], current: false, primary: r, refs: [r] })
  }
  for (const t of refs.filter((r) => r.type === 'tag')) push(t.sha, { key: t.name, label: t.short, tag: t, remotes: [], current: false, primary: t, refs: [t] })
  for (const list of bySha.values()) {
    list.sort((a, b) => Number(b.current) - Number(a.current) || Number(!!b.local) - Number(!!a.local) || Number(!b.tag) - Number(!a.tag) || a.label.localeCompare(b.label))
  }
  return bySha
}

/** The commit body as GitKraken shows it beside the summary: one line, original lines separated by " | ". */
const bodyLine = (body: string) => body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' | ')

function stashCommit(st: Stash, parents: string[]): Commit {
  return { sha: st.sha, parents, author: st.author ?? '', email: st.email ?? '', date: st.date, commitDate: st.date, committer: '', committerEmail: '', summary: parseStash(st.message, true).msg, body: '', stashIndex: st.index }
}

function buildRows(s: RepoSnapshot, visible: Set<string> | null, showStashes: boolean, hidden: string[]): GRow[] {
  const rows: GRow[] = []
  const dirty = s.status.staged.length + s.status.unstaged.length + s.status.conflicted.length > 0 || s.status.state.kind !== 'none'
  if (dirty) rows.push({ kind: 'wip', key: '__wip__' })
  // a stash is drawn by date, above the commit it was made on; only when that commit is in the graph
  const known = new Set(s.commits.filter((c) => !visible || visible.has(c.sha)).map((c) => c.sha))
  const stashes = showStashes ? s.stashes.filter((st) => known.has(st.parents[0]) && !hidden.includes(stashKey(st.sha))).sort((a, b) => b.date - a.date) : []
  let si = 0
  for (const c of s.commits) {
    if (visible && !visible.has(c.sha)) continue
    while (si < stashes.length && stashes[si].date >= c.commitDate) {
      const st = stashes[si++]
      rows.push({ kind: 'stash', key: st.sha, stash: st, commit: stashCommit(st, st.parents.slice(0, 1)) })
    }
    rows.push({ kind: 'commit', key: c.sha, commit: c })
  }
  return rows
}

/** the optional columns right of the message, with their default widths */
const EXTRA_COLS = [
  { id: 'author', label: 'AUTHOR', width: 150 },
  { id: 'date', label: 'DATE / TIME', width: 140 },
  { id: 'sha', label: 'SHA', width: 76 },
  { id: 'changes', label: 'CHANGES', width: 110 }
] as const

interface PopState { index: number; groups: RefGroup[]; lane: number; x: number; y: number; width: number }

export function Graph({ repo }: { repo: RepoView }) {
  const s = repo.snapshot!
  const path = repo.path
  const layoutSettings = useStore((st) => st.settings!.layout)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 60 })
  const [hover, setHover] = useState<string | null>(null)
  const [hl, setHl] = useState<string[] | null>(null)
  const [pop, setPop] = useState<PopState | null>(null)
  const popTimer = useRef<number | null>(null)

  const settings = useStore((st) => st.settings!)
  // read inside stable hover callbacks
  const highlightOn = useRef(true)
  highlightOn.current = settings.highlightOnRefHover
  const hidden = settings.hiddenRefs?.[path] ?? NONE
  // hidden stashes live in the same list but are not branches
  const userSolo = settings.soloRefs?.[path] ?? NONE
  const smart = settings.smartVisibility?.[path] ?? settings.defaultSmartVisibility ?? false
  const show = settings.graphShow
  const cols = settings.graphColumns
  // columns can be reordered by dragging their headers, like the original
  const colOrder = useMemo(() => {
    const all = ['ref', 'graph', 'message', 'author', 'date', 'sha', 'changes']
    const saved = (settings.graphColumnOrder ?? []).filter((c) => all.includes(c))
    const list = [...saved, ...all.filter((c) => !saved.includes(c))]
    return Object.fromEntries(list.map((c, i) => [c, i])) as Record<string, number>
  }, [settings.graphColumnOrder])
  const [dragCol, setDragCol] = useState<string | null>(null)
  const dropCol = (target: string) => {
    if (!dragCol || dragCol === target) return
    const list = Object.keys(colOrder).sort((a, b) => colOrder[a] - colOrder[b]).filter((c) => c !== dragCol)
    list.splice(list.indexOf(target) + (colOrder[dragCol] < colOrder[target] ? 1 : 0), 0, dragCol)
    A2.saveSettings({ graphColumnOrder: list })
    setDragCol(null)
  }
  const headerCol = (id: string) => ({
    draggable: true,
    style: { order: colOrder[id] * 2 },
    onDragStart: (e: React.DragEvent) => { setDragCol(id); e.dataTransfer.effectAllowed = 'move' },
    onDragOver: (e: React.DragEvent) => { if (dragCol) e.preventDefault() },
    onDrop: () => dropCol(id),
    onDragEnd: () => setDragCol(null)
  })
  const authorFilter = repo.authorFilter ?? NONE
  const [filterOpen, setFilterOpen] = useState(false)
  const baseGeo: Geo = settings.compactGraph ? { lane: 14, pad: 14, compact: true } : { lane: 22, pad: PAD, compact: false }
  const pinnedName = settings.pinnedRefs?.[path]
  const solo = useMemo(() => (userSolo.length ? userSolo : smart ? smartRefs(s.refs) : NONE), [userSolo, smart, s.refs])
  const stashBases = useMemo(() => (show.stashes ? s.stashes.filter((st) => !hidden.includes(stashKey(st.sha))).map((st) => st.parents[0]).filter(Boolean) : NONE), [s.stashes, hidden, show.stashes])
  const visOpts = useMemo(() => ({ hidden, solo, showRemotes: show.remotes, showTags: show.tags, headSha: s.head.sha, stashBases }), [hidden, solo, show.remotes, show.tags, s.head.sha, stashBases])
  const visibleSet = useMemo(() => visibleCommits(s.commits, s.refs, visOpts), [s.commits, s.refs, visOpts])
  const rows = useMemo(() => buildRows(s, visibleSet, show.stashes, hidden), [s, visibleSet, show.stashes, hidden])
  useEffect(() => { if (cols.changes) void A2.loadStats(path) }, [cols.changes, s, path])
  const pinnedTip = useMemo(() => s.refs.find((r) => r.name === pinnedName)?.sha ?? null, [s.refs, pinnedName])
  const layout = useMemo(() => {
    const dashedRows = new Set<number>()
    rows.forEach((r, i) => { if (r.kind !== 'commit') dashedRows.add(i) })
    return computeLayout(rows.map((r) => (r.kind === 'wip' ? { sha: '__wip__', parents: s.head.sha ? [s.head.sha] : [] } : r.commit)), { dashedRows, pinnedTip })
  }, [rows, s.head.sha, pinnedTip])
  const refsBySha = useMemo(() => groupRefs(s.refs.filter((r) => refIsShown(r, visOpts))), [s.refs, visOpts])
  // the ghost label of a commit without labels: like the original, the branch at the top of its lane
  // (following the first-parent child drawn in the same lane), or nothing when that lane ends unlabeled
  const childInLane = useMemo(() => {
    const m = new Map<number, number>()
    const firstChild = new Map<string, number[]>()
    rows.forEach((r, j) => { if (r.kind === 'commit' && r.commit.parents[0]) { const l = firstChild.get(r.commit.parents[0]) ?? []; l.push(j); firstChild.set(r.commit.parents[0], l) } })
    rows.forEach((r, i) => {
      if (r.kind !== 'commit') return
      const j = (firstChild.get(r.commit.sha) ?? []).filter((k) => k < i && layout.rows[k]?.lane === layout.rows[i]?.lane).pop()
      if (j !== undefined) m.set(i, j)
    })
    return m
  }, [rows, layout])
  const ghostFor = (i: number) => {
    let cur = i
    for (let n = 0; n < rows.length; n++) {
      const next = childInLane.get(cur)
      if (next === undefined) return null
      cur = next
      const row = rows[cur]
      const groups = row.kind === 'commit' ? refsBySha.get(row.commit.sha) : undefined
      const g = groups?.find((x) => x.local || x.remotes.length)
      if (g) return { g, more: groups!.length - 1 }
      if (groups?.length) return null
    }
    return null
  }
  const order = useMemo(() => rows.map((r) => r.key), [rows])
  const indexOf = useMemo(() => new Map(order.map((k, i) => [k, i])), [order])
  const hlSet = useMemo(() => (hl ? highlightCommits(s.commits, s.refs, hl) : null), [hl, s.commits, s.refs])

  const refW = layoutSettings.refColWidth
  const topLanes = useMemo(() => layout.rows.slice(0, 150).reduce((m, r) => Math.max(m, r.width), 1), [layout])
  const autoGraphW = Math.max(baseGeo.compact ? 50 : 100, Math.min(320, baseGeo.pad + baseGeo.lane * topLanes + 16))
  const graphW = layoutSettings.graphColWidth > 0 && !baseGeo.compact ? layoutSettings.graphColWidth : autoGraphW
  const geo: Geo = useMemo(() => {
    const lanes = Math.max(1, layout.maxLanes)
    const need = baseGeo.pad + baseGeo.lane * (lanes - 1) + 14
    if (need <= graphW || lanes < 2) return baseGeo
    return { ...baseGeo, lane: Math.max(3, (graphW - baseGeo.pad - 14) / (lanes - 1)) }
  }, [baseGeo.lane, baseGeo.pad, baseGeo.compact, graphW, layout.maxLanes]) // eslint-disable-line react-hooks/exhaustive-deps

  const setCol = (patch: Partial<typeof layoutSettings>) => setState((st) => ({ settings: { ...st.settings!, layout: { ...st.settings!.layout, ...patch } } }))
  const persist = () => { void api.setSettings({ layout: useStore.getState().settings!.layout }) }

  const loadingMore = useRef(false)
  useEffect(() => {
    if (!s.hasMore || loadingMore.current || range.end < rows.length - 40) return
    loadingMore.current = true
    void A.loadMore(path).finally(() => { loadingMore.current = false })
  }, [range.end, rows.length, s.hasMore, path])

  const updateRange = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const start = Math.max(0, Math.floor(el.scrollTop / ROW) - 15)
    const end = Math.min(rows.length, Math.ceil((el.scrollTop + el.clientHeight) / ROW) + 15)
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }))
  }, [rows.length])
  useLayoutEffect(() => { updateRange() }, [updateRange])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(updateRange)
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateRange])

  const scrollToIndex = useCallback((i: number, center = false) => {
    const el = scrollRef.current
    if (!el || i < 0) return
    const top = i * ROW
    if (center) el.scrollTop = top - el.clientHeight / 2 + ROW
    else if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
  }, [])

  useEffect(() => {
    if (!repo.focus) return
    const i = indexOf.get(repo.focus.sha)
    if (i === undefined) { if (s.hasMore) void A.loadMore(path); return }
    scrollToIndex(i, true)
  }, [repo.focus, indexOf, scrollToIndex, s.hasMore, path])

  // search
  const search = repo.search
  const hitSet = useMemo(() => new Set(search.hits), [search.hits])
  useEffect(() => {
    if (!search.open) return
    const q = search.query.trim()
    if (!q) { updateRepo(path, (r) => ({ search: { ...r.search, hits: [], index: 0 } })); return }
    const t = setTimeout(() => {
      const parts = queryParts(q)
      const hits = rows.filter((r) => r.kind !== 'wip' && (!authorFilter.length || authorFilter.includes(r.commit.email.toLowerCase())) && matchesQuery(searchEntry(r.commit), parts)).map((r) => r.key)
      updateRepo(path, (r) => ({ search: { ...r.search, hits, index: 0 } }))
      if (hits[0]) { A.selectCommit(path, hits[0]); scrollToIndex(indexOf.get(hits[0]) ?? -1, true) }
    }, 200)
    return () => clearTimeout(t)
  }, [search.query, search.open, rows, authorFilter, path, indexOf, scrollToIndex])

  const gotoHit = (delta: number) => {
    if (!search.hits.length) return
    const index = (search.index + delta + search.hits.length) % search.hits.length
    updateRepo(path, (r) => ({ search: { ...r.search, index } }))
    const sha = search.hits[index]
    A.selectCommit(path, sha)
    scrollToIndex(indexOf.get(sha) ?? -1, true)
  }

  const sel = repo.selection
  const selected = useMemo(() => new Set(sel?.kind === 'commits' ? sel.shas : sel?.kind === 'wip' ? ['__wip__'] : sel?.kind === 'compare' ? [sel.a, sel.b ?? '__wip__'] : []), [sel])

  // keyboard, like the original: ↑/↓ or K/J move, Shift moves along the branch (first parent / child),
  // Ctrl+Home / Ctrl+End jump to the first / last row
  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key.toLowerCase()
    const down = e.key === 'ArrowDown' || k === 'j'
    const up = e.key === 'ArrowUp' || k === 'k'
    const home = e.ctrlKey && e.key === 'Home'
    const end = e.ctrlKey && e.key === 'End'
    if (!down && !up && !home && !end) return
    if (e.altKey || (e.ctrlKey && (down || up))) return
    e.preventDefault()
    const curKey = sel?.kind === 'wip' ? '__wip__' : sel?.kind === 'commits' ? sel.anchor : order[0]
    const cur = indexOf.get(curKey) ?? -1
    let i: number
    if (home) i = 0
    else if (end) i = order.length - 1
    else if (e.shiftKey && curKey !== '__wip__') {
      const commit = s.commits.find((c) => c.sha === curKey)
      const next = down ? commit?.parents[0] : s.commits.find((c) => c.parents[0] === curKey)?.sha
      i = next !== undefined && indexOf.has(next) ? indexOf.get(next)! : cur
    } else i = Math.max(0, Math.min(order.length - 1, cur + (down ? 1 : -1)))
    const key = order[i]
    if (key === '__wip__') A.selectWip(path)
    else A.selectCommit(path, key, {}, order)
    scrollToIndex(i)
  }

  const maxChanges = useMemo(() => {
    if (!repo.stats) return 1
    let m = 1
    for (const st of Object.values(repo.stats)) m = Math.max(m, st.additions + st.deletions)
    return Math.min(m, 2000)
  }, [repo.stats])

  // ---- label hover: highlight + popover listing every ref of the commit
  const cancelPopClose = () => { if (popTimer.current) { window.clearTimeout(popTimer.current); popTimer.current = null } }
  const schedulePopClose = () => {
    cancelPopClose()
    popTimer.current = window.setTimeout(() => { setPop(null); setHl(null) }, 120)
  }
  const onLabelsEnter = useCallback((index: number, groups: RefGroup[], lane: number, el: HTMLElement, hoveredGroup: RefGroup | null, truncated: boolean) => {
    cancelPopClose()
    if (hoveredGroup && !hoveredGroup.tag && highlightOn.current) setHl(hoveredGroup.refs.map((r) => r.name))
    if (groups.length > 1 || truncated) {
      const cell = el.closest('.ref-zone') as HTMLElement
      const r = cell.getBoundingClientRect()
      setPop({ index, groups, lane, x: r.left, y: r.top + 3, width: r.width })
    } else setPop(null)
  }, [])
  const onLabelsLeave = useCallback(() => schedulePopClose(), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelPopClose(), [])

  const resetWidths = () => { setCol({ graphColWidth: 0, refColWidth: 150, colWidths: {} }); persist() }
  const colW = (id: string) => layoutSettings.colWidths?.[id] ?? EXTRA_COLS.find((c) => c.id === id)?.width ?? 120
  const resizeCol = (id: string, dx: number) => {
    const l = useStore.getState().settings!.layout
    if (id === 'ref') setCol({ refColWidth: Math.max(60, Math.min(500, l.refColWidth + dx)) })
    else if (id === 'graph') setCol({ graphColWidth: Math.max(60, Math.min(800, (l.graphColWidth || autoGraphW) + dx)) })
    else setCol({ colWidths: { ...(l.colWidths ?? {}), [id]: Math.max(48, Math.min(600, (l.colWidths?.[id] ?? EXTRA_COLS.find((c) => c.id === id)!.width) + dx)) } })
  }

  const visible: ReactNode[] = []
  let prevBucket = ''
  for (let i = Math.max(0, range.start - 1); i < range.end && i < rows.length; i++) {
    const r = rows[i]
    const bucket = r.kind === 'wip' ? '' : relTime(r.commit.commitDate)
    // GitKraken marks the first row of each new age bucket, never the newest commit (the row after WIP included)
    const showDate = i >= range.start && prevBucket !== '' && bucket !== '' && bucket !== prevBucket
    prevBucket = bucket
    if (i < range.start) continue
    visible.push(
      <GraphRow
        key={r.key}
        path={path}
        row={r}
        index={i}
        lrow={layout.rows[i]}
        geo={geo}
        refs={r.kind === 'commit' ? refsBySha.get(r.commit.sha) : undefined}
        ghost={settings.ghostRefs && r.kind === 'commit' && !refsBySha.get(r.commit.sha)?.length && (hover === r.key || selected.has(r.key)) ? ghostFor(i) : null}
        showBody={settings.commitDescription === 'always' || (settings.commitDescription === 'hover' && (hover === r.key || selected.has(r.key)))}
        refW={refW}
        graphW={graphW}
        selected={selected.has(r.key)}
        hovered={hover === r.key}
        dimmed={(search.open && search.hits.length > 0 && !hitSet.has(r.key)) || (!!hlSet && r.kind !== 'wip' && !hlSet.has(r.key)) || (authorFilter.length > 0 && r.kind !== 'wip' && !authorFilter.includes(r.commit.email.toLowerCase()))}
        colOrder={colOrder}
        colWidths={layoutSettings.colWidths}
        dateLabel={showDate ? bucket : null}
        newRef={repo.newRef && r.kind !== 'wip' && repo.newRef.sha === r.commit.sha ? repo.newRef.kind : null}
        wip={r.kind === 'wip' ? s.status : null}
        wipSummary={r.kind === 'wip' ? repo.wip.summary : ''}
        order={order}
        onHover={setHover}
        cols={cols}
        stat={repo.stats?.[r.key]}
        maxChanges={maxChanges}
        onLabelsEnter={onLabelsEnter}
        onLabelsLeave={onLabelsLeave}
      />
    )
  }

  return (
    <div className={`graph-component${hlSet ? ' graph-highlighted' : ''}`}>
      {search.open ? (
        <div className="graph-search"><div className="graph-search-inner">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="find commit"
            value={search.query}
            onChange={(e) => updateRepo(path, (rv) => ({ search: { ...rv.search, query: e.target.value } }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') gotoHit(e.shiftKey ? -1 : 1)
              else if (e.key === 'Escape') updateRepo(path, { search: { open: false, query: '', hits: [], index: 0 } })
            }}
          />
          <span className="graph-search-count">{search.hits.length ? `${search.index + 1} of ${search.hits.length}` : '0 results'}</span>
          <span className="graph-search-btn" title="Previous" onClick={() => gotoHit(-1)}><Icon name="arrow-up" /></span>
          <span className="graph-search-btn" title="Next" onClick={() => gotoHit(1)}><Icon name="arrow-down" /></span>
          <span className="graph-search-btn" title="Close" onClick={() => updateRepo(path, { search: { open: false, query: '', hits: [], index: 0 } })}><Icon name="times" /></span>
        </div></div>
      ) : null}
      <div className="graph-header" onContextMenu={(e) => { e.preventDefault(); void graphHeaderMenu(path, resetWidths) }}>
        {cols.ref ? <div className={`graph-header-col${dragCol === 'ref' ? ' dragging' : ''}`} {...headerCol('ref')} style={{ width: refW, order: colOrder.ref * 2 }}>BRANCH / TAG</div> : null}
        {cols.graph ? <div className={`graph-header-col${dragCol === 'graph' ? ' dragging' : ''}`} {...headerCol('graph')} style={{ width: graphW, order: colOrder.graph * 2 }}>GRAPH</div> : null}
        {cols.message ? <div className="graph-header-col grow" {...headerCol('message')}>COMMIT MESSAGE</div> : <div className="graph-header-col grow" style={{ order: colOrder.message * 2 }} />}
        {EXTRA_COLS.filter((c) => cols[c.id]).map((c) => (
          <div key={c.id} className={`graph-header-col extra-col col-${c.id}${dragCol === c.id ? ' dragging' : ''}`} {...headerCol(c.id)} style={{ width: colW(c.id), order: colOrder[c.id] * 2 }}>{c.label}</div>
        ))}
        {/* every fixed-width column can be resized: on its right edge left of the message column, on its left edge right of it */}
        {(['ref', 'graph', ...EXTRA_COLS.map((c) => c.id)] as const).filter((id) => cols[id]).map((id) => {
          const before = colOrder[id] < colOrder.message
          return <Resizer key={`rz-${id}`} className="col-resizer" style={{ order: colOrder[id] * 2 + (before ? 1 : -1) }} onDrag={(dx) => resizeCol(id, before ? dx : -dx)} onEnd={persist} />
        })}
        <span className="graph-header-icons" draggable={false} onMouseDown={(e) => e.stopPropagation()} onDragStart={(e) => { e.preventDefault(); e.stopPropagation() }}>
          <span className="graph-header-gear" title="Columns settings" onClick={() => graphHeaderMenu(path, resetWidths)}><Icon name="cog" /></span>
          {cols.author ? <span className={`graph-header-filter${authorFilter.length ? ' active' : ''}`} title="Filter the graph by author" onClick={() => setFilterOpen((v) => !v)}><Icon name="filter" /></span> : null}
        </span>
      </div>
      {filterOpen ? <AuthorFilter repo={repo} onClose={() => setFilterOpen(false)} /> : null}
      {/* hidden / soloed branches are reported in the left panel ("Viewing 9/10 · Show All"), like the original */}
      {smart && !userSolo.length ? (
        <div className="graph-filter-bar">
          <Icon name="eye-slash" />
          <span>Smart Branch Visibility is on</span>
          <span className="btn-link" onClick={() => { A2.clearVisibility(path); if (smart) A2.saveSettings({ smartVisibility: { ...settings.smartVisibility, [path]: false } }) }}>Show all</span>
        </div>
      ) : null}
      <div className={`graph-scroll${cols.ref ? '' : ' no-ref-col'}${cols.graph ? '' : ' no-graph-col'}${cols.message ? '' : ' no-message-col'}`} ref={scrollRef} tabIndex={0} onScroll={() => { updateRange(); setPop(null) }} onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)}>
        <div className="graph-inner" style={{ height: rows.length * ROW + (s.hasMore ? 40 : 0) }}>
          {visible}
          {s.hasMore ? (
            <div className="graph-load-more" style={{ top: rows.length * ROW }}>
              <span className="text-secondary">Loading more commits…</span>
            </div>
          ) : null}
        </div>
        {!rows.length ? <div className="graph-empty">This repository has no commits yet. Stage files and make the first commit.</div> : null}
      </div>
      {pop ? createPortal(
        <ul className="ref-popover-list" style={{ left: pop.x, top: pop.y, minWidth: pop.width }}
          onMouseEnter={cancelPopClose} onMouseLeave={schedulePopClose}>
          {pop.groups.map((g) => (
            <li key={g.key} onMouseEnter={() => { if (!g.tag && highlightOn.current) setHl(g.refs.map((r) => r.name)) }}>
              <RefLabel path={path} g={g} lane={pop.lane} bright={g.current} full />
            </li>
          ))}
        </ul>, document.body) : null}
    </div>
  )
}

interface RowProps {
  path: string
  row: GRow
  index: number
  lrow: LayoutRow
  geo: Geo
  refs?: RefGroup[]
  ghost: { g: RefGroup; more: number } | null
  showBody: boolean
  refW: number
  graphW: number
  selected: boolean
  hovered: boolean
  dimmed: boolean
  dateLabel: string | null
  colOrder: Record<string, number>
  colWidths?: Record<string, number>
  newRef: 'branch' | 'tag' | 'annotated-tag' | null
  wip: RepoSnapshot['status'] | null
  wipSummary: string
  order: string[]
  onHover: (k: string | null) => void
  cols: GraphColumns
  stat?: CommitStat
  maxChanges: number
  onLabelsEnter: (index: number, groups: RefGroup[], lane: number, el: HTMLElement, hovered: RefGroup | null, truncated: boolean) => void
  onLabelsLeave: () => void
}

const GraphRow = memo(function GraphRow(p: RowProps) {
  const { row, lrow, path, geo } = p
  const lane = lrow.lane
  const color = laneColor(lane)
  const nodeX = laneX(geo, lane)
  const hasRefs = !!p.refs?.length
  const isCurrent = !!p.refs?.some((g) => g.current)

  const onClick = (e: React.MouseEvent) => {
    if (e.detail === 1 && A.repoView(path).detailHidden) updateRepo(path, { detailHidden: false })
    if (row.kind === 'wip') A.selectWip(path)
    else A.selectCommit(path, row.key, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, p.order)
  }
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault()
    if (row.kind === 'wip') { A.selectWip(path); void wipMenu(path); return }
    if (!p.selected) A.selectCommit(path, row.key)
    if (row.kind === 'stash') { void stashMenu(path, row.stash); return }
    // like the original: a row carrying a branch label opens that branch's menu (tags alone keep the commit menu)
    const sel = A.repoView(path).selection
    const multi = sel?.kind === 'commits' && sel.shas.length > 1 && sel.shas.includes(row.key)
    const branchGroup = p.refs?.find((g) => g.local || g.remotes.length)
    if (branchGroup && !multi) void refGroupMenu(path, branchGroup.refs)
    else void commitMenu(path, row.commit)
  }

  return (
    <div
      className={`graph-row${p.selected ? ' selected' : ''}${p.hovered ? ' hovered' : ''}${p.dimmed ? ' dimmed-row' : ''}${row.kind === 'stash' ? ' stash-row' : ''}${p.dateLabel ? ' time-line' : ''}`}
      style={{ top: p.index * ROW }}
      data-sha={row.kind === 'wip' ? undefined : row.commit.sha}
      onClick={onClick}
      onDoubleClick={() => { if (row.kind === 'commit') updateRepo(path, { detailHidden: true }) }}
      onContextMenu={onContext}
      onMouseEnter={() => p.onHover(row.key)}
    >
      {p.cols.ref ? (
        <div className="ref-zone" style={{ width: p.refW, order: p.colOrder.ref }}>
          {p.newRef ? <NewRefInput path={path} kind={p.newRef} /> : hasRefs ? (
            <RefLabels path={path} groups={p.refs!} lane={lane} width={p.refW} rowSelected={p.selected} index={p.index} onEnter={p.onLabelsEnter} onLeave={p.onLabelsLeave} />
          ) : p.ghost ? (
            <div className="ref-labels dim-labels" style={{ maxWidth: p.refW - 6 }}>
              <RefLabel path={path} g={p.ghost.g} lane={lane} bright={false} ghost />
              {p.ghost.more > 0 ? <span className="ref-more" style={{ background: laneMix(lane, 0.25) }}>+{p.ghost.more}</span> : null}
            </div>
          ) : null}
          {hasRefs || p.newRef || p.ghost ? <div className={`ref-line${isCurrent ? ' is-active' : ''}${p.ghost && !hasRefs ? ' ghost' : ''}`} style={{ background: color, left: 2 }} /> : null}
        </div>
      ) : null}
      {p.cols.graph ? (
        <div className="commit-zone" style={{ width: p.graphW, order: p.colOrder.graph }}>
          {hasRefs || p.newRef || (p.ghost && p.cols.ref) ? <div className={`ref-line${isCurrent ? ' is-active' : ''}${p.ghost && !hasRefs ? ' ghost' : ''}`} style={{ background: color, left: 0, width: Math.max(0, nodeX - (geo.compact ? 6 : 11)) }} /> : null}
          <div className="commit-bg" style={{ left: nodeX, background: laneAlpha(lane, p.selected ? 0.5 : p.hovered ? 0.2 : 0.1) }} />
          <Edges edges={lrow.edges} node={lane} width={p.graphW} geo={geo} />
          <Node row={row} lane={lane} x={nodeX} compact={geo.compact} />
        </div>
      ) : null}
      <div className="message-zone" style={{ order: p.colOrder.message }}>
        <div className="color-strip" style={{ background: color }} />
        {p.cols.message ? (row.kind === 'wip' ? <WipMessage path={path} wip={p.wip!} summary={p.wipSummary} /> : (
          <span className="message-text">
            <span className="message-summary">{row.commit.summary}</span>
            {row.commit.body && p.showBody ? <span className="message-body">{bodyLine(row.commit.body)}</span> : null}
          </span>
        )) : null}
        {p.dateLabel ? <span className="date-label">{p.dateLabel}</span> : null}
      </div>
      {p.cols.author ? <div className="extra-col col-author" style={{ order: p.colOrder.author, width: p.colWidths?.author }}>{row.kind === 'commit' ? <span className="truncate">{row.commit.author}</span> : null}</div> : null}
      {p.cols.date ? <div className="extra-col col-date" style={{ order: p.colOrder.date, width: p.colWidths?.date }}>{row.kind !== 'wip' ? fullDate(row.commit.date) : ''}</div> : null}
      {p.cols.sha ? <div className="extra-col col-sha" style={{ order: p.colOrder.sha, width: p.colWidths?.sha }}>{row.kind === 'commit' ? row.commit.sha.slice(0, 7) : ''}</div> : null}
      {p.cols.changes ? <div className="extra-col col-changes" style={{ order: p.colOrder.changes, width: p.colWidths?.changes }}>{p.stat ? <ChangesBar stat={p.stat} max={p.maxChanges} /> : null}</div> : null}
    </div>
  )
})

function ChangesBar({ stat, max }: { stat: CommitStat; max: number }) {
  const total = stat.additions + stat.deletions
  const w = total ? Math.max(4, Math.round((Math.min(total, max) / max) * 60)) : 0
  const addW = total ? Math.round((stat.additions / total) * w) : 0
  return (
    <span className="changes-cell" title={`${stat.files} file(s), +${stat.additions} −${stat.deletions}`}>
      <span className="changes-bar"><span className="changes-add" style={{ width: addW }} /><span className="changes-del" style={{ width: w - addW }} /></span>
      <span className="changes-num">{stat.files}</span>
    </span>
  )
}

function Edges({ edges, node, width, geo }: { edges: Edge[]; node: number; width: number; geo: Geo }) {
  const nx = laneX(geo, node)
  const r = Math.min(geo.compact ? 5 : 8, Math.max(2, geo.lane / 2))
  return (
    <svg className="edges" width={width} height={ROW}>
      {edges.map((e, i) => {
        const dash = e.dashed ? '2' : undefined
        if (e.t === 'v') {
          const x = laneX(geo, e.lane)
          return <line key={i} x1={x} x2={x} y1={e.from * ROW} y2={e.to * ROW} stroke={laneColor(e.lane)} strokeWidth={2} strokeDasharray={dash} />
        }
        const lx = laneX(geo, e.lane)
        const right = e.lane > node
        const h = right ? lx - r : lx + r
        let d: string
        if (e.t === 'in') d = `M ${nx} 14 H ${h} A ${r} ${r} 0 0 ${right ? 0 : 1} ${lx} ${14 - r} V 0`
        else d = `M ${nx} 14 H ${h} A ${r} ${r} 0 0 ${right ? 1 : 0} ${lx} ${14 + r} V ${ROW}`
        return <path key={i} d={d} fill="none" stroke={laneColor(e.lane)} strokeWidth={2} strokeDasharray={dash} strokeLinejoin="round" />
      })}
    </svg>
  )
}

function Node({ row, lane, x, compact }: { row: GRow; lane: number; x: number; compact: boolean }) {
  const color = laneColor(lane)
  if (row.kind === 'wip') {
    const sz = compact ? 16 : 26
    return (
      <svg className="node wip-node" style={{ left: x - sz / 2, top: 14 - sz / 2 }} width={sz} height={sz} viewBox="0 0 26 26">
        <circle cx="13" cy="13" r="10" fill="var(--app__bg0)" stroke={color} strokeWidth={2} strokeDasharray="2 3" strokeLinecap="round" />
      </svg>
    )
  }
  if (row.kind === 'stash') {
    return <div className="node stash-node" style={{ left: x - 10, top: 4, borderColor: color, color }}><Icon name="stash-tray" /></div>
  }
  const c = row.commit
  if (compact || c.parents.length > 1) return <div className="node merge-node" style={{ left: x - 6, top: 8, background: color }} />
  return <div className="node avatar-node" title={`${c.author} <${c.email}>`} style={{ left: x - 11, top: 3, borderColor: color, backgroundImage: `url(${avatarUrl(c.email, c.author)})` }} />
}

function RefLabels({ path, groups, lane, width, rowSelected, index, onEnter, onLeave }: { path: string; groups: RefGroup[]; lane: number; width: number; rowSelected: boolean; index: number; onEnter: RowProps['onLabelsEnter']; onLeave: () => void }) {
  const first = groups[0]
  const rest = groups.length - 1
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      className="ref-labels"
      style={{ maxWidth: width - 6 }}
      onMouseEnter={(e) => {
        const lbl = ref.current?.querySelector('.ref-name') as HTMLElement | null
        const truncated = !!lbl && lbl.scrollWidth > lbl.clientWidth + 1
        onEnter(index, groups, lane, e.currentTarget, first, truncated)
      }}
      onMouseLeave={onLeave}
    >
      <RefLabel path={path} g={first} lane={lane} bright={first.current || rowSelected} />
      {rest > 0 ? <span className="ref-more" style={{ background: laneMix(lane, 0.25) }}>+{rest}</span> : null}
    </div>
  )
}

function RefLabel({ path, g, lane, bright, full, ghost }: { path: string; g: RefGroup; lane: number; bright: boolean; full?: boolean; ghost?: boolean }) {
  const ref = g.local ?? g.primary
  // like the original: a branch checked out in another worktree shows the worktree icon instead of the laptop
  const inWorktree = !!g.local && !g.current && !!A.snap(path)?.worktrees.some((w) => !w.isCurrent && w.branch === g.local!.short)
  return (
    <span
      className={`ref-node${g.current ? ' is-active' : ''}${full ? ' full' : ''}${ghost ? ' dim-ref' : ''}`}
      style={{ ['--rl-bg' as string]: laneMix(lane, bright ? 0.5 : 0.25), ['--rl-bg-hover' as string]: laneMix(lane, bright ? 0.5 : 0.45) }}
      onClick={(e) => { if (ghost) return; e.stopPropagation(); A.selectCommit(path, ref.sha) }}
      onDoubleClick={(e) => { if (ghost) return; e.stopPropagation(); void A.checkoutRef(path, ref) }}
      onContextMenu={(e) => { if (ghost) return; e.preventDefault(); e.stopPropagation(); A.selectCommit(path, ref.sha); void refGroupMenu(path, g.refs) }}
      {...(g.tag || ghost ? {} : refDragProps(path, ref))}
    >
      {g.current ? <span className="ref-icon"><Icon name="check" className="ref-check" /></span> : null}
      <span className="ref-name">{g.label}</span>
      <span className="ref-icons">
        {g.local ? <Icon name={inWorktree ? 'tree-o' : 'laptop-o'} /> : null}
        {g.remotes.length ? <Icon name="cloud-o" /> : null}
        {g.tag ? <Icon name="tag-o" /> : null}
      </span>

    </span>
  )
}

function NewRefInput({ path, kind }: { path: string; kind: string }) {
  const [v, setV] = useState('')
  const done = useRef(false)
  return (
    <input
      className="new-ref-input"
      autoFocus
      placeholder={kind === 'branch' ? 'enter branch name' : 'enter tag name'}
      value={v}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value.replace(/\s/g, '-'))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { done.current = true; void A.submitNewRef(path, v) }
        else if (e.key === 'Escape') { done.current = true; updateRepo(path, { newRef: null }) }
      }}
      onBlur={() => { if (!done.current) updateRepo(path, { newRef: null }) }}
    />
  )
}

function WipMessage({ path, wip, summary }: { path: string; wip: RepoSnapshot['status']; summary: string }) {
  if (wip.conflicted.length && wip.state.kind !== 'none') {
    const verb = wip.state.kind === 'merge' ? 'merge into' : wip.state.kind === 'rebase' ? 'rebase' : wip.state.kind === 'cherry-pick' ? 'cherry pick onto' : wip.state.kind === 'am' ? 'apply a patch onto' : 'revert on'
    return (
      <div className="wip-conflict-banner">
        <Icon name="warning" /> A file conflict was found when attempting to {verb} {wip.state.ours ?? 'HEAD'}
      </div>
    )
  }
  const all = [...wip.staged, ...wip.unstaged]
  const uniq = new Map(all.map((f) => [f.path, f.status]))
  let mod = 0, add = 0, del = 0
  for (const st of uniq.values()) { if (st === 'A' || st === '?') add++; else if (st === 'D') del++; else mod++ }
  const conflicts = wip.conflicted.length
  return (
    <div className="work-dir-row">
      <input
        className="work-dir-input"
        placeholder="// WIP"
        value={summary}
        style={{ width: Math.max(105, Math.min(400, summary.length * 7 + 26)) }}
        onClick={(e) => { e.stopPropagation(); A.selectWip(path) }}
        onChange={(e) => updateRepo(path, (r) => ({ wip: { ...r.wip, summary: e.target.value } }))}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void A.commit(path) }}
      />
      <span className="tiny-files-readout">
        {conflicts ? <span className="color-red"><Icon name="warning" /> {conflicts}</span> : null}
        {mod ? <span><Icon name="pencil" className="color-orange" /> {mod}</span> : null}
        {add ? <span><Icon name="plus" className="color-green" /> {add}</span> : null}
        {del ? <span><Icon name="minus" className="color-red" /> {del}</span> : null}
      </span>
    </div>
  )
}
