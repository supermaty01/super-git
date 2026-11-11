// Decorations on top of syntax-coloured HTML lines (Monaco's colorize output: flat <span class="mtkN">
// runs with &nbsp; / &lt; / &gt; / &amp; entities). Pure string processing so it can be unit tested.

/**
 * Rebuilds `html`, wrapping runs of characters for which `classOf` returns the same class name in
 * `<span class="…">`. Character indexes count decoded characters (an entity is one character), and
 * `tokenClass` is the class of the innermost enclosing span, so callers can skip comments or strings.
 */
export function decorateHtml(html: string, classOf: (index: number, ch: string, tokenClass: string | null) => string | null): string {
  let out = ''
  let index = 0
  let run: string | null = null
  const stack: Array<string | null> = []
  const close = () => { if (run !== null) { out += '</span>'; run = null } }
  for (let i = 0; i < html.length;) {
    const c = html[i]
    if (c === '<') {
      const end = html.indexOf('>', i)
      const tag = html.slice(i, end + 1)
      close()
      if (tag.startsWith('</')) stack.pop()
      else if (!tag.endsWith('/>')) stack.push(/class="([^"]*)"/.exec(tag)?.[1] ?? stack[stack.length - 1] ?? null)
      out += tag
      i = end + 1
      continue
    }
    let ch = c
    let raw = c
    if (c === '&') {
      const end = html.indexOf(';', i)
      if (end > i && end - i < 10) {
        raw = html.slice(i, end + 1)
        ch = raw === '&nbsp;' ? ' ' : raw === '&lt;' ? '<' : raw === '&gt;' ? '>' : raw === '&amp;' ? '&' : raw === '&quot;' ? '"' : raw === '&#39;' ? "'" : '?'
      }
    }
    const cls = classOf(index, ch, stack[stack.length - 1] ?? null)
    if (cls !== run) { close(); if (cls !== null) { out += `<span class="${cls}">`; run = cls } }
    out += raw
    i += raw.length
    index++
  }
  close()
  return out
}

const OPEN = '([{'
const CLOSE = ')]}'

/**
 * Colours brackets by nesting depth across all lines (the editor's bracket pair colourisation: three
 * colours cycling with depth). Brackets inside tokens of `skipClasses` (comments, strings) are left alone.
 */
export function colorBrackets(lines: string[], skipClasses: Set<string>): string[] {
  let depth = 0
  return lines.map((html) => decorateHtml(html, (_i, ch, token) => {
    if (token && skipClasses.has(token)) return null
    if (OPEN.includes(ch)) return `bracket-${depth++ % 3}`
    if (CLOSE.includes(ch)) { depth = Math.max(0, depth - 1); return `bracket-${depth % 3}` }
    return null
  }))
}

/** Wraps the given [start, end) character ranges of a line in `cls`. */
export function markRanges(html: string, ranges: Array<[number, number]>, cls: string): string {
  if (!ranges.length) return html
  return decorateHtml(html, (i) => (ranges.some(([s, e]) => i >= s && i < e) ? cls : null))
}

/** Word-level difference between two versions of a line: the changed [start, end) ranges on each side. */
export function wordDiff(a: string, b: string): { removed: Array<[number, number]>; added: Array<[number, number]> } {
  const split = (s: string) => s.match(/\w+|\s+|[^\w\s]/g) ?? []
  const ta = split(a), tb = split(b)
  if (ta.length * tb.length > 250_000) return { removed: [[0, a.length]], added: [[0, b.length]] }
  // longest common subsequence of tokens
  const n = ta.length, m = tb.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const removed: Array<[number, number]> = [], added: Array<[number, number]> = []
  const push = (list: Array<[number, number]>, s: number, len: number) => {
    const last = list[list.length - 1]
    if (last && last[1] === s) last[1] = s + len
    else list.push([s, s + len])
  }
  let i = 0, j = 0, pa = 0, pb = 0
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) { pa += ta[i].length; pb += tb[j].length; i++; j++ }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { push(added, pb, tb[j].length); pb += tb[j].length; j++ }
    else { push(removed, pa, ta[i].length); pa += ta[i].length; i++ }
  }
  // whitespace-only fragments between changes read better merged
  return { removed: tidy(removed, a), added: tidy(added, b) }
}

function tidy(ranges: Array<[number, number]>, s: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const r of ranges) {
    const last = out[out.length - 1]
    if (last && /^\s*$/.test(s.slice(last[1], r[0]))) last[1] = r[1]
    else out.push([r[0], r[1]])
  }
  return out.filter(([st, e]) => !/^\s*$/.test(s.slice(st, e)))
}
