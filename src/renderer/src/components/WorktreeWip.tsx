import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import * as A from '../actions'
import { openWorktree } from '../k2worktree'
import type { RepoSnapshot } from '@shared/types'
import '../styles/k2.css'

export interface WtWip { path: string; branch?: string; sha: string; changes: number }

const NONE: WtWip[] = []
const folderOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

/** the other worktrees with uncommitted changes; re-read with every snapshot (Refresh WIPs in the WORKTREES header) */
export function useWorktreeWips(path: string, s: RepoSnapshot): WtWip[] {
  const [list, setList] = useState<WtWip[]>(NONE)
  const others = s.worktrees.filter((w) => !w.isCurrent && !w.prunable).length
  useEffect(() => {
    if (!others) { setList(NONE); return }
    let live = true
    const t = window.setTimeout(() => {
      api.worktreeWips(path).then((r) => {
        if (!live) return
        setList((cur) => (JSON.stringify(cur) === JSON.stringify(r) ? cur : r.length ? r : NONE))
      }).catch(() => {})
    }, 300)
    return () => { live = false; window.clearTimeout(t) }
  }, [path, s, others])
  return list
}

/** the message cell of a worktree's WIP row: "WIP on <branch>" and its folder, like the original */
export function WorktreeWipMessage({ wt }: { wt: WtWip }) {
  return (
    <span className="message-text k2-wt-wip" title={`${wt.path}\n${wt.changes} changed file${wt.changes === 1 ? '' : 's'}`}>
      <span className="message-summary">// WIP</span>
      <span className="message-body">{wt.branch ? `on ${wt.branch.replace(/^refs\/heads\//, '')}` : 'Detached HEAD'} · {folderOf(wt.path)} · {wt.changes} file{wt.changes === 1 ? '' : 's'}</span>
    </span>
  )
}

/** right-click (or double-click: open) on a worktree's WIP row */
export function worktreeWipMenu(path: string, wt: WtWip, openNow = false): Promise<void> {
  if (openNow) return openWorktree(path, wt.path, true)
  return A.popup([
    { label: 'Open this worktree', act: () => openWorktree(path, wt.path, false) },
    { label: 'Open worktree in new tab', act: () => openWorktree(path, wt.path, true) }
  ])
}
