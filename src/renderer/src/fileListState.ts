// File list view state shared by every file list (WIP, commit details, comparisons), like the original:
// sorting A-Z / Z-A in one list sorts them all. The Path / Tree mode is a preference (settings.fileListMode).
import { create } from 'zustand'

export const useFileSort = create<{ desc: boolean }>(() => ({ desc: false }))

export function useSortDesc(): [desc: boolean, set: (v: boolean) => void] {
  const desc = useFileSort((s) => s.desc)
  return [desc, (v) => useFileSort.setState({ desc: v })]
}
