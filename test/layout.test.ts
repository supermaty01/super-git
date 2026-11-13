import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLayout } from '../src/renderer/src/graph/layout.ts'

test('linear history stays in lane 0', () => {
  const l = computeLayout([{ sha: 'c', parents: ['b'] }, { sha: 'b', parents: ['a'] }, { sha: 'a', parents: [] }])
  assert.deepEqual(l.rows.map((r) => r.lane), [0, 0, 0])
  assert.equal(l.maxLanes, 1)
  // root commit has no bottom half line
  assert.ok(!l.rows[2].edges.some((e) => e.t === 'v' && e.lane === 0 && e.to === 1))
})

test('two branches from a fork point converge with an "in" edge', () => {
  // feature (f) and main (m) both branch from base (b)
  const l = computeLayout([
    { sha: 'f', parents: ['b'] },
    { sha: 'm', parents: ['b'] },
    { sha: 'b', parents: [] }
  ])
  assert.deepEqual(l.rows.map((r) => r.lane), [0, 1, 0])
  const base = l.rows[2]
  assert.ok(base.edges.some((e) => e.t === 'in' && e.lane === 1 && e.node === 0))
  // lane 0 passes the "m" row
  assert.ok(l.rows[1].edges.some((e) => e.t === 'v' && e.lane === 0 && e.from === 0 && e.to === 1))
})

test('merge commit sends an "out" edge to its second parent lane', () => {
  const l = computeLayout([
    { sha: 'M', parents: ['a', 'x'] },
    { sha: 'x', parents: ['a'] },
    { sha: 'a', parents: [] }
  ])
  assert.deepEqual(l.rows.map((r) => r.lane), [0, 1, 0])
  assert.ok(l.rows[0].edges.some((e) => e.t === 'out' && e.lane === 1))
  assert.ok(l.rows[2].edges.some((e) => e.t === 'in' && e.lane === 1))
})

test('WIP row draws dashed connection to HEAD', () => {
  const l = computeLayout([{ sha: 'WIP', parents: ['h'] }, { sha: 'h', parents: [] }], true)
  assert.ok(l.rows[0].edges.some((e) => e.t === 'v' && e.dashed && e.from === 0.5))
  assert.ok(l.rows[1].edges.some((e) => e.t === 'v' && e.dashed && e.to === 0.5))
})

test('freed lanes are reused', () => {
  const l = computeLayout([
    { sha: 'a2', parents: ['a1'] },
    { sha: 'b2', parents: ['b1'] },
    { sha: 'b1', parents: ['root'] },
    { sha: 'a1', parents: ['root'] },
    { sha: 'c', parents: ['root'] },
    { sha: 'root', parents: [] }
  ])
  assert.equal(l.maxLanes, 3)
})

test('pinned branch takes the left-most lane', () => {
  // main (m2->m1) and feature (f1->m1); feature is newer so it would normally get lane 0
  const commits = [
    { sha: 'f1', parents: ['m1'] },
    { sha: 'm2', parents: ['m1'] },
    { sha: 'm1', parents: [] }
  ]
  assert.deepEqual(computeLayout(commits).rows.map((r) => r.lane), [0, 1, 0])
  const pinned = computeLayout(commits, { pinnedTip: 'm2' })
  assert.deepEqual(pinned.rows.map((r) => r.lane), [1, 0, 0])
})

test('stash rows connect to their parent with a dashed line', () => {
  const l = computeLayout([{ sha: 's', parents: ['a'] }, { sha: 'a', parents: [] }], { dashedRows: new Set([0]) })
  assert.ok(l.rows[0].edges.some((e) => e.t === 'v' && e.dashed && e.from === 0.5))
})

// ---- the original's layout, row for row ----------------------------------------------------------
// Fixtures hold only the shape of two real histories (parent links + the lane the original draws each
// commit in). The large one has 2157 rows with merges, long-lived side branches and a stash.
import { readFileSync } from 'node:fs'

for (const name of ['lanes-small', 'lanes-large', 'lanes-large-2', 'lanes-stashes', 'lanes-stashes-small']) {
  test(`lanes match the original on a real history (${name})`, () => {
    const fx = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as { rows: number[][]; stash?: number[] }
    const commits = fx.rows.map(([, ...parents], i) => ({ sha: `c${i}`, parents: parents.map((p) => (p < 0 ? `below${-p}` : `c${p}`)) }))
    const got = computeLayout(commits, { dashedRows: new Set(fx.stash ?? []) }).rows.map((r) => r.lane)
    const want = fx.rows.map((r) => r[0])
    const firstBad = got.findIndex((l, i) => l !== want[i])
    assert.equal(firstBad, -1, firstBad < 0 ? '' : `row ${firstBad}: lane ${got[firstBad]}, the original uses ${want[firstBad]}`)
  })
}

