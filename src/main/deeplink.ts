// Git queries behind supergit://repolink links: which repository a link belongs to (its root
// commits and remotes), whether a commit exists, and the fetch offered when a ref is missing.
import * as git from './git'
import { parseRemotes } from './gitcore'
import type { Remote } from '../shared/types'

export interface RepoIdentity {
  root: string
  /** root commits of HEAD's history (a repository can have several); empty when shallow or unborn */
  firstCommits: string[]
  shallow: boolean
  remotes: Remote[]
}

export async function repoIdentity(p: string): Promise<RepoIdentity | null> {
  const info = await git.resolveRepo(p).catch(() => null)
  if (!info) return null
  const [roots, shallow, remotes] = await Promise.all([
    git.tryOut(info.root, ['rev-list', '--max-parents=0', 'HEAD']),
    git.tryOut(info.root, ['rev-parse', '--is-shallow-repository']),
    git.tryOut(info.root, ['remote', '-v'])
  ])
  const isShallow = shallow?.trim() === 'true'
  return {
    root: info.root,
    firstCommits: isShallow ? [] : (roots ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    shallow: isShallow,
    remotes: parseRemotes(remotes ?? '')
  }
}

/** the full sha of a commit that exists in the repository (any abbreviation), or null */
export async function commitExists(p: string, sha: string): Promise<string | null> {
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) return null
  const r = await git.tryOut(p, ['rev-parse', '-q', '--verify', `${sha}^{commit}`])
  return r?.trim() || null
}

/** "Fetch" from a link: the remote, plus the linked tag (which a plain fetch only brings when reachable) */
export async function fetchForLink(p: string, remote: string, tag?: string): Promise<void> {
  const args = ['fetch', '--progress', remote]
  if (tag && (await git.tryOut(p, ['check-ref-format', `refs/tags/${tag}`])) === null) throw new Error(`Invalid tag name "${tag}"`)
  if (tag) args.push(`+refs/tags/${tag}:refs/tags/${tag}`)
  await git.net(p, 'fetch', args)
}
