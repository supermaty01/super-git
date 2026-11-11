import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RepoView } from '../store'
import { useStore, setState, updateRepo } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { fileMenu } from '../menus'
import { avatarUrl } from '../lib/avatar'
import { fullDate } from '../lib/format'
import { Icon } from './Icon'
import { FileList, FileListToolbar, summarizeFiles, StatusIcon } from './FileList'
import { WipPanel } from './WipPanel'
import * as A2 from '../actions2'
import type { Commit, FileChange, FileContext, Stash } from '@shared/types'

export function useFileListMode(): [mode: 'path' | 'tree', set: (m: 'path' | 'tree') => void] {
  const mode = useStore((s) => s.settings!.fileListMode)
  return [mode, (m) => { setState((s) => ({ settings: { ...s.settings!, fileListMode: m } })); void api.setSettings({ fileListMode: m }) }]
}

export function DetailPanel({ repo, width }: { repo: RepoView; width: number }) {
  const s = repo.snapshot!
  const sel = repo.selection
  let body = <div className="detail-empty" />
  if (sel?.kind === 'wip') body = <WipPanel repo={repo} />
  else if (sel?.kind === 'compare') body = <ComparePanel key={`${sel.a}..${sel.b}`} repo={repo} a={sel.a} b={sel.b} />
  else if (sel?.kind === 'commits' && sel.shas.length > 1) body = <MultiPanel repo={repo} shas={sel.shas} />
  else if (sel?.kind === 'commits') {
    const sha = sel.shas[0]
    const stash = s.stashes.find((x) => x.sha === sha)
    const commit = s.commits.find((c) => c.sha === sha)
    if (stash) body = <StashPanel key={sha} repo={repo} stash={stash} />
    else if (commit) body = <CommitPanel key={sha} repo={repo} commit={commit} />
  }
  return <div className="detail-panel" style={{ width }}>{body}</div>
}

function WipBanner({ repo }: { repo: RepoView }) {
  const st = repo.snapshot!.status
  const n = new Set([...st.staged, ...st.unstaged, ...st.conflicted].map((f) => f.path)).size
  if (!n && st.state.kind === 'none') return null
  return (
    <div className="wip-banner">
      {n} file change{n === 1 ? '' : 's'} in working directory
      <button className="btn btn-xs btn-outline-light" onClick={() => A.selectWip(repo.path)}>View Changes</button>
    </div>
  )
}