test('a merge commit keeps its first parent in its own lane even when a branch tip sits further left', () => {
  // M (lane 1) reaches base first; later a new tip t opens the freed lane 0 and also starts from base
  const l = computeLayout([
    { sha: 'a', parents: ['r'] },          // lane 0
    { sha: 'M', parents: ['base', 's'] },  // lane 1, opens lane 2 for s
    { sha: 'r', parents: [] },             // lane 0 frees up
    { sha: 't', parents: ['base'] },       // lane 0
    { sha: 's', parents: ['base'] },       // lane 2
    { sha: 'base', parents: [] }
  ])
  assert.deepEqual(l.rows.map((r) => r.lane), [0, 1, 0, 0, 2, 1])
})

test('a commit stays in the lane of the branch that reached it first when the later line comes from a merge', () => {
  // tip t (lane 1) reaches base before the merge M on lane 0 does: base is drawn in lane 1
  const l = computeLayout([
    { sha: 'h', parents: ['M'] },          // lane 0
    { sha: 't', parents: ['base'] },       // lane 1 (first to reach base)
    { sha: 'M', parents: ['base', 's'] },  // lane 0, side branch in lane 2
    { sha: 's', parents: ['base'] },       // lane 2
    { sha: 'base', parents: [] }
  ])
  assert.deepEqual(l.rows.map((r) => r.lane), [0, 1, 0, 2, 1])
})

test('a plain line further left takes the commit over from a later lane', () => {
  // a (lane 0) ends; t1 opens lane 0 again after t0 took lane 1: their common parent goes to lane 0
  const l = computeLayout([
    { sha: 'a', parents: ['r'] },   // lane 0
    { sha: 't0', parents: ['p'] },  // lane 1 reaches p first
    { sha: 'r', parents: [] },      // lane 0 frees up
    { sha: 't1', parents: ['p'] },  // lane 0, reaches p later but from the left
    { sha: 'p', parents: [] }
  ])
  assert.deepEqual(l.rows.map((r) => r.lane), [0, 1, 0, 0, 0])
})

test('the work-in-progress line is not a stash: the HEAD chain keeps its lane where lines meet', () => {
  // the QA repo as the original draws it: WIP and two stashes on HEAD (main), a remote-only commit, side
  // branches and a merge. The original's lanes per row (measured): main's chain stays in lane 0 down to the
  // merge, the merged branch takes lane 1 and keeps it down to the root.
  const rows: [string, string[], number][] = [
    ['WIP', ['main'], 0], ['s1', ['main'], 1], ['s2', ['main'], 2], ['remote', ['refactor'], 3], ['main', ['integers'], 0],
    ['typo', ['refactor'], 1], ['highlight', ['basic'], 2], ['basic', ['integers'], 2], ['integers', ['refactor'], 0],
    ['coerce', ['usage'], 2], ['refactor', ['merge'], 0], ['merge', ['usage', 'logout'], 0], ['usage', ['lib'], 2],
    ['logout', ['login'], 1], ['login', ['lib'], 1], ['lib', ['pixel'], 1], ['pixel', ['v3'], 1], ['v3', ['v2'], 1],
    ['v2', ['v1'], 1], ['v1', ['init'], 1], ['init', [], 1]
  ]
  const commits = rows.map(([sha, parents]) => ({ sha, parents }))
  const l = computeLayout(commits, { dashedRows: new Set([0, 1, 2]), wipRow: 0 })
  assert.deepEqual(l.rows.map((r) => r.lane), rows.map((r) => r[2]))
  // treated as a stash, the WIP line would hand main's chain to lane 1 at "refactor"
  assert.equal(computeLayout(commits, { dashedRows: new Set([0, 1, 2]) }).rows[10].lane, 1)
})

test('a stash further left takes its commit only when it reached for it after the branch line did', () => {
  // stash above the branch line's claim (seen in a real history): the commit stays with its branch
  const before = computeLayout([
    { sha: 'stash', parents: ['base'] }, // lane 0, dashed
    { sha: 'm', parents: ['x', 'k'] },   // lane 1, merge: its first parent x keeps lane 1, k opens lane 2
    { sha: 'k', parents: ['base'] },     // lane 2
    { sha: 'x', parents: ['base'] },     // lane 1
    { sha: 'base', parents: [] }
  ], { dashedRows: new Set([0]) })
  assert.deepEqual(before.rows.map((r) => r.lane), [0, 1, 2, 1, 1])
  // stash below the branch line's claim and further left (seen in another real history): the commit moves to it
  const after = computeLayout([
    { sha: 'a', parents: ['r'] },        // lane 0
    { sha: 'k', parents: ['base'] },     // lane 1
    { sha: 'r', parents: [] },           // lane 0 frees up
    { sha: 'stash', parents: ['base'] }, // lane 0, dashed, reaches base after k did
    { sha: 'base', parents: [] }
  ], { dashedRows: new Set([3]) })
  assert.deepEqual(after.rows.map((r) => r.lane), [0, 1, 0, 0, 0])
  // with no other child the commit sits under its stash
  const alone = computeLayout([{ sha: 'stash', parents: ['base'] }, { sha: 'base', parents: [] }], { dashedRows: new Set([0]) })
  assert.deepEqual(alone.rows.map((r) => r.lane), [0, 0])
})
