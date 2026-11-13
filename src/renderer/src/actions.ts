// All user-triggered operations: they call the git backend, report errors as toasts and refresh state.
import { api, bridge } from './lib/api'
import {
  getState, setState, useStore, updateRepo, newRepoView, toast, TOAST_SHORT, openModal, showPrompt, MGMT_TAB, type RepoView, type Selection, type CenterView
} from './store'
import type { UpdateState, RepoSnapshot, Ref, Commit, FileChange, FileContext, OpResult, ResetMode, PullMode, RebaseTodoItem, Stash, Worktree, MenuItemSpec, TabInfo, AutoStash } from '@shared/types'
import { errMsg, basename } from './lib/format'
import { handleProgress } from './opsFeedback'
import { topoRange } from './graph/range'
import { promptCreateRef, openMergeOrPrompt } from './quickMenus'
import { runStaging, statusNewerThan } from './staging'
import * as W from './lib/wipStatus'

// ---------------------------------------------------------------------------------------------
// bootstrapping & tabs

let booted = false
export async function init(): Promise<void> {
  if (booted) return
  booted = true
  const settings = await api.getSettings()
  // "Remember tabs" off: start on Repository Management each time
  const tabs = settings.rememberTabs ? settings.tabs.filter((t) => t.path) : []
  const active = settings.activeTab && tabs.some((t) => t.id === settings.activeTab) ? settings.activeTab : tabs[0]?.id ?? MGMT_TAB
  setState({ settings, tabs, activeTab: active })
  bridge().onRepoChanged((p) => {
    const tab = activeTab()
    if (!tab || tab.path !== p) return
    // changes made by the app's own operation are picked up by the refresh that follows it (no refresh storm)
    if (opsInFlight.get(p)) changedDuringOp.add(p)
    else void refresh(p)
  })
  bridge().onProgress((e) => { if (!handleProgress(e)) setState({ progress: { repo: e.repo, text: e.text } }) })
  bridge().onZoom((z) => setState((s) => ({ settings: s.settings ? { ...s.settings, zoom: z } : s.settings })))
  bridge().onUpdate(onUpdate)
  window.addEventListener('focus', () => { const t = activeTab(); if (t) void refresh(t.path) })
  if (active !== MGMT_TAB) await activateTab(active)
  startAutoFetch()
  // first start after the installer's "Import from GitKraken": its open repositories, hidden branches and preferences
  if (await api.takeGitKrakenImportFlag().catch(() => false)) {
    const prefs = await api.gitkrakenSettings().catch(() => ({}))
    if (Object.keys(prefs).length) setState((s) => ({ settings: s.settings ? { ...s.settings, ...prefs } : s.settings }))
    if (Object.keys(prefs).length) await api.setSettings(prefs)
    await (await import('./actions2')).importFromGitKraken()
  }
  const folder = await api.takeStartupFolder().catch(() => null)
  if (folder) await openRepo(folder)
}

// ---------------------------------------------------------------------------------------------
// automatic updates (downloaded in the background from the GitHub releases)

let readyShown = ''
function onUpdate(u: UpdateState & { manual: boolean }): void {
  if (u.state === 'ready') {
    if (readyShown === u.version) return
    readyShown = u.version
    toast({
      kind: 'info', title: 'Update ready', message: `SuperGit ${u.version} has been downloaded. Restart to finish updating; your open tabs come back.`,
      actions: [{ label: 'Restart to update', run: () => void api.installUpdate() }]
    }, 0)
    return
  }
  if (!u.manual) return
  if (u.state === 'none') toast({ kind: 'success', title: 'SuperGit is up to date', message: `You have the latest version (${u.version}).` })
  else if (u.state === 'downloading') toast({ kind: 'info', title: `Downloading SuperGit ${u.version}`, message: 'You will be asked to restart once it is ready.' })
  else if (u.state === 'error') toast({ kind: 'error', title: 'Could not check for updates', message: u.message })
  else if (u.state === 'unsupported') toast({ kind: 'info', title: 'Automatic updates are not available', message: u.reason }, 6000)
}
export const checkForUpdates = () => api.checkForUpdates(true)

function activeTab(): TabInfo | undefined {
  const s = getState()
  return s.tabs.find((t) => t.id === s.activeTab)
}

export function persistTabs(): void {
  const { tabs, activeTab } = getState()
  void api.setSettings({ tabs, activeTab })
}

let watched: string | null = null
async function watchOnly(path: string | null) {
  if (watched === path) return
  if (watched) await api.unwatch(watched)
  watched = path
  if (path) await api.watch(path)
}

export async function activateTab(id: string): Promise<void> {
  setState({ activeTab: id })
  persistTabs()
  const tab = getState().tabs.find((t) => t.id === id)
  if (!tab || isNewTab(tab)) { await watchOnly(null); return }
  const s = getState()
  if (!s.repos[tab.path]) {
    setState({ repos: { ...s.repos, [tab.path]: newRepoView(tab.path, s.settings?.showAllCommits ? 1_000_000 : s.settings?.commitLimit ?? 2000) } })
  }
  await watchOnly(tab.path)
  await refresh(tab.path)
}

/** opens (or shows) the repository at `p`; resolves to its root path as the tab knows it */
export async function openRepo(p: string): Promise<string | undefined> {
  const info = await api.resolveRepo(p)
  if (!info) {
    toast({ kind: 'error', title: 'Not a git repository', message: p })
    return
  }
  const root = info.root
  const existing = getState().tabs.find((t) => t.path && t.path.toLowerCase() === root.toLowerCase())
  if (existing) {
    // from a "New Tab": the blank tab goes away once the open repository is shown
    const blankTab = getState().tabs.find((t) => t.id === getState().activeTab && isNewTab(t))
    await activateTab(existing.id)
    if (blankTab) await closeTab(blankTab.id)
    return existing.path
  }
  const tab: TabInfo = { id: crypto.randomUUID(), path: root, name: basename(root) }
  // opened from a "New Tab": the repository takes that tab's place (like the original)
  const blank = getState().tabs.find((t) => t.id === getState().activeTab && isNewTab(t))
  setState((s) => ({ tabs: blank ? s.tabs.map((t) => (t.id === blank.id ? tab : t)) : [...s.tabs, tab] }))
  await api.addRecent(root, tab.name)
  setState((s) => ({ settings: s.settings ? { ...s.settings, recent: [{ path: root, name: tab.name, lastOpened: Date.now() }, ...s.settings.recent.filter((r) => r.path.toLowerCase() !== root.toLowerCase())] } : s.settings }))
  await activateTab(tab.id)
  await afterRepoOpened(root, tab.name)
  return root
}

/** the original's checks once a repository is open: a repository without commits, one stored in WSL */
async function afterRepoOpened(root: string, name: string): Promise<void> {
  if (await api.repoIsEmpty(root).catch(() => false)) {
    showPrompt({
      kind: 'confirm',
      message: `Repository '${name}' must have an initial commit to be opened. Do you want SuperGit to make a commit for you?`,
      buttons: [{ label: 'Initialize', style: 'success', run: () => run(root, () => api.makeInitialCommit(root), { errorTitle: 'Failed to create the initial commit' }) }]
    })
  }
  if (/^[\\/]{2}wsl(\$|\.localhost)[\\/]/i.test(root)) {
    toast({
      kind: 'info',
      title: 'Working with repositories stored on WSL is not recommended from SuperGit on Windows. Visit the Help Center for the best experience with files across the WSL boundary.',
      // stays until closed, like the original's (the original's page is about GitKraken itself, so this points at Microsoft's)
      actions: [{ label: 'Open Help Center', run: () => void api.openExternal('https://learn.microsoft.com/windows/wsl/filesystems') }]
    }, 0)
  }
  // like the original: submodules that were never initialized are offered once the repository loads
  void loadedSnapshot(root).then((snap) => {
    if (!snap?.submodules.some((s) => s.state === '-')) return
    showPrompt({
      kind: 'confirm',
      message: `Would you like to initialize submodules for ${name}?`,
      buttons: [
        { label: 'Yes', style: 'success', run: () => run(root, () => api.submoduleUpdate(root), { busy: 'Updating submodules', success: 'Submodules updated' }) }
      ],
      cancelLabel: 'No'
    })
  })
}

