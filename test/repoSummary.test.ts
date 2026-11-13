import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSummary } from '../src/shared/repoSummary.ts'

test('repository summary counts changes and reads ahead / behind', () => {
  const out = [
    '# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 a b src/a.js',
    '1 A. N... 000000 100644 100644 0 b new.js',
    '2 R. N... 100644 100644 100644 a b R100 moved.js', 'old.js',
    'u UU N... 1 2 3 4 a b c conflict.js',
    '? notes.txt', ''
  ].join('\0')
  assert.deepEqual(parseSummary(out), { branch: 'main', ahead: 2, behind: 1, modified: 3, added: 2 })
  assert.deepEqual(parseSummary('# branch.oid abc\0# branch.head (detached)\0'), { branch: null, ahead: 0, behind: 0, modified: 0, added: 0 })
})
