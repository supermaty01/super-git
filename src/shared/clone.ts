// `git clone` arguments for the Clone dialog's options (the original's shallow clone / sparse checkout forms).

export interface CloneOptions {
  /** shallow clone: limit history by commit depth (default 1) or by a date */
  shallow?: boolean
  depth?: number
  /** YYYY-MM-DD; used instead of the depth when set */
  since?: string
  branch?: string
  recurse?: boolean
  /** extra flags typed by the user, exactly as on the command line */
  flags?: string
  /** sparse checkout: the paths to include (cone mode); empty = only the top-level files */
  sparse?: string[]
  /** fetch commits and trees only; blobs are fetched when needed */
  blobless?: boolean
}

/** Splits a command-line string into arguments: whitespace separates, single or double quotes group. */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let has = false
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") { quote = ch; has = true }
    else if (/\s/.test(ch)) { if (has || cur) out.push(cur); cur = ''; has = false }
    else { cur += ch; has = true }
  }
  if (has || cur) out.push(cur)
  return out
}

export function cloneArgs(url: string, dest: string, o: CloneOptions = {}): string[] {
  const args = ['clone', '--progress']
  if (o.shallow) {
    if (o.since?.trim()) args.push(`--shallow-since=${o.since.trim()}`)
    else args.push('--depth', String(Math.max(1, Math.floor(o.depth ?? 1))))
  }
  if (o.branch?.trim()) args.push('--branch', o.branch.trim())
  if (o.sparse) args.push('--sparse')
  if (o.blobless) args.push('--filter=blob:none')
  if (o.flags?.trim()) args.push(...splitArgs(o.flags))
  args.push('--', url, dest)
  return args
}

/** `YYYY-MM-DD` that is a real date and not in the future ('' when fine, else the original's message) */
export function sinceDateError(s: string, today = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
  if (!m || !d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return "Enter a valid date in 'YYYY-MM-DD' format"
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return d.getTime() > t ? 'Date cannot be in the future' : ''
}
