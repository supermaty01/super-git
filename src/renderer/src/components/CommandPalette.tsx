import { useEffect, useMemo, useState } from 'react'
import * as A2 from '../actions2'
import { updateRepo } from '../store'
import { useStore, setState, activeRepoPath, openModal, MGMT_TAB } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { Icon } from './Icon'

interface Cmd { label: string; hint?: string; run: () => unknown; repo?: boolean }

export function CommandPalette() {
  const open = useStore((s) => s.palette)
  const tabs = useStore((s) => s.tabs)
  const recent = useStore((s) => s.settings?.recent ?? [])
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const repoPath = activeRepoPath()
  useEffect(() => {
    if (!open || !repoPath) { setFiles([]); return }
    void api.listFiles(repoPath).then(setFiles).catch(() => setFiles([]))
  }, [open, repoPath])

  const cmds = useMemo<Cmd[]>(() => {
    const p = activeRepoPath()
    const repoCmds: Cmd[] = p ? [
      { label: 'Fetch All', hint: 'Ctrl+L', run: () => A.fetchAll(p) },
      { label: 'Pull (fast-forward if possible)', run: () => A.pull(p, 'ff') },
      { label: 'Pull (fast-forward only)', run: () => A.pull(p, 'ff-only') },
      { label: 'Pull (rebase)', run: () => A.pull(p, 'rebase') },
      { label: 'Push', run: () => A.push(p) },
      { label: 'Force Push (with lease)', run: () => A.push(p, undefined, true) },
      { label: 'Create Branch', hint: 'Ctrl+B', run: () => A.startCreateRef(p, 'branch') },
      { label: 'Create Tag', run: () => A.startCreateRef(p, 'tag') },
      { label: 'Stash', run: () => A.stashSave(p) },
      { label: 'Pop Stash', run: () => A.stashPop(p, 0) },
      { label: 'Stage All Changes', hint: 'Ctrl+Shift+S', run: () => A.stageAll(p) },
      { label: 'Unstage All Changes', hint: 'Ctrl+Shift+U', run: () => A.unstageAll(p) },
      { label: 'Discard All Changes', run: () => A.discardAll(p) },
      { label: 'Undo', hint: 'Ctrl+Z', run: () => A.undo(p) },
      { label: 'Redo', hint: 'Ctrl+Y', run: () => A.redo(p) },
      { label: 'Add Remote', run: () => openModal('remote', { path: p }) },
      { label: 'Create Worktree', run: () => A.addWorktreeDialog(p) },
      { label: 'Toggle Terminal', hint: 'Ctrl+`', run: () => A2.toggleTerminal(p) },
      { label: 'Open External Terminal', run: () => api.openTerminal(p) },
      { label: 'Open Repository in External Editor', run: () => A2.openInEditor(p, null) },
      { label: 'Apply Patch…', run: () => A2.applyPatch(p) },
      { label: 'Repository Preferences', run: () => openModal('repoPrefs', { path: p }) },
      { label: 'Edit .gitignore', run: () => openModal('repoPrefs', { path: p, section: 'gitignore' }) },
      { label: 'Gitflow: Initialize / Settings', run: () => openModal('repoPrefs', { path: p, section: 'gitflow' }) },
      { label: 'Gitflow: Start Feature', run: () => A2.gitflowStartDialog(p, 'feature') },
      { label: 'Gitflow: Start Release', run: () => A2.gitflowStartDialog(p, 'release') },
      { label: 'Gitflow: Start Hotfix', run: () => A2.gitflowStartDialog(p, 'hotfix') },
      { label: 'Git LFS Settings', run: () => openModal('repoPrefs', { path: p, section: 'lfs' }) },
      { label: 'Add Submodule', run: () => A2.submoduleAddDialog(p) },
      { label: 'Update Submodules', run: () => A2.submoduleUpdate(p) },
      { label: 'Show All Hidden Branches', run: () => A2.clearVisibility(p) },
      { label: 'Stash Staged Changes Only', run: () => A.stashSave(p, undefined, 'staged') },
      { label: 'Compare HEAD Against Working Directory', run: () => { const h = A.snap(p).head.sha; if (h) A2.compareWithWorkdir(p, h) } },
      { label: 'Show Repository in Folder', run: () => api.showInFolder(p) },
      { label: 'Close Repository Tab', hint: 'Ctrl+W', run: () => A.closeTab(useStore.getState().activeTab) },
      ...useStore.getState().repos[p]?.snapshot?.refs.filter((r) => r.type === 'head' && !r.isCurrent).map((r) => ({ label: `Checkout ${r.short}`, run: () => A.checkoutRef(p, r) })) ?? []
    ] : []
    return [
      ...repoCmds,
      { label: 'Open Repository…', run: async () => { const d = await api.pickDirectory('Open a repository'); if (d) await A.openRepo(d) } },
      { label: 'Clone Repository…', run: () => openModal('clone') },
      { label: 'Init Repository…', run: () => openModal('init') },
      { label: 'Repository Management', hint: 'Ctrl+T', run: () => A.activateTab(MGMT_TAB) },
      { label: 'Preferences', hint: 'Ctrl+,', run: () => openModal('prefs') },
      { label: 'Keyboard Shortcuts', hint: 'Ctrl+/', run: () => openModal('shortcuts') },
      { label: 'Toggle Light / Dark Theme', run: () => { const t = useStore.getState().settings!.theme === 'light' ? 'dark' : 'light'; A2.saveSettings({ theme: t }); void api.setTheme(t) } },
      { label: 'Reopen Closed Tab', hint: 'Ctrl+Shift+T', run: () => A.reopenClosedTab() },
      { label: 'SSH & GPG Keys', run: () => openModal('prefs', { section: 'keys' }) },
      { label: 'Switch Profile', run: () => openModal('prefs', { section: 'profiles' }) },
      { label: 'Integrations (GitHub, GitLab, Bitbucket, Azure DevOps)', run: () => openModal('prefs', { section: 'integrations' }) },
      ...tabs.map((t) => ({ label: `Switch to ${t.name}`, hint: t.path, run: () => A.activateTab(t.id) })),
      ...recent.filter((r) => !tabs.some((t) => t.path === r.path)).map((r) => ({ label: `Open ${r.name}`, hint: r.path, run: () => A.openRepo(r.path) }))
    ]
  }, [tabs, recent, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return cmds
    const words = t.split(/\s+/)
    const cmdHits = cmds.filter((c) => words.every((w) => c.label.toLowerCase().includes(w) || c.hint?.toLowerCase().includes(w)))
    // fuzzy file finder: subsequence match on the path, best (shortest gap) first
    const fileHits: Array<{ f: string; score: number }> = []
    if (repoPath && t.length >= 2) {
      const needle = t.replace(/\s+/g, '')
      for (const f of files) {
        const lf = f.toLowerCase()
        let pos = -1, first = -1, gaps = 0
        let ok = true
        for (const ch of needle) {
          const n = lf.indexOf(ch, pos + 1)
          if (n < 0) { ok = false; break }
          if (first < 0) first = n
          if (pos >= 0) gaps += n - pos - 1
          pos = n
        }
        if (ok) fileHits.push({ f, score: gaps * 2 + (lf.length - pos) + (lf.includes(needle) ? -100 : 0) })
        if (fileHits.length > 3000) break
      }
      fileHits.sort((a, b) => a.score - b.score)
    }
    const fileCmds: Cmd[] = fileHits.slice(0, 60).flatMap(({ f }) => [
      { label: `File: ${f}`, hint: 'history', run: () => updateRepo(repoPath!, { center: { kind: 'file', ctx: { kind: 'unstaged', path: f, status: 'N' } } }) }
    ])
    return [...cmdHits, ...fileCmds]
  }, [cmds, q, files, repoPath])

  if (!open) return null
  const close = () => { setState({ palette: false }); setQ(''); setIdx(0) }
  const exec = (c: Cmd) => { close(); void c.run() }
  return (
    <div className="modal-overlay palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="palette">
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="Type a command or repository name"
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter' && filtered[idx]) exec(filtered[idx])
            }}
          />
        </div>
        <div className="palette-list">
          {filtered.slice(0, 200).map((c, i) => (
            <div key={c.label + i} className={`palette-item${i === idx ? ' active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => exec(c)}>
              <span className="truncate">{c.label}</span>
              {c.hint ? <span className="palette-hint truncate">{c.hint}</span> : null}
            </div>
          ))}
          {!filtered.length ? <div className="palette-empty">No matching commands</div> : null}
        </div>
      </div>
    </div>
  )
}
