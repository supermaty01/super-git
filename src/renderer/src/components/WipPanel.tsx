import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { RepoView } from '../store'
import { updateRepo, getState, useStore } from '../store'
import * as A from '../actions'
import { fileMenu } from '../menus'
import { Icon } from './Icon'
import { FileList, FileListToolbar } from './FileList'
import { useFileListMode } from './DetailPanel'
import type { FileChange } from '@shared/types'

export function WipPanel({ repo }: { repo: RepoView }) {
  const s = repo.snapshot!
  const path = repo.path
  const st = s.status
  const state = st.state
  const [mode, setMode] = useFileListMode()
  const [sortDesc, setSortDesc] = useState(false)
  const [openUn, setOpenUn] = useState(true)
  const [openSt, setOpenSt] = useState(true)
  const [splitPct, setSplitPct] = useState(50)

  const activeCtx = repo.center.kind === 'file' ? repo.center.ctx : null
  const activeUn = activeCtx?.kind === 'unstaged' ? activeCtx.path : null
  const activeSt = activeCtx?.kind === 'staged' ? activeCtx.path : null
  const activeConflict = repo.center.kind === 'merge' ? repo.center.file : null
  const total = new Set([...st.staged, ...st.unstaged, ...st.conflicted].map((f) => f.path)).size
  const branch = s.head.branch ?? s.head.sha.slice(0, 7)
  const inOp = state.kind !== 'none'
  // like the original, untracked files that have nothing to do with the merge stay out of the way while it runs
  const opUnstaged = st.unstaged.filter((f) => f.status !== '?')

  const openUnstaged = (f: FileChange) => A.openFile(path, { kind: 'unstaged', path: f.path, status: f.status })
  const openStaged = (f: FileChange) => A.openFile(path, { kind: 'staged', path: f.path, oldPath: f.oldPath, status: f.status })
  const setSel = (paths: string[]) => updateRepo(path, { fileSel: paths })

  const unstagedList = (
    <FileList
      files={inOp ? opUnstaged : st.unstaged}
      mode={mode}
      sortDesc={sortDesc}
      activePath={activeUn}
      selected={repo.fileSel}
      onSelect={setSel}
      onOpen={openUnstaged}
      onDoubleClick={(f) => A.stageFiles(path, [f])}
      onContext={(f) => fileMenu(path, f, 'unstaged')}
      rowAction={(f) => <button className="btn btn-success btn-xs" onClick={() => A.stageFiles(path, repo.fileSel.length > 1 && repo.fileSel.includes(f.path) ? st.unstaged.filter((x) => repo.fileSel.includes(x.path)) : [f])}>Stage File</button>}
    />
  )
  const stagedList = (
    <FileList
      files={st.staged}
      mode={mode}
      sortDesc={sortDesc}
      activePath={activeSt}
      selected={repo.fileSel}
      onSelect={setSel}
      onOpen={openStaged}
      onDoubleClick={(f) => A.unstageFiles(path, [f])}
      onContext={(f) => fileMenu(path, f, 'staged')}
      rowAction={(f) => <button className="btn btn-danger btn-xs" onClick={() => A.unstageFiles(path, repo.fileSel.length > 1 && repo.fileSel.includes(f.path) ? st.staged.filter((x) => repo.fileSel.includes(x.path)) : [f])}>Unstage File</button>}
    />
  )

  return (
    <div className="wip-panel">
      {inOp ? (
        <div className="wip-op-header">
          <div className="wip-op-title">
            {st.conflicted.length ? <><Icon name="warning" className="color-orange" /> {opTitle(state.kind)} conflicts detected</> : <>{opTitle(state.kind)} in progress</>}
          </div>
          <div className="wip-op-sub">
            {state.kind === 'merge' ? <>Merging <span className="pill pill-blue">{state.theirs}</span> into <span className="pill pill-teal">{state.ours}</span></> : null}
            {state.kind === 'rebase' ? <>Rebasing <span className="pill pill-teal">{state.ours}</span> onto <span className="pill pill-blue">{state.theirs}</span>{state.total ? <span className="text-secondary"> &nbsp;({state.step}/{state.total})</span> : null}</> : null}
            {state.kind === 'cherry-pick' ? <>Cherry picking <span className="pill pill-blue">{state.theirs}</span> onto <span className="pill pill-teal">{state.ours}</span></> : null}
            {state.kind === 'am' ? <>Applying patch <span className="pill pill-blue">{state.theirs}</span>{state.total ? <span className="text-secondary"> &nbsp;({state.step}/{state.total})</span> : null}</> : null}
            {state.kind === 'revert' ? <>Reverting <span className="pill pill-blue">{state.theirs}</span> on <span className="pill pill-teal">{state.ours}</span></> : null}
          </div>
        </div>
      ) : (
        <div className="wip-header">
          <span className="wip-discard" title="Discard all changes" onClick={() => A.discardAll(path)}><Icon name="trash-o" /></span>
          <span className="wip-header-text">{total} file change{total === 1 ? '' : 's'} on <span className="pill pill-teal">{branch}</span></span>
        </div>
      )}

      <FileListToolbar mode={mode} setMode={setMode} sortDesc={sortDesc} setSortDesc={setSortDesc} />

      <div className="wip-lists">
        {st.conflicted.length || inOp ? (
          <div className="wip-section" style={{ flex: openSt ? `${splitPct} 1 0` : '1 1 0' }}>
            <div className="wip-section-header" onClick={() => setOpenUn((v) => !v)}>
              <Icon name={openUn ? 'caret-down' : 'chevron-right'} className="wip-caret" />
              <span>Conflicted Files ({st.conflicted.length})</span>
              {st.conflicted.length ? <button className="btn btn-warning btn-xs" onClick={(e) => { e.stopPropagation(); void A.markResolved(path, st.conflicted.map((f) => f.path)) }}>Mark All Resolved</button> : null}
            </div>
            {openUn ? (
              <div className="wip-section-body">
                <FileList
                  files={st.conflicted}
                  mode={mode}
                  sortDesc={sortDesc}
                  activePath={activeConflict}
                  onOpen={(f) => A.openMerge(path, f.path)}
                  onContext={(f) => fileMenu(path, f, 'conflicted')}
                  rowAction={(f) => <button className="btn btn-warning btn-xs" onClick={() => A.markResolved(path, [f.path])}>Mark Resolved</button>}
                />
                {opUnstaged.length ? <><div className="wip-subheader">Unstaged Files ({opUnstaged.length})</div>{unstagedList}</> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="wip-section" style={{ flex: openSt ? `${splitPct} 1 0` : '1 1 0' }}>
            <div className="wip-section-header" onClick={() => setOpenUn((v) => !v)}>
              <Icon name={openUn ? 'caret-down' : 'chevron-right'} className="wip-caret" />
              <span>Unstaged Files ({st.unstaged.length})</span>
              {st.unstaged.length ? <button className="btn btn-success btn-xs" onClick={(e) => { e.stopPropagation(); void A.stageAll(path) }}>Stage All Changes</button> : null}
            </div>
            {openUn ? <div className="wip-section-body">{unstagedList}</div> : null}
          </div>
        )}
        {openUn && openSt ? <HSplit onDrag={(dy, h) => setSplitPct((p) => Math.max(15, Math.min(85, p + (dy / h) * 100)))} /> : null}
        <div className="wip-section" style={{ flex: openSt ? `${100 - splitPct} 1 0` : '0 0 auto' }}>
          <div className="wip-section-header" onClick={() => setOpenSt((v) => !v)}>
            <Icon name={openSt ? 'caret-down' : 'chevron-right'} className="wip-caret" />
            <span>{inOp ? 'Resolved Files' : 'Staged Files'} ({st.staged.length})</span>
            {st.staged.length && !inOp ? <button className="btn btn-danger btn-xs" onClick={(e) => { e.stopPropagation(); void A.unstageAll(path) }}>Unstage All Changes</button> : null}
          </div>
          {openSt ? <div className="wip-section-body">{stagedList}</div> : null}
        </div>
      </div>

      <CommitBox repo={repo} />
    </div>
  )
}

function opTitle(kind: string) {
  return kind === 'merge' ? 'Merge' : kind === 'rebase' ? 'Rebase' : kind === 'cherry-pick' ? 'Cherry pick' : kind === 'am' ? 'Patch' : 'Revert'
}

function HSplit({ onDrag }: { onDrag: (dy: number, height: number) => void }) {
  return (
    <div
      className="hsplit"
      onMouseDown={(e) => {
        e.preventDefault()
        const container = (e.currentTarget.parentElement as HTMLElement)
        let last = e.clientY
        const move = (ev: MouseEvent) => { onDrag(ev.clientY - last, container.clientHeight); last = ev.clientY }
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    ><div className="hsplit-grip" /></div>
  )
}

function CommitBox({ repo }: { repo: RepoView }) {
  const path = repo.path
  const s = repo.snapshot!
  const st = s.status
  const { summary, description, amend } = repo.wip
  const state = st.state
  const inOp = state.kind !== 'none'
  const setWip = (patch: Partial<RepoView['wip']>) => updateRepo(path, (r) => ({ wip: { ...r.wip, ...patch } }))
  const remaining = 72 - summary.length
  const staged = st.staged.length
  const [tab, setTab] = useState<'commit' | 'stash'>('commit')
  const [showOpts, setShowOpts] = useState(false)
  const [noVerify, setNoVerify] = useState(() => getState().settings!.skipHooksDefault)
  const [pushAfter, setPushAfter] = useState(() => getState().settings!.pushAfterCommit)
  const spell = useStore((x) => x.settings!.spellcheck)
  const [stashTitle, setStashTitle] = useState('')
  const [stashBody, setStashBody] = useState('')
  // pre-fill with the repository's commit template (commit.template) when the box is empty
  useEffect(() => {
    if (inOp || summary || description) return
    let alive = true
    void api.commitTemplate(path).then((t) => {
      if (!alive || !t) return
      const [first, ...rest] = t.split('\n')
      updateRepo(path, (r) => (r.wip.summary || r.wip.description ? {} : { wip: { ...r.wip, summary: first, description: rest.join('\n').trim() } }))
    })
    return () => { alive = false }
  }, [path, inOp]) // eslint-disable-line react-hooks/exhaustive-deps

  let label: string
  let enabled = false
  if (inOp) {
    if (st.conflicted.length) label = state.kind === 'merge' ? 'No Changes to Merge' : 'Resolve conflicts to continue'
    else if (state.kind === 'merge') { label = summary.trim() ? 'Commit and Merge' : 'Type a Message to Commit'; enabled = !!summary.trim() }
    else { label = `Continue ${opTitle(state.kind)}`; enabled = true }
  } else if (!summary.trim()) label = 'Type a Message to Commit'
  else if (!staged && !amend) label = 'Stage Changes to Commit'
  else {
    // the original's wording: "Commit Changes to N Files" + " and Push" + " (Skip Hooks)"
    label = amend ? 'Amend Previous Commit' : `Commit Changes to ${staged} File${staged === 1 ? '' : 's'}${pushAfter ? ' and Push' : ''}${noVerify ? ' (Skip Hooks)' : ''}`
    enabled = true
  }

  const submit = () => {
    if (!enabled) return
    if (inOp && state.kind !== 'merge') void A.continueOp(path)
    else void A.commit(path, { noVerify, push: pushAfter })
  }
  const dirty = st.staged.length + st.unstaged.length > 0
  const changedFiles = new Set([...st.staged, ...st.unstaged].map((f) => f.path)).size

  return (
    <div className="commit-box">
      <div className="commit-tabs">
        <span className={`commit-tab${tab === 'commit' ? ' active' : ''}`} onClick={() => setTab('commit')}><Icon name="commit" /> Commit</span>
        {!inOp ? <span className={`commit-tab icon-only${tab === 'stash' ? ' active' : ''}`} title="Stash" onClick={() => setTab('stash')}><Icon name="stash" /></span> : null}
      </div>
      {tab === 'stash' && !inOp ? (
        <div className="stash-box">
          <div className="commit-message-inputs">
            <div className="commit-summary-row">
              <input className="commit-summary-input" spellCheck={spell} placeholder="Stash title" value={stashTitle} onChange={(e) => setStashTitle(e.target.value)} />
            </div>
            <textarea className="commit-description-input" spellCheck={spell} placeholder="Description" value={stashBody} onChange={(e) => setStashBody(e.target.value)} />
          </div>
          <div className="commit-buttons">
            <button className={`btn btn-success btn-commit${dirty && stashTitle.trim() ? '' : ' disabled'}`} disabled={!dirty || !stashTitle.trim()}
              onClick={() => { void A.stashSave(path, [stashTitle.trim(), stashBody.trim()].filter(Boolean).join(' ')); setStashTitle(''); setStashBody('') }}>
              <Icon name="stash" /> {!stashTitle.trim() ? 'Type a Message to Stash' : !dirty ? 'Stage Changes to Stash' : `Stash Changes to ${changedFiles} File${changedFiles === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      ) : <>
      {!inOp ? (
        <label className="amend-check">
          <input type="checkbox" checked={amend} disabled={s.head.unborn} onChange={(e) => A.setAmend(path, e.target.checked)} /> Amend previous commit
        </label>
      ) : null}
      <div className="commit-message-inputs">
        <div className="commit-summary-row">
          <input
            className="commit-summary-input"
            spellCheck={spell}
            placeholder="Commit summary"
            value={summary}
            onChange={(e) => setWip({ summary: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) submit() }}
          />
          <span className={`commit-count${remaining < 0 ? ' over' : ''}`}>{remaining}</span>
        </div>
        <textarea
          className="commit-description-input"
          spellCheck={spell}
          placeholder="Description"
          value={description}
          onChange={(e) => setWip({ description: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) submit() }}
        />
      </div>
      {!inOp ? (
        <div className="commit-options">
          <div className="commit-options-toggle" onClick={() => setShowOpts((v) => !v)}><Icon name={showOpts ? 'chevron-down' : 'chevron-right'} /> Commit options</div>
          {showOpts ? (
            <div className="commit-options-body">
              <label className="form-check"><input type="checkbox" checked={pushAfter} onChange={(e) => setPushAfter(e.target.checked)} /> Push after committing</label>
              <label className="form-check"><input type="checkbox" checked={noVerify} onChange={(e) => setNoVerify(e.target.checked)} /> Skip Git hooks</label>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="commit-buttons">
        <button className={`btn btn-success btn-commit${enabled ? '' : ' disabled'}`} disabled={!enabled} onClick={submit}>
          <Icon name="commit" /> {label}
        </button>
        {amend && !inOp ? <button className="btn btn-default btn-commit btn-skip" onClick={() => A.setAmend(path, false)}>Cancel Amend</button> : null}
        {inOp ? (
          <>
            {state.kind === 'rebase' || state.kind === 'cherry-pick' || state.kind === 'am' ? <button className="btn btn-default btn-commit btn-skip" onClick={() => A.skipOp(path)}>Skip</button> : null}
            <button className="btn btn-danger btn-commit" onClick={() => A.abortOp(path)}>Abort {opTitle(state.kind)}</button>
          </>
        ) : null}
      </div>
      </>}
    </div>
  )
}
