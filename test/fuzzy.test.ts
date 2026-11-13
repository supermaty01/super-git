import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyMatch, fuzzyFilter } from '../src/renderer/src/lib/fuzzy.ts'
import { stepZoom } from '../src/renderer/src/lib/zoom.ts'

test('subsequence match returns the matched indices', () => {
  assert.deepEqual(fuzzyMatch('Checkout', 'chk')?.indices, [0, 1, 4])
  assert.equal(fuzzyMatch('Checkout', 'xyz'), null)
})

test('substring beats scattered match', () => {
  const r = fuzzyFilter(['Discard all changes', 'Checkout', 'Stage all changes'], 'ch', (s) => s)
  assert.equal(r[0].item, 'Checkout')
  assert.equal(r.length, 3)
})

test('zoom steps follow the original', () => {
  assert.equal(stepZoom(1.1, 1), 1.2)
  assert.equal(stepZoom(1.5, 1), 1.75)
  assert.equal(stepZoom(3, 1), 3)
  assert.equal(stepZoom(1.1, -1), 1)
  assert.equal(stepZoom(0.8, -1), 0.8)
})

test('multi-word queries match their full label', () => {
  for (const l of ['Create Tag', 'Clean up local branches', 'Stage all changes', 'Switch Theme', 'Toggle Left Panel', 'Open in default terminal', 'Create Annotated Tag'])
    assert.ok(fuzzyMatch(l, l), l)
  assert.ok(fuzzyMatch('Clean up local branches', 'Clean up local'))
  assert.ok(fuzzyMatch('Clean up local branches', 'cleanup'))
  assert.ok(fuzzyMatch('Create Annotated Tag', 'annotated tag'))
  assert.deepEqual(fuzzyMatch('Create Tag', 'create tag')?.indices, [0, 1, 2, 3, 4, 5, 7, 8, 9])
  assert.equal(fuzzyMatch('Create Tag', 'tag create'), null)
})
