// Repository watcher: tells the renderer when a repository changed outside the app (git in a terminal, an editor
// saving a file…) so the graph and the WIP refresh within about a second, like the original.
//
// - fs.watch (recursive) on the working tree, plus the git dir and the shared refs of a linked worktree;
//   .git/objects, logs, lfs and lock files (index.lock churn) are ignored.
// - a watcher that errors or stops (deleted folder, EPERM, buffer trouble on Windows) is re-armed, so changes
//   are not silently missed until the app is reloaded;
// - a cheap stat poll of HEAD, the index, packed-refs and the current branch's ref catches HEAD moves even when
//   no file event arrives;
// - events are debounced (trailing 300 ms, at most 1 s while changes keep coming).
import { watch, FSWatcher, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

const IGNORE = /(^|[\\/])\.git[\\/](objects|logs|lfs)([\\/]|$)|\.lock$|(^|[\\/])node_modules([\\/]|$)|(^|[\\/])\.vs([\\/]|$)/
const DEBOUNCE = 300
const MAX_WAIT = 1000
const POLL = 1000
const REARM = 1000

interface Entry {
  path: string
  refs: number
  dirs: string[]
  gitDir: string | null
  commonDir: string | null
  list: FSWatcher[]
  timer: NodeJS.Timeout | null
  first: number
  poll: NodeJS.Timeout | null
  sig: string
  rearm: NodeJS.Timeout | null
  closed: boolean
}

export function createRepoWatcher(opts: {
  /** called with the path given to start() when the repository changed */
  onChange: (p: string) => void
  /** git rev-parse: the repository's root and git dir */
  resolve: (p: string) => Promise<{ root: string; gitDir: string } | null>
}) {
  const entries = new Map<string, Entry>()

  const fire = (e: Entry) => {
    if (e.timer) clearTimeout(e.timer)
    e.timer = null
    e.first = 0
    if (!e.closed) opts.onChange(e.path)
  }
  const notify = (e: Entry, file: string | null) => {
    if (e.closed || (file && IGNORE.test(file))) return
    const now = Date.now()
    if (!e.first) e.first = now
    if (e.timer) clearTimeout(e.timer)
    const wait = Math.max(0, Math.min(DEBOUNCE, e.first + MAX_WAIT - now))
    e.timer = setTimeout(() => fire(e), wait)
  }

  const closeWatchers = (e: Entry) => {
    for (const w of e.list) { try { w.close() } catch { /* ignore */ } }
    e.list = []
  }
  /** (re)creates the fs watchers; a failing one schedules a re-arm */
  const arm = (e: Entry) => {
    closeWatchers(e)
    if (e.closed) return
    for (const dir of e.dirs) {
      if (!existsSync(dir)) continue
      try {
        const w = watch(dir, { recursive: true }, (_ev, f) => notify(e, f ? String(f) : null))
        w.on('error', () => scheduleRearm(e))
        e.list.push(w)
      } catch {
        scheduleRearm(e)
      }
    }
  }
  const scheduleRearm = (e: Entry) => {
    if (e.closed || e.rearm) return
    e.rearm = setTimeout(() => {
      e.rearm = null
      arm(e)
      notify(e, null) // something may have changed while the watcher was down
    }, REARM)
  }

  /** a signature of the files that move when HEAD, a branch or the index changes */
  const signature = async (e: Entry): Promise<string> => {
    if (!e.gitDir) return ''
    const files = [path.join(e.gitDir, 'HEAD'), path.join(e.gitDir, 'index'), path.join(e.commonDir ?? e.gitDir, 'packed-refs'),
      path.join(e.gitDir, 'MERGE_HEAD'), path.join(e.gitDir, 'rebase-merge'), path.join(e.gitDir, 'rebase-apply')]
    const head = await fs.readFile(files[0], 'utf8').catch(() => '')
    const ref = /^ref: (.+)$/m.exec(head)?.[1]?.trim()
    if (ref) files.push(path.join(e.commonDir ?? e.gitDir, ref))
    const stats = await Promise.all(files.map((f) => fs.stat(f).then((s) => `${s.mtimeMs}:${s.size}`, () => '-')))
    return head + '|' + stats.join('|')
  }
  const startPoll = (e: Entry) => {
    const tick = async () => {
      if (e.closed) return
      const sig = await signature(e).catch(() => e.sig)
      if (e.closed) return
      if (e.sig && sig !== e.sig) notify(e, null)
      e.sig = sig
      e.poll = setTimeout(() => void tick(), POLL)
    }
    void tick()
  }

  return {
    async start(p: string): Promise<void> {
      const key = p.toLowerCase()
      const existing = entries.get(key)
      if (existing) { existing.refs++; return }
      const e: Entry = { path: p, refs: 1, dirs: [p], gitDir: null, commonDir: null, list: [], timer: null, first: 0, poll: null, sig: '', rearm: null, closed: false }
      entries.set(key, e)
      const info = await opts.resolve(p).catch(() => null)
      if (e.closed) return
      if (info) {
        e.gitDir = info.gitDir
        const commondir = (await fs.readFile(path.join(info.gitDir, 'commondir'), 'utf8').catch(() => '')).trim()
        e.commonDir = commondir ? path.resolve(info.gitDir, commondir) : info.gitDir
        // a linked worktree's git dir lives outside its folder; its branches live in the main repository
        if (!info.gitDir.toLowerCase().startsWith(p.toLowerCase())) {
          e.dirs.push(info.gitDir)
          if (existsSync(path.join(e.commonDir, 'refs'))) e.dirs.push(path.join(e.commonDir, 'refs'))
        }
      }
      arm(e)
      startPoll(e)
    },
    stop(p: string): void {
      const key = p.toLowerCase()
      const e = entries.get(key)
      if (!e || --e.refs > 0) return
      e.closed = true
      closeWatchers(e)
      for (const t of [e.timer, e.poll, e.rearm]) if (t) clearTimeout(t)
      entries.delete(key)
    }
  }
}
