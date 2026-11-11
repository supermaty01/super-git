// Native context menus. Structure, ordering and wording follow the original application
// (AI / cloud / pull-request entries are intentionally left out).
import * as A from './actions'
import * as A2 from './actions2'
import { stashKey } from './lib/format'
import { api } from './lib/api'
import { openModal, getState, updateRepo, showPrompt } from './store'
import type { Commit, Ref, Stash, Worktree, FileChange, FileContext, Remote, Submodule, RepoSnapshot } from '@shared/types'
import type { MI } from './actions'

const remotesOf = (path: string): Remote[] => A.snap(path).remotes
const editorName = () => { const e = (getState().settings?.externalEditor || 'code').toLowerCase(); return e === 'code' || e.includes('code') ? 'VS Code' : 'external editor' }

// ---------------------------------------------------------------------------------------------
// shared building blocks

function resetSub(path: string, sha: string): MI {
  const s = A.snap(path)
  return {
    label: `Reset ${s.head.branch ?? 'HEAD'} to this commit`, enabled: !s.head.unborn,
    sub: [
      { label: 'Soft - keep all changes', act: () => A.resetTo(path, sha, 'soft') },
      { label: 'Mixed - keep working copy but reset index', act: () => A.resetTo(path, sha, 'mixed') },
      { label: 'Hard - discard all changes', act: () => A.resetTo(path, sha, 'hard') }
    ]
  }
}

/** Fast-forward / merge items between the checked-out branch and `their` ref, worded by ancestry like the original. */
async function mergeItems(path: string, their: Ref): Promise<MI[]> {
  const s = A.snap(path)
  const ours = s.refs.find((r) => r.type === 'head' && r.isCurrent)
  if (!ours || their.sha === ours.sha) return []
  const [theirBehind, oursBehind] = await Promise.all([api.isAncestor(path, their.sha, ours.sha), api.isAncestor(path, ours.sha, their.sha)])
  if (theirBehind) {
    // their branch can be fast-forwarded to ours; on a tag the original moves the tag
    if (their.type === 'tag') return [
      { label: `Fast-forward ${their.short} to ${ours.short}`, act: () => A.moveTag(path, their, ours.short) },
      { label: `Merge ${ours.short} into ${their.short}`, act: () => A.moveTag(path, their, ours.short) }
    ]
    if (their.type !== 'head') return []
    return [
      { label: `Fast-forward ${their.short} to ${ours.short}`, act: () => A.fastForward(path, their, ours.short) },
      { label: `Merge ${ours.short} into ${their.short}`, act: () => mergeIntoOther(path, their, ours) }
    ]
  }
  if (oursBehind) {
    return [
      { label: `Fast-forward ${ours.short} to ${their.short}`, act: () => A.fastForward(path, ours, their.short) },
      { label: `Merge ${their.short} into ${ours.short}`, act: () => A2.mergeNoFF(path, their.short) }
    ]
  }
  return [{ label: `Merge ${their.short} into ${ours.short}`, act: () => A.mergeInto(path, their.short) }]
}

async function mergeIntoOther(path: string, target: Ref, src: Ref) {
  await A.checkoutRef(path, target)
  await A2.mergeNoFF(path, src.short)
}

function rebaseItems(path: string, onto: Ref, _sha: string): MI[] {
  const s = A.snap(path)
  const cur = s.head.branch
  if (!cur || onto.isCurrent) return []
  return [
    { label: `Rebase ${cur} onto ${onto.short}`, act: () => A.rebaseOnto(path, onto.short) },
    { label: `Interactive Rebase ${cur} onto ${onto.short}`, act: () => A.startInteractiveRebase(path, onto.sha, undefined, onto.short) }
  ]
}

function commitTail(path: string, c: { sha: string }, isHead: boolean): MI[] {
  return [
    { label: 'Compare commit against working directory', act: () => A2.compareWithWorkdir(path, c.sha) },
    '-',
    { label: 'Create tag here', act: () => A.startCreateRef(path, 'tag', c.sha) },
    { label: 'Create annotated tag here', act: () => A.startCreateRef(path, 'annotated-tag', c.sha) },
    ...(isHead ? [] : [])
  ]
}

function pinItem(path: string, refs: Ref[]): MI {
  const pinned = getState().settings?.pinnedRefs[path]
  if (refs.length === 1) {
    const r = refs[0]
    return { label: pinned === r.name ? 'Unpin from Left' : 'Pin to Left', act: () => A2.setPinned(path, pinned === r.name ? null : r.name) }
  }
  return { label: 'Pin to Left', sub: refs.map((r) => ({ label: r.short, checked: pinned === r.name, act: () => A2.setPinned(path, pinned === r.name ? null : r.name) })) }
}