/** the repository's first snapshot (undefined if it does not arrive within 15 s or the tab goes away) */
function loadedSnapshot(path: string): Promise<RepoSnapshot | undefined> {
  const now = getState().repos[path]?.snapshot
  if (now) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = (v: RepoSnapshot | undefined) => { window.clearTimeout(t); unsub(); resolve(v) }
    const unsub = useStore.subscribe((s) => {
      const r = s.repos[path]
      if (!r) done(undefined)
      else if (r.snapshot) done(r.snapshot)
    })
    const t = window.setTimeout(() => done(undefined), 15000)
  })
}

/** a "New Tab" (Ctrl+T / "+"): a tab without a repository */
export const isNewTab = (t: TabInfo): boolean => !t.path
export async function newTab(): Promise<void> {
  const tab: TabInfo = { id: crypto.randomUUID(), path: '', name: 'New Tab' }
  setState((s) => ({ tabs: [...s.tabs, tab] }))
  await activateTab(tab.id)
}

const closedTabs: TabInfo[] = []
export const hasClosedTabs = (): boolean => closedTabs.length > 0
export async function reopenClosedTab(): Promise<void> {
  const t = closedTabs.pop()
  if (t) await openRepo(t.path)
}

export async function closeTab(id: string): Promise<void> {
  const s = getState()
  const idx = s.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return
  const tab = s.tabs[idx]
  if (!isNewTab(tab)) closedTabs.push(tab)
  const tabs = s.tabs.filter((t) => t.id !== id)
  const repos = { ...s.repos }
  if (!tabs.some((t) => t.path === tab.path)) delete repos[tab.path]
  let active = s.activeTab
  if (active === id) active = tabs[Math.min(idx, tabs.length - 1)]?.id ?? MGMT_TAB
  setState({ tabs, repos })
  await activateTab(active)
}

export function reorderTabs(from: number, to: number): void {
  const tabs = [...getState().tabs]
  const [t] = tabs.splice(from, 1)
  tabs.splice(to, 0, t)
  setState({ tabs })
  persistTabs()
}

// ---------------------------------------------------------------------------------------------
// refresh

const inflight = new Map<string, Promise<void>>()
const pending = new Set<string>()

/** the app's own git operations running per repository, and repositories the watcher reported changes for meanwhile */
const opsInFlight = new Map<string, number>()
const changedDuringOp = new Set<string>()
/** runs one of the app's own operations; changes reported meanwhile are refreshed after it (unless the caller refreshes anyway) */
export async function asOwnOp<T>(path: string, fn: () => Promise<T>, callerRefreshes: boolean): Promise<T> {
  opsInFlight.set(path, (opsInFlight.get(path) ?? 0) + 1)
  try {
    return await fn()
  } finally {
    const n = (opsInFlight.get(path) ?? 1) - 1
    if (n > 0) opsInFlight.set(path, n)
    else {
      opsInFlight.delete(path)
      if (changedDuringOp.delete(path) && !callerRefreshes) void refresh(path)
    }
  }
}

export function refresh(path: string): Promise<void> {
  if (inflight.has(path)) { pending.add(path); return inflight.get(path)! }
  const p = doRefresh(path).finally(() => {
    inflight.delete(path)
    if (pending.delete(path)) void refresh(path)
  })
  inflight.set(path, p)
  return p
}

function isDirty(s: RepoSnapshot): boolean {
  return s.status.staged.length + s.status.unstaged.length + s.status.conflicted.length > 0 || s.status.state.kind !== 'none'
}

function fixSelection(sel: Selection | null, snap: RepoSnapshot): Selection | null {
  const shas = new Set(snap.commits.map((c) => c.sha))
  snap.stashes.forEach((st) => shas.add(st.sha))
  if (sel?.kind === 'compare') return shas.has(sel.a) && (!sel.b || shas.has(sel.b)) ? sel : null
  if (sel?.kind === 'wip') return isDirty(snap) ? sel : snap.head.sha ? { kind: 'commits', shas: [snap.head.sha], anchor: snap.head.sha } : null
  if (sel?.kind === 'commits') {
    const keep = sel.shas.filter((s) => shas.has(s))
    if (keep.length) return { ...sel, shas: keep, anchor: keep.includes(sel.anchor) ? sel.anchor : keep[0] }
  }
  if (isDirty(snap)) return { kind: 'wip' }
  return snap.head.sha ? { kind: 'commits', shas: [snap.head.sha], anchor: snap.head.sha } : null
}

function fixCenter(center: CenterView, snap: RepoSnapshot): CenterView {
  if (center.kind === 'merge') return snap.status.conflicted.some((f) => f.path === center.file) ? center : { kind: 'graph' }
  if (center.kind === 'file') {
    const ctx = center.ctx
    if (ctx.status === 'N') return center
    if (ctx.kind === 'unstaged' || ctx.kind === 'staged') {
      const un = snap.status.unstaged.find((f) => f.path === ctx.path)
      const st = snap.status.staged.find((f) => f.path === ctx.path)
      if (ctx.kind === 'unstaged') {
        if (un) return { kind: 'file', ctx: { kind: 'unstaged', path: un.path, status: un.status } }
        if (st) return { kind: 'file', ctx: { kind: 'staged', path: st.path, oldPath: st.oldPath, status: st.status } }
      } else {
        if (st) return { kind: 'file', ctx: { kind: 'staged', path: st.path, oldPath: st.oldPath, status: st.status } }
        if (un) return { kind: 'file', ctx: { kind: 'unstaged', path: un.path, status: un.status } }
      }
      return { kind: 'graph' }
    }
  }
  if (center.kind === 'rebase' && snap.status.state.kind !== 'none') return { kind: 'graph' }
  return center
}

async function doRefresh(path: string): Promise<void> {
  const v = getState().repos[path]
  if (!v) return
  try {
    const t0 = performance.now()
    const [full, undo] = await Promise.all([api.snapshot(path, v.limit), api.undoState(path)])
    // a staging operation that wrote the working status after this snapshot started is newer: keep it
    const snap = statusNewerThan(path, t0) && v.snapshot ? { ...full, status: getState().repos[path]?.snapshot?.status ?? full.status } : full
    updateRepo(path, (r) => ({
      snapshot: snap, loading: false, error: undefined, undo,
      selection: fixSelection(r.selection, snap),
      center: fixCenter(r.center, snap),
      wip: opWip(path, r.wip, snap.status.state)
    }))
  } catch (e) {
    updateRepo(path, { loading: false, error: errMsg(e) })
  }
}

/** the operation message last put in each repository's commit box, to tell it apart from what the user typed */
const prefilledMsg = new Map<string, string>()
function opWip<W extends { summary: string; description: string; amend: boolean }>(path: string, wip: W, state: { kind: string; message?: string }): W {
  const pre = prefilledMsg.get(path)
  const untouched = pre !== undefined && `${wip.summary}\n${wip.description}` === pre
  if (state.kind === 'none' || !state.message) {
    // the operation ended outside the app: its message goes too, unless the user edited it
    if (state.kind === 'none' && pre !== undefined) { prefilledMsg.delete(path); if (untouched) return { ...wip, summary: '', description: '' } }
    return wip
  }
  const next = messageToWip(state.message, wip.amend)
  const key = `${next.summary}\n${next.description}`
  if (wip.summary && !(untouched && key !== pre)) return wip
  prefilledMsg.set(path, key)
  return { ...wip, ...next }
}

