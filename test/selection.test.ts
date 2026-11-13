import { test } from 'node:test'
import assert from 'node:assert/strict'
import { topoRange } from '../src/renderer/src/graph/range.ts'
import { ghostSources } from '../src/renderer/src/graph/ghost.ts'
import { ancestors, childrenOnPath, hasInteractiveRebaseSteps } from '../src/renderer/src/graph/history.ts'

// the QA repo (newest first), as the original draws it with WIP and two stashes on main
const QA: [string, string[], string[]][] = [
  ['WIP', ['main'], []], ['s1', ['main'], []], ['s2', ['main'], []],
  ['remote', ['refactor'], ['origin/main']], ['main', ['integers'], ['main']], ['typo', ['refactor'], ['bugfix/typo']],
  ['highlight', ['basic'], ['feature/search']], ['basic', ['integers'], ['origin/feature/search']], ['integers', ['refactor'], []],
  ['coerce', ['usage'], ['feature/conflict', 'origin/release/1.0']], ['refactor', ['merge'], []], ['merge', ['usage', 'logout'], []],
  ['usage', ['lib'], []], ['logout', ['login'], ['feature/login']], ['login', ['lib'], []], ['lib', ['pixel'], []],
  ['pixel', ['v3'], []], ['v3', ['v2'], []], ['v2', ['v1'], []], ['v1', ['init'], []], ['init', [], []]
]
const rows = QA.map(([sha, parents]) => ({ sha, parents }))

test('shift-click selects the commits topologically between the two', () => {
  assert.deepEqual(topoRange(rows, 'typo', 'usage'), ['typo', 'refactor', 'merge', 'usage'])
  assert.deepEqual(topoRange(rows, 'usage', 'typo'), ['typo', 'refactor', 'merge', 'usage'])
  // unrelated lines: only the two commits
  assert.deepEqual(topoRange(rows, 'coerce', 'merge'), ['coerce', 'merge'])
  // one first-parent line: every row between
  assert.deepEqual(topoRange(rows, 'v3', 'init'), ['v3', 'v2', 'v1', 'init'])
  assert.deepEqual(topoRange(rows, 'main', 'main'), ['main'])
})

test('context menu history questions match the original on the QA repo', () => {
  const commits = rows.filter((r) => !['WIP', 's1', 's2'].includes(r.sha))
  // "Interactive Rebase N children of X"
  assert.equal(childrenOnPath(commits, 'main', 'refactor'), 2)
  assert.equal(childrenOnPath(commits, 'main', 'merge'), 3)
  assert.equal(childrenOnPath(commits, 'main', 'main'), null)
  assert.equal(childrenOnPath(commits, 'main', 'usage'), null)
  assert.equal(childrenOnPath(commits, 'main', 'typo'), null)
  // "Interactive Rebase main onto X": only for origin/feature/search, not feature/conflict or feature/login
  assert.equal(hasInteractiveRebaseSteps(commits, 'main', 'basic'), true)
  assert.equal(hasInteractiveRebaseSteps(commits, 'main', 'coerce'), false)
  assert.equal(hasInteractiveRebaseSteps(commits, 'main', 'logout'), false)
  assert.equal(hasInteractiveRebaseSteps(commits, 'main', 'main'), false)
  assert.ok(ancestors(commits, 'main').has('init'))
  assert.ok(!ancestors(commits, 'main').has('coerce'))
})

test('ghost labels come from the first-parent child highest in the graph, like the original', () => {
  const src = ghostSources(QA.map(([sha, parents, refs]) => ({ sha, parents, branch: refs.length > 0 })))
  const ghost = (sha: string) => { const i = src[QA.findIndex((r) => r[0] === sha)]; return i < 0 ? null : QA[i][2][0] }
  // measured in the original
  assert.equal(ghost('integers'), 'main')
  assert.equal(ghost('refactor'), 'origin/main')
  assert.equal(ghost('merge'), 'origin/main')
  assert.equal(ghost('usage'), 'feature/conflict')
  assert.equal(ghost('login'), 'feature/login')
  assert.equal(ghost('lib'), 'feature/conflict')
  assert.equal(ghost('pixel'), 'feature/conflict')
  assert.equal(ghost('v1'), 'feature/conflict')
  assert.equal(ghost('init'), 'feature/conflict')
  assert.equal(ghost('WIP'), null)
})
