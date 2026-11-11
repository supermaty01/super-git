import type { AutoStash, UndoPreview, UpdateState,
  RepoSnapshot, WorkingStatus, FileChange, FileContext, FileContents, ConflictSides, BlameLine, Commit, ResetMode, PullMode,
  RebaseTodoItem, OpResult, Settings, MenuItemSpec, ProviderId, ProviderAccount, ProviderConnectOptions, HostedRepo, CommitOptions, StashMode, CommitStat, GitflowConfig, LfsInfo, SshKey, GpgKey, GitKrakenRepo
} from './types'

/** Every method exposed from the main process. Each call resolves or rejects with an Error. */
export interface Api {
  // dialogs & shell
  pickDirectory(title: string, defaultPath?: string): Promise<string | null>
  showContextMenu(items: MenuItemSpec[]): Promise<string | null>
  confirm(opts: { title: string; message: string; detail?: string; buttons: string[]; type?: 'warning' | 'question' | 'info' | 'error'; defaultId?: number; cancelId?: number }): Promise<number>
  openExternal(url: string): Promise<void>
  showInFolder(p: string): Promise<void>
  openFile(p: string): Promise<void>
  openTerminal(p: string): Promise<void>
  copy(text: string): Promise<void>
  setZoom(z: number): Promise<void>
  getVersion(): Promise<string>

  // settings
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  addRecent(path: string, name: string): Promise<void>

  gitConfigGet(key: string, repo?: string): Promise<string | null>
  gitConfigSet(key: string, value: string, repo?: string): Promise<void>

  // hosting service integrations
  providerConnect(p: ProviderId, opts: ProviderConnectOptions): Promise<ProviderAccount>
  providerDisconnect(p: ProviderId): Promise<void>
  providerRepos(p: ProviderId): Promise<HostedRepo[]>
  /** detected git executable and its version */
  gitInfo(): Promise<{ path: string; version: string; readOnly: boolean }>
  /** repositories open in GitKraken and what is hidden in each; null when it is not installed. Read-only. */
  gitkrakenScan(): Promise<GitKrakenRepo[] | null>
  /** automatic updates: current state, a check (manual = from the Help menu), restart into the downloaded version */
  updateStatus(): Promise<UpdateState>
  checkForUpdates(manual: boolean): Promise<UpdateState>
  installUpdate(): Promise<void>
  /** GitKraken preferences SuperGit has an equivalent for */
  gitkrakenSettings(): Promise<Partial<Settings>>
  /** the folder SuperGit was started with (Explorer "Open with SuperGit"), once */
  takeStartupFolder(): Promise<string | null>
  /** true once after the installer's "Import from GitKraken" option */
  takeGitKrakenImportFlag(): Promise<boolean>
  /** keeps the application menu's checkmarks and favorites in step with the app */
  setMenuState(state: { hasRepo?: boolean; leftPanel?: boolean; detailPanel?: boolean; terminal?: boolean; favorites?: string[] }): Promise<void>
  showAbout(): Promise<void>
  /** compacts the repository (git gc) */
  maintenance(p: string): Promise<void>
  sparseCheckout(p: string): Promise<{ enabled: boolean; patterns: string[] }>
  /** null turns sparse checkout off */
  sparseCheckoutSet(p: string, patterns: string[] | null): Promise<void>
  gpgPublicKey(key: string): Promise<string>
  activityLog(): Promise<Array<{ time: number; repo: string; args: string; ms: number; code: number; error?: string }>>

  // repo lifecycle
  resolveRepo(p: string): Promise<{ root: string; gitDir: string } | null>
  initRepo(dir: string, opts?: { defaultBranch?: string; files?: Record<string, string>; initialCommit?: boolean }): Promise<string>
  cloneRepo(url: string, dest: string, opts: { shallow?: boolean; branch?: string; recurse?: boolean }): Promise<string>
  watch(p: string): Promise<void>
  unwatch(p: string): Promise<void>

  // reading
  snapshot(p: string, limit: number): Promise<RepoSnapshot>
  status(p: string): Promise<WorkingStatus>
  commitFiles(p: string, sha: string, parent?: string): Promise<FileChange[]>
  stashFiles(p: string, sha: string): Promise<FileChange[]>
  commitDetails(p: string, sha: string): Promise<Commit | null>
  fileContents(p: string, ctx: FileContext, ignoreWhitespace: boolean): Promise<FileContents>
  conflictSides(p: string, file: string): Promise<ConflictSides>
  blame(p: string, file: string, sha?: string): Promise<BlameLine[]>
  fileHistory(p: string, file: string, from?: string): Promise<Array<Commit & { path: string }>>
  searchCommits(p: string, q: string): Promise<string[]>
  lastCommitMessage(p: string): Promise<string>
  isAncestor(p: string, a: string, b: string): Promise<boolean>

