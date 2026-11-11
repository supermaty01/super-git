// Azure DevOps REST helpers. Works with personal access tokens (Basic auth) and with the Microsoft Entra
// access tokens that Git Credential Manager returns after a browser sign-in (Bearer auth).
import type { AdoRepo } from '../shared/types'

const API = 'api-version=7.1'

export function normalizeOrgUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) {
    // bare org name
    if (/^[\w.-]+$/.test(u)) u = `https://dev.azure.com/${u}`
    else u = `https://${u}`
  }
  return u.replace(/^http:/i, 'https:')
}

/** Entra ID access tokens are JWTs; anything else is a PAT */
function authHeader(token: string): string {
  return token.startsWith('eyJ') ? `Bearer ${token}` : 'Basic ' + Buffer.from(':' + token, 'utf8').toString('base64')
}

async function adoGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: authHeader(token), Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20000) })
  if (res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') throw new Error('Azure DevOps rejected the credentials (unauthorized). A personal access token needs the Code (Read) scope.')
  if (!res.ok) throw new Error(`Azure DevOps request failed: ${res.status} ${res.statusText}`)
  const text = await res.text()
  try { return JSON.parse(text) as T } catch { throw new Error('Unexpected response from Azure DevOps (is the organization URL correct?)') }
}

export async function verifyConnection(orgUrl: string, token: string): Promise<string> {
  // An authenticated endpoint: invalid tokens yield 401/203 here (connectionData would answer "Anonymous").
  await adoGet<unknown>(`${orgUrl}/_apis/git/repositories?${API}&$top=1`, token)
  const data = await adoGet<{ authenticatedUser?: { providerDisplayName?: string; customDisplayName?: string } }>(
    `${orgUrl}/_apis/connectionData?${API}-preview`, token)
  const name = data.authenticatedUser?.customDisplayName || data.authenticatedUser?.providerDisplayName || ''
  if (!name || /^anonymous$/i.test(name)) throw new Error('Azure DevOps did not accept the credentials for this organization.')
  return name
}

export async function listRepos(orgUrl: string, token: string): Promise<AdoRepo[]> {
  const data = await adoGet<{ value: Array<{ id: string; name: string; project: { name: string }; remoteUrl: string; webUrl: string; defaultBranch?: string; size?: number; isDisabled?: boolean }> }>(
    `${orgUrl}/_apis/git/repositories?${API}`, token)
  return data.value
    .filter((r) => !r.isDisabled)
    .map((r) => ({
      id: r.id, name: r.name, project: r.project.name, remoteUrl: r.remoteUrl.replace(/^(https:\/\/)[^@/]+@/, '$1'), webUrl: r.webUrl,
      defaultBranch: r.defaultBranch?.replace(/^refs\/heads\//, ''), size: r.size
    }))
    .sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name))
}

/** git config pairs injected (via env, not argv) into network operations when a PAT is used */
export function gitAuthConfigFor(orgUrl: string, token: string): Array<[string, string]> {
  const header = `AUTHORIZATION: ${authHeader(token)}`
  const pairs: Array<[string, string]> = [['http.https://dev.azure.com/.extraheader', header]]
  try {
    const host = new URL(orgUrl).host
    if (host.endsWith('visualstudio.com')) pairs.push([`http.https://${host}/.extraheader`, header])
  } catch { /* ignore */ }
  return pairs
}
