import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  parseCliArgs, parseSuperGitUri, repoUriPath, parseRepoLink, buildRepoLink, isLinkableRemoteUrl,
  normalizeRemoteUrl, stripPassword, remoteNameForUrl, repoNameFromRemoteUrl
} from '../src/shared/cli.ts'
import { fromNow, updateMenuItems } from '../src/main/menuText.ts'

const W = (c: string, p: string) => path.win32.resolve(c, p)
const parse = (args: string[], cwd = 'C:\\work') => parseCliArgs(args, cwd, W)

test('positional path, ".", relative paths resolve against the caller', () => {
  assert.equal(parse(['.']).path, 'C:\\work')
  assert.equal(parse(['repo\\sub']).path, 'C:\\work\\repo\\sub')
  assert.equal(parse(['..\\other'], 'C:\\work\\a').path, 'C:\\work\\other')
  assert.equal(parse(['D:\\code\\x']).path, 'D:\\code\\x')
  assert.equal(parse([]).path, undefined)
})

test('-p / --path in every spelling, and explicit flags beat the positional', () => {
  for (const args of [['-p', 'x'], ['--path', 'x'], ['--path=x'], ['-p=x'], ['-px']]) assert.equal(parse(args).path, 'C:\\work\\x', args.join(' '))
  assert.equal(parse(['y', '-p', 'x']).path, 'C:\\work\\x')
})

test('help and version flags', () => {
  assert.equal(parse(['-h']).help, true)
  assert.equal(parse(['--help']).help, true)
  assert.equal(parse(['-v']).version, true)
  assert.equal(parse(['--version']).version, true)
  assert.equal(parse(['.']).help, false)
})

test('unknown switches (Chromium, updater) are ignored', () => {
  const r = parse(['--remote-debugging-port=9486', '--disable-features=X', '--updated', 'C:\\r'])
  assert.equal(r.path, 'C:\\r')
  assert.equal(r.uri, undefined)
})

test('quotes left by Windows command lines are dropped', () => {
  assert.equal(parse(['C:\\my repo"']).path, 'C:\\my repo')
})

test('URIs: positional, -u, -e (encoded) with precedence', () => {
  assert.equal(parse(['supergit://repo/C:/x']).uri, 'supergit://repo/C:/x')
  assert.equal(parse(['supergit://repo/C:/x']).path, undefined)
  assert.equal(parse(['-u', 'supergit://repo/a']).uri, 'supergit://repo/a')
  assert.equal(parse(['--uri=supergit://repo/a', '-e', encodeURI('supergit://repo/b c')]).uri, 'supergit://repo/b c')
  assert.equal(parse(['-p', 'x', '-u', 'supergit://repo/a']).uri, 'supergit://repo/a')
  // not ours: a path
  assert.equal(parse(['gitkraken://repo/a']).uri, undefined)
})

test('supergit://repo/<path>', () => {
  const u = parseSuperGitUri('supergit://repo/C:/Users/me/my%20proj')!
  assert.equal(u.cmd, 'repo')
  assert.equal(repoUriPath(u), 'C:/Users/me/my proj')
  assert.equal(repoUriPath(parseSuperGitUri('supergit://repo/home/me/p')!, false), '/home/me/p')
  assert.equal(repoUriPath(parseSuperGitUri('supergit://repo/')!), null)
  assert.equal(parseSuperGitUri('https://repo/x'), null)
  assert.equal(parseSuperGitUri('not a uri'), null)
})