  // staging & commit
  stage(p: string, paths: string[]): Promise<void>
  stageAll(p: string): Promise<void>
  unstage(p: string, paths: string[]): Promise<void>
  unstageAll(p: string): Promise<void>
  discardFiles(p: string, files: FileChange[]): Promise<void>
  discardAll(p: string): Promise<void>
  applyHunk(p: string, ctx: FileContext, hunk: number, lines: number[] | null, action: 'stage' | 'unstage' | 'discard' | 'revert'): Promise<void>
  commit(p: string, message: string, amend: boolean, opts?: CommitOptions): Promise<void>
  resolveConflict(p: string, file: string, content: string): Promise<void>
  writeFile(p: string, file: string, content: string): Promise<void>
  resolveWithSide(p: string, file: string, side: 'ours' | 'theirs'): Promise<void>

  // refs
  /** checks out; local changes that are in the way are stashed and popped again */
  checkout(p: string, target: string): Promise<AutoStash | undefined>
  restoreFile(p: string, sha: string, file: string): Promise<void>
  /** newName: create that branch at the remote one; reset: move the existing local branch to it */
  checkoutRemote(p: string, remoteShort: string, localExists: boolean, opts?: { newName?: string; reset?: boolean }): Promise<string>
  createBranch(p: string, name: string, at: string, checkout: boolean): Promise<void>
  deleteBranch(p: string, name: string, force: boolean): Promise<void>
  deleteRemoteBranch(p: string, remote: string, branch: string): Promise<void>
  renameBranch(p: string, oldName: string, newName: string): Promise<void>
  setUpstream(p: string, branch: string, upstream: string | null): Promise<void>
  fastForward(p: string, branch: string, to: string, isCurrent: boolean): Promise<void>
  createTag(p: string, name: string, at: string, message?: string): Promise<void>
  deleteTag(p: string, name: string): Promise<void>
  deleteRemoteTag(p: string, remote: string, name: string): Promise<void>
  moveTag(p: string, name: string, to: string): Promise<void>
  /** tag names per remote (ls-remote); null = unreachable */
  remoteTags(p: string): Promise<Record<string, string[] | null>>
  pushTag(p: string, remote: string, name: string): Promise<void>
  addRemote(p: string, name: string, url: string): Promise<void>
  removeRemote(p: string, name: string): Promise<void>
  editRemote(p: string, oldName: string, name: string, fetchUrl: string, pushUrl: string): Promise<void>

  // history ops
  merge(p: string, ref: string, opts?: { noFF?: boolean; ffOnly?: boolean; squash?: boolean }): Promise<OpResult>
  rebase(p: string, onto: string): Promise<OpResult>
  interactiveRebase(p: string, base: string | null, items: RebaseTodoItem[]): Promise<OpResult>
  cherryPick(p: string, shas: string[], noCommit?: boolean): Promise<OpResult>
  revert(p: string, sha: string, isMerge: boolean, noCommit?: boolean): Promise<OpResult>
  reset(p: string, sha: string, mode: ResetMode): Promise<OpResult>
  continueOp(p: string, kind: string, message?: string): Promise<OpResult>
  abortOp(p: string, kind: string): Promise<OpResult>
  skipOp(p: string, kind: string): Promise<OpResult>

  // stash
  stashSave(p: string, message?: string, mode?: StashMode): Promise<void>
  stashRename(p: string, index: number, message: string): Promise<void>
  stashPaths(p: string, paths: string[], message?: string): Promise<void>
  createFilePatch(p: string, file: string, staged: boolean, outFile: string): Promise<void>
  deleteFile(p: string, file: string): Promise<void>
  annotateTag(p: string, name: string, message: string): Promise<void>
  stashApply(p: string, index: number): Promise<OpResult>
  stashPop(p: string, index: number): Promise<OpResult>
  stashDrop(p: string, index: number): Promise<void>

