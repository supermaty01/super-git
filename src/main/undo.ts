// Undo / redo the way the original does it: the last action is read from the HEAD reflog, merged with a small
// journal for actions git does not log (discard, delete branch, remove remote, rebase). Undoing writes an
// "undo: <original message>" entry, so a later undo skips the pair and redo replays the newest undone action.
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { g, out, tryOut, identityEnv } from './git'
import { assertWritable } from './gitcore'

import { type ReflogEntry, type Config, NULL_SHA, ACTION, ACTION_NAME, CHECKOUT, RESET, DELETE_BRANCH, REMOVE_REMOTE, REBASE, SHA_IN_MESSAGE, UNDO, REDO, parseLine, findNext } from './undoLog'
export type { ReflogEntry } from './undoLog'
import type { UndoPreview } from '../shared/types'

// ---------------------------------------------------------------------------------------------
// reading

const gitDirOf = async (cwd: string) => (await out(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
const journalFile = (dir: string) => path.join(dir, 'supergit', 'undo-journal')
const lineHash = (l: string) => createHash('sha1').update(l).digest('hex').slice(0, 12)

async function readReflogLines(dir: string): Promise<string[]> {
  try { return (await fs.readFile(path.join(dir, 'logs', 'HEAD'), 'utf8')).split('\n').filter((l) => l.trim()) } catch { return [] }
}
interface JournalEntry { t: number; head: string; msg: string; pos: number; anchor: string }
async function readJournal(dir: string): Promise<JournalEntry[]> {
  try {
    return (await fs.readFile(journalFile(dir), 'utf8')).split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as JournalEntry] } catch { return [] } })
  } catch { return [] }
}

/** HEAD reflog and journal in write order, newest first */
async function entries(dir: string): Promise<ReflogEntry[]> {
  const lines = await readReflogLines(dir)
  const journal = await readJournal(dir)
  // where each journal entry goes: after the reflog line it was written after (found again by content if the log was rewritten)
  const at = journal.map((j) => {
    if (j.pos > 0 && j.pos <= lines.length && lineHash(lines[j.pos - 1]) === j.anchor) return j.pos
    if (j.pos === 0) return 0
    const k = lines.findIndex((l) => lineHash(l) === j.anchor)
    if (k >= 0) return k + 1
    const later = lines.findIndex((l) => (parseLine(l)?.timestamp ?? 0) > j.t)
    return later < 0 ? lines.length : later
  })
  const merged: ReflogEntry[] = []
  let ji = 0
  const order = journal.map((j, i) => ({ j, at: at[i], i })).sort((a, b) => a.at - b.at || a.i - b.i)
  for (let i = 0; i <= lines.length; i++) {
    while (ji < order.length && order[ji].at <= i) { const { j } = order[ji++]; merged.push({ oldId: j.head, newId: j.head, timestamp: j.t, message: j.msg }) }
    if (i < lines.length) { const e = parseLine(lines[i]); if (e) merged.push(e) }
  }
  return merged.reverse()
}

// ---------------------------------------------------------------------------------------------
// friendly names ("Commit "fix typo"", "Checkout from "main" to "dev"")

const summaryOf = async (cwd: string, sha: string) => (await tryOut(cwd, ['log', '-1', '--format=%s', sha]))?.trim() ?? null
async function discardedPaths(cwd: string, oid: string): Promise<string[]> {
  const o = await tryOut(cwd, ['diff', '--name-only', '--no-renames', '-z', `${oid}^`, oid])
  if (o === null) throw new Error('Undo information is missing - it has likely been garbage collected.')
  return o.split('\0').filter(Boolean)
}