function CommitPanel({ repo, commit }: { repo: RepoView; commit: Commit }) {
  const path = repo.path
  const [files, setFiles] = useState<FileChange[] | null>(null)
  const [mode, setMode] = useFileListMode()
  const [sortDesc, setSortDesc] = useState(false)
  const [viewAll, setViewAll] = useState(false)
  const [allFiles, setAllFiles] = useState<string[] | null>(null)
  const [sig, setSig] = useState<{ status: string; signer: string; key: string } | null>(null)
  const parent = commit.parents[0]
  useEffect(() => {
    let alive = true
    setFiles(null)
    api.commitFiles(path, commit.sha, parent).then((f) => alive && setFiles(f)).catch(() => alive && setFiles([]))
    api.signature(path, commit.sha).then((x) => alive && setSig(x)).catch(() => undefined)
    return () => { alive = false }
  }, [path, commit.sha, parent])
  useEffect(() => {
    if (!viewAll || allFiles) return
    void api.treeFiles(path, commit.sha).then(setAllFiles)
  }, [viewAll, allFiles, path, commit.sha])
  const shown = useMemo(() => {
    if (!viewAll || !files || !allFiles) return files
    const changed = new Set(files.map((f) => f.path))
    return [...files, ...allFiles.filter((p) => !changed.has(p)).map((p) => ({ path: p, status: 'N' as const }))]
  }, [viewAll, files, allFiles])
  const active = repo.center.kind === 'file' && repo.center.ctx.kind === 'commit' && repo.center.ctx.sha === commit.sha ? repo.center.ctx.path : null
  const ctxFor = (f: FileChange): FileContext => ({ kind: 'commit', sha: commit.sha, parent, path: f.path, oldPath: f.oldPath, status: f.status })
  const coAuthors = useMemo(() => parseCoAuthors(commit.body), [commit.body])
  const committerDiffers = commit.committer && (commit.committer !== commit.author || Math.abs(commit.commitDate - commit.date) > 60000)

  return (
    <div className="commit-detail">
      <WipBanner repo={repo} />
      <div className="commit-detail-header">
        <span className="commit-sha-label">commit:</span>
        <span className="commit-sha" title="Copy commit sha" onClick={() => api.copy(commit.sha)}>{commit.sha.slice(0, 6)}</span>
      </div>
      <div className="commit-detail-scroll">
        <MessageBox>
          <div className="commit-message-summary">{commit.summary}</div>
          {commit.body ? <div className="commit-message-body">{commit.body}</div> : null}
        </MessageBox>
        <div className={`commit-author-row${coAuthors.length ? ' has-coauthors' : ''}`}>
          <div className="commit-avatar" style={{ backgroundImage: `url(${avatarUrl(commit.email, commit.author)})` }} />
          <div className="commit-author-info">
            <div className="commit-author-name" title={commit.email}>{commit.author}</div>
            <div className="commit-author-date">authored <span>{fullDate(commit.date)}</span></div>
            {committerDiffers ? <div className="commit-author-date">committed by {commit.committer} <span>{fullDate(commit.commitDate)}</span></div> : null}
            {sig ? <div className={`commit-signature sig-${sig.status === 'G' ? 'good' : sig.status === 'B' || sig.status === 'R' ? 'bad' : 'unknown'}`} title={`key ${sig.key}`}>
              <Icon name={sig.status === 'G' ? 'check-circle' : 'warning'} /> {sig.status === 'G' ? 'Verified signature' : sig.status === 'B' ? 'Bad signature' : sig.status === 'R' ? 'Revoked key' : sig.status === 'E' ? 'Signed (cannot verify — key missing)' : sig.status === 'X' || sig.status === 'Y' ? 'Signed (expired)' : 'Signed (unverified)'}{sig.signer ? ` · ${sig.signer}` : ''}
            </div> : null}
          </div>
          <div className="commit-parents">
            {commit.parents.length ? <>parent{commit.parents.length > 1 ? 's' : ''}: {commit.parents.map((p, i) => (
              <span key={p}>{i ? ',' : ''}<span className="commit-parent-link" onClick={() => { A.selectCommit(path, p); updateRepo(path, { focus: { sha: p, t: Date.now() } }) }}>{p.slice(0, 6)}</span></span>
            ))}</> : null}
          </div>
        </div>
        {coAuthors.length ? (
          <div className="commit-coauthors">
            <span className="commit-coauthors-label">Co-authors:</span>
            {coAuthors.map((c) => <div key={c.email} className="commit-coauthor" title={`${c.name} <${c.email}>`} style={{ backgroundImage: `url(${avatarUrl(c.email, c.name)})` }} />)}
          </div>
        ) : null}
        <div className="file-summary">
          {files ? summarizeFiles(files).map((x) => (
            <span key={x.status} className="file-summary-item"><StatusIcon status={x.status} /> {x.count} {x.status === 'A' ? 'added' : x.status === 'D' ? 'deleted' : x.status === 'R' ? 'renamed' : 'modified'}</span>
          )) : <span className="text-secondary">Loading…</span>}
        </div>
        {/* like the original, "View all files" shows the whole tree with every folder closed */}
        <FileListToolbar mode={viewAll ? 'tree' : mode} setMode={(m) => { if (m === 'path') setViewAll(false); setMode(m) }} sortDesc={sortDesc} setSortDesc={setSortDesc}
          extra={<label className="view-all"><input type="checkbox" checked={viewAll} onChange={(e) => setViewAll(e.target.checked)} /> View all files</label>} />
        {shown ? (
          <FileList
            key={viewAll ? 'all' : 'changed'}
            collapsed={viewAll}
            files={shown}
            mode={viewAll ? 'tree' : mode}
            sortDesc={sortDesc}
            activePath={active}
            onOpen={(f) => A.openFile(path, ctxFor(f))}
            onContext={(f) => fileMenu(path, f, 'commit', ctxFor(f))}
          />
        ) : null}
      </div>
    </div>
  )
}