function messageToWip(msg: string, amend: boolean) {
  const clean = msg.split('\n').filter((l) => !l.startsWith('#')).join('\n').trim()
  const [summary, ...rest] = clean.split('\n')
  return { summary: summary ?? '', description: rest.join('\n').trim(), amend }
}

export async function loadMore(path: string): Promise<void> {
  updateRepo(path, (r) => ({ limit: r.limit + 2000 }))
  await refresh(path)
}

// ---------------------------------------------------------------------------------------------
// generic runners

interface RunOpts<T = unknown> { busy?: string; success?: string; successMessage?: string; errorTitle?: string; refresh?: boolean; /** runs as soon as the call returns, before the graph refreshes (the original shows results at once) */ after?: (r: T) => void }

export async function run<T>(path: string, fn: () => Promise<T>, opts: RunOpts<T> = {}): Promise<T | undefined> {
  if (opts.busy) updateRepo(path, { busy: opts.busy })
  try {
    const r = await asOwnOp(path, fn, opts.refresh !== false)
    if (opts.success) toast({ kind: 'success', title: opts.success, message: opts.successMessage })
    opts.after?.(r)
    return r
  } catch (e) {
    toast({ kind: 'error', title: opts.errorTitle ?? 'Something went wrong', message: errMsg(e) })
    return undefined
  } finally {
    setState({ progress: null })
    // the toolbar stays disabled until the graph shows the result (Stash turns off at once on a clean tree)
    if (opts.refresh !== false) await refresh(path)
    if (opts.busy) updateRepo(path, { busy: null })
  }
}

export async function runOp(path: string, fn: () => Promise<OpResult>, what: string, busy?: string, success?: { title: string; message?: string; ttl?: number }, onOk?: (res: OpResult) => void): Promise<OpResult | undefined> {
  const res = await run(path, fn, {
    busy,
    after: (res) => {
      if (res.conflicts) {
        toast({ kind: 'error', title: `${what} Failed`, message: 'There are merge conflicts that need to be resolved' }, 8000)
        updateRepo(path, { selection: { kind: 'wip' } })
      } else if (!res.ok) {
        toast({ kind: 'error', title: `${what} Failed`, message: res.error })
      } else if (onOk) onOk(res)
      else if (success) toast({ kind: 'success', title: success.title, message: success.message }, success.ttl)
      autoStashNotice(res.autoStash)
    }
  })
  return res
}

/** the original's notice when local changes had to be stashed and could not be restored */
export function autoStashNotice(a: AutoStash | undefined): void {
  if (a === 'kept') toast({ kind: 'info', title: 'Uncommitted Changes Stashed', message: 'There were uncommitted changes that have been stashed to prevent losing them.' }, 8000)
}

const ok = (title: string, message?: string, ttl?: number) => toast({ kind: 'success', title, message }, ttl)

/** the original's confirmation bar for destructive actions */
function confirmDestructive(message: string, label: string, act: () => unknown): void {
  showPrompt({ kind: 'confirm', message, buttons: [{ label, style: 'danger', run: act }] })
}

export const repoView = (path: string): RepoView => getState().repos[path]
export const snap = (path: string): RepoSnapshot => getState().repos[path].snapshot!

export function currentBranch(path: string): string | undefined { return snap(path).head.branch }

// ---------------------------------------------------------------------------------------------
// selection & navigation

export function selectWip(path: string): void { updateRepo(path, { selection: { kind: 'wip' }, fileSel: [] }) }

export function selectCommit(path: string, sha: string, mod: { ctrl?: boolean; shift?: boolean } = {}, order?: string[]): void {
  updateRepo(path, (r) => {
    const sel = r.selection
    if (mod.ctrl && sel?.kind === 'commits') {
      const shas = sel.shas.includes(sha) ? sel.shas.filter((s) => s !== sha) : [...sel.shas, sha]
      return { selection: shas.length ? { kind: 'commits', shas, anchor: sha } : null, fileSel: [] }
    }
    if (mod.shift && sel?.kind === 'commits' && order) {
      // like the original, Shift-click adds to the selection: the commits topologically between the nearest
      // selected commit and the clicked one (ancestors of the newer that descend from the older)
      const b = order.indexOf(sha)
      const picked = sel.shas.map((x) => order.indexOf(x)).filter((i) => i >= 0)
      if (b >= 0 && picked.length) {
        const a = picked.reduce((best, i) => (Math.abs(i - b) < Math.abs(best - b) ? i : best), picked[0])
        const parents = new Map<string, string[]>()
        r.snapshot?.commits.forEach((c) => parents.set(c.sha, c.parents))
        r.snapshot?.stashes.forEach((st) => parents.set(st.sha, st.parents.slice(0, 1)))
        const rows = order.filter((k) => k !== '__wip__').map((k) => ({ sha: k, parents: parents.get(k) ?? [] }))
        const range = topoRange(rows, order[a], sha)
        const shas = [...sel.shas, ...range.filter((x) => !sel.shas.includes(x))]
        // the clicked commit becomes the focused one (keyboard, ghost label)
        return { selection: { kind: 'commits', shas, anchor: sha }, fileSel: [] }
      }
    }
    return { selection: { kind: 'commits', shas: [sha], anchor: sha }, fileSel: [] }
  })
}

export function openFile(path: string, ctx: FileContext): void { updateRepo(path, { center: { kind: 'file', ctx } }) }
export function openMerge(path: string, file: string): void { void openMergeOrPrompt(path, file) }
export function closeCenter(path: string): void { updateRepo(path, { center: { kind: 'graph' } }) }

// ---------------------------------------------------------------------------------------------
// staging & commit

// fast path (see staging.ts): rows move at once, then only `git status` is read before the background refresh
export const stageFiles = (path: string, files: FileChange[]) => runStaging(path, () => api.stage(path, files.flatMap((f) => (f.oldPath && f.status === 'R' ? [f.path, f.oldPath] : [f.path]))), (st) => W.stageOptimistic(st, files))
export const unstageFiles = (path: string, files: FileChange[]) => runStaging(path, () => api.unstage(path, files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))), (st) => W.unstageOptimistic(st, files))
export const stageAll = (path: string) => runStaging(path, () => api.stageAll(path), W.stageAllOptimistic)
export const unstageAll = (path: string) => runStaging(path, () => api.unstageAll(path), W.unstageAllOptimistic)

export async function discardFiles(path: string, files: FileChange[]): Promise<void> {
  // the original asks in the inline prompt bar, not in a system dialog
  showPrompt({
    kind: 'confirm',
    message: files.length === 1
      ? `This will permanently discard unstaged changes to "${files[0].path}". Are you sure you want to continue?`
      : 'This will permanently discard unstaged changes to the selected files. Are you sure you want to continue?',
    buttons: [{ label: 'Discard Unstaged Changes', style: 'danger', run: () => runStaging(path, () => api.discardFiles(path, files), (st) => W.discardOptimistic(st, files)) }]
  })
}

export async function discardAll(path: string): Promise<void> {
  showPrompt({
    kind: 'confirm',
    message: 'This will discard all staged and unstaged changes, including new untracked files. Are you sure you want to discard all changes?',
    buttons: [{ label: 'Reset All', style: 'danger', run: () => run(path, () => api.discardAll(path)) }]
  })
}

export async function applyHunk(path: string, ctx: FileContext, hunk: number, lines: number[] | null, action: 'stage' | 'unstage' | 'discard' | 'revert'): Promise<void> {
  if (action === 'discard') {
    const r = await api.confirm({ title: 'Discard', message: lines ? 'Discard the selected lines?' : 'Discard this hunk?', detail: 'This cannot be undone.', buttons: ['Discard', 'Cancel'], type: 'warning' })
    if (r !== 0) return
  }
  await run(path, () => api.applyHunk(path, ctx, hunk, lines, action), action === 'revert' ? { success: 'Hunk reverted in the working directory', errorTitle: 'Could not revert the hunk' } : {})
}

