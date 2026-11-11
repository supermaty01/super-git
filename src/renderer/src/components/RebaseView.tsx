import { useState } from 'react'
import type { RepoView } from '../store'
import { updateRepo } from '../store'
import * as A from '../actions'
import { avatarUrl } from '../lib/avatar'
import { Icon } from './Icon'
import type { RebaseTodoItem } from '@shared/types'

const ACTIONS: RebaseTodoItem['action'][] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']
const LABEL: Record<RebaseTodoItem['action'], string> = { pick: 'Pick', reword: 'Reword', edit: 'Edit', squash: 'Squash', fixup: 'Fixup', drop: 'Drop' }

export function RebaseView({ repo }: { repo: RepoView }) {
  const center = repo.center
  const [drag, setDrag] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  if (center.kind !== 'rebase') return null
  const items = center.items
  const commits = repo.snapshot!.commits
  const setItems = (next: RebaseTodoItem[]) => updateRepo(repo.path, { center: { ...center, items: next } })
  const set = (i: number, patch: Partial<RebaseTodoItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (from: number, to: number) => {
    const next = [...items]
    const [it] = next.splice(from, 1)
    next.splice(to, 0, it)
    setItems(next)
  }
  const baseLabel = center.base ? center.base.slice(0, 7) : 'root'
  const oldestIsSquash = items.length && (items[items.length - 1].action === 'squash' || items[items.length - 1].action === 'fixup')

  return (
    <div className="rebase-view">
      <div className="rebase-header">
        <div className="rebase-title">Interactive Rebase</div>
        <div className="text-secondary">Rebasing <span className="pill pill-teal">{center.branch}</span> onto <span className="pill pill-blue">{baseLabel}</span> — drag rows to reorder. Newest commits are at the top.</div>
      </div>
      <div className="rebase-shortcuts text-secondary">
        Keys: <b>p</b> pick · <b>r</b> reword · <b>e</b> edit (stop to amend) · <b>s</b> squash · <b>f</b> fixup · <b>d</b> drop
      </div>
      <div className="rebase-list">
        {items.map((it, i) => {
          const c = commits.find((x) => x.sha === it.sha)
          return (
            <div
              key={it.sha}
              className={`rebase-row action-${it.action}${drag === i ? ' dragging' : ''}`}
              draggable
              tabIndex={0}
              onDragStart={() => setDrag(i)}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag !== null && drag !== i) move(drag, i); setDrag(null) }}
              onKeyDown={(e) => {
                const map: Record<string, RebaseTodoItem['action']> = { p: 'pick', r: 'reword', e: 'edit', s: 'squash', f: 'fixup', d: 'drop' }
                if (map[e.key]) { set(i, { action: map[e.key] }); if (map[e.key] === 'reword') setEditing(i) }
              }}
            >
              <Icon name="grip" className="rebase-grip" />
              <select className="rebase-action" value={it.action} onChange={(e) => { const a = e.target.value as RebaseTodoItem['action']; set(i, { action: a }); if (a === 'reword') setEditing(i) }}>
                {ACTIONS.map((a) => <option key={a} value={a}>{LABEL[a]}</option>)}
              </select>
              <span className="rebase-avatar" style={{ backgroundImage: c ? `url(${avatarUrl(c.email, c.author)})` : undefined }} />
              <span className="rebase-sha">{it.sha.slice(0, 7)}</span>
              {editing === i && it.action === 'reword' ? (
                <textarea
                  className="rebase-message-edit"
                  autoFocus
                  value={it.message ?? it.summary}
                  onChange={(e) => set(i, { message: e.target.value })}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) setEditing(null) }}
                />
              ) : (
                <span className="rebase-summary" onDoubleClick={() => { if (it.action !== 'reword') set(i, { action: 'reword' }); setEditing(i) }}>
                  {it.action === 'reword' && it.message ? it.message.split('\n')[0] : it.summary}
                </span>
              )}
              <span className="rebase-author text-secondary">{c?.author}</span>
            </div>
          )
        })}
      </div>
      <div className="rebase-footer">
        {oldestIsSquash ? <span className="color-red">The oldest commit cannot be squashed.</span> : null}
        <span className="grow" />
        <button className="btn btn-default btn-medium" onClick={() => A.closeCenter(repo.path)}>Cancel Rebase</button>
        <button className="btn btn-success btn-medium" disabled={!!oldestIsSquash} onClick={() => A.runInteractiveRebase(repo.path, center.base, items)}>Start Rebase</button>
      </div>
    </div>
  )
}
