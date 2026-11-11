import { useState } from 'react'
import type { RepoView } from '../store'
import { updateRepo } from '../store'
import * as A from '../actions'
import { avatarUrl } from '../lib/avatar'
import { Icon } from './Icon'
import type { RebaseTodoItem } from '@shared/types'

/** the original offers these four; presets from other menus (fixup, edit) stay selectable when present */
const ACTIONS: RebaseTodoItem['action'][] = ['pick', 'squash', 'reword', 'drop']
const LABEL: Record<RebaseTodoItem['action'], string> = { pick: 'Pick', reword: 'Reword', edit: 'Edit', squash: 'Squash', fixup: 'Fixup', drop: 'Drop' }
const KEYS: Record<string, RebaseTodoItem['action']> = { p: 'pick', s: 'squash', r: 'reword', d: 'drop' }

/** Interactive rebase, laid out like the original: header bar, one row per commit (newest first), shortcuts legend and buttons at the bottom. */
export function RebaseView({ repo }: { repo: RepoView }) {
  const center = repo.center
  const [drag, setDrag] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const [initial] = useState(() => (center.kind === 'rebase' ? center.items : []))
  if (center.kind !== 'rebase') return null
  const items = center.items
  const commits = repo.snapshot!.commits
  const setItems = (next: RebaseTodoItem[]) => updateRepo(repo.path, { center: { ...center, items: next } })
  const set = (i: number, patch: Partial<RebaseTodoItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [it] = next.splice(from, 1)
    next.splice(to, 0, it)
    setItems(next)
    setActive(to)
  }
  const select = (i: number) => { setActive(i); A.selectCommit(repo.path, items[i].sha) }
  const oldest = items.length - 1
  const oldestIsSquash = items.length > 0 && (items[oldest].action === 'squash' || items[oldest].action === 'fixup')
  const cancel = () => A.closeCenter(repo.path)

  return (
    <div className="rebase-view">
      <div className="rebase-header">
        <span className="rebase-title">Interactive Rebase</span>
        <span className="rebase-subtitle">Rebasing <span className="rebase-ref ref-branch">{center.branch}</span> onto <span className="rebase-ref ref-onto">{center.onto ?? (center.base ? center.base.slice(0, 7) : 'root')}</span></span>
        <span className="grow" />
        <button className="btn btn-xs btn-danger" onClick={cancel}>Cancel Rebase</button>
      </div>
      <div className="rebase-list">
        {items.map((it, i) => {
          const c = commits.find((x) => x.sha === it.sha)
          // the oldest commit has nothing below it to squash into
          const options = ACTIONS.filter((a) => !(i === oldest && a === 'squash'))
          if (!options.includes(it.action)) options.push(it.action)
          return (
            <div
              key={it.sha}
              className={`rebase-row action-${it.action}${drag === i ? ' dragging' : ''}${active === i ? ' active' : ''}`}
              draggable={editing !== i}
              tabIndex={0}
              onClick={() => select(i)}
              onDragStart={() => setDrag(i)}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag !== null && drag !== i) move(drag, i); setDrag(null) }}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); return }
                if (e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); return }
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  const j = i + (e.key === 'ArrowUp' ? -1 : 1)
                  if (j >= 0 && j < items.length) { select(j); (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus() }
                  return
                }
                const a = KEYS[e.key.toLowerCase()]
                if (a && !(a === 'squash' && i === oldest)) { set(i, { action: a }); if (a === 'reword') setEditing(i) }
              }}
            >
              <select className="rebase-action" value={it.action} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { const a = e.target.value as RebaseTodoItem['action']; set(i, { action: a }); if (a === 'reword') setEditing(i) }}>
                {options.map((a) => <option key={a} value={a}>{LABEL[a]}</option>)}
              </select>
              <span className="rebase-node"><span className="rebase-avatar" style={{ backgroundImage: c ? `url(${avatarUrl(c.email, c.author)})` : undefined }} /></span>
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
                <span className="rebase-summary" title={c ? `${it.sha.slice(0, 7)} · ${c.author}` : it.sha.slice(0, 7)} onDoubleClick={() => { if (it.action !== 'reword') set(i, { action: 'reword' }); setEditing(i) }}>
                  {it.action === 'reword' && it.message ? it.message.split('\n')[0] : it.summary}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="rebase-footer">
        <div className="rebase-legend">
          <div><Icon name="keyboard" /> shortcuts:</div>
          <div>
            <span className="nowrap"><b>P</b>ick</span> <span className="nowrap"><b>S</b>quash</span> <span className="nowrap"><b>R</b>eword</span> <span className="nowrap"><b>D</b>rop</span>{' '}
            <span className="nowrap"><span className="rebase-key">Ctrl + <Icon name="arrow-up" /></span> Move Up</span>{' '}
            <span className="nowrap"><span className="rebase-key">Ctrl + <Icon name="arrow-down" /></span> Move Down</span>
          </div>
        </div>
        {oldestIsSquash ? <span className="color-red">The oldest commit cannot be squashed.</span> : null}
        <span className="grow" />
        <button className="btn btn-primary btn-medium" onClick={() => { setItems(initial); setActive(null); setEditing(null) }}>Reset</button>
        <button className="btn btn-danger btn-medium" onClick={cancel}>Cancel Rebase</button>
        <button className="btn btn-success btn-medium" disabled={oldestIsSquash} onClick={() => A.runInteractiveRebase(repo.path, center.base, items)}>Start Rebase</button>
      </div>
    </div>
  )
}
