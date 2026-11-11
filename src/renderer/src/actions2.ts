// Additional actions: visibility, compare, patches, gitflow, submodules, tabs, terminal, external tools.
import { api } from './lib/api'
import { getState, setState, updateRepo, toast, dismissToast, openModal, showPrompt } from './store'
import { run, runOp, snap, repoView, orderOldestFirst, openRepo, closeTab, persistTabs } from './actions'
import { basename } from './lib/format'
import type { Settings, Stash } from '@shared/types'

export function saveSettings(patch: Partial<Settings>): void {
  setState((s) => ({ settings: s.settings ? { ...s.settings, ...patch } : s.settings }))
  void api.setSettings(patch)
}

// ---------------------------------------------------------------------------------------------
// branch visibility (hide / solo)

export const hiddenFor = (path: string): string[] => getState().settings?.hiddenRefs[path] ?? []
export const soloFor = (path: string): string[] => getState().settings?.soloRefs[path] ?? []

export function setHidden(path: string, names: string[], hide: boolean): void {
  const cur = new Set(hiddenFor(path))
  for (const n of names) { if (hide) cur.add(n); else cur.delete(n) }
  saveSettings({ hiddenRefs: { ...getState().settings!.hiddenRefs, [path]: [...cur] } })
}
export function setSolo(path: string, names: string[], solo: boolean): void {
  const cur = new Set(soloFor(path))
  for (const n of names) { if (solo) cur.add(n); else cur.delete(n) }
  saveSettings({ soloRefs: { ...getState().settings!.soloRefs, [path]: [...cur] } })
}
export function setPinned(path: string, refName: string | null): void {
  const cur = { ...getState().settings!.pinnedRefs }
  if (refName) cur[path] = refName
  else delete cur[path]
  saveSettings({ pinnedRefs: cur })
}

export function clearVisibility(path: string): void {
  const s = getState().settings!
  // "Show all" brings the branches back; stashes hidden one by one stay hidden
  const stashes = (s.hiddenRefs[path] ?? []).filter((n) => n.startsWith('stash:'))
  saveSettings({ hiddenRefs: { ...s.hiddenRefs, [path]: stashes }, soloRefs: { ...s.soloRefs, [path]: [] } })
}

// ---------------------------------------------------------------------------------------------
// compare

export function compareWithWorkdir(path: string, sha: string): void {
  updateRepo(path, { selection: { kind: 'compare', a: sha, b: null }, center: { kind: 'graph' } })
}
export function compareCommits(path: string, a: string, b: string): void {
  const order = snap(path).commits.map((c) => c.sha)
  const [older, newer] = order.indexOf(a) > order.indexOf(b) ? [a, b] : [b, a]
  updateRepo(path, { selection: { kind: 'compare', a: older, b: newer } })
}

// ---------------------------------------------------------------------------------------------
// stash rename, merge variants

export function renameStash(path: string, st: Stash): void {
  showPrompt({
    kind: 'input', message: 'Edit stash message:', value: st.message, placeholder: 'stash message',
    onSubmit: (v) => run(path, () => api.stashRename(path, st.index, v.trim()))
  })
}
export const mergeNoFF = (path: string, src: string) => runOp(path, () => api.merge(path, src, { noFF: true }), 'Merge', 'Merging')
export const mergeSquash = (path: string, src: string) => runOp(path, () => api.merge(path, src, { squash: true }), 'Squash merge', 'Merging')

// ---------------------------------------------------------------------------------------------
// patches

export async function createPatch(path: string, shas: string[]): Promise<void> {
  const ordered = orderOldestFirst(path, shas)
  const c = snap(path).commits.find((x) => x.sha === ordered[ordered.length - 1])
  const name = (c?.summary ?? 'changes').replace(/[^\w.-]+/g, '-').slice(0, 60)
  const parent = path.replace(/[\\/][^\\/]+$/, '')
  const file = await api.pickSaveFile('Save patch', `${parent}/${name}.patch`, [{ name: 'Patch', extensions: ['patch', 'diff'] }])
  if (!file) return
  await run(path, () => api.createPatch(path, ordered, file), { success: `Saved ${ordered.length} commit(s) to ${basename(file)}`, refresh: false })
}

