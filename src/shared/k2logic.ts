// Pure logic for branch cleanup and conflict prevention (shared by main and renderer, unit-tested).
import type { CleanupBranch } from './k2'

// ---------------------------------------------------------------------------------------------
// Clean Up Local Branches (the original's filters, sort and labels)

export const DEFAULT_DAYS_OLD = 30
export const MIN_DAYS_OLD = 1
export const MAX_DAYS_OLD = 9999
/** the LOCAL header offers the cleanup from this many local branches on */
export const MIN_BRANCHES_FOR_CLEANUP = 5

export type CleanupSortColumn = 'branch' | 'lastCommit' | 'merged' | 'upstream'
export interface CleanupSort { columnId: CleanupSortColumn; direction: 'asc' | 'desc' }
export const DEFAULT_CLEANUP_SORT: CleanupSort = { columnId: 'lastCommit', direction: 'desc' }
export type UpstreamFilter = 'all' | 'hasUpstream' | 'noUpstream'
export type MergeFilter = 'all' | 'merged' | 'unmerged'

const DAY = 86400000
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
/** "Older than N days": the last commit is before the start of the day N-1 days ago */
export const daysOldThreshold = (now: number, days: number) => startOfDay(now) - (days - 1) * DAY

const UPSTREAM_ORDER = { none: 0, local: 1, remote: 2 }
const COMPARE: Record<CleanupSortColumn, (a: CleanupBranch, b: CleanupBranch) => number> = {
  branch: (a, b) => a.name.localeCompare(b.name),
  lastCommit: (a, b) => a.lastCommitDate - b.lastCommitDate,
  merged: (a, b) => Number(b.merged) - Number(a.merged),
  upstream: ({ upstream: a }, { upstream: b }) => (a?.type === 'remote' && b?.type === 'remote'
    ? a.remoteName.localeCompare(b.remoteName)
    : UPSTREAM_ORDER[a?.type ?? 'none'] - UPSTREAM_ORDER[b?.type ?? 'none'])
}
const compareBy = (s: CleanupSort, a: CleanupBranch, b: CleanupBranch) => (s.direction === 'asc' ? 1 : -1) * COMPARE[s.columnId](a, b)

export function sortCleanupBranches(list: CleanupBranch[], sort: CleanupSort): CleanupBranch[] {
  const secondary = sort.columnId === 'merged' || sort.columnId === 'upstream'
  return [...list].sort((a, b) => compareBy(sort, a, b) || (secondary ? compareBy(DEFAULT_CLEANUP_SORT, a, b) : 0))
}

/** clicking a column header: a new column sorts ascending, the same one flips */
export const nextCleanupSort = (cur: CleanupSort, col: CleanupSortColumn): CleanupSort =>
  cur.columnId === col ? { columnId: col, direction: cur.direction === 'asc' ? 'desc' : 'asc' } : { columnId: col, direction: 'asc' }

/** rows that match the filters, plus selected rows that no longer match ("pinned" at the top) */
export function buildCleanupRows(o: {
  branches: CleanupBranch[]; daysOld: number; now: number; selected: Set<string>; sort: CleanupSort; upstream: UpstreamFilter; merge: MergeFilter
}): { matching: CleanupBranch[]; pinned: CleanupBranch[] } {
  const threshold = daysOldThreshold(o.now, o.daysOld)
  const matching: CleanupBranch[] = []
  const pinned: CleanupBranch[] = []
  for (const b of o.branches) {
    const ok = b.lastCommitDate <= threshold
      && (o.upstream === 'all' || (b.upstream !== null) === (o.upstream === 'hasUpstream'))
      && (o.merge === 'all' || b.merged === (o.merge === 'merged'))
    if (ok) matching.push(b)
    else if (o.selected.has(b.name)) pinned.push(b)
  }
  return { matching: sortCleanupBranches(matching, o.sort), pinned: sortCleanupBranches(pinned, o.sort) }
}

export const branchCountLabel = (n: number) => (n === 1 ? '1 branch matching filters' : `${n} branches matching filters`)

export function deleteButtonLabel(local: number, remote: number): string {
  if (local === 0) return 'Select Branches to Delete'
  const l = local === 1 ? 'Delete 1 local branch' : `Delete ${local} local branches`
  if (remote === 0) return l
  return `${l} (and ${remote === 1 ? '1 remote branch' : `${remote} remote branches`})`
}

export const remoteWarning = (n: number) => (n === 1
  ? 'Warning: 1 remote branch will be deleted. This cannot be undone.'
  : `Warning: ${n} remote branches will be deleted. This cannot be undone.`)

// ---------------------------------------------------------------------------------------------
// Conflict Prevention

function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++ } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\/]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/**
 * The original's "Base branches" rules, one glob per line: `origin/main`, `origin/**`, `!origin/abc`.
 * A rule also matches everything under it (`!origin` excludes the whole remote); without include rules
 * every branch is a candidate. Names are short (`origin/main`, `main`); `refs/remotes/…` / `refs/heads/…` work too.
 */
