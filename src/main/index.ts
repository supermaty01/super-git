import { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, nativeImage, nativeTheme } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { spawn } from 'node:child_process'
import { watch, FSWatcher, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as git from './git'
import * as providers from './providers'
import { setGitPath, findGit, READ_ONLY } from './gitcore'
import { scanGitKraken } from './gitkraken'
import { buildAppMenu, setMenuState } from './appmenu'
import * as ex from './extras'
import * as term from './terminal'
import { getSettings, updateSettings, flushSettings, addRecent } from './settings'
import type { Api } from '../shared/api'
import type { MenuItemSpec } from '../shared/types'

// Isolated profile (used for automated testing / side-by-side instances): settings, lock and caches live elsewhere.
if (process.env.SUPERGIT_USER_DATA) app.setPath('userData', process.env.SUPERGIT_USER_DATA)

let win: BrowserWindow | null = null

function createWindow(): void {
  const s = getSettings()
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: s.theme === 'light' ? '#fcfcfc' : '#090A0B',
    title: 'SuperGit',
    icon: nativeImage.createFromPath(path.join(__dirname, '../../build/icon.png')),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(getSettings().zoom))
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win?.webContents.toggleDevTools(); e.preventDefault()
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// ---------------------------------------------------------------------------------------------
// Undo / redo of local operations

interface UndoEntry { label: string; undo: () => Promise<void>; redo: () => Promise<void> }
const stacks = new Map<string, { undo: UndoEntry[]; redo: UndoEntry[] }>()
function stackFor(p: string) {
  const k = p.toLowerCase()
  if (!stacks.has(k)) stacks.set(k, { undo: [], redo: [] })
  return stacks.get(k)!
}
function record(p: string, e: UndoEntry) {
  const s = stackFor(p)
  s.undo.push(e)
  if (s.undo.length > 50) s.undo.shift()
  s.redo = []
}
/** Runs an op that may move HEAD and records an undo entry when it does. */
async function trackHead<T extends { ok?: boolean }>(p: string, label: string, op: () => Promise<T>): Promise<T> {
  const before = (await git.getHead(p)).sha
  const res = await op()
  const after = (await git.getHead(p)).sha
  if (res.ok !== false && before && after && before !== after) {
    record(p, { label, undo: () => git.resetKeep(p, before), redo: () => git.resetKeep(p, after) })
    await syncSubmodules(p)
  }
  return res
}

/** "Keep submodules up to date": update submodules after a git action moved HEAD */
async function syncSubmodules(p: string): Promise<void> {
  if (!getSettings().updateSubmodules || !existsSync(path.join(p, '.gitmodules'))) return
  await git.net(p, 'submodule', ['submodule', 'update', '--init', '--recursive'], { allowFail: true })
}

async function headRef(p: string): Promise<string> {
  const h = await git.getHead(p)
  return h.branch ?? h.sha
}

// ---------------------------------------------------------------------------------------------
// Watchers

const watchers = new Map<string, { list: FSWatcher[]; timer: NodeJS.Timeout | null; refs: number }>()
const IGNORE = /(^|[\\/])\.git[\\/](objects|logs|lfs)([\\/]|$)|\.lock$|(^|[\\/])node_modules([\\/]|$)|(^|[\\/])\.vs([\\/]|$)/

async function startWatch(p: string) {
  const key = p.toLowerCase()
  const existing = watchers.get(key)
  if (existing) { existing.refs++; return }
  const entry = { list: [] as FSWatcher[], timer: null as NodeJS.Timeout | null, refs: 1 }
  watchers.set(key, entry)
  const notify = (file: string | null) => {
    if (file && IGNORE.test(file)) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => win?.webContents.send('repo-changed', p), 350)
  }
  const add = (dir: string) => {
    try { entry.list.push(watch(dir, { recursive: true }, (_e, f) => notify(f ? String(f) : null))) } catch { /* ignore */ }
  }
  add(p)
  const info = await git.resolveRepo(p)
  if (info && !info.gitDir.toLowerCase().startsWith(p.toLowerCase())) {
    add(info.gitDir)
    const common = path.join(info.gitDir, '..', '..') // <main>/.git for worktrees
    if (existsSync(path.join(common, 'refs'))) add(path.join(common, 'refs'))
  }
}
function stopWatch(p: string) {
  const key = p.toLowerCase()
  const e = watchers.get(key)
  if (!e) return
  if (--e.refs > 0) return
  e.list.forEach((w) => w.close())
  if (e.timer) clearTimeout(e.timer)
  watchers.delete(key)
}

