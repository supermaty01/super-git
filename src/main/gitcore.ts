// Low-level git process runner and output parsers (no Electron dependencies, unit-testable).
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, statSync } from 'node:fs'
import nodePath from 'node:path'
import { createHash } from 'node:crypto'

/** Locates git: PATH first, then the standard Git for Windows install locations. */
let gitBinary: string | null = null
let gitOverride = ''
/** use a specific git.exe ('' = auto-detect) */
export function setGitPath(p: string): void { gitOverride = p.trim(); gitBinary = null }
export function findGit(): string {
  if (gitOverride && existsSync(gitOverride)) return gitOverride
  if (gitBinary) return gitBinary
  const exe = process.platform === 'win32' ? 'git.exe' : 'git'
  const dirs = (process.env.PATH ?? '').split(nodePath.delimiter).filter(Boolean)
  if (process.platform === 'win32') {
    const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && nodePath.join(process.env.LOCALAPPDATA, 'Programs')]
    for (const base of pf) if (base) dirs.push(nodePath.join(base, 'Git', 'cmd'))
  }
  for (const d of dirs) {
    const candidate = nodePath.join(d, exe)
    if (existsSync(candidate)) return (gitBinary = candidate)
  }
  return (gitBinary = 'git')
}
import type {
  Commit, Ref, Stash, Worktree, Remote, FileChange, FileStatus, WorkingStatus, DiffHunk, FileDiff, DiffLine, BlameLine
} from '../shared/types'

export class GitError extends Error {
  stderr: string
  code: number
  args: string[]
  constructor(message: string, stderr: string, code: number, args: string[]) {
    super(message)
    this.stderr = stderr
    this.code = code
    this.args = args
  }
}

export interface RunOptions {
  cwd: string
  input?: string | Buffer
  env?: Record<string, string>
  allowFail?: boolean
  binary?: boolean
  onProgress?: (line: string) => void
  /** extra -c key=value config pairs passed via environment (kept off the command line) */
  config?: Array<[string, string]>
}

export interface RunResult {
  stdout: string
  stdoutBuf: Buffer
  stderr: string
  code: number
}

const BASE_ARGS = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.pager=cat']

/**
 * Read-only mode (SUPERGIT_READONLY=1): every git command that could change a repository and every
 * direct file write is refused. Used to inspect real repositories with a guarantee that nothing is touched.
 */
export const READ_ONLY = process.env.SUPERGIT_READONLY === '1'

const READ_SUBCOMMANDS = new Set([
  'log', 'show', 'diff', 'diff-tree', 'diff-files', 'diff-index', 'status', 'for-each-ref', 'rev-parse', 'rev-list',
  'cat-file', 'ls-files', 'ls-tree', 'blame', 'name-rev', 'merge-base', 'describe', 'shortlog', 'grep', 'check-attr',
  'check-ignore', 'check-ref-format', 'var', 'version', '--version', 'verify-commit', 'verify-tag', 'count-objects',
  'show-ref', 'range-diff', 'format-patch'
])

/** True when a git invocation only reads. Anything not recognised counts as a write. */
export function isReadOnlyGit(args: string[]): boolean {
  const [cmd, ...rest] = args
  if (!cmd) return false
  if (cmd === 'format-patch') return rest.includes('--stdout')
  if (READ_SUBCOMMANDS.has(cmd)) return true
  const flags = rest.filter((a) => a.startsWith('-'))
  const words = rest.filter((a) => !a.startsWith('-'))
  switch (cmd) {
    case 'config':
      if (rest.some((a) => /^--(unset|unset-all|add|replace-all|rename-section|remove-section|edit)$/.test(a) || a === '-e')) return false
      if (rest.some((a) => /^(--get|--get-all|--get-regexp|--get-urlmatch|--list|-l)$/.test(a))) return true
      // `git config <key>` reads; `git config <key> <value>` writes (the file after -f / --file is not a key)
      return rest.filter((a, i) => !a.startsWith('-') && !/^(-f|--file|--blob|--type|-t|--default)$/.test(rest[i - 1] ?? '')).length === 1
    case 'worktree': return rest[0] === 'list'
    case 'stash': return rest[0] === 'list' || rest[0] === 'show'
    case 'remote': return rest.length === 0 || (rest.length === 1 && rest[0] === '-v') || rest[0] === 'get-url'
    case 'symbolic-ref': return words.length <= 1 && !flags.some((f) => f === '-d' || f === '--delete' || f === '-m')
    case 'submodule': return rest[0] === 'status'
    case 'lfs': return rest[0] === 'version' || rest[0] === 'env' || rest[0] === 'ls-files'
    case 'reflog': return rest.length === 0 || rest[0] === 'show' || rest[0].startsWith('-')
    case 'tag': return rest.some((a) => a === '-l' || a === '--list') && !rest.some((a) => a === '-d' || a === '--delete')
    case 'branch': return rest.some((a) => /^(--list|-l|--show-current|--contains|--merged|--no-merged|-a|-r|-vv)$/.test(a)) && !rest.some((a) => /^(-d|-D|-m|-M|-c|-C|--delete|--move|--copy|--set-upstream-to|-u|--unset-upstream|-f|--force)$/.test(a))
    case 'apply': return rest.some((a) => a === '--check' || a === '--stat' || a === '--numstat' || a === '--summary')
    case 'hash-object': return !rest.includes('-w')
    case 'ls-remote': return true
    default: return false
  }
}

