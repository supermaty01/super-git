// Types shared by the main process (git backend) and the renderer (UI).

export interface Commit {
  sha: string
  parents: string[]
  author: string
  email: string
  /** author date, ms since epoch */
  date: number
  /** committer date, ms since epoch */
  commitDate: number
  committer: string
  committerEmail: string
  summary: string
  body: string
  /** set for stash entries rendered in the graph */
  stashIndex?: number
}

export type RefType = 'head' | 'remote' | 'tag'

export interface Ref {
  /** full ref name, e.g. refs/heads/main */
  name: string
  /** short display name, e.g. main or origin/main */
  short: string
  type: RefType
  /** commit the ref points at (tags are peeled) */
  sha: string
  /** for remote refs: the remote name */
  remote?: string
  /** for local branches: the full upstream ref */
  upstream?: string
  ahead?: number
  behind?: number
  upstreamGone?: boolean
  isCurrent?: boolean
  /** annotated tag message / tip summary */
  subject?: string
}

export interface Stash {
  index: number
  sha: string
  parents: string[]
  message: string
  date: number
}

export interface Worktree {
  path: string
  sha: string
  branch?: string
  isMain: boolean
  isCurrent: boolean
  locked: boolean
  prunable: boolean
  detached: boolean
}

export interface Remote {
  name: string
  fetchUrl: string
  pushUrl: string
}

/** N = unchanged (only used by the 'View all files' listing) */
export type FileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?' | 'N'

export interface FileChange {
  path: string
  oldPath?: string
  status: FileStatus
  additions?: number
  deletions?: number
}

export type RepoStateKind = 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'am'

export interface RepoState {
  kind: RepoStateKind
  /** branch/ref being merged or picked (best effort) */
  theirs?: string
  /** our branch name */
  ours?: string
  /** prepared message (MERGE_MSG) */
  message?: string
  step?: number
  total?: number
}

export interface WorkingStatus {
  staged: FileChange[]
  unstaged: FileChange[]
  conflicted: FileChange[]
  state: RepoState
}

export interface HeadInfo {
  branch?: string
  sha: string
  detached: boolean
  unborn: boolean
}

export interface Submodule {
  path: string
  sha: string
  /** '-' not initialized, '+' checked out at a different commit, 'U' conflicts, ' ' up to date */
  state: ' ' | '-' | '+' | 'U'
  describe?: string
  url?: string
}

export interface GitflowConfig {
  initialized: boolean
  master: string
  develop: string
  feature: string
  release: string
  hotfix: string
  versionTag: string
}

export interface CommitStat { additions: number; deletions: number; files: number }

export interface RepoSnapshot {
  path: string
  name: string
  gitDir: string
  head: HeadInfo
  refs: Ref[]
  commits: Commit[]
  stashes: Stash[]
  worktrees: Worktree[]
  remotes: Remote[]
  status: WorkingStatus
  /** true when the log was truncated by the commit limit */
  hasMore: boolean
  user: { name: string; email: string }
  submodules: Submodule[]
  gitflow: GitflowConfig
}

export interface DiffLine {
  type: 'context' | 'add' | 'del' | 'nonewline'
  content: string
  oldLine?: number
  newLine?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  binary: boolean
  /** the raw `diff --git` header lines (used to rebuild patches) */
  headerLines: string[]
  hunks: DiffHunk[]
  isNew: boolean
  isDeleted: boolean
}

/** Which side of the working tree / which commit a file view refers to */
export type FileContext =
  | { kind: 'unstaged'; path: string; status: FileStatus }
  | { kind: 'staged'; path: string; oldPath?: string; status: FileStatus }
  | { kind: 'commit'; sha: string; parent?: string; path: string; oldPath?: string; status: FileStatus }
  | { kind: 'stash'; sha: string; parent?: string; path: string; oldPath?: string; status: FileStatus }
  /** compare two commits (b = null means the working directory) */
  | { kind: 'compare'; a: string; b: string | null; path: string; oldPath?: string; status: FileStatus }

export interface FileContents {
  original: string
  modified: string
  binary: boolean
  diff: FileDiff | null
  /** data: URLs for image files (binary diffs of images) */
  originalImage?: string
  modifiedImage?: string
}

export interface ConflictSides {
  path: string
  base: string
  ours: string
  theirs: string
  oursLabel: string
  theirsLabel: string
  oursSha: string
  theirsSha: string
}

export interface BlameLine {
  sha: string
  author: string
  date: number
  summary: string
  line: number
}

export type ResetMode = 'soft' | 'mixed' | 'hard'
export type PullMode = 'fetch' | 'ff' | 'ff-only' | 'rebase'

export interface RebaseTodoItem {
  action: 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'
  sha: string
  summary: string
  /** new message for reword */
  message?: string
}

export interface RecentRepo {
  path: string
  name: string
  lastOpened: number
}

export interface TabInfo {
  id: string
  path: string
  name: string
}

export interface Profile {
  id: string
  name: string
  gitName: string
  gitEmail: string
  signingKey?: string
}

export interface GraphColumns { ref: boolean; graph: boolean; message: boolean; author: boolean; date: boolean; sha: boolean; changes: boolean }

