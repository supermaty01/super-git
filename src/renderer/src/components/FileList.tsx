import { useMemo, useState, type ReactNode } from 'react'
import type { FileChange } from '@shared/types'
import { Icon } from './Icon'
import { buildDirs, displayOrder, sortDirs, sortFiles, type Dir } from '../lib/wipStatus'

export const STATUS_ICON: Record<string, { icon: string; cls: string; label: string }> = {
  M: { icon: 'pencil', cls: 'color-orange', label: 'modified' },
  T: { icon: 'pencil', cls: 'color-orange', label: 'type changed' },
  A: { icon: 'plus', cls: 'color-green', label: 'added' },
  '?': { icon: 'plus', cls: 'color-green', label: 'added' },
  D: { icon: 'minus', cls: 'color-red', label: 'deleted' },
  R: { icon: 'file', cls: 'color-blue', label: 'renamed' },
  C: { icon: 'copy', cls: 'color-blue', label: 'copied' },
  U: { icon: 'warning', cls: 'color-orange', label: 'conflicted' },
  N: { icon: 'file', cls: 'text-disabled', label: 'unchanged' }
}

export function StatusIcon({ status }: { status: string }) {
  const s = STATUS_ICON[status] ?? STATUS_ICON.M
  return <Icon name={s.icon} className={`file-status ${s.cls}`} title={s.label} />
}

