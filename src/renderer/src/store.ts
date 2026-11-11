import { create } from 'zustand'
import type { RepoSnapshot, Settings, TabInfo, FileContext, RebaseTodoItem } from '@shared/types'

export const MGMT_TAB = '__repo_management__'

export type Selection =
  | { kind: 'wip' }
  | { kind: 'commits'; shas: string[]; anchor: string }
  /** compare two commits, or a commit against the working directory (b = null) */
  | { kind: 'compare'; a: string; b: string | null }

export type CenterView =
  | { kind: 'graph' }
  | { kind: 'file'; ctx: FileContext; edit?: boolean; view?: 'diff' | 'file' | 'blame' | 'history' }
  | { kind: 'merge'; file: string }
  /** File History / File Blame screen: the file's commits from `sha` (HEAD when absent) */
  | { kind: 'history'; file: string; sha?: string; blame?: boolean }
  | { kind: 'rebase'; base: string | null; branch: string; items: RebaseTodoItem[]; onto?: string }

export interface RepoView {
  path: string
  snapshot: RepoSnapshot | null
  loading: boolean
  error?: string
  limit: number
  selection: Selection | null
  center: CenterView
  busy: string | null
  search: { open: boolean; query: string; hits: string[]; index: number }
  undo: { undo: import('@shared/types').UndoPreview; redo: import('@shared/types').UndoPreview }
  wip: { summary: string; description: string; amend: boolean; /** the draft to bring back when amend is turned off */ draft?: { summary: string; description: string } }
  newRef: { kind: 'branch' | 'tag' | 'annotated-tag'; sha: string } | null
  /** files multi-selected in the right panel */
  fileSel: string[]
  /** request the graph to scroll to a commit */
  focus?: { sha: string; t: number }
  /** integrated terminal panel open */
  terminal: boolean
  /** double-clicking a commit hides the right panel until the next single click (like the original) */
  detailHidden?: boolean
  /** author e-mails (lower case) the graph is filtered to; others are dimmed (like the original) */
  authorFilter?: string[]
  /** slide-out panel over the graph (Create Worktree) */
  slidey?: { kind: 'worktree'; ref: string } | null
  /** per-commit +/- stats for the Changes column (loaded on demand) */
  stats?: Record<string, import('@shared/types').CommitStat>
}

export interface Toast {
  id: number
  kind: 'error' | 'info' | 'success' | 'progress'
  title: string
  message?: string
  actions?: Array<{ label: string; run: () => void }>
}

/** Inline prompt that temporarily replaces the toolbar (rename, set upstream, confirmations...). */
export type PromptSpec =
  | { kind: 'input'; message: string; value?: string; placeholder?: string; submitLabel?: string; large?: boolean; requireValue?: boolean; extraButtons?: Array<{ label: string; style?: 'default' | 'danger' | 'success'; run: () => unknown }>; onSubmit: (value: string) => unknown }
  | { kind: 'upstream'; message: string; remotes: string[]; remote: string; branch: string; placeholder?: string; onSubmit: (remote: string, branch: string) => unknown }
  | { kind: 'confirm'; message: string; buttons: Array<{ label: string; style?: 'default' | 'danger' | 'success' | 'warning'; run: () => unknown }>; /** shows "Don't ask again"; called with its state when a button is pressed */ dontAskAgain?: (checked: boolean) => void }

export interface ModalSpec {
  kind: string
  props?: Record<string, unknown>
}

interface StoreState {
  settings: Settings | null
  tabs: TabInfo[]
  activeTab: string
  repos: Record<string, RepoView>
  toasts: Toast[]
  modal: ModalSpec | null
  progress: { repo: string; text: string } | null
  /** command palette: open (true) or opened straight into a sub-list ('repos', 'history') */
  palette: boolean | 'repos' | 'history'
  prompt: PromptSpec | null
  /** notification centre (the bell): every message shown as a toast, newest first */
  notifications: Array<Toast & { time: number }>
  unread: number
  /** the tab list dropdown (Ctrl+Shift+A) */
  tabsList: boolean
}

export const useStore = create<StoreState>(() => ({
  settings: null,
  tabs: [],
  activeTab: MGMT_TAB,
  repos: {},
  toasts: [],
  modal: null,
  progress: null,
  palette: false,
  prompt: null,
  notifications: [],
  unread: 0,
  tabsList: false
}))

export const getState = useStore.getState
export const setState = useStore.setState

export function newRepoView(path: string, limit: number): RepoView {
  return {
    path, snapshot: null, loading: true, limit, selection: null, center: { kind: 'graph' }, busy: null,
    search: { open: false, query: '', hits: [], index: 0 }, undo: { undo: { valid: false, tip: 'Cannot undo' }, redo: { valid: false, tip: 'Cannot redo' } },
    wip: { summary: '', description: '', amend: false }, newRef: null, fileSel: [], terminal: false
  }
}

export function updateRepo(path: string, patch: Partial<RepoView> | ((r: RepoView) => Partial<RepoView>)): void {
  setState((s) => {
    const cur = s.repos[path]
    if (!cur) return {}
    const p = typeof patch === 'function' ? patch(cur) : patch
    return { repos: { ...s.repos, [path]: { ...cur, ...p } } }
  })
}

export function useActiveRepo(): RepoView | null {
  return useStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTab)
    return tab ? s.repos[tab.path] ?? null : null
  })
}

export function activeRepoPath(): string | null {
  const s = getState()
  return s.tabs.find((t) => t.id === s.activeTab)?.path ?? null
}

let toastId = 1
export function toast(t: Omit<Toast, 'id'>, ttl = t.kind === 'error' ? 10000 : 4000): number {
  const id = toastId++
  setState((s) => ({
    toasts: [...s.toasts.slice(-4), { ...t, id }],
    ...(t.kind === 'progress' ? {} : { notifications: [{ ...t, id, actions: undefined, time: Date.now() }, ...s.notifications].slice(0, 100), unread: s.unread + 1 })
  }))
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl)
  // desktop notification when the window is in the background
  if (t.kind !== 'progress' && useStore.getState().settings?.desktopNotifications && !document.hasFocus()) {
    try { new Notification(t.title, { body: t.message ?? '', silent: t.kind !== 'error' }) } catch { /* not available */ }
  }
  return id
}
export function dismissToast(id: number): void {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function showPrompt(p: PromptSpec): void { setState({ prompt: p }) }
export function closePrompt(): void { setState({ prompt: null }) }

export function openModal(kind: string, props?: Record<string, unknown>): void { setState({ modal: { kind, props } }) }
export function closeModal(): void { setState({ modal: null }) }
