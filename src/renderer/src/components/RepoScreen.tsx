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

export function RepoScreen() {
  const repo = useActiveRepo()
  const layout = useStore((s) => s.settings!.layout)
  const theme = useStore((s) => s.settings!.theme)
  // settings baked into memoised graph rows (avatars, dates) remount the graph when they change
  const look = useStore((st) => `${st.settings!.authorInitials}-${st.settings!.dateFormat}-${st.settings!.clock}`)
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
  const fullWidth = center.kind === 'merge'
  const leftCollapsed = center.kind === 'file' || !layout.leftOpen

  return (
    <div className="repo-screen">
      {prompt ? <ToolbarPrompt /> : <Toolbar repo={repo} />}
      <div className="bottom-panel">
        {!fullWidth ? (
          <>
            <LeftPanel repo={repo} collapsed={leftCollapsed} width={layout.leftWidth} />
            {!leftCollapsed ? <Resizer onDrag={(dx) => setLayout({ leftWidth: Math.max(180, Math.min(700, useStore.getState().settings!.layout.leftWidth + dx)) })} onEnd={persist} /> : null}
          </>
        ) : null}
        <div className="center-panel">
          <div className="center-content">
            {repo.loading && !repo.snapshot ? <div className="loading"><div className="spinner" /></div> : null}
            {repo.snapshot ? (
              center.kind === 'file' ? <DiffView repo={repo} ctx={center.ctx} startEditing={center.edit} />
                : center.kind === 'merge' ? <MergeTool repo={repo} file={center.file} />
                  : center.kind === 'rebase' ? <RebaseView repo={repo} />
                    : <Graph key={`${theme}-${look}`} repo={repo} />
            ) : null}
          </div>
          {repo.terminal ? <TerminalPanel path={repo.path} /> : null}
        </div>
        {!fullWidth && repo.snapshot ? (
          <>
            {layout.rightOpen !== false ? <>
            <Resizer onDrag={(dx) => setLayout({ rightWidth: Math.max(300, Math.min(900, useStore.getState().settings!.layout.rightWidth - dx)) })} onEnd={persist} />
              <DetailPanel repo={repo} width={layout.rightWidth} />
            </> : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
