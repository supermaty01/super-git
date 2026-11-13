/** Left panel filter matching, like GitKraken's: case-insensitive ordered subsequence, with the matched characters reported. */

/** indices of the characters of `text` that match `query` as an ordered subsequence (leftmost), or null when it does not match */
export function fuzzyMatch(text: string, query: string): number[] | null {
  const q = query.toLowerCase()
  if (!q) return []
  const t = text.toLowerCase()
  const out: number[] = []
  let from = 0
  for (const ch of q) {
    const i = t.indexOf(ch, from)
    if (i < 0) return null
    out.push(i)
    from = i + 1
  }
  return out
}

export interface FilterQuery {
  /** only branches of this remote can match (typed as `origin:xyz` or `origin/xyz`) */
  remote?: string
  /** what is matched against the names */
  text: string
}

/**
 * `origin:master` and `origin/master` limit the filter to the remote branches of `origin`
 * (everything else is filtered out); anything else is matched against all names.
 */
export function parseFilter(raw: string, remotes: string[]): FilterQuery {
  const q = raw.trim()
  for (const r of remotes) {
    const lower = q.toLowerCase()
    const name = r.toLowerCase()
    if (lower.startsWith(name + ':')) return { remote: r, text: q.slice(r.length + 1).trim() }
    if (lower.startsWith(name + '/')) return { remote: r, text: q.slice(r.length + 1).trim() }
  }
  return { text: q }
}

/** the part of `indices` that falls into text[start, start + len), relative to `start` */
export function slice(indices: number[] | undefined, start: number, len: number): Set<number> {
  const out = new Set<number>()
  if (indices) for (const i of indices) if (i >= start && i < start + len) out.add(i - start)
  return out
}

/** split `text` into runs, flagging the characters at the given positions as matches */
export function runs(text: string, marks: Set<number>): Array<{ text: string; match: boolean }> {
  const out: Array<{ text: string; match: boolean }> = []
  for (let i = 0; i < text.length; i++) {
    const match = marks.has(i)
    const last = out[out.length - 1]
    if (last && last.match === match && !match) last.text += text[i]
    else out.push({ text: text[i], match })
  }
  return out
}
