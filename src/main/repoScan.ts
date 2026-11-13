// Repository Management helpers: a quick per-repository summary and the search for repositories in project folders.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { runGit } from './gitcore'
import { parseSummary, SCAN_SKIP, type RepoSummary } from '../shared/repoSummary'

/** branch, ahead / behind and change counts; null when the folder is gone or no longer a repository */
export async function repoSummary(p: string): Promise<RepoSummary | null> {
  try { await fs.access(p) } catch { return null }
  const r = await runGit(['status', '--porcelain=v2', '--branch', '-z', '--ignore-submodules=dirty'], { cwd: p, allowFail: true })
  return r.code === 0 ? parseSummary(r.stdout) : null
}

/** repositories (folders with a .git entry) in `root`, `depth` levels deep, not looking inside repositories */
export async function scanRepos(root: string, depth = 3, limit = 500): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, level: number): Promise<void> => {
    if (found.length >= limit) return
    let entries: import('node:fs').Dirent[]
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    if (entries.some((e) => e.name === '.git')) { found.push(dir); return }
    if (level >= depth) return
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SCAN_SKIP.has(e.name.toLowerCase())) continue
      await walk(path.join(dir, e.name), level + 1)
    }
  }
  await walk(root, 0)
  return found.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: 'base' }))
}
