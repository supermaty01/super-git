// High-level repository operations used by the IPC layer.
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  runGit, RunOptions, GitError, assertWritable, LOG_FORMAT, REF_FORMAT, parseLog, parseRefs, parseStashes, parseWorktrees, parseRemotes,
  parseStatus, parseNameStatus, parseDiff, buildPatch, synthesizeAddDiff, parseBlame, isBinary
} from './gitcore'
import type {
  RepoSnapshot, RepoState, FileChange, FileContext, FileContents, ConflictSides, ResetMode, PullMode, RebaseTodoItem,
  OpResult, Commit, BlameLine, HeadInfo, CommitOptions, Submodule, GitflowConfig
} from '../shared/types'

/** Supplies auth config (e.g. Azure DevOps PAT header) for network operations. */
let authConfigProvider: () => Array<[string, string]> = () => []
export function setAuthConfigProvider(fn: () => Array<[string, string]>): void { authConfigProvider = fn }

/** Supplies author identity env (active profile) for commit-creating operations. */
let identityProvider: (cwd: string) => Promise<Record<string, string>> = async () => ({})
export function setIdentityProvider(fn: typeof identityProvider): void { identityProvider = fn }
export const identityEnv = (cwd: string) => identityProvider(cwd)

let progressSink: (repo: string, op: string, text: string) => void = () => {}
export function setProgressSink(fn: typeof progressSink): void { progressSink = fn }

export function g(cwd: string, args: string[], extra: Partial<RunOptions> = {}) {
  return runGit(args, { cwd, ...extra })
}
export async function out(cwd: string, args: string[], extra: Partial<RunOptions> = {}): Promise<string> {
  return (await g(cwd, args, extra)).stdout
}
export async function tryOut(cwd: string, args: string[]): Promise<string | null> {
  const r = await g(cwd, args, { allowFail: true })
  return r.code === 0 ? r.stdout : null
}
export function net(cwd: string, op: string, args: string[], extra: Partial<RunOptions> = {}) {
  return runGit(args, {
    cwd, config: authConfigProvider(), ...extra,
    onProgress: (l) => progressSink(cwd, op, l)
  })
}

// ---------------------------------------------------------------------------------------------
// Repository discovery

export async function resolveRepo(p: string): Promise<{ root: string; gitDir: string } | null> {
  const r = await g(p, ['rev-parse', '--show-toplevel', '--absolute-git-dir'], { allowFail: true })
  if (r.code !== 0) return null
  const [root, gitDir] = r.stdout.trim().split('\n')
  return { root: path.normalize(root), gitDir: path.normalize(gitDir) }
}

export async function initRepo(dir: string, opts: { defaultBranch?: string; files?: Record<string, string>; initialCommit?: boolean } = {}): Promise<void> {
  assertWritable('creating a repository')
  await fs.mkdir(dir, { recursive: true })
  await g(dir, ['init', '-b', opts.defaultBranch || 'main'])
  const files = Object.entries(opts.files ?? {}).filter(([, c]) => c)
  for (const [name, content] of files) await fs.writeFile(path.join(dir, name), content, 'utf8')
  if (opts.initialCommit && files.length) {
    await g(dir, ['add', '-A'])
    await g(dir, ['commit', '-m', 'Initial commit'], { env: await identityProvider(dir) })
  }
}

export async function cloneRepo(url: string, dest: string, opts: { shallow?: boolean; branch?: string; recurse?: boolean } = {}): Promise<void> {
  const parent = path.dirname(dest)
  await fs.mkdir(parent, { recursive: true })
  const args = ['clone', '--progress']
  if (opts.shallow) args.push('--depth', '1')
  if (opts.branch) args.push('--branch', opts.branch)
  if (opts.recurse) args.push('--recurse-submodules')
  args.push(url, dest)
  await net(parent, 'clone', args)
}

// ---------------------------------------------------------------------------------------------
// Snapshot

async function readFileSafe(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf8') } catch { return null }
}