function soloItem(path: string, refs: Ref[]): MI {
  const solo = A2.soloFor(path)
  if (refs.length === 1) return { label: 'Solo', checked: solo.includes(refs[0].name), act: () => A2.setSolo(path, [refs[0].name], !solo.includes(refs[0].name)) }
  return { label: 'Solo', sub: refs.map((r) => ({ label: r.short, checked: solo.includes(r.name), act: () => A2.setSolo(path, [r.name], !solo.includes(r.name)) })) }
}

function soloAll(path: string, refs: Ref[]): MI {
  const solo = A2.soloFor(path)
  const all = refs.length > 0 && refs.every((r) => solo.includes(r.name))
  return { label: 'Solo', checked: all, enabled: refs.length > 0, act: () => A2.setSolo(path, refs.map((r) => r.name), !all) }
}

function hideItem(path: string, refs: Ref[]): MI {
  const hidden = A2.hiddenFor(path)
  const all = refs.every((r) => hidden.includes(r.name))
  return { label: 'Hide', checked: all, act: () => A2.setHidden(path, refs.map((r) => r.name), !all) }
}

// ---------------------------------------------------------------------------------------------
// commits (graph rows)

/** HEAD and its first parents down to (not including) the first merge commit: the commits the original lets you edit, drop and move */
function linearChain(s: RepoSnapshot): Commit[] {
  const byId = new Map(s.commits.map((c) => [c.sha, c]))
  const out: Commit[] = []
  let cur = s.head.detached ? undefined : byId.get(s.head.sha)
  while (cur && cur.parents.length < 2) {
    out.push(cur)
    cur = cur.parents[0] ? byId.get(cur.parents[0]) : undefined
  }
  return out
}

/** "Interactive Rebase N children of …", "Edit commit message", "Drop commit", "Move commit up/down" */
function historyItems(path: string, c: Commit): MI[] {
  const s = A.snap(path)
  const chain = linearChain(s)
  const i = chain.findIndex((x) => x.sha === c.sha)
  if (i < 0) return []
  const unpushed = !!s.refs.find((r) => r.type === 'head' && r.isCurrent && (r.ahead ?? 0) > 0) || !s.refs.some((r) => r.type === 'head' && r.isCurrent && r.upstream)
  const items: MI[] = []
  if (i > 0) items.push({ label: `Interactive Rebase ${i} children of ${c.sha.slice(0, 6)}`, act: () => A.startInteractiveRebase(path, c.sha) })
  items.push({ label: 'Edit commit message', act: () => A.rewordCommit(path, c) })
  if (i > 0 || unpushed) items.push({ label: 'Drop commit', act: () => A.dropCommits(path, [c.sha]) })
  if (i > 0) items.push({ label: 'Move commit up', act: () => A.moveCommit(path, c.sha, 'up') })
  if (chain[i + 1] && (i > 0 || unpushed)) items.push({ label: 'Move commit down', act: () => A.moveCommit(path, c.sha, 'down') })
  return items
}

export function commitMenu(path: string, c: Commit): Promise<void> {
  const s = A.snap(path)
  const sel = A.repoView(path).selection
  const multi = sel?.kind === 'commits' && sel.shas.length > 1 && sel.shas.includes(c.sha) ? sel.shas : null
  const isHead = c.sha === s.head.sha
  const branch = s.head.branch ?? 'HEAD'
  const items: MI[] = [
    { label: 'Checkout this commit', act: () => A.checkoutCommit(path, c.sha), enabled: !isHead || !s.head.detached },
    '-',
    { label: 'Create worktree from this commit', act: () => A.addWorktreeDialog(path, { ref: c.sha }) },
    '-',
    { label: 'Create branch here', act: () => A.startCreateRef(path, 'branch', c.sha) },
    multi
      ? { label: `Cherry pick ${multi.length} commits`, act: () => A.cherryPick(path, multi) }
      : { label: 'Cherry pick commit', act: () => A.cherryPick(path, [c.sha]), enabled: !isHead },
    ...(isHead ? [] : [{ label: `Rebase ${branch} onto this commit`, act: () => A.rebaseOnto(path, c.sha) } as MI]),
    resetSub(path, c.sha),
    { label: 'Revert commit', act: () => A.revertCommit(path, c) },
    '-',
    ...(multi ? [
      { label: `Squash ${multi.length} commits`, act: () => A.squashCommits(path, multi) } as MI,
      { label: `Drop ${multi.length} commits`, act: () => A.dropCommits(path, multi) } as MI
    ] : historyItems(path, c)),
    '-',
    { label: 'Copy commit sha', act: () => api.copy(multi ? multi.join('\n') : c.sha) },
    multi
      ? { label: 'Create patch from commits', act: () => A2.createPatch(path, multi) }
      : { label: 'Create patch from commit', act: () => A2.createPatch(path, [c.sha]) },
    ...(isHead ? [{ label: 'Apply patch', act: () => A2.applyPatch(path) } as MI] : []),
    '-',
    ...commitTail(path, c, isHead)
  ]
  return A.popup(items)
}

