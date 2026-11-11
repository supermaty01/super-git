// Local-only power features: gitflow, LFS, patches, submodules, SSH/GPG keys, stats, external tools.
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { g, out, tryOut, net, identityEnv, getGitflowConfig, graphRevs } from './git'
import { GitError, parseLfsPatterns } from './gitcore'
import type { CommitStat, GitflowConfig, LfsInfo, OpResult, SshKey, GpgKey } from '../shared/types'

// ---------------------------------------------------------------------------------------------
// Commit details

/** additions / deletions / files per commit for the loaded graph (used by the "Changes" column). */
export async function getCommitStats(cwd: string, limit: number): Promise<Record<string, CommitStat>> {
  const r = await g(cwd, ['log', ...(await graphRevs(cwd)), '--date-order', `-n${limit}`, '--shortstat', '--format=%x1e%H'], { allowFail: true })
  const res: Record<string, CommitStat> = {}
  for (const chunk of r.stdout.split('\x1e')) {
    const [sha, ...rest] = chunk.trim().split('\n')
    if (!sha) continue
    const line = rest.join(' ')
    res[sha.trim()] = {
      files: Number(/(\d+) files? changed/.exec(line)?.[1] ?? 0),
      additions: Number(/(\d+) insertions?/.exec(line)?.[1] ?? 0),
      deletions: Number(/(\d+) deletions?/.exec(line)?.[1] ?? 0)
    }
  }
  return res
}

export async function getSignature(cwd: string, sha: string): Promise<{ status: string; signer: string; key: string } | null> {
  const r = await g(cwd, ['log', '-1', '--format=%G?%x1f%GS%x1f%GK', sha], { allowFail: true })
  if (r.code !== 0) return null
  const [status, signer, key] = r.stdout.trim().split('\x1f')
  if (!status || status === 'N') return null
  return { status, signer: signer ?? '', key: key ?? '' }
}

export async function getTreeFiles(cwd: string, sha: string): Promise<string[]> {
  return (await out(cwd, ['ls-tree', '-r', '--name-only', '-z', sha])).split('\0').filter(Boolean)
}

