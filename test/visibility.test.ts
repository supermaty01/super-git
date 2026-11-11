import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleCommits, highlightCommits, smartRefs } from '../src/renderer/src/graph/visibility.ts'

const commits = [
  { sha: 'f2', parents: ['f1'] },
  { sha: 'm2', parents: ['m1'] },
  { sha: 'f1', parents: ['m1'] },
  { sha: 'm1', parents: [] }
]
const refs = [
  { name: 'refs/heads/main', short: 'main', type: 'head' as const, sha: 'm2', isCurrent: true },
  { name: 'refs/heads/feature', short: 'feature', type: 'head' as const, sha: 'f2' },
  { name: 'refs/remotes/origin/feature', short: 'origin/feature', type: 'remote' as const, sha: 'f2', remote: 'origin' }
]
const base = { hidden: [], solo: [], showRemotes: true, showTags: true, headSha: 'm2' }

test('no filters -> everything visible', () => {
  assert.equal(visibleCommits(commits, refs, base), null)
})

test('hiding a branch hides commits only reachable from it', () => {
  const v = visibleCommits(commits, refs, { ...base, hidden: ['refs/heads/feature', 'refs/remotes/origin/feature'] })!
  assert.deepEqual([...v].sort(), ['m1', 'm2'])
})

test('hidden local branch stays visible through its remote', () => {
  const v = visibleCommits(commits, refs, { ...base, hidden: ['refs/heads/feature'] })!
  assert.ok(v.has('f2'))
})

test('solo shows only the soloed branch history', () => {
  const v = visibleCommits(commits, refs, { ...base, solo: ['refs/heads/feature'] })!
  assert.deepEqual([...v].sort(), ['f1', 'f2', 'm1'])
})

test('hiding remotes keeps local history', () => {
  const v = visibleCommits(commits, refs, { ...base, showRemotes: false })!
  assert.ok(v.has('f2') && v.has('m2'))
})

test('hovering a branch highlights its history until another branch tip', () => {
  // no branch points at m1, so both histories reach it
  const h = highlightCommits(commits, refs, ['refs/heads/feature', 'refs/remotes/origin/feature'])
  assert.deepEqual([...h].sort(), ['f1', 'f2', 'm1'])
  // a branch on m1 stops the walk there
  const withBase = [...refs, { name: 'refs/heads/base', short: 'base', type: 'head' as const, sha: 'm1' }]
  assert.deepEqual([...highlightCommits(commits, withBase, ['refs/heads/main'])].sort(), ['m2'])
  // another ref on the same tip does not dim the hovered branch
  const sameTip = [...refs, { name: 'refs/heads/release', short: 'release', type: 'head' as const, sha: 'm2' }]
  assert.deepEqual([...highlightCommits(commits, sameTip, ['refs/heads/main'])].sort(), ['m1', 'm2'])
})

test('smart visibility keeps the current branch and main branches', () => {
  assert.deepEqual(smartRefs(refs as never).sort(), ['refs/heads/main'])
})

test('a stash that is shown keeps the commits under it visible when their branch is hidden', () => {
  const commits = [{ sha: 'f2', parents: ['f1'] }, { sha: 'f1', parents: ['m'] }, { sha: 'm', parents: [] }]
  const refs = [
    { name: 'refs/heads/main', short: 'main', type: 'head' as const, sha: 'm' },
    { name: 'refs/heads/feat', short: 'feat', type: 'head' as const, sha: 'f2' }
  ]
  const base = { hidden: ['refs/heads/feat'], solo: [], showRemotes: true, showTags: true, headSha: 'm' }
  assert.deepEqual([...visibleCommits(commits, refs, base)!].sort(), ['m'])
  assert.deepEqual([...visibleCommits(commits, refs, { ...base, stashBases: ['f1'] })!].sort(), ['f1', 'm'])
  // soloing a branch shows only that branch's history, stashes or not
  assert.deepEqual([...visibleCommits(commits, refs, { ...base, hidden: [], solo: ['refs/heads/main'], stashBases: ['f1'] })!].sort(), ['m'])
})