export interface Settings {
  zoom: number
  diffMode: 'hunk' | 'inline' | 'split'
  fileListMode: 'path' | 'tree'
  defaultPullMode: PullMode
  commitLimit: number
  layout: { leftWidth: number; rightWidth: number; refColWidth: number; graphColWidth: number; leftOpen: boolean; rightOpen?: boolean }
  defaultCloneDir: string
  azure: { orgUrl: string; hasToken: boolean; userName?: string }
  tabs: TabInfo[]
  activeTab: string | null
  recent: RecentRepo[]
  favorites: string[]
  showWhitespace: boolean
  wordWrap: boolean
  editorFont: string
  hiddenRefs: Record<string, string[]>
  soloRefs: Record<string, string[]>
  autoFetchMinutes: number
  theme: 'dark' | 'light'
  graphColumns: GraphColumns
  graphShow: { tags: boolean; stashes: boolean; remotes: boolean }
  externalEditor: string
  terminalShell: 'powershell' | 'pwsh' | 'cmd' | 'gitbash'
  terminalHeight: number
  /** branch pinned to the left-most graph lane, per repository */
  pinnedRefs: Record<string, string>
  /** smart branch visibility (show only the checked-out branch, its upstream and the main branches) */
  smartVisibility: Record<string, boolean>
  compactGraph: boolean
  /** left panel sections the user turned off */
  hiddenSections: string[]
  profiles: Profile[]
  activeProfile: string

  /** connected hosting services (tokens live in Windows Credential Manager or encrypted on disk, never here) */
  integrations: Partial<Record<ProviderId, ProviderAccount>>

  // General
  autoPrune: boolean
  rememberTabs: boolean
  updateSubmodules: boolean
  /** explicit git.exe path ('' = auto-detect) */
  gitPath: string

  // UI customization
  showToolbarLabels: boolean
  commitDescription: 'always' | 'hover' | 'never'
  ghostRefs: boolean
  highlightOnRefHover: boolean
  authorInitials: boolean
  dateFormat: 'locale' | 'mdy' | 'dmy' | 'ymd'
  clock: '24h' | '12h'
  toastPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  spellcheck: boolean

  // Commit
  pushAfterCommit: boolean
  skipHooksDefault: boolean
  stripComments: boolean

  // Editor
  editorFontSize: number
  editorTabSize: number
  editorLineNumbers: boolean
  editorSyntax: boolean
  editorEol: 'auto' | 'lf' | 'crlf'

  // In-app terminal
  terminalFont: string
  terminalFontSize: number
  terminalLineHeight: number
  terminalCursor: 'block' | 'underline' | 'bar'
  terminalDimUnfocused: boolean

  // External tools
  /** command that opens a terminal in the repo; {path} is replaced ('' = Windows Terminal / PowerShell) */
  externalTerminal: string
}

export type ProviderId = 'github' | 'github-enterprise' | 'gitlab' | 'gitlab-self' | 'bitbucket' | 'bitbucket-server' | 'azure'

export interface ProviderAccount {
  provider: ProviderId
  /** host name (github.com, gitlab.example.com…); for Azure DevOps the organization URL */
  host: string
  username: string
  displayName?: string
  avatarUrl?: string
  /** oauth = credential from Git Credential Manager's browser sign-in; token = personal access token */
  method: 'oauth' | 'token'
  /** set when the account works for git but its token cannot list repositories */
  browseError?: string
  connectedAt: number
}

export interface ProviderConnectOptions {
  method: 'oauth' | 'token'
  /** self-hosted host or Azure DevOps organization */
  host?: string
  token?: string
  /** needed by Bitbucket API tokens / app passwords */
  username?: string
}

export interface HostedRepo {
  id: string
  name: string
  fullName: string
  /** owner, group, workspace or project used to group the list */
  group: string
  cloneUrl: string
  sshUrl?: string
  webUrl: string
  isPrivate: boolean
  defaultBranch?: string
  updatedAt?: number
  description?: string
}

export interface CommitOptions { noVerify?: boolean; sign?: boolean; keepComments?: boolean }
export type StashMode = 'all' | 'staged' | 'keep-index'

export interface LfsInfo { installed: boolean; enabled: boolean; patterns: string[] }
export interface SshKey { file: string; publicKey: string; type: string; comment: string }
export interface GpgKey { id: string; uid: string }

export interface AdoProject {
  id: string
  name: string
}

export interface AdoRepo {
  id: string
  name: string
  project: string
  remoteUrl: string
  webUrl: string
  defaultBranch?: string
  size?: number
}

export interface MenuItemSpec {
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'checkbox'
  enabled?: boolean
  checked?: boolean
  accelerator?: string
  submenu?: MenuItemSpec[]
}

export interface GitProgressEvent {
  repo: string
  op: string
  text: string
  percent?: number
}

export interface OpResult {
  ok: boolean
  error?: string
  /** true when the op stopped because of conflicts */
  conflicts?: boolean
  output?: string
}

/** A repository another Git client (GitKraken) has open, with what the user chose to hide there. */
export interface GitKrakenRepo {
  name: string
  path: string
  exists: boolean
  /** full ref names (refs/heads/…, refs/remotes/…) */
  hiddenRefs: string[]
  /** stash commit shas */
  hiddenStashes: string[]
}