export async function commit(path: string, opts: { noVerify?: boolean; sign?: boolean; push?: boolean } = {}): Promise<void> {
  const v = repoView(path)
  const { summary, description, amend } = v.wip
  if (!summary.trim()) return
  const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim()
  const state = v.snapshot!.status.state
  if (state.kind !== 'none') {
    await runOp(path, () => api.continueOp(path, state.kind, message), state.kind === 'merge' ? 'Merge' : 'Continue', undefined, state.kind === 'merge' ? { title: 'Merged Successfully' } : undefined)
    updateRepo(path, { wip: { summary: '', description: '', amend: false } })
    return
  }
  const set = getState().settings!
  const ok = await run(path, async () => {
    try { await api.commit(path, message, amend, { noVerify: opts.noVerify, sign: opts.sign, keepComments: !set.stripComments }); return true } catch (e) {
      if (!hookFailed(e)) throw e
      return false
    }
  }, { errorTitle: 'Commit failed' })
  if (ok) {
    setState({ hookFailure: null })
    // like the original: after an amend, the message typed before ticking "Amend" comes back
    const d = amend ? repoView(path).wip.draft : undefined
    updateRepo(path, { wip: { summary: d?.summary ?? '', description: d?.description ?? '', amend: false } })
    // "Push after committing" (the commit options checkbox, defaulting to the preference)
    if ((opts.push ?? set.pushAfterCommit) && !amend) await push(path)
  }
}

/**
 * A failing commit hook: the toast says "<hook> Failed Git Hook exited with <code>" (not the raw output) and a red bar
 * offers the hook output under "View Log". Returns false when the error is something else.
 */
function hookFailed(e: unknown): boolean {
  const msg = errMsg(e)
  const at = msg.indexOf('SUPERGIT_HOOK_FAILED:')
  if (at < 0) return false
  let info: { hooks: Array<{ name: string; code: number }>; log: string }
  try { info = JSON.parse(msg.slice(at + 'SUPERGIT_HOOK_FAILED:'.length)) } catch { return false }
  const text = info.hooks.length === 1 ? `${info.hooks[0].name} Failed Git Hook exited with ${info.hooks[0].code}` : 'Multiple Git Hooks have failed'
  toast({ kind: 'error', title: 'Commit failed', message: info.hooks.length === 1 ? text : info.hooks.map((h) => `${h.name} Failed Git Hook exited with ${h.code}`).join('\n') })
  setState({ hookFailure: { title: text, log: info.log } })
  return true
}

export async function setAmend(path: string, amend: boolean): Promise<void> {
  // like the original: amending loads the previous message, and turning it off brings back what was typed
  if (amend) {
    const draft = { summary: repoView(path).wip.summary, description: repoView(path).wip.description }
    const msg = await api.lastCommitMessage(path)
    const [summary, ...rest] = msg.split('\n')
    updateRepo(path, { wip: { summary, description: rest.join('\n').trim(), amend: true, draft } })
  } else {
    const d = repoView(path).wip.draft
    updateRepo(path, { wip: { summary: d?.summary ?? '', description: d?.description ?? '', amend: false } })
  }
}

// ---------------------------------------------------------------------------------------------
// conflicts & in-progress operations

export const markResolved = (path: string, files: string[]) => run(path, () => api.stage(path, files))
export const takeSide = (path: string, file: string, side: 'ours' | 'theirs') => run(path, () => api.resolveWithSide(path, file, side))
export async function abortOp(path: string): Promise<void> {
  const kind = snap(path).status.state.kind
  if (kind === 'none') return
  // like the original: aborts right away, no confirmation ("Abort Merge Failed" / "Abort Rebase Failed" on errors)
  await runOp(path, () => api.abortOp(path, kind), kind === 'rebase' ? 'Abort Rebase' : 'Abort Merge')
  updateRepo(path, { wip: { summary: '', description: '', amend: false } })
}
export async function continueOp(path: string): Promise<void> {
  const v = repoView(path)
  const kind = v.snapshot!.status.state.kind
  const msg = v.wip.summary.trim() ? [v.wip.summary.trim(), v.wip.description.trim()].filter(Boolean).join('\n\n') : undefined
  await runOp(path, () => api.continueOp(path, kind, msg), 'Continue', undefined, kind === 'merge' ? { title: 'Merged Successfully' } : undefined)
  updateRepo(path, { wip: { summary: '', description: '', amend: false } })
}
export const skipOp = (path: string) => runOp(path, () => api.skipOp(path, snap(path).status.state.kind), 'Skip')

// ---------------------------------------------------------------------------------------------
// branches

export function localForRemote(path: string, remoteShort: string): Ref | undefined {
  const name = remoteShort.split('/').slice(1).join('/')
  return snap(path).refs.find((r) => r.type === 'head' && r.short === name)
}