function StashPanel({ repo, stash }: { repo: RepoView; stash: Stash }) {
  const path = repo.path
  const [files, setFiles] = useState<FileChange[] | null>(null)
  const [untracked, setUntracked] = useState<Set<string>>(new Set())
  const [mode, setMode] = useFileListMode()
  const [sortDesc, setSortDesc] = useState(false)
  useEffect(() => {
    let alive = true
    api.stashFiles(path, stash.sha).then((f) => alive && setFiles(f)).catch(() => alive && setFiles([]))
    if (stash.parents[2]) api.commitFiles(path, stash.parents[2]).then((f) => alive && setUntracked(new Set(f.map((x) => x.path)))).catch(() => undefined)
    return () => { alive = false }
  }, [path, stash.sha, stash.parents])
  const ctxFor = (f: FileChange): FileContext => untracked.has(f.path)
    ? { kind: 'stash', sha: stash.parents[2], parent: undefined, path: f.path, status: 'A' }
    : { kind: 'stash', sha: stash.sha, parent: stash.parents[0], path: f.path, oldPath: f.oldPath, status: f.status }
  const active = repo.center.kind === 'file' && repo.center.ctx.kind === 'stash' ? repo.center.ctx.path : null
  return (
    <div className="commit-detail">
      <div className="commit-detail-header">
        <span className="commit-sha-label">stash:</span>
        <span className="commit-sha">stash@{'{'}{stash.index}{'}'}</span>
      </div>
      <div className="commit-detail-scroll">
        <MessageBox><div className="commit-message-summary">{stash.message}</div></MessageBox>
        <div className="stash-actions">
          <button className="btn btn-primary btn-small" onClick={() => A.stashApply(path, stash.index)}>Apply Stash</button>
          <button className="btn btn-success btn-small" onClick={() => A.stashPop(path, stash.index)}>Pop Stash</button>
          <button className="btn btn-danger btn-small" onClick={() => A.stashDrop(path, stash)}>Delete Stash</button>
          <button className="btn btn-default btn-small" onClick={() => A2.renameStash(path, stash)}>Edit message</button>
        </div>
        <div className="commit-author-row"><div className="commit-author-info"><div className="commit-author-date">created <span>{fullDate(stash.date)}</span></div></div></div>
        <div className="file-summary">{files ? summarizeFiles(files).map((x) => <span key={x.status} className="file-summary-item"><StatusIcon status={x.status} /> {x.count}</span>) : null}</div>
        <FileListToolbar mode={mode} setMode={setMode} sortDesc={sortDesc} setSortDesc={setSortDesc} />
        {files ? <FileList files={files} mode={mode} sortDesc={sortDesc} activePath={active} onOpen={(f) => A.openFile(path, ctxFor(f))} /> : null}
      </div>
    </div>
  )
}

