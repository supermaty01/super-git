// All user-triggered operations: they call the git backend, report errors as toasts and refresh state.
import { api, bridge } from './lib/api'
import {
  getState, setState, updateRepo, newRepoView, toast, openModal, showPrompt, MGMT_TAB, type RepoView, type Selection, type CenterView
} from './store'
import type { RepoSnapshot, Ref, Commit, FileChange, FileContext, OpResult, ResetMode, PullMode, RebaseTodoItem, Stash, Worktree, MenuItemSpec, TabInfo } from '@shared/types'
import { errMsg, basename } from './lib/format'

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
    if (tab && tab.path === p) void refresh(p)
  })
  bridge().onProgress((e) => setState({ progress: { repo: e.repo, text: e.text } }))
  bridge().onZoom((z) => setState((s) => ({ settings: s.settings ? { ...s.settings, zoom: z } : s.settings })))
  window.addEventListener('focus', () => { const t = activeTab(); if (t) void refresh(t.path) })
  if (active !== MGMT_TAB) await activateTab(active)
  startAutoFetch()
}

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
  if (!tab) { await watchOnly(null); return }
  const s = getState()
  if (!s.repos[tab.path]) {
    setState({ repos: { ...s.repos, [tab.path]: newRepoView(tab.path, s.settings?.commitLimit ?? 2000) } })
  }
  await watchOnly(tab.path)
  await refresh(tab.path)
}

export async function openRepo(p: string): Promise<void> {
  const info = await api.resolveRepo(p)
  if (!info) {
    toast({ kind: 'error', title: 'Not a git repository', message: p })
    return
  }
  const root = info.root
  const existing = getState().tabs.find((t) => t.path.toLowerCase() === root.toLowerCase())
  if (existing) { await activateTab(existing.id); return }
  const tab: TabInfo = { id: crypto.randomUUID(), path: root, name: basename(root) }
  setState((s) => ({ tabs: [...s.tabs, tab] }))
  await api.addRecent(root, tab.name)
  setState((s) => ({ settings: s.settings ? { ...s.settings, recent: [{ path: root, name: tab.name, lastOpened: Date.now() }, ...s.settings.recent.filter((r) => r.path.toLowerCase() !== root.toLowerCase())] } : s.settings }))
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
  closedTabs.push(tab)
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
    const [snap, undo] = await Promise.all([api.snapshot(path, v.limit), api.undoState(path)])
    updateRepo(path, (r) => ({
      snapshot: snap, loading: false, error: undefined, undo,
      selection: fixSelection(r.selection, snap),
      center: fixCenter(r.center, snap),
      wip: r.wip.summary || !snap.status.state.message || snap.status.state.kind === 'none' ? r.wip : messageToWip(snap.status.state.message, r.wip.amend)
    }))
  } catch (e) {
    updateRepo(path, { loading: false, error: errMsg(e) })
  }
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

interface RunOpts { busy?: string; success?: string; errorTitle?: string; refresh?: boolean }

export async function run<T>(path: string, fn: () => Promise<T>, opts: RunOpts = {}): Promise<T | undefined> {
  if (opts.busy) updateRepo(path, { busy: opts.busy })
  try {
    const r = await fn()
    if (opts.success) toast({ kind: 'success', title: opts.success })
    return r
  } catch (e) {
    toast({ kind: 'error', title: opts.errorTitle ?? 'Something went wrong', message: errMsg(e) })
    return undefined
  } finally {
    if (opts.busy) updateRepo(path, { busy: null })
    setState({ progress: null })
    if (opts.refresh !== false) await refresh(path)
  }
}