export function wipMenu(path: string): Promise<void> {
  const s = A.snap(path)
  const dirty = s.status.staged.length + s.status.unstaged.length > 0
  return A.popup([
    { label: 'Stash all changes', act: () => A.stashSave(path), enabled: dirty },
    { label: 'Stash staged changes only', act: () => A.stashSave(path, undefined, 'staged'), enabled: s.status.staged.length > 0 },
    '-',
    { label: 'Apply patch', act: () => A2.applyPatch(path) },
    '-',
    { label: 'Discard all changes', act: () => A.discardAll(path), enabled: dirty }
  ])
}

// ---------------------------------------------------------------------------------------------
// branch / tag labels in the graph (one label can stand for a local branch and its remote)

export async function refGroupMenu(path: string, refs: Ref[], opts: { inLeftPanel?: boolean } = {}): Promise<void> {
  const s = A.snap(path)
  const local = refs.find((r) => r.type === 'head')
  const remotesInGroup = refs.filter((r) => r.type === 'remote')
  const tag = refs.find((r) => r.type === 'tag')
  const primary = local ?? remotesInGroup[0] ?? tag!
  const sha = primary.sha
  const isHead = sha === s.head.sha
  const commit = s.commits.find((c) => c.sha === sha)
  const branchRefs = refs.filter((r) => r.type !== 'tag')

  if (tag && !local && !remotesInGroup.length) return tagMenu(path, tag, opts)

  const items: MI[] = []
  if (local) {
    items.push(
      // without an upstream the original first asks where the branch should push to and pull from
      { label: 'Pull (fast-forward if possible)', act: () => (!local.upstream ? A.setUpstreamDialog(path, local) : local.isCurrent ? A.pull(path, 'ff') : pullOther(path, local)) },
      { label: 'Push', act: () => A.push(path, local.short) },
      { label: 'Set Upstream', act: () => A.setUpstreamDialog(path, local) },
      '-'
    )
    const gf = A2.gitflowKind(path, local.short)
    if (gf) items.push({ label: `Finish ${local.short}`, act: () => A2.gitflowFinish(path, gf.type, gf.name) }, '-')
  }
  if (!local?.isCurrent) {
    items.push(...(await mergeItems(path, primary)), ...rebaseItems(path, primary, sha), '-')
  }
  // checkout / worktree submenus list each ref of the label plus "this commit"
  const checkoutTargets = branchRefs.filter((r) => !r.isCurrent)
  if (opts.inLeftPanel) {
    if (!primary.isCurrent) items.push({ label: `Checkout ${primary.short}`, act: () => A.checkoutRef(path, primary) }, '-')
    items.push({ label: `Create worktree from ${primary.short}`, act: () => A.addWorktreeDialog(path, { ref: primary.name }), enabled: !primary.isCurrent }, '-')
  } else {
    items.push({
      label: 'Checkout', sub: [
        ...checkoutTargets.map((r) => ({ label: r.short, act: () => A.checkoutRef(path, r) })),
        { label: 'this commit', act: () => A.checkoutCommit(path, sha) }
      ]
    }, '-', {
      label: 'Create worktree from', sub: [
        ...branchRefs.filter((r) => !r.isCurrent).map((r) => ({ label: r.short, act: () => A.addWorktreeDialog(path, { ref: r.name }) })),
        { label: 'this commit', act: () => A.addWorktreeDialog(path, { ref: sha }) }
      ]
    }, '-')
  }
  items.push(
    { label: 'Create branch here', act: () => A.startCreateRef(path, 'branch', sha) },
    ...(isHead ? [] : [{ label: 'Cherry pick commit', act: () => A.cherryPick(path, [sha]) } as MI]),
    resetSub(path, sha),
    ...(commit ? [{ label: 'Revert commit', act: () => A.revertCommit(path, commit) } as MI] : []),
    '-',
    ...(isHead && commit ? historyItems(path, commit) : []),
    '-'
  )
  if (isHead) items.push({ label: 'Apply patch', act: () => A2.applyPatch(path) })
  if (local) items.push({ label: `Rename ${local.short}`, act: () => A.renameBranch(path, local) }, { label: `Delete ${local.short}`, act: () => A.deleteLocalBranch(path, local), enabled: !local.isCurrent })
  for (const r of remotesInGroup) items.push({ label: `Delete ${r.short}`, act: () => A.deleteRemoteBranch(path, r) })
  if (local && remotesInGroup.length) items.push({ label: remotesInGroup.length === 1 ? `Delete ${local.short} and ${remotesInGroup[0].short}` : `Delete all "${local.short}" branches (local && remote)`, enabled: !local.isCurrent, act: () => A.deleteBranchEverywhere(path, local, remotesInGroup) })
  items.push('-',
    { label: 'Copy branch name', act: () => api.copy(primary.short) },
    { label: 'Copy commit sha', act: () => api.copy(sha) },
    ...(opts.inLeftPanel ? [] : [{ label: 'Create patch from commit', act: () => A2.createPatch(path, [sha]) } as MI]),
    '-',
    ...(opts.inLeftPanel ? [hideItem(path, branchRefs)] : []),
    pinItem(path, branchRefs),
    soloItem(path, branchRefs),
    '-',
    ...commitTail(path, { sha }, isHead)
  )
  return A.popup(items)
}

