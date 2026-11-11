import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fullDate, relTime, setDateFormat } from '../src/renderer/src/lib/format.ts'

const ms = new Date(2026, 10, 9, 14, 5).getTime() // 9 Nov 2026 14:05 local time

test('date format preference', () => {
  setDateFormat('mdy', '24h')
  assert.match(fullDate(ms), /^11\/09\/2026 @ 14:05$/)
  setDateFormat('dmy', '24h')
  assert.match(fullDate(ms), /^09\/11\/2026 @ 14:05$/)
  setDateFormat('ymd', '12h')
  assert.match(fullDate(ms), /^2026-11-09 @ 2:05\s?PM$/)
})

test('relative age matches the labels GitKraken puts on its graph time markers', () => {
  // ages measured against GitKraken on a real history, as days before "now"
  const now = new Date(2026, 10, 10, 8, 53).getTime()
  const ago = (days: number) => relTime(now - days * 86_400_000, now)
  assert.equal(relTime(new Date(2026, 10, 9, 23, 39).getTime(), now), '9 hours ago') // 9h14m, rounded down
  assert.equal(relTime(new Date(2026, 10, 9, 21, 35).getTime(), now), '11 hours ago')
  assert.equal(ago(1.61), 'yesterday')
  assert.equal(ago(2.87), '2 days ago')
  assert.equal(ago(5.41), '5 days ago')
  assert.equal(ago(7.61), 'a week ago')
  assert.equal(ago(13.53), 'a week ago')
  assert.equal(ago(14.75), '2 weeks ago')
  assert.equal(ago(21.88), '3 weeks ago')
  assert.equal(ago(29.19), '4 weeks ago')
  assert.equal(ago(30.15), '4 weeks ago') // 11 Oct: not yet a calendar month
  assert.equal(ago(31.83), 'a month ago')
  assert.equal(ago(73.56), '2 months ago')
  assert.equal(ago(92.7), '3 months ago')
  assert.equal(ago(400), 'a year ago')
})
