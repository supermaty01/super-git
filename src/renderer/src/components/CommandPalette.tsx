import { useEffect, useMemo, useRef, useState } from 'react'
import * as A2 from '../actions2'
import { updateRepo, showPrompt } from '../store'
import { useStore, setState, getState, activeRepoPath, openModal, MGMT_TAB } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { Icon } from './Icon'

interface Cmd { label: string; run: () => unknown; detail?: string }
/** a command that first asks for one item (a file, a branch, a repository…), like the original's palette sub-modes */
interface SubMode { title: string; placeholder: string; items: () => Cmd[] }
type Entry = Cmd & { sub?: SubMode }

const byLabel = (a: Cmd, b: Cmd) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })

export function CommandPalette() {
  const open = useStore((s) => s.palette)
  const tabs = useStore((s) => s.tabs)
  const recent = useStore((s) => s.settings?.recent ?? [])
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [mode, setMode] = useState<SubMode | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const repoPath = activeRepoPath()
  useEffect(() => {
    if (!open || !repoPath) { setFiles([]); return }
    void api.listFiles(repoPath).then(setFiles).catch(() => setFiles([]))
  }, [open, repoPath])

  // sub-lists
  const fileMode = (title: string, run: (file: string) => unknown): SubMode => ({
    title, placeholder: 'Search for a file', items: () => files.map((f) => ({ label: f, run: () => run(f) }))
  })
  const openFileView = (file: string, view: 'file' | 'blame' | 'history', edit = false) => {
    const p = activeRepoPath()
    if (p) updateRepo(p, { center: { kind: 'file', ctx: { kind: 'unstaged', path: file, status: 'N' }, view, edit } })
  }
  const reposMode: SubMode = {
    title: 'Open Repo', placeholder: 'Search for a repository',
    items: () => [
      ...tabs.map((t) => ({ label: t.name, detail: t.path, run: () => A.activateTab(t.id) })),
      ...recent.filter((r) => !tabs.some((t) => t.path === r.path)).map((r) => ({ label: r.name, detail: r.path, run: () => A.openRepo(r.path) })),
      { label: 'Browse for a repository…', run: async () => { const d = await api.pickDirectory('Open a repository'); if (d) await A.openRepo(d) } }
    ]
  }
  const historyMode = fileMode('History', (f) => openFileView(f, 'history'))

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
    const repoCmds: Entry[] = p ? [
      { label: 'Fetch All', run: () => A.fetchAll(p) },
      { label: 'Pull (fast-forward if possible)', run: () => A.pull(p, 'ff') },
      { label: 'Pull (fast-forward only)', run: () => A.pull(p, 'ff-only') },
      { label: 'Pull (rebase)', run: () => A.pull(p, 'rebase') },
      { label: 'Push', run: () => A.push(p) },
      { label: 'Force Push (with lease)', run: () => A.push(p, undefined, true) },
      { label: 'Create Branch', run: () => A.startCreateRef(p, 'branch') },
      { label: 'Create Tag', run: () => A.startCreateRef(p, 'tag') },
      { label: 'Rename Branch', run: () => { const r = snap?.refs.find((x) => x.isCurrent); if (r) A.renameBranch(p, r) } },
      { label: 'Stash', run: () => A.stashSave(p) },
      { label: 'Pop Stash', run: () => A.stashPop(p, 0) },
      { label: 'Stage All Changes', run: () => A.stageAll(p) },
      { label: 'Unstage All Changes', run: () => A.unstageAll(p) },
      { label: 'Discard All Changes', run: () => A.discardAll(p) },
      { label: 'Undo', run: () => A.undo(p) },
      { label: 'Redo', run: () => A.redo(p) },
      { label: 'Add Remote', run: () => openModal('remote', { path: p }) },
      { label: 'Create Worktree', run: () => A.addWorktreeDialog(p) },
      { label: 'Toggle Terminal', run: () => A2.toggleTerminal(p) },
      { label: 'Open External Terminal', run: () => api.openTerminal(p) },
      { label: 'Open Repo in External Editor', run: () => A2.openInEditor(p, null) },
      { label: 'Open in File Manager', run: () => api.showInFolder(p) },
      { label: 'Apply Patch…', run: () => A2.applyPatch(p) },
      { label: 'Repo-Specific Preferences', run: () => openModal('repoPrefs', { path: p }) },
      { label: 'Edit .gitignore', run: () => openModal('repoPrefs', { path: p, section: 'gitignore' }) },
      { label: 'Gitflow: Initialize / Settings', run: () => openModal('repoPrefs', { path: p, section: 'gitflow' }) },
      { label: 'Gitflow: Start Feature', run: () => A2.gitflowStartDialog(p, 'feature') },
      { label: 'Gitflow: Start Release', run: () => A2.gitflowStartDialog(p, 'release') },
      { label: 'Gitflow: Start Hotfix', run: () => A2.gitflowStartDialog(p, 'hotfix') },
      { label: 'LFS Settings', run: () => openModal('repoPrefs', { path: p, section: 'lfs' }) },
      { label: 'Add Submodule', run: () => A2.submoduleAddDialog(p) },
      { label: 'Update Submodules', run: () => A2.submoduleUpdate(p) },
      { label: 'Show All Hidden Branches', run: () => A2.clearVisibility(p) },
      { label: 'Stash Staged Changes Only', run: () => A.stashSave(p, undefined, 'staged') },
      { label: 'Compare HEAD Against Working Directory', run: () => { const h = A.snap(p).head.sha; if (h) A2.compareWithWorkdir(p, h) } },
      { label: 'Repo Maintenance (git gc)', run: () => A.run(p, () => api.maintenance(p), { busy: 'Repo maintenance', success: 'Repository maintenance finished' }) },
      { label: 'Close Tab', run: () => A.closeTab(useStore.getState().activeTab) },
      { label: 'History', run: () => undefined, sub: historyMode },
      { label: 'Blame', run: () => undefined, sub: fileMode('Blame', (f) => openFileView(f, 'blame')) },
      { label: 'View File', run: () => undefined, sub: fileMode('View File', (f) => openFileView(f, 'file')) },
      { label: 'Edit File', run: () => undefined, sub: fileMode('Edit File', (f) => openFileView(f, 'file', true)) },
      { label: 'Delete File', run: () => undefined, sub: fileMode('Delete File', (f) => showPrompt({ kind: 'confirm', message: `Delete "${f}" from the working directory?`, buttons: [{ label: 'Delete', style: 'danger', run: () => A.run(p, () => api.deleteFile(p, f)) }] })) },
      { label: 'Create File', run: () => showPrompt({ kind: 'input', message: 'New file', placeholder: 'path/to/file.txt', submitLabel: 'Create', onSubmit: (v) => { const f = v.trim().replace(/\\/g, '/'); if (f) void A.run(p, () => api.writeFile(p, f, '')).then(() => openFileView(f, 'file', true)) } }) },
      {
        label: 'Checkout', run: () => undefined, sub: {
          title: 'Checkout', placeholder: 'Search for a branch',
          items: () => (snap?.refs ?? []).filter((r) => (r.type === 'head' && !r.isCurrent) || (r.type === 'remote' && !r.short.endsWith('/HEAD'))).map((r) => ({ label: r.short, run: () => A.checkoutRef(p, r) }))
        }
      }
    ] : []
    const zoom = set?.zoom ?? 1
    return [
      ...repoCmds,
      { label: 'Open Repo', run: () => undefined, sub: reposMode },
      { label: 'Clone Repo', run: () => openModal('clone') },
      { label: 'Init Repo', run: () => openModal('init') },
      { label: 'Open Repo Management', run: () => A.activateTab(MGMT_TAB) },
      { label: 'Preferences', run: () => openModal('prefs') },
      { label: 'Keyboard Shortcuts', run: () => openModal('shortcuts') },
      {
        label: 'Switch Theme', run: () => undefined, sub: {
          title: 'Switch Theme', placeholder: 'Search for a theme',
          items: () => (['dark', 'light'] as const).map((t) => ({ label: t === 'dark' ? 'Dark' : 'Light', run: () => { A2.saveSettings({ theme: t }); void api.setTheme(t) } }))
        }
      },
      { label: 'Switch Profile', run: () => openModal('prefs', { section: 'profiles' }) },
      { label: 'Toggle Syntax Highlighting', run: () => A2.saveSettings({ editorSyntax: !getState().settings!.editorSyntax }) },
      { label: 'Toggle Toolbar Labels', run: () => A2.saveSettings({ showToolbarLabels: !getState().settings!.showToolbarLabels }) },
      { label: 'Zoom In', run: () => api.setZoom(zoom + 0.1) },
      { label: 'Zoom Out', run: () => api.setZoom(zoom - 0.1) },
      { label: 'Reset Zoom', run: () => api.setZoom(1) },
      { label: 'Reopen Closed Tab', run: () => A.reopenClosedTab() },
      { label: 'SSH Keys', run: () => openModal('prefs', { section: 'ssh' }) },
      { label: 'Integrations', run: () => openModal('prefs', { section: 'integrations' }) }
    ].sort(byLabel)
  }, [tabs, recent, open, files]) // eslint-disable-line react-hooks/exhaustive-deps

  const source: Entry[] = mode ? mode.items() : cmds
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return source
    const words = t.split(/\s+/)
    if (!mode) return source.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)))
    // file / branch lists: fuzzy subsequence match, best first
    const needle = t.replace(/\s+/g, '')
    const scored: Array<{ c: Entry; score: number }> = []
    for (const c of source) {
      const lf = c.label.toLowerCase()
      let pos = -1, gaps = 0, ok = true
      for (const ch of needle) {
        const n = lf.indexOf(ch, pos + 1)
        if (n < 0) { ok = false; break }
        if (pos >= 0) gaps += n - pos - 1
        pos = n
      }
      if (ok) scored.push({ c, score: gaps * 2 + (lf.length - pos) + (lf.includes(needle) ? -100 : 0) })
    }
    return scored.sort((a, b) => a.score - b.score).map((x) => x.c)
  }, [source, q, mode])

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
          {mode ? <span className="palette-mode">{mode.title}</span> : null}
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
              else if (e.key === 'Enter' && filtered[idx]) exec(filtered[idx])
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.slice(0, 300).map((c, i) => (
            <div key={c.label + i} className={`palette-item${i === idx ? ' active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => exec(c)}>
              <span className="truncate">{c.label}</span>
              {c.detail ? <span className="palette-hint truncate">{c.detail}</span> : null}
              {c.sub ? <Icon name="chevron-right" className="palette-more" /> : null}
            </div>
          ))}
          {!filtered.length ? <div className="palette-empty">No results</div> : null}
        </div>
      </div>
    </div>
  )
}