export async function listFiles(cwd: string): Promise<string[]> {
  return (await out(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean)
}

export async function readRepoFile(cwd: string, file: string): Promise<string> {
  try { return await fs.readFile(path.join(cwd, file), 'utf8') } catch { return '' }
}

export async function getCommitTemplate(cwd: string): Promise<string> {
  const t = (await tryOut(cwd, ['config', '--path', 'commit.template']))?.trim()
  if (!t) return ''
  const p = path.isAbsolute(t) ? t : path.join(cwd, t)
  try { return (await fs.readFile(p, 'utf8')).split('\n').filter((l) => !l.startsWith('#')).join('\n').trim() } catch { return '' }
}

// ---------------------------------------------------------------------------------------------
// Gitflow (implemented with plain git commands; no git-flow binary required)

const wrapOp = async (fn: () => Promise<unknown>): Promise<OpResult> => {
  try { await fn(); return { ok: true } } catch (e) {
    const msg = e instanceof GitError ? e.message : (e as Error).message
    return { ok: false, conflicts: /CONFLICT|conflict|Failed to merge in the changes|patch failed|could not apply/i.test(msg), error: msg }
  }
}

export async function gitflowInit(cwd: string, cfg: Omit<GitflowConfig, 'initialized'>): Promise<void> {
  const set = (k: string, v: string) => g(cwd, ['config', '--local', k, v])
  await set('gitflow.branch.master', cfg.master)
  await set('gitflow.branch.develop', cfg.develop)
  await set('gitflow.prefix.feature', cfg.feature)
  await set('gitflow.prefix.release', cfg.release)
  await set('gitflow.prefix.hotfix', cfg.hotfix)
  await set('gitflow.prefix.versiontag', cfg.versionTag)
  const hasDevelop = await tryOut(cwd, ['rev-parse', '-q', '--verify', `refs/heads/${cfg.develop}`])
  if (!hasDevelop?.trim()) {
    const hasMaster = await tryOut(cwd, ['rev-parse', '-q', '--verify', `refs/heads/${cfg.master}`])
    if (!hasMaster?.trim()) throw new Error(`Branch "${cfg.master}" does not exist. Create it (or pick an existing production branch) first.`)
    await g(cwd, ['branch', cfg.develop, cfg.master])
  }
}

export async function gitflowStart(cwd: string, type: 'feature' | 'release' | 'hotfix', name: string): Promise<string> {
  const cfg = await getGitflowConfig(cwd)
  const prefix = cfg[type]
  const base = type === 'hotfix' ? cfg.master : cfg.develop
  const branch = prefix + name
  await g(cwd, ['checkout', '-b', branch, base])
  return branch
}

export async function gitflowFinish(cwd: string, type: 'feature' | 'release' | 'hotfix', name: string, opts: { deleteBranch: boolean; tagMessage?: string }): Promise<OpResult> {
  const cfg = await getGitflowConfig(cwd)
  const branch = cfg[type] + name
  const env = { GIT_EDITOR: 'true', ...(await identityEnv(cwd)) }
  return wrapOp(async () => {
    if (type === 'feature') {
      await g(cwd, ['checkout', cfg.develop])
      await g(cwd, ['merge', '--no-ff', '--no-edit', branch], { env })
    } else {
      await g(cwd, ['checkout', cfg.master])
      await g(cwd, ['merge', '--no-ff', '--no-edit', branch], { env })
      const tag = cfg.versionTag + name
      await g(cwd, ['tag', '-a', tag, '-m', opts.tagMessage || `Release ${tag}`], { env })
      await g(cwd, ['checkout', cfg.develop])
      await g(cwd, ['merge', '--no-ff', '--no-edit', tag], { env })
    }
    if (opts.deleteBranch) await g(cwd, ['branch', '-d', branch])
  })
}

// ---------------------------------------------------------------------------------------------
// Git LFS

/**
 * Whether Git LFS is installed and which patterns this repository tracks. Strictly read-only: it
 * parses the .gitattributes files itself, because `git lfs track` (even just to list patterns)
 * installs four hooks and writes `lfs.repositoryformatversion` into the repository it runs in.
 */
export async function lfsInfo(cwd: string): Promise<LfsInfo> {
  const v = await g(cwd, ['lfs', 'version'], { allowFail: true })
  const patterns = await lfsPatterns(cwd)
  if (v.code !== 0) return { installed: false, enabled: false, patterns }
  const hooks = await tryOut(cwd, ['rev-parse', '--git-path', 'hooks/pre-push'])
  let enabled = false
  if (hooks) { try { enabled = (await fs.readFile(path.resolve(cwd, hooks.trim()), 'utf8')).includes('git lfs') } catch { enabled = false } }
  return { installed: true, enabled: enabled || patterns.length > 0, patterns }
}

/** `filter=lfs` patterns from every .gitattributes in the working tree (nested ones prefixed with their folder). */
async function lfsPatterns(cwd: string): Promise<string[]> {
  const ls = await g(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.gitattributes', '**/.gitattributes'], { allowFail: true })
  const files = ls.code === 0 ? [...new Set(ls.stdout.split('\0').filter(Boolean))].slice(0, 200) : ['.gitattributes']
  const found: string[] = []
  for (const rel of files) {
    let text: string
    try { text = await fs.readFile(path.join(cwd, rel), 'utf8') } catch { continue }
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : ''
    found.push(...parseLfsPatterns(text).map((pat) => dir + pat))
  }
  return [...new Set(found)]
}

export async function lfsInstall(cwd: string): Promise<void> { await g(cwd, ['lfs', 'install', '--local']) }
export async function lfsTrack(cwd: string, pattern: string): Promise<void> { await g(cwd, ['lfs', 'track', pattern]) }
export async function lfsUntrack(cwd: string, pattern: string): Promise<void> { await g(cwd, ['lfs', 'untrack', pattern]) }
export async function lfsCommand(cwd: string, cmd: 'pull' | 'fetch' | 'prune' | 'checkout' | 'push'): Promise<void> {
  if (cmd === 'push') {
    const remote = ((await tryOut(cwd, ['remote'])) ?? '').trim().split(String.fromCharCode(10))[0]?.trim() || 'origin'
    await net(cwd, 'lfs', ['lfs', 'push', '--all', remote])
  } else if (cmd === 'fetch') await net(cwd, 'lfs', ['lfs', 'fetch', '--all'])
  else await net(cwd, 'lfs', ['lfs', cmd])
}

// ---------------------------------------------------------------------------------------------
// Patches

export async function createPatch(cwd: string, shasOldestFirst: string[], outFile: string): Promise<void> {
  const parts: string[] = []
  for (const sha of shasOldestFirst) parts.push(await out(cwd, ['format-patch', '-1', '--stdout', sha]))
  await fs.writeFile(outFile, parts.join(''), 'utf8')
}

export async function applyPatch(cwd: string, file: string, asCommits: boolean): Promise<OpResult> {
  const env = { GIT_EDITOR: 'true', ...(await identityEnv(cwd)) }
  if (asCommits) return wrapOp(() => g(cwd, ['am', '-3', file], { env }))
  return wrapOp(() => g(cwd, ['apply', '--3way', '--whitespace=nowarn', file]))
}

// ---------------------------------------------------------------------------------------------
// Submodules

export async function submoduleUpdate(cwd: string, sub?: string): Promise<void> {
  await net(cwd, 'submodule', ['submodule', 'update', '--init', '--recursive', ...(sub ? ['--', sub] : [])])
}
export async function submoduleAdd(cwd: string, url: string, subPath: string): Promise<void> {
  await net(cwd, 'submodule', ['submodule', 'add', '--progress', url, subPath])
}
export async function submoduleSync(cwd: string): Promise<void> { await g(cwd, ['submodule', 'sync', '--recursive']) }

// ---------------------------------------------------------------------------------------------
// External tools

function runDetached(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', reject)
    child.on('spawn', () => { child.unref(); resolve() })
  })
}

