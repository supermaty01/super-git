// Commit graph lane assignment. Pure and deterministic so it can be unit tested.
//
// Rows are processed top (newest) to bottom. Each lane "expects" the sha of the next commit that will
// appear in it, and a line keeps its lane all the way down to that commit's row. A commit nothing
// expects (a branch tip) takes the left-most free lane.
//
// Where several lines meet at one commit (see `winner`):
//  - a lane a merge commit committed to wins: its first parent if nobody reached for it before, the fresh
//    lane it opens for an extra parent, or the lane its merge line joins;
//  - otherwise the lane that reached for the commit first, unless a line further left reaches it too and
//    may take it over: a plain line, or a stash that reached for it later. Lines coming down from a merge
//    commit, merged side branches returning to the commit they were merged onto, and lanes a stash opened
//    never take a commit over;
//  - the dashed line of a stash or of the work-in-progress row only decides on its own when nothing else
//    reaches the commit.
// This reproduces the original's layout row for row on real histories (see the fixture tests).
//
// The first parent continues in the commit's lane. Extra parents (merges) join the line already on its
// way to them — the one that parent would be drawn in — or open a new lane.

export interface LayoutCommit {
  sha: string
  parents: string[]
}

export type Edge =
  /** vertical segment within a lane; y in row units 0 (top) .. 1 (bottom) */
  | { t: 'v'; lane: number; from: 0 | 0.5; to: 0.5 | 1; dashed?: boolean }
  /** a line coming down lane `lane` that bends into the node */
  | { t: 'in'; lane: number; node: number; dashed?: boolean }
  /** a line leaving the node that bends down into lane `lane` */
  | { t: 'out'; lane: number; node: number; dashed?: boolean }

export interface LayoutRow {
  lane: number
  edges: Edge[]
  /** number of lanes in use on this row (for sizing) */
  width: number
}

export interface Layout {
  rows: LayoutRow[]
  maxLanes: number
}

export interface LayoutOptions {
  /** rows whose connection to their parent is drawn dashed (WIP, stashes) */
  dashedRows?: Set<number>
  /** sha of a branch tip pinned to the left-most lane */
  pinnedTip?: string | null
}

/** A line running down a lane towards the commit it expects. */
interface Line {
  sha: string
  /** row at which this lane started expecting `sha` */
  claimRow: number
  /** a claim made by a merge commit: no other line can take the commit over */
  locked: boolean
  /** the line comes straight down from a merge commit: it never takes a commit over */
  fromMerge: boolean
  /** set on a merged side branch: the commit it was merged onto (it never takes that one over) */
  mergedOnto: string | null
  dashed: boolean
  /** the line continues a lane a stash opened: it never takes a commit over */
  fromStash: boolean
}

