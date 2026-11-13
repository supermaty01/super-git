// Types and IPC methods for the larger features: branch cleanup, conflict prevention, credentials, gitflow and worktree extras.
import type { OpResult } from './types'

/** a local branch as the "Clean Up Local Branches" dialog lists it */
export interface CleanupBranch {
  /** short name, e.g. feature/x */
  name: string
  fullName: string
  sha: string
  /** committer date of the tip, ms */
  lastCommitDate: number
  /** null: no upstream (or it is gone) */
  upstream: { type: 'local' } | { type: 'remote'; remoteName: string; branchName: string } | null
  /** the tip is contained in HEAD or in the repository's main branch */
  merged: boolean
}

/** what proactive conflict detection found for the current branch */
export interface ConflictCheck {
  /** the current branch (short name) */
  branch: string
  /** the branch it was compared with (short name, e.g. origin/main) */
  target: string
  targetSha: string
  /** files that would conflict on a merge; empty when the merge is clean */
  files: Array<{ path: string; lines: Array<[number, number]> }>
  /** ms when it ran */
  time: number
}

/** stored in Settings.k2 */
export interface K2Settings {
  /** Preferences > General > "Enable proactive conflict detection with target branch" (default on) */
  conflictDetection?: boolean
  /** per repository: its own switch and the "Base branches" rules */
  repoConflict?: Record<string, { enabled?: boolean; rules?: string[] }>
  /** the gitflow forms remember their checkboxes, like the original's profile settings */
  gitflow?: {
    featureStartAt?: 'develop' | 'active'
    releaseStartAt?: 'develop' | 'active'
    featureRebase?: boolean
    featureDelete?: boolean
    releaseDelete?: boolean
    hotfixDelete?: boolean
  }
  /** worktree list in the left panel */
  worktreeSort?: 'name' | 'folder'
}

export interface K2Api {
  /** local branches for the cleanup dialog (not the current one, not ones checked out in another worktree) */
  branchCleanupInfo(p: string): Promise<CleanupBranch[]>
  /** compares the current branch with the first matching target branch; null when there is nothing to compare */
  conflictCheck(p: string, rules: string[]): Promise<ConflictCheck | null>
  /** "Forget all Usernames and Passwords": erases the stored git credentials SuperGit can reach; returns how many */
  forgetCredentials(): Promise<number>
  /** "Update known_hosts with new key": drops the old host key (ssh-keygen -R) */
  sshForgetHost(host: string): Promise<void>
  /** gitflow finish with the original's options */
  gitflowFinish2(p: string, type: 'feature' | 'release' | 'hotfix', name: string, opts: { deleteBranch: boolean; rebase?: boolean; tagMessage?: string }): Promise<OpResult>
  /** gitflow start from develop/master (latest) or from the current HEAD */
  gitflowStart2(p: string, type: 'feature' | 'release' | 'hotfix', name: string, fromHead: boolean): Promise<string>
  /** removes a worktree; with deleteBranch also its branch (and the remote one); folderLeft when git could not delete the folder */
  removeWorktree2(p: string, dir: string, opts: { force: boolean; branch?: string; deleteRemote?: { remote: string; branch: string } }): Promise<{ folderLeft: boolean }>
  /** working-tree changes of every other worktree, for its WIP row in the graph */
  worktreeWips(p: string): Promise<Array<{ path: string; branch?: string; sha: string; changes: number }>>
}
