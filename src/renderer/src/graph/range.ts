// Shift-click range selection, like the original: the commits topologically between two commits — those
// that are ancestors of the newer one and descendants of the older one — not the rows drawn between them.

export interface RangeCommit {
  sha: string
  parents: string[]
}

/**
 * The commits between `a` and `b` (both included), in row order. `rows` is in graph order (children
 * before parents). When neither commit descends from the other only the two of them are returned.
 */
export function topoRange(rows: RangeCommit[], a: string, b: string): string[] {
  const ia = rows.findIndex((r) => r.sha === a)
  const ib = rows.findIndex((r) => r.sha === b)
  if (ia < 0 || ib < 0) return [a, b].filter((x, i, l) => l.indexOf(x) === i)
  if (ia === ib) return [a]
  const [top, bottom] = ia < ib ? [ia, ib] : [ib, ia]
  // ancestors of the newer commit, walking down
  const anc = new Set<string>([rows[top].sha])
  for (let i = top; i < bottom; i++) if (anc.has(rows[i].sha)) rows[i].parents.forEach((p) => anc.add(p))
  // descendants of the older commit, walking up
  const desc = new Set<string>([rows[bottom].sha])
  for (let i = bottom - 1; i >= top; i--) if (rows[i].parents.some((p) => desc.has(p))) desc.add(rows[i].sha)
  const out: string[] = []
  for (let i = top; i <= bottom; i++) {
    const s = rows[i].sha
    if (i === top || i === bottom || (anc.has(s) && desc.has(s))) out.push(s)
  }
  return out
}
