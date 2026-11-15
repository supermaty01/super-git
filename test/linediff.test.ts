import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { editorHunks, hunksReproduce } from '../src/main/linediff.ts'
import { parseDiff, buildPatch } from '../src/main/gitcore.ts'

const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n'

test('one changed line: git-style header, 3 lines of context, changed characters', () => {
  const a = '{\n  "name": "x",\n  "type": "module",\n  "version": "3.18.0-beta.0",\n  "private": true,\n  "sideEffects": false,\n  "engines": {\n  }\n}\n'
  const b = a.replace('beta.0', 'beta.1')
  const h = editorHunks(a, b)!
  assert.equal(h.length, 1)
  assert.equal(h[0].header, '@@ -1,7 +1,7 @@')
  const del = h[0].lines.find((l) => l.type === 'del')!
  const add = h[0].lines.find((l) => l.type === 'add')!
  assert.equal(del.oldLine, 4)
  assert.equal(add.newLine, 4)
  assert.deepEqual(del.ranges, [[26, 27]])
  assert.deepEqual(add.ranges, [[26, 27]])
  assert.equal(h[0].lines.filter((l) => l.type === 'context').length, 6)
})

test('nearby changes share a hunk, distant ones do not', () => {
  const a = lines(40)
  const near = a.replace('line 5\n', 'five\n').replace('line 11\n', 'eleven\n')
  assert.equal(editorHunks(a, near)!.length, 1)
  const far = a.replace('line 5\n', 'five\n').replace('line 30\n', 'thirty\n')
  const h = editorHunks(a, far)!
  assert.equal(h.length, 2)
  assert.equal(h[1].header, '@@ -27,7 +27,7 @@')
})

test('pure insertions and deletions carry no character ranges', () => {
  const a = lines(10)
  const h = editorHunks(a, a.replace('line 5\n', 'line 5\nnew\n'))!
  assert.equal(h[0].header, '@@ -3,6 +3,7 @@')
  const add = h[0].lines.find((l) => l.type === 'add')!
  assert.equal(add.content, 'new')
  assert.equal(add.ranges, undefined)
  const top = editorHunks('x\n', 'a\nb\nx\n')!
  assert.equal(top[0].header, '@@ -1 +1,3 @@')
  const gone = editorHunks('a\nb\nx\n', 'x\n')!
  assert.equal(gone[0].header, '@@ -1,3 +1 @@')
  assert.equal(editorHunks('', 'a\n'), null)
})

test('a missing final newline is a change and gets the marker', () => {
  const h = editorHunks('a\nb\nc', 'a\nb\nc\n')!
  assert.equal(h.length, 1)
  assert.deepEqual(h[0].lines.map((l) => l.type), ['context', 'context', 'del', 'nonewline', 'add'])
  const same = editorHunks('a\nb\nc', 'A\nb\nc')!
  assert.deepEqual(same[0].lines.map((l) => l.type), ['del', 'add', 'context', 'context', 'nonewline'])
})

test('hunksReproduce accepts git hunks of the same texts and rejects filtered ones', () => {
  const a = lines(20), b = a.replace('line 7\n', 'seven\n')
  const hunks = editorHunks(a, b)!
  assert.ok(hunksReproduce(a, b, hunks))
  // CRLF in the working tree while git compared LF text (core.autocrlf)
  assert.ok(!hunksReproduce(a, b.replace(/\n/g, '\r\n'), hunks))
})

function sh(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } })
}

test('editor hunks build patches git applies (stage each hunk, then the index matches the file)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sg-linediff-'))
  sh(dir, 'init', '-q', '-b', 'main')
  const before = lines(60, (i) => (i % 7 === 0 ? `  }` : `  value(${i})`))
  writeFileSync(path.join(dir, 'f.txt'), before)
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'one')
  const after = before.replace('value(3)', 'value(33)').replace('  value(20)\n', '').replace('value(41)', 'other(41)\n  added').replace(/value\(59\)\n.*\n$/, 'value(59)\nend')
  writeFileSync(path.join(dir, 'f.txt'), after)
  const file = parseDiff(sh(dir, 'diff', '-U3', '--', 'f.txt'))[0]
  assert.ok(hunksReproduce(before, after, file.hunks))
  const hunks = editorHunks(before, after)!
  // stage from the last hunk up so earlier line numbers stay valid
  for (const h of [...hunks].reverse()) execFileSync('git', ['apply', '--cached', '--recount', '-'], { cwd: dir, input: buildPatch(file, h, null, 'stage') })
  assert.equal(sh(dir, 'show', ':f.txt'), readFileSync(path.join(dir, 'f.txt'), 'utf8'))
})
