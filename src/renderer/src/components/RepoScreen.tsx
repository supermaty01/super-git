import { useCallback } from 'react'
import { useActiveRepo, useStore, setState } from '../store'
import { api } from '../lib/api'
import { Toolbar } from './Toolbar'
import { LeftPanel } from './LeftPanel'
import { Graph } from './Graph'
import { DetailPanel } from './DetailPanel'
import { DiffView } from './DiffView'
import { MergeTool } from './MergeTool'
import { RebaseView } from './RebaseView'
import { Resizer } from './Resizer'
import { TerminalPanel } from './TerminalPanel'
import { ToolbarPrompt } from './ToolbarPrompt'
import { WorktreePanel } from './WorktreePanel'
import { GitflowPanel } from './GitflowPanel'
import { FileHistoryView } from './FileHistoryView'

/** the original's detail panel limits: at least 353px, and at least 651px of window left for the rest */
const clampDetailWidth = (w: number) => Math.max(353, Math.min(window.innerWidth - 651, w))

export function RepoScreen() {
  const repo = useActiveRepo()
  const layout = useStore((s) => s.settings!.layout)
  const theme = useStore((s) => s.settings!.theme)
  // settings baked into memoised graph rows (avatars, dates) remount the graph when they change
  const look = useStore((st) => `${st.settings!.authorInitials}-${st.settings!.dateFormat}-${st.settings!.clock}-${st.settings!.dateLocale ?? ''}-${st.settings!.dateFormats?.date ?? ''}-${st.settings!.dateFormats?.dateTime ?? ''}`)
  const prompt = useStore((s) => s.prompt)
  const setLayout = useCallback((patch: Partial<typeof layout>) => {
    setState((s) => ({ settings: { ...s.settings!, layout: { ...s.settings!.layout, ...patch } } }))
  }, [])
  const persist = useCallback(() => { void api.setSettings({ layout: useStore.getState().settings!.layout }) }, [])

  if (!repo) return null
  if (repo.error && !repo.snapshot) {
    return (
      <div className="repo-error">
        <div className="repo-error-title">Could not open repository</div>
        <div className="repo-error-msg">{repo.error}</div>
      </div>
    )
  }
  const center = repo.center
  const fullWidth = center.kind === 'merge' || center.kind === 'history'
  const leftCollapsed = center.kind === 'file' || !layout.leftOpen

  return (
    <div className="repo-screen">
      {prompt ? <ToolbarPrompt /> : <Toolbar repo={repo} />}
      <div className="bottom-panel">
        {!fullWidth ? (
          <>
            <LeftPanel repo={repo} collapsed={leftCollapsed} width={Math.max(208, layout.leftWidth)} />
            {!leftCollapsed ? <Resizer className="left-resizer" title="Resize Panel" onDrag={(dx) => setLayout({ leftWidth: Math.max(208, Math.min(800, useStore.getState().settings!.layout.leftWidth + dx)) })} onEnd={persist} /> : null}
          </>
        ) : null}
        <div className="center-panel">
          <div className="center-content">
            {repo.loading && !repo.snapshot ? <div className="loading"><div className="spinner" /></div> : null}
            {repo.snapshot ? (
              center.kind === 'file' ? <DiffView repo={repo} ctx={center.ctx} startEditing={center.edit} startView={center.view} />
                : center.kind === 'merge' ? <MergeTool repo={repo} file={center.file} />
                : center.kind === 'history' ? <FileHistoryView key={`${center.file}:${center.sha ?? ''}:${center.blame ? 1 : 0}`} repo={repo} file={center.file} sha={center.sha} blame={center.blame} />
                  : center.kind === 'rebase' ? <RebaseView repo={repo} />
                    : <Graph key={`${theme}-${look}`} repo={repo} />
            ) : null}
          </div>
          {repo.slidey?.kind === 'worktree' && repo.snapshot ? <WorktreePanel key={repo.slidey.ref} repo={repo} initialRef={repo.slidey.ref} /> : null}
          {repo.slidey?.kind === 'gitflow' && repo.snapshot ? <GitflowPanel key={`${repo.slidey.mode}:${repo.slidey.type}:${repo.slidey.name ?? ''}`} repo={repo} form={repo.slidey} /> : null}
          {repo.terminal ? <TerminalPanel path={repo.path} /> : null}
        </div>
        {!fullWidth && repo.snapshot ? (
          <>
            {layout.rightOpen !== false && !repo.detailHidden ? <>
            <Resizer className="detail-resizer" onDrag={(dx) => setLayout({ rightWidth: clampDetailWidth(useStore.getState().settings!.layout.rightWidth - dx) })} onEnd={persist} />
              <DetailPanel repo={repo} width={clampDetailWidth(layout.rightWidth)} />
            </> : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
