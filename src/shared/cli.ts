// Command line and supergit:// links, shared by the `supergit` launcher (bin/supergit.cmd runs
// out/main/cli.js with ELECTRON_RUN_AS_NODE), the main process and the renderer.
// Pure: no Node or Electron imports, so the renderer and the unit tests can use it too.

export const URI_SCHEME = 'supergit'

export interface CliRequest {
  help: boolean
  version: boolean
  /** absolute path of the repository (or a folder / file inside it) to open */
  path?: string
  /** a supergit:// link */
  uri?: string
}

/** options that take a value, by every spelling */
const VALUE_OPTS: Record<string, 'path' | 'uri' | 'encodedUri'> = {
  '-p': 'path', '--path': 'path',
  '-u': 'uri', '--uri': 'uri',
  '-e': 'encodedUri', '--encoded-uri': 'encodedUri'
}

/**
 * The arguments after the executable (and, in development, after the app script), like the
 * original's yargs grammar: `[target]`, -p/--path, -u/--uri, -e/--encoded-uri, -h/--help, -v/--version.
 * Unknown switches (Chromium's own, `--updated`…) are ignored. Relative paths resolve against `cwd`
 * with `resolve` (path.resolve in Node).
 */
export function parseCliArgs(args: string[], cwd: string, resolve: (cwd: string, p: string) => string): CliRequest {
  const req: CliRequest = { help: false, version: false }
  const vals: { path?: string; uri?: string; encodedUri?: string } = {}
  let target: string | undefined
  let rest = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a == null || a === '') continue
    if (rest || !a.startsWith('-') || a === '-') { if (target === undefined) target = a; continue }
    if (a === '--') { rest = true; continue }
    const eq = a.indexOf('=')
    const name = eq > 0 ? a.slice(0, eq) : a
    const key = VALUE_OPTS[name]
    if (key) {
      if (eq > 0) vals[key] = a.slice(eq + 1)
      else if (i + 1 < args.length) vals[key] = args[++i]
      continue
    }
    // "-pC:\repo" (short option glued to its value)
    if (/^-[pue]./.test(a) && !a.startsWith('--')) { vals[VALUE_OPTS[a.slice(0, 2)]] = a.slice(2); continue }
    if (name === '-h' || name === '--help') req.help = true
    else if (name === '-v' || name === '--version') req.version = true
  }
  const implicitUri = target && isSuperGitUri(target) ? target : undefined
  const implicitPath = target && !implicitUri ? target : undefined
  let encoded: string | undefined
  if (vals.encodedUri) { try { encoded = decodeURIComponent(vals.encodedUri) } catch { encoded = vals.encodedUri } }
  const uri = encoded || vals.uri || implicitUri
  if (uri) req.uri = uri
  // Windows hands `"C:\dir\"` over as `C:\dir"`: quotes are never part of a path
  const p = (vals.path || implicitPath || '').replace(/"/g, '').trim()
  if (p) req.path = resolve(cwd, p)
  return req
}

