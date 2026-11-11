import { useEffect, useMemo, useRef, useState } from 'react'
import type { RepoView } from '../store'
import { updateRepo } from '../store'
import { avatarUrl } from '../lib/avatar'
import { Icon } from './Icon'

/**
 * "filter the graph by team or author", like the original: pick one or more authors and the graph dims everyone
 * else's commits (search then only finds theirs). Teams and invitations need the original's servers and are left out.
 */
export function AuthorFilter({ repo, onClose }: { repo: RepoView; onClose: () => void }) {
  const path = repo.path
  const selected = repo.authorFilter ?? []
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const authors = useMemo(() => {
    const m = new Map<string, { name: string; email: string }>()
    for (const c of repo.snapshot?.commits ?? []) { const k = c.email.toLowerCase(); if (!m.has(k)) m.set(k, { name: c.author, email: c.email }) }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [repo.snapshot?.commits])
  const shown = authors.filter((a) => !q.trim() || `${a.name} ${a.email}`.toLowerCase().includes(q.trim().toLowerCase()))
  const set = (list: string[]) => updateRepo(path, { authorFilter: list })
  const toggle = (email: string) => { const k = email.toLowerCase(); set(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]) }

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.graph-header-filter')) onClose() }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [onClose])

  return (
    <div className="author-filter" ref={ref}>
      <div className="author-filter-bar">
        <Icon name="filter" />
        <input autoFocus placeholder="filter the graph by team or author" value={q}
          onChange={(e) => { setQ(e.target.value); setHi(-1) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(shown.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(-1, i - 1)) }
            else if (e.key === 'Enter' && shown[hi]) toggle(shown[hi].email)
          }} />
      </div>
      <div className="author-filter-menu">
        <div className="author-filter-group">
          <div className="author-filter-option clear" onClick={() => set([])}><Icon name="times" /><span>Clear filter</span></div>
        </div>
        <div className="author-filter-group">
          <div className="author-filter-heading">authors</div>
          {shown.map((a, i) => (
            <div key={a.email} className={`author-filter-option${i === hi ? ' focused' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => toggle(a.email)}>
              <span className="author-filter-check">{selected.includes(a.email.toLowerCase()) ? <Icon name="check" /> : null}</span>
              <span className="author-filter-avatar" style={{ backgroundImage: `url(${avatarUrl(a.email, a.name)})` }} />
              <span className="truncate">{a.name} ({a.email})</span>
            </div>
          ))}
          {!shown.length ? <div className="author-filter-empty">No authors found</div> : null}
        </div>
      </div>
    </div>
  )
}
