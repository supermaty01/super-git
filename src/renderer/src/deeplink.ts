// supergit://repolink links, modelled on the original's DeepLink sagas: find the repository by its
// first commit (or remote URL), open or switch to it, make sure the remote is there, fetch when the
// ref is missing, then select the commit. "Copy link to …" menu items build the links.
import * as A from './actions'
import { api } from './lib/api'
import { getState, useStore, toast, dismissToast, showPrompt, openModal, updateRepo } from './store'
import {
  parseSuperGitUri, parseRepoLink, buildRepoLink, isLinkableRemoteUrl, normalizeRemoteUrl,
  repoNameFromRemoteUrl, remoteNameForUrl, type RepoLink, type LinkType
} from '@shared/cli'
import type { Ref, RepoSnapshot } from '@shared/types'
import type { MI } from './actions'
import { errMsg } from './lib/format'

const ERROR_TITLE = 'Could not open link'
const typeWord = (t: LinkType) => t

type Identity = NonNullable<Awaited<ReturnType<typeof api.repoIdentity>>>
const identities = new Map<string, Promise<Identity | null>>()
function identity(path: string, fresh = false): Promise<Identity | null> {
  const key = path.toLowerCase()
  if (fresh || !identities.has(key)) identities.set(key, api.repoIdentity(path).catch(() => null))
  return identities.get(key)!
}

/** a toolbar prompt as a promise: the label of the button pressed, or null (Esc / replaced) */
function ask(message: string, buttons: Array<{ label: string; style?: 'default' | 'success' }>): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: string | null) => { if (!done) { done = true; unsub(); resolve(v) } }
    showPrompt({ kind: 'confirm', message, buttons: buttons.map((b) => ({ ...b, run: () => finish(b.label) })) })
    const spec = getState().prompt
    // a button closes the prompt before it runs: only a close with no button pressed is a cancel
    const unsub = useStore.subscribe((s) => { if (s.prompt !== spec) setTimeout(() => finish(null), 0) })
  })
}