export function computeLayout(commits: LayoutCommit[], dashedFirst: boolean | LayoutOptions = false): Layout {
  const opts: LayoutOptions = typeof dashedFirst === 'boolean' ? { dashedRows: dashedFirst ? new Set([0]) : undefined } : dashedFirst
  const lanes: (Line | null)[] = []
  // pinned branch: lane 0 is reserved for its first-parent chain
  let reserve0 = false
  if (opts.pinnedTip && commits.some((c) => c.sha === opts.pinnedTip)) {
    lanes.push({ sha: opts.pinnedTip, claimRow: -1, locked: true, fromMerge: false, mergedOnto: null, dashed: false, fromStash: false })
    reserve0 = true
  }
  const rows: LayoutRow[] = []
  let maxLanes = 0

  const freeLane = (): number => {
    const i = lanes.findIndex((l, idx) => l === null && !(reserve0 && idx === 0))
    if (i >= 0) return i
    lanes.push(null)
    return lanes.length - 1
  }
  const expected = (sha: string) => lanes.some((l) => l !== null && l.sha === sha)

  /** Which of the lanes waiting for `sha` it is drawn in. */
  const winner = (waiting: number[], sha: string): number => {
    // a stash or the work-in-progress row only decides where its commit goes when nothing else reaches it
    const solid = waiting.filter((i) => !lanes[i]!.dashed)
    const cands = solid.length ? solid : waiting
    const earliest = (list: number[]) => list.reduce((a, b) => (lanes[a]!.claimRow <= lanes[b]!.claimRow ? a : b))
    // a lane a merge commit committed to wins; otherwise the lane that reached for the commit first…
    const locked = cands.filter((i) => lanes[i]!.locked)
    let w = earliest(locked.length ? locked : cands)
    if (lanes[w]!.locked) return w
    // …unless a line further left reaches it too: a plain line, or a stash that reached for it later.
    // Merge lines, side branches returning to the commit they were merged onto, and lanes a stash opened don't.
    const claim = lanes[w]!.claimRow
    const left = waiting.find((i) => {
      const l = lanes[i]!
      if (i >= w || l.fromMerge || l.mergedOnto === sha) return false
      if (l.dashed) return l.claimRow > claim
      return !l.fromStash
    })
    if (left !== undefined) w = left
    return w
  }

  commits.forEach((c, rowIdx) => {
    const edges: Edge[] = []
    const matching: number[] = []
    lanes.forEach((l, i) => { if (l !== null && l.sha === c.sha) matching.push(i) })

    let node: number
    const hadTop = matching.length > 0
    if (hadTop) node = winner(matching, c.sha)
    else node = freeLane()

    const own = hadTop ? lanes[node]! : null
    const nodeTopDashed = own?.dashed ?? false

    // lanes passing through (not involved with this commit)
    lanes.forEach((l, i) => {
      if (l !== null && l.sha !== c.sha) edges.push({ t: 'v', lane: i, from: 0, to: 1, dashed: l.dashed || undefined })
    })

    // converging lanes (other children of this commit)
    for (const m of matching) {
      if (m === node) continue
      edges.push({ t: 'in', lane: m, node, dashed: lanes[m]!.dashed || undefined })
      lanes[m] = null
    }

    if (hadTop) edges.push({ t: 'v', lane: node, from: 0, to: 0.5, dashed: nodeTopDashed || undefined })

    const isDashedNode = !!opts.dashedRows?.has(rowIdx)
    const [p0, ...rest] = c.parents
    const isMerge = rest.length > 0
    lanes[node] = null
    if (p0) {
      lanes[node] = {
        sha: p0,
        claimRow: rowIdx,
        locked: isMerge && !expected(p0),
        fromMerge: isMerge,
        mergedOnto: isMerge ? null : own?.mergedOnto ?? null,
        dashed: isDashedNode,
        fromStash: !isMerge && !!own && (own.dashed || own.fromStash)
      }
      edges.push({ t: 'v', lane: node, from: 0.5, to: 1, dashed: isDashedNode || undefined })
    } else if (node === 0) reserve0 = false

    for (const p of rest) {
      const waiting = lanes.map((l, i) => (i !== node && l !== null && l.sha === p ? i : -1)).filter((i) => i >= 0)
      let target: number
      if (!waiting.length) {
        target = freeLane()
        lanes[target] = { sha: p, claimRow: rowIdx, locked: true, fromMerge: false, mergedOnto: p0 ?? null, dashed: false, fromStash: false }
      } else {
        // lines already on their way to this parent: the merge line joins the one the parent would be drawn
        // in, which now belongs to the side branch being merged here, and the parent stays there
        target = winner(waiting, p)
        lanes[target]!.mergedOnto = p0 ?? null
        lanes[target]!.locked = true
      }
      edges.push({ t: 'out', lane: target, node })
    }

    // trim trailing free lanes (lane 0 stays while reserved for the pinned branch)
    while (lanes.length > (reserve0 ? 1 : 0) && lanes[lanes.length - 1] === null) lanes.pop()
    const width = Math.max(lanes.length, node + 1, ...edges.map((e) => e.lane + 1))
    maxLanes = Math.max(maxLanes, width)
    rows.push({ lane: node, edges, width })
  })

  return { rows, maxLanes }
}