export async function applyPatch(path: string): Promise<void> {
  const file = await api.pickOpenFile('Apply patch', [{ name: 'Patch', extensions: ['patch', 'diff'] }, { name: 'All files', extensions: ['*'] }])
  if (!file) return
  const r = await api.confirm({
    title: 'Apply patch', message: 'How should the patch be applied?',
    detail: 'As commits: recreates the commits from a format-patch file (git am).\nTo working directory: applies the changes without committing (git apply).',
    buttons: ['As commits', 'To working directory', 'Cancel'], type: 'question'
  })
  if (r === 2) return
  await runOp(path, () => api.applyPatch(path, file, r === 0), 'Apply patch')
}

// ---------------------------------------------------------------------------------------------
// gitflow

export function gitflowStartDialog(path: string, type: 'feature' | 'release' | 'hotfix'): void {
  const label = type[0].toUpperCase() + type.slice(1)
  openModal('prompt', {
    title: `Gitflow: start ${type}`, okLabel: `Start ${label}`,
    fields: [{ name: 'name', label: type === 'feature' ? 'Feature name' : 'Version', placeholder: type === 'feature' ? 'my-feature' : '1.2.0' }],
    onOk: (v: Record<string, string>) => run(path, () => api.gitflowStart(path, type, v.name.trim().replace(/\s+/g, '-')), { errorTitle: `Could not start ${type}` })
  })
}

export async function gitflowFinish(path: string, type: 'feature' | 'release' | 'hotfix', name: string): Promise<void> {
  const cfg = snap(path).gitflow
  const detail = type === 'feature'
    ? `Merges ${cfg.feature}${name} into ${cfg.develop} (--no-ff).`
    : `Merges into ${cfg.master}, tags ${cfg.versionTag}${name}, then merges back into ${cfg.develop}.`
  const r = await api.confirm({ title: `Finish ${type}`, message: `Finish ${type} "${name}"?`, detail, buttons: ['Finish and delete branch', 'Finish and keep branch', 'Cancel'], type: 'question' })
  if (r === 2) return
  await runOp(path, () => api.gitflowFinish(path, type, name, { deleteBranch: r === 0 }), `Finish ${type}`, 'Finishing')
}

/** Recognizes gitflow branches: returns the type and short name (or null). */
export function gitflowKind(path: string, branch: string): { type: 'feature' | 'release' | 'hotfix'; name: string } | null {
  const cfg = snap(path).gitflow
  if (!cfg.initialized) return null
  for (const type of ['feature', 'release', 'hotfix'] as const) {
    if (cfg[type] && branch.startsWith(cfg[type])) return { type, name: branch.slice(cfg[type].length) }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// submodules

export const submoduleUpdate = (path: string, sub?: string) => run(path, () => api.submoduleUpdate(path, sub), { busy: 'Updating submodules', success: 'Submodules updated' })
export function submoduleAddDialog(path: string): void {
  openModal('prompt', {
    title: 'Add submodule', okLabel: 'Add Submodule',
    fields: [{ name: 'url', label: 'Repository URL' }, { name: 'path', label: 'Path inside this repository', placeholder: 'libs/my-lib' }],
    onOk: (v: Record<string, string>) => {
      const url = v.url.trim()
      const sub = v.path.trim() || url.replace(/\.git$/, '').split(/[/:]/).pop()!
      return run(path, () => api.submoduleAdd(path, url, sub), { busy: 'Adding submodule' })
    }
  })
}
export async function openSubmodule(path: string, sub: string): Promise<void> {
  const full = `${path}\\${sub.replace(/\//g, '\\')}`
  await openRepo(full)
}

// ---------------------------------------------------------------------------------------------
// tabs, terminal, tools

export function renameTab(id: string): void {
  const tab = getState().tabs.find((t) => t.id === id)
  if (!tab) return
  const setName = (name: string) => {
    setState((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name: name.trim() || basename(t.path) } : t)) }))
    persistTabs()
  }
  showPrompt({
    kind: 'input', message: 'Repository alias', value: tab.name, placeholder: basename(tab.path), submitLabel: 'Save alias',
    extraButtons: [{ label: 'Clear alias', run: () => setName('') }],
    onSubmit: (v) => setName(v)
  })
}

export function toggleTerminal(path: string, open?: boolean): void {
  updateRepo(path, (r) => ({ terminal: open ?? !r.terminal }))
}

export async function loadStats(path: string): Promise<void> {
  const v = repoView(path)
  if (!v) return
  try { updateRepo(path, { stats: await api.commitStats(path, v.limit) }) } catch { /* optional data */ }
}

export const openInEditor = (path: string, file: string | null) => run(path, () => api.openInEditor(path, file), { refresh: false, errorTitle: 'Could not open the external editor' })

