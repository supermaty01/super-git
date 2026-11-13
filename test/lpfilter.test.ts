import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyMatch, parseFilter, slice, runs } from '../src/renderer/src/lib/lpfilter.ts'

test('ordered subsequence, case-insensitive', () => {
  assert.deepEqual(fuzzyMatch('feature/search', 'fsr'), [0, 8, 11])
  assert.deepEqual(fuzzyMatch('Feature', 'FEA'), [0, 1, 2])
  assert.equal(fuzzyMatch('feature/login', 'fsr'), null)
  assert.equal(fuzzyMatch('abc', 'cba'), null)
  assert.deepEqual(fuzzyMatch('anything', ''), [])
})

test('"feature/c" matches feature/conflict and feature/search', () => {
  assert.notEqual(fuzzyMatch('feature/conflict', 'feature/c'), null)
  assert.notEqual(fuzzyMatch('feature/search', 'feature/c'), null)
  assert.equal(fuzzyMatch('feature/login', 'feature/c'), null)
})

test('stash labels match the displayed text', () => {
  assert.equal(fuzzyMatch('6892387 chore: remove pixel image', 'main'), null)
  assert.notEqual(fuzzyMatch('half-done wip module', 'half'), null)
})

test('remote scoped queries', () => {
  assert.deepEqual(parseFilter('origin:', ['origin']), { remote: 'origin', text: '' })
  assert.deepEqual(parseFilter('origin/master', ['origin', 'up']), { remote: 'origin', text: 'master' })
  assert.deepEqual(parseFilter('  Origin:ma ', ['origin']), { remote: 'origin', text: 'ma' })
  assert.deepEqual(parseFilter('feature/x', ['origin']), { text: 'feature/x' })
})

test('slice and runs', () => {
  const idx = [0, 8, 11]
  assert.deepEqual([...slice(idx, 8, 6)], [0, 3])
  assert.deepEqual([...slice(idx, 0, 7)], [0])
  assert.deepEqual(runs('search', new Set([0, 3])), [{ text: 's', match: true }, { text: 'ea', match: false }, { text: 'r', match: true }, { text: 'ch', match: false }])
})
