// Read-only import of what another Git client (GitKraken) already knows about the user's repositories:
// which ones are open as tabs, and which branches, remotes and stashes are hidden in each. Nothing is
// ever written to that client's files.
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { g } from './git'
import { repoSettingsFile } from './gitcore'
import type { GitKrakenRepo } from '../shared/types'

function dataDir(): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), '.gitkraken')
  return path.join(os.homedir(), '.gitkraken')
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown> } catch { return null }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** null when the client is not installed (no profile folder). */
export async function scanGitKraken(): Promise<GitKrakenRepo[] | null> {
  const profilesDir = path.join(dataDir(), 'profiles')
  let profiles: string[]
  try { profiles = (await fs.readdir(profilesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name) } catch { return null }

  const repos: GitKrakenRepo[] = []
  const seen = new Set<string>()
  for (const id of profiles) {
    const dir = path.join(profilesDir, id)
    const profile = await readJson(path.join(dir, 'profile'))
    const tabs = (profile?.tabInfo as { tabs?: unknown } | undefined)?.tabs
    if (!Array.isArray(tabs)) continue
    for (const t of tabs as Array<Record<string, unknown>>) {
      if (t.type !== 'REPO' || typeof t.repoPath !== 'string') continue
      const stored = t.repoPath
      const repoPath = path.normalize(stored.replace(/[\\/]+$/, ''))
      const key = repoPath.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const repo: GitKrakenRepo = { name: typeof t.repoName === 'string' ? t.repoName : path.basename(repoPath), path: repoPath, exists: existsSync(repoPath), hiddenRefs: [], hiddenStashes: [] }
      repos.push(repo)
      if (!repo.exists) continue

      const settings = await readJson(path.join(dir, 'repoSettings', repoSettingsFile(stored)))
      if (!settings) continue
      const hidden = new Set(strings(settings.hiddenRefs))
      // a hidden remote hides every branch under it
      const remotes = strings(settings.hiddenRemotes)
      if (remotes.length) {
        const refs = await g(repoPath, ['for-each-ref', '--format=%(refname)', ...remotes.map((r) => `refs/remotes/${r}`)], { allowFail: true })
        if (refs.code === 0) for (const r of refs.stdout.split('\n')) if (r.trim()) hidden.add(r.trim())
      }
      repo.hiddenRefs = [...hidden]
      // stashes are remembered by the sha of their index commit (second parent); map those to the stash commits
      const stashShas = new Set(strings(settings.hiddenStashShas))
      if (stashShas.size) {
        const list = await g(repoPath, ['log', '-g', '--format=%H %P', 'refs/stash'], { allowFail: true })
        if (list.code === 0) {
          for (const line of list.stdout.split('\n')) {
            const [sha, ...parents] = line.trim().split(' ')
            if (sha && (stashShas.has(sha) || parents.some((p) => stashShas.has(p)))) repo.hiddenStashes.push(sha)
          }
        }
      }
    }
  }
  return repos
}
