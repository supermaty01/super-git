import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'

export interface DropItem { key: string; label: string; hint?: string; current?: boolean; icon?: string }

/** Searchable dropdown used by the breadcrumbs (repo / branch pickers), laid out like the original's. */
export function Dropdown({ anchor, items, onPick, onClose, header, footer }: {
  anchor: HTMLElement | null
  items: DropItem[]
  onPick: (key: string) => void
  onClose: () => void
  header?: string
  footer?: { label: string; run: () => void }
}) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    setPos({ left: r.left, top: r.bottom })
  }, [anchor])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose() }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [anchor, onClose])
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? items.filter((i) => i.label.toLowerCase().includes(t)) : items
  }, [q, items])
  const pick = (k: string) => { onPick(k); onClose() }
  return (
    <div className="dropdown-menu" ref={ref} style={{ left: pos.left, top: pos.top }}>
      <div className="dropdown-search">
        <div className="gk-searchbox">
          <Icon name="search" className="gk-search-box-icon" />
          <input
            autoFocus
            placeholder="Search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter' && filtered[Math.max(0, idx)]) pick(filtered[Math.max(0, idx)].key)
              else if (e.key === 'Escape') onClose()
            }}
          />
        </div>
      </div>
      <div className="dropdown-list">
        {header ? <div className="dropdown-header"><Icon name="clock" /> {header}</div> : null}
        {filtered.map((it, i) => (
          <div key={it.key} className={`dropdown-item${i === idx ? ' active' : ''}${it.current ? ' current' : ''}`} title={it.hint ?? it.label} onMouseEnter={() => setIdx(i)} onClick={() => pick(it.key)}>
            {it.icon ? <Icon name={it.icon} className="dropdown-icon" /> : null}
            <span className="truncate">{it.label}</span>
          </div>
        ))}
        {!filtered.length ? <div className="dropdown-empty">No matches</div> : null}
      </div>
      {footer ? <div className="dropdown-item dropdown-footer" onClick={() => { footer.run(); onClose() }}><span className="btn-link">{footer.label}</span></div> : null}
    </div>
  )
}
