import { useMemo, useState, type ReactNode } from 'react'
import type { FileChange } from '@shared/types'
import { Icon } from './Icon'

export const STATUS_ICON: Record<string, { icon: string; cls: string; label: string }> = {
  M: { icon: 'pencil', cls: 'color-orange', label: 'modified' },
  T: { icon: 'pencil', cls: 'color-orange', label: 'type changed' },
  A: { icon: 'plus', cls: 'color-green', label: 'added' },
  '?': { icon: 'plus', cls: 'color-green', label: 'added' },
  D: { icon: 'minus', cls: 'color-red', label: 'deleted' },
  R: { icon: 'swap', cls: 'color-blue', label: 'renamed' },
  C: { icon: 'copy', cls: 'color-blue', label: 'copied' },
  U: { icon: 'warning', cls: 'color-orange', label: 'conflicted' },
  N: { icon: 'file', cls: 'text-disabled', label: 'unchanged' }
}

export function StatusIcon({ status }: { status: string }) {
  const s = STATUS_ICON[status] ?? STATUS_ICON.M
  return <Icon name={s.icon} className={`file-status ${s.cls}`} title={s.label} />
}

export function summarizeFiles(files: FileChange[]): Array<{ status: string; count: number }> {
  const order = ['A', 'M', 'D', 'R']
  const map = new Map<string, number>()
  for (const f of files) {
    if (f.status === 'N') continue
    const k = f.status === '?' ? 'A' : f.status === 'T' ? 'M' : f.status === 'C' ? 'A' : f.status
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return order.filter((k) => map.has(k)).map((k) => ({ status: k, count: map.get(k)! }))
}

interface Props {
  files: FileChange[]
  mode: 'path' | 'tree'
  sortDesc?: boolean
  activePath?: string | null
  selected?: string[]
  onOpen: (f: FileChange) => void
  onContext?: (f: FileChange) => void
  onSelect?: (paths: string[]) => void
  rowAction?: (f: FileChange) => ReactNode
  onDoubleClick?: (f: FileChange) => void
  /** tree mode: folders start closed */
  collapsed?: boolean
}

interface Dir { name: string; full: string; dirs: Dir[]; files: FileChange[] }

function buildDirs(files: FileChange[]): Dir {
  const root: Dir = { name: '', full: '', dirs: [], files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let d = root
    for (const p of parts.slice(0, -1)) {
      let n = d.dirs.find((x) => x.name === p)
      if (!n) { n = { name: p, full: d.full + p + '/', dirs: [], files: [] }; d.dirs.push(n) }
      d = n
    }
    d.files.push(f)
  }
  // collapse single-child chains (a/b/c)
  const collapse = (d: Dir): Dir => {
    d.dirs = d.dirs.map(collapse)
    if (d.name && d.dirs.length === 1 && d.files.length === 0) {
      const c = d.dirs[0]
      return { ...c, name: `${d.name}/${c.name}` }
    }
    return d
  }
  return collapse(root)
}

export function FileList({ files, mode, sortDesc, activePath, selected = [], onOpen, onContext, onSelect, rowAction, onDoubleClick, collapsed }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [anchor, setAnchor] = useState<string | null>(null)
  const sorted = useMemo(() => {
    const l = [...files].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }))
    return sortDesc ? l.reverse() : l
  }, [files, sortDesc])

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
    setAnchor(f.path)
    onSelect?.([f.path])
    onOpen(f)
  }

  const row = (f: FileChange, depth: number, label: ReactNode) => (
    <div
      key={f.path}
      className={`file-row${activePath === f.path ? ' active' : ''}${selected.includes(f.path) && selected.length > 1 ? ' selected' : ''}`}
      style={{ paddingLeft: 10 + depth * 16 }}
      title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
      onClick={(e) => click(f, e)}
      onDoubleClick={() => onDoubleClick?.(f)}
      onContextMenu={(e) => { e.preventDefault(); onContext?.(f) }}
    >
      <StatusIcon status={f.status} />
      {label}
      {rowAction ? <span className="file-row-action" onClick={(e) => e.stopPropagation()}>{rowAction(f)}</span> : null}
    </div>
  )

  if (mode === 'path') {
    return (
      <div className="file-node-list">
        {sorted.map((f) => {
          const i = f.path.lastIndexOf('/')
          const dir = i >= 0 ? f.path.slice(0, i + 1) : ''
          const name = i >= 0 ? f.path.slice(i + 1) : f.path
          return row(f, 0, <span className="file-path">{dir ? <span className="file-dir">{dir}</span> : null}<span className="file-name">{name}</span></span>)
        })}
      </div>
    )
  }

  const tree = buildDirs(sorted)
  const render = (d: Dir, depth: number): ReactNode[] => {
    const dirs = [...d.dirs].sort((a, b) => a.name.localeCompare(b.name) * (sortDesc ? -1 : 1))
    return [
      ...dirs.flatMap((sub) => {
        const isClosed = collapsed ? closed[sub.full] !== false : !!closed[sub.full]
        return [
          <div key={'d:' + sub.full} className="file-row file-dir-row" style={{ paddingLeft: 10 + depth * 16 }} onClick={() => setClosed((c) => ({ ...c, [sub.full]: !isClosed }))}>
            <Icon name={isClosed ? 'chevron-right' : 'chevron-down'} className="file-dir-chevron" />
            <Icon name={isClosed ? 'folder' : 'folder-open'} className="file-dir-icon" />
            <span className="file-name">{sub.name}</span>
          </div>,
          ...(isClosed ? [] : render(sub, depth + 1))
        ]
      }),
      ...d.files.map((f) => row(f, depth, <span className="file-path"><span className="file-name">{f.path.split('/').pop()}</span></span>))
    ]
  }
  return <div className="file-node-list">{render(tree, 0)}</div>
}

export function FileListToolbar({ mode, setMode, sortDesc, setSortDesc, extra }: { mode: 'path' | 'tree'; setMode: (m: 'path' | 'tree') => void; sortDesc: boolean; setSortDesc: (v: boolean) => void; extra?: ReactNode }) {
  return (
    <div className="file-list-toolbar">
      <span className="sort-btn" title={sortDesc ? 'Sorted Z-A' : 'Sorted A-Z'} onClick={() => setSortDesc(!sortDesc)}><Icon name="sort-alpha" style={sortDesc ? { transform: 'scaleY(-1)' } : undefined} /></span>
      <div className="btn-group toggle-group">
        <button className={`toggle-btn${mode === 'path' ? ' checked' : ''}`} onClick={() => setMode('path')}><Icon name="bars" /> Path</button>
        <button className={`toggle-btn${mode === 'tree' ? ' checked' : ''}`} onClick={() => setMode('tree')}><Icon name="folder-tree" /> Tree</button>
      </div>
      <span className="file-list-toolbar-extra">{extra}</span>
    </div>
  )
}
