/**
 * Relative age the way GitKraken labels its graph time markers: always rounded down, "yesterday" for
 * one day, weeks until a full calendar month has passed, then months and years.
 */
export function relTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 60) return 'a few seconds ago'
  const m = Math.floor(s / 60)
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`
  const h = Math.floor(m / 60)
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`
  const d = Math.floor(h / 24)
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`
  const mo = monthsBetween(new Date(ms), new Date(now))
  if (mo < 1) { const w = Math.floor(d / 7); return w === 1 ? 'a week ago' : `${w} weeks ago` }
  if (mo < 12) return mo === 1 ? 'a month ago' : `${mo} months ago`
  const y = Math.floor(mo / 12)
  return y === 1 ? 'a year ago' : `${y} years ago`
}

/** Whole calendar months from `a` to `b` (10 Oct 09:00 → 10 Nov 08:59 is 0, → 10 Nov 09:00 is 1). */
function monthsBetween(a: Date, b: Date): number {
  let n = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  const shifted = new Date(a.getTime())
  shifted.setMonth(a.getMonth() + n)
  if (shifted.getTime() > b.getTime()) n--
  return Math.max(0, n)
}

let dateStyle: 'locale' | 'mdy' | 'dmy' | 'ymd' = 'locale'
const localeDate = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
let timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: false })

/** Preferences → UI Customization → date and time format */
export function setDateFormat(style: typeof dateStyle, clock: '24h' | '12h'): void {
  dateStyle = style
  timeFmt = new Intl.DateTimeFormat(clock === '12h' ? 'en-US' : undefined, { hour: 'numeric', minute: '2-digit', hour12: clock === '12h' })
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  switch (dateStyle) {
    case 'mdy': return `${mm}/${dd}/${yyyy}`
    case 'dmy': return `${dd}/${mm}/${yyyy}`
    case 'ymd': return `${yyyy}-${mm}-${dd}`
    default: return localeDate.format(d)
  }
}

export function fullDate(ms: number): string {
  const d = new Date(ms)
  return `${formatDate(d)} @ ${timeFmt.format(d)}`
}

export function shortSha(sha: string): string { return sha.slice(0, 6) }

export function basename(p: string): string { return p.split(/[\\/]/).filter(Boolean).pop() ?? p }
export function dirname(p: string): string {
  const parts = p.split('/')
  parts.pop()
  return parts.join('/')
}

export function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e).trim()
}

/** "On main: park wip" / "WIP on main: 1a2b3c msg" -> the message as shown in the UI and the branch it was made on */
export function parseStash(message: string): { msg: string; branch?: string } {
  const m = /^(?:WIP on|On) ([^:]+): (.*)$/s.exec(message)
  if (!m) return { msg: message }
  return { msg: m[2].replace(/^[0-9a-f]{7,40} /, ''), branch: m[1] }
}

/** key under which a hidden stash is remembered next to the hidden branches */
export const stashKey = (sha: string) => `stash:${sha}`
