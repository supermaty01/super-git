import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { RepoView } from '../store'
import { useStore, setState, updateRepo } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import * as A2 from '../actions2'
import { colorizeLines, colorizeRich, languageFor } from '../lib/monaco'
import { markRanges, wordDiff } from '../lib/decorate'
import { fullDate, errMsg } from '../lib/format'
import { avatarUrl } from '../lib/avatar'
import { Icon } from './Icon'
import { StatusIcon } from './FileList'
import { MonacoDiff, MonacoFile, type MonacoDiffHandle } from './MonacoDiff'
import type { FileContext, FileContents, DiffHunk, BlameLine, Commit } from '@shared/types'

type View = 'diff' | 'file' | 'blame' | 'history'

export function DiffView({ repo, ctx, startEditing }: { repo: RepoView; ctx: FileContext; startEditing?: boolean }) {
  const path = repo.path
  const settings = useStore((s) => s.settings!)
  const mode = settings.diffMode
  const [view, setView] = useState<View>('diff')
  const [ignoreWs, setIgnoreWs] = useState(settings.showWhitespace)
  const [wrap, setWrap] = useState(settings.wordWrap)
  const [data, setData] = useState<FileContents | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const diffRef = useRef<MonacoDiffHandle>(null)
  const hunkRef = useRef<HunkViewHandle>(null)

  const key = `${ctx.kind}:${'sha' in ctx ? ctx.sha : ctx.kind === 'compare' ? `${ctx.a}..${ctx.b}` : ''}:${ctx.path}`
  useEffect(() => { setView(ctx.status === 'N' || startEditing ? 'file' : 'diff'); setEditing(!!startEditing && ctx.kind === 'unstaged'); setDraft(null) }, [key, startEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    api.fileContents(path, ctx, ignoreWs)
      .then((d) => {
        if (!alive) return
        setData((prev) => (prev && prev.original === d.original && prev.modified === d.modified && prev.binary === d.binary && JSON.stringify(prev.diff) === JSON.stringify(d.diff) ? prev : d))
        setError(null)
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => { alive = false }
    // re-read whenever the repo snapshot changes (file edited / staged)
  }, [path, key, ignoreWs, repo.snapshot]) // eslint-disable-line react-hooks/exhaustive-deps

  const setMode = (m: 'hunk' | 'inline' | 'split') => {
    setState((s) => ({ settings: { ...s.settings!, diffMode: m } }))
    void api.setSettings({ diffMode: m })
    setView('diff')
  }

  const canEdit = ctx.kind === 'unstaged' && ctx.status !== 'D'
  const badge = ctx.kind === 'unstaged' ? 'Unstaged' : ctx.kind === 'staged' ? 'Staged' : ctx.kind === 'stash' ? 'Stash'
    : ctx.kind === 'compare' ? `${ctx.a.slice(0, 7)} → ${ctx.b ? ctx.b.slice(0, 7) : 'working dir'}` : `${ctx.sha.slice(0, 7)}`
  const isImage = !!(data?.originalImage || data?.modifiedImage)
  const fileSelf = { path: ctx.path, oldPath: 'oldPath' in ctx ? ctx.oldPath : undefined, status: ctx.status }

  const save = async () => {
    if (draft === null) return
    await A.run(path, () => api.writeFile(path, ctx.path, draft), { errorTitle: 'Save failed' })
    setDraft(null)
    setEditing(false)
  }

  return (
    <div className="file-view">
      <div className="file-view-header">
        <StatusIcon status={ctx.status} />
        <span className="file-view-title" title={ctx.path}>
          {'oldPath' in ctx && ctx.oldPath ? <span className="fv-dir">{ctx.oldPath} → </span> : null}
          {ctx.path.includes('/') ? <span className="fv-dir">{ctx.path.slice(0, ctx.path.lastIndexOf('/') + 1)}</span> : null}
          <span className="fv-name">{ctx.path.slice(ctx.path.lastIndexOf('/') + 1)}</span>
        </span>
        <span className="grow" />
        {ctx.kind === 'unstaged' ? <button className="btn btn-success btn-small" onClick={() => A.stageFiles(path, [fileSelf])}>Stage File</button> : null}
        {ctx.kind === 'staged' ? <button className="btn btn-danger btn-small" onClick={() => A.unstageFiles(path, [fileSelf])}>Unstage File</button> : null}
        <span className="file-view-tool" title="Open in external diff tool (git difftool)" onClick={() => api.externalDiffTool(path, ctx.path, ctx.kind === 'staged', ctx.kind === 'commit' || ctx.kind === 'stash' ? ctx.parent : ctx.kind === 'compare' ? ctx.a : undefined, ctx.kind === 'commit' || ctx.kind === 'stash' ? ctx.sha : ctx.kind === 'compare' ? ctx.b ?? undefined : undefined)}><Icon name="compare" /></span>
        {ctx.status !== 'D' ? <span className="file-view-tool" title="Open in external editor" onClick={() => A2.openInEditor(path, ctx.path)}><Icon name="external" /></span> : null}
        <span className="file-view-close" title="Close (Esc)" onClick={() => A.closeCenter(path)}><Icon name="times" /></span>
      </div>
      <div className="file-view-toolbar">
        <div className="fv-left">
          {canEdit ? (
            editing
              ? <><button className="btn btn-success btn-small" disabled={draft === null} onClick={save}><Icon name="save" /> Save</button><button className="btn btn-default btn-small ml1" onClick={() => { setEditing(false); setDraft(null) }}>Cancel</button></>
              : <button className="btn btn-primary-outline btn-small" onClick={() => { setEditing(true); setView('file') }}><Icon name="pen" /> Edit This File</button>
          ) : ctx.status !== 'D' && ctx.kind !== 'compare' && repo.snapshot ? (
            <button className="btn btn-primary-outline btn-small" title="Open the current version of this file for editing"
              onClick={() => updateRepo(path, { center: { kind: 'file', ctx: { kind: 'unstaged', path: ctx.path, status: 'M' }, edit: true } })}>
              <Icon name="pen" /> Edit in Working Directory
            </button>
          ) : null}
        </div>
        <div className="fv-center">
          {ctx.kind === 'compare' ? <span className="fv-badge">{badge}</span> : null}
          <div className="btn-group toggle-group">
            <button className={`toggle-btn${view === 'file' ? ' checked' : ''}`} onClick={() => setView('file')} disabled={!data || data.binary}>File View</button>
            <button className={`toggle-btn${view === 'diff' ? ' checked' : ''}`} onClick={() => { setView('diff'); setEditing(false) }}>Diff View</button>
          </div>
        </div>
        <div className="fv-right">
          <div className="btn-group toggle-group">
            <button className={`toggle-btn${view === 'blame' ? ' checked' : ''}`} disabled={ctx.status === 'A' || ctx.status === '?'} onClick={() => setView(view === 'blame' ? 'diff' : 'blame')}>Blame</button>
            <button className={`toggle-btn${view === 'history' ? ' checked' : ''}`} onClick={() => setView(view === 'history' ? 'diff' : 'history')}>History</button>
          </div>
          <div className="btn-group toggle-group">
            <button className="toggle-btn" title="Previous change" onClick={() => (mode === 'hunk' ? hunkRef.current?.prev() : diffRef.current?.prev())}><Icon name="arrow-up" /></button>
            <button className="toggle-btn" title="Next change" onClick={() => (mode === 'hunk' ? hunkRef.current?.next() : diffRef.current?.next())}><Icon name="arrow-down" /></button>
          </div>
          <div className="btn-group toggle-group">
            <button className={`toggle-btn icon-only${mode === 'hunk' && view === 'diff' ? ' checked' : ''}`} title="Hunk View" onClick={() => setMode('hunk')}><Icon name="view-hunk" /></button>
            <button className={`toggle-btn icon-only${mode === 'inline' && view === 'diff' ? ' checked' : ''}`} title="Inline View" onClick={() => setMode('inline')}><Icon name="view-inline" /></button>
            <button className={`toggle-btn icon-only${mode === 'split' && view === 'diff' ? ' checked' : ''}`} title="Split View" onClick={() => setMode('split')}><Icon name="view-split" /></button>
          </div>
          <div className="btn-group toggle-group">
            <button className={`toggle-btn icon-only${ignoreWs ? ' checked' : ''}`} title="Ignore whitespace" onClick={() => { setIgnoreWs(!ignoreWs); void api.setSettings({ showWhitespace: !ignoreWs }) }}><Icon name="paragraph" /></button>
            <button className={`toggle-btn icon-only${wrap ? ' checked' : ''}`} title="Word wrap" onClick={() => { setWrap(!wrap); void api.setSettings({ wordWrap: !wrap }) }}><Icon name="align-left" /></button>
          </div>
        </div>
      </div>
      <div className="file-view-body">
        {error ? <div className="file-view-message">{error}</div>
          : !data ? <div className="loading"><div className="spinner" /></div>
            : isImage && view !== 'history' ? <ImageDiff data={data} />
            : data.binary && view !== 'history' ? <div className="file-view-message">Binary file — no text diff available.</div>
              : view === 'file' ? (
                <MonacoFile value={draft ?? data.modified} file={ctx.path} readOnly={!editing} wrap={wrap} onChange={(v) => editing && setDraft(v)} onSave={save} />
              ) : view === 'blame' ? <BlameView repo={repo} ctx={ctx} />
                : view === 'history' ? <HistoryView repo={repo} ctx={ctx} ignoreWs={ignoreWs} wrap={wrap} />
                  : mode === 'hunk' ? <HunkView ref={hunkRef} repo={repo} ctx={ctx} data={data} />
                    : <MonacoDiff ref={diffRef} original={data.original} modified={data.modified} file={ctx.path} sideBySide={mode === 'split'} ignoreWs={ignoreWs} wrap={wrap} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Hunk view with hunk- and line-level staging

interface HunkViewHandle { next(): void; prev(): void }


const HunkView = forwardRef<HunkViewHandle, { repo: RepoView; ctx: FileContext; data: FileContents }>(function HunkView({ repo, ctx, data }, ref) {
  const path = repo.path
  const [oldHtml, setOldHtml] = useState<string[]>([])
  const [newHtml, setNewHtml] = useState<string[]>([])
  const [sel, setSel] = useState<Record<number, number[]>>({})
  const scroller = useRef<HTMLDivElement>(null)
  const current = useRef(0)
  const hunks = data.diff?.hunks ?? []

  useEffect(() => {
    const lang = languageFor(ctx.path)
    void colorizeRich(data.original, lang).then(setOldHtml)
    void colorizeRich(data.modified, lang).then(setNewHtml)
  }, [data.original, data.modified, ctx.path])
  const diffSig = useMemo(() => JSON.stringify(data.diff?.hunks ?? []), [data.diff])
  // changed words inside modified lines: each run of removed lines is paired with the added run after it
  const words = useMemo(() => hunks.map((h) => {
    const marks = new Map<number, Array<[number, number]>>()
    const share = (r: Array<[number, number]>, len: number) => r.reduce((n, [a, b]) => n + b - a, 0) / Math.max(1, len)
    for (let i = 0; i < h.lines.length;) {
      if (h.lines[i].type !== 'del') { i++; continue }
      const dels: number[] = []
      while (i < h.lines.length && h.lines[i].type === 'del') dels.push(i++)
      const adds: number[] = []
      while (i < h.lines.length && h.lines[i].type === 'add') adds.push(i++)
      for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
        const a = h.lines[dels[k]].content, b = h.lines[adds[k]].content
        const d = wordDiff(a, b)
        // a line that changed almost entirely reads better without word marks
        if (share(d.removed, a.length) > 0.8 || share(d.added, b.length) > 0.8) continue
        marks.set(dels[k], d.removed)
        marks.set(adds[k], d.added)
      }
    }
    return marks
  }), [diffSig]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSel({}) }, [diffSig, ctx.kind, ctx.path])

  const goto = (d: number) => {
    const els = scroller.current?.querySelectorAll<HTMLElement>('.hunk')
    if (!els?.length) return
    current.current = Math.max(0, Math.min(els.length - 1, current.current + d))
    els[current.current].scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  useImperativeHandle(ref, () => ({ next: () => goto(1), prev: () => goto(-1) }))

  const editable = ctx.kind === 'unstaged' || ctx.kind === 'staged'
  const toggleLine = (h: number, i: number) => {
    if (!editable) return
    setSel((s) => {
      const cur = s[h] ?? []
      return { ...s, [h]: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] }
    })
  }

  if (!hunks.length) return <div className="file-view-message">{data.original === data.modified ? 'No changes' : 'Only whitespace or mode changes'}</div>
  return (
    <div className="hunk-view" ref={scroller}>
      {hunks.map((h: DiffHunk, hi) => {
        const lines = sel[hi] ?? []
        const partial = lines.length > 0
        return (
          <div className="hunk" key={hi}>
            <div className="hunk-header">
              <span className="hunk-range">{h.header.replace(/^(@@[^@]*@@).*/, '$1')}</span>
              <span className="grow" />
              {ctx.kind === 'commit' ? <button className="btn btn-default btn-xs" title="Undo this change in the working directory" onClick={() => A.applyHunk(path, ctx, hi, null, 'revert')}>Revert Hunk</button> : null}
              {ctx.kind === 'unstaged' ? (
                <>
                  <button className="btn btn-danger btn-xs" onClick={() => A.applyHunk(path, ctx, hi, partial ? lines : null, 'discard')}>{partial ? 'Discard Lines' : 'Discard Hunk'}</button>
                  <button className="btn btn-success btn-xs" onClick={() => A.applyHunk(path, ctx, hi, partial ? lines : null, 'stage')}>{partial ? 'Stage Lines' : 'Stage Hunk'}</button>
                </>
              ) : ctx.kind === 'staged' ? (
                <button className="btn btn-danger btn-xs" onClick={() => A.applyHunk(path, ctx, hi, partial ? lines : null, 'unstage')}>{partial ? 'Unstage Lines' : 'Unstage Hunk'}</button>
              ) : null}
            </div>
            <div className="hunk-lines">
              {h.lines.map((l, li) => {
                if (l.type === 'nonewline') return <div key={li} className="hunk-line nonewline"><span className="ln" /><span className="ln" /><span className="mark" /><span className="code">{l.content}</span></div>
                const base = l.type === 'del' ? oldHtml[(l.oldLine ?? 1) - 1] : newHtml[(l.newLine ?? 1) - 1]
                const marks = words[hi]?.get(li)
                const html = base && marks?.length ? markRanges(base, marks, l.type === 'add' ? 'wd-add' : 'wd-del') : base
                const selectable = editable && l.type !== 'context'
                const isSel = lines.includes(li)
                return (
                  <div key={li} className={`hunk-line ${l.type}${isSel ? ' line-selected' : ''}${selectable ? ' selectable' : ''}`} onClick={() => selectable && toggleLine(hi, li)} title={selectable ? 'Click to select this line for staging' : undefined}>
                    <span className="ln">{l.oldLine ?? ''}</span>
                    <span className="ln">{l.newLine ?? ''}</span>
                    <span className="mark">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</span>
                    <span className="code" dangerouslySetInnerHTML={{ __html: html ?? escape(l.content) }} />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})

function escape(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;') }

// ---------------------------------------------------------------------------------------------
// Blame

function BlameView({ repo, ctx }: { repo: RepoView; ctx: FileContext }) {
  const path = repo.path
  const [lines, setLines] = useState<BlameLine[] | null>(null)
  const [html, setHtml] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const sha = ctx.kind === 'commit' || ctx.kind === 'stash' ? ctx.sha : undefined
  useEffect(() => {
    let alive = true
    api.blame(path, ctx.path, sha).then((b) => alive && setLines(b)).catch((e) => alive && setErr(errMsg(e)))
    api.fileContents(path, ctx, false).then((d) => colorizeLines(d.modified, languageFor(ctx.path))).then((h) => alive && setHtml(h)).catch(() => undefined)
    return () => { alive = false }
  }, [path, ctx, sha])
  if (err) return <div className="file-view-message">{err}</div>
  if (!lines) return <div className="loading"><div className="spinner" /></div>
  return (
    <div className="blame-view">
      {lines.map((l, i) => {
        const first = i === 0 || lines[i - 1].sha !== l.sha
        const uncommitted = /^0+$/.test(l.sha)
        return (
          <div key={i} className={`blame-line${first ? ' first' : ''}`}>
            <span className="blame-meta" onClick={() => { if (!uncommitted) { A.selectCommit(path, l.sha); updateRepo(path, { focus: { sha: l.sha, t: Date.now() }, center: { kind: 'graph' } }) } }}>
              {first ? <>
                <span className="blame-avatar" style={{ backgroundImage: `url(${avatarUrl('', l.author)})` }} />
                <span className="blame-sha">{uncommitted ? 'Uncommitted' : l.sha.slice(0, 7)}</span>
                <span className="blame-author truncate">{l.author}</span>
                <span className="blame-date">{fullDate(l.date)}</span>
              </> : null}
            </span>
            <span className="ln">{l.line}</span>
            <span className="code" dangerouslySetInnerHTML={{ __html: html[l.line - 1] ?? '' }} />
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// File history

function HistoryView({ repo, ctx, ignoreWs, wrap }: { repo: RepoView; ctx: FileContext; ignoreWs: boolean; wrap: boolean }) {
  const path = repo.path
  const [list, setList] = useState<Array<Commit & { path: string }> | null>(null)
  const [selIdx, setSelIdx] = useState(0)
  const [diff, setDiff] = useState<FileContents | null>(null)
  const settings = useStore((s) => s.settings!)
  useEffect(() => {
    let alive = true
    api.fileHistory(path, ctx.path).then((l) => alive && setList(l)).catch(() => alive && setList([]))
    return () => { alive = false }
  }, [path, ctx.path])
  const cur = list?.[selIdx]
  const prevPath = list?.[selIdx + 1]?.path
  const c = useMemo<FileContext | null>(() => cur ? { kind: 'commit', sha: cur.sha, parent: cur.parents[0], path: cur.path, oldPath: prevPath && prevPath !== cur.path ? prevPath : undefined, status: 'M' } : null, [cur, prevPath])
  useEffect(() => {
    if (!c) return
    let alive = true
    api.fileContents(path, c, ignoreWs).then((d) => alive && setDiff(d)).catch(() => undefined)
    return () => { alive = false }
  }, [path, c, ignoreWs])
  if (!list) return <div className="loading"><div className="spinner" /></div>
  if (!list.length) return <div className="file-view-message">No history for this file.</div>
  return (
    <div className="history-view">
      <div className="history-list">
        {list.map((h, i) => (
          <div key={h.sha} className={`history-row${i === selIdx ? ' selected' : ''}`} onClick={() => setSelIdx(i)}>
            <span className="history-avatar" style={{ backgroundImage: `url(${avatarUrl(h.email, h.author)})` }} />
            <div className="history-text">
              <div className="truncate">{h.summary}</div>
              <div className="history-meta truncate">{h.sha.slice(0, 7)} · {h.author} · {fullDate(h.date)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="history-diff">
        {diff ? <MonacoDiff original={diff.original} modified={diff.modified} file={cur!.path} sideBySide={settings.diffMode === 'split'} ignoreWs={ignoreWs} wrap={wrap} /> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Image diff (side by side, like the reference app)

function ImageDiff({ data }: { data: FileContents }) {
  const [dims, setDims] = useState<{ a?: string; b?: string }>({})
  return (
    <div className="image-diff">
      {(['originalImage', 'modifiedImage'] as const).map((k, i) => {
        const src = data[k]
        return (
          <div key={k} className={`image-pane ${i ? 'image-new' : 'image-old'}`}>
            <div className="image-pane-label">{i ? 'New' : 'Old'}{dims[i ? 'b' : 'a'] ? <span className="text-secondary"> · {dims[i ? 'b' : 'a']}</span> : null}</div>
            <div className="image-pane-body">
              {src ? <img src={src} onLoad={(e) => { const im = e.currentTarget; setDims((d) => ({ ...d, [i ? 'b' : 'a']: `${im.naturalWidth}×${im.naturalHeight}` })) }} /> : <span className="text-secondary">{i ? 'Deleted' : 'Added'}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