function logBlocked(what: string): void {
  const file = process.env.SUPERGIT_READONLY_LOG
  if (!file) return
  try { appendFileSync(file, `${new Date().toISOString()} ${what}\n`) } catch { /* the log is best effort */ }
}

/** Throws in read-only mode; call before writing into a repository without going through git. */
export function assertWritable(what: string): void {
  if (!READ_ONLY) return
  logBlocked(`BLOCKED write: ${what}`)
  throw new GitError(`Read-only mode: ${what} was blocked`, '', -1, [])
}

export function runGit(args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (READ_ONLY && !isReadOnlyGit(args)) {
      logBlocked(`BLOCKED git ${args.join(' ').slice(0, 300)} (in ${opts.cwd})`)
      reject(new GitError(`Read-only mode: "git ${args.slice(0, 2).join(' ')}" was blocked`, '', -1, args))
      return
    }
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      GIT_TERMINAL_PROMPT: '0',
      LANGUAGE: 'en',
      LC_ALL: 'C.UTF-8',
      GIT_OPTIONAL_LOCKS: '0',
      ...opts.env
    }
    if (opts.config?.length) {
      const base = Number(env.GIT_CONFIG_COUNT || 0)
      opts.config.forEach(([k, v], i) => {
        env[`GIT_CONFIG_KEY_${base + i}`] = k
        env[`GIT_CONFIG_VALUE_${base + i}`] = v
      })
      env.GIT_CONFIG_COUNT = String(base + opts.config.length)
    }
    let isDir = false
    try { isDir = statSync(opts.cwd).isDirectory() } catch { isDir = false }
    if (!isDir) { reject(new GitError(`Folder not found: ${opts.cwd}`, '', -1, args)); return }
    let child
    try {
      child = spawn(findGit(), [...BASE_ARGS, ...args], { cwd: opts.cwd, env, windowsHide: true })
    } catch (e) {
      reject(e)
      return
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    let errText = ''
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => {
      err.push(d)
      if (opts.onProgress) {
        errText += d.toString('utf8')
        const parts = errText.split(/[\r\n]/)
        errText = parts.pop() ?? ''
        for (const p of parts) if (p.trim()) opts.onProgress(p.trim())
      }
    })
    child.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ENOENT' ? new GitError('Git was not found. Install Git for Windows (https://git-scm.com) and restart SuperGit.', '', -1, args) : e))
    child.on('close', (code) => {
      const stdoutBuf = Buffer.concat(out)
      const res: RunResult = {
        stdout: opts.binary ? '' : stdoutBuf.toString('utf8'),
        stdoutBuf,
        stderr: Buffer.concat(err).toString('utf8'),
        code: code ?? 0
      }
      if (res.code !== 0 && !opts.allowFail) {
        const msg = (res.stderr || res.stdout).trim().split('\n').filter((l) => !/^hint:/.test(l)).join('\n')
        reject(new GitError(msg || `git ${args[0]} failed with code ${res.code}`, res.stderr, res.code, args))
      } else resolve(res)
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

const US = '\x1f'

export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s', '%b'].join('%x1f')

export function parseLog(stdout: string): Commit[] {
  const commits: Commit[] = []
  for (const rec of stdout.split('\0')) {
    if (!rec.trim()) continue
    const f = rec.replace(/^\n/, '').split(US)
    if (f.length < 10) continue
    commits.push({
      sha: f[0],
      parents: f[1] ? f[1].split(' ') : [],
      author: f[2],
      email: f[3],
      date: Number(f[4]) * 1000,
      committer: f[5],
      committerEmail: f[6],
      commitDate: Number(f[7]) * 1000,
      summary: f[8],
      body: f.slice(9).join(US).replace(/\s+$/, '')
    })
  }
  return commits
}

export const REF_FORMAT = [
  '%(refname)', '%(objectname)', '%(*objectname)', '%(upstream)', '%(upstream:track,nobracket)', '%(HEAD)', '%(contents:subject)', '%(symref)'
].join('%1f')

export function parseRefs(stdout: string): Ref[] {
  const refs: Ref[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const [name, obj, peeled, upstream, track, head, subject, symref] = line.split(US)
    if (symref) continue // e.g. refs/remotes/origin/HEAD
    const sha = peeled || obj
    if (name.startsWith('refs/heads/')) {
      const r: Ref = { name, short: name.slice(11), type: 'head', sha, isCurrent: head === '*', subject }
      if (upstream) {
        r.upstream = upstream
        r.ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0)
        r.behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0)
        r.upstreamGone = track === 'gone'
      }
      refs.push(r)
    } else if (name.startsWith('refs/remotes/')) {
      const short = name.slice(13)
      refs.push({ name, short, type: 'remote', sha, remote: short.split('/')[0], subject })
    } else if (name.startsWith('refs/tags/')) {
      refs.push({ name, short: name.slice(10), type: 'tag', sha, subject })
    }
  }
  return refs
}

export function parseStashes(stdout: string): Stash[] {
  const out: Stash[] = []
  let i = 0
  for (const rec of stdout.split('\0')) {
    if (!rec.trim()) continue
    const [sha, parents, date, msg] = rec.replace(/^\n/, '').split(US)
    out.push({ index: i++, sha, parents: parents ? parents.split(' ') : [], date: Number(date) * 1000, message: msg })
  }
  return out
}

export function parseWorktrees(stdout: string, currentPath: string): Worktree[] {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const cur = norm(currentPath)
  const list: Worktree[] = []
  for (const block of stdout.split(/\n\n+/)) {
    if (!block.trim()) continue
    const wt: Worktree = { path: '', sha: '', isMain: list.length === 0, isCurrent: false, locked: false, prunable: false, detached: false }
    for (const line of block.split('\n')) {
      const sp = line.indexOf(' ')
      const key = sp < 0 ? line : line.slice(0, sp)
      const val = sp < 0 ? '' : line.slice(sp + 1)
      if (key === 'worktree') wt.path = val
      else if (key === 'HEAD') wt.sha = val
      else if (key === 'branch') wt.branch = val.replace(/^refs\/heads\//, '')
      else if (key === 'detached') wt.detached = true
      else if (key === 'locked') wt.locked = true
      else if (key === 'prunable') wt.prunable = true
      else if (key === 'bare') wt.isMain = true
    }
    wt.isCurrent = norm(wt.path) === cur
    list.push(wt)
  }
  return list
}

export function parseRemotes(stdout: string): Remote[] {
  const map = new Map<string, Remote>()
  for (const line of stdout.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(line)
    if (!m) continue
    const r = map.get(m[1]) ?? { name: m[1], fetchUrl: '', pushUrl: '' }
    if (m[3] === 'fetch') r.fetchUrl = m[2]
    else r.pushUrl = m[2]
    map.set(m[1], r)
  }
  return [...map.values()]
}

/** Parses `git status --porcelain=v2 -z --branch --untracked-files=all` */
export function parseStatus(stdout: string): Omit<WorkingStatus, 'state'> & { branchOid?: string } {
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const conflicted: FileChange[] = []
  const tokens = stdout.split('\0')
  let branchOid: string | undefined
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t) continue
    if (t.startsWith('# branch.oid ')) branchOid = t.slice(13)
    else if (t.startsWith('1 ')) {
      const parts = t.split(' ')
      const xy = parts[1]
      const path = parts.slice(8).join(' ')
      if (xy[0] !== '.') staged.push({ path, status: xy[0] as FileStatus })
      if (xy[1] !== '.') unstaged.push({ path, status: xy[1] as FileStatus })
    } else if (t.startsWith('2 ')) {
      const parts = t.split(' ')
      const xy = parts[1]
      const path = parts.slice(9).join(' ')
      const oldPath = tokens[++i]
      if (xy[0] !== '.') staged.push({ path, oldPath, status: xy[0] as FileStatus })
      if (xy[1] !== '.') unstaged.push({ path, oldPath: xy[1] === 'R' ? oldPath : undefined, status: xy[1] as FileStatus })
    } else if (t.startsWith('u ')) {
      const parts = t.split(' ')
      conflicted.push({ path: parts.slice(10).join(' '), status: 'U' })
    } else if (t.startsWith('? ')) {
      unstaged.push({ path: t.slice(2), status: '?' })
    }
  }
  const byPath = (a: FileChange, b: FileChange) => a.path.localeCompare(b.path)
  return { staged: staged.sort(byPath), unstaged: unstaged.sort(byPath), conflicted: conflicted.sort(byPath), branchOid }
}

