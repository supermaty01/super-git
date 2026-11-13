// IPC methods added by the "missing features" quick-win round (implemented in main/quick.ts).
export interface QuickApi {
  /** at least one of the pathspecs matches a tracked file */
  anyTracked(p: string, specs: string[]): Promise<boolean>
  /** `git rm --cached -r`: stop tracking, keep the files on disk */
  untrackPaths(p: string, specs: string[]): Promise<void>
  /** checks out several files from a commit (they end up staged) */
  restoreFiles(p: string, sha: string, files: string[]): Promise<void>
  /** index stages (1 base, 2 ours, 3 theirs) present for a conflicted file */
  conflictStages(p: string, file: string): Promise<number[]>
  /** modified-vs-deleted conflict */
  resolveDeleted(p: string, file: string, choice: 'modified' | 'new' | 'removed' | 'base'): Promise<void>
  setSubmoduleUrl(p: string, subPath: string, url: string): Promise<void>
  discardSubmodule(p: string, subPath: string): Promise<void>
}