export async function runOp(path: string, fn: () => Promise<OpResult>, what: string, busy?: string): Promise<OpResult | undefined> {
  const res = await run(path, fn, { busy })
  if (!res) return res
  if (res.conflicts) {
    toast({ kind: 'info', title: `${what} resulted in conflicts`, message: 'Resolve the conflicted files in the commit panel, then continue.' }, 8000)
    updateRepo(path, { selection: { kind: 'wip' } })
  } else if (!res.ok) {
    toast({ kind: 'error', title: `${what} failed`, message: res.error })
  }
  return res
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
      const a = order.indexOf(sel.anchor)
      const b = order.indexOf(sha)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        return { selection: { kind: 'commits', shas: order.slice(lo, hi + 1), anchor: sel.anchor }, fileSel: [] }
      }
    }
    return { selection: { kind: 'commits', shas: [sha], anchor: sha }, fileSel: [] }
  })
}

export function openFile(path: string, ctx: FileContext): void { updateRepo(path, { center: { kind: 'file', ctx } }) }
export function openMerge(path: string, file: string): void { updateRepo(path, { center: { kind: 'merge', file } }) }
export function closeCenter(path: string): void { updateRepo(path, { center: { kind: 'graph' } }) }

// ---------------------------------------------------------------------------------------------
// staging & commit

export const stageFiles = (path: string, files: FileChange[]) => run(path, () => api.stage(path, files.flatMap((f) => (f.oldPath && f.status === 'R' ? [f.path, f.oldPath] : [f.path]))))
export const unstageFiles = (path: string, files: FileChange[]) => run(path, () => api.unstage(path, files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))))
export const stageAll = (path: string) => run(path, () => api.stageAll(path))
export const unstageAll = (path: string) => run(path, () => api.unstageAll(path))

export async function discardFiles(path: string, files: FileChange[]): Promise<void> {
  const what = files.length === 1 ? `"${files[0].path}"` : `${files.length} files`
  const r = await api.confirm({ title: 'Discard changes', message: `Discard changes to ${what}?`, detail: 'This cannot be undone.', buttons: ['Discard', 'Cancel'], type: 'warning' })
  if (r !== 0) return
  await run(path, () => api.discardFiles(path, files))
}

export async function discardAll(path: string): Promise<void> {
  const r = await api.confirm({ title: 'Discard all changes', message: 'Discard all changes in the working directory?', detail: 'All staged, unstaged and untracked changes will be lost. This cannot be undone.', buttons: ['Discard all', 'Cancel'], type: 'warning' })
  if (r !== 0) return
  await run(path, () => api.discardAll(path))
}

export async function applyHunk(path: string, ctx: FileContext, hunk: number, lines: number[] | null, action: 'stage' | 'unstage' | 'discard' | 'revert'): Promise<void> {
  if (action === 'discard') {
    const r = await api.confirm({ title: 'Discard', message: lines ? 'Discard the selected lines?' : 'Discard this hunk?', detail: 'This cannot be undone.', buttons: ['Discard', 'Cancel'], type: 'warning' })
    if (r !== 0) return
  }
  await run(path, () => api.applyHunk(path, ctx, hunk, lines, action), action === 'revert' ? { success: 'Hunk reverted in the working directory', errorTitle: 'Could not revert the hunk' } : {})
}

export async function commit(path: string, opts: { noVerify?: boolean; sign?: boolean } = {}): Promise<void> {
  const v = repoView(path)
  const { summary, description, amend } = v.wip
  if (!summary.trim()) return
  const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim()
  const state = v.snapshot!.status.state
  if (state.kind !== 'none') {
    await runOp(path, () => api.continueOp(path, state.kind, message), state.kind === 'merge' ? 'Merge' : 'Continue')
    updateRepo(path, { wip: { summary: '', description: '', amend: false } })
    return
  }
  const set = getState().settings!
  const ok = await run(path, async () => { await api.commit(path, message, amend, { ...opts, keepComments: !set.stripComments }); return true }, { errorTitle: 'Commit failed' })
  if (ok) {
    updateRepo(path, { wip: { summary: '', description: '', amend: false } })
    // "Push after each commit" (only when the branch already tracks a remote, so it never prompts)
    if (set.pushAfterCommit && !amend && snap(path).refs.some((r) => r.isCurrent && r.upstream)) await push(path)
  }
}