/** Parses `git diff-tree --name-status -z` output */
export function parseNameStatus(stdout: string): FileChange[] {
  const t = stdout.split('\0').filter((x, i, arr) => !(x === '' && i === arr.length - 1))
  const out: FileChange[] = []
  for (let i = 0; i < t.length; i++) {
    const code = t[i]
    if (!code) continue
    const s = code[0] as FileStatus
    if (s === 'R' || s === 'C') {
      out.push({ status: s, oldPath: t[i + 1], path: t[i + 2] })
      i += 2
    } else {
      out.push({ status: s, path: t[i + 1] })
      i += 1
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/** Parses a unified diff (possibly multiple files) */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = []
  const lines = text.split('\n')
  let cur: FileDiff | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      cur = { path: '', binary: false, headerLines: [line], hunks: [], isNew: false, isDeleted: false }
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
      if (m) { cur.oldPath = m[1]; cur.path = m[2] }
      files.push(cur)
      hunk = null
      continue
    }
    if (!cur) continue
    if (!hunk) {
      if (line.startsWith('@@')) {
        // fallthrough to hunk handling below
      } else {
        cur.headerLines.push(line)
        if (line.startsWith('new file mode')) cur.isNew = true
        else if (line.startsWith('deleted file mode')) cur.isDeleted = true
        else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) cur.binary = true
        else if (line.startsWith('+++ ')) { const p = line.slice(4); if (p !== '/dev/null') cur.path = p.replace(/^b\//, '') }
        else if (line.startsWith('--- ')) { const p = line.slice(4); if (p !== '/dev/null') cur.oldPath = p.replace(/^a\//, '') }
        else if (line.startsWith('rename to ')) cur.path = line.slice(10)
        else if (line.startsWith('rename from ')) cur.oldPath = line.slice(12)
        continue
      }
    }
    const hm = HUNK_RE.exec(line)
    if (hm) {
      hunk = {
        header: line,
        oldStart: Number(hm[1]), oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: Number(hm[3]), newLines: hm[4] === undefined ? 1 : Number(hm[4]),
        lines: []
      }
      oldNo = hunk.oldStart
      newNo = hunk.newStart
      cur.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    const c = line[0]
    let dl: DiffLine | null = null
    if (c === ' ') dl = { type: 'context', content: line.slice(1), oldLine: oldNo++, newLine: newNo++ }
    else if (c === '+') dl = { type: 'add', content: line.slice(1), newLine: newNo++ }
    else if (c === '-') dl = { type: 'del', content: line.slice(1), oldLine: oldNo++ }
    else if (c === '\\') dl = { type: 'nonewline', content: line }
    else if (line === '' && i === lines.length - 1) dl = null
    else if (line === '') dl = { type: 'context', content: '', oldLine: oldNo++, newLine: newNo++ }
    if (dl) hunk.lines.push(dl)
  }
  for (const f of files) if (f.oldPath === f.path) f.oldPath = undefined
  return files
}

/**
 * Builds a patch containing one hunk (or a subset of its lines).
 * mode 'stage'   : apply forward to the index (from an unstaged diff)
 * mode 'reverse' : apply with --reverse (unstage from a staged diff, or discard from an unstaged diff)
 */
export function buildPatch(file: FileDiff, hunk: DiffHunk, selected: Set<number> | null, mode: 'stage' | 'reverse'): string {
  const header = file.headerLines.filter((l) => /^(diff --git|--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode)/.test(l))
  // ensure --- / +++ exist (they are absent for pure mode changes)
  if (!header.some((l) => l.startsWith('--- '))) {
    header.push(`--- ${file.isNew ? '/dev/null' : 'a/' + (file.oldPath ?? file.path)}`)
    header.push(`+++ ${file.isDeleted ? '/dev/null' : 'b/' + file.path}`)
  }
  const body: string[] = []
  let oldCount = 0
  let newCount = 0
  hunk.lines.forEach((l, idx) => {
    const isSel = selected === null || selected.has(idx)
    if (l.type === 'context') { body.push(' ' + l.content); oldCount++; newCount++ }
    else if (l.type === 'nonewline') body.push(l.content)
    else if (l.type === 'add') {
      if (isSel) { body.push('+' + l.content); newCount++ }
      else if (mode === 'reverse') { body.push(' ' + l.content); oldCount++; newCount++ }
      else body.push('\0DROP')
    } else if (l.type === 'del') {
      if (isSel) { body.push('-' + l.content); oldCount++ }
      else if (mode === 'stage') { body.push(' ' + l.content); oldCount++; newCount++ }
      else body.push('\0DROP')
    }
  })
  // drop "\ No newline" markers that follow dropped lines
  const cleaned: string[] = []
  for (const l of body) {
    if (l === '\0DROP') { cleaned.push(l); continue }
    if (l.startsWith('\\') && cleaned[cleaned.length - 1] === '\0DROP') continue
    cleaned.push(l)
  }
  const finalBody = cleaned.filter((l) => l !== '\0DROP')
  const h = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`
  return [...header, h, ...finalBody].join('\n') + '\n'
}

/** Synthesizes a diff for an untracked/new file where every line is an addition. */
export function synthesizeAddDiff(path: string, content: string): FileDiff {
  const lines = content.length ? content.replace(/\n$/, '').split('\n') : []
  return {
    path, binary: false, isNew: true, isDeleted: false,
    headerLines: [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`],
    hunks: lines.length ? [{
      header: `@@ -0,0 +1,${lines.length} @@`, oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length,
      lines: lines.map((c, i) => ({ type: 'add' as const, content: c.replace(/\r$/, ''), newLine: i + 1 }))
    }] : []
  }
}

export function parseBlame(stdout: string): BlameLine[] {
  const info = new Map<string, { author: string; date: number; summary: string }>()
  const out: BlameLine[] = []
  const lines = stdout.split('\n')
  let cur: { sha: string; line: number } | null = null
  for (const l of lines) {
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l)
    if (head) { cur = { sha: head[1], line: Number(head[2]) }; if (!info.has(cur.sha)) info.set(cur.sha, { author: '', date: 0, summary: '' }); continue }
    if (!cur) continue
    const i = info.get(cur.sha)!
    if (l.startsWith('author ')) i.author = l.slice(7)
    else if (l.startsWith('author-time ')) i.date = Number(l.slice(12)) * 1000
    else if (l.startsWith('summary ')) i.summary = l.slice(8)
    else if (l.startsWith('\t')) { out.push({ sha: cur.sha, line: cur.line, author: i.author, date: i.date, summary: i.summary }); cur = null }
  }
  return out
}

export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/** Patterns marked `filter=lfs` in the text of a .gitattributes file. */
export function parseLfsPatterns(gitattributes: string): string[] {
  const res: string[] = []
  for (const raw of gitattributes.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    // the pattern is the first field; a quoted pattern may contain spaces
    const m = /^(?:"((?:[^"\\]|\\.)*)"|(\S+))\s+(.*)$/.exec(line)
    if (!m) continue
    if (/(^|\s)filter=lfs(\s|$)/.test(m[3])) res.push((m[1] ?? m[2]).replace(/\[\[:space:\]\]/g, ' '))
  }
  return res
}

/** GitKraken import: its per-repository settings live in `<folder name>-<md5 of the path as stored in the tab>`. */
export function repoSettingsFile(storedPath: string): string {
  const name = storedPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  return `${name}-${createHash('md5').update(storedPath).digest('hex')}`
}
