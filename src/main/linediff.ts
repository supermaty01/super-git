// Hunks computed with the editor's line diff (Monaco's default "advanced" algorithm, the one the
// original's diff editor uses) instead of git's Myers diff, so changed lines pair up and highlight the
// same way. Pure functions, unit-testable under Node.
import { DefaultLinesDiffComputer } from 'monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js'
import type { DiffHunk, DiffLine } from '../shared/types'

/** marks the last line of a file without a final newline when the other side has one, so they differ */
const NO_EOL = '\u0000'

function splitText(text: string): { lines: string[]; eol: boolean } {
  if (!text.length) return { lines: [], eol: true }
  const eol = text.endsWith('\n')
  return { lines: (eol ? text.slice(0, -1) : text).split('\n'), eol }
}

type Range = [number, number]

function addRange(map: Map<number, Range[]>, line: number, s: number, e: number): void {
  if (e <= s) return
  const list = map.get(line) ?? []
  const last = list[list.length - 1]
  if (last && s <= last[1]) last[1] = Math.max(last[1], e)
  else list.push([s, e])
  map.set(line, list)
}

/**
 * Unified-diff hunks (with `context` lines around each change, nearby changes merged like git does)
 * from the editor's line diff of two texts. Changed lines carry `ranges`: the changed characters.
 * Returns null when a side is empty or the algorithm ran out of time (callers keep git's hunks).
 */
export function editorHunks(original: string, modified: string, opts: { ignoreTrimWhitespace?: boolean; context?: number; timeoutMs?: number } = {}): DiffHunk[] | null {
  const ctx = opts.context ?? 3
  const a = splitText(original), b = splitText(modified)
  // the editor's diff expects at least one line a side; an emptied or new file diffs the same anyway
  if (!a.lines.length || !b.lines.length) return null
  const ca = a.lines.slice(), cb = b.lines.slice()
  if (a.eol !== b.eol) {
    if (!a.eol && ca.length) ca[ca.length - 1] += NO_EOL
    if (!b.eol && cb.length) cb[cb.length - 1] += NO_EOL
  }
  const result = new DefaultLinesDiffComputer().computeDiff(ca, cb, {
    ignoreTrimWhitespace: !!opts.ignoreTrimWhitespace,
    maxComputationTimeMs: opts.timeoutMs ?? 3000,
    computeMoves: false
  })
  if (result.hitTimeout) return null
  const changes = result.changes.map((c) => ({
    oS: c.original.startLineNumber - 1, oE: c.original.endLineNumberExclusive - 1,
    mS: c.modified.startLineNumber - 1, mE: c.modified.endLineNumberExclusive - 1,
    inner: c.innerChanges
  }))

  // changed characters per line (0-based line -> [start, end) ranges), only where both sides have lines
  const oldMarks = new Map<number, Range[]>(), newMarks = new Map<number, Range[]>()
  const spread = (map: Map<number, Range[]>, lines: string[], r: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) => {
    for (let ln = r.startLineNumber; ln <= r.endLineNumber; ln++) {
      const len = lines[ln - 1]?.length ?? 0
      const s = ln === r.startLineNumber ? r.startColumn - 1 : 0
      const e = ln === r.endLineNumber ? r.endColumn - 1 : len
      addRange(map, ln - 1, Math.min(s, len), Math.min(e, len))
    }
  }
  for (const c of changes) {
    if (c.oE === c.oS || c.mE === c.mS) continue
    for (let i = c.oS; i < c.oE; i++) oldMarks.set(i, [])
    for (let j = c.mS; j < c.mE; j++) newMarks.set(j, [])
    for (const m of c.inner ?? []) { spread(oldMarks, a.lines, m.originalRange); spread(newMarks, b.lines, m.modifiedRange) }
  }

  // group changes whose surrounding context would touch or overlap
  const groups: Array<typeof changes> = []
  for (const c of changes) {
    const g = groups[groups.length - 1]
    if (g && c.oS - g[g.length - 1].oE <= 2 * ctx) g.push(c)
    else groups.push([c])
  }

  const aLast = a.lines.length - 1, bLast = b.lines.length - 1
  const hunks: DiffHunk[] = []
  for (const g of groups) {
    const first = g[0]
    const lines: DiffLine[] = []
    const context = (from: number, to: number, shift: number) => {
      for (let i = from; i < to; i++) {
        const j = i + shift
        lines.push({ type: 'context', content: b.lines[j] ?? a.lines[i], oldLine: i + 1, newLine: j + 1 })
        if ((i === aLast && !a.eol) || (j === bLast && !b.eol)) lines.push({ type: 'nonewline', content: '\\ No newline at end of file' })
      }
    }
    const preStart = Math.max(0, first.oS - ctx)
    context(preStart, first.oS, first.mS - first.oS)
    g.forEach((c, k) => {
      for (let i = c.oS; i < c.oE; i++) {
        const ranges = oldMarks.get(i)
        lines.push({ type: 'del', content: a.lines[i], oldLine: i + 1, ...(ranges ? { ranges } : {}) })
        if (i === aLast && !a.eol) lines.push({ type: 'nonewline', content: '\\ No newline at end of file' })
      }
      for (let j = c.mS; j < c.mE; j++) {
        const ranges = newMarks.get(j)
        lines.push({ type: 'add', content: b.lines[j], newLine: j + 1, ...(ranges ? { ranges } : {}) })
        if (j === bLast && !b.eol) lines.push({ type: 'nonewline', content: '\\ No newline at end of file' })
      }
      const next = g[k + 1]
      context(c.oE, next ? next.oS : Math.min(a.lines.length, c.oE + ctx), c.mE - c.oE)
    })
    const oldLines = lines.filter((l) => l.type === 'context' || l.type === 'del').length
    const newLines = lines.filter((l) => l.type === 'context' || l.type === 'add').length
    // git's header: the start is the line before an empty range, and a count of 1 is left out
    const oldStart = oldLines ? preStart + 1 : preStart
    const newStart = newLines ? preStart + (first.mS - first.oS) + 1 : preStart + (first.mS - first.oS)
    const span = (s: number, n: number) => (n === 1 ? `${s}` : `${s},${n}`)
    hunks.push({ header: `@@ -${span(oldStart, oldLines)} +${span(newStart, newLines)} @@`, oldStart, oldLines, newStart, newLines, lines })
  }
  return hunks
}

/**
 * True when applying `hunks` to `original` gives `modified` line for line: git's diff was taken on the
 * same text the editor diff sees (no clean filters such as autocrlf or LFS changed it on the way).
 */
export function hunksReproduce(original: string, modified: string, hunks: DiffHunk[]): boolean {
  const a = splitText(original).lines, b = splitText(modified).lines
  const out: string[] = []
  let pos = 0
  for (const h of hunks) {
    const start = h.oldLines ? h.oldStart - 1 : h.oldStart
    if (start < pos || start > a.length) return false
    while (pos < start) out.push(a[pos++])
    for (const l of h.lines) {
      if (l.type === 'context' || l.type === 'del') {
        if (a[pos] !== l.content) return false
        pos++
      }
      if (l.type === 'context' || l.type === 'add') out.push(l.content)
    }
  }
  while (pos < a.length) out.push(a[pos++])
  return out.length === b.length && out.every((l, i) => l === b[i])
}
