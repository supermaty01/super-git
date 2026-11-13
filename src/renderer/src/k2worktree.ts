// Worktree extras like the original's: remove with the local and remote branch, removing the open worktree
// (switches to the main one first), "folder wasn't deleted", and new worktrees inheriting hide / solo.
import { api } from './lib/api'
import { getState, showPrompt, toast } from './store'
import * as A from './actions'
import { openInThisTab, saveSettings } from './actions2'
import { errMsg } from './lib/format'
import type { Worktree } from '@shared/types'

const confirm = (message: string, label: string, act: () => unknown) => showPrompt({ kind: 'confirm', message, buttons: [{ label, style: 'danger', run: act }] })

/** the remote branch a worktree's branch tracks, if any */
export function remoteOf(path: string, branch: string | undefined): { remote: string; branch: string; short: string } | null {
  if (!branch) return null
  const s = getState().repos[path]?.snapshot
  const ref = s?.refs.find((r) => r.type === 'head' && r.short === branch)
  if (!ref?.upstream || ref.upstreamGone || !ref.upstream.startsWith('refs/remotes/')) return null
  const short = ref.upstream.slice('refs/remotes/'.length)
  const remote = s!.remotes.map((r) => r.name).sort((a, b) => b.length - a.length).find((r) => short.startsWith(r + '/'))
  return remote ? { remote, branch: short.slice(remote.length + 1), short } : null
}

/**
 * Remove a worktree, optionally with its branch (and the remote branch). The worktree that is open in this tab is
 * removed from the main worktree, which this tab switches to first.
 */
export async function removeWorktreeK2(path: string, wt: Worktree, del: 'none' | 'local' | 'both' = 'none'): Promise<void> {
  const branch = wt.branch?.replace(/^refs\/heads\//, '')
  const remote = del === 'both' ? remoteOf(path, branch) : null
  let repo = path
  const go = async () => {
    if (wt.isCurrent) {
      const main = getState().repos[path]?.snapshot?.worktrees.find((w) => w.isMain)
      if (!main) return
      let at: string | undefined
      try { at = await openInThisTab(path, main.path) } catch (e) { toast({ kind: 'error', title: 'Failed to switch to the main worktree', message: errMsg(e) }); return }
      if (!at) return
      repo = at
    }
    const remove = async (force: boolean) => {
      const res = await A.run(repo, () => api.removeWorktree2(repo, wt.path, {
        force, branch: del !== 'none' ? branch : undefined, deleteRemote: remote ? { remote: remote.remote, branch: remote.branch } : undefined
      }), { busy: 'Removing worktree…', errorTitle: 'Failed to remove worktree' })
      if (res?.folderLeft) {
        toast({ kind: 'info', title: "Worktree removed, but its folder wasn't deleted", message: `The worktree was removed from Git, but its folder at '${wt.path}' couldn't be fully deleted because some files are still in use. Close any apps using it (editors, terminals, dev servers) and delete the folder manually.` }, 0)
      }
      return res
    }
    // like the original: force is offered only when git refuses (changes, locked)
    try {
      const r = await api.removeWorktree2(repo, wt.path, { force: false })
      if (r.folderLeft) toast({ kind: 'info', title: "Worktree removed, but its folder wasn't deleted", message: `The worktree was removed from Git, but its folder at '${wt.path}' couldn't be fully deleted because some files are still in use. Close any apps using it (editors, terminals, dev servers) and delete the folder manually.` }, 0)
      if (del !== 'none' && branch) await A.run(repo, async () => {
        await api.deleteBranch(repo, branch, true)
        if (remote) await api.deleteRemoteBranch(repo, remote.remote, remote.branch)
      }, { busy: A.DELETING, errorTitle: `Worktree was removed but deleting branch ${branch} failed` })
      else await A.refresh(repo)
    } catch {
      confirm('Removing this worktree requires force, which is destructive and cannot be undone. Do you want to complete the removal?', 'Force Remove Worktree', () => remove(true))
    }
  }
  if (del === 'both' && branch) confirm(`This will permanently remove the worktree at '${wt.path}' and delete the local branch '${branch}' and its remotes. This action cannot be undone.`, 'Remove and Delete', go)
  else if (del === 'local' && branch) confirm(`This will permanently remove the worktree at '${wt.path}' and delete the local branch '${branch}'. This action cannot be undone.`, 'Remove and Delete', go)
  else await go()
}

/** a worktree opened for the first time starts with the hide / solo settings of the repository it belongs to */
export function inheritVisibility(from: string, to: string): void {
  const s = getState().settings
  if (!s) return
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (Object.keys(s.hiddenRefs).some((k) => norm(k) === norm(to)) || Object.keys(s.soloRefs).some((k) => norm(k) === norm(to))) return
  const hidden = (s.hiddenRefs[from] ?? []).filter((n) => !n.startsWith('stash:'))
  const solo = s.soloRefs[from] ?? []
  if (!hidden.length && !solo.length) return
  const key = to.replace(/\//g, '\\')
  saveSettings({ hiddenRefs: { ...s.hiddenRefs, [key]: hidden }, soloRefs: { ...s.soloRefs, [key]: solo } })
}

/** open a worktree (in this tab or a new one) with the repository's hide / solo settings */
export async function openWorktree(path: string, wtPath: string, newTab: boolean): Promise<void> {
  inheritVisibility(path, wtPath)
  await (newTab ? A.openRepo(wtPath) : openInThisTab(path, wtPath))
}
