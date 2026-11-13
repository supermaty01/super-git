import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCleanupRows, deleteButtonLabel, branchCountLabel, remoteWarning, nextCleanupSort, DEFAULT_CLEANUP_SORT,
  matchesRules, pickConflictTarget, parseMergeTree, conflictRanges, parseHostKeyChanged, parseSslProblem
} from '../src/shared/k2logic.ts'

const DAY = 86400000
const now = new Date(2026, 10, 13, 15, 0, 0).getTime()
const br = (name: string, daysAgo: number, o: { merged?: boolean; upstream?: 'local' | 'remote' } = {}) => ({
  name, fullName: `refs/heads/${name}`, sha: name, lastCommitDate: now - daysAgo * DAY, merged: !!o.merged,
  upstream: o.upstream === 'local' ? { type: 'local' as const } : o.upstream === 'remote' ? { type: 'remote' as const, remoteName: 'origin', branchName: name } : null
})

test('cleanup: older-than, upstream and merge filters; selected rows stay pinned', () => {
  const branches = [br('old', 60, { merged: true, upstream: 'remote' }), br('older', 90), br('new', 2, { merged: true }), br('mid', 30)]
  const base = { branches, daysOld: 30, now, selected: new Set<string>(), sort: DEFAULT_CLEANUP_SORT, upstream: 'all' as const, merge: 'all' as const }
  assert.deepEqual(buildCleanupRows(base).matching.map((b) => b.name), ['mid', 'old', 'older'])
  assert.deepEqual(buildCleanupRows({ ...base, upstream: 'hasUpstream' }).matching.map((b) => b.name), ['old'])
  assert.deepEqual(buildCleanupRows({ ...base, upstream: 'noUpstream' }).matching.map((b) => b.name), ['mid', 'older'])
  assert.deepEqual(buildCleanupRows({ ...base, merge: 'merged' }).matching.map((b) => b.name), ['old'])
  const r = buildCleanupRows({ ...base, merge: 'unmerged', selected: new Set(['new', 'old']) })
  assert.deepEqual(r.matching.map((b) => b.name), ['mid', 'older'])
  assert.deepEqual(r.pinned.map((b) => b.name), ['new', 'old'])
  assert.deepEqual(buildCleanupRows({ ...base, sort: { columnId: 'branch', direction: 'asc' } }).matching.map((b) => b.name), ['mid', 'old', 'older'])
  assert.deepEqual(buildCleanupRows({ ...base, daysOld: 1 }).matching.length, 4)
})

test('cleanup: labels and sort toggling', () => {
  assert.equal(deleteButtonLabel(0, 0), 'Select Branches to Delete')
  assert.equal(deleteButtonLabel(1, 0), 'Delete 1 local branch')
  assert.equal(deleteButtonLabel(3, 0), 'Delete 3 local branches')
  assert.equal(deleteButtonLabel(1, 1), 'Delete 1 local branch (and 1 remote branch)')
  assert.equal(deleteButtonLabel(3, 2), 'Delete 3 local branches (and 2 remote branches)')
  assert.equal(branchCountLabel(1), '1 branch matching filters')
  assert.equal(branchCountLabel(4), '4 branches matching filters')
  assert.equal(remoteWarning(2), 'Warning: 2 remote branches will be deleted. This cannot be undone.')
  assert.deepEqual(nextCleanupSort(DEFAULT_CLEANUP_SORT, 'lastCommit'), { columnId: 'lastCommit', direction: 'asc' })
  assert.deepEqual(nextCleanupSort(DEFAULT_CLEANUP_SORT, 'branch'), { columnId: 'branch', direction: 'asc' })
})

