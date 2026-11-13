import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayOrder, neighbour, stageOptimistic, unstageOptimistic, discardOptimistic, stageAllOptimistic, unstageAllOptimistic } from '../src/renderer/src/lib/wipStatus.ts'
import type { FileChange, WorkingStatus } from '../src/shared/types.ts'

const st = (staged: FileChange[], unstaged: FileChange[]): WorkingStatus => ({ staged, unstaged, conflicted: [], state: { kind: 'none' } } as WorkingStatus)
const paths = (l: FileChange[]) => l.map((f) => `${f.status} ${f.path}`)

test('display order: path mode sorts case-insensitively, Z-A reverses', () => {
  const files: FileChange[] = [{ path: 'notes.txt', status: '?' }, { path: 'README.md', status: 'M' }, { path: 'src/math.js', status: 'M' }]
  assert.deepEqual(displayOrder(files, 'path').map((f) => f.path), ['notes.txt', 'README.md', 'src/math.js'])
  assert.deepEqual(displayOrder(files, 'path', true).map((f) => f.path), ['src/math.js', 'README.md', 'notes.txt'])
})

test('display order: tree mode lists folders first', () => {
  const files: FileChange[] = [{ path: 'b.txt', status: 'M' }, { path: 'src/a.js', status: 'M' }, { path: 'docs/x/y.md', status: 'A' }]
  assert.deepEqual(displayOrder(files, 'tree').map((f) => f.path), ['docs/x/y.md', 'src/a.js', 'b.txt'])
  assert.deepEqual(displayOrder(files, 'tree', false, (d) => d === 'src/').map((f) => f.path), ['docs/x/y.md', 'b.txt'])
})

test('neighbour: next row, else the previous one, else none', () => {
  const order: FileChange[] = ['a', 'b', 'c'].map((p) => ({ path: p, status: 'M' }))
  assert.equal(neighbour(order, 'a', new Set(['b', 'c'])), 'b')
  assert.equal(neighbour(order, 'c', new Set(['a', 'b'])), 'b')
  assert.equal(neighbour(order, 'b', new Set([])), null)
})

test('optimistic staging moves rows and keeps partly staged files once', () => {
  const s = st([{ path: 'new.js', status: 'A' }], [{ path: 'new.js', status: 'M' }, { path: 'u.txt', status: '?' }, { path: 'gone.md', status: 'D' }])
  const a = stageOptimistic(s, [{ path: 'new.js', status: 'M' }, { path: 'u.txt', status: '?' }])
  assert.deepEqual(paths(a.staged), ['A new.js', 'A u.txt'])
  assert.deepEqual(paths(a.unstaged), ['D gone.md'])
  assert.deepEqual(paths(stageAllOptimistic(s).staged), ['A new.js', 'A u.txt', 'D gone.md'])
})

test('optimistic unstaging: added files go back to untracked', () => {
  const s = st([{ path: 'new.js', status: 'A' }, { path: 'm.js', status: 'M' }, { path: 'b.js', oldPath: 'a.js', status: 'R' }], [{ path: 'm.js', status: 'M' }])
  const u = unstageAllOptimistic(s)
  assert.deepEqual(u.staged, [])
  assert.deepEqual(paths(u.unstaged), ['M m.js', '? new.js', 'D a.js', '? b.js'])
  assert.deepEqual(paths(unstageOptimistic(s, [{ path: 'm.js', status: 'M' }]).staged), ['A new.js', 'R b.js'])
})

test('optimistic discard drops the unstaged rows only', () => {
  const s = st([{ path: 'm.js', status: 'M' }], [{ path: 'm.js', status: 'M' }, { path: 'x', status: '?' }])
  const d = discardOptimistic(s, [{ path: 'm.js', status: 'M' }])
  assert.deepEqual(paths(d.unstaged), ['? x'])
  assert.deepEqual(paths(d.staged), ['M m.js'])
})
