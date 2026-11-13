import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import {
  runGit, parseLog, LOG_FORMAT, parseRefs, REF_FORMAT, parseStatus, parseDiff, buildPatch, parseNameStatus, parseWorktrees, synthesizeAddDiff, parseLfsPatterns, isReadOnlyGit, parseTrackedFiles
} from '../src/main/gitcore.ts'

function sh(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } })
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sg-test-'))
  sh(dir, 'init', '-q', '-b', 'main')
  writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n')
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'first\n\nbody line 1\nbody line 2')
  sh(dir, 'checkout', '-qb', 'feature')
  writeFileSync(path.join(dir, 'b.txt'), 'b\n')
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'second')
  sh(dir, 'tag', '-a', 'v1', '-m', 'tag msg')
  sh(dir, 'checkout', '-q', 'main')
  return dir
}

test('parseLog reads commits with bodies', async () => {
  const dir = makeRepo()
  const r = await runGit(['log', '--all', '--date-order', '-z', `--format=${LOG_FORMAT}`], { cwd: dir })
  const commits = parseLog(r.stdout)
  assert.equal(commits.length, 2)
  assert.equal(commits[0].summary, 'second')
  assert.equal(commits[1].summary, 'first')
  assert.equal(commits[1].body, 'body line 1\nbody line 2')
  assert.deepEqual(commits[0].parents, [commits[1].sha])
})

test('parseRefs reads branches and peels annotated tags', async () => {
  const dir = makeRepo()
  const r = await runGit(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/tags'], { cwd: dir })
  const refs = parseRefs(r.stdout)
  const main = refs.find((x) => x.short === 'main')!
  const feat = refs.find((x) => x.short === 'feature')!
  const tag = refs.find((x) => x.type === 'tag')!
  assert.equal(main.isCurrent, true)
  assert.equal(feat.isCurrent, false)
  assert.equal(tag.sha, feat.sha, 'annotated tag should be peeled to its commit')
})

test('parseStatus classifies staged, unstaged and untracked files', async () => {
  const dir = makeRepo()
  writeFileSync(path.join(dir, 'a.txt'), 'changed\n')
  writeFileSync(path.join(dir, 'new.txt'), 'x\n')
  writeFileSync(path.join(dir, 'staged.txt'), 'y\n')
  sh(dir, 'add', 'staged.txt')
  const r = await runGit(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], { cwd: dir })
  const s = parseStatus(r.stdout)
  assert.deepEqual(s.staged.map((f) => [f.path, f.status]), [['staged.txt', 'A']])
  assert.deepEqual(s.unstaged.map((f) => [f.path, f.status]), [['a.txt', 'M'], ['new.txt', '?']])
})

test('partial line staging produces a patch git accepts', async () => {
  const dir = makeRepo()
  writeFileSync(path.join(dir, 'a.txt'), 'one\nTWO\nthree\nfour\nfive\nsix\nseven\nEIGHT\nnine\nten\n')
  const d = parseDiff((await runGit(['diff', '-U1', '--', 'a.txt'], { cwd: dir })).stdout)[0]
  assert.equal(d.hunks.length, 2)
  // stage only the first hunk's "+TWO" line but not its "-two"
  const h = d.hunks[0]
  const addIdx = h.lines.findIndex((l) => l.type === 'add')
  const patch = buildPatch(d, h, new Set([addIdx]), 'stage')
  await runGit(['apply', '--cached', '--recount', '-'], { cwd: dir, input: patch })
  const staged = (await runGit(['show', ':a.txt'], { cwd: dir })).stdout
  assert.equal(staged.split('\n').slice(0, 3).join('|'), 'one|two|TWO')
  // unstage that line again via reverse patch from the staged diff
  const sd = parseDiff((await runGit(['diff', '--cached', '-U1', '--', 'a.txt'], { cwd: dir })).stdout)[0]
  const rp = buildPatch(sd, sd.hunks[0], null, 'reverse')
  await runGit(['apply', '--cached', '--reverse', '--recount', '-'], { cwd: dir, input: rp })
  const staged2 = (await runGit(['show', ':a.txt'], { cwd: dir })).stdout
  assert.equal(staged2, readFileSync(path.join(dir, 'a.txt'), 'utf8').replace('TWO', 'two').replace('EIGHT', 'eight'))
})

test('discarding a single hunk from the working tree', async () => {
  const dir = makeRepo()
  writeFileSync(path.join(dir, 'a.txt'), 'one\nTWO\nthree\nfour\nfive\nsix\nseven\nEIGHT\nnine\nten\n')
  const d = parseDiff((await runGit(['diff', '-U1', '--', 'a.txt'], { cwd: dir })).stdout)[0]
  const patch = buildPatch(d, d.hunks[1], null, 'reverse')
  await runGit(['apply', '--reverse', '--recount', '-'], { cwd: dir, input: patch })
  assert.match(readFileSync(path.join(dir, 'a.txt'), 'utf8'), /TWO[\s\S]*eight/)
})

