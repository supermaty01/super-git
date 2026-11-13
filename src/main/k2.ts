// Branch cleanup, proactive conflict detection, credentials and host keys, gitflow finish options and worktree extras.
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { g, out, tryOut, identityEnv, getGitflowConfig, deleteBranch } from './git'
import { runGit, GitError, parseWorktrees } from './gitcore'
import { getSettings } from './settings'
import { pickConflictTarget, parseMergeTree, conflictRanges, matchesRules } from '../shared/k2logic'
import type { CleanupBranch, ConflictCheck, K2Api } from '../shared/k2'
import type { OpResult } from '../shared/types'

const HEADS = 'refs/heads/'
const REMOTES = 'refs/remotes/'

// ---------------------------------------------------------------------------------------------
// Clean Up Local Branches

/** the repository's main line: origin/HEAD's target, else main / master / trunk / develop when they exist */
async function mainLines(cwd: string): Promise<string[]> {
  const res: string[] = []
  const originHead = (await tryOut(cwd, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']))?.trim()
  if (originHead) res.push(originHead)
  for (const n of ['main', 'master', 'trunk', 'develop']) {
    if ((await tryOut(cwd, ['rev-parse', '-q', '--verify', `${HEADS}${n}`]))?.trim()) res.push(HEADS + n)
  }
  return res
}

export async function branchCleanupInfo(cwd: string): Promise<CleanupBranch[]> {
  const fmt = ['%(refname)', '%(objectname)', '%(committerdate:unix)', '%(upstream)', '%(HEAD)'].join('%00')
  const [refsOut, remotesOut, wtOut] = await Promise.all([
    out(cwd, ['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes']),
    tryOut(cwd, ['remote']),
    tryOut(cwd, ['worktree', 'list', '--porcelain'])
  ])
  const remotes = (remotesOut ?? '').split(/\r?\n/).map((r) => r.trim()).filter(Boolean).sort((a, b) => b.length - a.length)
  const inWorktree = new Set((wtOut ? parseWorktrees(wtOut, cwd) : []).filter((w) => !w.isCurrent).map((w) => w.branch).filter(Boolean) as string[])
  const existing = new Set<string>()
  const rows: Array<{ ref: string; sha: string; date: number; upstream: string; head: boolean }> = []
  for (const line of refsOut.split('\n')) {
    const [ref, sha, date, upstream, head] = line.split('\0')
    if (!ref) continue
    existing.add(ref)
    if (ref.startsWith(HEADS)) rows.push({ ref, sha, date: Number(date) * 1000, upstream: upstream ?? '', head: head === '*' })
  }
  // merged: contained in HEAD or in the main line
  const merged = new Set<string>()
  for (const target of ['HEAD', ...await mainLines(cwd)]) {
    const r = await tryOut(cwd, ['for-each-ref', `--merged=${target}`, '--format=%(refname)', 'refs/heads'])
    for (const l of (r ?? '').split('\n')) if (l.trim()) merged.add(l.trim())
  }
  return rows.filter((r) => !r.head && !inWorktree.has(r.ref.slice(HEADS.length))).map((r) => {
    let upstream: CleanupBranch['upstream'] = null
    if (r.upstream && existing.has(r.upstream)) {
      if (r.upstream.startsWith(HEADS)) upstream = { type: 'local' }
      else if (r.upstream.startsWith(REMOTES)) {
        const short = r.upstream.slice(REMOTES.length)
        const remote = remotes.find((x) => short.startsWith(x + '/'))
        if (remote) upstream = { type: 'remote', remoteName: remote, branchName: short.slice(remote.length + 1) }
      }
    }
    return { name: r.ref.slice(HEADS.length), fullName: r.ref, sha: r.sha, lastCommitDate: r.date, upstream, merged: merged.has(r.ref) }
  })
}

// ---------------------------------------------------------------------------------------------
// Conflict Prevention: compare the current branch with its base branch (git merge-tree, nothing is touched)

export async function conflictCheck(cwd: string, rules: string[]): Promise<ConflictCheck | null> {
  const branch = (await tryOut(cwd, ['symbolic-ref', '-q', '--short', 'HEAD']))?.trim()
  if (!branch) return null
  const upstream = (await tryOut(cwd, ['for-each-ref', '--format=%(upstream:short)', `${HEADS}${branch}`]))?.trim() ?? ''
  // ahead / behind of every branch relative to HEAD in one call (git 2.41+), else one rev-list per branch
  let rows: Array<{ name: string; remote: boolean; ahead: number; behind: number; sha: string }> = []
  const ab = await g(cwd, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(ahead-behind:HEAD)', 'refs/heads', 'refs/remotes'], { allowFail: true })
  const parse = (ref: string) => ({ name: ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref.slice(REMOTES.length), remote: ref.startsWith(REMOTES) })
  if (ab.code === 0) {
    for (const l of ab.stdout.split('\n')) {
      const [ref, sha, counts] = l.split('\0')
      if (!ref || !counts) continue
      const [ahead, behind] = counts.trim().split(/\s+/).map(Number)
      rows.push({ ...parse(ref), sha, ahead, behind })
    }
  } else {
    const refs = (await out(cwd, ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads', 'refs/remotes'])).split('\n').filter(Boolean)
    for (const l of refs.slice(0, 200)) {
      const [ref, sha] = l.split('\0')
      const c = (await tryOut(cwd, ['rev-list', '--left-right', '--count', `${ref}...HEAD`]))?.trim().split(/\s+/).map(Number)
      if (c?.length === 2) rows.push({ ...parse(ref), sha, ahead: c[0], behind: c[1] })
    }
  }
  rows = rows.filter((r) => !r.name.endsWith('/HEAD') && matchesRules(r.name, rules, r.remote))
  const target = pickConflictTarget(rows, branch, upstream)
  if (!target) return null
  const targetRef = target.remote ? `${REMOTES}${target.name}` : `${HEADS}${target.name}`
  const r = await g(cwd, ['merge-tree', '--write-tree', '--no-messages', 'HEAD', targetRef], { allowFail: true })
  if (r.code !== 0 && r.code !== 1) return null // git older than 2.38, unrelated histories...
  const { tree, files } = parseMergeTree(r.stdout)
  const res: ConflictCheck = { branch, target: target.name, targetSha: target.sha, files: [], time: Date.now() }
  for (const f of files) {
    const text = tree ? await tryOut(cwd, ['cat-file', '-p', `${tree}:${f}`]) : null
    res.files.push({ path: f, lines: text ? conflictRanges(text) : [] })
  }
  return res
}

// ---------------------------------------------------------------------------------------------
// Credentials and host keys

/** https remotes of the repositories SuperGit knows (open tabs, recent, favorites) */
async function knownHosts(): Promise<Array<{ protocol: string; host: string }>> {
  const s = getSettings()
  const repos = new Set<string>([...s.tabs.map((t) => t.path), ...s.recent.map((r) => r.path), ...s.favorites].filter(Boolean))
  const hosts = new Map<string, { protocol: string; host: string }>()
  for (const repo of repos) {
    if (!existsSync(repo)) continue
    const r = await tryOut(repo, ['config', '--get-regexp', '^remote\\..*\\.(url|pushurl)$'])
    for (const l of (r ?? '').split('\n')) {
      const url = l.split(' ').slice(1).join(' ').trim()
      const m = /^(https?):\/\/(?:[^@/]+@)?([^/]+)/i.exec(url)
      if (m) hosts.set(`${m[1].toLowerCase()}://${m[2].toLowerCase()}`, { protocol: m[1].toLowerCase(), host: m[2].toLowerCase() })
    }
  }
  return [...hosts.values()]
}

const credInput = (h: { protocol: string; host: string }) => `protocol=${h.protocol}\nhost=${h.host}\n\n`
const quietEnv = { GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' }

export async function forgetCredentials(): Promise<number> {
  let n = 0
  for (const h of await knownHosts()) {
    // only what is stored: a non-interactive fill fails when there is nothing
    const fill = await runGit(['credential', 'fill'], { cwd: os.homedir(), input: credInput(h), env: quietEnv, allowFail: true })
    if (fill.code !== 0 || !/^password=/m.test(fill.stdout)) continue
    await runGit(['credential', 'reject'], { cwd: os.homedir(), input: fill.stdout.trim() + '\n\n', env: quietEnv, allowFail: true })
    n++
  }
  return n
}

export function sshForgetHost(host: string): Promise<void> {
  const h = host.trim()
  if (!/^[\w.:[\]-]+$/.test(h)) return Promise.reject(new Error(`Invalid host: ${host}`))
  const knownHostsFile = path.join(os.homedir(), '.ssh', 'known_hosts')
  return new Promise((resolve, reject) => {
    execFile('ssh-keygen', ['-R', h, '-f', knownHostsFile], { windowsHide: true }, (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()))
  })
}

// ---------------------------------------------------------------------------------------------
// Gitflow: the original's finish options (rebase on develop, delete branch, tag message) and start points

const wrapOp = async (fn: () => Promise<unknown>): Promise<OpResult> => {
  try { await fn(); return { ok: true } } catch (e) {
    const msg = e instanceof GitError ? e.message : (e as Error).message
    return { ok: false, conflicts: /CONFLICT \(|Failed to merge in the changes|patch failed|could not apply|Resolve all conflicts/.test(msg), error: msg }
  }
}
const exists = async (cwd: string, ref: string) => !!(await tryOut(cwd, ['rev-parse', '-q', '--verify', ref]))?.trim()

export async function gitflowStart2(cwd: string, type: 'feature' | 'release' | 'hotfix', name: string, fromHead: boolean): Promise<string> {
  const cfg = await getGitflowConfig(cwd)
  const base = type === 'hotfix' ? cfg.master : cfg.develop
  if (!fromHead && !(await exists(cwd, `${HEADS}${base}`))) throw new Error(`${base} branch is required to start ${type}`)
  const branch = cfg[type] + name
  await g(cwd, ['checkout', '-b', branch, ...(fromHead ? [] : [base])])
  return branch
}

export async function gitflowFinish2(cwd: string, type: 'feature' | 'release' | 'hotfix', name: string, opts: { deleteBranch: boolean; rebase?: boolean; tagMessage?: string }): Promise<OpResult> {
  const cfg = await getGitflowConfig(cwd)
  const branch = cfg[type] + name
  const env = { GIT_EDITOR: 'true', ...(await identityEnv(cwd)) }
  // the original's checks: the branches gitflow merges into must exist
  const hasDevelop = await exists(cwd, `${HEADS}${cfg.develop}`)
  const hasMaster = await exists(cwd, `${HEADS}${cfg.master}`)
  if (!(await exists(cwd, `${HEADS}${branch}`))) return { ok: false, error: `No ${type} to finish` }
  if (type === 'feature' && !hasDevelop) return { ok: false, error: `${cfg.develop} branch is required to finish feature` }
  if (type !== 'feature' && (!hasDevelop || !hasMaster)) {
    return { ok: false, error: !hasDevelop && !hasMaster ? `${cfg.develop} and ${cfg.master} branch required to finish ${type}` : `${!hasDevelop ? cfg.develop : cfg.master} branch is required to finish ${type}` }
  }
  return wrapOp(async () => {
    if (type === 'feature') {
      if (opts.rebase) {
        // replay the feature on develop, then develop moves up to it (no merge commit)
        await g(cwd, ['rebase', cfg.develop, branch], { env })
        await g(cwd, ['checkout', cfg.develop])
        await g(cwd, ['merge', '--ff-only', branch], { env })
      } else {
        await g(cwd, ['checkout', cfg.develop])
        await g(cwd, ['merge', '--no-ff', '--no-edit', branch], { env })
      }
    } else {
      await g(cwd, ['checkout', cfg.master])
      await g(cwd, ['merge', '--no-ff', '--no-edit', branch], { env })
      const tag = cfg.versionTag + name
      await g(cwd, ['tag', '-a', tag, '-m', opts.tagMessage || tag], { env })
      await g(cwd, ['checkout', cfg.develop])
      await g(cwd, ['merge', '--no-ff', '--no-edit', tag], { env })
    }
    if (opts.deleteBranch) await g(cwd, ['branch', '-D', branch])
  })
}

// ---------------------------------------------------------------------------------------------
// Worktrees

export async function removeWorktree2(cwd: string, dir: string, opts: { force: boolean; branch?: string; deleteRemote?: { remote: string; branch: string } }): Promise<{ folderLeft: boolean }> {
  const r = await g(cwd, ['worktree', 'remove', ...(opts.force ? ['--force', '--force'] : []), dir], { allowFail: true })
  let folderLeft = false
  if (r.code !== 0) {
    // git unregisters the worktree but cannot delete a folder with files in use ("Permission denied", "Directory not empty")
    const still = (await tryOut(cwd, ['worktree', 'list', '--porcelain']))?.split('\n').some((l) => l.startsWith('worktree ') && path.resolve(l.slice(9)) === path.resolve(dir))
    if (still) throw new GitError(r.stderr.trim() || 'Could not remove the worktree', r.stderr, r.code, ['worktree', 'remove', dir])
    folderLeft = existsSync(dir)
  } else folderLeft = existsSync(dir)
  if (opts.branch) await deleteBranch(cwd, opts.branch, true)
  if (opts.deleteRemote) await g(cwd, ['push', opts.deleteRemote.remote, '--delete', opts.deleteRemote.branch])
  return { folderLeft }
}

export async function worktreeWips(cwd: string): Promise<Array<{ path: string; branch?: string; sha: string; changes: number }>> {
  const wt = await tryOut(cwd, ['worktree', 'list', '--porcelain'])
  if (!wt) return []
  const res: Array<{ path: string; branch?: string; sha: string; changes: number }> = []
  for (const w of parseWorktrees(wt, cwd)) {
    if (w.isCurrent || w.prunable || !w.sha || !existsSync(w.path)) continue
    const st = await tryOut(w.path, ['status', '--porcelain', '--untracked-files=all'])
    const changes = (st ?? '').split('\n').filter((l) => l.trim()).length
    if (changes) res.push({ path: w.path, branch: w.branch, sha: w.sha, changes })
  }
  return res
}

export const k2Api: K2Api = {
  branchCleanupInfo, conflictCheck, forgetCredentials, sshForgetHost, gitflowStart2, gitflowFinish2, removeWorktree2, worktreeWips
}