export function matchesRules(name: string, rules: string[], remote?: boolean): boolean {
  const full = remote === undefined ? null : `${remote ? 'refs/remotes/' : 'refs/heads/'}${name}`
  const test = (rule: string) => {
    const re = globToRegExp(rule.replace(/\/+$/, ''))
    const hit = (n: string) => re.test(n) || n.split('/').some((_, i, parts) => i > 0 && re.test(parts.slice(0, i).join('/')))
    return hit(name) || (full !== null && hit(full))
  }
  const list = rules.map((r) => r.trim()).filter(Boolean)
  const includes = list.filter((r) => !r.startsWith('!'))
  const excludes = list.filter((r) => r.startsWith('!')).map((r) => r.slice(1))
  if (includes.length && !includes.some(test)) return false
  return !excludes.some(test)
}

const MAIN_NAMES = ['main', 'master', 'develop', 'dev', 'trunk']
const baseName = (r: { name: string; remote: boolean }) => (r.remote ? r.name.slice(r.name.indexOf('/') + 1) : r.name)

/**
 * The "base branch" the current branch started from: of the branches that lack some of its commits, the one
 * missing the fewest (closest fork point); ties prefer main/master/develop, then the one with more new commits, then remote branches.
 * The branch itself, its upstream and its copies on other remotes are never a target.
 */
export function pickConflictTarget<T extends { name: string; remote: boolean; ahead: number; behind: number }>(rows: T[], branch: string, upstream: string): T | null {
  // a main line's own base is a branch with something new for it, not one merged into it
  const mainline = MAIN_NAMES.includes(branch)
  const cands = rows.filter((r) => r.behind > 0 && (!mainline || r.ahead > 0) && r.name !== upstream && baseName(r) !== branch && !(!r.remote && r.name === branch))
  if (!cands.length) return null
  const rank = (r: T) => { const i = MAIN_NAMES.indexOf(baseName(r)); return i < 0 ? MAIN_NAMES.length : i }
  return [...cands].sort((a, b) => a.behind - b.behind || rank(a) - rank(b) || b.ahead - a.ahead || Number(b.remote) - Number(a.remote) || a.name.localeCompare(b.name))[0]
}

/** `git merge-tree --write-tree --no-messages` output: the merged tree and the conflicted paths */
export function parseMergeTree(stdout: string): { tree: string; files: string[] } {
  const lines = stdout.split('\n')
  const tree = (lines[0] ?? '').trim()
  const files: string[] = []
  for (const l of lines.slice(1)) {
    if (!l.trim()) break
    const tab = l.indexOf('\t')
    const f = tab >= 0 ? l.slice(tab + 1) : l.trim()
    if (f && !files.includes(f)) files.push(f.replace(/^"(.*)"$/, '$1'))
  }
  return { tree, files }
}

/** 1-based line ranges of the conflict blocks (<<<<<<< … >>>>>>>) in a file of the merged tree */
export function conflictRanges(text: string): Array<[number, number]> {
  const res: Array<[number, number]> = []
  let start = 0
  text.split('\n').forEach((l, i) => {
    if (l.startsWith('<<<<<<<')) start = i + 1
    else if (l.startsWith('>>>>>>>') && start) { res.push([start, i + 1]); start = 0 }
  })
  return res
}

// ---------------------------------------------------------------------------------------------
// Auth and network errors the original answers with a modal

/** ssh's "REMOTE HOST IDENTIFICATION HAS CHANGED!" error: the host (and port) whose key changed */
export function parseHostKeyChanged(text: string): { host: string } | null {
  if (!/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) return null
  const m = /host key for (\[[^\]]+\]:\d+|[^\s]+) has changed/i.exec(text) ?? /Offending \S+ key for (\S+)/i.exec(text)
  if (!m) return null
  return { host: m[1].replace(/[.,]$/, '') }
}

/** "unable to access '<url>': SSL certificate problem: …": the server's base URL and the problem */
export function parseSslProblem(text: string): { url: string; problem: string } | null {
  const m = /unable to access '([^']+)':\s*(SSL certificate problem[^\n]*|server certificate verification failed[^\n]*|schannel:[^\n]*(?:certificate|SEC_E_(?:UNTRUSTED_ROOT|CERT_EXPIRED|CERT_UNKNOWN|WRONG_PRINCIPAL|ILLEGAL_MESSAGE)|CERT_E_[A-Z_]+|CRYPT_E_(?:REVOCATION_OFFLINE|NO_REVOCATION_CHECK|REVOKED)|0x80090325|0x800b01(?:09|01|0f))[^\n]*)/i.exec(text)
  if (!m) return null
  const u = /^(https?:\/\/[^/]+\/)/i.exec(m[1])
  return { url: u ? u[1] : m[1], problem: m[2].trim() }
}