export function summarizeFiles(files: FileChange[]): Array<{ status: string; count: number }> {
  const order = ['M', 'A', 'D', 'R']
  const map = new Map<string, number>()
  for (const f of files) {
    if (f.status === 'N') continue
    const k = f.status === '?' ? 'A' : f.status === 'T' ? 'M' : f.status === 'C' ? 'A' : f.status
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return order.filter((k) => map.has(k)).map((k) => ({ status: k, count: map.get(k)! }))
}

function allFilesOf(d: Dir): FileChange[] { return [...d.files, ...d.dirs.flatMap(allFilesOf)] }

interface Props {
  files: FileChange[]
  mode: 'path' | 'tree'
  sortDesc?: boolean
  activePath?: string | null
  selected?: string[]
  onOpen: (f: FileChange) => void
  /** clicking the open row again: like the original, its diff closes */
  onClose?: () => void
  onContext?: (f: FileChange) => void
  /** tree mode: right-click on a folder row, with every changed file below it */
  onDirContext?: (dir: string, files: FileChange[]) => void
  onSelect?: (paths: string[]) => void
  rowAction?: (f: FileChange) => ReactNode
  /** tree mode: folders start closed */
  collapsed?: boolean
}

export function FileList({ files, mode, sortDesc, activePath, selected = [], onOpen, onClose, onContext, onSelect, onDirContext, rowAction, collapsed }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  // tree mode, like the original: folders start closed; "Expand All" / "Collapse All" reset every folder
  const [allOpen, setAllOpen] = useState(!(collapsed ?? true))
  const [anchor, setAnchor] = useState<string | null>(null)
  const sorted = useMemo(() => sortFiles(files, sortDesc), [files, sortDesc])
  const isClosed = (dir: string) => closed[dir] ?? !allOpen

  const open = (f: FileChange) => {
    setAnchor(f.path)
    onSelect?.([f.path])
    onOpen(f)
  }

  const click = (f: FileChange, e: React.MouseEvent) => {
    if (onSelect && (e.ctrlKey || e.metaKey)) {
      onSelect(selected.includes(f.path) ? selected.filter((p) => p !== f.path) : [...selected, f.path])
      setAnchor(f.path)
      return
    }
    if (onSelect && e.shiftKey && anchor) {
      const a = sorted.findIndex((x) => x.path === anchor)
      const b = sorted.findIndex((x) => x.path === f.path)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      onSelect(sorted.slice(lo, hi + 1).map((x) => x.path))
      return
    }
    if (onClose && activePath === f.path && selected.length <= 1) {
      onSelect?.([])
      onClose()
      return
    }
    open(f)
  }

  // like the original: Up / Down move the open file through the list
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
    const order = displayOrder(files, mode, sortDesc, mode === 'tree' ? isClosed : undefined)
    if (!order.length) return
    e.preventDefault()
    const i = order.findIndex((f) => f.path === activePath)
    const j = i < 0 ? (e.key === 'ArrowDown' ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    if (j === i) return
    open(order[j])
    const list = e.currentTarget as HTMLElement
    requestAnimationFrame(() => list.querySelector('.file-row.active')?.scrollIntoView({ block: 'nearest' }))
  }

  const row = (f: FileChange, depth: number, label: ReactNode) => (
    <div
      key={f.path}
      className={`file-row${activePath === f.path ? ' active' : ''}${selected.includes(f.path) && selected.length > 1 ? ' selected' : ''}`}
      style={depth ? { paddingLeft: 10 + depth * 16 } : undefined}
      onClick={(e) => click(f, e)}
      onContextMenu={(e) => { e.preventDefault(); onContext?.(f) }}
    >
      <StatusIcon status={f.status} />
      {label}
      {/* mousedown is swallowed so the commit summary keeps the focus, like the original */}
      {rowAction ? <span className="file-row-action" onMouseDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>{rowAction(f)}</span> : null}
    </div>
  )

  if (mode === 'path') {
    return (
      <div className="file-node-list" tabIndex={-1} onKeyDown={onKeyDown}>
        {sorted.map((f) => {
          const i = f.path.lastIndexOf('/')
          const dir = i >= 0 ? f.path.slice(0, i) : ''
          const name = i >= 0 ? f.path.slice(i + 1) : f.path
          return row(f, 0, <span className="file-path">{dir ? <span className="file-dir">{dir}<span>/</span></span> : null}<span className="file-name">{name}</span></span>)
        })}
      </div>
    )
  }

  const tree = buildDirs(sorted)
  const counts = (d: Dir): Array<[string, number]> => {
    const m = new Map<string, number>()
    const walk = (x: Dir) => { for (const f of x.files) if (f.status !== 'N') { const k = f.status === '?' || f.status === 'C' ? 'A' : f.status === 'T' ? 'M' : f.status; m.set(k, (m.get(k) ?? 0) + 1) } x.dirs.forEach(walk) }
    walk(d)
    return ['M', 'A', 'D', 'R', 'U'].filter((k) => m.has(k)).map((k) => [k, m.get(k)!])
  }
  const render = (d: Dir, depth: number): ReactNode[] => [
    ...sortDirs(d.dirs, sortDesc).flatMap((sub) => {
      const shut = isClosed(sub.full)
      return [
        <div key={'d:' + sub.full} className="file-row file-dir-row" style={depth ? { paddingLeft: 3 + depth * 16 } : undefined} onClick={() => setClosed((c) => ({ ...c, [sub.full]: !shut }))}
          onContextMenu={(e) => { e.preventDefault(); if (onDirContext) onDirContext(sub.full, allFilesOf(sub).filter((f) => f.status !== 'N')) }}>
          <span className="file-dir-caret"><Icon name="caret-down" style={shut ? { transform: 'rotate(-90deg)' } : undefined} /></span>
          <span className="file-name">{sub.name}</span>
          <span className="file-dir-counts">{counts(sub).map(([k, n]) => <span key={k} className="file-dir-count"><StatusIcon status={k} />{n}</span>)}</span>
        </div>,
        ...(shut ? [] : render(sub, depth + 1))
      ]
    }),
    ...d.files.map((f) => row(f, depth, <span className="file-path"><span className="file-name">{f.path.split('/').pop()}</span></span>))
  ]
  return (
    <div className="file-node-list" tabIndex={-1} onKeyDown={onKeyDown}>
      {tree.dirs.length ? (
        <div className="file-tree-header">
          <button className="btn btn-default btn-xs file-tree-toggle" onClick={() => { setClosed({}); setAllOpen(!allOpen) }}>{allOpen ? 'Collapse All' : 'Expand All'}</button>
        </div>
      ) : null}
      {render(tree, 0)}
    </div>
  )
}

export function FileListToolbar({ mode, setMode, sortDesc, setSortDesc, extra }: { mode: 'path' | 'tree'; setMode: (m: 'path' | 'tree') => void; sortDesc: boolean; setSortDesc: (v: boolean) => void; extra?: ReactNode }) {
  return (
    <div className="file-list-toolbar">
      <div className="file-list-toolbar-side">
        {/* like the original: a static "Sort by filename" title, toggled on mousedown */}
        <button className="sort-btn" title="Sort by filename" onMouseDown={(e) => { if (e.button === 0) setSortDesc(!sortDesc) }}><Icon name="sort-alpha" style={sortDesc ? { transform: 'scaleY(-1)' } : undefined} /></button>
      </div>
      <div className="btn-group toggle-group">
        <button className={`toggle-btn${mode === 'path' ? ' checked' : ''}`} onClick={() => setMode('path')}><Icon name="bars" /> Path</button>
        <button className={`toggle-btn${mode === 'tree' ? ' checked' : ''}`} onClick={() => setMode('tree')}><Icon name="folder-tree" /> Tree</button>
      </div>
      <div className="file-list-toolbar-side file-list-toolbar-extra">{extra}</div>
    </div>
  )
}
