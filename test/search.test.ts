import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchEntry, queryParts, matchesQuery } from '../src/renderer/src/lib/commitSearch.ts'

const c = (summary: string, body = '', author = 'Ada Tester', email = 'ada@example.invalid', sha = '0cc36edf91653c0c12857cf5673e832751232ef8') => searchEntry({ sha, summary, body, author, email })
const m = (q: string, e = c('feat(search): highlight results')) => matchesQuery(e, queryParts(q))

test('every typed word must start a word of the message, author or e-mail', () => {
  assert.equal(m('high'), true)
  assert.equal(m('light'), false) // not the start of a word
  assert.equal(m('search high'), true)
  assert.equal(m('search nothing'), false)
  assert.equal(m('ada'), true)
  assert.equal(m('example'), true) // e-mail words
})

test('punctuation splits words, so "2.1" needs words starting with 2 and 1', () => {
  assert.equal(m('2.1', c('chore(release): v3.2.10')), true)
  assert.equal(m('2.1', c('chore(release): v3.2.0')), false)
})

test('a hex word of four or more characters also matches the start of the sha', () => {
  assert.equal(m('0cc3'), true)
  assert.equal(m('0cc'), false)
  assert.equal(m(''), false)
})