test('parseNameStatus handles renames', async () => {
  const dir = makeRepo()
  sh(dir, 'mv', 'a.txt', 'renamed.txt')
  sh(dir, 'commit', '-qm', 'rename')
  const r = await runGit(['diff-tree', '-r', '-z', '-M', '--name-status', '--no-commit-id', 'HEAD~1', 'HEAD'], { cwd: dir })
  assert.deepEqual(parseNameStatus(r.stdout), [{ status: 'R', oldPath: 'a.txt', path: 'renamed.txt' }])
})

test('parseWorktrees marks the current worktree', () => {
  const out = 'worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/repo-wt\nHEAD def\ndetached\n\n'
  const wts = parseWorktrees(out, 'C:\\repo-wt')
  assert.equal(wts.length, 2)
  assert.equal(wts[0].branch, 'main')
  assert.equal(wts[0].isMain, true)
  assert.equal(wts[1].isCurrent, true)
  assert.equal(wts[1].detached, true)
})

test('synthesizeAddDiff numbers lines', () => {
  const d = synthesizeAddDiff('x.txt', 'a\nb\n')
  assert.equal(d.hunks[0].lines.length, 2)
  assert.equal(d.hunks[0].lines[1].newLine, 2)
})

test('LFS patterns are read from .gitattributes text (never by running git lfs track)', () => {
  const text = [
    '# media',
    '*.psd filter=lfs diff=lfs merge=lfs -text',
    '*.txt text eol=lf',
    '"my assets/*.bin" filter=lfs -text',
    'docs/big[[:space:]]file.pdf filter=lfs',
    '*.png   filter=other',
    ''
  ].join('\r\n')
  assert.deepEqual(parseLfsPatterns(text), ['*.psd', 'my assets/*.bin', 'docs/big file.pdf'])
  assert.deepEqual(parseLfsPatterns(''), [])
})

test('read-only mode only lets through git commands that cannot change a repository', () => {
  const read = [
    ['log', '--all'], ['status', '--porcelain=v2'], ['diff', '--cached'], ['show', 'HEAD'], ['for-each-ref'], ['rev-parse', 'HEAD'],
    ['config', '--get', 'user.name'], ['config', '-l'], ['config', 'user.name'], ['config', '--global', 'user.email'], ['config', '-f', '.gitmodules', 'submodule.x.url'], ['worktree', 'list', '--porcelain'], ['stash', 'list'], ['remote', '-v'],
    ['symbolic-ref', '-q', '--short', 'HEAD'], ['submodule', 'status'], ['lfs', 'version'], ['branch', '--list'], ['tag', '-l'],
    ['apply', '--check', 'x.patch'], ['format-patch', '-1', '--stdout', 'HEAD'], ['blame', '--porcelain', 'a.txt'], ['cat-file', '-p', 'HEAD']
  ]
  const write = [
    ['commit', '-m', 'x'], ['add', '-A'], ['checkout', 'main'], ['switch', 'main'], ['reset', '--hard'], ['fetch', '--all'], ['pull'], ['push'],
    ['merge', 'x'], ['rebase', 'x'], ['cherry-pick', 'x'], ['revert', 'x'], ['clean', '-fd'], ['rm', 'a'], ['mv', 'a', 'b'],
    ['config', 'user.name', 'x'], ['config', '-f', '.gitmodules', 'submodule.x.url', 'u'], ['config', '--unset', 'user.name'], ['config', '--global', 'core.autocrlf', 'true'],
    ['worktree', 'add', '../x'], ['worktree', 'prune'], ['stash', 'push'], ['stash', 'pop'], ['stash', 'drop'], ['remote', 'add', 'o', 'u'],
    ['symbolic-ref', 'HEAD', 'refs/heads/x'], ['submodule', 'update'], ['lfs', 'track'], ['lfs', 'install'], ['lfs', 'pull'],
    ['branch', 'new'], ['branch', '-D', 'x'], ['tag', 'v1'], ['tag', '-d', 'v1'], ['apply', 'x.patch'], ['format-patch', '-1', 'HEAD'],
    ['update-index', '--refresh'], ['update-ref', 'refs/x', 'HEAD'], ['gc'], ['init'], ['clone', 'u'], ['credential', 'approve'], ['restore', '.'], []
  ]
  for (const a of read) assert.equal(isReadOnlyGit(a), true, `should be allowed: git ${a.join(' ')}`)
  for (const a of write) assert.equal(isReadOnlyGit(a), false, `should be blocked: git ${a.join(' ')}`)
})

test('tracked files for the file finder skip submodules and list conflicted files once', () => {
  const sha = 'a'.repeat(40)
  const raw = [
    `100644 ${sha} 0\t.gitignore`,
    `100644 ${sha} 0\t.gitmodules`,
    `100644 ${sha} 0\tREADME.md`,
    `100644 ${sha} 1\tsrc/math.js`,
    `100644 ${sha} 2\tsrc/math.js`,
    `100644 ${sha} 3\tsrc/math.js`,
    `160000 ${sha} 0\tvendor/lib`,
    `100755 ${sha} 0\tsrc/with space.sh`
  ].join('\0') + '\0'
  assert.deepEqual(parseTrackedFiles(raw), ['.gitignore', '.gitmodules', 'README.md', 'src/math.js', 'src/with space.sh'])
  assert.deepEqual(parseTrackedFiles(''), [])
})
