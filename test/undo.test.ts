import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findNext, parseLine, UNDO, REDO, type ReflogEntry } from '../src/main/undoLog.ts'

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40), Z = '0'.repeat(40)
const e = (oldId: string, newId: string, message: string): ReflogEntry => ({ oldId, newId, timestamp: 0, message })

test('reflog lines are parsed with their message', () => {
  const r = parseLine(`${A} ${B} Ada Tester <ada@example.invalid> 1760003600 +0000\tcommit: feat: x`)
  assert.deepEqual(r, { oldId: A, newId: B, timestamp: 1760003600, message: 'commit: feat: x' })
})

test('undo offers the newest supported action, newest first', () => {
  const list = [e(A, B, 'commit: second'), e(Z, A, 'commit (initial): first')]
  const n = findNext(list, UNDO)
  assert.equal(n.valid, true)
  assert.equal(n.originalMessage, 'commit: second')
  assert.equal(n.undoRedoMessage, 'undo: commit: second')
})

test('an undone action is skipped (its undo entry pairs with it) and redo replays it', () => {
  const list = [e(B, A, 'undo: commit: second'), e(A, B, 'commit: second'), e(C, A, 'checkout: moving from dev to main')]
  const u = findNext(list, UNDO)
  assert.equal(u.valid, true)
  assert.equal(u.originalMessage, 'checkout: moving from dev to main')
  const r = findNext(list, REDO)
  assert.equal(r.valid, true)
  assert.equal(r.originalMessage, 'commit: second')
  assert.equal(r.undoRedoMessage, 'commit: second')
})

test('the no-op reset entries written by stash do not hide a merge', () => {
  const list = [e(B, B, 'reset: moving to HEAD'), e(A, B, "merge origin/main: Merge made by the 'ort' strategy."), e(A, A, 'reset: moving to HEAD')]
  const n = findNext(list, UNDO)
  assert.equal(n.valid, false)
  assert.equal(n.originalMessage, "merge origin/main: Merge made by the 'ort' strategy.")
})

test('unsupported actions (merge, pull, cherry-pick) block undo; the initial commit cannot be undone', () => {
  assert.equal(findNext([e(A, B, "merge dev: Merge made by the 'ort' strategy.")], UNDO).valid, false)
  assert.equal(findNext([e(A, B, 'pull: Fast-forward')], UNDO).originalMessage, 'pull: Fast-forward')
  assert.equal(findNext([e(Z, A, 'commit (initial): first')], UNDO).valid, false)
})

test("git's own rebase steps are skipped; a new action after an undo leaves nothing to redo", () => {
  const list = [e(A, B, 'rebase (finish): returning to refs/heads/main'), e(C, A, 'commit: x')]
  assert.equal(findNext(list, UNDO).originalMessage, 'commit: x')
  const after = [e(B, C, 'commit: new'), e(B, A, 'undo: commit: x'), e(A, B, 'commit: x')]
  assert.equal(findNext(after, REDO).valid, false)
})