export async function openInEditor(cwd: string, file: string | null, editor: string): Promise<void> {
  const target = file ? `"${path.join(cwd, file)}"` : `"${cwd}"`
  await runDetached(`${editor || 'code'} ${target}`, cwd)
}

/** Launches the user's configured git mergetool / difftool (e.g. VS Code, Beyond Compare, KDiff3). */
export async function externalMergeTool(cwd: string, file: string): Promise<OpResult> {
  return wrapOp(() => g(cwd, ['mergetool', '--no-prompt', '--', file]))
}
export async function externalDiffTool(cwd: string, file: string, staged: boolean, from?: string, to?: string): Promise<void> {
  const args = ['difftool', '--no-prompt', ...(staged ? ['--cached'] : []), ...(from ? [from] : []), ...(to ? [to] : []), '--', file]
  void g(cwd, args, { allowFail: true })
}

// ---------------------------------------------------------------------------------------------
// SSH / GPG

export async function listSshKeys(): Promise<SshKey[]> {
  const dir = path.join(os.homedir(), '.ssh')
  if (!existsSync(dir)) return []
  const list: SshKey[] = []
  for (const f of await fs.readdir(dir)) {
    if (!f.endsWith('.pub')) continue
    const pub = (await fs.readFile(path.join(dir, f), 'utf8')).trim()
    const [type, , ...comment] = pub.split(/\s+/)
    list.push({ file: path.join(dir, f), publicKey: pub, type, comment: comment.join(' ') })
  }
  return list
}

export async function generateSshKey(email: string, name: string): Promise<SshKey> {
  const dir = path.join(os.homedir(), '.ssh')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, name || 'id_ed25519')
  if (existsSync(file)) throw new Error(`${file} already exists`)
  await new Promise<void>((resolve, reject) => {
    const p = spawn('ssh-keygen', ['-t', 'ed25519', '-C', email, '-f', file, '-N', ''], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `ssh-keygen exited with ${code}`))))
  })
  const pub = (await fs.readFile(file + '.pub', 'utf8')).trim()
  return { file: file + '.pub', publicKey: pub, type: 'ssh-ed25519', comment: email }
}

export async function listGpgKeys(): Promise<GpgKey[]> {
  return new Promise((resolve) => {
    const p = spawn('gpg', ['--list-secret-keys', '--keyid-format=long', '--with-colons'], { windowsHide: true })
    let txt = ''
    p.stdout.on('data', (d) => { txt += d })
    p.on('error', () => resolve([]))
    p.on('close', () => {
      const keys: GpgKey[] = []
      let cur: GpgKey | null = null
      for (const l of txt.split('\n')) {
        const f = l.split(':')
        if (f[0] === 'sec') { cur = { id: f[4], uid: '' }; keys.push(cur) }
        else if (f[0] === 'uid' && cur && !cur.uid) cur.uid = f[9]
      }
      resolve(keys)
    })
  })
}