export async function setAmend(path: string, amend: boolean): Promise<void> {
  if (amend) {
    const msg = await api.lastCommitMessage(path)
    const [summary, ...rest] = msg.split('\n')
    updateRepo(path, { wip: { summary, description: rest.join('\n').trim(), amend: true } })
  } else updateRepo(path, { wip: { summary: '', description: '', amend: false } })
}

// ---------------------------------------------------------------------------------------------
// conflicts & in-progress operations

export const markResolved = (path: string, files: string[]) => run(path, () => api.stage(path, files))
export const takeSide = (path: string, file: string, side: 'ours' | 'theirs') => run(path, () => api.resolveWithSide(path, file, side))
export async function abortOp(path: string): Promise<void> {
  const kind = snap(path).status.state.kind
  if (kind === 'none') return
  const r = await api.confirm({ title: `Abort ${kind}`, message: `Abort the ${kind} in progress?`, detail: 'Your working directory will be restored to the state before the operation started.', buttons: [`Abort ${kind}`, 'Cancel'], type: 'warning' })
  if (r !== 0) return
  await runOp(path, () => api.abortOp(path, kind), 'Abort')
  updateRepo(path, { wip: { summary: '', description: '', amend: false } })
}
export async function continueOp(path: string): Promise<void> {
  const v = repoView(path)
  const kind = v.snapshot!.status.state.kind
  const msg = v.wip.summary.trim() ? [v.wip.summary.trim(), v.wip.description.trim()].filter(Boolean).join('\n\n') : undefined
  await runOp(path, () => api.continueOp(path, kind, msg), 'Continue')
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
  const doIt = () => ref.type === 'head' ? api.checkout(path, ref.short)
    : ref.type === 'remote' ? api.checkoutRemote(path, ref.short, !!localForRemote(path, ref.short)).then(() => undefined)
      : api.checkout(path, ref.sha)
  // like the original: the left panel shows "Checking out branch" and the toolbar is disabled until it is done
  updateRepo(path, { busy: CHECKING_OUT })
  try {
    await doIt()
    await refresh(path)
  } catch (e) {
    const msg = errMsg(e)
    if (/would be overwritten by checkout|commit your changes or stash them/i.test(msg)) {
      const r = await api.confirm({ title: 'Local changes', message: `Your local changes would be overwritten by checking out ${ref.short}.`, detail: 'Stash your changes and checkout? The stash will be kept so you can pop it later.', buttons: ['Stash & Checkout', 'Cancel'], type: 'warning' })
      if (r === 0) {
        const ok = await run(path, async () => { await api.stashSave(path, `WIP before checkout of ${ref.short}`); await doIt(); return true }, { errorTitle: `Could not checkout ${ref.short}` })
        if (ok) toast({ kind: 'info', title: 'Changes stashed', message: 'Use Pop to restore them.' })
      }
    } else {
      toast({ kind: 'error', title: `Could not checkout ${ref.short}`, message: msg })
      await refresh(path)
    }
  } finally {
    if (repoView(path)?.busy === CHECKING_OUT) updateRepo(path, { busy: null })
  }
}

/** busy labels that cover the left panel with a loading overlay (others only show in the toolbar / status bar) */
export const CHECKING_OUT = 'Checking out branch'
export const DELETING = 'Deleting...'

export const checkoutCommit = (path: string, sha: string) => run(path, () => api.checkout(path, sha), { busy: CHECKING_OUT, errorTitle: 'Checkout failed' })

export function startCreateRef(path: string, kind: 'branch' | 'tag' | 'annotated-tag', sha?: string): void {
  const s = snap(path)
  const at = sha ?? (repoView(path).selection?.kind === 'commits' ? (repoView(path).selection as { anchor: string }).anchor : s.head.sha)
  if (!at) { toast({ kind: 'error', title: 'Nothing to branch from', message: 'This repository has no commits yet.' }); return }
  updateRepo(path, { newRef: { kind, sha: at } })
}