export async function checkoutRef(path: string, ref: Ref): Promise<void> {
  if (ref.type === 'head' && ref.isCurrent) return
  if (ref.type === 'remote') {
    // like the original: a local branch of that name at another commit asks what to do
    const local = localForRemote(path, ref.short)
    // the local branch is checked out in another worktree: do it there
    const wt = local ? snap(path).worktrees.find((w) => !w.isCurrent && w.branch?.replace(/^refs\/heads\//, '') === local.short) : undefined
    if (local && wt) {
      const inWt = async (fn: (at: string) => Promise<unknown>, target: string) => { const at = await openRepo(wt.path); if (at) await doCheckout(at, target, () => fn(at)) }
      showPrompt({
        kind: 'input', message: `A local '${local.short}' already exists in a worktree.`, placeholder: 'branch name', submitLabel: 'Open Worktree and create Branch Here', large: false, requireValue: true,
        extraButtons: [{ label: 'Open Worktree and reset Local to Here', run: () => inWt((at) => api.checkoutRemote(at, ref.short, true, { reset: true }), local.short) }],
        onSubmit: (name) => inWt((at) => api.checkoutRemote(at, ref.short, false, { newName: name.trim() }), name.trim())
      })
      return
    }
    if (local && local.sha !== ref.sha) {
      showPrompt({
        kind: 'input', message: `A local '${local.short}' already exists.`, placeholder: 'branch name', submitLabel: 'Create Branch Here', large: false, requireValue: true,
        extraButtons: [{ label: 'Reset Local to Here', run: () => doCheckout(path, ref.short, () => api.checkoutRemote(path, ref.short, true, { reset: true })) }],
        onSubmit: (name) => doCheckout(path, name.trim(), () => api.checkoutRemote(path, ref.short, false, { newName: name.trim() }))
      })
      return
    }
    await doCheckout(path, local?.short ?? ref.short.split('/').slice(1).join('/'), () => api.checkoutRemote(path, ref.short, !!local))
    return
  }
  await doCheckout(path, ref.type === 'head' ? ref.short : ref.sha, () => api.checkout(path, ref.type === 'head' ? ref.short : ref.sha), ref.type === 'tag' ? ref.short : undefined)
}

/** runs a checkout with the original's feedback: "Checking out branch" over the left panel, then a toast */
async function doCheckout(path: string, target: string, fn: () => Promise<unknown>, tag?: string): Promise<void> {
  updateRepo(path, { busy: CHECKING_OUT })
  try {
    const r = await asOwnOp(path, fn, true)
    await refresh(path)
    const branch = snap(path)?.head.branch
    ok('Checkout Successful', tag ? `Checked out the commit referenced by ${tag}` : branch ? `refs/heads/${branch}` : snap(path)?.head.sha ?? target)
    if (r === 'kept') autoStashNotice('kept')
  } catch (e) {
    toast({ kind: 'error', title: 'Checkout Failed', message: errMsg(e) })
    await refresh(path)
  } finally {
    if (repoView(path)?.busy === CHECKING_OUT) updateRepo(path, { busy: null })
  }
}

/** busy labels that cover the left panel with a loading overlay (others only show in the toolbar / status bar) */
export const CHECKING_OUT = 'Checking out branch'
export const DELETING = 'Deleting...'

export const checkoutCommit = (path: string, sha: string) => doCheckout(path, sha, () => api.checkout(path, sha))

export function startCreateRef(path: string, kind: 'branch' | 'tag' | 'annotated-tag', sha?: string): void {
  const s = snap(path)
  const at = sha ?? (repoView(path).selection?.kind === 'commits' ? (repoView(path).selection as { anchor: string }).anchor : s.head.sha)
  if (!at) { toast({ kind: 'error', title: 'Nothing to branch from', message: 'This repository has no commits yet.' }); return }
  // like the original: without the branch column (or when the commit is not in the graph) a prompt in the toolbar asks instead
  if (!getState().settings?.graphColumns.ref || !s.commits.some((c) => c.sha === at)) { promptCreateRef(path, kind, at); return }
  updateRepo(path, { newRef: { kind, sha: at } })
}

export async function submitNewRef(path: string, name: string): Promise<void> {
  const nr = repoView(path).newRef
  updateRepo(path, { newRef: null })
  const n = name.trim()
  if (!nr || !n) return
  if (nr.kind === 'branch') await run(path, () => api.createBranch(path, n, nr.sha, true), { busy: CHECKING_OUT, errorTitle: 'Could not create branch', success: 'Checkout Successful', successMessage: `refs/heads/${n}` })
  else if (nr.kind === 'annotated-tag') {
    showPrompt({
      kind: 'input', message: 'Message:', placeholder: 'Annotation message',
      onSubmit: (msg) => run(path, () => api.createTag(path, n, nr.sha, msg.trim() || n), { errorTitle: 'Could not create tag', success: 'Annotated Successfully', successMessage: `refs/tags/${n}` })
    })
  } else await run(path, () => api.createTag(path, n, nr.sha), { errorTitle: 'Could not create tag', success: 'Created Successfully', successMessage: `refs/tags/${n}` })
}

export async function deleteLocalBranch(path: string, ref: Ref): Promise<void> {
  // like the original: always confirms (merged or not, no extra warning for unmerged work), then force-deletes
  // (Undo restores it); Gitflow's main and develop branches get their own warning
  const gf = snap(path).gitflow
  const gitflowBranch = gf?.initialized && (ref.short === gf.master || ref.short === gf.develop)
  confirmDestructive(gitflowBranch
    ? `This branch is required for Gitflow, are you sure you want to delete "${ref.short}"?`
    : `This is a destructive operation, are you sure you want to delete "${ref.short}"?`, 'Delete', () =>
    run(path, () => api.deleteBranch(path, ref.short, true), { busy: DELETING, errorTitle: `Delete Failed: refs/heads/${ref.short}`, success: `Deleted: refs/heads/${ref.short}` }))
}

export async function deleteRemoteBranch(path: string, ref: Ref): Promise<void> {
  confirmDestructive(`This is a destructive operation, are you sure you want to delete "${ref.short}"?`, 'Delete', () => removeRemoteBranch(path, ref))
}

const removeRemoteBranch = (path: string, ref: Ref, refresh = true) =>
  run(path, () => api.deleteRemoteBranch(path, ref.remote!, ref.short.slice(ref.remote!.length + 1)), { busy: 'Deleting', errorTitle: `Delete Failed: refs/remotes/${ref.short}`, success: `Deleted: refs/remotes/${ref.short}`, refresh })

/** "Delete X and origin/X" / "Delete all "X" branches (local && remote)": one confirmation, one result per ref */
export function deleteBranchEverywhere(path: string, local: Ref, remotes: Ref[]): void {
  confirmDestructive(`This is a destructive operation, are you sure you want to delete "${local.short}" at this node, including remotes?`, 'Delete', async () => {
    await run(path, () => api.deleteBranch(path, local.short, true), { busy: DELETING, errorTitle: `Delete Failed: refs/heads/${local.short}`, success: `Deleted: refs/heads/${local.short}`, refresh: false })
    for (const r of remotes) await removeRemoteBranch(path, r, false)
    await refresh(path)
  })
}

export function renameBranch(path: string, ref: Ref): void {
  showPrompt({
    kind: 'input', message: `Rename '${ref.short}' to:`, value: ref.short, placeholder: 'new branch name',
    onSubmit: (v) => { const n = v.trim(); if (n && n !== ref.short) return run(path, () => api.renameBranch(path, ref.short, n), { errorTitle: 'Could not rename branch', success: 'Rename Successful', successMessage: `${ref.short} to ${n}` }) }
  })
}

/** "What remote/branch should X push to and pull from?" — used by Set Upstream and by Push without an upstream. */
export function setUpstreamDialog(path: string, ref: Ref, thenPush = false): void {
  const s = snap(path)
  const remotes = s.remotes.map((r) => r.name)
  if (!remotes.length) { toast({ kind: 'error', title: 'No remotes', message: 'Add a remote first.' }); return }
  const cur = ref.upstream ? remoteOf(path, ref.upstream) : null
  showPrompt({
    kind: 'upstream', message: `What remote/branch should "${ref.short}" push to and pull from?`,
    remotes, remote: cur?.remote ?? (remotes.includes('origin') ? 'origin' : remotes[0]), branch: cur?.branch ?? ref.short,
    onSubmit: async (remote, branch) => {
      const exists = s.refs.some((r) => r.type === 'remote' && r.short === `${remote}/${branch}`)
      if (thenPush || !exists) await doPush(path, { remote, branch: ref.short, remoteBranch: branch, setUpstream: true })
      else await run(path, () => api.setUpstream(path, ref.short, `${remote}/${branch}`))
    }
  })
}

export const mergeInto = (path: string, src: string) => runOp(path, () => api.merge(path, src), 'Merge', 'Merging', { title: 'Merged', message: `${src} into ${currentBranch(path) ?? 'HEAD'}` })
export const rebaseOnto = (path: string, onto: string) => runOp(path, () => api.rebase(path, onto), 'Rebase', 'Rebasing', { title: 'Rebase Successful' })
export const fastForward = (path: string, branch: Ref, to: string) => run(path, () => api.fastForward(path, branch.short, to, !!branch.isCurrent), { errorTitle: 'Fast-forward failed', success: 'Merged', successMessage: `${to} into ${branch.short}` })

// ---------------------------------------------------------------------------------------------
// commits

export function orderOldestFirst(path: string, shas: string[]): string[] {
  const order = snap(path).commits.map((c) => c.sha)
  return [...shas].sort((a, b) => order.indexOf(b) - order.indexOf(a))
}

/** the original asks whether the picked / reverted changes should be committed right away ("No" leaves them staged) */
function askCommitNow(message: string, go: (noCommit: boolean) => unknown): void {
  showPrompt({ kind: 'confirm', message, buttons: [{ label: 'Yes', style: 'success', run: () => go(false) }, { label: 'No', run: () => go(true) }] })
}
/** result toast of cherry pick / revert / patch; says so when the branch already had every change */
export const noopAware = (title: string, what: string) => (res: OpResult): void => {
  toast({ kind: 'success', title, message: res.noop ? `However, the current branch already has all changes from the ${what}.` : undefined }, res.noop ? TOAST_SHORT : undefined)
}
export const cherryPick = (path: string, shas: string[]) => askCommitNow('Do you want to immediately commit the cherry picked changes?', (noCommit) =>
  runOp(path, () => api.cherryPick(path, orderOldestFirst(path, shas), noCommit), 'Cherry pick', 'Cherry picking', undefined, noopAware('Cherry pick Successful', 'cherry picked commit')))
export const revertCommit = (path: string, c: Commit) => askCommitNow('Do you want to immediately commit the reverted changes?', (noCommit) =>
  runOp(path, () => api.revert(path, c.sha, c.parents.length > 1, noCommit), 'Revert', 'Reverting', undefined, noopAware('Revert Successful', 'reverted commit')))

export async function resetTo(path: string, sha: string, mode: ResetMode): Promise<void> {
  const go = () => runOp(path, () => api.reset(path, sha, mode), 'Reset')
  // the original resets without asking; uncommitted work that a hard reset would throw away still gets a confirmation here
  const s = snap(path)
  const tracked = [...s.status.staged, ...s.status.unstaged].some((f) => f.status !== '?')
  if (mode === 'hard' && tracked) confirmDestructive('This will discard all staged and unstaged changes. Are you sure you want to reset?', 'Reset', go)
  else await go()
}

/** Commits from HEAD (newest first) down to, but excluding, base. Follows first parents. */
export function commitsSince(path: string, base: string | null): Commit[] | null {
  const s = snap(path)
  const byId = new Map(s.commits.map((c) => [c.sha, c]))
  // everything the base can reach is already "below" it
  const reach = new Set<string>()
  if (base) {
    const stack = [base]
    while (stack.length) {
      const x = stack.pop()!
      if (reach.has(x)) continue
      reach.add(x)
      const c = byId.get(x)
      if (c) stack.push(...c.parents)
    }
  }
  const out: Commit[] = []
  let cur = byId.get(s.head.sha)
  while (cur && !reach.has(cur.sha)) {
    out.push(cur)
    if (!cur.parents.length) break
    cur = byId.get(cur.parents[0])
    if (!cur && base) return null
  }
  return out
}

/** "Move commit up / down": swaps a commit with its child / parent by an interactive rebase */
export async function moveCommit(path: string, sha: string, dir: 'up' | 'down'): Promise<void> {
  const list = commitsSince(path, null) ?? []
  const i = list.findIndex((c) => c.sha === sha)
  const j = dir === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= list.length) return
  const oldest = Math.max(i, j)
  const items: RebaseTodoItem[] = list.slice(0, oldest + 1).map((c) => ({ action: 'pick', sha: c.sha, summary: c.summary }))
  ;[items[i], items[j]] = [items[j], items[i]]
  await runInteractiveRebase(path, list[oldest].parents[0] ?? null, items)
}

/** the commits git rebases onto base: everything HEAD has that base doesn't, merge commits left out (git
 *  linearizes them), newest first in graph order */
export function rebaseRange(path: string, base: string | null): Commit[] {
  const s = snap(path)
  const byId = new Map(s.commits.map((c) => [c.sha, c]))
  const reach = (start: string | null): Set<string> => {
    const seen = new Set<string>()
    const stack = start ? [start] : []
    while (stack.length) {
      const x = stack.pop()!
      if (seen.has(x)) continue
      seen.add(x)
      const c = byId.get(x)
      if (c) stack.push(...c.parents)
    }
    return seen
  }
  const fromBase = reach(base)
  const fromHead = reach(s.head.sha)
  return s.commits.filter((c) => fromHead.has(c.sha) && !fromBase.has(c.sha) && c.parents.length < 2)
}

export function startInteractiveRebase(path: string, base: string | null, preset?: Partial<Record<string, RebaseTodoItem['action']>>, ontoLabel?: string): void {
  const s = snap(path)
  // local changes are stashed by git (--autostash) during the rebase, silently like the original
  const list = rebaseRange(path, base)
  if (!list.length) { toast({ kind: 'error', title: 'Nothing to rebase', message: `${s.head.branch ?? 'HEAD'} has no commits that are not already in the target.` }); return }
  const items: RebaseTodoItem[] = list.map((c) => ({ action: preset?.[c.sha] ?? 'pick', sha: c.sha, summary: c.summary, message: c.body ? `${c.summary}\n\n${c.body}` : c.summary }))
  updateRepo(path, { center: { kind: 'rebase', base, branch: s.head.branch ?? 'HEAD', items, onto: ontoLabel ?? base?.slice(0, 7) ?? 'root' } })
}

export async function runInteractiveRebase(path: string, base: string | null, itemsNewestFirst: RebaseTodoItem[]): Promise<void> {
  const items = [...itemsNewestFirst].reverse()
  if (items[0] && (items[0].action === 'squash' || items[0].action === 'fixup')) {
    toast({ kind: 'error', title: 'Cannot squash the oldest commit', message: 'The first commit in the rebase has no previous commit to squash into.' })
    return
  }
  updateRepo(path, { center: { kind: 'graph' } })
  await runOp(path, () => api.interactiveRebase(path, base, items), 'Interactive rebase', 'Rebasing')
}

export function rewordCommit(path: string, c: Commit): void {
  const isHead = c.sha === snap(path).head.sha
  openModal('prompt', {
    title: 'Edit commit message', okLabel: 'Update message',
    fields: [{ name: 'summary', label: 'Summary', value: c.summary }, { name: 'description', label: 'Description', value: c.body, multiline: true }],
    onOk: async (v: Record<string, string>) => {
      const message = v.description.trim() ? `${v.summary.trim()}\n\n${v.description.trim()}` : v.summary.trim()
      if (isHead) {
        if (snap(path).status.staged.length) {
          toast({ kind: 'error', title: 'Staged changes present', message: 'Unstage your changes first, or they would be added to the commit.' })
          return
        }
        await run(path, () => api.commit(path, message, true))
      } else {
        const list = commitsSince(path, null)
        const idx = list?.findIndex((x) => x.sha === c.sha) ?? -1
        if (!list || idx < 0) { toast({ kind: 'error', title: 'Commit is not on the current branch' }); return }
        const base = c.parents[0] ?? null
        const items: RebaseTodoItem[] = list.slice(0, idx + 1).map((x) => x.sha === c.sha ? { action: 'reword', sha: x.sha, summary: x.summary, message } : { action: 'pick', sha: x.sha, summary: x.summary })
        await runInteractiveRebase(path, base, items)
      }
    }
  })
}

export async function squashCommits(path: string, shas: string[]): Promise<void> {
  const list = commitsSince(path, null) ?? []
  const idx = shas.map((s) => list.findIndex((c) => c.sha === s))
  if (idx.some((i) => i < 0)) { toast({ kind: 'error', title: 'Can only squash commits on the current branch' }); return }
  const max = Math.max(...idx)
  const min = Math.min(...idx)
  if (max - min + 1 !== shas.length) { toast({ kind: 'error', title: 'Commits must be consecutive to squash' }); return }
  const base = list[max].parents[0] ?? null
  const items: RebaseTodoItem[] = list.slice(0, max + 1).map((c, i) => ({ action: i >= min && i < max ? 'squash' : 'pick', sha: c.sha, summary: c.summary }))
  await runInteractiveRebase(path, base, items)
}

export async function dropCommits(path: string, shas: string[]): Promise<void> {
  const list = commitsSince(path, null) ?? []
  const idx = shas.map((s) => list.findIndex((c) => c.sha === s))
  if (idx.some((i) => i < 0)) { toast({ kind: 'error', title: 'Can only drop commits on the current branch' }); return }
  const max = Math.max(...idx)
  const base = list[max].parents[0] ?? null
  const items: RebaseTodoItem[] = list.slice(0, max + 1).map((c) => ({ action: shas.includes(c.sha) ? 'drop' : 'pick', sha: c.sha, summary: c.summary }))
  showPrompt({
    kind: 'confirm', message: shas.length === 1 ? 'Are you sure you want to drop 1 commit?' : `Are you sure you want to drop ${shas.length} commits?`,
    buttons: [{ label: 'Drop', style: 'danger', run: () => runInteractiveRebase(path, base, items) }]
  })
}

// ---------------------------------------------------------------------------------------------
// tags

export async function deleteTag(path: string, ref: Ref): Promise<void> {
  confirmDestructive(`This is a destructive operation, are you sure you want to delete "${ref.short}"?`, 'Delete', async () => {
    const known = remoteTagsOf(path)
    const done = await run(path, () => api.deleteTag(path, ref.short).then(() => true), { errorTitle: 'Could not delete tag', success: `Deleted: refs/tags/${ref.short}` })
    if (!done) return
    // like the original: offer to delete it from the remotes that still have it
    const on = Object.entries(await Promise.race([known, new Promise<Record<string, string[] | null>>((ok) => setTimeout(() => ok({}), 4000))])).filter(([, tags]) => tags?.includes(ref.short)).map(([r]) => r)
    if (on.length) showPrompt({
      kind: 'confirm', message: `The tag was deleted locally. Would you also like to delete tags named "${ref.short}" from your remote repos?`,
      buttons: [{ label: 'Delete all', style: 'danger', run: () => removeTagFromRemotes(path, ref, on) }]
    })
  })
}
async function removeTagFromRemotes(path: string, ref: Ref, remotes: string[]): Promise<void> {
  for (const r of remotes) await run(path, () => api.deleteRemoteTag(path, r, ref.short), { busy: 'Deleting', errorTitle: `Delete Failed: ${ref.short} from ${r}`, success: `Deleted: ${ref.short} from ${r}`, refresh: false })
  forgetRemoteTags(path)
  await refresh(path)
}
export const deleteRemoteTag = (path: string, remote: string, ref: Ref) => confirmDestructive(`This is a destructive operation, are you sure you want to delete "${ref.short}" from "${remote}"?`, 'Delete', () => removeTagFromRemotes(path, ref, [remote]))
export const deleteTagFromAllRemotes = (path: string, ref: Ref, remotes: string[]) => confirmDestructive(`This is a destructive operation, are you sure you want to delete "${ref.short}" from your remote repos?`, 'Delete', () => removeTagFromRemotes(path, ref, remotes))
export const pushTag = async (path: string, remote: string, ref: Ref) => {
  await run(path, () => api.pushTag(path, remote, ref.short), { busy: 'Pushing', errorTitle: 'Push failed', success: 'Pushed Successfully', successMessage: `${ref.short} to ${remote}` })
  forgetRemoteTags(path)
}
export const pushTagToAll = async (path: string, ref: Ref, remotes: string[]) => {
  for (const r of remotes) await run(path, () => api.pushTag(path, r, ref.short), { busy: 'Pushing', errorTitle: 'Push failed', success: 'Pushed Successfully', successMessage: `${ref.short} to ${r}`, refresh: false })
  forgetRemoteTags(path)
  await refresh(path)
}
/** "Fast-forward v1 to main" / "Merge main into v1" on a tag: the original moves the tag (keeping its annotation) */
export const moveTag = (path: string, ref: Ref, to: string) => run(path, () => api.moveTag(path, ref.short, to), { errorTitle: 'Could not move tag' })

// which tags each remote has, used by the tag menu (push only where missing, delete only where present)
const remoteTagCache = new Map<string, { at: number; p: Promise<Record<string, string[] | null>> }>()
export function remoteTagsOf(path: string): Promise<Record<string, string[] | null>> {
  const c = remoteTagCache.get(path)
  if (c && Date.now() - c.at < 5 * 60_000) return c.p
  const p = api.remoteTags(path).catch(() => ({}))
  remoteTagCache.set(path, { at: Date.now(), p })
  return p
}
export const forgetRemoteTags = (path: string) => { remoteTagCache.delete(path) }

// ---------------------------------------------------------------------------------------------
// stash

export async function stashSave(path: string, message?: string, mode: 'all' | 'staged' | 'keep-index' = 'all'): Promise<void> {
  const v = repoView(path)
  const msg = message?.trim() || [v.wip.summary.trim(), v.wip.description.trim()].filter(Boolean).join(' ') || undefined
  await run(path, () => api.stashSave(path, msg, mode), { busy: 'Stashing', errorTitle: 'Stash failed' })
  updateRepo(path, { wip: { summary: '', description: '', amend: false } })
}
export async function stashPop(path: string, index = 0): Promise<void> { await runOp(path, () => api.stashPop(path, index), 'Pop stash', 'Popping stash') }
export async function stashApply(path: string, index: number): Promise<void> { await runOp(path, () => api.stashApply(path, index), 'Apply stash', 'Applying stash') }
export async function stashDrop(path: string, st: Stash): Promise<void> {
  confirmDestructive(`This is a destructive operation, are you sure you want to delete stash with message "${st.message}"?`, 'Delete', () =>
    run(path, () => api.stashDrop(path, st.index), { errorTitle: 'Could not delete stash' }))
}

// ---------------------------------------------------------------------------------------------
// worktrees

/** opens the Create Worktree panel; ref = full ref name (refs/heads/x, refs/remotes/o/x) or a sha */
export function addWorktreeDialog(path: string, opts: { ref?: string } = {}): void {
  updateRepo(path, { slidey: { kind: 'worktree', ref: opts.ref ?? '' } })
}

export async function removeWorktree(path: string, wt: Worktree, deleteBranch = false): Promise<void> {
  const branch = wt.branch?.replace(/^refs\/heads\//, '')
  const after = async () => {
    if (deleteBranch && branch) await run(path, () => api.deleteBranch(path, branch, true), { errorTitle: 'Could not delete branch' })
    else await refresh(path)
  }
  // like the original: git refuses to remove a worktree with changes, and only then is force offered
  const go = async () => {
    try {
      await api.removeWorktree(path, wt.path, false)
      await after()
    } catch {
      confirmDestructive('Removing this worktree requires force, which is destructive and cannot be undone. Do you want to complete the removal?', 'Force Remove Worktree', async () => {
        const done = await run(path, async () => { await api.removeWorktree(path, wt.path, true); return true }, { errorTitle: 'Could not remove worktree' })
        if (done) await after()
      })
    }
  }
  if (deleteBranch && branch) confirmDestructive(`This will permanently remove the worktree at '${wt.path}' and delete the local branch '${branch}'. This action cannot be undone.`, 'Remove and Delete', go)
  else await go()
}

// ---------------------------------------------------------------------------------------------
// network

const autoFetchFailed = new Set<string>()
export async function fetchAll(path: string, quiet = false): Promise<void> {
  forgetRemoteTags(path)
  if (quiet) {
    try { await api.fetchAll(path, true); autoFetchFailed.delete(path) } catch {
      // like the original: say so once per streak of failures
      if (!autoFetchFailed.has(path)) { autoFetchFailed.add(path); toast({ kind: 'error', title: 'Autofetch failed. Fetch manually for more information.' }, TOAST_SHORT) }
    }
    await refresh(path)
    void remoteTagsOf(path) // ready for the tag menu
    return
  }
  await run(path, () => api.fetchAll(path), { busy: 'Fetching', errorTitle: 'Fetch failed' })
  void remoteTagsOf(path)
}

export async function pull(path: string, mode?: PullMode): Promise<void> {
  const m = mode ?? getState().settings?.defaultPullMode ?? 'ff'
  if (m === 'fetch') return fetchAll(path)
  const s = snap(path)
  if (s.head.detached) { toast({ kind: 'error', title: 'Pull is not available when in a detached HEAD state' }); return }
  const local = s.refs.find((r) => r.type === 'head' && r.isCurrent)
  if (!local?.upstream) { toast({ kind: 'error', title: 'No upstream', message: `${s.head.branch} does not track a remote branch. Push it first or set an upstream.` }); return }
  const upstream = local.upstream.replace(/^refs\/remotes\//, '')
  // like the original: confirm the pull at once, and say so when there was nothing to bring in
  const res = await runOp(path, () => api.pull(path, m), 'Pull', 'Pulling', undefined, (res) => {
    ok('Pulled Successfully', undefined, TOAST_SHORT)
    if (res.upToDate) toast({ kind: 'info', title: 'Already Up-to-Date', message: `No merge necessary. Branch ${upstream} was not moved.` }, TOAST_SHORT)
  })
  // like the original: the commit the pull moved HEAD to ends up selected (its details open)
  const head = repoView(path)?.snapshot?.head.sha
  if (res?.ok && !res.conflicts && !res.upToDate && head) updateRepo(path, { selection: { kind: 'commits', shas: [head], anchor: head }, fileSel: [], focus: { sha: head, t: Date.now() } })
}

export function remoteOf(path: string, fullRemoteRef: string): { remote: string; branch: string } {
  const short = fullRemoteRef.replace(/^refs\/remotes\//, '')
  const remotes = snap(path).remotes.map((r) => r.name).sort((a, b) => b.length - a.length)
  const remote = remotes.find((r) => short.startsWith(r + '/')) ?? short.split('/')[0]
  return { remote, branch: short.slice(remote.length + 1) }
}

export async function push(path: string, branchName?: string, force = false): Promise<void> {
  const s = snap(path)
  const name = branchName ?? s.head.branch
  if (!name) { toast({ kind: 'error', title: 'Push is not available when in a detached HEAD state' }); return }
  const local = s.refs.find((r) => r.type === 'head' && r.short === name)
  if (!local) return
  if (!local.upstream || local.upstreamGone) {
    if (!s.remotes.length) { toast({ kind: 'error', title: 'No remotes', message: 'Add a remote before pushing.' }); return }
    setUpstreamDialog(path, local, true)
    return
  }
  const { remote, branch } = remoteOf(path, local.upstream)
  await doPush(path, { remote, branch: name, remoteBranch: branch, force })
}

type PushOpts = { remote: string; branch: string; remoteBranch?: string; setUpstream?: boolean; force?: boolean; noLease?: boolean }
export async function doPush(path: string, opts: PushOpts): Promise<void> {
  // the result (toast or prompt) shows as soon as the push ends, before the graph refreshes
  const report = (res: OpResult): void => {
    if (res.ok) { ok('Pushed Successfully', `${opts.branch} to ${opts.remote}`); return }
    // the remote branch moved since the last fetch (rejected while not known to be behind, or the lease failed)
    const remoteChanged = () =>
      showPrompt({
        kind: 'confirm', message: `WARNING! 'refs/heads/${opts.branch}' has changed on the remote since the last fetch.`,
        buttons: [
          { label: 'Fetch', style: 'success', run: () => fetchAll(path) },
          { label: 'Force Push Anyway', style: 'danger', run: () => showPrompt({ kind: 'confirm', message: 'Force push is a destructive action and cannot be undone. Are you sure?', buttons: [{ label: 'Force Push', style: 'danger', run: () => doPush(path, { ...opts, force: true, noLease: true }) }] }) }
        ]
      })
    if (res.error === 'stale') { remoteChanged(); return }
    if (res.error === 'rejected' && !opts.force) {
      // like the original: "behind" only when the branch is known to be behind its upstream
      if (!snap(path).refs.find((r) => r.type === 'head' && r.short === opts.branch)?.behind) { remoteChanged(); return }
      showPrompt({
        kind: 'confirm', message: `'refs/heads/${opts.branch}' is behind 'refs/remotes/${opts.remote}/${opts.remoteBranch ?? opts.branch}'. Update your branch by doing a Pull.`,
        buttons: [
          { label: getState().settings?.defaultPullMode === 'ff-only' ? 'Pull (fast-forward only)' : getState().settings?.defaultPullMode === 'rebase' ? 'Pull (rebase)' : 'Pull (fast-forward if possible)', style: 'success', run: () => pull(path) },
          { label: 'Force Push', style: 'danger', run: () => confirmForcePush(path, opts) }
        ]
      })
      return
    }
    toast({ kind: 'error', title: 'Push failed', message: res.error })
  }
  await run(path, () => api.push(path, opts), { busy: 'Pushing', after: report })
}

export function confirmForcePush(path: string, opts: PushOpts): void {
  if (getState().settings?.forcePushSkipSecondWarning) { void doPush(path, { ...opts, force: true }); return }
  showPrompt({
    kind: 'confirm', message: 'Force push is a destructive action and cannot be undone. Are you sure?',
    buttons: [{ label: 'Force Push', style: 'danger', run: () => doPush(path, { ...opts, force: true }) }],
    dontAskAgain: (v) => { if (v) { setState((s) => ({ settings: s.settings ? { ...s.settings, forcePushSkipSecondWarning: true } : s.settings })); void api.setSettings({ forcePushSkipSecondWarning: true }) } }
  })
}

let fetchTimer: number | null = null
function startAutoFetch(): void {
  if (fetchTimer) window.clearInterval(fetchTimer)
  fetchTimer = window.setInterval(() => {
    const mins = getState().settings?.autoFetchMinutes ?? 0
    if (!mins) return
    const t = activeTab()
    if (!t) return
    const v = getState().repos[t.path]
    if (!v?.snapshot || v.busy || !v.snapshot.remotes.length) return
    const last = (window as unknown as { __lastFetch?: Record<string, number> }).__lastFetch ??= {}
    if (Date.now() - (last[t.path] ?? 0) < mins * 60000) return
    last[t.path] = Date.now()
    void fetchAll(t.path, true)
  }, 15000)
}

// ---------------------------------------------------------------------------------------------
// undo / redo

// like the original: the last action comes from the reflog; a reset or rebase over local changes asks to stash first
async function undoOrRedo(path: string, which: 'undo' | 'redo'): Promise<void> {
  const state = (await api.undoState(path).catch(() => null))?.[which]
  const go = async (stash: boolean) => {
    const label = await run(path, () => (which === 'undo' ? api.undo(path, { stash }) : api.redo(path, { stash })), { errorTitle: which === 'undo' ? 'Undo Failed' : 'Redo Failed' })
    if (label) ok(which === 'undo' ? 'Undo Successful' : 'Redo Successful', label, TOAST_SHORT)
  }
  if (state?.needsStash) {
    showPrompt({
      kind: 'confirm', message: `To undo/redo the last reset, you must stash any changes in branch "${state.needsStash}". Do you want to do this now?`,
      buttons: [{ label: 'Stash Changes', style: 'danger', run: () => go(true) }]
    })
    return
  }
  await go(false)
}
export const undo = (path: string) => undoOrRedo(path, 'undo')
export const redo = (path: string) => undoOrRedo(path, 'redo')

// ---------------------------------------------------------------------------------------------
// native context menus

export type MI = { label: string; act?: () => unknown; enabled?: boolean; sub?: MI[]; checked?: boolean; accelerator?: string } | '-'

export async function popup(items: MI[]): Promise<void> {
  const actions = new Map<string, () => unknown>()
  let n = 0
  const conv = (list: MI[]): MenuItemSpec[] => {
    const out: MenuItemSpec[] = []
    for (const i of list) {
      if (i === '-') { if (out.length && out[out.length - 1].type !== 'separator') out.push({ type: 'separator' }); continue }
      const id = String(++n)
      if (i.act) actions.set(id, i.act)
      out.push({ id, label: i.label, enabled: i.enabled !== false && (!!i.act || !!i.sub?.length), type: i.checked !== undefined ? 'checkbox' : 'normal', checked: i.checked, accelerator: i.accelerator, submenu: i.sub ? conv(i.sub) : undefined })
    }
    while (out.length && out[out.length - 1].type === 'separator') out.pop()
    return out
  }
  const spec = conv(items)
  // automation hook: a test harness can set window.__sgMenuPick to choose an item instead of showing the native menu
  const pick = (window as unknown as { __sgMenuPick?: (s: MenuItemSpec[]) => string | undefined | Promise<string | undefined> }).__sgMenuPick
  const id = pick ? await pick(spec) : await api.showContextMenu(spec)
  if (id) actions.get(id)?.()
}
