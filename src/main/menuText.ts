// Labels for the update entries of the File menu (pure, so it can be unit tested).
import type { UpdateState } from '../shared/types'

/** relative time the way the original words it (moment's fromNow) */
export function fromNow(then: number, now = Date.now()): string {
  const s = Math.max(0, (now - then) / 1000)
  const m = s / 60, h = m / 60, d = h / 24
  const r = Math.round
  if (s < 45) return 'a few seconds ago'
  if (s < 90) return 'a minute ago'
  if (m < 45) return `${r(m)} minutes ago`
  if (m < 90) return 'an hour ago'
  if (h < 22) return `${r(h)} hours ago`
  if (h < 36) return 'a day ago'
  if (d < 26) return `${r(d)} days ago`
  if (d < 45) return 'a month ago'
  if (d < 320) return `${r(d / 30.4375)} months ago`
  if (d < 548) return 'a year ago'
  return `${r(d / 365.25)} years ago`
}

export interface UpdateMenuItem { label: string; enabled: boolean; action?: 'check' | 'install' }

/**
 * The original's File menu update entries (Windows template): "Checking for updates...",
 * "Restart and Install Update", "Check for Update (Last checked …)", "Update Errored (…)",
 * "Downloading Update...". None when this copy cannot update itself.
 */
export function updateMenuItems(st: UpdateState, times: { lastChecked: number | null; errorTime: number | null }, now = Date.now()): UpdateMenuItem[] {
  if (st.state === 'unsupported') return []
  const items: UpdateMenuItem[] = []
  if (st.state === 'checking') items.push({ label: 'Checking for updates...', enabled: false })
  if (st.state === 'ready') items.push({ label: 'Restart and Install Update', enabled: true, action: 'install' })
  if (st.state === 'idle' || st.state === 'none' || st.state === 'error') {
    const last = times.lastChecked && st.state !== 'error' ? ` (Last checked ${fromNow(times.lastChecked, now)})` : ''
    items.push({ label: `Check for Update${last}`, enabled: true, action: 'check' })
  }
  if (st.state === 'error') items.push({ label: `Update Errored${times.errorTime ? ` (${fromNow(times.errorTime, now)})` : ''}`, enabled: false })
  if (st.state === 'downloading') items.push({ label: 'Downloading Update...', enabled: false })
  return items
}
