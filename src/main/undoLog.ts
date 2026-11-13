// Pure reflog logic for undo/redo (no I/O), shared with the tests.

export interface ReflogEntry { oldId: string; newId: string; timestamp: number; message: string }

export const NULL_SHA = '0'.repeat(40)
const ACTIONS = ['checkout', 'commit', 'discard', 'delete_branch', 'remove_remote', 'reset', 'rebase']
const PLAIN = ACTIONS.map((a) => new RegExp(`^${a}( \\([^:]+\\))?:`))
const UNDONE = ACTIONS.map((a) => new RegExp(`^undo: ${a}( \\([^:]+\\))?:`))
const NON_UNDOABLE_REBASE = /^rebase(?: \([^)]+\))?: [^[]/
export const ACTION = /^(\w+)( \([^:]+\))?:/
export const ACTION_NAME = /^([^:]+): ([\s\S]+)$/
export const CHECKOUT = /^moving from ([^ ]+) to ([^ ]+)/
export const RESET = /moving to ([0-9a-fA-F]+)/
export const DELETE_BRANCH = /^([^ ]+) (?:([^ [\]]+) )?/
export const REMOVE_REMOTE = /^([^ ]+) /
export const REBASE = /\[([0-9a-fA-F]+)\](?: \[([0-9a-fA-F]+)\])?/
export const SHA_IN_MESSAGE = /.*\[([0-9a-fA-F]*)\]/

export interface Config { name: 'undo' | 'redo'; prefixes: RegExp[]; supported: RegExp[]; message: (m: string) => string; original: (m: string) => string }
export const UNDO: Config = { name: 'undo', prefixes: UNDONE, supported: PLAIN, message: (m) => `undo: ${m}`, original: (m) => m }
export const REDO: Config = { name: 'redo', prefixes: PLAIN, supported: UNDONE, message: (m) => m.slice(6), original: (m) => m.slice(6) }

/** one line of .git/logs/HEAD */
export function parseLine(l: string): ReflogEntry | null {
  const tab = l.indexOf('\t')
  const head = (tab >= 0 ? l.slice(0, tab) : l).split(' ')
  if (head.length < 5) return null
  return { oldId: head[0], newId: head[1], timestamp: Number(head[head.length - 2]) || 0, message: tab >= 0 ? l.slice(tab + 1) : '' }
}

export interface Next { entry: ReflogEntry | null; valid: boolean; originalMessage?: string; undoRedoMessage?: string }
export function findNext(list: ReflogEntry[], cfg: Config): Next {
  const stack: ReflogEntry[] = []
  for (const e of list) {
    const m = e.message
    if (!m || NON_UNDOABLE_REBASE.test(m)) continue
    // `stash push` / `stash pop` log a reset that does not move HEAD: nothing to undo, and it must not hide the real last action
    if (m === 'reset: moving to HEAD' && e.oldId === e.newId) continue
    if (cfg.prefixes.some((p) => p.test(m))) { stack.push(e); continue }
    if (!cfg.supported.some((p) => p.test(m))) return { entry: e, originalMessage: cfg.original(m), valid: false }
    const msg = cfg.message(m)
    if (!stack.length) {
      const originalMessage = cfg.original(m)
      return e.oldId === NULL_SHA ? { entry: e, valid: false, originalMessage } : { entry: e, valid: true, originalMessage, undoRedoMessage: msg }
    }
    const top = stack.pop()!
    if (e.oldId !== top.newId || e.newId !== top.oldId || msg !== top.message) return { entry: e, valid: false }
  }
  return { entry: null, valid: false }
}