test('repolink round trip for commit, branch, tag and remote', () => {
  const sha = 'a'.repeat(40)
  const url = 'https://github.com/owner/repo.git'
  for (const link of [
    { type: 'commit' as const, firstCommitSha: sha, pullUrl: url, name: 'b'.repeat(40) },
    { type: 'branch' as const, firstCommitSha: sha, pullUrl: url, name: 'feature/a b#c' },
    { type: 'tag' as const, firstCommitSha: sha, pullUrl: url, name: 'v1.0' },
    { type: 'remote' as const, firstCommitSha: sha, pullUrl: url }
  ]) {
    const s = buildRepoLink(link)
    assert.match(s, /^supergit:\/\/repolink\//)
    assert.deepEqual(parseRepoLink(parseSuperGitUri(s)!), link, s)
  }
  assert.equal(buildRepoLink({ type: 'branch', firstCommitSha: sha, pullUrl: url, name: 'feature/x' }),
    `supergit://repolink/${sha}/branch/feature%2Fx?url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo.git`)
})

test('repolink: GitKraken-style links and invalid ones', () => {
  const p = (s: string) => parseRepoLink(parseSuperGitUri(s)!)
  assert.deepEqual(p('supergit://repolink/abc/branch/main?url=git%40github.com%3Ao%2Fr.git'), { type: 'branch', firstCommitSha: 'abc', pullUrl: 'git@github.com:o/r.git', name: 'main' })
  assert.deepEqual(p('supergit://repolink/-/tag/v1?url=https%3A%2F%2Fh%2Fr'), { type: 'tag', pullUrl: 'https://h/r', name: 'v1' })
  assert.equal(p('supergit://repolink/abc/branch/main'), null) // no url
  assert.equal(p('supergit://repolink/abc/bogus/x?url=u'), null)
  assert.equal(p('supergit://repolink/abc/commit?url=u'), null) // no sha
  assert.equal(p('supergit://repo/C:/x'), null)
})

test('remote URLs: linkable, normalized, password stripped, names', () => {
  assert.equal(isLinkableRemoteUrl('https://github.com/o/r.git'), true)
  assert.equal(isLinkableRemoteUrl('git@github.com:o/r.git'), true)
  assert.equal(isLinkableRemoteUrl('ssh://git@host:22/o/r'), true)
  assert.equal(isLinkableRemoteUrl('C:\\repos\\r'), false)
  assert.equal(isLinkableRemoteUrl('C:/repos/r'), false)
  assert.equal(isLinkableRemoteUrl('/c/repos/r'), false)
  assert.equal(isLinkableRemoteUrl('../r'), false)
  assert.equal(isLinkableRemoteUrl('file:///C:/r'), false)
  const same = ['https://github.com/Owner/Repo.git', 'git@github.com:owner/repo', 'ssh://git@github.com/owner/repo.git', 'https://user:pw@github.com/owner/repo/', 'ssh://git@github.com:22/owner/repo']
  for (const u of same) assert.equal(normalizeRemoteUrl(u), 'github.com/owner/repo', u)
  assert.equal(stripPassword('https://user:secret@host/r'), 'https://user@host/r')
  assert.equal(stripPassword('git@host:o/r'), 'git@host:o/r')
  assert.equal(repoNameFromRemoteUrl('git@github.com:owner/repo.git'), 'repo')
  assert.equal(remoteNameForUrl('https://github.com/owner/repo', ['origin']), 'owner')
  assert.equal(remoteNameForUrl('https://github.com/owner/repo', ['owner']), 'owner-2')
})

test('relative times like moment.fromNow', () => {
  const now = 1_000_000_000_000
  assert.equal(fromNow(now - 10_000, now), 'a few seconds ago')
  assert.equal(fromNow(now - 60_000, now), 'a minute ago')
  assert.equal(fromNow(now - 5 * 60_000, now), '5 minutes ago')
  assert.equal(fromNow(now - 60 * 60_000, now), 'an hour ago')
  assert.equal(fromNow(now - 3 * 3600_000, now), '3 hours ago')
  assert.equal(fromNow(now - 30 * 3600_000, now), 'a day ago')
  assert.equal(fromNow(now - 3 * 86400_000, now), '3 days ago')
})

test('File menu update entries follow the updater', () => {
  const now = 1_000_000_000_000
  const none = { lastChecked: null, errorTime: null }
  const labels = (st: Parameters<typeof updateMenuItems>[0], t = none) => updateMenuItems(st, t, now).map((i) => i.label)
  assert.deepEqual(labels({ state: 'unsupported', reason: '' }), [])
  assert.deepEqual(labels({ state: 'idle' }), ['Check for Update'])
  assert.deepEqual(labels({ state: 'none', version: '1' }, { lastChecked: now - 120_000, errorTime: null }), ['Check for Update (Last checked 2 minutes ago)'])
  assert.deepEqual(labels({ state: 'checking' }), ['Checking for updates...'])
  assert.deepEqual(labels({ state: 'downloading', version: '2', percent: 5 }), ['Downloading Update...'])
  assert.deepEqual(labels({ state: 'ready', version: '2' }), ['Restart and Install Update'])
  assert.deepEqual(labels({ state: 'error', message: 'x' }, { lastChecked: null, errorTime: now - 1000 }), ['Check for Update', 'Update Errored (a few seconds ago)'])
  assert.equal(updateMenuItems({ state: 'ready', version: '2' }, none, now)[0].action, 'install')
})