async function friendly(cwd: string, message: string): Promise<string> {
  const fallback = `Action with reflog message "${message}"`
  const m = message.match(ACTION_NAME)
  if (!m) return fallback
  const [, name, rest] = m
  switch (name) {
    case 'commit': return `Commit "${rest}"`
    case 'commit (amend)': return `Commit amend "${rest}"`
    case 'checkout': { const c = rest.match(CHECKOUT); return c ? `Checkout from "${c[1]}" to "${c[2]}"` : fallback }
    case 'reset': { const r = rest.match(RESET); if (!r) return fallback; const s = await summaryOf(cwd, r[1]); return s !== null ? `Reset to "${s}"` : fallback }
    case 'discard': {
      try { const p = await discardedPaths(cwd, message.match(SHA_IN_MESSAGE)?.[1] ?? ''); return p.length <= 1 ? `Discard "${p[0] ?? ''}"` : `Discard "${p[0]}" and ${p.length - 1} other file(s)` } catch { return 'Discard' }
    }
    case 'delete_branch': { const d = rest.match(DELETE_BRANCH); return d ? (d[2] ? `Delete branch "${d[1]}" tracking "${d[2]}"` : `Delete branch "${d[1]}"`) : fallback }
    case 'remove_remote': { const r = rest.match(REMOVE_REMOTE); return r ? `Remove remote "${r[1]}"` : fallback }
    case 'rebase': { const r = rest.match(REBASE); return r ? `Rebase from "${r[1]}"` : fallback }
  }
  return fallback
}

