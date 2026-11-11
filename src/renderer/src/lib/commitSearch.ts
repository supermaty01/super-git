// Commit search matching the original's: words of the message (summary + body), author name and e-mail are indexed;
// every word typed must be the start of an indexed word (a hex word of 4+ characters may also start the sha).

const SPLIT = /[\n\r\p{Z}\p{P}]+/u

export function searchTokens(text: string): string[] {
  return text.toLowerCase().split(SPLIT).filter(Boolean)
}

export interface QueryPart { subs: string[]; sha: boolean }

export function queryParts(query: string): QueryPart[] {
  const q = query.toLowerCase()
  const words = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? [...new Intl.Segmenter('en', { granularity: 'word' }).segment(q)].filter((s) => s.isWordLike).map((s) => s.segment)
    : q.split(/\s+/).filter(Boolean)
  return words.map((w) => ({ subs: searchTokens(w), sha: /^[\da-f]{4,}$/i.test(w) })).filter((p) => p.subs.length)
}

export interface SearchEntry { sha: string; terms: string[] }

export function searchEntry(c: { sha: string; summary: string; body: string; author: string; email: string }): SearchEntry {
  return { sha: c.sha.toLowerCase(), terms: [...new Set(searchTokens(`${c.summary}\n${c.body}\n${c.author}\n${c.email}`))] }
}

export function matchesQuery(e: SearchEntry, parts: QueryPart[]): boolean {
  return parts.length > 0 && parts.every((p) => p.subs.every((t) => e.terms.some((x) => x.startsWith(t)) || (p.sha && e.sha.startsWith(t))))
}