export async function submitNewRef(path: string, name: string): Promise<void> {
  const nr = repoView(path).newRef
  updateRepo(path, { newRef: null })
  const n = name.trim()
  if (!nr || !n) return
  if (nr.kind === 'branch') await run(path, () => api.createBranch(path, n, nr.sha, true), { errorTitle: 'Could not create branch' })
  else if (nr.kind === 'annotated-tag') {
    showPrompt({
      kind: 'input', message: 'Message:', placeholder: 'Annotation message',
      onSubmit: (msg) => run(path, () => api.createTag(path, n, nr.sha, msg.trim() || n), { errorTitle: 'Could not create tag' })
    })
  } else await run(path, () => api.createTag(path, n, nr.sha), { errorTitle: 'Could not create tag' })
}

export async function deleteLocalBranch(path: string, ref: Ref): Promise<void> {
  // like the original: deletes right away (Undo restores it); only unmerged work asks first
  try {
    updateRepo(path, { busy: DELETING })
    try { await api.deleteBranch(path, ref.short, false) } finally { updateRepo(path, { busy: null }) }
    await refresh(path)
  } catch (e) {
    const msg = errMsg(e)
    if (/not fully merged/.test(msg)) {
      showPrompt({
        kind: 'confirm', message: `'${ref.short}' is not fully merged. Delete it anyway?`,
        buttons: [{ label: 'Delete', style: 'danger', run: () => run(path, () => api.deleteBranch(path, ref.short, true), { busy: DELETING }) }]
      })
    } else toast({ kind: 'error', title: 'Could not delete branch', message: msg })
  }
}

export async function deleteRemoteBranch(path: string, ref: Ref): Promise<void> {
  const r = await api.confirm({ title: 'Delete remote branch', message: `Delete "${ref.short}" from the remote?`, detail: 'This deletes the branch on the server for everyone.', buttons: ['Delete', 'Cancel'], type: 'warning' })
  if (r !== 0) return
  const branch = ref.short.slice(ref.remote!.length + 1)
  await run(path, () => api.deleteRemoteBranch(path, ref.remote!, branch), { busy: 'Deleting', success: `Deleted ${ref.short}` })
}

