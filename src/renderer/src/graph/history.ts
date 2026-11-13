// History questions the commit context menus ask, like the original. Pure, over the loaded commits.

export interface HistCommit {
  sha: string
  parents: string[]
}

/** Every loaded commit reachable from `tip` (itself included). */
export function ancestors(commits: HistCommit[], tip: string): Set<string> {
  const byId = new Map(commits.map((c) => [c.sha, c]))
  const out = new Set<string>()
  const todo = [tip]
  while (todo.length) {
    const s = todo.pop()!
    if (out.has(s)) continue
    const c = byId.get(s)
    if (!c) continue
    out.add(s)
    todo.push(...c.parents)
  }
  return out
}

/**
 * "Interactive Rebase N children of X": the number of commits from HEAD down its first parents to `sha`,
 * when every commit on the way is an ordinary one (the target itself may be a merge commit). Null when
 * `sha` is not on that line, is HEAD itself, or the line passes a merge commit first.
 */
export function childrenOnPath(commits: HistCommit[], head: string, sha: string): number | null {
  const byId = new Map(commits.map((c) => [c.sha, c]))
  let cur = byId.get(head)
  let n = 0
  while (cur) {
    if (cur.sha === sha) return n > 0 ? n : null
    if (cur.parents.length > 1) return null
    n++
    cur = cur.parents[0] ? byId.get(cur.parents[0]) : undefined
  }
  return null
}

/**
 * Whether "Interactive Rebase <HEAD> onto <onto>" has steps: the commits of HEAD that `onto` lacks, none of
 * them a merge commit (the original's getInteractiveRebaseSteps().length > 0).
 */
export function hasInteractiveRebaseSteps(commits: HistCommit[], head: string, onto: string): boolean {
  const theirs = ancestors(commits, onto)
  const mine = [...ancestors(commits, head)].filter((s) => !theirs.has(s))
  if (!mine.length) return false
  const byId = new Map(commits.map((c) => [c.sha, c]))
  return mine.every((s) => (byId.get(s)?.parents.length ?? 0) < 2)
}