function MultiPanel({ repo, shas }: { repo: RepoView; shas: string[] }) {
  const s = repo.snapshot!
  const path = repo.path
  const commits = useMemo(() => s.commits.filter((c) => shas.includes(c.sha)), [s.commits, shas])
  return (
    <div className="commit-detail">
      <div className="commit-detail-header">{shas.length} commits selected</div>
      <div className="commit-detail-scroll">
        <div className="multi-actions">
          <button className="btn btn-primary btn-small" onClick={() => A.cherryPick(path, shas)}>Cherry pick {shas.length} commits</button>
          <button className="btn btn-default btn-small" onClick={() => A.squashCommits(path, shas)}>Squash {shas.length} commits</button>
          {shas.length === 2 ? <button className="btn btn-default btn-small" onClick={() => A2.compareCommits(path, shas[0], shas[1])}>Compare</button> : null}
          <button className="btn btn-default btn-small" onClick={() => A2.createPatch(path, shas)}>Create patch</button>
        </div>
        <div className="multi-list">
          {commits.map((c) => (
            <div key={c.sha} className="multi-row" onClick={() => A.selectCommit(path, c.sha)}>
              <div className="multi-avatar" style={{ backgroundImage: `url(${avatarUrl(c.email, c.author)})` }} />
              <div className="multi-text">
                <div className="truncate">{c.summary}</div>
                <div className="text-secondary truncate">{c.sha.slice(0, 7)} · {c.author}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ComparePanel({ repo, a, b }: { repo: RepoView; a: string; b: string | null }) {
  const path = repo.path
  const s = repo.snapshot!
  const [files, setFiles] = useState<FileChange[] | null>(null)
  const [mode, setMode] = useFileListMode()
  const [sortDesc, setSortDesc] = useState(false)
  useEffect(() => {
    let alive = true
    setFiles(null)
    api.compareFiles(path, a, b).then((f) => alive && setFiles(f)).catch(() => alive && setFiles([]))
    return () => { alive = false }
  }, [path, a, b, s])
  const label = (sha: string | null) => {
    if (!sha) return 'Working directory'
    const c = s.commits.find((x) => x.sha === sha)
    return c ? `${sha.slice(0, 7)} ${c.summary}` : sha.slice(0, 7)
  }
  const active = repo.center.kind === 'file' && repo.center.ctx.kind === 'compare' ? repo.center.ctx.path : null
  const ctxFor = (f: FileChange): FileContext => ({ kind: 'compare', a, b, path: f.path, oldPath: f.oldPath, status: f.status })
  const adds = files?.reduce((n, f) => n + (f.additions ?? 0), 0) ?? 0
  const dels = files?.reduce((n, f) => n + (f.deletions ?? 0), 0) ?? 0
  return (
    <div className="commit-detail">
      <div className="commit-detail-header">Comparing</div>
      <div className="commit-detail-scroll">
        <div className="compare-box">
          <div className="compare-side"><span className="compare-tag">A</span><span className="truncate" title={a}>{label(a)}</span></div>
          <div className="compare-arrow"><Icon name="arrow-down" /></div>
          <div className="compare-side"><span className="compare-tag b">B</span><span className="truncate">{label(b)}</span></div>
        </div>
        <div className="multi-actions">
          {b ? <button className="btn btn-default btn-small" onClick={() => A2.compareCommits(path, b, a)}>Swap</button> : null}
          <button className="btn btn-default btn-small" onClick={() => A.selectCommit(path, b ?? a)}>Done</button>
        </div>
        <div className="file-summary">
          {files ? <>
            {summarizeFiles(files).map((x) => <span key={x.status} className="file-summary-item"><StatusIcon status={x.status} /> {x.count}</span>)}
            <span className="file-summary-item"><span className="color-green">+{adds}</span> <span className="color-red">−{dels}</span></span>
          </> : <span className="text-secondary">Loading…</span>}
        </div>
        <FileListToolbar mode={mode} setMode={setMode} sortDesc={sortDesc} setSortDesc={setSortDesc} />
        {files ? <FileList files={files} mode={mode} sortDesc={sortDesc} activePath={active} onOpen={(f) => A.openFile(path, ctxFor(f))} /> : null}
        {files && !files.length ? <div className="text-secondary">No differences.</div> : null}
      </div>
    </div>
  )
}

/** `Co-authored-by: Name <email>` trailers of a commit message, one entry per email. */
export function parseCoAuthors(body: string): { name: string; email: string }[] {
  const seen = new Map<string, { name: string; email: string }>()
  for (const m of body.matchAll(/^co-authored-by:\s*(.*?)\s*<([^<>\s]+)>\s*$/gim)) {
    const email = m[2].toLowerCase()
    if (!seen.has(email)) seen.set(email, { name: m[1] || m[2], email: m[2] })
  }
  return [...seen.values()]
}

// message box height is shared by every commit / stash view, like the original (drag the handle below it)
let msgHeight = 133

function MessageBox({ children }: { children: ReactNode }) {
  const [h, setH] = useState(msgHeight)
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const y0 = e.clientY, h0 = h
    const move = (ev: PointerEvent) => { msgHeight = Math.max(50, Math.min(600, h0 + ev.clientY - y0)); setH(msgHeight) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <>
      <div className="commit-message-box" style={{ height: h }}>{children}</div>
      <div className="message-resize" onPointerDown={onDown}><span /></div>
    </>
  )
}