export function renameBranch(path: string, ref: Ref): void {
  showPrompt({
    kind: 'input', message: `Rename '${ref.short}' to:`, value: ref.short, placeholder: 'new branch name',
    onSubmit: (v) => { const n = v.trim(); if (n && n !== ref.short) return run(path, () => api.renameBranch(path, ref.short, n), { errorTitle: 'Could not rename branch' }) }
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

export const mergeInto = (path: string, src: string) => runOp(path, () => api.merge(path, src), 'Merge', 'Merging')
export const rebaseOnto = (path: string, onto: string) => runOp(path, () => api.rebase(path, onto), 'Rebase', 'Rebasing')
export const fastForward = (path: string, branch: Ref, to: string) => run(path, () => api.fastForward(path, branch.short, to, !!branch.isCurrent), { errorTitle: 'Fast-forward failed' })

// ---------------------------------------------------------------------------------------------
// commits

export function orderOldestFirst(path: string, shas: string[]): string[] {
  const order = snap(path).commits.map((c) => c.sha)
  return [...shas].sort((a, b) => order.indexOf(b) - order.indexOf(a))
}

export const cherryPick = (path: string, shas: string[]) => runOp(path, () => api.cherryPick(path, orderOldestFirst(path, shas)), 'Cherry pick', 'Cherry picking')
export const revertCommit = (path: string, c: Commit) => runOp(path, () => api.revert(path, c.sha, c.parents.length > 1), 'Revert', 'Reverting')

export async function resetTo(path: string, sha: string, mode: ResetMode): Promise<void> {
  if (mode === 'hard') {
    const r = await api.confirm({ title: 'Hard reset', message: `Reset ${currentBranch(path) ?? 'HEAD'} to ${sha.slice(0, 7)} and discard all changes?`, detail: 'Uncommitted changes will be lost.', buttons: ['Reset', 'Cancel'], type: 'warning' })
    if (r !== 0) return
  }
  await runOp(path, () => api.reset(path, sha, mode), 'Reset')
}

/** Commits from HEAD (newest first) down to, but excluding, base. Follows first parents. */
export function commitsSince(path: string, base: string | null): Commit[] | null {
  const s = snap(path)
  const byId = new Map(s.commits.map((c) => [c.sha, c]))
  const out: Commit[] = []
  let cur = byId.get(s.head.sha)
  while (cur && cur.sha !== base) {
    out.push(cur)
    if (!cur.parents.length) break
    cur = byId.get(cur.parents[0])
    if (!cur && base) return null
  }
  return out
}

export function startInteractiveRebase(path: string, base: string | null, preset?: Partial<Record<string, RebaseTodoItem['action']>>): void {
  const s = snap(path)
  if (s.status.staged.length + s.status.unstaged.length > 0) {
    toast({ kind: 'info', title: 'Working directory has changes', message: 'Your changes will be stashed automatically during the rebase.' })
  }
  const list = commitsSince(path, base)
  if (!list || !list.length) { toast({ kind: 'error', title: 'Nothing to rebase', message: 'Select a commit that is an ancestor of HEAD.' }); return }
  if (list.some((c) => c.parents.length > 1)) toast({ kind: 'info', title: 'Merge commits in range', message: 'Merge commits will be flattened by the interactive rebase.' })
  const items: RebaseTodoItem[] = list.map((c) => ({ action: preset?.[c.sha] ?? 'pick', sha: c.sha, summary: c.summary, message: c.body ? `${c.summary}\n\n${c.body}` : c.summary }))
  updateRepo(path, { center: { kind: 'rebase', base, branch: s.head.branch ?? 'HEAD', items } })
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
  const r = await api.confirm({ title: 'Delete tag', message: `Delete tag "${ref.short}" locally?`, buttons: ['Delete', 'Cancel'], type: 'warning' })
  if (r === 0) await run(path, () => api.deleteTag(path, ref.short))
}
export const deleteRemoteTag = (path: string, remote: string, ref: Ref) => run(path, () => api.deleteRemoteTag(path, remote, ref.short), { busy: 'Deleting', success: `Deleted ${ref.short} from ${remote}` })
export const pushTag = (path: string, remote: string, ref: Ref) => run(path, () => api.pushTag(path, remote, ref.short), { busy: 'Pushing', success: `Pushed ${ref.short} to ${remote}` })

// ---------------------------------------------------------------------------------------------
// stash

export async function stashSave(path: string, message?: string, mode: 'all' | 'staged' | 'keep-index' = 'all'): Promise<void> {
  const v = repoView(path)
  const msg = message?.trim() || v.wip.summary.trim() || undefined
  await run(path, () => api.stashSave(path, msg, mode), { busy: 'Stashing', errorTitle: 'Stash failed' })
  updateRepo(path, { wip: { summary: '', description: '', amend: false } })
}
export async function stashPop(path: string, index = 0): Promise<void> { await runOp(path, () => api.stashPop(path, index), 'Pop stash', 'Popping stash') }
export async function stashApply(path: string, index: number): Promise<void> { await runOp(path, () => api.stashApply(path, index), 'Apply stash', 'Applying stash') }
export async function stashDrop(path: string, st: Stash): Promise<void> {
  const r = await api.confirm({ title: 'Delete stash', message: `Delete stash@{${st.index}}?`, detail: st.message, buttons: ['Delete', 'Cancel'], type: 'warning' })
  if (r === 0) await run(path, () => api.stashDrop(path, st.index))
}

// ---------------------------------------------------------------------------------------------
// worktrees

export function addWorktreeDialog(path: string, opts: { branch?: string; commit?: string } = {}): void {
  const parent = path.replace(/[\\/][^\\/]+$/, '')
  const base = basename(path)
  const suggested = `${parent}\\${base}-${(opts.branch ?? opts.commit?.slice(0, 7) ?? 'worktree').replace(/[\\/]/g, '-')}`
  openModal('worktree', { path, branch: opts.branch, commit: opts.commit, dir: suggested })
}

export async function removeWorktree(path: string, wt: Worktree): Promise<void> {
  const r = await api.confirm({ title: 'Remove worktree', message: `Remove worktree at ${wt.path}?`, detail: 'The folder will be deleted. The branch is kept.', buttons: ['Remove', 'Cancel'], type: 'warning' })
  if (r !== 0) return
  try {
    await api.removeWorktree(path, wt.path, false)
  } catch (e) {
    const f = await api.confirm({ title: 'Worktree has changes', message: errMsg(e), detail: 'Force removal? Uncommitted changes in the worktree will be lost.', buttons: ['Force remove', 'Cancel'], type: 'warning' })
    if (f === 0) await run(path, () => api.removeWorktree(path, wt.path, true))
  }
  await refresh(path)
}

// ---------------------------------------------------------------------------------------------
// network

export async function fetchAll(path: string, quiet = false): Promise<void> {
  if (quiet) {
    try { await api.fetchAll(path, true) } catch { /* silent */ }
    await refresh(path)
    return
  }
  await run(path, () => api.fetchAll(path), { busy: 'Fetching', errorTitle: 'Fetch failed' })
}

export async function pull(path: string, mode?: PullMode): Promise<void> {
  const m = mode ?? getState().settings?.defaultPullMode ?? 'ff'
  if (m === 'fetch') return fetchAll(path)
  const s = snap(path)
  if (s.head.detached) { toast({ kind: 'error', title: 'Pull is not available when in a detached HEAD state' }); return }
  const local = s.refs.find((r) => r.type === 'head' && r.isCurrent)
  if (!local?.upstream) { toast({ kind: 'error', title: 'No upstream', message: `${s.head.branch} does not track a remote branch. Push it first or set an upstream.` }); return }
  const res = await runOp(path, () => api.pull(path, m), 'Pull', 'Pulling')
  if (res?.ok) toast({ kind: 'success', title: 'Pull complete' }, 2500)
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

export async function doPush(path: string, opts: { remote: string; branch: string; remoteBranch?: string; setUpstream?: boolean; force?: boolean }): Promise<void> {
  const res = await run(path, () => api.push(path, opts), { busy: 'Pushing' })
  if (!res) return
  if (res.ok) { toast({ kind: 'success', title: `Pushed ${opts.branch} to ${opts.remote}` }, 2500); return }
  if (res.error === 'rejected' && !opts.force) {
    showPrompt({
      kind: 'confirm', message: `'${opts.branch}' is behind '${opts.remote}/${opts.remoteBranch ?? opts.branch}'. Update your branch by doing a Pull.`,
      buttons: [
        { label: 'Pull', style: 'success', run: () => pull(path) },
        { label: 'Force Push', style: 'danger', run: () => confirmForcePush(path, opts) }
      ]
    })
    return
  }
  toast({ kind: 'error', title: 'Push failed', message: res.error })
}

export function confirmForcePush(path: string, opts: { remote: string; branch: string; remoteBranch?: string; setUpstream?: boolean }): void {
  showPrompt({
    kind: 'confirm', message: 'Force push is a destructive action and cannot be undone. Are you sure?',
    buttons: [{ label: 'Force Push', style: 'danger', run: () => doPush(path, { ...opts, force: true }) }]
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

export async function undo(path: string): Promise<void> {
  const label = await run(path, () => api.undo(path), { errorTitle: 'Undo failed' })
  if (label) toast({ kind: 'info', title: `Undid ${label}` }, 2000)
}
export async function redo(path: string): Promise<void> {
  const label = await run(path, () => api.redo(path), { errorTitle: 'Redo failed' })
  if (label) toast({ kind: 'info', title: `Redid ${label}` }, 2000)
}

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
