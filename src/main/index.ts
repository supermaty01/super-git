import { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, nativeImage, nativeTheme } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { watch, FSWatcher, existsSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as git from './git'
import * as providers from './providers'
import { setGitPath, findGit, READ_ONLY, activityLog } from './gitcore'
import { scanGitKraken, gitkrakenSettings } from './gitkraken'
import { buildAppMenu, setMenuState } from './appmenu'
import * as ex from './extras'
import * as term from './terminal'
import * as undo from './undo'
import { getSettings, updateSettings, flushSettings, addRecent } from './settings'
import type { Api } from '../shared/api'
import type { MenuItemSpec } from '../shared/types'

// Isolated profile (used for automated testing / side-by-side instances): settings, lock and caches live elsewhere.
if (process.env.SUPERGIT_USER_DATA) app.setPath('userData', process.env.SUPERGIT_USER_DATA)

let win: BrowserWindow | null = null

/** "Use local SSH agent" off + a private key: git runs ssh with that key only */
function applySshSettings(): void {
  const s = getSettings()
  if (!s.sshUseAgent && s.sshPrivateKey) process.env.GIT_SSH_COMMAND = `ssh -i "${s.sshPrivateKey.replace(/\\/g, '/')}" -o IdentitiesOnly=yes`
  else delete process.env.GIT_SSH_COMMAND
}

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
// Undo / redo follow the reflog (see undo.ts); actions git does not log are journaled there.

/** Runs an op that may move HEAD; keeps submodules in step when it did. */
async function trackHead<T extends { ok?: boolean }>(p: string, op: () => Promise<T>): Promise<T> {
  const before = (await git.getHead(p)).sha
  const res = await op()
  const after = (await git.getHead(p)).sha
  if (res.ok !== false && before && after && before !== after) await syncSubmodules(p)
  return res
}

/** a finished rebase is journaled with the commit it started from, so Undo can restore it */
async function trackRebase<T extends { ok?: boolean; conflicts?: unknown }>(p: string, op: () => Promise<T>): Promise<T> {
  const before = (await git.getHead(p)).sha
  const res = await trackHead(p, op)
  const after = (await git.getHead(p)).sha
  if (res.ok !== false && !res.conflicts && before && after && before !== after) await undo.addJournal(p, `rebase: [${before}]`)
  return res
}

/** "Keep submodules up to date": update submodules after a git action moved HEAD */
async function syncSubmodules(p: string): Promise<void> {
  if (!getSettings().updateSubmodules || !existsSync(path.join(p, '.gitmodules'))) return
  await git.net(p, 'submodule', ['submodule', 'update', '--init', '--recursive'], { allowFail: true })
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
    if (patch.sshUseAgent !== undefined || patch.sshPrivateKey !== undefined) applySshSettings()
    return updateSettings(patch)
  },
  async addRecent(p, name) { addRecent(p, name) },

  gitConfigGet: (key, repo) => git.getConfig(repo ?? os.homedir(), key),
  gitConfigSet: (key, value, repo) => git.setConfig(repo ?? os.homedir(), key, value, !repo),

  providerConnect: (p, o) => providers.connect(p, o),
  providerDisconnect: (p) => providers.disconnect(p),
  providerRepos: (p) => providers.listRepos(p),
  gitkrakenScan: () => scanGitKraken(),
  gitkrakenSettings: () => gitkrakenSettings(),
  async takeStartupFolder() { const d = startupFolder; startupFolder = null; return d },
  /** set by the installer's "Import from GitKraken" option; read once */
  async takeGitKrakenImportFlag() {
    const f = path.join(app.getPath('userData'), 'import-gitkraken.flag')
    if (!existsSync(f)) return false
    try { rmSync(f, { force: true }) } catch { /* ignore */ }
    return true
  },
  async setMenuState(st) { setMenuState(win, st) },
  async activityLog() { return activityLog() },
  async maintenance(p) { await git.g(p, ['gc', '--quiet']) },
  async sparseCheckout(p) {
    const on = (await git.g(p, ['config', '--get', 'core.sparseCheckout'], { allowFail: true })).stdout.trim() === 'true'
    if (!on) return { enabled: false, patterns: [] }
    const r = await git.g(p, ['sparse-checkout', 'list'], { allowFail: true })
    return { enabled: true, patterns: r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) }
  },
  async sparseCheckoutSet(p, patterns) {
    if (patterns === null) await git.g(p, ['sparse-checkout', 'disable'])
    else await git.g(p, ['sparse-checkout', 'set', ...patterns])
  },
  async gpgPublicKey(key) {
    const r = await git.g(os.homedir(), ['config', '--global', '--get', 'gpg.program'], { allowFail: true })
    const gpg = r.stdout.trim() || 'gpg'
    return new Promise((resolve, reject) => {
      execFile(gpg, ['--armor', '--export', key], { windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out)))
    })
  },
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
  fileHistory: (p, file, from) => git.getFileHistory(p, file, from),
  searchCommits: (p, q) => git.searchCommits(p, q),
  lastCommitMessage: (p) => git.getLastCommitMessage(p),
  isAncestor: (p, a, b) => git.isAncestor(p, a, b),

  stage: (p, paths) => git.stage(p, paths),
  stageAll: (p) => git.stageAll(p),
  async unstage(p, paths) { await git.unstage(p, paths, (await git.getHead(p)).unborn) },
  async unstageAll(p) { await git.unstageAll(p, (await git.getHead(p)).unborn) },
  async discardFiles(p, files) {
    // what is thrown away is kept in a commit so Undo can bring it back
    const oid = await undo.snapshotPaths(p, files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))).catch(() => null)
    await git.discardFiles(p, files)
    if (oid) await undo.addJournal(p, `discard: [${oid}]`)
  },
  async discardAll(p) {
    const unborn = (await git.getHead(p)).unborn
    const oid = unborn ? null : await undo.snapshotPaths(p, null).catch(() => null)
    await git.discardAll(p, unborn)
    if (oid) await undo.addJournal(p, `discard: [${oid}]`)
  },
  applyHunk: (p, ctx, h, lines, action) => git.applyHunk(p, ctx, h, lines, action),
  commit: (p, message, amend, opts) => git.commit(p, message, amend, opts),
  resolveConflict: (p, file, content) => git.resolveConflict(p, file, content),
  writeFile: (p, file, content) => git.writeWorkingFile(p, file, content),
  resolveWithSide: (p, file, side) => git.resolveWithSide(p, file, side),

  async checkout(p, target) {
    const stashed = await git.checkoutAutoStash(p, target)
    await syncSubmodules(p)
    return stashed
  },
  restoreFile: (p, sha, file) => git.restoreFile(p, sha, file),
  async checkoutRemote(p, remoteShort, localExists, opts) {
    const local = await git.checkoutRemote(p, remoteShort, localExists, opts)
    await syncSubmodules(p)
    return local
  },
  createBranch: (p, name, at, doCheckout) => git.createBranch(p, name, at, doCheckout),
  async deleteBranch(p, name, force) {
    const sha = await git.revParse(p, `refs/heads/${name}`)
    const upstream = (await git.tryOut(p, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${name}`]))?.trim()
    await git.deleteBranch(p, name, force)
    if (sha) await undo.addJournal(p, ['delete_branch:', name, upstream, `[${sha}]`].filter(Boolean).join(' '))
  },
  deleteRemoteBranch: (p, remote, branch) => git.deleteRemoteBranch(p, remote, branch),
  renameBranch: (p, o, n) => git.renameBranch(p, o, n),
  setUpstream: (p, b, u) => git.setUpstream(p, b, u),
  fastForward: (p, b, to, cur) => git.fastForward(p, b, to, cur),
  createTag: (p, n, at, m) => git.createTag(p, n, at, m),
  deleteTag: (p, n) => git.deleteTag(p, n),
  deleteRemoteTag: (p, r, n) => git.deleteRemoteTag(p, r, n),
  moveTag: (p, n, to) => git.moveTag(p, n, to),
  remoteTags: (p) => git.remoteTags(p),
  pushTag: (p, r, n) => git.pushTag(p, r, n),
  addRemote: (p, n, u) => git.addRemote(p, n, u),
  async removeRemote(p, n) {
    const pullUrl = (await git.tryOut(p, ['remote', 'get-url', n]))?.trim() ?? ''
    const pushUrl = (await git.tryOut(p, ['remote', 'get-url', '--push', n]))?.trim() || pullUrl
    await git.removeRemote(p, n)
    if (pullUrl) await undo.addJournal(p, `remove_remote: ${n} ${JSON.stringify({ pullUrl, pushUrl })}`)
  },
  editRemote: (p, o, n, f, pu) => git.editRemote(p, o, n, f, pu),

  merge: (p, ref, opts) => trackHead(p, () => git.merge(p, ref, opts)),
  rebase: (p, onto) => trackRebase(p, () => git.rebase(p, onto)),
  interactiveRebase: (p, base, items) => trackRebase(p, () => git.interactiveRebase(p, base, items)),
  cherryPick: (p, shas, noCommit) => trackHead(p, () => git.cherryPick(p, shas, noCommit)),
  revert: (p, sha, isMerge, noCommit) => trackHead(p, () => git.revert(p, sha, isMerge, noCommit)),
  async reset(p, sha, mode) {
    // a hard reset over local changes keeps them in a commit named in the reflog, so Undo restores them too
    const saved = mode === 'hard' ? (await git.tryOut(p, ['stash', 'create']))?.trim() : undefined
    const r = await git.reset(p, sha, mode)
    if (r.ok && saved) await undo.rewriteLastReflogMessage(p, `reset: moving to ${sha} [${saved}]`)
    return r
  },
  async continueOp(p, kind, msg) {
    const res = await trackHead(p, () => git.continueOp(p, kind, msg))
    // a rebase finished after resolving conflicts: journal it from where it started
    if (kind === 'rebase' && res.ok !== false && !res.conflicts) {
      const orig = (await git.tryOut(p, ['rev-parse', '-q', '--verify', 'ORIG_HEAD']))?.trim()
      if (orig) await undo.addJournal(p, `rebase: [${orig}]`)
    }
    return res
  },
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

  validateWorktree: (p, o) => git.validateWorktree(p, o),
  addWorktree: (p, d, o) => git.addWorktree(p, d, o),
  removeWorktree: (p, d, f) => git.removeWorktree(p, d, f),
  pruneWorktrees: (p) => git.pruneWorktrees(p),
  lockWorktree: (p, d, r) => git.lockWorktree(p, d, r),

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
  gitflowFinish: (p, t, n, o) => trackHead(p, () => ex.gitflowFinish(p, t, n, o)),
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
  applyPatch: (p, file, asCommits) => trackHead(p, () => ex.applyPatch(p, file, asCommits)),
  submoduleUpdate: (p, s) => ex.submoduleUpdate(p, s),
  deleteSubmodule: (p, sub, commit) => git.deleteSubmodule(p, sub, commit),
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

  async undo(p, opts) { const r = await undo.apply(p, 'undo', opts); if (r !== null) await syncSubmodules(p); return r },
  async redo(p, opts) { const r = await undo.apply(p, 'redo', opts); if (r !== null) await syncSubmodules(p); return r },
  undoState: (p) => undo.preview(p)
}

ipcMain.handle('api', async (_e, method: keyof Api, args: unknown[]) => {
  const fn = api[method] as (...a: unknown[]) => Promise<unknown>
  if (typeof fn !== 'function') throw new Error(`Unknown method ${String(method)}`)
  return fn(...args)
})

git.setAuthConfigProvider(providers.gitAuthConfig)
setGitPath(getSettings().gitPath)
applySshSettings()
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

/** a folder passed on the command line ("Open with SuperGit" in Explorer) */
function folderArg(argv: string[]): string | null {
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue
    try { if (statSync(a).isDirectory()) return path.resolve(a) } catch { /* not a path */ }
  }
  return null
}
let startupFolder: string | null = folderArg(process.argv)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
    const dir = folderArg(argv)
    if (dir) win?.webContents.send('command', `open:${dir}`)
  })
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
