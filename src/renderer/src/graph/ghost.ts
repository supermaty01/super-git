// Ghost labels: which branch label a commit without labels shows (on hover or when it is selected).
//
// Like the original: rows are walked top (newest) to bottom. A row carrying a branch label (local or
// remote; tags alone don't count) hands that label to each of its parents; a row without one hands down
// the label it got itself. A commit with several children takes it from the child it is the FIRST parent
// of before one it was merged into, and among those from the child that comes first (highest) in the graph.

export interface GhostRow {
  sha: string
  parents: string[]
  /** the row carries a branch label (local or remote) */
  branch: boolean
}

/** For every row, the index of the row whose labels its ghost label shows, or -1. */
export function ghostSources(rows: GhostRow[]): number[] {
  // per parent sha: the candidates handed down by its children so far
  const pending = new Map<string, { src: number; score: number; row: number }[]>()
  return rows.map((r, i) => {
    let src = -1
    const cands = pending.get(r.sha)
    if (cands?.length) {
      const best = cands.reduce((a, b) => (b.score < a.score || (b.score === a.score && b.row < a.row) ? b : a))
      src = best.src
      pending.delete(r.sha)
    }
    const hand = r.branch ? i : src
    if (hand >= 0) {
      r.parents.forEach((p, score) => {
        const l = pending.get(p) ?? []
        l.push({ src: hand, score, row: i })
        pending.set(p, l)
      })
    }
    return src
  })
}
