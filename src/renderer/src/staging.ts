// Staging operations with the original's speed: the rows move at once (optimistic), the real `git status`
// is read right after the operation (a fraction of a full snapshot), and the rest of the repository view
// (graph, refs, undo state) is refreshed in the background.
import { api } from './lib/api'
import { getState, updateRepo, toast, type CenterView, type RepoView } from './store'
import { errMsg } from './lib/format'
import { displayOrder, neighbour } from './lib/wipStatus'
import { useFileSort } from './fileListState'
import { refresh, asOwnOp } from './actions'
import type { FileChange, WorkingStatus } from '@shared/types'

/** when the working status was last written from a staging operation (performance.now()) */
const statusAt = new Map<string, number>()
/** staging operations still running per repository */
const running = new Map<string, number>()

/** true when a staging operation wrote a newer status than a snapshot started at `t0` has */
export const statusNewerThan = (path: string, t0: number): boolean => (statusAt.get(path) ?? -1) > t0

export async function runStaging(path: string, fn: () => Promise<unknown>, optimistic?: (st: WorkingStatus) => WorkingStatus): Promise<void> {
  const cur = getState().repos[path]?.snapshot?.status
  if (cur && optimistic) setStatus(path, optimistic(cur))
  running.set(path, (running.get(path) ?? 0) + 1)
  try {
    await asOwnOp(path, fn, true)
  } catch (e) {
    toast({ kind: 'error', title: 'Something went wrong', message: errMsg(e) })
  } finally {
    running.set(path, (running.get(path) ?? 1) - 1)
  }
  // with another staging operation still on its way, that one reads the final status
  if (!running.get(path)) {
    try {
      const st = await api.status(path)
      if (!running.get(path)) setStatus(path, st)
    } catch { /* the full refresh reports it */ }
  }
  void refresh(path)
}

function setStatus(path: string, status: WorkingStatus): void {
  statusAt.set(path, performance.now())
  updateRepo(path, (r) => {
    if (!r.snapshot) return {}
    // a multi-selection does not survive its files moving to the other list
    const sel = r.fileSel.length > 1 ? { fileSel: r.center.kind === 'file' ? [r.center.ctx.path] : [] } : {}
    return { snapshot: { ...r.snapshot, status }, ...sel, ...followFile(r, status) }
  })
}

/** like the original: when the open file leaves its list, the next file of that list opens (the one above
 *  when it was the last); with the list empty the diff closes */
function followFile(r: RepoView, status: WorkingStatus): Partial<RepoView> {
  if (r.center.kind !== 'file') return {}
  const ctx = r.center.ctx
  if (ctx.kind !== 'unstaged' && ctx.kind !== 'staged') return {}
  const pick = (st: WorkingStatus) => (ctx.kind === 'unstaged' ? st.unstaged : st.staged)
  const now = pick(status)
  if (now.some((f) => f.path === ctx.path)) return {}
  const mode = getState().settings?.fileListMode ?? 'path'
  const next = neighbour(displayOrder(pick(r.snapshot!.status), mode, useFileSort.getState().desc), ctx.path, new Set(now.map((f) => f.path)))
  const f = now.find((x) => x.path === next)
  if (!f) return { center: { kind: 'graph' }, fileSel: [] }
  return { center: fileCenter(ctx.kind, f), fileSel: [f.path] }
}

export function fileCenter(kind: 'unstaged' | 'staged', f: FileChange): CenterView {
  return { kind: 'file', ctx: kind === 'unstaged' ? { kind: 'unstaged', path: f.path, status: f.status } : { kind: 'staged', path: f.path, oldPath: f.oldPath, status: f.status } }
}
