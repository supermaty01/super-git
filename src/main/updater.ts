// Automatic updates from the GitHub releases (electron-updater): check in the background, download quietly,
// and offer "Restart to update" once the new version is ready. Installed copies only (not the portable build).
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import { getSettings, flushSettings } from './settings'
import type { UpdateState } from '../shared/types'

let status: UpdateState = { state: 'idle' }
let win: BrowserWindow | null = null
let manual = false
let timer: NodeJS.Timeout | null = null
/** for the File menu: "Check for Update (Last checked …)" / "Update Errored (…)" */
const times = { lastChecked: null as number | null, errorTime: null as number | null }
const listeners: Array<() => void> = []

const send = () => { win?.webContents.send('update', { ...status, manual }); listeners.forEach((l) => l()) }

/** why this copy cannot update itself, or null */
function unsupported(): string | null {
  if (process.env.SUPERGIT_UPDATE_TEST) return null
  if (!app.isPackaged) return 'Updates are only available in the installed app.'
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'The portable version does not update itself: download the new one from the releases page.'
  return null
}

function set(s: UpdateState) {
  if (s.state === 'none') { times.lastChecked = Date.now(); times.errorTime = null }
  if (s.state === 'error') { times.errorTime = Date.now(); times.lastChecked = null }
  status = s
  send()
}

export function initUpdater(w: BrowserWindow): void {
  win = w
  const why = unsupported()
  if (why) { status = { state: 'unsupported', reason: why }; return }
  if (process.env.SUPERGIT_UPDATE_TEST) {
    // development check against the real releases, pretending to be the given (older) version
    autoUpdater.forceDevUpdateConfig = true
    const cfg = path.join(app.getPath('userData'), 'dev-app-update.yml')
    writeFileSync(cfg, 'provider: github\nowner: supermaty01\nrepo: super-git\nupdaterCacheDirName: super-git-updater-test\n')
    autoUpdater.updateConfigPath = cfg
    // the updater's own SemVer class, so comparisons and formatting keep working
    const u = autoUpdater as unknown as { currentVersion: { constructor: new (v: string) => unknown } }
    u.currentVersion = new u.currentVersion.constructor(process.env.SUPERGIT_UPDATE_TEST) as typeof u.currentVersion
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = null
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-not-available', (i) => set({ state: 'none', version: i.version }))
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => { if (status.state === 'downloading') set({ ...status, percent: Math.round(p.percent) }) })
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => set({ state: 'error', message: String(e?.message ?? e).split('\n')[0] }))

  // first check shortly after start, then every 4 hours
  setTimeout(() => { if (getSettings().autoUpdate !== false) void check(false) }, 15_000)
  timer = setInterval(() => { if (getSettings().autoUpdate !== false && status.state !== 'ready') void check(false) }, 4 * 60 * 60_000)
  app.on('before-quit', () => { if (timer) clearInterval(timer) })
}

export async function check(isManual: boolean): Promise<UpdateState> {
  manual = isManual
  if (status.state === 'unsupported') { send(); return status }
  if (status.state === 'ready' || status.state === 'downloading') { send(); return status }
  try { await autoUpdater.checkForUpdates() } catch (e) { if (status.state !== 'error') set({ state: 'error', message: String((e as Error)?.message ?? e).split('\n')[0] }) }
  return status
}

export function getStatus(): UpdateState { return status }
export function getTimes(): { lastChecked: number | null; errorTime: number | null } { return { ...times } }
/** called whenever the state changes (the application menu follows it) */
export function onChange(cb: () => void): void { listeners.push(cb) }

/** restart into the downloaded version (silent install, then SuperGit starts again) */
export async function installNow(): Promise<void> {
  if (status.state !== 'ready') return
  await flushSettings()
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