  // worktrees
  addWorktree(p: string, dir: string, opts: { branch?: string; newBranch?: string; commit?: string }): Promise<void>
  validateWorktree(p: string, o: { ref: string; branch: string; createBranch: boolean; dir: string }): Promise<{ level: 'error' | 'warning'; message: string } | null>
  removeWorktree(p: string, dir: string, force: boolean): Promise<void>
  pruneWorktrees(p: string): Promise<void>
  /** reason: optional lock message; null unlocks */
  lockWorktree(p: string, dir: string, reason: string | null): Promise<void>

  // network
  fetchAll(p: string, quiet?: boolean): Promise<void>
  fetchRemote(p: string, remote: string): Promise<void>
  pull(p: string, mode: PullMode): Promise<OpResult>
  push(p: string, opts: { remote: string; branch: string; remoteBranch?: string; setUpstream?: boolean; force?: boolean; noLease?: boolean }): Promise<OpResult>

  // extras
  compareFiles(p: string, a: string, b: string | null): Promise<FileChange[]>
  commitStats(p: string, limit: number): Promise<Record<string, CommitStat>>
  signature(p: string, sha: string): Promise<{ status: string; signer: string; key: string } | null>
  treeFiles(p: string, sha: string): Promise<string[]>
  listFiles(p: string): Promise<string[]>
  readFile(p: string, file: string): Promise<string>
  commitTemplate(p: string): Promise<string>
  gitConfigUnset(key: string, repo?: string): Promise<void>
  gitflowInit(p: string, cfg: Omit<GitflowConfig, 'initialized'>): Promise<void>
  gitflowStart(p: string, type: 'feature' | 'release' | 'hotfix', name: string): Promise<string>
  gitflowFinish(p: string, type: 'feature' | 'release' | 'hotfix', name: string, opts: { deleteBranch: boolean; tagMessage?: string }): Promise<OpResult>
  lfsInfo(p: string): Promise<LfsInfo>
  lfsInstall(p: string): Promise<void>
  lfsTrack(p: string, pattern: string): Promise<void>
  lfsUntrack(p: string, pattern: string): Promise<void>
  lfsCommand(p: string, cmd: 'pull' | 'fetch' | 'prune' | 'checkout' | 'push'): Promise<void>
  pickSaveFile(title: string, defaultPath: string, filters: Array<{ name: string; extensions: string[] }>): Promise<string | null>
  pickOpenFile(title: string, filters: Array<{ name: string; extensions: string[] }>): Promise<string | null>
  createPatch(p: string, shasOldestFirst: string[], outFile: string): Promise<void>
  applyPatch(p: string, file: string, asCommits: boolean): Promise<OpResult>
  submoduleUpdate(p: string, sub?: string): Promise<void>
  /** "Delete this submodule": deinit, remove it from the index and .gitmodules, and drop its git dir */
  deleteSubmodule(p: string, sub: string, commit?: boolean): Promise<void>
  submoduleAdd(p: string, url: string, subPath: string): Promise<void>
  submoduleSync(p: string): Promise<void>
  openInEditor(p: string, file: string | null): Promise<void>
  externalMergeTool(p: string, file: string): Promise<OpResult>
  externalDiffTool(p: string, file: string, staged: boolean, from?: string, to?: string): Promise<void>
  sshKeys(): Promise<SshKey[]>
  sshGenerate(email: string, name: string): Promise<SshKey>
  gpgKeys(): Promise<GpgKey[]>
  setTheme(theme: 'dark' | 'light'): Promise<void>

  // terminal
  termStart(p: string, cols: number, rows: number): Promise<number>
  termWrite(id: number, data: string): Promise<void>
  termResize(id: number, cols: number, rows: number): Promise<void>
  termKill(id: number): Promise<void>

  // undo / redo
  /** returns what was undone (for the toast), or null when nothing was done */
  undo(p: string, opts?: { stash?: boolean }): Promise<string | null>
  redo(p: string, opts?: { stash?: boolean }): Promise<string | null>
  undoState(p: string): Promise<{ undo: UndoPreview; redo: UndoPreview }>
}

export interface Events {
  onRepoChanged(cb: (path: string) => void): () => void
  onProgress(cb: (e: { repo: string; op: string; text: string }) => void): () => void
  onZoom(cb: (z: number) => void): () => void
  onCommand(cb: (cmd: string) => void): () => void
  onUpdate(cb: (u: UpdateState & { manual: boolean }) => void): () => void
  onTermData(cb: (e: { id: number; data: string }) => void): () => void
  onTermExit(cb: (e: { id: number; code: number }) => void): () => void
}

export type Bridge = { call<K extends keyof Api>(method: K, ...args: Parameters<Api[K]>): ReturnType<Api[K]> } & Events