test('conflict prevention: base branch rules', () => {
  assert.ok(matchesRules('origin/main', []))
  assert.ok(matchesRules('origin/main', ['**']))
  assert.ok(matchesRules('origin/main', ['origin/main']))
  assert.ok(!matchesRules('origin/dev', ['origin/main']))
  assert.ok(matchesRules('origin/feature/a/b', ['origin/feature/**']))
  assert.ok(!matchesRules('origin/abc', ['origin/**', '!origin/abc']))
  assert.ok(matchesRules('origin/abcd', ['origin/**', '!origin/abc']))
  assert.ok(!matchesRules('upstream/main', ['!upstream']))
  assert.ok(!matchesRules('origin/main', ['!refs/remotes/origin'], true))
  assert.ok(matchesRules('main', ['!refs/remotes/origin'], false))
})

test('conflict prevention: picks the closest base branch', () => {
  const rows = [
    { name: 'main', remote: false, ahead: 4, behind: 3 },
    { name: 'origin/main', remote: true, ahead: 5, behind: 3 },
    { name: 'origin/feature', remote: true, ahead: 0, behind: 1 },
    { name: 'feature', remote: false, ahead: 0, behind: 0 },
    { name: 'other', remote: false, ahead: 2, behind: 3 },
    { name: 'child', remote: false, ahead: 2, behind: 0 }
  ]
  assert.equal(pickConflictTarget(rows, 'feature', 'origin/feature')?.name, 'origin/main')
  assert.equal(pickConflictTarget(rows.filter((r) => !r.name.includes('main')), 'feature', 'origin/feature')?.name, 'other')
  assert.equal(pickConflictTarget([{ name: 'child', remote: false, ahead: 1, behind: 0 }], 'feature', ''), null)
  assert.equal(pickConflictTarget([{ name: 'merged', remote: false, ahead: 0, behind: 2 }, { name: 'topic', remote: false, ahead: 1, behind: 3 }], 'main', 'origin/main')?.name, 'topic')
})

test('conflict prevention: merge-tree output and conflict line ranges', () => {
  const out = 'abc123\n100644 1111 1\tsrc/a.txt\n100644 2222 2\tsrc/a.txt\n100644 3333 3\tsrc/a.txt\n100644 4444 2\tb.md\n\n'
  assert.deepEqual(parseMergeTree(out), { tree: 'abc123', files: ['src/a.txt', 'b.md'] })
  assert.deepEqual(parseMergeTree('abc123\n'), { tree: 'abc123', files: [] })
  const text = ['a', '<<<<<<< HEAD', 'x', '=======', 'y', '>>>>>>> main', 'b', '<<<<<<< HEAD', '>>>>>>> main'].join('\n')
  assert.deepEqual(conflictRanges(text), [[2, 6], [8, 9]])
})

test('auth: host key changed and SSL certificate errors', () => {
  const hk = '@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n...\nOffending ECDSA key in /c/Users/x/.ssh/known_hosts:3\nHost key for github.com has changed and you have requested strict checking.\nHost key verification failed.'
  assert.deepEqual(parseHostKeyChanged(hk), { host: 'github.com' })
  assert.deepEqual(parseHostKeyChanged(hk.replace('github.com', '[git.example.com]:2222')), { host: '[git.example.com]:2222' })
  assert.equal(parseHostKeyChanged('Permission denied (publickey).'), null)
  const ssl = "fatal: unable to access 'https://git.corp.local/team/repo.git/': SSL certificate problem: self-signed certificate in certificate chain"
  assert.deepEqual(parseSslProblem(ssl), { url: 'https://git.corp.local/', problem: 'SSL certificate problem: self-signed certificate in certificate chain' })
  assert.equal(parseSslProblem('fatal: repository not found'), null)
})

test('localized schannel certificate errors are recognised by their code', () => {
  const r = parseSslProblem("fatal: unable to access 'https://self-signed.badssl.com/x.git/': schannel: SEC_E_UNTRUSTED_ROOT (0x80090325) - La cadena de certificaci�n fue emitida por una entidad en la que no se conf�a.")
  assert.equal(r?.url, 'https://self-signed.badssl.com/')
  assert.equal(parseSslProblem("fatal: unable to access 'https://x/': schannel: failed to receive handshake"), null)
})
