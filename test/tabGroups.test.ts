import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commonGitDir, groupedOrder, groupRuns } from '../src/renderer/src/lib/tabGroups.ts'

test('worktree git dirs map to the repository git dir', () => {
  assert.equal(commonGitDir('C:\\r\\.git'), 'c:\\r\\.git')
  assert.equal(commonGitDir('C:\\r\\.git\\worktrees\\wt1'), 'c:\\r\\.git')
  assert.equal(commonGitDir('/r/.git/worktrees/wt1/'), '/r/.git')
})

test('tabs of one repository are moved next to its first tab', () => {
  const keys: Record<string, string | undefined> = { a: 'r1', b: 'r2', c: undefined, d: 'r1', e: 'r3' }
  const tabs = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))
  const order = groupedOrder(tabs, (t) => keys[t.id]).map((t) => t.id)
  assert.deepEqual(order, ['a', 'd', 'b', 'c', 'e'])
  const runs = groupRuns(order.map((id) => ({ id })), (t) => keys[t.id])
  assert.deepEqual(runs, [{ key: 'r1', start: 0, end: 2 }, { key: undefined, start: 2, end: 3 }, { key: undefined, start: 3, end: 4 }, { key: undefined, start: 4, end: 5 }])
})