async function waitForSnapshot(path: string, ms = 30000): Promise<RepoSnapshot | null> {
  const t = Date.now()
  for (;;) {
    const v = getState().repos[path]
    if (v?.snapshot && !v.loading) return v.snapshot
    if (v?.error || Date.now() - t > ms) return v?.snapshot ?? null
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** repositories SuperGit knows: open tabs, favourites and recent ones */
function knownPaths(): string[] {
  const s = getState()
  const all = [...s.tabs.map((t) => t.path), ...(s.settings?.favorites ?? []), ...(s.settings?.recent ?? []).map((r) => r.path)]
  const seen = new Set<string>()
  return all.filter((p) => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
}

async function findRepos(link: RepoLink): Promise<string[]> {
  const url = normalizeRemoteUrl(link.pullUrl)
  const ids = (await Promise.all(knownPaths().map((p) => identity(p, true)))).filter((x): x is Identity => !!x)
  const bySha = link.firstCommitSha ? ids.filter((i) => i.firstCommits.includes(link.firstCommitSha!)) : []
  const byUrl = ids.filter((i) => i.remotes.some((r) => normalizeRemoteUrl(r.fetchUrl) === url) && (!link.firstCommitSha || i.shallow || !i.firstCommits.length))
  const roots = [...new Set((bySha.length ? bySha : byUrl).map((i) => i.root))]
  // the repository on screen first
  const active = getState().tabs.find((t) => t.id === getState().activeTab)?.path.toLowerCase()
  return roots.sort((a, b) => Number(b.toLowerCase() === active) - Number(a.toLowerCase() === active))
}

/** a folder picked by hand ("Open existing repo" / "Choose another repo on disk") */
async function browseForRepo(): Promise<string | null> {
  const d = await api.pickDirectory('Select a repository to open')
  if (!d) return null
  const id = await identity(d, true)
  if (!id) { toast({ kind: 'error', title: 'Invalid Filepath', message: `Could not find repo at ${d}` }); return null }
  return id.root
}

async function chooseRepo(link: RepoLink, progress: number): Promise<string | null> {
  const found = await findRepos(link)
  if (found.length === 1) return found[0]
  if (found.length > 1) {
    const buttons = [...found, 'Choose another repo on disk', 'Cancel']
    const i = await api.confirm({ title: 'SuperGit', message: `SuperGit tried to open the repo but found ${found.length} duplicates. Choose which one you want to open.`, buttons, cancelId: buttons.length - 1 })
    if (i < found.length) return found[i]
    return i === found.length ? browseForRepo() : null
  }
  const name = repoNameFromRemoteUrl(link.pullUrl)
  const buttons = ['Open existing repo', 'Clone repo from URL', 'Cancel']
  const i = await api.confirm({
    title: 'SuperGit', type: 'info', buttons, cancelId: 2,
    message: name ? `Couldn't find ${name}. You can browse for or clone the repo.` : "Couldn't find a matching repository. You can browse for or clone the repo."
  })
  if (i === 0) return browseForRepo()
  if (i === 1) { dismissToast(progress); openModal('clone', { url: link.pullUrl }) }
  return null
}

/** the remote of the repository the link was made for, added when missing (after asking) */
async function ensureRemote(path: string, link: RepoLink): Promise<string | null> {
  const url = normalizeRemoteUrl(link.pullUrl)
  const snap = await waitForSnapshot(path)
  const r = snap?.remotes.find((x) => normalizeRemoteUrl(x.fetchUrl) === url)
  if (r) return r.name
  if ((await ask("Couldn't find the remote from the URL, would you like to add it?", [{ label: 'Add Remote', style: 'success' }])) !== 'Add Remote') return null
  const name = remoteNameForUrl(link.pullUrl, snap?.remotes.map((x) => x.name) ?? [])
  try {
    await api.addRemote(path, name, link.pullUrl)
  } catch (e) {
    toast({ kind: 'error', title: ERROR_TITLE, message: `Failed to add remote "${name}" to repository\n${errMsg(e)}` })
    return null
  }
  try { await api.fetchRemote(path, name) } catch (e) {
    toast({ kind: 'error', title: ERROR_TITLE, message: `Failed to fetch "${name}"\n${errMsg(e)}` })
  }
  await A.refresh(path)
  return name
}

/** the commit the link points at, if it is in the repository now */
async function locate(path: string, link: RepoLink, remote: string): Promise<{ sha: string | null; inRepo: boolean }> {
  const snap = await waitForSnapshot(path)
  if (!snap) return { sha: null, inRepo: false }
  const refs: Ref[] = snap.refs
  if (link.type === 'branch') {
    const r = refs.find((x) => x.type === 'remote' && x.name === `refs/remotes/${remote}/${link.name}`)
    return { sha: r?.sha ?? null, inRepo: !!r }
  }
  if (link.type === 'tag') {
    const r = refs.find((x) => x.type === 'tag' && x.short === link.name)
    return { sha: r?.sha ?? null, inRepo: !!r }
  }
  const full = await api.commitExists(path, link.name!).catch(() => null)
  return { sha: full, inRepo: !!full }
}

function locationError(link: RepoLink): string {
  if (link.type === 'branch') return `Failed to find branch "${link.name}".`
  if (link.type === 'tag') return `Failed to find tag "${link.name}".`
  return 'Failed to find commit SHA'
}

export async function openDeepLink(uri: string): Promise<void> {
  const u = parseSuperGitUri(uri)
  const link = u && parseRepoLink(u)
  if (!link) { toast({ kind: 'error', title: ERROR_TITLE, message: 'URI was in an invalid format' }); return }
  const progress = toast({ kind: 'progress', title: `Resolving external link to ${typeWord(link.type)}` }, 0)
  try {
    const root = await chooseRepo(link, progress)
    if (!root) return
    await A.openRepo(root)
    const path = getState().tabs.find((t) => t.id === getState().activeTab)?.path
    if (!path) return
    const id = await identity(path, true)
    if (link.firstCommitSha && id && !id.shallow && id.firstCommits.length && !id.firstCommits.includes(link.firstCommitSha)) {
      toast({ kind: 'error', title: ERROR_TITLE, message: 'Repo opened does not match the linked repository.' }, 0)
      return
    }
    const remote = await ensureRemote(path, link)
    if (!remote) return
    if (link.type === 'remote') { toast({ kind: 'success', title: 'External link to remote resolved.' }, 2000); return }
    let at = await locate(path, link, remote)
    if (!at.inRepo) {
      if ((await ask(`Fetching is recommended to find the ref, would you like to fetch ${remote}?`, [{ label: 'Fetch', style: 'success' }])) !== 'Fetch') return
      try { await api.fetchForLink(path, remote, link.type === 'tag' ? link.name : undefined) } catch (e) {
        toast({ kind: 'error', title: ERROR_TITLE, message: `Failed to fetch "${remote}"\n${errMsg(e)}` })
        return
      }
      await A.refresh(path)
      at = await locate(path, link, remote)
    }
    if (!at.sha) { toast({ kind: 'error', title: ERROR_TITLE, message: locationError(link) }); return }
    const snap = await waitForSnapshot(path)
    if (!snap?.commits.some((c) => c.sha === at.sha)) {
      toast({ kind: 'error', title: ERROR_TITLE, message: 'Could not find commit in the graph' })
      return
    }
    A.closeCenter(path)
    A.selectCommit(path, at.sha)
    updateRepo(path, { focus: { sha: at.sha, t: Date.now() } })
    toast({ kind: 'success', title: `External link to ${typeWord(link.type)} resolved.` }, 2000)
  } finally {
    dismissToast(progress)
  }
}

// ---------------------------------------------------------------------------------------------
// "Copy link to …" (context menus)

async function copyLink(path: string, link: Omit<RepoLink, 'firstCommitSha'>): Promise<void> {
  const id = await identity(path, true)
  const sha = id?.firstCommits[id.firstCommits.length - 1]
  if (!sha) {
    toast({ kind: 'error', title: 'Failed to copy deep link', message: id?.shallow ? 'This feature is not supported in shallow repositories' : 'No first commit sha found for the repo.' })
    return
  }
  await api.copy(buildRepoLink({ ...link, firstCommitSha: sha }))
}

const linkableRemotes = (path: string) => A.snap(path).remotes.filter((r) => isLinkableRemoteUrl(r.fetchUrl)).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

/** "Copy link to this commit / tag [on remote: x]": one item for one remote, a submenu for several */
export function copyLinkItems(path: string, type: 'commit' | 'tag', name: string): MI[] {
  const remotes = linkableRemotes(path)
  if (!remotes.length) return []
  const act = (url: string) => () => copyLink(path, { type, name, pullUrl: url })
  if (remotes.length === 1) return [{ label: `Copy link to this ${type} on remote: ${remotes[0].name}`, act: act(remotes[0].fetchUrl) }]
  return [{ label: `Copy link to this ${type}`, sub: remotes.map((r) => ({ label: `on remote: ${r.name}`, act: act(r.fetchUrl) })) }]
}

/** "Copy link to branch: origin/main" for each remote branch of a label (a local branch stands for its upstream) */
export function copyBranchLinkItems(path: string, refs: Ref[]): MI[] {
  const s = A.snap(path)
  const remotes = new Map(linkableRemotes(path).map((r) => [r.name, r]))
  const targets = new Map<string, Ref>()
  for (const r of refs) {
    const remoteRef = r.type === 'remote' ? r : r.type === 'head' && r.upstream ? s.refs.find((x) => x.name === r.upstream) : undefined
    if (remoteRef?.remote && remotes.has(remoteRef.remote)) targets.set(remoteRef.name, remoteRef)
  }
  return [...targets.values()].sort((a, b) => a.remote!.toLowerCase().localeCompare(b.remote!.toLowerCase())).map((r) => ({
    label: `Copy link to branch: ${r.short}`,
    act: () => copyLink(path, { type: 'branch', name: r.short.slice(r.remote!.length + 1), pullUrl: remotes.get(r.remote!)!.fetchUrl })
  }))
}
