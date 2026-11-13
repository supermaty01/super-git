// Menu pieces of the "missing features" quick-win round: the ignore prompt with "Ignore and Stop Tracking",
// the folder menu of the tree view, restoring several files from a commit and copying a file's contents.
import * as A from './actions'
import { api } from './lib/api'
import { showPrompt, toast, updateRepo } from './store'
import { isInvalidRefName } from './lib/refname'
import { ignorePatterns, createFilesPatch, discardStaged } from './wipMenus'
import type { FileChange, FileContext } from '@shared/types'

const lit = (p: string) => `:(literal)${p}`
export const extSpec = (ext: string) => `:(glob)**/*${ext}`

/**
 * `Ignore '<what>'?` with the buttons `Ignore` and (when something matching is tracked) `Ignore and Stop Tracking`,
 * which also removes the files from the index.
 */
export async function promptIgnore(path: string, message: string, patterns: string[], untrack: string[], maybeTracked = true): Promise<void> {
  const tracked = maybeTracked && (await api.anyTracked(path, untrack).catch(() => false))
  showPrompt({
    kind: 'confirm', message,
    buttons: [
      { label: 'Ignore', style: 'warning', run: () => ignorePatterns(path, patterns) },
      ...(tracked ? [{
        label: 'Ignore and Stop Tracking', style: 'danger' as const,
        run: async () => { await ignorePatterns(path, patterns); await A.run(path, () => api.untrackPaths(path, untrack), { success: 'Stopped tracking the ignored files' }) }
      }] : [])
    ]
  })
}

export const ignoreFileItems = (path: string, f: FileChange, name: string, ext: string): A.MI[] => {
  const untracked = f.status === '?'
  const i = f.path.lastIndexOf('/')
  const dir = i < 0 ? '' : f.path.slice(0, i)
  return [
    { label: `Ignore '${name}'`, act: () => promptIgnore(path, `Ignore '${name}'?`, [f.path], [lit(f.path)], !untracked) },
    ...(ext ? [{ label: `All files with the extension '${ext}'`, act: () => promptIgnore(path, `Ignore '*${ext}'?`, [`*${ext}`], [extSpec(ext)]) }] : []),
    ...(dir ? [{ label: `All files in '${dir}/'`, act: () => promptIgnore(path, `Ignore '${dir}/'?`, [`${dir}/`], [lit(dir)]) }] : [])
  ]
}

export const lfsFolderItem = (path: string, file: string): A.MI[] => {
  const i = file.lastIndexOf('/')
  if (i < 0) return []
  const dir = file.slice(0, i)
  return [{ label: `Track all files in '${dir}/'`, act: () => A.run(path, () => api.lfsTrack(path, `${dir}/**`)) }]
}

/** right-click on a folder row of the tree view (uncommitted changes, a commit or a stash) */
export function dirMenu(path: string, dir: string, files: FileChange[], where: 'unstaged' | 'staged' | 'conflicted' | 'commit', ctx?: FileContext): Promise<void> {
  dir = dir.replace(/\/+$/, '')
  const name = dir.split('/').pop() ?? dir
  const abs = `${path}\\${dir.replace(/\//g, '\\')}`
  const working: A.MI[] = []
  if (where === 'conflicted') working.push({ label: 'Mark all resolved', act: () => A.markResolved(path, files.map((f) => f.path)) })
  else if (where === 'staged') {
    working.push({ label: 'Unstage folder', act: () => A.unstageFiles(path, files) })
    working.push({ label: 'Discard all changes in folder', act: () => discardStaged(path, files) })
  } else if (where === 'unstaged') {
    working.push({ label: 'Stage folder', act: () => A.stageFiles(path, files) })
    working.push({ label: 'Discard all changes in folder', act: () => A.discardFiles(path, files) })
  }
  if (where === 'unstaged' || where === 'staged') {
    working.push({ label: `Ignore all files in '${name}/'`, act: () => promptIgnore(path, `Ignore '${dir}/'?`, [`${dir}/`], [lit(dir)]) })
    working.push({ label: 'Stash folder', act: () => A.run(path, () => api.stashPaths(path, files.map((f) => f.path))) })
    working.push({ label: 'Create Patch from changes in directory', act: () => createFilesPatch(path, files.map((f) => f.path), where === 'staged') })
  }
  const exists = files.some((f) => f.status !== 'D') || where === 'commit'
  const folder: A.MI[] = exists ? [{ label: 'Open folder', act: () => api.openFile(abs) }] : []
  if (exists && (where === 'unstaged' || where === 'staged')) folder.push({ label: 'Create a file in this folder', act: () => createFileIn(path, dir) })
  void ctx
  return A.popup([...working, ...(working.length && folder.length ? ['-' as const] : []), ...folder])
}

/** "Create a file in this folder": asks for a name and creates the empty file */
export function createFileIn(path: string, dir: string): void {
  showPrompt({
    kind: 'input', message: 'New file', placeholder: 'file name', submitLabel: 'Create',
    onSubmit: (v) => {
      const n = v.trim().replace(/\\/g, '/').replace(/^\/+/, '')
      if (n) void A.run(path, () => api.writeFile(path, dir ? `${dir}/${n}` : n, ''))
    }
  })
}