/** single ref entry point (left panel rows, drag&drop, palette) */
export function refMenu(path: string, ref: Ref, opts: { inLeftPanel?: boolean } = {}): Promise<void> {
  if (ref.type === 'tag') return tagMenu(path, ref, opts)
  return refGroupMenu(path, [ref], opts)
}

async function pullOther(path: string, local: Ref) {
  await A.fetchAll(path)
  const up = local.upstream?.replace(/^refs\/remotes\//, '')
  if (up) await A.fastForward(path, local, up)
}

async function ffIfPossible(path: string, branch: Ref, to: Ref) {
  const ok = await api.isAncestor(path, branch.sha, to.sha)
  if (!ok) {
    showPrompt({ kind: 'confirm', message: `${branch.short} has commits that are not in ${to.short}; it cannot be fast-forwarded.`, buttons: [] })
    return
  }
  await A.fastForward(path, branch, to.short)
}

export async function tagMenu(path: string, ref: Ref, opts: { inLeftPanel?: boolean } = {}): Promise<void> {
  const s = A.snap(path)
  const remotes = remotesOf(path)
  const isHead = ref.sha === s.head.sha
  const commit = s.commits.find((c) => c.sha === ref.sha)
  // like the original: push to the remotes that lack the tag, delete from the ones that have it
  const known = await Promise.race([A.remoteTagsOf(path), new Promise<Record<string, string[] | null>>((ok) => setTimeout(() => ok({}), 4000))])
  const has = (r: string) => known[r]?.includes(ref.short)
  const pushTo = remotes.map((r) => r.name).filter((r) => !known[r] || !has(r))
  const delFrom = remotes.map((r) => r.name).filter((r) => !known[r] || has(r))
  const pushItems = pushTo.map((r) => ({ label: `Push ${ref.short} to ${r}`, act: () => A.pushTag(path, r, ref) }) as MI)
  const delItems = delFrom.map((r) => ({ label: `Delete ${ref.short} from ${r}`, act: () => A.deleteRemoteTag(path, r, ref) }) as MI)
  const cur = s.head.branch
  const items: MI[] = [
    ...(pushItems.length > 1 ? [{ label: 'Push tag to remote', sub: [...pushItems, '-', { label: `Push ${ref.short} to all remotes`, act: () => A.pushTagToAll(path, ref, pushTo) }] } as MI] : pushItems),
    '-',
    ...(await mergeItems(path, ref)),
    ...(cur && !ref.isCurrent ? [{ label: `Rebase ${cur} onto ${ref.short}`, act: () => A.rebaseOnto(path, ref.short) } as MI] : []),
    '-',
    { label: opts.inLeftPanel ? `Checkout the commit at ${ref.short}` : 'Checkout this commit', act: () => A.checkoutCommit(path, ref.sha) },
    '-',
    { label: 'Create worktree from this commit', act: () => A.addWorktreeDialog(path, { ref: ref.sha }) },
    '-',
    { label: 'Create branch here', act: () => A.startCreateRef(path, 'branch', ref.sha) },
    ...(isHead ? [] : [{ label: 'Cherry pick commit', act: () => A.cherryPick(path, [ref.sha]) } as MI]),
    resetSub(path, ref.sha),
    ...(commit ? [{ label: 'Revert commit', act: () => A.revertCommit(path, commit) } as MI] : []),
    '-',
    { label: `Delete ${ref.short} locally`, act: () => A.deleteTag(path, ref) },
    ...(delItems.length > 1 ? [{ label: 'Delete tag from remote', sub: [...delItems, '-', { label: `Delete ${ref.short} from all remotes`, act: () => A.deleteTagFromAllRemotes(path, ref, delFrom) }] } as MI] : delItems),
    '-',
    { label: 'Copy tag name', act: () => api.copy(ref.short) },
    '-',
    ...(opts.inLeftPanel ? [hideItem(path, [ref])] : []),
    soloItem(path, [ref]),
    '-',
    { label: `Annotate ${ref.short}`, act: () => showPrompt({ kind: 'input', message: 'Message:', placeholder: 'Annotation message', value: ref.subject && ref.subject !== commit?.summary ? ref.subject : '', onSubmit: (m) => A.run(path, () => api.annotateTag(path, ref.short, m.trim() || ref.short)) }) }
  ]
  return A.popup(items)
}

// ---------------------------------------------------------------------------------------------
// left panel

export function stashMenu(path: string, st: Stash): Promise<void> {
  const hidden = (getState().settings!.hiddenRefs[path] ?? []).includes(stashKey(st.sha))
  return A.popup([
    { label: 'Apply Stash', act: () => A.stashApply(path, st.index) },
    { label: 'Pop Stash', act: () => A.stashPop(path, st.index) },
    { label: 'Delete Stash', act: () => A.stashDrop(path, st) },
    '-',
    { label: 'Edit stash message', act: () => A2.renameStash(path, st) },
    '-',
    { label: 'Hide', checked: hidden, act: () => A2.setHidden(path, [stashKey(st.sha)], !hidden) }
  ])
}

export function remoteMenu(path: string, remote: Remote): Promise<void> {
  const names = A.snap(path).refs.filter((r) => r.type === 'remote' && r.remote === remote.name)
  return A.popup([
    { label: `Fetch ${remote.name}`, act: () => A.run(path, () => api.fetchRemote(path, remote.name), { busy: 'Fetching' }) },
    '-',
    { label: `Edit ${remote.name}`, act: () => openModal('remote', { path, remote }) },
    { label: `Remove ${remote.name}`, act: () => showPrompt({ kind: 'confirm', message: `Are you sure you want to remove the remote '${remote.name}'?`, buttons: [{ label: 'Remove', style: 'danger', run: () => A.run(path, () => api.removeRemote(path, remote.name)) }] }) },
    '-',
    hideItem(path, names),
    soloAll(path, names)
  ])
}

export async function folderMenu(path: string, folder: string, refs: Ref[]): Promise<void> {
  // like the original: local folders only offer deleting their branches, remote folders have no menu
  const locals = refs.filter((r) => r.type === 'head' && !r.isCurrent)
  if (!refs.some((r) => r.type === 'head')) return
  return A.popup([
    { label: locals.length === 1 ? `Delete 1 branch in folder "${folder}"` : `Delete ${locals.length} branches in folder "${folder}"`, enabled: locals.length > 0, act: () => showPrompt({
      kind: 'confirm', message: locals.length === 1 ? `This is a destructive operation, are you sure you want to delete 1 local branch in "${folder}"?` : `This is a destructive operation, are you sure you want to delete ${locals.length} local branches in "${folder}"?`,
      buttons: [{ label: 'Delete', style: 'danger', run: async () => { for (const r of locals) await A.run(path, () => api.deleteBranch(path, r.short, true), { errorTitle: `Could not delete ${r.short}`, refresh: false }); await A.refresh(path) } }]
    }) }
  ])
}

export function worktreeMenu(path: string, wt: Worktree): Promise<void> {
  // the worktree that is open has nothing to offer in the original
  if (wt.isCurrent) return A.popup([{ label: '(no actions)', enabled: false }])
  const branch = wt.branch?.replace(/^refs\/heads\//, '')
  return A.popup([
    { label: 'Open this worktree', act: () => A2.openInThisTab(path, wt.path) },
    { label: 'Open worktree in new tab', act: () => A.openRepo(wt.path) },
    ...(wt.isMain ? [] : [
      { label: 'Remove this worktree', act: () => A.removeWorktree(path, wt) } as MI,
      ...(branch ? [{ label: 'Remove worktree and delete branch', act: () => A.removeWorktree(path, wt, true) } as MI] : []),
      '-' as MI,
      wt.locked
        ? { label: 'Unlock this worktree', act: () => A.run(path, () => api.lockWorktree(path, wt.path, null), { errorTitle: 'Could not unlock worktree' }) } as MI
        : { label: 'Lock this worktree', act: () => showPrompt({ kind: 'input', message: 'Message (optional):', placeholder: 'Lock message', extraButtons: [], onSubmit: (m) => A.run(path, () => api.lockWorktree(path, wt.path, m), { errorTitle: 'Could not lock worktree' }) }) } as MI
    ])
  ])
}

export function submoduleMenu(path: string, sm: Submodule): Promise<void> {
  return A.popup([
    { label: `Update ${sm.path}`, act: () => A2.submoduleUpdate(path, sm.path) },
    '-',
    { label: `Edit ${sm.path}`, act: () => openModal('repoPrefs', { path: `${path}\\${sm.path.replace(/\//g, '\\')}` }), enabled: sm.state !== '-' },
    { label: 'Open this submodule', act: () => A2.openSubmodule(path, sm.path), enabled: sm.state !== '-' },
    '-',
    '-',
    { label: 'Delete this submodule', act: () => showPrompt({ kind: 'confirm', message: `This is a destructive operation, are you sure you want to delete "${sm.path}"?`, buttons: [
      { label: 'Delete & Commit', style: 'danger', run: () => A.run(path, () => api.deleteSubmodule(path, sm.path, true), { busy: 'Deleting', errorTitle: 'Could not delete submodule' }) },
      { label: 'Delete', style: 'danger', run: () => A.run(path, () => api.deleteSubmodule(path, sm.path), { busy: 'Deleting', errorTitle: 'Could not delete submodule' }) }
    ] }) }
  ])
}

export const LEFT_SECTIONS: Array<{ id: string; label: string; locked?: boolean }> = [
  { id: 'gitflow', label: 'Gitflow' }, { id: 'local', label: 'Local', locked: true }, { id: 'remote', label: 'Remote' },
  { id: 'worktrees', label: 'Worktrees' }, { id: 'stashes', label: 'Stashes' }, { id: 'tags', label: 'Tags' }, { id: 'submodules', label: 'Submodules' }
]

export function sectionMenu(path: string, id: string, onMaximize: () => void): Promise<void> {
  const s = A.snap(path)
  const set = getState().settings!
  const hiddenSecs = set.hiddenSections
  const top: MI[] = []
  if (id === 'local' || id === 'remote' || id === 'gitflow') {
    const names = s.refs.filter((r) => r.type === (id === 'remote' ? 'remote' : 'head')).map((r) => r.name)
    const hidden = A2.hiddenFor(path)
    const label = id === 'remote' ? 'remotes' : 'local branches'
    top.push(
      { label: `Hide all ${label}`, act: () => A2.setHidden(path, names, true), enabled: names.some((n) => !hidden.includes(n)) },
      { label: `Show all ${label}`, act: () => A2.setHidden(path, names, false), enabled: names.some((n) => hidden.includes(n)) },
      '-'
    )
  } else if (id === 'stashes' || id === 'tags') {
    const key = id === 'stashes' ? 'stashes' : 'tags'
    const shown = set.graphShow[key]
    top.push(
      { label: `Hide all ${id}`, act: () => A2.saveSettings({ graphShow: { ...set.graphShow, [key]: false } }), enabled: shown },
      { label: `Show all ${id}`, act: () => A2.saveSettings({ graphShow: { ...set.graphShow, [key]: true } }), enabled: !shown },
      '-'
    )
  }
  return A.popup([
    ...top,
    { label: 'Maximize this section', act: onMaximize },
    '-',
    ...LEFT_SECTIONS.filter((sec) => sec.id !== 'gitflow' || s.gitflow.initialized).map((sec) => ({
      label: sec.label, checked: !hiddenSecs.includes(sec.id), enabled: !sec.locked,
      act: () => A2.saveSettings({ hiddenSections: hiddenSecs.includes(sec.id) ? hiddenSecs.filter((x) => x !== sec.id) : [...hiddenSecs, sec.id] })
    }))
  ])
}

// ---------------------------------------------------------------------------------------------
// graph header

export function graphHeaderMenu(path: string, autoReset: () => void): Promise<void> {
  const set = getState().settings!
  const c = set.graphColumns
  const toggle = (k: keyof typeof c) => A2.saveSettings({ graphColumns: { ...c, [k]: !c[k] } })
  const smart = !!set.smartVisibility[path]
  return A.popup([
    { label: 'Branch / Tag', checked: c.ref, act: () => toggle('ref') },
    { label: 'Graph', checked: c.graph, act: () => toggle('graph') },
    { label: 'Commit message', checked: c.message, act: () => toggle('message') },
    { label: 'Author', checked: c.author, act: () => toggle('author') },
    { label: 'Date / Time', checked: c.date, act: () => toggle('date') },
    { label: 'Sha', checked: c.sha, act: () => toggle('sha') },
    { label: 'Changes', checked: c.changes, act: () => toggle('changes') },
    '-',
    { label: 'Compact Graph Column', checked: set.compactGraph, act: () => A2.saveSettings({ compactGraph: !set.compactGraph }) },
    { label: 'Smart Branch Visibility', checked: smart, act: () => A2.saveSettings({ smartVisibility: { ...set.smartVisibility, [path]: !smart } }) },
    '-',
    { label: 'Reset columns to default layout', act: () => { A2.saveSettings({ graphColumns: { ref: true, graph: true, message: true, author: false, date: false, sha: false, changes: false }, compactGraph: false }); autoReset() } },
    { label: 'Reset columns to compact layout', act: () => { A2.saveSettings({ graphColumns: { ref: true, graph: true, message: true, author: false, date: false, sha: false, changes: false }, compactGraph: true }); autoReset() } }
  ])
}

// ---------------------------------------------------------------------------------------------
// files

/** Right-click on a file row in the staging / commit panel. */
export async function fileMenu(path: string, f: FileChange, where: 'unstaged' | 'staged' | 'conflicted' | 'commit', ctx?: FileContext): Promise<void> {
  const abs = `${path}\\${f.path.replace(/\//g, '\\')}`
  const sel = A.repoView(path).fileSel
  const s = A.snap(path)
  const list = where === 'unstaged' ? s.status.unstaged : where === 'staged' ? s.status.staged : []
  const multi = sel.length > 1 && sel.includes(f.path) ? list.filter((x) => sel.includes(x.path)) : [f]
  const name = f.path.split('/').pop()!
  const ext = name.includes('.') ? '.' + name.split('.').pop() : ''
  const isNew = f.status === '?' || f.status === 'A'
  const open: MI[] = [
    { label: 'Open in external diff tool', act: () => api.externalDiffTool(path, f.path, where === 'staged', ctx?.kind === 'commit' ? ctx.parent : undefined, ctx?.kind === 'commit' ? ctx.sha : undefined) },
    { label: `Open in ${editorName()}`, act: () => A2.openInEditor(path, f.path), enabled: f.status !== 'D' },
    { label: 'Open file in default program', act: () => api.openFile(abs), enabled: f.status !== 'D' },
    { label: 'Show in folder', act: () => api.showInFolder(abs) }
  ]
  const editDelete: MI[] = [
    { label: 'Edit file', act: () => updateRepo(path, { center: { kind: 'file', ctx: { kind: 'unstaged', path: f.path, status: 'N' } } }), enabled: f.status !== 'D' },
    { label: 'Delete file', act: () => confirmDeleteFile(path, f.path), enabled: f.status !== 'D' }
  ]
  // like the original: Ignore for every working file, LFS only in a repository that uses LFS
  const lfs = where === 'unstaged' || where === 'staged' ? await api.lfsInfo(path).then((i) => i.enabled).catch(() => false) : false
  const ignoreLfs: MI[] = where === 'unstaged' || where === 'staged' ? [
    { label: 'Ignore', sub: [
      { label: `Ignore '${name}'`, act: () => ignorePath(path, f.path) },
      ...(ext ? [{ label: `All files with the extension '${ext}'`, act: () => ignorePath(path, `*${ext}`) }] : [])
    ] },
    ...(lfs && isNew ? [{ label: 'LFS', sub: [
      { label: `Track '${name}'`, act: () => A.run(path, () => api.lfsTrack(path, f.path)) },
      ...(ext ? [{ label: `Track all files with the extension '${ext}'`, act: () => A.run(path, () => api.lfsTrack(path, `*${ext}`)) }] : [])
    ] } as MI] : [])
  ] : []
  // tracked files also offer their history and blame
  const fctx: FileContext | undefined = ctx ?? (where === 'unstaged' ? { kind: 'unstaged', path: f.path, status: f.status } : where === 'staged' ? { kind: 'staged', path: f.path, oldPath: f.oldPath, status: f.status } : undefined)
  const historyBlame: MI[] = isNew || !fctx ? [] : [
    '-',
    { label: 'File History', act: () => updateRepo(path, { center: { kind: 'history', file: f.path } }) },
    { label: 'File Blame', act: () => updateRepo(path, { center: { kind: 'history', file: f.path, blame: true } }), enabled: f.status !== 'D' }
  ]
  const filePatch = { label: 'Create patch from file changes', act: () => createFilePatch(path, f.path, where === 'staged') }
  if (where === 'unstaged') return A.popup([
    { label: multi.length > 1 ? `Stage ${multi.length} files` : 'Stage', act: () => A.stageFiles(path, multi) },
    ...(f.status === '?' && multi.length === 1 ? [] : [{ label: multi.length > 1 ? `Discard changes to ${multi.length} files` : 'Discard changes', act: () => A.discardFiles(path, multi) } as MI]),
    ...ignoreLfs,
    { label: 'Stash file', act: () => A.run(path, () => api.stashPaths(path, multi.map((x) => x.path))) },
    ...historyBlame,
    '-', ...open, '-',
    { label: 'Copy file path', act: () => api.copy(f.path) },
    filePatch,
    '-', ...editDelete
  ])
  if (where === 'staged') return A.popup([
    { label: multi.length > 1 ? `Unstage ${multi.length} files` : 'Unstage', act: () => A.unstageFiles(path, multi) },
    ...(isNew ? [{ label: 'Unstage and delete file', act: async () => { await A.unstageFiles(path, [f]); await confirmDeleteFile(path, f.path) } } as MI] : []),
    ...ignoreLfs,
    { label: 'Stash file', act: () => A.run(path, () => api.stashPaths(path, multi.map((x) => x.path))) },
    ...historyBlame,
    '-', ...open, '-',
    { label: 'Copy file path', act: () => api.copy(f.path) },
    filePatch,
    '-', ...editDelete
  ])
  if (where === 'conflicted') {
    const st = s.status.state
    const a = st.kind === 'rebase' ? st.theirs : st.ours
    const b = st.kind === 'rebase' ? st.ours : st.theirs
    return A.popup([
      { label: 'Open merge tool', act: () => A.openMerge(path, f.path) },
      { label: 'Open in external merge tool', act: () => A2.externalMergeTool(path, f.path) },
      '-',
      { label: `Take all of A (${a ?? 'ours'})`, act: () => A.takeSide(path, f.path, 'ours') },
      { label: `Take all of B (${b ?? 'theirs'})`, act: () => A.takeSide(path, f.path, 'theirs') },
      { label: 'Mark resolved', act: () => A.markResolved(path, [f.path]) },
      '-', ...open, '-',
      { label: 'Copy file path', act: () => api.copy(f.path) }
    ])
  }
  return A.popup([
    { label: 'File History', act: () => ctx && updateRepo(path, { center: { kind: 'history', file: f.path, sha: ctx.kind === 'commit' || ctx.kind === 'stash' ? ctx.sha : undefined } }) },
    { label: 'File Blame', enabled: f.status !== 'D', act: () => ctx && updateRepo(path, { center: { kind: 'history', file: f.path, sha: ctx.kind === 'commit' || ctx.kind === 'stash' ? ctx.sha : undefined, blame: true } }) },
    '-', ...open, '-',
    { label: 'Copy file path', act: () => api.copy(f.path) },
    '-', ...editDelete,
    '-',
    { label: 'Restore file from this commit', enabled: ctx?.kind === 'commit' && f.status !== 'D', act: () => {
      if (ctx?.kind !== 'commit') return
      return A.run(path, () => api.restoreFile(path, ctx.sha, f.path))
    } }
  ])
}

function confirmDeleteFile(path: string, file: string): Promise<void> {
  return new Promise((resolve) => showPrompt({
    kind: 'confirm', message: `Are you sure you want to delete '${file}'?`,
    buttons: [{ label: 'Delete', style: 'danger', run: async () => { await A.run(path, () => api.deleteFile(path, file)); resolve() } }]
  }))
}

async function createFilePatch(path: string, file: string, staged: boolean) {
  const name = file.split('/').pop()!.replace(/[^\w.-]+/g, '-')
  const out = await api.pickSaveFile('Save patch', `${path}/../${name}.patch`, [{ name: 'Patch', extensions: ['patch', 'diff'] }])
  if (out) await A.run(path, () => api.createFilePatch(path, file, staged, out), { refresh: false, success: 'Patch saved' })
}

// ---------------------------------------------------------------------------------------------
// tabs

export function tabMenu(id: string): Promise<void> {
  const s = getState()
  const idx = s.tabs.findIndex((t) => t.id === id)
  return A.popup([
    { label: 'Close tab', act: () => A.closeTab(id) },
    { label: 'Close other tabs', act: async () => { for (const t of s.tabs) if (t.id !== id) await A.closeTab(t.id) }, enabled: s.tabs.length > 1 },
    { label: 'Close tabs to the right', act: async () => { for (const t of s.tabs.slice(idx + 1)) await A.closeTab(t.id) }, enabled: idx < s.tabs.length - 1 },
    { label: 'Alias repository', act: () => A2.renameTab(id) },
    '-',
    { label: 'Reopen Closed Tab', act: () => A.reopenClosedTab(), enabled: A.hasClosedTabs(), accelerator: 'CommandOrControl+Shift+T' }
  ])
}

// ---------------------------------------------------------------------------------------------
// drag & drop of a branch label onto another

export async function dropMenu(path: string, src: Ref, target: Ref): Promise<void> {
  if (src.name === target.name) return
  const s = A.snap(path)
  const cur = s.refs.find((r) => r.type === 'head' && r.isCurrent)
  const items: MI[] = []
  if (target.type === 'remote' && src.type === 'head') {
    const { remote, branch } = A.remoteOf(path, target.name)
    items.push({ label: `Push ${src.short} to ${target.short}`, act: () => A.doPush(path, { remote, branch: src.short, remoteBranch: branch }) })
    items.push({ label: `Push ${src.short} to ${target.short} and set upstream`, act: () => A.doPush(path, { remote, branch: src.short, remoteBranch: branch, setUpstream: true }) })
  }
  if (cur && target.name === cur.name) {
    items.push(...(await mergeItems(path, src)), ...rebaseItems(path, src, src.sha))
  } else if (cur && src.name === cur.name) {
    items.push(...(await mergeItems(path, target)), ...rebaseItems(path, target, target.sha))
  } else if (target.type === 'head') {
    items.push({ label: `Checkout ${target.short} and merge ${src.short}`, act: async () => { await A.checkoutRef(path, target); await A.mergeInto(path, src.short) } })
  }
  if (!items.length) return
  return A.popup(items)
}

async function ignorePath(path: string, pattern: string): Promise<void> {
  const cur = await api.readFile(path, '.gitignore')
  const next = `${cur.replace(/\s*$/, '')}${cur.trim() ? '\n' : ''}${pattern}\n`
  await A.run(path, () => api.writeFile(path, '.gitignore', next), { success: `Added ${pattern} to .gitignore` })
}

export { ffIfPossible }
