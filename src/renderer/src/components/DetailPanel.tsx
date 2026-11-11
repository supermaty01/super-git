import { flashTip } from './Tooltip'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RepoView } from '../store'
import { useStore, setState, updateRepo } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { fileMenu, stashMenu } from '../menus'
import { avatarUrl } from '../lib/avatar'
import { fullDate, parseStash } from '../lib/format'
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
        <span className="commit-sha" title="Copy commit sha" onClick={(e) => { const el = e.currentTarget; void api.copy(commit.sha).then(() => flashTip(el, 'Copied!')) }}>{commit.sha.slice(0, 6)}</span>
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
            {sig ? <div className={`commit-signature sig-${sig.status === 'G' ? 'good' : sig.status === 'B' || sig.status === 'R' ? 'bad' : 'unknown'}`} title={`key ${sig.key}`}>
              <Icon name={sig.status === 'G' ? 'check-circle' : 'warning'} /> {sig.status === 'G' ? 'Verified signature' : sig.status === 'B' ? 'Bad signature' : sig.status === 'R' ? 'Revoked key' : sig.status === 'E' ? 'Signed (cannot verify — key missing)' : sig.status === 'X' || sig.status === 'Y' ? 'Signed (expired)' : 'Signed (unverified)'}{sig.signer ? ` · ${sig.signer}` : ''}
            </div> : null}
          </div>
          <div className="commit-parents">
            {commit.parents.length ? <>parent: {commit.parents.map((p, i) => (
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
        {committerDiffers ? (
          <div className="commit-author-row committer-row">
            <div className="commit-avatar" style={{ backgroundImage: `url(${avatarUrl(commit.committerEmail, commit.committer)})` }} />
            <div className="commit-author-info">
              <div className="commit-author-name" title={commit.committerEmail}>{commit.committer}</div>
              <div className="commit-author-date">committed <span>{fullDate(commit.commitDate)}</span></div>
            </div>
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
  const [info, setInfo] = useState<Commit | null>(null)
  const [mode, setMode] = useFileListMode()
  const [sortDesc, setSortDesc] = useState(false)
  useEffect(() => {
    let alive = true
    api.stashFiles(path, stash.sha).then((f) => alive && setFiles(f)).catch(() => alive && setFiles([]))
    api.commitDetails(path, stash.sha).then((c) => alive && setInfo(c)).catch(() => undefined)
    if (stash.parents[2]) api.commitFiles(path, stash.parents[2]).then((f) => alive && setUntracked(new Set(f.map((x) => x.path)))).catch(() => undefined)
    return () => { alive = false }
  }, [path, stash.sha, stash.parents])
  const ctxFor = (f: FileChange): FileContext => untracked.has(f.path)
    ? { kind: 'stash', sha: stash.parents[2], parent: undefined, path: f.path, status: 'A' }
    : { kind: 'stash', sha: stash.sha, parent: stash.parents[0], path: f.path, oldPath: f.oldPath, status: f.status }
  const active = repo.center.kind === 'file' && repo.center.ctx.kind === 'stash' ? repo.center.ctx.path : null
  const { msg } = parseStash(stash.message)
  const base = stash.parents[0]
  return (
    <div className="commit-detail" onContextMenu={(e) => { if ((e.target as HTMLElement).closest('.file-row')) return; e.preventDefault(); void stashMenu(path, stash) }}>
      <div className="commit-detail-header">
        <span className="commit-sha-label">commit:</span>
        <span className="commit-sha" title="Copy commit sha" onClick={(e) => { const el = e.currentTarget; void api.copy(stash.sha).then(() => flashTip(el, 'Copied!')) }}>{stash.sha.slice(0, 6)}</span>
      </div>
      <div className="commit-detail-scroll">
        <MessageBox>
          <div className="commit-message-summary stash-message-edit" title="Click to amend your stash message" onClick={() => A2.renameStash(path, stash)}>{msg}</div>
        </MessageBox>
        <div className="commit-author-row">
          {info ? <div className="commit-avatar" style={{ backgroundImage: `url(${avatarUrl(info.email, info.author)})` }} /> : null}
          <div className="commit-author-info">
            {info ? <div className="commit-author-name" title={info.email}>{info.author}</div> : null}
            <div className="commit-author-date">authored <span>{fullDate(info?.date ?? stash.date)}</span></div>
          </div>
          <div className="commit-parents">
            {base ? <>parent: <span className="commit-parent-link" onClick={() => { A.selectCommit(path, base); updateRepo(path, { focus: { sha: base, t: Date.now() } }) }}>{base.slice(0, 6)}</span></> : null}
          </div>
        </div>
        <FileSummary files={files} />
        <FileListToolbar mode={mode} setMode={setMode} sortDesc={sortDesc} setSortDesc={setSortDesc} />
        {files ? <FileList files={files} mode={mode} sortDesc={sortDesc} activePath={active} onOpen={(f) => A.openFile(path, ctxFor(f))} /> : null}
      </div>
    </div>
  )
}

/** "1 modified  2 added …", in the original's order */
function FileSummary({ files }: { files: FileChange[] | null }) {
  return (
    <div className="file-summary">
      {files ? summarizeFiles(files).map((x) => (
        <span key={x.status} className="file-summary-item"><StatusIcon status={x.status} /> {x.count} {x.status === 'A' ? 'added' : x.status === 'D' ? 'deleted' : x.status === 'R' ? 'renamed' : 'modified'}</span>
      )) : <span className="text-secondary">Loading…</span>}
    </div>
  )
}

function MultiPanel({ repo, shas }: { repo: RepoView; shas: string[] }) {
  const s = repo.snapshot!
  // graph order, newest first
  const commits = useMemo(() => s.commits.filter((c) => shas.includes(c.sha)), [s.commits, shas])
  if (commits.length === 2) return <TwoCommitsPanel repo={repo} cards={commits} a={commits[1].sha} b={commits[0].sha} caption="Viewing diff between 2 commits" />
  // like the original: a contiguous range shows its combined diff, anything else only lists the commits
  const contiguous = commits.length > 1 && commits.every((c, i) => i === commits.length - 1 || c.parents[0] === commits[i + 1].sha)
  const base = commits[commits.length - 1]?.parents[0]
  if (contiguous && base) return <TwoCommitsPanel repo={repo} cards={commits} a={base} b={commits[0].sha} caption={`Viewing diff of ${commits.length} commits`} title={`${shas.length} commits selected`} />
  return (
    <div className="commit-detail">
      <WipBanner repo={repo} />
      <div className="commit-detail-header">{shas.length} commits selected</div>
      <div className="commit-detail-scroll">
        {commits.map((c) => <CompareCard key={c.sha} path={repo.path} c={c} />)}
        <div className="compare-caption multi-no-diff">A combined diff is not shown for this selection. Select a contiguous range of commits, or one or two items, to see their changes.</div>
      </div>
    </div>
  )
}

function CompareCard({ path, c }: { path: string; c: Commit }) {
  return (
    <div className="compare-card" onClick={() => { A.selectCommit(path, c.sha); updateRepo(path, { focus: { sha: c.sha, t: Date.now() } }) }}>
      <div className="compare-card-summary truncate">{c.summary}</div>
      <div className="compare-card-meta"><span>{fullDate(c.date)} by {c.author}</span><span className="compare-card-sha">{c.sha.slice(0, 7)}</span></div>
    </div>
  )
}

function TwoCommitsPanel({ repo, cards, a, b, caption, title = '2 commits selected' }: { repo: RepoView; cards: Commit[]; a: string; b: string; caption: string; title?: string }) {
  const path = repo.path
  const [files, setFiles] = useState<FileChange[] | null>(null)
  const [mode, setMode] = useFileListMode()
  const [sortDesc, setSortDesc] = useState(false)
  useEffect(() => {
    let alive = true
    setFiles(null)
    api.compareFiles(path, a, b).then((f) => alive && setFiles(f)).catch(() => alive && setFiles([]))
    return () => { alive = false }
  }, [path, a, b])
  const active = repo.center.kind === 'file' && repo.center.ctx.kind === 'compare' ? repo.center.ctx.path : null
  const ctxFor = (f: FileChange): FileContext => ({ kind: 'compare', a, b, path: f.path, oldPath: f.oldPath, status: f.status })
  return (
    <div className="commit-detail">
      <WipBanner repo={repo} />
      <div className="commit-detail-header">{title}</div>
      <div className="commit-detail-scroll">
        <div className="compare-caption">{caption}</div>
        {cards.map((c) => <CompareCard key={c.sha} path={path} c={c} />)}
        <FileSummary files={files} />
        <FileListToolbar mode={mode} setMode={setMode} sortDesc={sortDesc} setSortDesc={setSortDesc} />
        {files ? <FileList files={files} mode={mode} sortDesc={sortDesc} activePath={active} onOpen={(f) => A.openFile(path, ctxFor(f))} /> : null}
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
