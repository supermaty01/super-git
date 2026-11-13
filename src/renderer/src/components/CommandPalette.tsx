import { useEffect, useMemo, useRef, useState } from 'react'
import * as A2 from '../actions2'
import { updateRepo, showPrompt } from '../store'
import { useStore, setState, getState, activeRepoPath, openModal, MGMT_TAB } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { fuzzyFilter } from '../lib/fuzzy'
import { stepZoom } from '../lib/zoom'
import { openSearch } from '../App'
import { Icon } from './Icon'
import { THEMES, SYNC_THEME } from '../lib/theme'

interface Cmd { label: string; run: () => unknown; detail?: string }
/** a command that first asks for one item (a file, a branch, a repository…), like the original's palette sub-modes */
interface SubMode { title: string; placeholder: string; items: () => Cmd[] }
type Entry = Cmd & { sub?: SubMode }

const byLabel = (a: Cmd, b: Cmd) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })

/** "C:\Users\…\folder\repo": keep the head and the tail of a long path */
function middleTruncate(s: string, max = 70): string {
  if (s.length <= max) return s
  const keep = max - 1
  const head = Math.ceil(keep * 0.4)
  return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`
}

/** the label with the fuzzy-matched characters in bold blue */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>
  const set = new Set(indices)
  const parts: Array<{ t: string; hit: boolean }> = []
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    const last = parts[parts.length - 1]
    if (last && last.hit === hit) last.t += text[i]
    else parts.push({ t: text[i], hit })
  }
  return <>{parts.map((p, i) => (p.hit ? <span key={i} className="bold color-blue">{p.t}</span> : p.t))}</>
}

export function CommandPalette() {
  const open = useStore((s) => s.palette)
  const tabs = useStore((s) => s.tabs)
  const recent = useStore((s) => s.settings?.recent ?? [])
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [mode, setMode] = useState<SubMode | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // sub-lists read the files at render time: Ctrl+Shift+H opens the palette before the file list has loaded
  const filesRef = useRef<string[]>([])
  filesRef.current = files
  const repoPath = activeRepoPath()
  useEffect(() => {
    if (!open || !repoPath) { setFiles([]); return }
    void api.listFiles(repoPath).then(setFiles).catch(() => setFiles([]))
  }, [open, repoPath])

  // sub-lists
  const fileMode = (title: string, placeholder: string, run: (file: string) => unknown): SubMode => ({
    title, placeholder, items: () => filesRef.current.map((f) => ({ label: f, run: () => run(f) }))
  })
  const openFileView = (file: string, view: 'file' | 'blame' | 'history', edit = false) => {
    const p = activeRepoPath()
    if (p) updateRepo(p, { center: { kind: 'file', ctx: { kind: 'unstaged', path: file, status: 'N' }, view, edit } })
  }
  const reposMode: SubMode = {
    title: 'Open Repo', placeholder: 'Search for a repository to open',
    items: () => [
      ...tabs.map((t) => ({ label: t.path, run: () => A.activateTab(t.id) })),
      ...recent.filter((r) => !tabs.some((t) => t.path === r.path)).map((r) => ({ label: r.path, run: () => A.openRepo(r.path) }))
    ]
  }
  const historyMode = fileMode('History', 'Search for a file to view its history / blame', (f) => openFileView(f, 'history'))

  // opened straight into a sub-list (Ctrl+Shift+O / Ctrl+Shift+H)
  useEffect(() => {
    if (open === 'repos') setMode(reposMode)
    else if (open === 'history') setMode(historyMode)
    else if (!open) setMode(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const cmds = useMemo<Entry[]>(() => {
    const p = activeRepoPath()
    const snap = p ? useStore.getState().repos[p]?.snapshot : null
    const set = getState().settings
    const layout = () => getState().settings!.layout
    const openTool = (ed: string) => () => { if (p) void A2.openInEditor(p, null, ed) }
    const repoCmds: Entry[] = p ? [
      { label: 'Fetch All', run: () => A.fetchAll(p) },
      { label: 'Pull', run: () => A.pull(p, 'ff') },
      { label: 'Push', run: () => A.push(p) },
      { label: 'Create Branch', run: () => A.startCreateRef(p, 'branch') },
      { label: 'Create Tag', run: () => A.startCreateRef(p, 'tag') },
      { label: 'Create Annotated Tag', run: () => A.startCreateRef(p, 'annotated-tag') },
      { label: 'Rename Branch', run: () => { const r = snap?.refs.find((x) => x.isCurrent); if (r) A.renameBranch(p, r) } },
      { label: 'Clean up local branches', run: () => openModal('branchCleanup', { path: p }) },
      { label: 'Stash: Create', run: () => A.stashSave(p) },
      { label: 'Stash: Apply', run: () => A.stashApply(p, 0) },
      { label: 'Stash: Pop', run: () => A.stashPop(p, 0) },
      { label: 'Stage all changes', run: () => A.stageAll(p) },
      { label: 'Unstage all changes', run: () => A.unstageAll(p) },
      { label: 'Discard all changes', run: () => A.discardAll(p) },
      { label: 'Undo', run: () => A.undo(p) },
      { label: 'Redo', run: () => A.redo(p) },
      { label: 'Toggle terminal panel', run: () => A2.toggleTerminal(p) },
      { label: 'Open in default terminal', run: () => api.openTerminal(p) },
      { label: 'Open in file manager', run: () => api.showInFolder(p) },
      { label: 'Open in VS Code', run: openTool('code') },
      { label: 'Open in Cursor', run: openTool('cursor') },
      { label: 'Open in Visual Studio', run: openTool('devenv') },
      {
        label: 'Open in External Diff/Merge Tool', run: () => {
          const c = A.repoView(p).center
          if (c.kind !== 'file') return
          const x = c.ctx
          void api.externalDiffTool(p, x.path, x.kind === 'staged', x.kind === 'commit' || x.kind === 'stash' ? x.parent : x.kind === 'compare' ? x.a : undefined, x.kind === 'commit' || x.kind === 'stash' ? x.sha : x.kind === 'compare' ? x.b ?? undefined : undefined)
        }
      },
      { label: 'Apply patch', run: () => A2.applyPatch(p) },
      { label: 'Configure Commit Signing', run: () => openModal('prefs', { section: 'signing' }) },
      { label: 'Configure Gitflow', run: () => openModal('repoPrefs', { path: p, section: 'gitflow' }) },
      { label: 'Configure LFS', run: () => openModal('repoPrefs', { path: p, section: 'lfs' }) },
      { label: 'Initialize LFS on this repo', run: () => A.run(p, () => api.lfsInstall(p), { success: 'Git LFS initialized' }) },
      { label: 'Perform Repo Maintenance', run: () => A.run(p, () => api.maintenance(p), { busy: 'Repo maintenance', success: 'Repository maintenance finished' }) },
      { label: 'Search Commits', run: () => openSearch(p) },
      { label: 'Toggle Left Panel', run: () => A2.saveSettings({ layout: { ...layout(), leftOpen: !layout().leftOpen } }) },
      { label: 'Toggle Commit Details Panel', run: () => A2.saveSettings({ layout: { ...layout(), rightOpen: layout().rightOpen === false } }) },
      { label: 'View Working Directory Changes', run: () => A.selectWip(p) },
      { label: 'Close Tab', run: () => A.closeTab(useStore.getState().activeTab) },
      { label: 'History', run: () => undefined, sub: historyMode },
      { label: 'Blame', run: () => undefined, sub: fileMode('Blame', 'Search for a file to view its blame', (f) => openFileView(f, 'blame')) },
      { label: 'View File', run: () => undefined, sub: fileMode('View File', 'Search for a file to view', (f) => openFileView(f, 'file')) },
      { label: 'Open File', run: () => undefined, sub: fileMode('Open File', 'Search for a file to open', (f) => openFileView(f, 'file')) },
      { label: 'Edit File', run: () => undefined, sub: fileMode('Edit File', 'Search for a file to edit', (f) => openFileView(f, 'file', true)) },
      { label: 'Delete File', run: () => undefined, sub: fileMode('Delete File', 'Search for a file to delete', (f) => showPrompt({ kind: 'confirm', message: `Delete "${f}" from the working directory?`, buttons: [{ label: 'Delete', style: 'danger', run: () => A.run(p, () => api.deleteFile(p, f)) }] })) },
      { label: 'Create File', run: () => showPrompt({ kind: 'input', message: 'New file', placeholder: 'path/to/file.txt', submitLabel: 'Create', onSubmit: (v) => { const f = v.trim().replace(/\\/g, '/'); if (f) void A.run(p, () => api.writeFile(p, f, '')).then(() => openFileView(f, 'file', true)) } }) },
      {
        label: 'Checkout', run: () => undefined, sub: {
          title: 'Checkout', placeholder: 'Search for a branch to checkout',
          items: () => (snap?.refs ?? []).filter((r) => (r.type === 'head' || r.type === 'remote') && !r.short.endsWith('/HEAD')).map((r) => ({ label: r.name, run: () => A.checkoutRef(p, r) }))
        }
      }
    ] : []
    const zoom = set?.zoom ?? 1
    return [
      ...repoCmds,
      { label: 'Open Repo', run: () => undefined, sub: reposMode },
      { label: 'Clone', run: () => openModal('clone') },
      { label: 'Initialize a Repo', run: () => openModal('init') },
      { label: 'Open Repository Management Tab', run: () => A.activateTab(MGMT_TAB) },
      { label: 'Settings', run: () => openModal('prefs') },
      { label: 'Keyboard Shortcuts', run: () => openModal('shortcuts') },
      { label: 'Activity Logs', run: () => openModal('activity') },
      { label: 'View Error Logs', run: () => openModal('activity') },
      { label: 'View Performance Logs', run: () => openModal('activity') },
      { label: 'View Release Notes', run: () => api.openExternal('https://github.com/supermaty01/super-git/releases') },
      {
        label: 'Switch Theme', run: () => undefined, sub: {
          title: 'Switch Theme', placeholder: 'Search for a theme',
          items: () => [...THEMES, SYNC_THEME].map((t) => ({ label: t.label, run: () => { A2.saveSettings({ theme: t.id }); void api.setTheme(t.id) } }))
        }
      },
      { label: 'Switch to Profile', run: () => openModal('prefs', { section: 'profiles' }) },
      { label: 'Toggle Syntax Highlighting', run: () => A2.saveSettings({ editorSyntax: !getState().settings!.editorSyntax }) },
      { label: 'Toggle Toolbar Labels', run: () => A2.saveSettings({ showToolbarLabels: !getState().settings!.showToolbarLabels }) },
      { label: 'Increase Zoom', run: () => api.setZoom(stepZoom(zoom, 1)) },
      { label: 'Decrease Zoom', run: () => api.setZoom(stepZoom(zoom, -1)) },
      { label: 'Reset Zoom', run: () => api.setZoom(1) }
    ].sort(byLabel)
  }, [tabs, recent, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const source: Entry[] = mode ? mode.items() : cmds
  const filtered = useMemo(() => fuzzyFilter(source, q, (c) => c.label), [source, q])

  useEffect(() => { listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' }) }, [idx])

  if (!open) return null
  const close = () => { setState({ palette: false }); setQ(''); setIdx(0); setMode(null) }
  const exec = (c: Entry) => {
    if (c.sub) { setMode(c.sub); setQ(''); setIdx(0); return }
    close()
    void c.run()
  }
  return (
    <div className="palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="palette">
        <div className="palette-input">
          {mode ? <span className="palette-chip">{mode.title}<span className="palette-chip-x" onClick={() => { setMode(null); setQ(""); setIdx(0) }}><Icon name="times" /></span></span> : null}
          <input
            autoFocus
            placeholder={mode ? mode.placeholder : 'Search for commands and actions (e.g., Open Repo)'}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'Backspace' && !q && mode) { setMode(null); setIdx(0) }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter' && filtered[idx]) exec(filtered[idx].item)
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.slice(0, 300).map(({ item: c, indices }, i) => (
            <div key={c.label + i} className={`palette-item${i === idx ? ' active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => exec(c)}>
              <span className="truncate"><Highlighted text={mode?.title === 'Open Repo' ? middleTruncate(c.label) : c.label} indices={mode?.title === 'Open Repo' && c.label.length > 70 ? [] : indices} /></span>
              {c.detail ? <span className="palette-hint truncate">{c.detail}</span> : null}
              {c.sub ? <Icon name="chevron-right" className="palette-more" /> : null}
            </div>
          ))}
          {!filtered.length ? <div className="palette-empty">No results found</div> : null}
        </div>
      </div>
    </div>
  )
}