/** `supergit --help` (laid out like the original's yargs usage) */
export function helpText(): string {
  return [
    'supergit [target]',
    '',
    'Positionals:',
    '  target  Repository path or supergit:// URI to open.                   [string]',
    '',
    'Options:',
    '  -e, --encoded-uri  Encoded URI (scheme) handler; takes a supergit:// URI that',
    '                     has been URI-encoded. Overrides -p and -u.        [string]',
    '  -h, --help         Print this usage message.                        [boolean]',
    '  -p, --path         Open the repository specified by path.            [string]',
    '  -u, --uri          URI (scheme) handler; takes a supergit:// URI. Overrides',
    '                     -p. SuperGit URIs start with a directive, such as "repo".',
    '                     Example: supergit://repo/C:/Users/me/proj.        [string]',
    '  -v, --version      Print the version.                               [boolean]',
    ''
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// supergit:// links

export interface ParsedUri { cmd: string; path: string; params: URLSearchParams }

export function isSuperGitUri(s: string): boolean {
  return parseSuperGitUri(s) !== null
}

export function parseSuperGitUri(s: string): ParsedUri | null {
  if (!s || !/^supergit:/i.test(s)) return null
  try {
    const u = new URL(s)
    if (u.protocol.toLowerCase() !== `${URI_SCHEME}:`) return null
    return { cmd: u.host.toLowerCase(), path: u.pathname, params: u.searchParams }
  } catch { return null }
}

function safeDecode(s: string | undefined): string {
  if (!s) return ''
  try { return decodeURIComponent(s) } catch { return s }
}

/** `supergit://repo/<path>`: the path, decoded (on Windows the URL path's leading slash is dropped) */
export function repoUriPath(u: ParsedUri, windows = true): string | null {
  if (u.cmd !== 'repo' || !u.path || u.path === '/') return null
  const raw = windows ? u.path.replace(/^\//, '') : u.path
  return safeDecode(raw) || null
}

export type LinkType = 'commit' | 'branch' | 'tag' | 'remote'

export interface RepoLink {
  type: LinkType
  /** the repository's first (root) commit; identifies it whatever its folder or remote */
  firstCommitSha?: string
  /** the remote the link was made for */
  pullUrl: string
  /** commit sha, branch name (without the remote) or tag name; absent for a remote link */
  name?: string
}

/**
 * `supergit://repolink/<firstCommitSha>/<commit|branch|tag>/<name>?url=<remote pull url>`
 * (a remote link has no type: `supergit://repolink/<firstCommitSha>?url=…`; `-` stands for no sha).
 */
export function parseRepoLink(u: ParsedUri): RepoLink | null {
  if (u.cmd !== 'repolink') return null
  const parts = (u.path.startsWith('/') ? u.path.slice(1) : u.path).split('/')
  const sha = safeDecode(parts[0])
  const type = (parts[1] || 'remote') as LinkType
  const name = safeDecode(parts.slice(2).join('/'))
  const pullUrl = u.params.get('url') ?? ''
  if (!pullUrl) return null
  const base = { ...(sha && sha !== '-' ? { firstCommitSha: sha } : {}), pullUrl }
  switch (type) {
    case 'commit': case 'branch': case 'tag': return name ? { type, ...base, name } : null
    case 'remote': return { type, ...base }
    default: return null
  }
}

export function buildRepoLink(link: RepoLink): string {
  const sha = encodeURIComponent(link.firstCommitSha || '-')
  const tail = link.type === 'remote' ? '' : `/${link.type}/${encodeURIComponent(link.name ?? '')}`
  return `${URI_SCHEME}://repolink/${sha}${tail}?${new URLSearchParams({ url: stripPassword(link.pullUrl) }).toString()}`
}

export function buildRepoUri(path: string): string {
  return `${URI_SCHEME}://repo/${encodeURI(path.replace(/\\/g, '/'))}`
}

// ---------------------------------------------------------------------------------------------
// remote URLs

/** a password in an http(s) remote URL never goes into a link */
export function stripPassword(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/@:]*):[^/@]*@/i, '$1@')
}

/** links are made only for remotes other machines can reach (not local folders or file://) */
export function isLinkableRemoteUrl(url: string): boolean {
  if (!url) return false
  if (/^file:/i.test(url)) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return true
  // scp-like ssh: user@host:path or host:path (but not C:\path)
  return /^([^@/\\]+@)?[^/\\:]{2,}:[^\\]/.test(url)
}

/**
 * Compares remotes the way people think of them: https://github.com/o/r.git, git@github.com:o/r
 * and ssh://git@github.com/o/r all become "github.com/o/r".
 */
export function normalizeRemoteUrl(url: string): string {
  let u = stripPassword(url.trim()).replace(/\\/g, '/')
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(u)
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u) && !/^[a-z]:\//i.test(u)) u = `${scp[1]}/${scp[2]}`
  else u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '').replace(/^([^/:]+):\d+\//, '$1/')
  return u.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
}

/** "owner/repo" style name of the repository a remote URL points at */
export function repoNameFromRemoteUrl(url: string): string {
  const n = normalizeRemoteUrl(url).split('/')
  return n[n.length - 1] || ''
}

/** a name for a remote added from a link: the URL's owner, else "origin" (unique among `taken`) */
export function remoteNameForUrl(url: string, taken: string[]): string {
  const parts = normalizeRemoteUrl(url).split('/')
  const base = (parts.length >= 3 ? parts[parts.length - 2] : 'origin').replace(/[^\w.-]/g, '-') || 'origin'
  const lower = taken.map((t) => t.toLowerCase())
  if (!lower.includes(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!lower.includes(`${base}-${i}`.toLowerCase())) return `${base}-${i}`
}
