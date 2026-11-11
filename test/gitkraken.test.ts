import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repoSettingsFile } from '../src/main/gitcore.ts'

test('GitKraken per-repository settings file name is "<folder>-<md5 of the stored path>"', () => {
  // the stored tab path uses forward slashes and a trailing slash
  assert.equal(repoSettingsFile('C:/Projects/example-repo/'), 'example-repo-06b7e5944a03806f61aafc62c8f65963')
})
