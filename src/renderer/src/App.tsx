import { useEffect } from 'react'
import { useStore, MGMT_TAB, getState, setState, activeRepoPath } from './store'
import * as A from './actions'
import { api } from './lib/api'
import { TabsBar } from './components/TabsBar'
import { RepoScreen } from './components/RepoScreen'
import { RepoManagement } from './components/RepoManagement'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { TooltipLayer } from './components/Tooltip'
import { Modals } from './components/Modals'
import { CommandPalette } from './components/CommandPalette'
import { applyTheme } from './components/PrefsModal'
import { setAvatarMode } from './lib/avatar'
import { setDateFormat } from './lib/format'
import { setEditorPrefs } from './lib/monaco'
import * as A2 from './actions2'
import { openModal } from './store'

/** Commands from the application menu (and a few shortcuts that share them). */
export function runCommand(cmd: string): void {
  const s = getState()
  const path = activeRepoPath()
  const ids = [MGMT_TAB, ...s.tabs.map((t) => t.id)]
  const layout = () => s.settings!.layout
  const typing = () => { const a = document.activeElement as HTMLElement | null; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable || !!a.closest('.monaco-editor')) }
  if (cmd.startsWith('tab:') && /^tab:\d$/.test(cmd)) { const id = s.tabs[Number(cmd.slice(4)) - 1]?.id; if (id) void A.activateTab(id); return }
  if (cmd.startsWith('favorite:')) { const p = s.settings!.favorites[Number(cmd.slice(9)) - 1]; if (p) void A.openRepo(p); return }
  switch (cmd) {
    case 'tab:new': case 'repo:management': void A.activateTab(MGMT_TAB); break
    case 'tab:close': if (s.activeTab !== MGMT_TAB) void A.closeTab(s.activeTab); break
    case 'tab:reopen': void A.reopenClosedTab(); break
    case 'tab:next': case 'tab:prev': {
      const i = ids.indexOf(s.activeTab)
      void A.activateTab(ids[(i + (cmd === 'tab:prev' ? -1 : 1) + ids.length) % ids.length])
      break
    }
    case 'tab:list': setState({ palette: true }); break
    case 'repo:clone': openModal('clone'); break
    case 'repo:init': openModal('init'); break
    case 'repo:open': void api.pickDirectory('Open a repository').then((d) => { if (d) void A.openRepo(d) }); break
    case 'repo:editor': if (path) void A2.openInEditor(path, null); break
    case 'repo:terminal': if (path) void api.openTerminal(path); break
    case 'repo:files': if (path) void api.showInFolder(path); break
    case 'prefs': openModal('prefs'); break
    case 'undo': if (typing()) document.execCommand('undo'); else if (path) void A.undo(path); break
    case 'redo': if (typing()) document.execCommand('redo'); else if (path) void A.redo(path); break
    case 'zoom:in': void api.setZoom((s.settings?.zoom ?? 1) + 0.1); break
    case 'zoom:out': void api.setZoom((s.settings?.zoom ?? 1) - 0.1); break
    case 'zoom:reset': void api.setZoom(1); break
    case 'panel:left': A2.saveSettings({ layout: { ...layout(), leftOpen: !layout().leftOpen } }); break
    case 'panel:detail': A2.saveSettings({ layout: { ...layout(), rightOpen: layout().rightOpen === false } }); break
    case 'panel:terminal': if (path) A2.toggleTerminal(path); break
    case 'palette': setState({ palette: true }); break
    case 'shortcuts': openModal('shortcuts'); break
    case 'about': void api.showAbout(); break
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || !!t.closest('.monaco-editor')
}