async function hasChanges(cwd: string): Promise<boolean> {
  return ((await tryOut(cwd, ['status', '--porcelain', '--untracked-files=normal'])) ?? '').trim().length > 0
}
async function busyState(dir: string): Promise<boolean> {
  return ['rebase-merge', 'rebase-apply', 'MERGE_HEAD'].some((f) => existsSync(path.join(dir, f)))
}
const branchName = async (cwd: string) => (await tryOut(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']))?.trim() || 'HEAD'

/** what Undo / Redo would do now, worded like the original's toolbar tooltips */
export async function preview(cwd: string): Promise<{ undo: UndoPreview; redo: UndoPreview }> {
  const dir = await gitDirOf(cwd)
  const list = await entries(dir)
  const busy = await busyState(dir)
  const one = async (cfg: Config): Promise<UndoPreview> => {
    const n = findNext(list, cfg)
    const f = n.originalMessage ? await friendly(cwd, n.originalMessage) : null
    const verb = cfg.name === 'undo' ? 'Undo' : 'Redo'
    if (n.valid && !busy) {
      const action = n.originalMessage!.match(ACTION)?.[1]
      const sha = n.originalMessage!.match(SHA_IN_MESSAGE)?.[1]
      const needsStash = ((action === 'reset' && sha) || action === 'rebase') && (await hasChanges(cwd)) ? await branchName(cwd) : undefined
      return { valid: true, tip: f ? `${verb} ${f}` : verb, needsStash }
    }
    if (cfg.name === 'redo') return { valid: false, tip: f ? 'No recent undo found to redo' : 'Cannot redo' }
    return { valid: false, tip: f ? `Cannot undo ${f}. Only commit (with a parent), checkout, and some discard operations are currently supported.` : 'Cannot undo' }
  }
  return { undo: await one(UNDO), redo: await one(REDO) }
}

// ---------------------------------------------------------------------------------------------
// writing

/** add a journal entry for an action git does not log (e.g. "delete_branch: x origin/x [sha]") */
export async function addJournal(cwd: string, msg: string): Promise<void> {
  assertWritable('recording undo information')
  const dir = await gitDirOf(cwd)
  const lines = await readReflogLines(dir)
  const head = (await tryOut(cwd, ['rev-parse', '-q', '--verify', 'HEAD']))?.trim() || NULL_SHA
  const e: JournalEntry = { t: Math.floor(Date.now() / 1000), head, msg, pos: lines.length, anchor: lines.length ? lineHash(lines[lines.length - 1]) : '' }
  await fs.mkdir(path.dirname(journalFile(dir)), { recursive: true })
  await fs.appendFile(journalFile(dir), JSON.stringify(e) + '\n', 'utf8')
}

/** replace the message of the newest HEAD reflog entry */
export async function rewriteLastReflogMessage(cwd: string, msg: string): Promise<void> {
  assertWritable('updating the reflog')
  const file = path.join(await gitDirOf(cwd), 'logs', 'HEAD')
  const text = await fs.readFile(file, 'utf8').catch(() => null)
  if (text === null) return
  const lines = text.split('\n')
  let i = lines.length - 1
  while (i >= 0 && !lines[i].trim()) i--
  if (i < 0) return
  const tab = lines[i].indexOf('\t')
  lines[i] = (tab >= 0 ? lines[i].slice(0, tab) : lines[i]) + '\t' + msg.replace(/\n/g, ' ')
  await fs.writeFile(file, lines.join('\n'), 'utf8')
}

/** commit of the current working state (tracked + untracked) of `paths`, parented on HEAD: what a discard throws away */
export async function snapshotPaths(cwd: string, paths: string[] | null): Promise<string | null> {
  const head = (await tryOut(cwd, ['rev-parse', '-q', '--verify', 'HEAD']))?.trim()
  if (!head) return null
  const dir = await gitDirOf(cwd)
  const index = path.join(dir, 'supergit', `discard-index-${process.pid}`)
  await fs.mkdir(path.dirname(index), { recursive: true })
  const env = { GIT_INDEX_FILE: index }
  try {
    await g(cwd, ['read-tree', head], { env })
    await g(cwd, ['add', '-A', '--', ...(paths ?? ['.'])], { env })
    const tree = (await out(cwd, ['write-tree'], { env })).trim()
    const headTree = (await out(cwd, ['rev-parse', `${head}^{tree}`])).trim()
    if (tree === headTree) return null
    return (await out(cwd, ['commit-tree', tree, '-p', head, '-m', 'SuperGit discard'], { env: await identityEnv(cwd) })).trim()
  } finally { await fs.rm(index, { force: true }) }
}

async function stashAll(cwd: string, message: string): Promise<void> {
  await g(cwd, ['stash', 'push', '--include-untracked', '-m', message])
}

async function deleteReflogEntryOfReset(cwd: string, sha: string): Promise<void> {
  const top = (await readReflogLines(await gitDirOf(cwd))).at(-1)
  if (top && parseLine(top)?.message === `reset: moving to ${sha}`) await g(cwd, ['reflog', 'delete', 'HEAD@{0}'])
}

async function headRefName(cwd: string): Promise<string> {
  return (await tryOut(cwd, ['symbolic-ref', '-q', 'HEAD']))?.trim() || 'HEAD'
}

/** runs the next undo (or redo); returns the friendly description for the toast, or null when nothing was done */
export async function apply(cwd: string, which: 'undo' | 'redo', opts: { stash?: boolean } = {}): Promise<string | null> {
  assertWritable(which)
  const cfg = which === 'undo' ? UNDO : REDO
  const dir = await gitDirOf(cwd)
  if (await busyState(dir)) return null
  const n = findNext(await entries(dir), cfg)
  if (!n.valid || !n.entry || !n.originalMessage || !n.undoRedoMessage) return null
  const entry = n.entry
  const original = n.originalMessage
  const msg = n.undoRedoMessage
  const action = original.match(ACTION)![1]
  const fr = await friendly(cwd, original)
  const isUndo = which === 'undo'
  switch (action) {
    case 'commit':
      await g(cwd, ['update-ref', '-m', msg, 'HEAD', entry.oldId])
      break
    case 'checkout': {
      const m = original.match(isUndo ? /^checkout: moving from ([^ ]*) to [^ ]*$/ : /^checkout: moving from [^ ]* to ([^ ]*)$/)
      if (!m) throw new Error('Undo information is missing - it has likely been garbage collected.')
      try { await g(cwd, ['checkout', m[1]]) } catch (e) {
        const text = (e as Error).message
        if (/did not match any file\(s\) known to git|reference is not a tree/.test(text)) throw new Error('Reference or commit to checkout was not found')
        const files = text.match(/would be overwritten by checkout:\s*\n([\s\S]*?)\n\s*Please commit/)
        if (files) { const k = files[1].split('\n').filter((l) => l.trim()).length; throw new Error(k === 1 ? '1 conflict prevents undo checkout.' : `${k} conflicts prevent undo checkout.`) }
        throw e
      }
      await rewriteLastReflogMessage(cwd, msg)
      break
    }
    case 'reset': {
      const saved = original.match(SHA_IN_MESSAGE)?.[1]
      if (saved && (await hasChanges(cwd))) {
        if (!opts.stash) return null
        await stashAll(cwd, 'Auto stash before reset')
      }
      await g(cwd, ['update-ref', '-m', msg, await headRefName(cwd), entry.oldId])
      if (!saved) break
      await g(cwd, ['reset', '--hard', '-q', entry.oldId])
      await deleteReflogEntryOfReset(cwd, entry.oldId)
      if (isUndo) await g(cwd, ['restore', '--source', saved, '--staged', '--worktree', '--', '.'])
      break
    }
    case 'rebase': {
      const m = original.match(REBASE)
      if (!m) throw new Error('Undo information is missing - it has likely been garbage collected.')
      const target = isUndo ? m[1] : entry.oldId
      if (await hasChanges(cwd)) {
        if (!opts.stash) return null
        await stashAll(cwd, `Auto stash before rebase of "${await branchName(cwd)}"`)
      }
      await g(cwd, ['update-ref', '-m', msg, await headRefName(cwd), target])
      await g(cwd, ['reset', '--hard', '-q', target])
      await deleteReflogEntryOfReset(cwd, target)
      if (isUndo && m[2]) await g(cwd, ['restore', '--source', m[2], '--staged', '--worktree', '--', '.'])
      await addJournal(cwd, msg)
      break
    }
    case 'discard': {
      const oid = original.match(SHA_IN_MESSAGE)?.[1]
      if (!oid) throw new Error('Undo information is missing - it has likely been garbage collected.')
      const paths = await discardedPaths(cwd, oid)
      if (isUndo && paths.length) {
        const dirty = ((await tryOut(cwd, ['status', '--porcelain', '-z', '--', ...paths])) ?? '').length > 0
        if (dirty) await stashAll(cwd, 'Auto stash before Undo Discard all changes')
      }
      if (paths.length) await g(cwd, ['restore', '--source', isUndo ? oid : 'HEAD', '--staged', '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: paths.join('\0') })
      await addJournal(cwd, msg)
      break
    }
    case 'delete_branch': {
      const d = original.match(/delete_branch: +([^ ]+) +([^ [\]]+)? *\[([0-9a-fA-F]+)\]/)
      if (!d) throw new Error('Undo information is missing - it has likely been garbage collected.')
      const [, name, upstream, oid] = d
      if (isUndo) {
        if ((await tryOut(cwd, ['cat-file', '-e', `${oid}^{commit}`])) === null) throw new Error('Undo information is missing - it has likely been garbage collected.')
        await g(cwd, ['branch', name, oid])
        if (upstream) await g(cwd, ['branch', `--set-upstream-to=${upstream}`, name], { allowFail: true })
      } else if ((await tryOut(cwd, ['rev-parse', '-q', '--verify', `refs/heads/${name}`])) !== null) {
        await g(cwd, ['branch', '-D', name])
      }
      await addJournal(cwd, msg)
      break
    }
    case 'remove_remote': {
      const r = original.match(/remove_remote: ([^ ]+) (\{[\s\S]*)/)
      let info: { pullUrl: string; pushUrl: string } | null = null
      try { info = r ? JSON.parse(r[2]) : null } catch { info = null }
      if (!r || !info) throw new Error('Undo information is missing - it has likely been garbage collected.')
      if (isUndo) {
        await g(cwd, ['remote', 'add', r[1], info.pullUrl])
        if (info.pushUrl && info.pushUrl !== info.pullUrl) await g(cwd, ['remote', 'set-url', '--push', r[1], info.pushUrl])
        await g(cwd, ['fetch', r[1]], { allowFail: true })
      } else await g(cwd, ['remote', 'remove', r[1]])
      await addJournal(cwd, msg)
      break
    }
    default:
      return null
  }
  return fr
}
