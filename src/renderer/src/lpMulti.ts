// Ctrl+click multi-selection in the left panel (branches and stashes) and its context menus:
// "Hide N branches", "Solo N branches", "Hide N stashes", "Delete N stashes"...
import { create } from 'zustand'
import * as A from './actions'
import * as A2 from './actions2'
import { api } from './lib/api'
import { showPrompt } from './store'
import { stashKey } from './lib/format'
import type { Ref, Stash } from '@shared/types'

/** the selected rows per repository: branch rows by full ref name, stash rows by their hide key */
export const useLpSel = create<{ sel: Record<string, string[]> }>(() => ({ sel: {} }))

export const selectionOf = (path: string): string[] => useLpSel.getState().sel[path] ?? []
export const setSelection = (path: string, keys: string[]) => useLpSel.setState((s) => ({ sel: { ...s.sel, [path]: keys } }))
export const clearSelection = (path: string) => { if (selectionOf(path).length) setSelection(path, []) }
export function toggleSelection(path: string, key: string): void {
  const cur = selectionOf(path)
  setSelection(path, cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key])
}

/** right-click on one of several selected branch rows */
export function multiBranchMenu(path: string, refs: Ref[]): Promise<void> {
  const n = refs.length
  const names = refs.map((r) => r.name)
  const hidden = A2.hiddenFor(path)
  const solo = A2.soloFor(path)
  const allHidden = names.every((x) => hidden.includes(x))
  const allSolo = names.every((x) => solo.includes(x))
  return A.popup([
    { label: allHidden ? `Show ${n} branches` : `Hide ${n} branches`, act: () => A2.setHidden(path, names, !allHidden) },
    { label: allSolo ? `Stop soloing ${n} branches` : `Solo ${n} branches`, act: () => A2.setSolo(path, names, !allSolo) }
  ])
}

/** right-click on one of several selected stash rows */
export function multiStashMenu(path: string, stashes: Stash[]): Promise<void> {
  const n = stashes.length
  const keys = stashes.map((st) => stashKey(st.sha))
  const hidden = A2.hiddenFor(path)
  const allHidden = keys.every((k) => hidden.includes(k))
  return A.popup([
    { label: allHidden ? `Show ${n} stashes` : `Hide ${n} stashes`, act: () => A2.setHidden(path, keys, !allHidden) },
    { label: `Delete ${n} stashes`, act: () => showPrompt({
      kind: 'confirm', message: `This is a destructive operation, are you sure you want to delete ${n} stashes?`,
      buttons: [{ label: 'Delete', style: 'danger', run: async () => {
        // from the highest index down, so the remaining indexes stay valid
        const idx = stashes.map((st) => st.index).sort((a, b) => b - a)
        await A.run(path, async () => { for (const i of idx) await api.stashDrop(path, i) }, { errorTitle: 'Could not delete stash' })
        clearSelection(path)
      } }]
    }) }
  ])
}