/** "Restore selected files from this commit": several files at once, with the overwrite warning */
export function restoreFilesMenuItem(path: string, sha: string, files: FileChange[]): A.MI {
  const ok = files.filter((f) => f.status !== 'D')
  return {
    label: ok.length > 1 ? 'Restore selected files from this commit' : 'Restore file from this commit',
    enabled: ok.length > 0,
    act: () => {
      const run = () => A.run(path, () => api.restoreFiles(path, sha, ok.map((f) => f.path)))
      if (ok.length < 2) return run()
      showPrompt({
        kind: 'confirm',
        message: `Restoring these files from this commit will overwrite your local changes in ${ok.length} files. Are you sure you want to continue?`,
        buttons: [{ label: 'Restore', style: 'danger', run }]
      })
    }
  }
}

/** "Copy file contents to clipboard" */
export async function copyFileContents(path: string, f: FileChange, ctx?: FileContext): Promise<void> {
  try {
    const text = ctx && ctx.kind !== 'unstaged' ? (await api.fileContents(path, ctx, false)).modified : await api.readFile(path, f.path)
    await api.copy(text)
    toast({ kind: 'success', title: 'Copied!' })
  } catch (e) {
    toast({ kind: 'error', title: 'Could not copy the file contents', message: (e as Error).message })
  }
}

/** the toolbar prompt for a new branch / tag (used without the branch column): the branch one can skip the checkout */
export function promptCreateRef(path: string, kind: 'branch' | 'tag' | 'annotated-tag', sha: string): void {
  const branch = kind === 'branch'
  showPrompt({
    kind: 'input', message: branch ? 'Enter a name for the new branch:' : 'Enter a name for the new tag:', placeholder: branch ? 'branch name' : 'tag name',
    requireValue: true, submitLabel: 'Submit',
    checkbox: branch ? { label: 'Check out after creating', value: true } : undefined,
    onSubmit: async (value, checked) => {
      const n = value.trim()
      if (isInvalidRefName(n)) { toast({ kind: 'error', title: branch ? 'The given branch name is not valid' : 'The given tag name is not valid' }); return }
      if (branch && !checked) {
        await A.run(path, () => api.createBranch(path, n, sha, false), { errorTitle: 'Could not create branch', success: 'Created Successfully', successMessage: `refs/heads/${n}` })
        return
      }
      updateRepo(path, { newRef: { kind, sha } })
      await A.submitNewRef(path, n)
    }
  })
}

/**
 * Rebase a branch that is not checked out: like the original it asks to check the branch out first
 * (stashing uncommitted changes), then rebases it onto the target.
 */
export function rebaseOtherBranch(path: string, branch: string, onto: string): void {
  const st = A.snap(path).status
  const dirty = st.staged.length + st.unstaged.length > 0
  showPrompt({
    kind: 'confirm',
    message: dirty
      ? `To start the rebase, you must stash any changes and checkout branch "${branch}". Do you want to do this now?`
      : `To start the rebase, you must checkout branch "${branch}". Do you want to do this now?`,
    buttons: [{
      label: 'Yes', style: 'success',
      run: async () => {
        if (dirty) await A.run(path, () => api.stashSave(path))
        await A.run(path, () => api.checkout(path, branch), { errorTitle: 'Checkout Failed' })
        await A.rebaseOnto(path, onto)
      }
    }]
  })
}

/**
 * Opens a conflicted file in the merge tool. A file that was modified on one side and deleted on the other has
 * nothing to merge: like the original a prompt asks which version to keep.
 */
export async function openMergeOrPrompt(path: string, file: string): Promise<void> {
  const open = () => updateRepo(path, { center: { kind: 'merge', file } })
  const stages = await api.conflictStages(path, file).catch(() => [2, 3])
  if (!stages.length || (stages.includes(2) && stages.includes(3))) return open()
  const sides = await api.conflictSides(path, file).catch(() => null)
  const hasBase = stages.includes(1)
  const deletedByUs = !stages.includes(2)
  const ours = sides?.oursLabel || 'one branch'
  const theirs = sides?.theirsLabel || 'the other'
  const done = (choice: 'modified' | 'new' | 'removed' | 'base') => () => A.run(path, () => api.resolveDeleted(path, file, choice), { errorTitle: 'Could not resolve the conflict' })
  showPrompt({
    kind: 'confirm',
    message: hasBase
      ? `${file} has been modified on ${deletedByUs ? theirs : ours}, but deleted on ${deletedByUs ? ours : theirs}.`
      : `SuperGit was unable to determine whether to keep ${file}, would you like to keep it?`,
    buttons: hasBase
      ? [{ label: 'Keep Modified Version', style: 'warning', run: done('modified') }, { label: 'Delete The File', style: 'danger', run: done('removed') }, { label: 'Keep Base Version', style: 'default', run: done('base') }]
      : [{ label: 'Keep New Version', style: 'success', run: done('new') }, { label: 'Delete The File', style: 'danger', run: done('removed') }]
  })
}

/** right-click on one of several selected files of a commit */
export function commitMultiMenu(path: string, sha: string, files: FileChange[]): Promise<void> {
  return A.popup([restoreFilesMenuItem(path, sha, files)])
}
