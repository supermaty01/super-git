// Hosting service integrations (GitHub, GitLab, Bitbucket, Azure DevOps and their self-hosted editions).
//
// "Connect" uses Git Credential Manager (bundled with Git for Windows): asking git for a credential makes
// GCM run its own browser sign-in (OAuth) and store the token in Windows Credential Manager. The same
// credential is then used by git for clone / fetch / push and by SuperGit to list repositories.
// No SuperGit server is involved. A personal access token can be used instead.
import os from 'node:os'
import { runGit } from './gitcore'
import { getSettings, updateSettings, saveProviderToken, readProviderToken, clearProviderToken } from './settings'
import * as ado from './ado'
import type { ProviderId, ProviderAccount, ProviderConnectOptions, HostedRepo } from '../shared/types'

interface Cred { username: string; password: string; raw: string }

const DEFAULT_HOST: Partial<Record<ProviderId, string>> = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  github: 'GitHub', 'github-enterprise': 'GitHub Enterprise', gitlab: 'GitLab', 'gitlab-self': 'GitLab Self-Managed',
  bitbucket: 'Bitbucket', 'bitbucket-server': 'Bitbucket Data Center', azure: 'Azure DevOps'
}

function cleanHost(input: string): string {
  return input.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

/** host (+ optional path for Azure DevOps orgs) used to ask git for the credential */
function credTarget(p: ProviderId, host: string): { host: string; path?: string } {
  if (p === 'azure') {
    const u = new URL(ado.normalizeOrgUrl(host))
    if (u.host === 'dev.azure.com') return { host: u.host, path: u.pathname.replace(/^\/+/, '').split('/')[0] }
    return { host: u.host }
  }
  const h = cleanHost(host)
  return { host: h.split('/')[0], path: h.includes('/') ? h.slice(h.indexOf('/') + 1) : undefined }
}

function credInput(t: { host: string; path?: string }, extra: Record<string, string> = {}): string {
  const lines = ['protocol=https', `host=${t.host}`]
  if (t.path) lines.push(`path=${t.path}`)
  for (const [k, v] of Object.entries(extra)) lines.push(`${k}=${v}`)
  return lines.join('\n') + '\n\n'
}

function parseCred(out: string): Cred | null {
  const m = new Map<string, string>()
  for (const l of out.split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) m.set(l.slice(0, i), l.slice(i + 1)) }
  const password = m.get('password')
  if (!password) return null
  return { username: m.get('username') ?? '', password, raw: out.endsWith('\n\n') ? out : out.replace(/\n*$/, '\n\n') }
}