export async function getRepoState(cwd: string, gitDir: string, head: HeadInfo): Promise<RepoState> {
  const ours = head.branch ?? head.sha.slice(0, 7)
  const mergeHead = await readFileSafe(path.join(gitDir, 'MERGE_HEAD'))
  const msg = (await readFileSafe(path.join(gitDir, 'MERGE_MSG'))) ?? undefined
  if (mergeHead) {
    let theirs = /Merge (?:remote-tracking )?branch '([^']+)'/.exec(msg ?? '')?.[1]
    if (!theirs) theirs = (await tryOut(cwd, ['name-rev', '--name-only', mergeHead.trim()]))?.trim() || mergeHead.slice(0, 7)
    return { kind: 'merge', theirs, ours, message: msg }
  }
  for (const d of ['rebase-merge', 'rebase-apply']) {
    const dir = path.join(gitDir, d)
    if (existsSync(dir)) {
      // `git am` also uses rebase-apply; it marks itself with an "applying" file
      if (d === 'rebase-apply' && existsSync(path.join(dir, 'applying'))) {
        const step = Number((await readFileSafe(path.join(dir, 'next'))) ?? 0)
        const total = Number((await readFileSafe(path.join(dir, 'last'))) ?? 0)
        const subject = (await readFileSafe(path.join(dir, 'final-commit')))?.split('\n')[0]
        return { kind: 'am', ours, theirs: subject || 'patch', step, total, message: msg }
      }
      const headName = (await readFileSafe(path.join(dir, 'head-name')))?.trim().replace(/^refs\/heads\//, '')
      const onto = (await readFileSafe(path.join(dir, 'onto')))?.trim()
      const step = Number((await readFileSafe(path.join(dir, d === 'rebase-merge' ? 'msgnum' : 'next'))) ?? 0)
      const total = Number((await readFileSafe(path.join(dir, d === 'rebase-merge' ? 'end' : 'last'))) ?? 0)
      let ontoName = onto?.slice(0, 7)
      if (onto) {
        const n = await tryOut(cwd, ['name-rev', '--name-only', '--exclude=refs/stash', onto])
        if (n && !n.includes('undefined')) ontoName = n.trim().replace(/^remotes\//, '')
      }
      return { kind: 'rebase', ours: headName, theirs: ontoName, step, total, message: msg }
    }
  }
  const cp = await readFileSafe(path.join(gitDir, 'CHERRY_PICK_HEAD'))
  if (cp) return { kind: 'cherry-pick', theirs: cp.trim().slice(0, 7), ours, message: msg }
  const rv = await readFileSafe(path.join(gitDir, 'REVERT_HEAD'))
  if (rv) return { kind: 'revert', theirs: rv.trim().slice(0, 7), ours, message: msg }
  return { kind: 'none' }
}

export async function getHead(cwd: string): Promise<HeadInfo> {
  const [sym, sha] = await Promise.all([
    tryOut(cwd, ['symbolic-ref', '-q', '--short', 'HEAD']),
    tryOut(cwd, ['rev-parse', '-q', '--verify', 'HEAD'])
  ])
  return { branch: sym?.trim() || undefined, sha: sha?.trim() ?? '', detached: !sym?.trim(), unborn: !sha?.trim() }
}

export async function getStatus(cwd: string, gitDir: string, head: HeadInfo) {
  const [st, state] = await Promise.all([
    out(cwd, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']),
    getRepoState(cwd, gitDir, head)
  ])
  const parsed = parseStatus(st)
  return { staged: parsed.staged, unstaged: parsed.unstaged, conflicted: parsed.conflicted, state }
}

/**
 * The revisions the graph is built from: branches, remote branches, tags and HEAD, plus the commit each
 * stash was made on (so a stash on a since-deleted branch still has something to hang from).
 * Deliberately not `--all`, which also walks refs that tools keep for their own bookkeeping
 * (refs/t3/…, refs/gitkraken/…, refs/notes, refs/pull/…) and the HEADs of other worktrees, and floods the
 * graph with commits no branch points to. This is the same set the original draws.
 */
export async function graphRevs(cwd: string): Promise<string[]> {
  const st = await g(cwd, ['log', '-g', '--format=%P', 'refs/stash'], { allowFail: true })
  const bases = st.code === 0 ? [...new Set(st.stdout.split('\n').map((l) => l.trim().split(' ')[0]).filter((x) => /^[0-9a-f]{40,64}$/.test(x)))] : []
  return ['--ignore-missing', '--branches', '--remotes', '--tags', 'HEAD', ...bases]
}

export async function getLog(cwd: string, limit: number): Promise<Commit[]> {
  const r = await g(cwd, ['log', ...(await graphRevs(cwd)), '--date-order', `-n${limit}`, '-z', `--format=${LOG_FORMAT}`], { allowFail: true })
  return r.code === 0 ? parseLog(r.stdout) : []
}

export async function getSnapshot(cwd: string, limit: number): Promise<RepoSnapshot> {
  const info = await resolveRepo(cwd)
  if (!info) throw new Error(`${cwd} is not a git repository`)
  const { root, gitDir } = info
  const head = await getHead(root)
  const [refsOut, commits, stashOut, wtOut, remOut, status, name, email] = await Promise.all([
    out(root, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags']),
    getLog(root, limit + 1),
    g(root, ['stash', 'list', '-z', '--format=%H%x1f%P%x1f%at%x1f%gs'], { allowFail: true }),
    g(root, ['worktree', 'list', '--porcelain'], { allowFail: true }),
    out(root, ['remote', '-v']),
    getStatus(root, gitDir, head),
    tryOut(root, ['config', 'user.name']),
    tryOut(root, ['config', 'user.email'])
  ])
  const hasMore = commits.length > limit
  const [submodules, gitflow] = await Promise.all([getSubmodules(root), getGitflowConfig(root)])
  return {
    path: root,
    name: path.basename(root),
    gitDir,
    head,
    refs: parseRefs(refsOut),
    commits: hasMore ? commits.slice(0, limit) : commits,
    stashes: stashOut.code === 0 ? parseStashes(stashOut.stdout) : [],
    worktrees: wtOut.code === 0 ? parseWorktrees(wtOut.stdout, root) : [],
    remotes: parseRemotes(remOut),
    status,
    hasMore,
    user: { name: name?.trim() ?? '', email: email?.trim() ?? '' },
    submodules,
    gitflow
  }
}

export async function getSubmodules(cwd: string): Promise<Submodule[]> {
  if (!existsSync(path.join(cwd, '.gitmodules'))) return []
  const [st, urls] = await Promise.all([
    g(cwd, ['submodule', 'status'], { allowFail: true }),
    g(cwd, ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.url$'], { allowFail: true })
  ])
  const pathByName = new Map<string, string>()
  const paths = await g(cwd, ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], { allowFail: true })
  for (const l of paths.stdout.split('\n')) {
    const m = /^submodule\.(.+)\.path (.+)$/.exec(l.trim())
    if (m) pathByName.set(m[1], m[2])
  }
  const urlByPath = new Map<string, string>()
  for (const l of urls.stdout.split('\n')) {
    const m = /^submodule\.(.+)\.url (.+)$/.exec(l.trim())
    if (m) urlByPath.set(pathByName.get(m[1]) ?? m[1], m[2])
  }
  const list: Submodule[] = []
  for (const l of st.stdout.split('\n')) {
    const m = /^([ +\-U])([0-9a-f]+) (\S+)(?: \((.*)\))?/.exec(l)
    if (m) list.push({ state: m[1] as Submodule['state'], sha: m[2], path: m[3], describe: m[4], url: urlByPath.get(m[3]) })
  }
  return list
}

export async function getGitflowConfig(cwd: string): Promise<GitflowConfig> {
  const r = await g(cwd, ['config', '--get-regexp', '^gitflow\\.'], { allowFail: true })
  const map = new Map<string, string>()
  for (const l of r.stdout.split('\n')) { const i = l.indexOf(' '); if (i > 0) map.set(l.slice(0, i), l.slice(i + 1).trim()) }
  return {
    initialized: map.has('gitflow.branch.master') && map.has('gitflow.branch.develop'),
    master: map.get('gitflow.branch.master') ?? 'main',
    develop: map.get('gitflow.branch.develop') ?? 'develop',
    feature: map.get('gitflow.prefix.feature') ?? 'feature/',
    release: map.get('gitflow.prefix.release') ?? 'release/',
    hotfix: map.get('gitflow.prefix.hotfix') ?? 'hotfix/',
    versionTag: map.get('gitflow.prefix.versiontag') ?? ''
  }
}

// ---------------------------------------------------------------------------------------------
// Commit / file inspection

export async function getCommitFiles(cwd: string, sha: string, parent?: string): Promise<FileChange[]> {
  const base = parent ? [parent, sha] : ['--root', sha]
  const [ns, num] = await Promise.all([
    out(cwd, ['diff-tree', '-r', '-z', '-M', '--name-status', '--no-commit-id', ...base]),
    g(cwd, ['diff-tree', '-r', '-z', '-M', '--numstat', '--no-commit-id', ...base], { allowFail: true })
  ])
  return applyNumstat(parseNameStatus(ns), num.stdout)
}

/** Files changed between commit a and commit b (or the working directory when b is null). */
export async function getCompareFiles(cwd: string, a: string, b: string | null): Promise<FileChange[]> {
  const range = b ? [a, b] : [a]
  const [ns, num] = await Promise.all([
    out(cwd, ['diff', '-z', '-M', '--name-status', ...range]),
    g(cwd, ['diff', '-z', '-M', '--numstat', ...range], { allowFail: true })
  ])
  return applyNumstat(parseNameStatus(ns), num.stdout)
}

export function applyNumstat(files: FileChange[], numstat: string): FileChange[] {
  const t = numstat.split('\0')
  const stats = new Map<string, [number, number]>()
  for (let i = 0; i < t.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(t[i].replace(/^\n/, ''))
    if (!m) continue
    let p = m[3]
    if (!p) { p = t[i + 2]; i += 2 }
    stats.set(p, [m[1] === '-' ? 0 : Number(m[1]), m[2] === '-' ? 0 : Number(m[2])])
  }
  return files.map((f) => { const s = stats.get(f.path); return s ? { ...f, additions: s[0], deletions: s[1] } : f })
}

export async function getCommitDetails(cwd: string, sha: string): Promise<Commit | null> {
  const r = await g(cwd, ['show', '-s', '-z', `--format=${LOG_FORMAT}`, sha], { allowFail: true })
  return r.code === 0 ? parseLog(r.stdout)[0] ?? null : null
}

/** For a stash: the files in the stash (vs its base) including untracked files stored in the 3rd parent. */
export async function getStashFiles(cwd: string, sha: string): Promise<FileChange[]> {
  const parents = (await out(cwd, ['rev-list', '--parents', '-n1', sha])).trim().split(' ').slice(1)
  const files = await getCommitFiles(cwd, sha, parents[0])
  if (parents[2]) {
    const untracked = await getCommitFiles(cwd, parents[2])
    for (const f of untracked) if (!files.some((x) => x.path === f.path)) files.push({ ...f, status: 'A' })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function showBlob(cwd: string, spec: string): Promise<Buffer | null> {
  const r = await g(cwd, ['show', spec], { allowFail: true, binary: true })
  return r.code === 0 ? r.stdoutBuf : null
}

function toText(b: Buffer | null): string { return b ? b.toString('utf8') : '' }

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', ico: 'image/x-icon', svg: 'image/svg+xml' }
function imageMime(p: string): string | null { return IMAGE_MIME[p.split('.').pop()?.toLowerCase() ?? ''] ?? null }

export async function getFileContents(cwd: string, ctx: FileContext, ignoreWhitespace = false): Promise<FileContents> {
  let orig: Buffer | null = null
  let mod: Buffer | null = null
  let diffArgs: string[] | null = null
  const ws = ignoreWhitespace ? ['-w'] : []
  const p = ctx.path
  if (ctx.kind === 'unstaged') {
    if (ctx.status !== '?') orig = await showBlob(cwd, `:0:${p}`) ?? await showBlob(cwd, `HEAD:${p}`)
    try { mod = await fs.readFile(path.join(cwd, p)) } catch { mod = null }
    if (ctx.status !== '?') diffArgs = ['diff', '-U3', '--no-ext-diff', ...ws, '--', p]
  } else if (ctx.kind === 'staged') {
    orig = ctx.status === 'A' ? null : await showBlob(cwd, `HEAD:${ctx.oldPath ?? p}`)
    mod = ctx.status === 'D' ? null : await showBlob(cwd, `:0:${p}`)
    diffArgs = ['diff', '--cached', '-M', '-U3', '--no-ext-diff', ...ws, '--', p, ...(ctx.oldPath ? [ctx.oldPath] : [])]
  } else if (ctx.kind === 'compare') {
    orig = ctx.status === 'A' ? null : await showBlob(cwd, `${ctx.a}:${ctx.oldPath ?? p}`)
    if (ctx.b) mod = ctx.status === 'D' ? null : await showBlob(cwd, `${ctx.b}:${p}`)
    else { try { mod = await fs.readFile(path.join(cwd, p)) } catch { mod = null } }
    diffArgs = ['diff', '-M', '-U3', '--no-ext-diff', ...ws, ctx.a, ...(ctx.b ? [ctx.b] : []), '--', p, ...(ctx.oldPath ? [ctx.oldPath] : [])]
  } else {
    const parent = ctx.parent
    orig = parent && ctx.status !== 'A' ? await showBlob(cwd, `${parent}:${ctx.oldPath ?? p}`) : null
    mod = ctx.status === 'D' ? null : await showBlob(cwd, `${ctx.sha}:${p}`)
    if (parent) diffArgs = ['diff', '-M', '-U3', '--no-ext-diff', ...ws, parent, ctx.sha, '--', p, ...(ctx.oldPath ? [ctx.oldPath] : [])]
    else diffArgs = ['diff-tree', '-p', '-M', '-U3', '--root', ...ws, ctx.sha, '--', p]
  }
  const binary = (orig ? isBinary(orig) : false) || (mod ? isBinary(mod) : false)
  let diff = null
  if (!binary) {
    if (diffArgs) {
      const r = await g(cwd, diffArgs, { allowFail: true })
      diff = parseDiff(r.stdout)[0] ?? null
      if (!diff && !orig && mod) diff = synthesizeAddDiff(p, toText(mod))
    } else diff = synthesizeAddDiff(p, toText(mod))
  }
  const res: FileContents = { original: binary ? '' : toText(orig), modified: binary ? '' : toText(mod), binary, diff }
  const mime = imageMime(p)
  if (mime) {
    if (orig) res.originalImage = `data:${mime};base64,${orig.toString('base64')}`
    if (mod) res.modifiedImage = `data:${mime};base64,${mod.toString('base64')}`
  }
  return res
}

export async function getConflictSides(cwd: string, gitDir: string, file: string): Promise<ConflictSides> {
  const [base, ours, theirs, head] = await Promise.all([
    showBlob(cwd, `:1:${file}`), showBlob(cwd, `:2:${file}`), showBlob(cwd, `:3:${file}`), getHead(cwd)
  ])
  const state = await getRepoState(cwd, gitDir, head)
  let theirsSha = ''
  for (const f of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD']) {
    const v = await readFileSafe(path.join(gitDir, f))
    if (v) { theirsSha = v.trim().split('\n')[0]; break }
  }
  let oursLabel = head.branch ?? head.sha.slice(0, 7)
  let theirsLabel = state.theirs ?? theirsSha.slice(0, 7)
  if (state.kind === 'rebase') { oursLabel = state.theirs ?? 'upstream'; theirsLabel = state.ours ?? theirsSha.slice(0, 7) }
  return {
    path: file, base: toText(base), ours: toText(ours), theirs: toText(theirs),
    oursLabel, theirsLabel, oursSha: head.sha, theirsSha
  }
}

export async function writeWorkingFile(cwd: string, file: string, content: string): Promise<void> {
  assertWritable('writing a working file')
  const target = path.resolve(cwd, file)
  if (!target.toLowerCase().startsWith(path.resolve(cwd).toLowerCase() + path.sep.toLowerCase())) throw new Error('Refusing to write outside the repository')
  await fs.writeFile(target, content, 'utf8')
}

export async function resolveConflict(cwd: string, file: string, content: string): Promise<void> {
  assertWritable('resolving a conflict')
  await fs.writeFile(path.join(cwd, file), content, 'utf8')
  await g(cwd, ['add', '--', file])
}

export async function resolveWithSide(cwd: string, file: string, side: 'ours' | 'theirs'): Promise<void> {
  await g(cwd, ['checkout', `--${side}`, '--', file])
  await g(cwd, ['add', '--', file])
}

export async function getBlame(cwd: string, file: string, sha?: string): Promise<BlameLine[]> {
  const args = ['blame', '--porcelain', ...(sha ? [sha] : []), '--', file]
  return parseBlame(await out(cwd, args))
}

export async function getFileHistory(cwd: string, file: string, limit = 500): Promise<Array<Commit & { path: string }>> {
  const r = await g(cwd, ['log', '--follow', '-M', `-n${limit}`, `--format=%x1e${LOG_FORMAT}%x1d`, '--name-only', '--', file], { allowFail: true })
  if (r.code !== 0) return []
  const result: Array<Commit & { path: string }> = []
  for (const chunk of r.stdout.split('\x1e')) {
    const end = chunk.lastIndexOf('\x1d')
    if (end < 0) continue
    const commit = parseLog(chunk.slice(0, end))[0]
    const name = chunk.slice(end + 1).split('\n').map((x) => x.trim()).filter(Boolean)[0]
    if (commit) result.push({ ...commit, path: name || file })
  }
  return result
}

export async function searchCommits(cwd: string, query: string, limit = 500): Promise<string[]> {
  if (/^[0-9a-f]{4,40}$/i.test(query)) {
    const r = await g(cwd, ['rev-parse', '--verify', '-q', `${query}^{commit}`], { allowFail: true })
    if (r.code === 0) return [r.stdout.trim()]
  }
  const revs = await graphRevs(cwd)
  const [byMsg, byAuthor] = await Promise.all([
    g(cwd, ['log', ...revs, '-i', `--grep=${query}`, '--format=%H', `-n${limit}`], { allowFail: true }),
    g(cwd, ['log', ...revs, '-i', `--author=${query}`, '--format=%H', `-n${limit}`], { allowFail: true })
  ])
  return [...new Set([...byMsg.stdout.split('\n'), ...byAuthor.stdout.split('\n')].filter(Boolean))]
}

// ---------------------------------------------------------------------------------------------
// Staging

export async function stage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await g(cwd, ['add', '-A', '--', ...paths])
}
export async function stageAll(cwd: string): Promise<void> { await g(cwd, ['add', '-A']) }
export async function unstage(cwd: string, paths: string[], unborn: boolean): Promise<void> {
  if (!paths.length) return
  if (unborn) await g(cwd, ['rm', '--cached', '-r', '-q', '--', ...paths])
  else await g(cwd, ['reset', '-q', 'HEAD', '--', ...paths])
}
export async function unstageAll(cwd: string, unborn: boolean): Promise<void> {
  if (unborn) await g(cwd, ['rm', '--cached', '-r', '-q', '.'], { allowFail: true })
  else await g(cwd, ['reset', '-q', 'HEAD'])
}

export async function discardFiles(cwd: string, files: FileChange[]): Promise<void> {
  assertWritable('discarding changes')
  const untracked = files.filter((f) => f.status === '?').map((f) => f.path)
  const tracked = files.filter((f) => f.status !== '?').map((f) => f.path)
  if (tracked.length) await g(cwd, ['checkout', '--', ...tracked])
  for (const u of untracked) await fs.rm(path.join(cwd, u), { force: true, recursive: true })
}

export async function discardAll(cwd: string, unborn: boolean): Promise<void> {
  if (!unborn) await g(cwd, ['reset', '--hard', '-q', 'HEAD'])
  else await g(cwd, ['rm', '--cached', '-r', '-q', '.'], { allowFail: true })
  await g(cwd, ['clean', '-fd', '-q'])
}

/**
 * Stage/unstage/discard a hunk, or selected lines of it.
 * action 'stage'   : file context is unstaged
 * action 'unstage' : file context is staged
 * action 'discard' : file context is unstaged
 */
export async function applyHunk(cwd: string, ctx: FileContext, hunkIndex: number, lines: number[] | null, action: 'stage' | 'unstage' | 'discard' | 'revert'): Promise<void> {
  const contents = await getFileContents(cwd, ctx)
  const diff = contents.diff
  if (!diff || !diff.hunks[hunkIndex]) throw new Error('The diff has changed; please try again.')
  if (diff.isNew && ctx.kind === 'unstaged' && ctx.status === '?') {
    if (action === 'stage') {
      if (lines === null) { await stage(cwd, [ctx.path]); return }
      await g(cwd, ['add', '-N', '--', ctx.path])
      return applyHunk(cwd, { kind: 'unstaged', path: ctx.path, status: 'A' }, hunkIndex, lines, action)
    }
    if (action === 'discard' && lines === null) { await discardFiles(cwd, [{ path: ctx.path, status: '?' }]); return }
  }
  const sel = lines ? new Set(lines) : null
  const patch = buildPatch(diff, diff.hunks[hunkIndex], sel, action === 'stage' ? 'stage' : 'reverse')
  const args = ['apply', '--recount', '--whitespace=nowarn']
  // discard and revert undo the change in the working directory; stage / unstage work on the index
  if (action === 'stage' || action === 'unstage') args.push('--cached')
  if (action !== 'stage') args.push('--reverse')
  args.push('-')
  await g(cwd, args, { input: patch })
}

// ---------------------------------------------------------------------------------------------
// Commit

export async function commit(cwd: string, message: string, amend: boolean, opts: CommitOptions = {}): Promise<void> {
  const tmp = path.join(os.tmpdir(), `supergit-msg-${process.pid}-${Date.now()}.txt`)
  await fs.writeFile(tmp, message, 'utf8')
  try {
    await g(cwd, ['commit', '-F', tmp, opts.keepComments ? '--cleanup=whitespace' : '--cleanup=strip', ...(amend ? ['--amend'] : []), ...(opts.noVerify ? ['--no-verify'] : []), ...(opts.sign ? ['-S'] : [])], { env: await identityProvider(cwd) })
  } finally {
    await fs.rm(tmp, { force: true })
  }
}

export async function getLastCommitMessage(cwd: string): Promise<string> {
  return (await tryOut(cwd, ['log', '-1', '--format=%B']))?.replace(/\s+$/, '') ?? ''
}

// ---------------------------------------------------------------------------------------------
// Branches, tags, remotes

export async function checkout(cwd: string, target: string): Promise<void> { await g(cwd, ['checkout', target]) }
export async function restoreFile(cwd: string, sha: string, file: string): Promise<void> { await g(cwd, ['checkout', sha, '--', file]) }

export async function checkoutRemote(cwd: string, remoteShort: string, localExists: boolean): Promise<string> {
  const local = remoteShort.split('/').slice(1).join('/')
  if (localExists) await g(cwd, ['checkout', local])
  else await g(cwd, ['checkout', '-b', local, '--track', `refs/remotes/${remoteShort}`])
  return local
}

export async function createBranch(cwd: string, name: string, at: string, doCheckout: boolean): Promise<void> {
  if (doCheckout) await g(cwd, ['checkout', '-b', name, at])
  else await g(cwd, ['branch', name, at])
}

export async function deleteBranch(cwd: string, name: string, force: boolean): Promise<void> {
  await g(cwd, ['branch', force ? '-D' : '-d', name])
}

export async function deleteRemoteBranch(cwd: string, remote: string, branch: string): Promise<void> {
  await net(cwd, 'push', ['push', '--progress', remote, '--delete', branch])
}

export async function renameBranch(cwd: string, oldName: string, newName: string): Promise<void> {
  await g(cwd, ['branch', '-m', oldName, newName])
}

export async function setUpstream(cwd: string, branch: string, upstream: string | null): Promise<void> {
  if (upstream) await g(cwd, ['branch', `--set-upstream-to=${upstream}`, branch])
  else await g(cwd, ['branch', '--unset-upstream', branch])
}

export async function fastForward(cwd: string, branch: string, to: string, isCurrent: boolean): Promise<void> {
  if (isCurrent) await g(cwd, ['merge', '--ff-only', to])
  else await net(cwd, 'fetch', ['fetch', '.', `${to}:${branch}`])
}

export async function createTag(cwd: string, name: string, at: string, message?: string): Promise<void> {
  if (message) await g(cwd, ['tag', '-a', name, '-m', message, at])
  else await g(cwd, ['tag', name, at])
}
export async function deleteTag(cwd: string, name: string): Promise<void> { await g(cwd, ['tag', '-d', name]) }
export async function deleteRemoteTag(cwd: string, remote: string, name: string): Promise<void> {
  await net(cwd, 'push', ['push', '--progress', remote, `:refs/tags/${name}`])
}
export async function pushTag(cwd: string, remote: string, name: string): Promise<void> {
  await net(cwd, 'push', ['push', '--progress', remote, `refs/tags/${name}`])
}

export async function addRemote(cwd: string, name: string, url: string): Promise<void> { await g(cwd, ['remote', 'add', name, url]) }
export async function removeRemote(cwd: string, name: string): Promise<void> { await g(cwd, ['remote', 'remove', name]) }
export async function editRemote(cwd: string, oldName: string, name: string, fetchUrl: string, pushUrl: string): Promise<void> {
  if (oldName !== name) await g(cwd, ['remote', 'rename', oldName, name])
  await g(cwd, ['remote', 'set-url', name, fetchUrl])
  if (pushUrl && pushUrl !== fetchUrl) await g(cwd, ['remote', 'set-url', '--push', name, pushUrl])
}

// ---------------------------------------------------------------------------------------------
// History-rewriting ops. These return conflicts=true instead of throwing on merge conflicts.

function conflictAware(e: unknown): OpResult {
  if (e instanceof GitError) {
    const text = e.stderr + '\n' + e.message
    if (/CONFLICT|conflict|could not apply|after resolving the conflicts|fix conflicts/i.test(text)) return { ok: false, conflicts: true, error: e.message }
    return { ok: false, error: e.message }
  }
  return { ok: false, error: (e as Error).message }
}

async function wrap(fn: () => Promise<unknown>): Promise<OpResult> {
  try { await fn(); return { ok: true } } catch (e) { return conflictAware(e) }
}

const NO_EDITOR_ENV = { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' }

export const merge = (cwd: string, ref: string, opts: { noFF?: boolean; ffOnly?: boolean; squash?: boolean } = {}) =>
  wrap(async () => g(cwd, ['merge', '--no-edit', ...(opts.noFF ? ['--no-ff'] : []), ...(opts.ffOnly ? ['--ff-only'] : []), ...(opts.squash ? ['--squash'] : []), ref], { env: { ...NO_EDITOR_ENV, ...(await identityProvider(cwd)) } }))
export const rebase = (cwd: string, onto: string) => wrap(async () => g(cwd, ['rebase', onto], { env: { ...NO_EDITOR_ENV, ...(await identityProvider(cwd)) } }))
export const cherryPick = (cwd: string, shas: string[]) => wrap(async () => g(cwd, ['cherry-pick', ...shas], { env: { ...NO_EDITOR_ENV, ...(await identityProvider(cwd)) } }))
export const revert = (cwd: string, sha: string, isMerge: boolean) =>
  wrap(async () => g(cwd, ['revert', '--no-edit', ...(isMerge ? ['-m', '1'] : []), sha], { env: { ...NO_EDITOR_ENV, ...(await identityProvider(cwd)) } }))
export const reset = (cwd: string, sha: string, mode: ResetMode) => wrap(() => g(cwd, ['reset', `--${mode}`, sha]))
/** moves HEAD while keeping uncommitted changes (fails instead of overwriting them) */
export async function resetKeep(cwd: string, sha: string): Promise<void> { await g(cwd, ['reset', '--keep', sha]) }

export async function continueOp(cwd: string, kind: string, message?: string): Promise<OpResult> {
  if (kind === 'merge') {
    return wrap(async () => {
      if (message) await commit(cwd, message, false)
      else await g(cwd, ['commit', '--no-edit'], { env: { ...NO_EDITOR_ENV, ...(await identityProvider(cwd)) } })
    })
  }
  if (message && (kind === 'cherry-pick' || kind === 'revert')) {
    assertWritable('writing the merge message')
    const gitDir = (await out(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
    await fs.writeFile(path.join(gitDir, 'MERGE_MSG'), message, 'utf8')
  }
  return wrap(async () => g(cwd, [kind, '--continue'], { env: { ...NO_EDITOR_ENV, ...(await identityProvider(cwd)) } }))
}
export const abortOp = (cwd: string, kind: string) => wrap(() => g(cwd, [kind, '--abort']))
export const skipOp = (cwd: string, kind: string) => wrap(async () => g(cwd, [kind, '--skip'], { env: { ...NO_EDITOR_ENV, ...(await identityProvider(cwd)) } }))

/** Interactive rebase driven by a pre-built todo list (no editor needed). */
export async function interactiveRebase(cwd: string, base: string | null, items: RebaseTodoItem[]): Promise<OpResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'supergit-rebase-'))
  const lines: string[] = []
  const toSh = (p: string) => p.replace(/\\/g, '/').replace(/'/g, `'\\''`)
  for (const [i, it] of items.entries()) {
    if (it.action === 'drop') { lines.push(`drop ${it.sha}`); continue }
    if (it.action === 'reword') {
      const mf = path.join(dir, `msg-${i}.txt`)
      await fs.writeFile(mf, it.message ?? it.summary, 'utf8')
      lines.push(`pick ${it.sha}`)
      lines.push(`exec git commit --amend --allow-empty --cleanup=strip -F '${toSh(mf)}'`)
      continue
    }
    lines.push(`${it.action} ${it.sha}`)
  }
  const todo = path.join(dir, 'todo.txt')
  await fs.writeFile(todo, lines.join('\n') + '\n', 'utf8')
  const res = await wrap(async () => g(cwd, ['rebase', '-i', '--autostash', base ?? '--root'], {
    env: { GIT_SEQUENCE_EDITOR: `cp '${toSh(todo)}'`, GIT_EDITOR: 'true', ...(await identityProvider(cwd)) }
  }))
  if (res.ok) await fs.rm(dir, { recursive: true, force: true })
  return res
}

// ---------------------------------------------------------------------------------------------
// Stash

export async function stashSave(cwd: string, message: string | undefined, mode: 'all' | 'staged' | 'keep-index' = 'all'): Promise<void> {
  const flags = mode === 'staged' ? ['--staged'] : mode === 'keep-index' ? ['--include-untracked', '--keep-index'] : ['--include-untracked']
  await g(cwd, ['stash', 'push', ...flags, ...(message ? ['-m', message] : [])])
}
/** stash only the given paths (untracked ones included) */
export async function stashPaths(cwd: string, paths: string[], message?: string): Promise<void> {
  await g(cwd, ['stash', 'push', '--include-untracked', ...(message ? ['-m', message] : []), '--', ...paths])
}
/** write the diff of a single file (working tree or index) to a patch file */
export async function createFilePatch(cwd: string, file: string, staged: boolean, outFile: string): Promise<void> {
  const r = await g(cwd, ['diff', '--binary', ...(staged ? ['--cached'] : []), '--', file])
  let text = r.stdout
  if (!text.trim() && !staged) {
    // untracked file: diff against /dev/null
    const nr = await g(cwd, ['diff', '--binary', '--no-index', '--', '/dev/null', file], { allowFail: true })
    text = nr.stdout
  }
  await fs.writeFile(outFile, text, 'utf8')
}
export async function deleteWorkingFile(cwd: string, file: string): Promise<void> {
  assertWritable('deleting a file')
  const target = path.resolve(cwd, file)
  if (!target.toLowerCase().startsWith(path.resolve(cwd).toLowerCase() + path.sep.toLowerCase())) throw new Error('Refusing to delete outside the repository')
  await fs.rm(target, { force: true, recursive: true })
}
export async function annotateTag(cwd: string, name: string, message: string): Promise<void> {
  const sha = (await out(cwd, ['rev-parse', `${name}^{commit}`])).trim()
  await g(cwd, ['tag', '-a', '-f', name, '-m', message, sha], { env: await identityProvider(cwd) })
}

export async function stashRename(cwd: string, index: number, message: string): Promise<void> {
  const sha = (await out(cwd, ['rev-parse', `stash@{${index}}`])).trim()
  await g(cwd, ['stash', 'drop', `stash@{${index}}`])
  await g(cwd, ['stash', 'store', '-m', message, sha])
}
export const stashApply = (cwd: string, index: number) => wrap(() => g(cwd, ['stash', 'apply', '--index', `stash@{${index}}`]))
export const stashPop = (cwd: string, index: number) => wrap(() => g(cwd, ['stash', 'pop', '--index', `stash@{${index}}`]))
export async function stashDrop(cwd: string, index: number): Promise<void> { await g(cwd, ['stash', 'drop', `stash@{${index}}`]) }

// ---------------------------------------------------------------------------------------------
// Worktrees

export async function addWorktree(cwd: string, dir: string, opts: { branch?: string; newBranch?: string; commit?: string }): Promise<void> {
  const args = ['worktree', 'add']
  if (opts.newBranch) args.push('-b', opts.newBranch, dir, opts.commit ?? 'HEAD')
  else if (opts.branch) args.push(dir, opts.branch)
  else args.push('--detach', dir, opts.commit ?? 'HEAD')
  await g(cwd, args)
}
export async function removeWorktree(cwd: string, dir: string, force: boolean): Promise<void> {
  await g(cwd, ['worktree', 'remove', ...(force ? ['--force'] : []), dir])
}
export async function pruneWorktrees(cwd: string): Promise<void> { await g(cwd, ['worktree', 'prune']) }

// ---------------------------------------------------------------------------------------------
// Network

export async function fetchAll(cwd: string, prune = true, quiet = false): Promise<void> {
  // quiet (background) fetches must never pop up credential dialogs
  await net(cwd, 'fetch', ['fetch', '--all', '--progress', ...(prune ? ['--prune'] : [])], quiet ? { env: { GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' } } : {})
}
export async function fetchRemote(cwd: string, remote: string, prune = true): Promise<void> {
  await net(cwd, 'fetch', ['fetch', '--progress', ...(prune ? ['--prune'] : []), remote])
}

export async function pull(cwd: string, mode: PullMode): Promise<OpResult> {
  if (mode === 'fetch') return wrap(() => fetchAll(cwd))
  const flag = mode === 'rebase' ? '--rebase' : mode === 'ff-only' ? '--ff-only' : '--no-rebase'
  return wrap(async () => net(cwd, 'pull', ['pull', '--progress', '--no-edit', flag], { env: { ...NO_EDITOR_ENV, ...(await identityProvider(cwd)) } }))
}

export async function push(cwd: string, opts: { remote: string; branch: string; remoteBranch?: string; setUpstream?: boolean; force?: boolean }): Promise<OpResult> {
  const args = ['push', '--progress', '--porcelain']
  if (opts.setUpstream) args.push('-u')
  if (opts.force) args.push('--force-with-lease')
  args.push(opts.remote, `refs/heads/${opts.branch}:refs/heads/${opts.remoteBranch ?? opts.branch}`)
  try {
    await net(cwd, 'push', args)
    return { ok: true }
  } catch (e) {
    const msg = (e as Error).message
    if (/rejected|non-fast-forward|fetch first|stale info/i.test(msg)) return { ok: false, error: 'rejected' }
    return { ok: false, error: msg }
  }
}

export async function getConfig(cwd: string, key: string): Promise<string | null> {
  return (await tryOut(cwd, ['config', key]))?.trim() ?? null
}
export async function setConfig(cwd: string, key: string, value: string, global = false): Promise<void> {
  await g(cwd, ['config', ...(global ? ['--global'] : []), key, value])
}

export async function revParse(cwd: string, rev: string): Promise<string | null> {
  return (await tryOut(cwd, ['rev-parse', '-q', '--verify', rev]))?.trim() || null
}

export async function isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
  const r = await g(cwd, ['merge-base', '--is-ancestor', a, b], { allowFail: true })
  return r.code === 0
}

export { GitError }
