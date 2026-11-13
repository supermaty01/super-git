// Main-process helpers for the commit panel: the commit hooks of a repository (the original only offers
// "Skip Git hooks" when there are any) and one patch from several working files.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { g, tryOut } from './git'

/** the hooks `git commit` runs, as the original lists them */
export const COMMIT_HOOKS = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']

/** the commit hooks present in the hooks folder (core.hooksPath respected); `.sample` files do not count */
export async function getCommitHooks(cwd: string): Promise<string[]> {
  const dir = await tryOut(cwd, ['rev-parse', '--git-path', 'hooks'])
  if (!dir) return []
  const abs = path.resolve(cwd, dir.trim())
  const found: string[] = []
  for (const h of COMMIT_HOOKS) {
    try {
      if ((await fs.stat(path.join(abs, h))).isFile()) found.push(h)
    } catch { /* not there */ }
  }
  return found
}

/** "Create patch from changes in N files": the index or working-tree diff of those files, untracked ones as new files */
export async function createFilesPatch(cwd: string, files: string[], staged: boolean, outFile: string): Promise<void> {
  let text = (await g(cwd, ['diff', '--binary', ...(staged ? ['--cached'] : []), '--', ...files])).stdout
  if (!staged) {
    const untracked = (await g(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...files])).stdout.split('\0').filter(Boolean)
    for (const f of untracked) text += (await g(cwd, ['diff', '--binary', '--no-index', '--', '/dev/null', f], { allowFail: true })).stdout
  }
  await fs.writeFile(outFile, text, 'utf8')
}
