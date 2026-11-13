/** Fuzzy subsequence matching (fuzzaldrin-like): every query char must appear in order. */
export interface FuzzyHit { score: number; indices: number[] }

export function fuzzyMatch(label: string, query: string): FuzzyHit | null {
  const needle = query.replace(/\s+/g, '').toLowerCase()
  if (!needle) return { score: 0, indices: [] }
  const hay = label.toLowerCase()
  // a plain substring is always the best kind of match (with the query's own spaces, so "create tag" is one)
  const phrase = query.trim().toLowerCase().replace(/\s+/g, ' ')
  for (const q of phrase === needle ? [needle] : [phrase, needle]) {
    const sub = hay.indexOf(q)
    if (sub < 0) continue
    const at = sub === 0 ? -200 : /[\s/\\._-]/.test(hay[sub - 1]) ? -150 : -100
    const indices: number[] = []
    for (let i = 0; i < q.length; i++) if (q[i] !== ' ') indices.push(sub + i)
    return { score: at + sub, indices }
  }
  // is needle[k..] a subsequence of hay[from..]?
  const fits = (k: number, from: number): boolean => {
    for (let i = from; i < hay.length && k < needle.length; i++) if (hay[i] === needle[k]) k++
    return k === needle.length
  }
  if (!fits(0, 0)) return null
  // greedy subsequence, preferring word starts as long as the rest still matches
  const indices: number[] = []
  let pos = -1
  let score = 0
  for (let k = 0; k < needle.length; k++) {
    const ch = needle[k]
    let n = -1
    for (let i = pos + 1; i < hay.length; i++) {
      if (hay[i] !== ch) continue
      if (n < 0) n = i
      if ((i === 0 || /[\s/\\._-]/.test(hay[i - 1])) && fits(k + 1, i + 1)) { n = i; break }
    }
    if (n < 0) return null
    if (pos >= 0) score += (n - pos - 1) * 2
    indices.push(n)
    pos = n
  }
  return { score: score + hay.length - pos, indices }
}

/** filter + rank `items` by `query` (best first); items keep their order when the query is empty */
export function fuzzyFilter<T>(items: T[], query: string, label: (t: T) => string): Array<{ item: T; indices: number[] }> {
  if (!query.trim()) return items.map((item) => ({ item, indices: [] }))
  const out: Array<{ item: T; indices: number[]; score: number }> = []
  for (const item of items) {
    const m = fuzzyMatch(label(item), query)
    if (m) out.push({ item, indices: m.indices, score: m.score })
  }
  return out.sort((a, b) => a.score - b.score)
}