// ---------------------------------------------------------------------------------------------
// Context menus (native, like the original)

function buildMenu(items: MenuItemSpec[], pick: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map((it) => {
    if (it.type === 'separator') return { type: 'separator' as const }
    return {
      label: it.label,
      type: it.type === 'checkbox' ? 'checkbox' as const : 'normal' as const,
      checked: it.checked,
      enabled: it.enabled !== false,
      accelerator: it.accelerator,
      registerAccelerator: false,
      submenu: it.submenu ? buildMenu(it.submenu, pick) : undefined,
      click: it.submenu ? undefined : () => it.id && pick(it.id)
    }
  })
}

function openTerminal(p: string): Promise<void> {
  const custom = getSettings().externalTerminal.trim()
  if (custom) {
    // user command; {path} is replaced with the quoted repository path (otherwise it runs in that folder)
    const cmd = custom.includes('{path}') ? custom.split('{path}').join(`"${p}"`) : custom
    const child = spawn(cmd, { cwd: p, shell: true, detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const child = spawn('wt.exe', ['-d', p], { detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', () => {
      const ps = spawn('cmd.exe', ['/c', 'start', '""', 'powershell.exe', '-NoExit', '-Command', `Set-Location -LiteralPath '${p.replace(/'/g, "''")}'`], { detached: true, stdio: 'ignore' })
      ps.unref()
      resolve()
    })
    child.on('spawn', () => { child.unref(); resolve() })
  })
}

// ---------------------------------------------------------------------------------------------
// API implementation

const api: Api = {
  async pickDirectory(title, defaultPath) {
    const r = await dialog.showOpenDialog(win!, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  },
  showContextMenu(items) {
    return new Promise((resolve) => {
      let done = false
      const finish = (v: string | null) => { if (!done) { done = true; resolve(v) } }
      const menu = Menu.buildFromTemplate(buildMenu(items, (id) => finish(id)))
      menu.popup({ window: win!, callback: () => setTimeout(() => finish(null), 50) })
    })
  },
  async confirm(o) {
    const r = await dialog.showMessageBox(win!, {
      type: o.type ?? 'question', title: o.title, message: o.message, detail: o.detail, buttons: o.buttons,
      defaultId: o.defaultId ?? 0, cancelId: o.cancelId ?? o.buttons.length - 1, noLink: true
    })
    return r.response
  },
  async openExternal(url) { if (/^https?:\/\//.test(url)) await shell.openExternal(url) },
  async showInFolder(p) { shell.showItemInFolder(p) },
  async openFile(p) { await shell.openPath(p) },
  openTerminal,
  async copy(text) { clipboard.writeText(text) },
  async setZoom(z) {
    const zoom = Math.min(2, Math.max(0.6, Math.round(z * 100) / 100))
    updateSettings({ zoom })
    win?.webContents.setZoomFactor(zoom)
    win?.webContents.send('zoom', zoom)
  },
  async getVersion() { return app.getVersion() },

  async getSettings() { return getSettings() },
  async setSettings(patch) {
    if (patch.gitPath !== undefined) setGitPath(patch.gitPath)
    return updateSettings(patch)
  },
  async addRecent(p, name) { addRecent(p, name) },

  gitConfigGet: (key, repo) => git.getConfig(repo ?? os.homedir(), key),
  gitConfigSet: (key, value, repo) => git.setConfig(repo ?? os.homedir(), key, value, !repo),

  providerConnect: (p, o) => providers.connect(p, o),
  providerDisconnect: (p) => providers.disconnect(p),
  providerRepos: (p) => providers.listRepos(p),
  gitkrakenScan: () => scanGitKraken(),
  async setMenuState(st) { setMenuState(win, st) },
  async showAbout() {
    const r = await git.g(os.homedir(), ['--version'], { allowFail: true })
    await dialog.showMessageBox(win!, { type: 'info', title: `About ${app.getName()}`, message: `${app.getName()} ${app.getVersion()}`, detail: `A local-only Git client.

${r.stdout.trim()}
Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`, buttons: ['OK'] })
  },
  async gitInfo() {
    const r = await git.g(os.homedir(), ['--version'], { allowFail: true })
    return { path: findGit(), version: r.stdout.trim().replace(/^git version /, ''), readOnly: READ_ONLY }
  },

  resolveRepo: (p) => git.resolveRepo(p),
  async initRepo(dir, opts) { await git.initRepo(dir, opts); return dir },
  async cloneRepo(url, dest, opts) { await git.cloneRepo(url, dest, opts); return dest },
  async watch(p) { await startWatch(p) },
  async unwatch(p) { stopWatch(p) },

  snapshot: (p, limit) => git.getSnapshot(p, limit),
  async status(p) {
    const info = await git.resolveRepo(p)
    if (!info) throw new Error('Not a repository')
    return git.getStatus(p, info.gitDir, await git.getHead(p))
  },
  commitFiles: (p, sha, parent) => git.getCommitFiles(p, sha, parent),
  stashFiles: (p, sha) => git.getStashFiles(p, sha),
  commitDetails: (p, sha) => git.getCommitDetails(p, sha),
  fileContents: (p, ctx, ws) => git.getFileContents(p, ctx, ws),
  async conflictSides(p, file) {
    const info = await git.resolveRepo(p)
    return git.getConflictSides(p, info!.gitDir, file)
  },
  blame: (p, file, sha) => git.getBlame(p, file, sha),
  fileHistory: (p, file) => git.getFileHistory(p, file),
  searchCommits: (p, q) => git.searchCommits(p, q),
  lastCommitMessage: (p) => git.getLastCommitMessage(p),
  isAncestor: (p, a, b) => git.isAncestor(p, a, b),

  stage: (p, paths) => git.stage(p, paths),
  stageAll: (p) => git.stageAll(p),
  async unstage(p, paths) { await git.unstage(p, paths, (await git.getHead(p)).unborn) },
  async unstageAll(p) { await git.unstageAll(p, (await git.getHead(p)).unborn) },
  discardFiles: (p, files) => git.discardFiles(p, files),
  async discardAll(p) { await git.discardAll(p, (await git.getHead(p)).unborn) },
  applyHunk: (p, ctx, h, lines, action) => git.applyHunk(p, ctx, h, lines, action),
  async commit(p, message, amend, opts) {
    const before = (await git.getHead(p)).sha
    await git.commit(p, message, amend, opts)
    const after = (await git.getHead(p)).sha
    if (before) record(p, {
      label: amend ? 'Amend' : 'Commit',
      undo: async () => { await git.reset(p, before, 'soft') },
      redo: async () => { await git.reset(p, after, 'soft') }
    })
  },
  resolveConflict: (p, file, content) => git.resolveConflict(p, file, content),
  writeFile: (p, file, content) => git.writeWorkingFile(p, file, content),
  resolveWithSide: (p, file, side) => git.resolveWithSide(p, file, side),

  async checkout(p, target) {
    const from = await headRef(p)
    await git.checkout(p, target)
    const to = await headRef(p)
    record(p, { label: 'Checkout', undo: () => git.checkout(p, from), redo: () => git.checkout(p, to) })
    await syncSubmodules(p)
  },
  restoreFile: (p, sha, file) => git.restoreFile(p, sha, file),
  async checkoutRemote(p, remoteShort, localExists) {
    const from = await headRef(p)
    const local = await git.checkoutRemote(p, remoteShort, localExists)
    record(p, { label: 'Checkout', undo: () => git.checkout(p, from), redo: () => git.checkout(p, local) })
    await syncSubmodules(p)
    return local
  },
  async createBranch(p, name, at, doCheckout) {
    const from = await headRef(p)
    await git.createBranch(p, name, at, doCheckout)
    record(p, {
      label: 'Create Branch',
      undo: async () => { if (doCheckout) await git.checkout(p, from); await git.deleteBranch(p, name, true) },
      redo: () => git.createBranch(p, name, at, doCheckout)
    })
  },
  async deleteBranch(p, name, force) {
    const sha = await git.revParse(p, `refs/heads/${name}`)
    await git.deleteBranch(p, name, force)
    if (sha) record(p, { label: 'Delete Branch', undo: () => git.createBranch(p, name, sha, false), redo: () => git.deleteBranch(p, name, true) })
  },
  deleteRemoteBranch: (p, remote, branch) => git.deleteRemoteBranch(p, remote, branch),
  renameBranch: (p, o, n) => git.renameBranch(p, o, n),
  setUpstream: (p, b, u) => git.setUpstream(p, b, u),
  fastForward: (p, b, to, cur) => git.fastForward(p, b, to, cur),
  createTag: (p, n, at, m) => git.createTag(p, n, at, m),
  deleteTag: (p, n) => git.deleteTag(p, n),
  deleteRemoteTag: (p, r, n) => git.deleteRemoteTag(p, r, n),
  pushTag: (p, r, n) => git.pushTag(p, r, n),
  addRemote: (p, n, u) => git.addRemote(p, n, u),
  removeRemote: (p, n) => git.removeRemote(p, n),
  editRemote: (p, o, n, f, pu) => git.editRemote(p, o, n, f, pu),

  merge: (p, ref, opts) => trackHead(p, 'Merge', () => git.merge(p, ref, opts)),
  rebase: (p, onto) => trackHead(p, 'Rebase', () => git.rebase(p, onto)),
  interactiveRebase: (p, base, items) => trackHead(p, 'Rebase', () => git.interactiveRebase(p, base, items)),
  cherryPick: (p, shas) => trackHead(p, 'Cherry pick', () => git.cherryPick(p, shas)),
  revert: (p, sha, isMerge) => trackHead(p, 'Revert', () => git.revert(p, sha, isMerge)),
  async reset(p, sha, mode) {
    const before = (await git.getHead(p)).sha
    const r = await git.reset(p, sha, mode)
    if (r.ok && before) record(p, {
      label: 'Reset',
      undo: async () => { await git.reset(p, before, mode) },
      redo: async () => { await git.reset(p, sha, mode) }
    })
    return r
  },
  continueOp: (p, kind, msg) => trackHead(p, kind === 'merge' ? 'Merge' : kind === 'rebase' ? 'Rebase' : kind === 'cherry-pick' ? 'Cherry pick' : 'Revert', () => git.continueOp(p, kind, msg)),
  abortOp: (p, kind) => git.abortOp(p, kind),
  skipOp: (p, kind) => git.skipOp(p, kind),

  stashSave: (p, m, mode) => git.stashSave(p, m, mode),
  stashRename: (p, i, m) => git.stashRename(p, i, m),
  stashPaths: (p, paths, m) => git.stashPaths(p, paths, m),
  createFilePatch: (p, f, st, o) => git.createFilePatch(p, f, st, o),
  deleteFile: (p, f) => git.deleteWorkingFile(p, f),
  annotateTag: (p, n, m) => git.annotateTag(p, n, m),
  stashApply: (p, i) => git.stashApply(p, i),
  stashPop: (p, i) => git.stashPop(p, i),
  stashDrop: (p, i) => git.stashDrop(p, i),

  addWorktree: (p, d, o) => git.addWorktree(p, d, o),
  removeWorktree: (p, d, f) => git.removeWorktree(p, d, f),
  pruneWorktrees: (p) => git.pruneWorktrees(p),

  fetchAll: (p, quiet) => git.fetchAll(p, getSettings().autoPrune, !!quiet),
  fetchRemote: (p, r) => git.fetchRemote(p, r, getSettings().autoPrune),
  async pull(p, mode) {
    const res = await git.pull(p, mode)
    if (res.ok !== false && mode !== 'fetch') await syncSubmodules(p)
    return res
  },
  push: (p, opts) => git.push(p, opts),

  compareFiles: (p, a, b) => git.getCompareFiles(p, a, b),
  commitStats: (p, limit) => ex.getCommitStats(p, limit),
  signature: (p, sha) => ex.getSignature(p, sha),
  treeFiles: (p, sha) => ex.getTreeFiles(p, sha),
  listFiles: (p) => ex.listFiles(p),
  readFile: (p, f) => ex.readRepoFile(p, f),
  commitTemplate: (p) => ex.getCommitTemplate(p),
  async gitConfigUnset(key, repo) { await git.g(repo ?? os.homedir(), ['config', ...(repo ? ['--local'] : ['--global']), '--unset', key], { allowFail: true }) },
  gitflowInit: (p, cfg) => ex.gitflowInit(p, cfg),
  gitflowStart: (p, t, n) => ex.gitflowStart(p, t, n),
  gitflowFinish: (p, t, n, o) => trackHead(p, 'Gitflow finish', () => ex.gitflowFinish(p, t, n, o)),
  lfsInfo: (p) => ex.lfsInfo(p),
  lfsInstall: (p) => ex.lfsInstall(p),
  lfsTrack: (p, pat) => ex.lfsTrack(p, pat),
  lfsUntrack: (p, pat) => ex.lfsUntrack(p, pat),
  lfsCommand: (p, c) => ex.lfsCommand(p, c),
  async pickSaveFile(title, defaultPath, filters) {
    const r = await dialog.showSaveDialog(win!, { title, defaultPath, filters })
    return r.canceled || !r.filePath ? null : r.filePath
  },
  async pickOpenFile(title, filters) {
    const r = await dialog.showOpenDialog(win!, { title, filters, properties: ['openFile'] })
    return r.canceled ? null : r.filePaths[0]
  },
  createPatch: (p, shas, file) => ex.createPatch(p, shas, file),
  applyPatch: (p, file, asCommits) => trackHead(p, 'Apply patch', () => ex.applyPatch(p, file, asCommits)),
  submoduleUpdate: (p, s) => ex.submoduleUpdate(p, s),
  submoduleAdd: (p, u, s) => ex.submoduleAdd(p, u, s),
  submoduleSync: (p) => ex.submoduleSync(p),
  openInEditor: (p, f) => ex.openInEditor(p, f, getSettings().externalEditor),
  externalMergeTool: (p, f) => ex.externalMergeTool(p, f),
  externalDiffTool: (p, f, st, a, b) => ex.externalDiffTool(p, f, st, a, b),
  sshKeys: () => ex.listSshKeys(),
  sshGenerate: (email, name) => ex.generateSshKey(email, name),
  gpgKeys: () => ex.listGpgKeys(),
  async setTheme(theme) {
    updateSettings({ theme })
    nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark'
    win?.setBackgroundColor(theme === 'light' ? '#fcfcfc' : '#090A0B')
  },
  async termStart(p, cols, rows) { return term.startTerminal(win!.webContents, p, getSettings().terminalShell, cols, rows) },
  async termWrite(id, data) { term.writeTerminal(id, data) },
  async termResize(id, cols, rows) { term.resizeTerminal(id, cols, rows) },
  async termKill(id) { term.killTerminal(id) },

  async undo(p) {
    const s = stackFor(p)
    const e = s.undo.pop()
    if (!e) return null
    await e.undo()
    s.redo.push(e)
    return e.label
  },
  async redo(p) {
    const s = stackFor(p)
    const e = s.redo.pop()
    if (!e) return null
    await e.redo()
    s.undo.push(e)
    return e.label
  },
  async undoState(p) {
    const s = stackFor(p)
    return { undo: s.undo.at(-1)?.label ?? null, redo: s.redo.at(-1)?.label ?? null }
  }
}

ipcMain.handle('api', async (_e, method: keyof Api, args: unknown[]) => {
  const fn = api[method] as (...a: unknown[]) => Promise<unknown>
  if (typeof fn !== 'function') throw new Error(`Unknown method ${String(method)}`)
  return fn(...args)
})

git.setAuthConfigProvider(providers.gitAuthConfig)
setGitPath(getSettings().gitPath)
git.setIdentityProvider(async (cwd) => {
  const s = getSettings()
  const prof = s.profiles.find((x) => x.id === s.activeProfile)
  if (!prof || (!prof.gitName && !prof.gitEmail)) return {}
  // a repository-specific identity always wins over the profile
  const local = await git.g(cwd, ['config', '--local', 'user.email'], { allowFail: true })
  if (local.code === 0 && local.stdout.trim()) return {}
  const env: Record<string, string> = {}
  if (prof.gitName) { env.GIT_AUTHOR_NAME = prof.gitName; env.GIT_COMMITTER_NAME = prof.gitName }
  if (prof.gitEmail) { env.GIT_AUTHOR_EMAIL = prof.gitEmail; env.GIT_COMMITTER_EMAIL = prof.gitEmail }
  return env
})
git.setProgressSink((repo, op, text) => win?.webContents.send('progress', { repo, op, text }))

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
  app.whenReady().then(() => {
    app.setAppUserModelId('dev.supergit.app')
    // native context menus / dialogs follow the app theme (dark menus in the dark theme, like the original)
    nativeTheme.themeSource = getSettings().theme === 'light' ? 'light' : 'dark'
    createWindow()
    buildAppMenu(win)
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}

app.on('window-all-closed', async () => {
  await flushSettings()
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => { term.killAllTerminals(); void flushSettings() })
