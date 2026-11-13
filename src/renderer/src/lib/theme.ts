import { setMonacoTheme } from './monaco'
import { setGraphTheme } from '../graph/colors'

export interface ThemeInfo { id: string; label: string; scheme: 'dark' | 'light' }

/** GitKraken's themes, in its order. 'dark' keeps its original SuperGit id (it is the High Contrast theme). */
export const THEMES: ThemeInfo[] = [
  { id: 'gk-dark', label: 'GitKraken Dark', scheme: 'dark' },
  { id: 'dark', label: 'GitKraken Dark - High Contrast', scheme: 'dark' },
  { id: 'light', label: 'GitKraken Light', scheme: 'light' },
  { id: 'light-legacy', label: 'GitKraken Light (Legacy)', scheme: 'light' },
  { id: 'light-hc-legacy', label: 'GitKraken Light - High Contrast (Legacy)', scheme: 'light' },
  { id: 'light-hc', label: 'GitKraken Light High Contrast', scheme: 'light' }
]
export const SYNC_THEME = { id: 'system', label: 'Sync with system' }

const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

/** the concrete theme for a saved id (resolves "Sync with system"; unknown ids fall back to the default) */
export function resolveTheme(id: string): ThemeInfo {
  if (id === 'system') return THEMES.find((t) => t.id === (dark?.matches === false ? 'light' : 'gk-dark'))!
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function applyTheme(id: string): void {
  const t = resolveTheme(id)
  const root = document.documentElement
  root.dataset.theme = t.scheme
  root.dataset.skin = t.id
  const bg = getComputedStyle(root).getPropertyValue('--app__bg0').trim()
  const ok = /^#[0-9a-f]{6}$/i.test(bg)
  const n = ok ? parseInt(bg.slice(1), 16) : 0
  if (ok) setGraphTheme([(n >> 16) & 255, (n >> 8) & 255, n & 255])
  setMonacoTheme(t.scheme, ok ? bg : undefined)
}

/** re-apply when the OS scheme flips while "Sync with system" is selected */
export function watchSystemTheme(getId: () => string, onChange: () => void): () => void {
  if (!dark) return () => undefined
  const h = (): void => { if (getId() === 'system') onChange() }
  dark.addEventListener('change', h)
  return () => dark.removeEventListener('change', h)
}