export async function externalMergeTool(path: string, file: string): Promise<void> {
  const r = await run(path, () => api.externalMergeTool(path, file), { busy: 'Waiting for merge tool' })
  if (r && !r.ok) toast({ kind: 'error', title: 'External merge tool failed', message: `${r.error}\n\nConfigure one with: git config --global merge.tool <tool>` })
}

export async function switchProfile(id: string): Promise<void> {
  saveSettings({ activeProfile: id })
  const p = getState().settings!.profiles.find((x) => x.id === id)
  // "Keep my .gitconfig updated with my profile"
  if (p && getState().settings!.syncGitConfigWithProfile && p.gitName && p.gitEmail) {
    try { await api.gitConfigSet('user.name', p.gitName); await api.gitConfigSet('user.email', p.gitEmail) } catch { /* the toast below still reports the switch */ }
  }
  toast({ kind: 'info', title: `Switched to ${p?.name ?? 'profile'}`, message: p?.gitEmail ? `Commits will be authored as ${p.gitName} <${p.gitEmail}>` : 'Using your git config identity' }, 2500)
}

/**
 * Opens every repository GitKraken has open and copies what is hidden there (branches, remotes, stashes).
 * Only reads GitKraken's own files; nothing in the repositories changes.
 */
export async function importFromGitKraken(): Promise<void> {
  const found = await api.gitkrakenScan()
  if (!found) { toast({ kind: 'info', title: 'GitKraken was not found', message: 'There is no GitKraken profile on this computer to import from.' }); return }
  const repos = found.filter((r) => r.exists)
  if (!repos.length) { toast({ kind: 'info', title: 'Nothing to import', message: 'GitKraken has no repositories open.' }); return }
  const before = getState().tabs.length
  const hiddenRefs = { ...getState().settings!.hiddenRefs }
  let branches = 0, stashes = 0
  for (const r of repos) {
    const info = await api.resolveRepo(r.path)
    if (!info) continue
    const names = [...r.hiddenRefs, ...r.hiddenStashes.map((sha) => `stash:${sha}`)]
    if (names.length) {
      hiddenRefs[info.root] = [...new Set([...(hiddenRefs[info.root] ?? []), ...names])]
      branches += r.hiddenRefs.length
      stashes += r.hiddenStashes.length
    }
  }
  saveSettings({ hiddenRefs })
  for (const r of repos) await openRepo(r.path)
  const added = getState().tabs.length - before
  const missing = found.length - repos.length
  toast({
    kind: 'success',
    title: `Imported ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'} from GitKraken`,
    message: [`${added} new ${added === 1 ? 'tab' : 'tabs'}`, branches ? `${branches} hidden branches` : '', stashes ? `${stashes} hidden stashes` : '', missing ? `${missing} skipped (folder not found)` : ''].filter(Boolean).join(' · ')
  })
}

/** Repository management: fetch / pull every open repository, one after the other, with one summary at the end. */
export async function fetchAllRepos(paths: string[]): Promise<void> {
  const failed: string[] = []
  const id = toast({ kind: 'progress', title: `Fetching ${paths.length} repositories…` }, 0)
  for (const p of paths) { try { await api.fetchAll(p, true) } catch { failed.push(basename(p)) } }
  dismissToast(id)
  toast(failed.length ? { kind: 'error', title: `Fetched ${paths.length - failed.length} of ${paths.length} repositories`, message: `Failed: ${failed.join(', ')}` } : { kind: 'success', title: `Fetched ${paths.length} repositories` })
}

export async function pullAllRepos(paths: string[]): Promise<void> {
  const failed: string[] = []
  const id = toast({ kind: 'progress', title: `Pulling ${paths.length} repositories…` }, 0)
  const mode = getState().settings?.defaultPullMode
  for (const p of paths) {
    try { const r = await api.pull(p, !mode || mode === 'fetch' ? 'ff' : mode); if (!r.ok) failed.push(basename(p)) } catch { failed.push(basename(p)) }
  }
  dismissToast(id)
  toast(failed.length ? { kind: 'error', title: `Pulled ${paths.length - failed.length} of ${paths.length} repositories`, message: `Failed: ${failed.join(', ')}` } : { kind: 'success', title: `Pulled ${paths.length} repositories` })
}

/** "Open this worktree": the worktree takes the place of the current tab */
export async function openInThisTab(current: string, target: string): Promise<void> {
  const tab = getState().tabs.find((t) => t.path === current)
  await openRepo(target)
  if (tab && getState().tabs.some((t) => t.path === target)) await closeTab(tab.id)
}
