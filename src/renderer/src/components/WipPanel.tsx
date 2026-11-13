import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { RepoView } from '../store'
import { updateRepo, getState, useStore } from '../store'
import * as A from '../actions'
import { fileMenu } from '../menus'
import * as QM from '../quickMenus'
import { Icon } from './Icon'
import { Checkbox } from './Checkbox'
import { FileList, FileListToolbar } from './FileList'
import { useFileListMode } from './DetailPanel'
import { useSortDesc } from '../fileListState'
import type { FileChange } from '@shared/types'

// the commit message panel's height (dragged at its top grip), shared by every repository like the original
const COMMIT_PANEL_MIN = 305
const LISTS_MIN = 218
let commitPanelHeight = COMMIT_PANEL_MIN

export function WipPanel({ repo }: { repo: RepoView }) {
  const s = repo.snapshot!
  const path = repo.path
  const st = s.status
  const state = st.state
  const [mode, setMode] = useFileListMode()
  const [sortDesc, setSortDesc] = useSortDesc()
  const [openUn, setOpenUn] = useState(true)
  const [openSt, setOpenSt] = useState(true)
  const [boxH, setBoxH] = useState(commitPanelHeight)
  const listsRef = useRef<HTMLDivElement>(null)

  const activeCtx = repo.center.kind === 'file' ? repo.center.ctx : null
  const activeUn = activeCtx?.kind === 'unstaged' ? activeCtx.path : null
  const activeSt = activeCtx?.kind === 'staged' ? activeCtx.path : null
  const activeConflict = repo.center.kind === 'merge' ? repo.center.file : null
  const total = new Set([...st.staged, ...st.unstaged, ...st.conflicted].map((f) => f.path)).size
  const branch = s.head.branch ?? s.head.sha.slice(0, 7)
  const inOp = state.kind !== 'none'
  // like the original, untracked files that have nothing to do with the merge stay out of the way while it runs
  const opUnstaged = st.unstaged.filter((f) => f.status !== '?')

  // the original's selection-aware buttons: "Stage 2 Files", "Unstage 2 Files", trash + "2" ("Discard 2 files")
  const multi = repo.fileSel.length > 1 ? new Set(repo.fileSel) : null
  const selUn = multi ? st.unstaged.filter((f) => multi.has(f.path)) : []
  const selSt = multi ? st.staged.filter((f) => multi.has(f.path)) : []
  const forRow = (list: FileChange[], f: FileChange) => (multi?.has(f.path) ? list.filter((x) => multi.has(x.path)) : [f])

  const openUnstaged = (f: FileChange) => A.openFile(path, { kind: 'unstaged', path: f.path, status: f.status })
  const openStaged = (f: FileChange) => A.openFile(path, { kind: 'staged', path: f.path, oldPath: f.oldPath, status: f.status })
  const setSel = (paths: string[]) => updateRepo(path, { fileSel: paths })
  const close = () => A.closeCenter(path)

  const unstagedList = (
    <FileList
      files={inOp ? opUnstaged : st.unstaged}
      mode={mode}
      sortDesc={sortDesc}
      activePath={activeUn}
      selected={repo.fileSel}
      onSelect={setSel}
      onOpen={openUnstaged}
      onClose={close}
      onContext={(f) => fileMenu(path, f, 'unstaged')}
      onDirContext={(d, fl) => QM.dirMenu(path, d, fl, 'unstaged')}
      rowAction={(f) => <button className="btn btn-success btn-xs" onClick={() => A.stageFiles(path, forRow(st.unstaged, f))}>Stage File</button>}
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
      onClose={close}
      onContext={(f) => fileMenu(path, f, 'staged')}
      onDirContext={(d, fl) => QM.dirMenu(path, d, fl, 'staged')}
      rowAction={(f) => <button className="btn btn-danger btn-xs" onClick={() => A.unstageFiles(path, forRow(st.staged, f))}>Unstage File</button>}
    />
  )

  // the grip at the top of the commit panel: it grows upwards, the two lists keep sharing what is left 50/50
  const onGrip = (e: React.PointerEvent) => {
    e.preventDefault()
    const y0 = e.clientY, h0 = boxH
    const room = (listsRef.current?.clientHeight ?? 0) - LISTS_MIN
    const max = Math.max(COMMIT_PANEL_MIN, h0 + room)
    const move = (ev: PointerEvent) => { commitPanelHeight = Math.max(COMMIT_PANEL_MIN, Math.min(max, h0 - (ev.clientY - y0))); setBoxH(commitPanelHeight) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing-rows') }
    document.body.classList.add('resizing-rows')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const section = (open: boolean) => ({ flex: open ? '1 1 0' : '0 0 auto' })
  const caret = (open: boolean) => <Icon name="caret-down" className="wip-caret" style={open ? undefined : { transform: 'rotate(-90deg)' }} />

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
          <button className="btn btn-danger btn-small wip-discard" title={selUn.length > 1 ? `Discard ${selUn.length} files` : 'Discard all changes'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (selUn.length > 1 ? A.discardFiles(path, selUn) : A.discardAll(path))}>
            <Icon name="trash" />{selUn.length > 1 ? <span className="fs-2 ml1">{selUn.length}</span> : null}
          </button>
          <span className="wip-header-text">{`${total} file change${total === 1 ? '' : 's'} on`} <span className="pill pill-teal" title={branch}>{branch}</span></span>
        </div>
      )}

      <FileListToolbar mode={mode} setMode={setMode} sortDesc={sortDesc} setSortDesc={setSortDesc} />

      <div className="wip-lists" ref={listsRef}>
        {st.conflicted.length || inOp ? (
          <div className="wip-section" style={section(openUn)}>
            <div className="wip-section-header">
              <span className="wip-section-toggle" onClick={() => setOpenUn((v) => !v)}>{caret(openUn)}<span className="wip-section-title">{`Conflicted Files (${st.conflicted.length})`}</span></span>
              {st.conflicted.length ? <button className="btn btn-warning btn-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => void A.markResolved(path, st.conflicted.map((f) => f.path))}>Mark All Resolved</button> : null}
            </div>
            {openUn ? (
              <div className="wip-section-body">
                <FileList
                  files={st.conflicted}
                  mode={mode}
                  sortDesc={sortDesc}
                  activePath={activeConflict}
                  onOpen={(f) => A.openMerge(path, f.path)}
                  onClose={close}
                  onContext={(f) => fileMenu(path, f, 'conflicted')}
                  onDirContext={(d, fl) => QM.dirMenu(path, d, fl, 'conflicted')}
                  rowAction={(f) => <button className="btn btn-warning btn-xs" onClick={() => A.markResolved(path, [f.path])}>Mark Resolved</button>}
                />
                {opUnstaged.length ? <><div className="wip-subheader">{`Unstaged Files (${opUnstaged.length})`}</div>{unstagedList}</> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="wip-section" style={section(openUn)}>
            <div className="wip-section-header">
              <span className="wip-section-toggle" onClick={() => setOpenUn((v) => !v)}>{caret(openUn)}<span className="wip-section-title">{`Unstaged Files (${st.unstaged.length})`}</span></span>
              {st.unstaged.length ? (
                <button className="btn btn-success btn-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => void (selUn.length > 1 ? A.stageFiles(path, selUn) : A.stageAll(path))}>
                  {selUn.length > 1 ? `Stage ${selUn.length} Files` : 'Stage All Changes'}
                </button>
              ) : null}
            </div>
            {openUn ? <div className="wip-section-body">{unstagedList}</div> : null}
          </div>
        )}
        <div className="wip-section" style={section(openSt)}>
          <div className="wip-section-header">
            <span className="wip-section-toggle" onClick={() => setOpenSt((v) => !v)}>{caret(openSt)}<span className="wip-section-title">{`${inOp ? 'Resolved Files' : 'Staged Files'} (${st.staged.length})`}</span></span>
            {st.staged.length && !inOp ? (
              <button className="btn btn-danger btn-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => void (selSt.length > 1 ? A.unstageFiles(path, selSt) : A.unstageAll(path))}>
                {selSt.length > 1 ? `Unstage ${selSt.length} Files` : 'Unstage All Changes'}
              </button>
            ) : null}
          </div>
          {openSt ? <div className="wip-section-body">{stagedList}</div> : null}
        </div>
      </div>

      <div className="commit-panel" style={{ height: boxH }}>
        <div className="commit-panel-grip" title="Resize Panel" onPointerDown={onGrip}><span /></div>
        <CommitBox repo={repo} />
      </div>
    </div>
  )
}

function opTitle(kind: string) {
  return kind === 'merge' ? 'Merge' : kind === 'rebase' ? 'Rebase' : kind === 'cherry-pick' ? 'Cherry pick' : kind === 'am' ? 'Patch' : 'Revert'
}

/** the original's commit button wording, in its rule order */
export function commitLabel(o: { staged: number; amend: boolean; summary: string; push: boolean; skipHooks: boolean }): { label: string; enabled: boolean } {
  if (!o.staged && !o.amend) return { label: 'Stage Changes to Commit', enabled: false }
  if (!o.summary.trim()) return { label: 'Type a Message to Commit', enabled: false }
  const suffix = `${o.push ? ' and Push' : ''}${o.skipHooks ? ' (Skip Hooks)' : ''}`
  if (o.amend) return { label: `Amend Previous Commit${suffix}`, enabled: true }
  return { label: `Commit Changes to ${o.staged} File${o.staged === 1 ? '' : 's'}${suffix}`, enabled: true }
}

const SUMMARY_TIP = 'Commit summaries no longer than 72 characters will be fully displayed in most websites and CLI tools.'

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
  const [hooks, setHooks] = useState<string[]>([])
  const spell = useStore((x) => x.settings!.spellcheck)
  const [stashTitle, setStashTitle] = useState('')
  const [stashBody, setStashBody] = useState('')
  const summaryRef = useRef<HTMLInputElement>(null)
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
  // like the original: "Skip Git hooks" is only offered when the repository has commit hooks
  useEffect(() => {
    let alive = true
    void api.commitHooks(path).then((h) => alive && setHooks(h)).catch(() => undefined)
    return () => { alive = false }
  }, [path, showOpts])
  const skipHooks = noVerify && hooks.length > 0

  let label: string
  let enabled = false
  if (inOp) {
    if (st.conflicted.length) label = state.kind === 'merge' ? 'No Changes to Merge' : 'Resolve conflicts to continue'
    else if (state.kind === 'merge') { label = summary.trim() ? 'Commit and Merge' : 'Type a Message to Commit'; enabled = !!summary.trim() }
    else { label = `Continue ${opTitle(state.kind)}`; enabled = true }
  } else ({ label, enabled } = commitLabel({ staged, amend, summary, push: pushAfter, skipHooks }))

  const submit = async () => {
    if (!enabled) return
    if (inOp && state.kind !== 'merge') { void A.continueOp(path); return }
    await A.commit(path, { noVerify: skipHooks, push: pushAfter })
    // like the original, the commit options go back to their defaults after a commit
    const set = getState().settings!
    setNoVerify(set.skipHooksDefault)
    setPushAfter(set.pushAfterCommit)
  }
  const dirty = st.staged.length + st.unstaged.length > 0
  const changedFiles = new Set([...st.staged, ...st.unstaged].map((f) => f.path)).size
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) void submit() }

  return (
    <div className="commit-box">
      <div className="commit-tabs">
        <span className={`commit-tab${tab === 'commit' ? ' active' : ''}`} onClick={() => setTab('commit')}><Icon name="commit" /> Commit</span>
        {!inOp ? <span className={`commit-tab icon-only${tab === 'stash' ? ' active' : ''}`} title="Stash" onClick={() => setTab('stash')}><Icon name="stash" /></span> : null}
        <span className="commit-tabs-end" />
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
        <div className="amend-check">
          <Checkbox checked={amend} disabled={s.head.unborn} onChange={(v) => { void A.setAmend(path, v).then(() => { if (v) summaryRef.current?.focus() }) }}>Amend previous commit</Checkbox>
        </div>
      ) : null}
      <div className="commit-message-inputs">
        <div className="commit-summary-row">
          <input
            ref={summaryRef}
            className="commit-summary-input"
            spellCheck={spell}
            placeholder="Commit summary"
            value={summary}
            onChange={(e) => setWip({ summary: e.target.value })}
            onKeyDown={onEnter}
          />
          <span className={`commit-count${remaining < 0 ? ' over' : ''}`} title={SUMMARY_TIP}>{remaining}</span>
        </div>
        <textarea
          className="commit-description-input"
          spellCheck={spell}
          placeholder="Description"
          value={description}
          onChange={(e) => setWip({ description: e.target.value })}
          onKeyDown={onEnter}
        />
      </div>
      {!inOp ? (
        <div className="commit-options">
          <div className="commit-options-toggle" onClick={() => setShowOpts((v) => !v)}><Icon name={showOpts ? 'chevron-down' : 'chevron-right'} /> Commit options</div>
          {showOpts ? (
            <div className={`commit-checkboxes${hooks.length ? ' two' : ''}`}>
              <Checkbox checked={pushAfter} onChange={setPushAfter}>Push after committing</Checkbox>
              {hooks.length ? <Checkbox checked={noVerify} onChange={setNoVerify}>Skip Git hooks</Checkbox> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="commit-buttons">
        <button className={`btn btn-success btn-commit${enabled ? '' : ' disabled'}`} disabled={!enabled} onClick={() => void submit()}>
          <Icon name="commit" /> {label}
        </button>
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
