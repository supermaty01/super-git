import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInvalidRefName, stripSpaces } from '../src/renderer/src/lib/refname.ts'

test('invalid ref names are flagged', () => {
  for (const n of ['-start', '.dot', 'a@{b', 'a~b', 'a:b', 'my..name', 'a^b', 'a?b', 'a*b', 'a[b', 'a\\b', 'x/', '/x', 'a//b', 'a.lock', 'feature/.x', 'x.', '@'])
    assert.equal(isInvalidRefName(n), true, n)
})

test('valid and empty names are not flagged', () => {
  for (const n of ['', 'main', 'feature/login', 'qa/one', 'v1.2.3', 'a-b_c', 'fix@home'])
    assert.equal(isInvalidRefName(n), false, n)
})

test('spaces are removed', () => {
  assert.equal(stripSpaces('feature/x y'), 'feature/xy')
})
