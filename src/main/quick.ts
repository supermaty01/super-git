// Small additions of the "missing features" quick-win round (ignore + stop tracking, restoring several files, ...).
import { g, tryOut } from './git'
import type { QuickApi } from '../shared/quickApi'

/** at least one of the pathspecs matches a file in the index */
async function anyTracked(cwd: string, specs: string[]): Promise<boolean> {
  if (!specs.length) return false
  const r = await tryOut(cwd, ['ls-files', '--cached', '-z', '--', ...specs])
  return !!r && r.length > 0
}

/** "Ignore and Stop Tracking": drops the files from the index and keeps them on disk */
async function untrackPaths(cwd: string, specs: string[]): Promise<void> {
  if (!specs.length) return
  await g(cwd, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...specs])
}

/** "Restore selected files from this commit": the files land in the working directory as staged changes */
async function restoreFiles(cwd: string, sha: string, files: string[]): Promise<void> {
  if (!files.length) return
  await g(cwd, ['checkout', sha, '--', ...files])
}

/** the index stages (1 base, 2 ours, 3 theirs) present for a conflicted file */
async function conflictStages(cwd: string, file: string): Promise<number[]> {
  const r = await tryOut(cwd, ['ls-files', '-u', '--', file])
  const st = new Set<number>()
  for (const rec of (r ?? '').split('\n')) {
    const m = /^\d+ [0-9a-f]+ (\d)\t/.exec(rec)
    if (m) st.add(Number(m[1]))
  }
  return [...st].sort()
}

/** a modified-vs-deleted conflict: keep the modified file, the base version or delete the file */
async function resolveDeleted(cwd: string, file: string, choice: 'modified' | 'new' | 'removed' | 'base'): Promise<void> {
  if (choice === 'removed') { await g(cwd, ['rm', '-f', '-q', '--', file]); return }
  if (choice === 'base') await g(cwd, ['checkout-index', '-f', '--stage=1', '--', file])
  await g(cwd, ['add', '--', file])
}

/** "Edit Submodule": changes the URL in .gitmodules and syncs it into the repository config */
async function setSubmoduleUrl(cwd: string, subPath: string, url: string): Promise<void> {
  const r = await tryOut(cwd, ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'])
  const line = (r ?? '').split('\n').find((l) => l.split(' ').slice(1).join(' ').trim() === subPath)
  const m = line ? /^submodule\.(.*)\.path /.exec(line) : null
  if (!m) throw new Error(`No submodule found for ${subPath} in .gitmodules`)
  await g(cwd, ['config', '-f', '.gitmodules', `submodule.${m[1]}.url`, url])
  await g(cwd, ['submodule', 'sync', '--', subPath])
}

/** "Discard Submodule Changes": resets its working tree and checks out the commit the repository points to */
async function discardSubmodule(cwd: string, subPath: string): Promise<void> {
  await g(cwd, ['submodule', 'update', '--init', '--force', '--', subPath])
}

export const quickApi: QuickApi = { anyTracked, untrackPaths, restoreFiles, conflictStages, resolveDeleted, setSubmoduleUrl, discardSubmodule }
