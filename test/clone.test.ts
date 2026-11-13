import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitArgs, cloneArgs, sinceDateError } from '../src/shared/clone.ts'

test('custom flags are split like a command line', () => {
  assert.deepEqual(splitArgs(''), [])
  assert.deepEqual(splitArgs('  --no-tags   --origin up '), ['--no-tags', '--origin', 'up'])
  assert.deepEqual(splitArgs(`-c "user.name=A B" --config='x=y z'`), ['-c', 'user.name=A B', '--config=x=y z'])
  assert.deepEqual(splitArgs('""'), [''])
})

test('clone arguments follow the dialog options', () => {
  assert.deepEqual(cloneArgs('u', 'd'), ['clone', '--progress', '--', 'u', 'd'])
  assert.deepEqual(cloneArgs('u', 'd', { shallow: true }), ['clone', '--progress', '--depth', '1', '--', 'u', 'd'])
  assert.deepEqual(cloneArgs('u', 'd', { shallow: true, depth: 50, branch: ' dev ', flags: '--no-tags' }),
    ['clone', '--progress', '--depth', '50', '--branch', 'dev', '--no-tags', '--', 'u', 'd'])
  assert.deepEqual(cloneArgs('u', 'd', { shallow: true, depth: 5, since: '2024-01-31' }), ['clone', '--progress', '--shallow-since=2024-01-31', '--', 'u', 'd'])
  assert.deepEqual(cloneArgs('u', 'd', { sparse: ['src'], blobless: true }), ['clone', '--progress', '--sparse', '--filter=blob:none', '--', 'u', 'd'])
})

test('the since date must be a real past date in YYYY-MM-DD form', () => {
  const today = new Date(2026, 10, 13)
  assert.equal(sinceDateError('2026-11-13', today), '')
  assert.equal(sinceDateError('2024-02-29', today), '')
  assert.equal(sinceDateError('2023-02-29', today), "Enter a valid date in 'YYYY-MM-DD' format")
  assert.equal(sinceDateError('13/11/2026', today), "Enter a valid date in 'YYYY-MM-DD' format")
  assert.equal(sinceDateError('2026-11-14', today), 'Date cannot be in the future')
})