/** asks git's credential helper (GCM) for a credential; interactive lets GCM show its sign-in window */
async function credentialFill(t: { host: string; path?: string }, interactive: boolean): Promise<Cred | null> {
  const env: Record<string, string> = interactive ? {} : { GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' }
  const r = await runGit(['credential', 'fill'], { cwd: os.homedir(), input: credInput(t), env, allowFail: true })
  return r.code === 0 ? parseCred(r.stdout) : null
}

async function credentialApprove(raw: string): Promise<void> {
  await runGit(['credential', 'approve'], { cwd: os.homedir(), input: raw, allowFail: true })
}

async function credentialReject(t: { host: string; path?: string }, username?: string): Promise<void> {
  await runGit(['credential', 'reject'], { cwd: os.homedir(), input: credInput(t, username ? { username } : {}), allowFail: true })
}

// ---------------------------------------------------------------------------------------------
// HTTP

class HttpError extends Error { constructor(msg: string, public status: number) { super(msg) } }

async function request<T>(url: string, auth: string, accept = 'application/json'): Promise<{ data: T; next?: string }> {
  const res = await fetch(url, { headers: { Authorization: auth, Accept: accept, 'User-Agent': 'SuperGit' }, signal: AbortSignal.timeout(20000) })
  if (res.status === 401) throw new HttpError('The service rejected the credentials (401 Unauthorized).', 401)
  if (res.status === 403) throw new HttpError('The token does not have permission for this request (403 Forbidden).', 403)
  if (!res.ok) throw new HttpError(`Request failed: ${res.status} ${res.statusText}`, res.status)
  const link = res.headers.get('link')
  const next = link?.split(',').map((s) => /<([^>]+)>;\s*rel="next"/.exec(s)?.[1]).find(Boolean)
  const text = await res.text()
  try { return { data: (accept === 'application/json' ? JSON.parse(text) : text) as T, next } } catch { throw new Error(`Unexpected response from ${new URL(url).host}`) }
}

const bearer = (token: string) => `Bearer ${token}`
const basic = (user: string, pass: string) => 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')

/** Bearer first; Bitbucket API tokens / app passwords and some servers need Basic */
async function authed<T>(url: string, c: Cred, accept?: string): Promise<{ data: T; next?: string }> {
  try { return await request<T>(url, bearer(c.password), accept) } catch (e) {
    if (e instanceof HttpError && e.status === 401 && c.username) return request<T>(url, basic(c.username, c.password), accept)
    throw e
  }
}

function apiBase(p: ProviderId, host: string): string {
  const h = cleanHost(host)
  switch (p) {
    case 'github': return 'https://api.github.com'
    case 'github-enterprise': return `https://${h}/api/v3`
    case 'gitlab': return 'https://gitlab.com/api/v4'
    case 'gitlab-self': return `https://${h}/api/v4`
    case 'bitbucket': return 'https://api.bitbucket.org/2.0'
    case 'bitbucket-server': return `https://${h}/rest/api/1.0`
    default: return ''
  }
}

// ---------------------------------------------------------------------------------------------
// account identity

/** the UI only loads local images, so the avatar is stored as a small data URL */
async function avatarData(url: string | undefined, c: Cred): Promise<string | undefined> {
  if (!url) return undefined
  try {
    const u = new URL(url)
    if (u.host.endsWith('githubusercontent.com')) u.searchParams.set('s', '80')
    let res = await fetch(u, { signal: AbortSignal.timeout(8000) })
    if (res.status === 401 || res.status === 403) res = await fetch(u, { headers: { Authorization: bearer(c.password) }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return undefined
    const type = res.headers.get('content-type') ?? 'image/png'
    const buf = Buffer.from(await res.arrayBuffer())
    if (!type.startsWith('image/') || buf.length > 200_000) return undefined
    return `data:${type};base64,${buf.toString('base64')}`
  } catch { return undefined }
}

async function whoAmI(p: ProviderId, host: string, c: Cred): Promise<Pick<ProviderAccount, 'username' | 'displayName' | 'avatarUrl'>> {
  const base = apiBase(p, host)
  switch (p) {
    case 'github': case 'github-enterprise': {
      const { data } = await authed<{ login: string; name?: string; avatar_url?: string }>(`${base}/user`, c)
      return { username: data.login, displayName: data.name || data.login, avatarUrl: data.avatar_url }
    }
    case 'gitlab': case 'gitlab-self': {
      const { data } = await authed<{ username: string; name?: string; avatar_url?: string }>(`${base}/user`, c)
      return { username: data.username, displayName: data.name || data.username, avatarUrl: data.avatar_url }
    }
    case 'bitbucket': {
      const { data } = await authed<{ username?: string; nickname?: string; display_name?: string; links?: { avatar?: { href?: string } } }>(`${base}/user`, c)
      const u = data.username || data.nickname || c.username
      return { username: u, displayName: data.display_name || u, avatarUrl: data.links?.avatar?.href }
    }
    case 'bitbucket-server': {
      const { data } = await authed<string>(`https://${cleanHost(host)}/plugins/servlet/applinks/whoami`, c, 'text/plain')
      const u = data.trim() || c.username
      if (!u) throw new Error('Bitbucket did not accept the credentials.')
      return { username: u, displayName: u }
    }
    case 'azure': {
      const name = await ado.verifyConnection(ado.normalizeOrgUrl(host), c.password)
      return { username: name, displayName: name }
    }
  }
}

/** the credential for a connected provider: our stored token, or GCM's (refreshed silently) */
async function credFor(p: ProviderId): Promise<{ acc: ProviderAccount; cred: Cred }> {
  const acc = getSettings().integrations[p]
  if (!acc) throw new Error(`${PROVIDER_NAMES[p]} is not connected. Connect it in Preferences → Integrations.`)
  if (acc.method === 'token') {
    const token = readProviderToken(p)
    if (!token) throw new Error(`The ${PROVIDER_NAMES[p]} token is missing. Reconnect in Preferences → Integrations.`)
    return { acc, cred: { username: acc.username, password: token, raw: '' } }
  }
  const cred = await credentialFill(credTarget(p, acc.host), false)
  if (!cred) throw new Error(`Git Credential Manager has no ${PROVIDER_NAMES[p]} sign-in stored anymore. Reconnect in Preferences → Integrations.`)
  return { acc, cred }
}

// ---------------------------------------------------------------------------------------------
// connect / disconnect

export async function connect(p: ProviderId, o: ProviderConnectOptions): Promise<ProviderAccount> {
  const host = p === 'azure' ? ado.normalizeOrgUrl(o.host ?? '') : cleanHost(o.host || DEFAULT_HOST[p] || '')
  if (!host || (p === 'azure' && !/^https:\/\/[^/]+(\/[^/]+)?$/.test(host))) throw new Error(p === 'azure' ? 'Enter your Azure DevOps organization first.' : 'Enter the server address first.')
  const target = credTarget(p, host)
  let cred: Cred
  if (o.method === 'oauth') {
    const c = await credentialFill(target, true)
    if (!c) throw new Error('Sign-in was cancelled or Git Credential Manager is not available (it ships with Git for Windows).')
    cred = c
  } else {
    if (!o.token?.trim()) throw new Error('Paste a personal access token first.')
    cred = { username: o.username?.trim() ?? '', password: o.token.trim(), raw: '' }
  }
  let who: Pick<ProviderAccount, 'username' | 'displayName' | 'avatarUrl'>
  try { who = await whoAmI(p, host, cred) } catch (e) {
    // some browser sign-ins (GitLab) only grant git access: fall back to the git user name
    if (!(o.method === 'oauth' && e instanceof HttpError && e.status === 403 && cred.username)) throw e
    who = { username: cred.username, displayName: cred.username }
  }
  const acc: ProviderAccount = { provider: p, host, ...who, avatarUrl: await avatarData(who.avatarUrl, cred), method: o.method, connectedAt: Date.now() }
  if (o.method === 'oauth') await credentialApprove(cred.raw)
  else {
    await saveProviderToken(p, cred.password)
    // let git use the token for this host too (Azure DevOps gets it as an http header instead)
    if (p !== 'azure') {
      const user = p === 'bitbucket' && o.username?.includes('@') ? 'x-bitbucket-api-token-auth' : (cred.username || who.username)
      await credentialApprove(credInput(target, { username: user, password: cred.password }))
    }
  }
  // check up front whether the account can browse repositories
  try { await listWith(p, acc, cred, 1) } catch (e) { acc.browseError = (e as Error).message }
  const integrations = { ...getSettings().integrations, [p]: acc }
  updateSettings(p === 'azure' ? { integrations, azure: { orgUrl: host, hasToken: o.method === 'token', userName: who.username } } : { integrations })
  return acc
}

export async function disconnect(p: ProviderId): Promise<void> {
  const acc = getSettings().integrations[p]
  if (acc?.method === 'token') {
    await clearProviderToken(p)
    // remove the token we handed to git; browser sign-ins stay in Credential Manager for git to keep using
    if (p !== 'azure') await credentialReject(credTarget(p, acc.host))
  }
  const integrations = { ...getSettings().integrations }
  delete integrations[p]
  updateSettings(p === 'azure' ? { integrations, azure: { orgUrl: getSettings().azure.orgUrl, hasToken: false, userName: undefined } } : { integrations })
}

/** git config pairs for network operations: Azure DevOps personal access tokens travel as an http header */
export function gitAuthConfig(): Array<[string, string]> {
  const acc = getSettings().integrations.azure
  if (acc?.method !== 'token') return []
  const token = readProviderToken('azure')
  return token ? ado.gitAuthConfigFor(acc.host, token) : []
}

// ---------------------------------------------------------------------------------------------
// repositories

const stripUser = (u: string) => u.replace(/^(https?:\/\/)[^@/]+@/, '$1')
const time = (s?: string) => (s ? Date.parse(s) || undefined : undefined)

async function listWith(p: ProviderId, acc: ProviderAccount, c: Cred, maxPages = 10): Promise<HostedRepo[]> {
  const base = apiBase(p, acc.host)
  const out: HostedRepo[] = []
  const pages = async <T>(first: string, each: (d: T) => { items: HostedRepo[]; next?: string }) => {
    let url: string | undefined = first
    for (let i = 0; url && i < maxPages; i++) {
      const r: { data: T; next?: string } = await authed<T>(url, c)
      const { items, next } = each(r.data)
      out.push(...items)
      url = next ?? r.next
    }
  }
  switch (p) {
    case 'github': case 'github-enterprise': {
      type R = { id: number; name: string; full_name: string; owner: { login: string }; clone_url: string; ssh_url: string; html_url: string; private: boolean; default_branch?: string; pushed_at?: string; description?: string }
      await pages<R[]>(`${base}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member`, (d) => ({
        items: d.map((r) => ({ id: String(r.id), name: r.name, fullName: r.full_name, group: r.owner.login, cloneUrl: r.clone_url, sshUrl: r.ssh_url, webUrl: r.html_url, isPrivate: r.private, defaultBranch: r.default_branch, updatedAt: time(r.pushed_at), description: r.description ?? undefined }))
      }))
      break
    }
    case 'gitlab': case 'gitlab-self': {
      type R = { id: number; name: string; path_with_namespace: string; namespace: { full_path: string }; http_url_to_repo: string; ssh_url_to_repo: string; web_url: string; visibility?: string; default_branch?: string; last_activity_at?: string; description?: string }
      await pages<R[]>(`${base}/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at`, (d) => ({
        items: d.map((r) => ({ id: String(r.id), name: r.name, fullName: r.path_with_namespace, group: r.namespace.full_path, cloneUrl: r.http_url_to_repo, sshUrl: r.ssh_url_to_repo, webUrl: r.web_url, isPrivate: r.visibility !== 'public', defaultBranch: r.default_branch, updatedAt: time(r.last_activity_at), description: r.description || undefined }))
      }))
      break
    }
    case 'bitbucket': {
      type R = { values: Array<{ uuid: string; name: string; full_name: string; workspace?: { slug: string }; is_private: boolean; mainbranch?: { name: string }; updated_on?: string; description?: string; links: { clone: Array<{ name: string; href: string }>; html: { href: string } } }>; next?: string }
      await pages<R>(`${base}/repositories?role=member&pagelen=100&sort=-updated_on`, (d) => ({
        next: d.next,
        items: d.values.map((r) => ({ id: r.uuid, name: r.name, fullName: r.full_name, group: r.workspace?.slug ?? r.full_name.split('/')[0], cloneUrl: stripUser(r.links.clone.find((l) => l.name === 'https')?.href ?? ''), sshUrl: r.links.clone.find((l) => l.name === 'ssh')?.href, webUrl: r.links.html.href, isPrivate: r.is_private, defaultBranch: r.mainbranch?.name, updatedAt: time(r.updated_on), description: r.description || undefined }))
      }))
      break
    }
    case 'bitbucket-server': {
      type R = { values: Array<{ id: number; slug: string; name: string; project: { key: string; name: string }; public?: boolean; links: { clone: Array<{ name: string; href: string }>; self: Array<{ href: string }> } }>; isLastPage: boolean; nextPageStart?: number }
      await pages<R>(`${base}/repos?limit=100`, (d) => ({
        next: d.isLastPage ? undefined : `${base}/repos?limit=100&start=${d.nextPageStart}`,
        items: d.values.map((r) => ({ id: String(r.id), name: r.name, fullName: `${r.project.key}/${r.slug}`, group: r.project.name, cloneUrl: stripUser(r.links.clone.find((l) => l.name === 'http')?.href ?? ''), sshUrl: r.links.clone.find((l) => l.name === 'ssh')?.href, webUrl: r.links.self[0]?.href ?? '', isPrivate: !r.public }))
      }))
      break
    }
    case 'azure': {
      const repos = await ado.listRepos(ado.normalizeOrgUrl(acc.host), c.password)
      out.push(...repos.map((r) => ({ id: r.id, name: r.name, fullName: `${r.project}/${r.name}`, group: r.project, cloneUrl: r.remoteUrl, webUrl: r.webUrl, isPrivate: true, defaultBranch: r.defaultBranch })))
      break
    }
  }
  return out
}

export async function listRepos(p: ProviderId): Promise<HostedRepo[]> {
  const { acc, cred } = await credFor(p)
  try {
    const repos = await listWith(p, acc, cred)
    if (acc.browseError) updateSettings({ integrations: { ...getSettings().integrations, [p]: { ...acc, browseError: undefined } } })
    return repos
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 401) && acc.method === 'oauth' && (p === 'gitlab' || p === 'gitlab-self')) {
      throw new Error('This GitLab sign-in only grants git access, so it cannot list projects. Connect with a personal access token that has the read_api scope to browse repositories (git operations keep working either way).')
    }
    throw e
  }
}
