// Commit panel context-menu pieces that follow the original: the menu for several selected working files,
// "Discard changes" on a staged file, ignoring files / folders, and a patch from several files.
import * as A from './actions'
import { api } from './lib/api'
import { showPrompt } from './store'
import { runStaging } from './staging'
import { promptIgnore } from './quickMenus'
import type { FileChange } from '@shared/types'

/** Right-click on one of several selected rows: `Stage N files | Discard N files | Ignore N files | Stash N files | --- | Create patch from changes in N files` */
export function multiFileMenu(path: string, files: FileChange[], where: 'unstaged' | 'staged'): Promise<void> {
  const n = files.length
  return A.popup([
    where === 'unstaged'
      ? { label: `Stage ${n} files`, act: () => A.stageFiles(path, files) }
      : { label: `Unstage ${n} files`, act: () => A.unstageFiles(path, files) },
    { label: `Discard ${n} files`, act: () => (where === 'unstaged' ? A.discardFiles(path, files) : discardStaged(path, files)) },
    { label: `Ignore ${n} files`, act: () => promptIgnore(path, `Ignore ${n} files?`, files.map((f) => f.path), files.map((f) => `:(literal)${f.path}`), files.some((f) => f.status !== '?')) },
    { label: `Stash ${n} files`, act: () => A.run(path, () => api.stashPaths(path, files.map((f) => f.path))) },
    '-',
    { label: `Create patch from changes in ${n} files`, act: () => createFilesPatch(path, files.map((f) => f.path), where === 'staged') }
  ])
}

/** "Discard changes" on staged files: back to HEAD, index and working tree (new files are removed) */
export function discardStaged(path: string, files: FileChange[]): void {
  const keys = new Set(files.map((f) => f.path))
  showPrompt({
    kind: 'confirm',
    message: files.length === 1
      ? `This will permanently discard all changes to "${files[0].path}". Are you sure you want to continue?`
      : 'This will permanently discard all changes to the selected files. Are you sure you want to continue?',
    buttons: [{
      label: 'Discard Changes', style: 'danger',
      run: () => runStaging(path, async () => {
        await api.unstage(path, files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])))
        // after unstaging, an added file is untracked and a rename is a new file plus a deleted one
        await api.discardFiles(path, files.flatMap((f): FileChange[] => f.status === 'A' ? [{ path: f.path, status: '?' }]
          : f.status === 'R' && f.oldPath ? [{ path: f.path, status: '?' }, { path: f.oldPath, status: 'D' }] : [{ path: f.path, status: f.status }]))
      }, (st) => ({ ...st, staged: st.staged.filter((f) => !keys.has(f.path)), unstaged: st.unstaged.filter((f) => !keys.has(f.path)) }))
    }]
  })
}

/** appends patterns to .gitignore */
export async function ignorePatterns(path: string, patterns: string[]): Promise<void> {
  const cur = await api.readFile(path, '.gitignore').catch(() => '')
  const next = `${cur.replace(/\s*$/, '')}${cur.trim() ? '\n' : ''}${patterns.join('\n')}\n`
  await A.run(path, () => api.writeFile(path, '.gitignore', next), { success: patterns.length === 1 ? `Added ${patterns[0]} to .gitignore` : `Added ${patterns.length} files to .gitignore` })
}

export async function createFilesPatch(path: string, files: string[], staged: boolean): Promise<void> {
  const out = await api.pickSaveFile('Save patch', `${path}/../changes.patch`, [{ name: 'Patch', extensions: ['patch', 'diff'] }])
  if (out) await A.run(path, () => api.createFilesPatch(path, files, staged, out), { refresh: false, success: 'Patch saved' })
}
