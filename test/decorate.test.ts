import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decorateHtml, colorBrackets, markRanges, wordDiff } from '../src/renderer/src/lib/decorate.ts'

test('decorations count entities as one character and keep the original markup', () => {
  const html = '<span><span class="mtk1">a&nbsp;&lt;b</span></span>'
  assert.equal(decorateHtml(html, () => null), html)
  assert.equal(markRanges(html, [[1, 3]], 'x'), '<span><span class="mtk1">a<span class="x">&nbsp;&lt;</span>b</span></span>')
})

test('brackets are coloured by depth across lines, skipping comments and strings', () => {
  const lines = [
    '<span><span class="mtk1">f(</span><span class="mtk5">"(x"</span></span>',
    '<span><span class="mtk1">[a]</span><span class="mtk8">// )</span></span>',
    '<span><span class="mtk1">)</span></span>'
  ]
  const out = colorBrackets(lines, new Set(['mtk5', 'mtk8']))
  assert.match(out[0], /f<span class="bracket-0">\(<\/span>/)
  assert.match(out[0], /"\(x"/) // inside the string: untouched
  assert.match(out[1], /<span class="bracket-1">\[<\/span>a<span class="bracket-1">\]<\/span>/)
  assert.doesNotMatch(out[1], /bracket-\d">\)/) // inside the comment
  assert.match(out[2], /<span class="bracket-0">\)<\/span>/)
})

test('word diff marks only the words that changed on each side', () => {
  const a = '.ForMember(dest => dest.MasterClientCodes, opt => opt.MapFrom(src => src.MasterClientCodes))'
  const b = '.ForMember(dest => dest.MasterClientCodes, opt => opt.MapFrom(src => MergeRecipientNames(src.MasterClientCodes, src.LegalEntityMasterClientCodes)))'
  const d = wordDiff(a, b)
  assert.deepEqual(d.removed, [])
  const added = d.added.map(([s, e]) => b.slice(s, e))
  assert.equal(added[0], 'MergeRecipientNames(')
  assert.equal(added.join('').replace(/\)/g, ''), 'MergeRecipientNames(, src.LegalEntityMasterClientCodes')
  // nothing common is marked
  assert.ok(added.every((t) => !t.includes('ForMember') && !t.includes('MapFrom')))
  const r = wordDiff('let x = 1', 'let y = 1')
  assert.deepEqual(r.removed.map(([s, e]) => 'let x = 1'.slice(s, e)), ['x'])
  assert.deepEqual(r.added.map(([s, e]) => 'let y = 1'.slice(s, e)), ['y'])
})