export function App() {
  const activeTab = useStore((s) => s.activeTab)
  const zoom = useStore((s) => s.settings?.zoom ?? 1.1)
  const ready = useStore((s) => !!s.settings)

  useEffect(() => { void A.init() }, [])
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  // module-level display preferences, applied before children render
  const set = useStore((s) => s.settings)
  if (set) {
    setAvatarMode(set.authorInitials)
    setDateFormat(set.dateFormat, set.clock)
  }
  useEffect(() => {
    if (set) setEditorPrefs({ fontSize: set.editorFontSize, tabSize: set.editorTabSize, lineNumbers: set.editorLineNumbers, syntax: set.editorSyntax, eol: set.editorEol })
  }, [set?.editorFontSize, set?.editorTabSize, set?.editorLineNumbers, set?.editorSyntax, set?.editorEol]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { applyTheme(theme) }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const path = activeRepoPath()
      const key = e.key.toLowerCase()
      if (ctrl && (key === '=' || key === '+')) { e.preventDefault(); void api.setZoom(zoom + 0.1) }
      else if (ctrl && key === '-') { e.preventDefault(); void api.setZoom(zoom - 0.1) }
      else if (ctrl && key === '0') { e.preventDefault(); void api.setZoom(1) }
      else if (ctrl && key === 'p') { e.preventDefault(); setState({ palette: true }) }
      else if (ctrl && e.shiftKey && key === 't') { e.preventDefault(); void A.reopenClosedTab() }
      else if (ctrl && key === 't') { e.preventDefault(); void A.activateTab(MGMT_TAB) }
      else if (ctrl && key === ',') { e.preventDefault(); openModal('prefs') }
      else if (ctrl && key === '/') { e.preventDefault(); openModal('shortcuts') }
      else if (ctrl && key === '`' && path) { e.preventDefault(); A2.toggleTerminal(path) }
      else if (ctrl && key === 'k' && path) { e.preventDefault(); runCommand('panel:detail') }
      else if (ctrl && key === 'w') { e.preventDefault(); const s = getState(); if (s.activeTab !== MGMT_TAB) void A.closeTab(s.activeTab) }
      else if (ctrl && key === 'tab') {
        e.preventDefault()
        const s = getState()
        const ids = [MGMT_TAB, ...s.tabs.map((t) => t.id)]
        const i = ids.indexOf(s.activeTab)
        void A.activateTab(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length])
      } else if (path) {
        if (ctrl && key === 'f') { e.preventDefault(); openSearch(path) }
        else if (ctrl && e.shiftKey && key === 's') { e.preventDefault(); void A.stageAll(path) }
        else if (ctrl && e.shiftKey && key === 'u') { e.preventDefault(); void A.unstageAll(path) }
        else if (ctrl && e.shiftKey && key === 'm') { e.preventDefault(); A.selectWip(path); setTimeout(() => document.querySelector<HTMLInputElement>('.commit-summary-input')?.focus(), 50) }
        else if (ctrl && key === 'b') { e.preventDefault(); A.startCreateRef(path, 'branch') }
        else if (ctrl && key === 'l' && !e.shiftKey) { e.preventDefault(); void A.fetchAll(path) }
        else if (ctrl && !isTyping(e) && key === 'z') { e.preventDefault(); void A.undo(path) }
        else if (ctrl && !isTyping(e) && key === 'y') { e.preventDefault(); void A.redo(path) }
        else if (key === 'escape' && !isTyping(e)) {
          const v = A.repoView(path)
          if (v.search.open) closeSearch(path)
          else if (v.center.kind !== 'graph' && v.center.kind !== 'rebase') A.closeCenter(path)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  // application menu (File / Edit / View / Help)
  useEffect(() => window.bridge.onCommand((c) => runCommand(c)), [])
  const hasRepo = useStore((s) => s.activeTab !== MGMT_TAB && !!activeRepoPath())
  const leftPanel = useStore((s) => s.settings?.layout.leftOpen ?? true)
  const detailPanel = useStore((s) => s.settings?.layout.rightOpen !== false)
  const terminal = useStore((s) => { const p = activeRepoPath(); return p ? !!s.repos[p]?.terminal : false })
  const favorites = useStore((s) => s.settings?.favorites)
  useEffect(() => { void api.setMenuState({ hasRepo, leftPanel, detailPanel, terminal, favorites: favorites ?? [] }) }, [hasRepo, leftPanel, detailPanel, terminal, favorites])

  if (!ready) return <div className="app" />
  return (
    <div className="app">
      <TabsBar />
      <div className="app-body">
        {activeTab === MGMT_TAB ? <RepoManagement /> : <RepoScreen />}
      </div>
      <StatusBar />
      <Toasts />
      <TooltipLayer />
      <Modals />
      <CommandPalette />
    </div>
  )
}

function openSearch(path: string) {
  const v = A.repoView(path)
  if (!v) return
  setState((s) => ({ repos: { ...s.repos, [path]: { ...v, search: { ...v.search, open: true } } } }))
  setTimeout(() => document.querySelector<HTMLInputElement>('.graph-search input')?.select(), 30)
}
function closeSearch(path: string) {
  const v = A.repoView(path)
  setState((s) => ({ repos: { ...s.repos, [path]: { ...v, search: { open: false, query: '', hits: [], index: 0 } } } }))
}
