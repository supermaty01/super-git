// Pure helpers for the working-directory file lists: the order rows are shown in, and the optimistic
// status after staging / unstaging / discarding (shown at once, then reconciled with `git status`).
import type { FileChange, FileStatus, WorkingStatus } from '@shared/types'

export type ListMode = 'path' | 'tree'

export interface Dir { name: string; full: string; dirs: Dir[]; files: FileChange[] }

const byPath = (a: FileChange, b: FileChange) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' })

export function sortFiles(files: FileChange[], sortDesc?: boolean): FileChange[] {
  const l = [...files].sort(byPath)
  return sortDesc ? l.reverse() : l
}

/** folders of a file list, single-child chains collapsed (a/b/c) */
export function buildDirs(files: FileChange[]): Dir {
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

export const sortDirs = (dirs: Dir[], sortDesc?: boolean): Dir[] => [...dirs].sort((a, b) => a.name.localeCompare(b.name) * (sortDesc ? -1 : 1))

/** the files in the order the list shows them (tree mode: folders first, every folder taken as open);
 *  `isClosed` leaves out the files of closed folders */
export function displayOrder(files: FileChange[], mode: ListMode, sortDesc?: boolean, isClosed?: (dir: string) => boolean): FileChange[] {
  const sorted = sortFiles(files, sortDesc)
  if (mode === 'path') return sorted
  const out: FileChange[] = []
  const walk = (d: Dir) => {
    for (const sub of sortDirs(d.dirs, sortDesc)) if (!isClosed?.(sub.full)) walk(sub)
    out.push(...d.files)
  }
  walk(buildDirs(sorted))
  return out
}

/** the row to select when `path` leaves a list: the next one below it, else the one above, else none */
export function neighbour(order: FileChange[], path: string, remaining: Set<string>): string | null {
  const i = order.findIndex((f) => f.path === path)
  if (i < 0) return null
  for (let j = i + 1; j < order.length; j++) if (remaining.has(order[j].path)) return order[j].path
  for (let j = i - 1; j >= 0; j--) if (remaining.has(order[j].path)) return order[j].path
  return null
}

const keyOf = (f: FileChange) => f.path

/** what `git status` will most likely say after `git add` of these unstaged files */
export function stageOptimistic(st: WorkingStatus, files: FileChange[]): WorkingStatus {
  const moving = new Set(files.map(keyOf))
  const staged = [...st.staged]
  for (const f of st.unstaged) {
    if (!moving.has(f.path)) continue
    const i = staged.findIndex((x) => x.path === f.path)
    if (i >= 0) {
      // already partly staged: an added file stays added, a deletion wins
      if (f.status === 'D') staged[i] = { ...staged[i], status: 'D' }
      continue
    }
    const status: FileStatus = f.status === '?' ? 'A' : f.status
    staged.push({ path: f.path, oldPath: f.oldPath, status })
  }
  return { ...st, staged, unstaged: st.unstaged.filter((f) => !moving.has(f.path)) }
}

/** what `git status` will most likely say after unstaging these staged files */
export function unstageOptimistic(st: WorkingStatus, files: FileChange[]): WorkingStatus {
  const moving = new Set(files.map(keyOf))
  const unstaged = [...st.unstaged]
  for (const f of st.staged) {
    if (!moving.has(f.path)) continue
    const i = unstaged.findIndex((x) => x.path === f.path)
    if (f.status === 'A') {
      // a new file goes back to untracked, whatever was changed in it since
      if (i >= 0) unstaged[i] = { path: f.path, status: '?' }
      else unstaged.push({ path: f.path, status: '?' })
      continue
    }
    if (f.status === 'R' && f.oldPath) {
      if (!unstaged.some((x) => x.path === f.oldPath)) unstaged.push({ path: f.oldPath, status: 'D' })
      if (i < 0) unstaged.push({ path: f.path, status: '?' })
      continue
    }
    if (i < 0) unstaged.push({ path: f.path, status: f.status })
  }
  return { ...st, unstaged, staged: st.staged.filter((f) => !moving.has(f.path)) }
}

/** after discarding unstaged changes to these files */
export function discardOptimistic(st: WorkingStatus, files: FileChange[]): WorkingStatus {
  const gone = new Set(files.map(keyOf))
  return { ...st, unstaged: st.unstaged.filter((f) => !gone.has(f.path)) }
}

export const stageAllOptimistic = (st: WorkingStatus): WorkingStatus => stageOptimistic(st, st.unstaged)
export const unstageAllOptimistic = (st: WorkingStatus): WorkingStatus => unstageOptimistic(st, st.staged)
