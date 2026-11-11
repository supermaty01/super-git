// Decides which commits the graph shows when branches are hidden / soloed or ref kinds are toggled off.
import type { Ref } from '../../../shared/types'

export interface VisibilityOptions {
  hidden: string[]
  solo: string[]
  showRemotes: boolean
  showTags: boolean
  headSha: string
  /** commits stashes were made on; like the original, a stash that is shown keeps its history visible */
  stashBases?: string[]
}

export function refIsShown(r: Ref, o: VisibilityOptions): boolean {
  if (o.solo.length) return o.solo.includes(r.name)
  if (o.hidden.includes(r.name)) return false
  if (r.type === 'remote' && !o.showRemotes) return false
  if (r.type === 'tag' && !o.showTags) return false
  return true
}

/** Returns the set of visible commit shas, or null when everything is visible. */
export function visibleCommits(commits: Array<{ sha: string; parents: string[] }>, refs: Ref[], o: VisibilityOptions): Set<string> | null {
  const filtering = o.solo.length > 0 || o.hidden.length > 0 || !o.showRemotes || !o.showTags
  if (!filtering) return null
  const byId = new Map(commits.map((c) => [c.sha, c]))
  const stack: string[] = refs.filter((r) => refIsShown(r, o)).map((r) => r.sha)
  if (!o.solo.length) stack.push(...(o.stashBases ?? []))
  // the checked-out commit always stays visible (unless soloing other branches)
  if (o.headSha && (!o.solo.length || refs.some((r) => r.isCurrent && o.solo.includes(r.name)))) stack.push(o.headSha)
  const seen = new Set<string>()
  while (stack.length) {
    const sha = stack.pop()!
    if (seen.has(sha)) continue
    const c = byId.get(sha)
    if (!c) continue
    seen.add(sha)
    for (const p of c.parents) if (!seen.has(p)) stack.push(p)
  }
  return seen
}

/**
 * Commits highlighted while hovering a branch label (matches the original's behaviour): walk the history
 * from the hovered refs and stop at any commit another branch (local or remote) points to. Tags don't
 * stop the walk, and other refs on the starting commit don't either.
 */
export function highlightCommits(commits: Array<{ sha: string; parents: string[] }>, refs: Ref[], hovered: string[]): Set<string> {
  const byId = new Map(commits.map((c) => [c.sha, c]))
  const starts = new Set(refs.filter((r) => hovered.includes(r.name)).map((r) => r.sha))
  const blockers = new Set(refs.filter((r) => r.type !== 'tag' && !hovered.includes(r.name)).map((r) => r.sha))
  const seen = new Set<string>()
  const stack = [...starts]
  while (stack.length) {
    const sha = stack.pop()!
    if (seen.has(sha)) continue
    const c = byId.get(sha)
    if (!c) continue
    if (blockers.has(sha) && !starts.has(sha)) continue
    seen.add(sha)
    for (const p of c.parents) if (!seen.has(p)) stack.push(p)
  }
  return seen
}

/** refs considered by "Smart Branch Visibility": the checked-out branch, its upstream and the main branches */
export function smartRefs(refs: Ref[]): string[] {
  const cur = refs.find((r) => r.type === 'head' && r.isCurrent)
  const names = new Set<string>()
  if (cur) { names.add(cur.name); if (cur.upstream) names.add(cur.upstream) }
  for (const r of refs) {
    const short = r.type === 'remote' ? r.short.slice((r.remote?.length ?? 0) + 1) : r.short
    if (r.type !== 'tag' && /^(main|master|develop|development|trunk)$/.test(short)) names.add(r.name)
  }
  return [...names]
}
