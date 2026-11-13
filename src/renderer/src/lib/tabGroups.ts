// Worktree tab groups: the tabs of a repository and its worktrees (same common git dir) sit together.

/** the repository's common git dir from a worktree's git dir (`<repo>/.git/worktrees/<name>` → `<repo>/.git`) */
export function commonGitDir(gitDir: string): string {
  const m = /^(.*)[\\/]worktrees[\\/][^\\/]+[\\/]?$/.exec(gitDir)
  return (m ? m[1] : gitDir).replace(/[\\/]+$/, '').toLowerCase()
}

/**
 * Tab order with the members of each group (2+ tabs with the same key) moved next to the group's first tab.
 * Tabs without a key stay where they are relative to the others.
 */
export function groupedOrder<T extends { id: string }>(tabs: T[], keyOf: (t: T) => string | undefined): T[] {
  const count = new Map<string, number>()
  for (const t of tabs) { const k = keyOf(t); if (k) count.set(k, (count.get(k) ?? 0) + 1) }
  const out: T[] = []
  const placed = new Set<string>()
  for (const t of tabs) {
    const k = keyOf(t)
    if (!k || (count.get(k) ?? 0) < 2) { out.push(t); continue }
    if (placed.has(k)) continue
    placed.add(k)
    out.push(...tabs.filter((x) => keyOf(x) === k))
  }
  return out
}

/** runs of consecutive tabs that form a group: [start, end) index pairs with their key */
export function groupRuns<T>(tabs: T[], keyOf: (t: T) => string | undefined): Array<{ key: string | undefined; start: number; end: number }> {
  const count = new Map<string, number>()
  for (const t of tabs) { const k = keyOf(t); if (k) count.set(k, (count.get(k) ?? 0) + 1) }
  const runs: Array<{ key: string | undefined; start: number; end: number }> = []
  tabs.forEach((t, i) => {
    let k = keyOf(t)
    if (k && (count.get(k) ?? 0) < 2) k = undefined
    const last = runs[runs.length - 1]
    if (last && k && last.key === k) last.end = i + 1
    else runs.push({ key: k, start: i, end: i + 1 })
  })
  return runs
}
