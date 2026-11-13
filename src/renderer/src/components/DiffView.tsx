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
import { laneColor } from '../graph/colors'
import { MonacoDiff, MonacoFile, type MonacoDiffHandle } from './MonacoDiff'
import { EncodingDropdown, MarkdownPreview } from './DiffExtras'
import type { MI } from '../actions'
import type { FileContext, FileContents, DiffHunk, BlameLine, Commit } from '@shared/types'

type View = 'diff' | 'file' | 'blame' | 'history'

export function DiffView({ repo, ctx, startEditing, startView, historyMode }: { repo: RepoView; ctx: FileContext; startEditing?: boolean; startView?: View; /** inside the File History screen: no header, edit or history buttons; Blame toggles in File View */ historyMode?: boolean }) {
  const path = repo.path
  const settings = useStore((s) => s.settings!)
  const mode = settings.diffMode
  const [view, setView] = useState<View>('diff')
  const [ignoreWs, setIgnoreWs] = useState(settings.showWhitespace)
  const [wrap, setWrap] = useState(settings.wordWrap)
  const [data, setData] = useState<FileContents | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const baseRef = useRef<string | null>(null)
  const diffRef = useRef<MonacoDiffHandle>(null)
  const hunkRef = useRef<HunkViewHandle>(null)

  const key = `${ctx.kind}:${'sha' in ctx ? ctx.sha : ctx.kind === 'compare' ? `${ctx.a}..${ctx.b}` : ''}:${ctx.path}`
  useEffect(() => {
    if (startView === 'history') { openFileHistory(path, ctx); return }
    setView(startView ?? (ctx.status === 'N' || startEditing ? 'file' : 'diff')); setDraft(null); setPreview(false)
  }, [key, startEditing, startView]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const isSub = !!data?.submodule
  const added = ctx.status === 'A' || ctx.status === '?'
  // diff modes make no sense for images, binaries and submodules; blame / history / edit not for submodules
  const noModes = isImage || isSub || !!data?.binary
  const showBlame = !added && ctx.status !== 'D' && !isSub
  const showHistory = !isSub && !added
  const isMd = /\.(md|markdown)$/i.test(ctx.path)
  const editing = canEdit && view === 'file' && !historyMode
  const dirty = draft !== null
  // the file changed on disk while the buffer has unsaved edits
  const staleOnDisk = dirty && baseRef.current !== null && data !== null && data.modified !== baseRef.current
  useEffect(() => {
    if (!dirty) return
    document.body.classList.add('sg-dirty')
    return () => document.body.classList.remove('sg-dirty')
  }, [dirty])
  const fileSelf = { path: ctx.path, oldPath: 'oldPath' in ctx ? ctx.oldPath : undefined, status: ctx.status }

  const save = async () => {
    if (draft === null) return
    await A.run(path, () => api.writeFile(path, ctx.path, draft), { errorTitle: 'Save failed' })
    baseRef.current = null
    setDraft(null)
  }

  return (
    <div className={`file-view${historyMode ? ' in-history' : ''}`}>
      {historyMode ? null : <div className="file-view-header">
        <StatusIcon status={ctx.status} />
        <span className="file-view-title" title={ctx.path} onContextMenu={(e) => { e.preventDefault(); void A.popup([
          { label: 'Open in external diff tool', act: () => api.externalDiffTool(path, ctx.path, ctx.kind === 'staged', ctx.kind === 'commit' || ctx.kind === 'stash' ? ctx.parent : ctx.kind === 'compare' ? ctx.a : undefined, ctx.kind === 'commit' || ctx.kind === 'stash' ? ctx.sha : ctx.kind === 'compare' ? ctx.b ?? undefined : undefined) },
          { label: 'Open in external editor', act: () => A2.openInEditor(path, ctx.path), enabled: ctx.status !== 'D' }
        ]) }}>
          {'oldPath' in ctx && ctx.oldPath ? <span className="fv-dir">{ctx.oldPath} ⇒ </span> : null}
          {ctx.path.includes('/') ? <span className="fv-dir">{ctx.path.slice(0, ctx.path.lastIndexOf('/') + 1)}</span> : null}
          <span className="fv-name">{ctx.path.slice(ctx.path.lastIndexOf('/') + 1)}</span>
        </span>
        <span className="grow" />
        <EncodingDropdown />
        {ctx.kind === 'unstaged' ? <button className="btn btn-success btn-xs" onClick={() => A.stageFiles(path, [fileSelf])}>Stage File</button> : null}
        {ctx.kind === 'staged' ? <button className="btn btn-danger btn-xs" onClick={() => A.unstageFiles(path, [fileSelf])}>Unstage File</button> : null}
        {dirty
          ? <span className="file-view-close file-view-dirty" title="Unsaved changes (Ctrl+S to save)" onClick={() => A.closeCenter(path)}><span className="dirty-dot" /><Icon name="times" /></span>
          : <span className="file-view-close" title="Close" onClick={() => A.closeCenter(path)}><Icon name="times" /></span>}
      </div>}
      <div className="file-view-toolbar">
        <div className="fv-left">
          {historyMode ? null : canEdit ? (
            editing
              ? <span className="fv-editable"><Icon name="pen" /> editable</span>
              : data && !isImage && !data.binary ? <button className="btn btn-primary-outline btn-small" onClick={() => setView('file')}><Icon name="pen" /> Edit This File</button> : null
          ) : ctx.status !== 'D' && ctx.kind !== 'compare' && !isSub && !isImage && !(ctx.kind === 'commit' && added) && repo.snapshot ? (
            <button className="btn btn-primary-outline btn-small"
              onClick={() => updateRepo(path, { center: { kind: 'file', ctx: { kind: 'unstaged', path: ctx.path, status: 'M' }, edit: true } })}>
              <Icon name="pen" /> Edit in Working Directory
            </button>
          ) : null}
        </div>
        <div className="fv-center">
          {ctx.kind === 'compare' || ctx.kind === 'staged' || ctx.kind === 'unstaged' ? <span className="fv-badge">{badge}</span> : null}
          <div className="btn-group toggle-group">
            <button className={`toggle-btn${view === 'file' || (historyMode && view === 'blame') ? ' checked' : ''}`} onClick={() => setView('file')} disabled={!data || data.binary || isSub}>File View</button>
            <button className={`toggle-btn${view === 'diff' ? ' checked' : ''}`} onClick={() => { setView('diff'); setPreview(false) }}>Diff View</button>
          </div>
          {isMd && view === 'file' && !historyMode ? (
            <div className="btn-group toggle-group">
              <button className={`toggle-btn${!preview ? ' checked' : ''}`} onClick={() => setPreview(false)}>Code</button>
              <button className={`toggle-btn${preview ? ' checked' : ''}`} onClick={() => setPreview(true)}>Preview</button>
            </div>
          ) : null}
        </div>
        <div className="fv-right">
          {historyMode && (view === 'file' || view === 'blame') ? (
            <>
              <div className="btn-group toggle-group">
                <button className={`toggle-btn icon-only${wrap ? ' checked' : ''}`} title="Word Wrap" onClick={() => { setWrap(!wrap); void api.setSettings({ wordWrap: !wrap }) }}><Icon name="align-left" /></button>
              </div>
              {showBlame ? <div className="btn-group toggle-group"><button className={`toggle-btn${view === 'blame' ? ' checked' : ''}`} onClick={() => setView(view === 'blame' ? 'file' : 'blame')}>Blame</button></div> : null}
            </>
          ) : null}
          {!historyMode && (showBlame || showHistory) ? (
            <div className="btn-group toggle-group">
              {showBlame ? <button className="toggle-btn" onClick={() => openFileHistory(path, ctx, true)}>Blame</button> : null}
              {showHistory ? <button className="toggle-btn" onClick={() => openFileHistory(path, ctx)}>History</button> : null}
            </div>
          ) : null}
          {view !== 'file' && !(historyMode && view === 'blame') ? <>
            <div className="btn-group toggle-group">
              <button className="toggle-btn" title="Previous Change" disabled={noModes} onClick={() => (mode === 'hunk' ? hunkRef.current?.prev() : diffRef.current?.prev())}><Icon name="arrow-up" /></button>
              <button className="toggle-btn" title="Next Change" disabled={noModes} onClick={() => (mode === 'hunk' ? hunkRef.current?.next() : diffRef.current?.next())}><Icon name="arrow-down" /></button>
            </div>
            <div className="btn-group toggle-group">
              <button className={`toggle-btn icon-only${mode === 'hunk' && view === 'diff' ? ' checked' : ''}`} title="Hunk View" disabled={noModes} onClick={() => setMode('hunk')}><Icon name="view-hunk" /></button>
              <button className={`toggle-btn icon-only${mode === 'inline' && view === 'diff' ? ' checked' : ''}`} title="Inline View" disabled={noModes} onClick={() => setMode('inline')}><Icon name="view-inline" /></button>
              <button className={`toggle-btn icon-only${mode === 'split' && view === 'diff' ? ' checked' : ''}`} title="Split View" disabled={noModes} onClick={() => setMode('split')}><Icon name="view-split" /></button>
            </div>
          </> : null}
          {historyMode && (view === 'file' || view === 'blame') ? null : <div className="btn-group toggle-group">
            {view !== 'file' ? <button className={`toggle-btn icon-only${ignoreWs ? ' checked' : ''}`} title="Ignore Leading/Trailing Whitespace" disabled={noModes} onClick={() => { setIgnoreWs(!ignoreWs); void api.setSettings({ showWhitespace: !ignoreWs }) }}><Icon name="paragraph" /></button> : null}
            <button className={`toggle-btn icon-only${wrap ? ' checked' : ''}`} title="Word Wrap" onClick={() => { setWrap(!wrap); void api.setSettings({ wordWrap: !wrap }) }}><Icon name="align-left" /></button>
          </div>}
        </div>
      </div>
      <div className="file-view-body">
        {staleOnDisk ? (
          <div className="file-view-banner">
            <span>The file has been modified outside of SuperGit. Do you want to discard your changes, or overwrite the file?</span>
            <button className="btn btn-success btn-small" onClick={save}>Save and overwrite</button>
            <button className="btn btn-default btn-small" onClick={() => { baseRef.current = null; setDraft(null) }}>Discard these changes</button>
          </div>
        ) : null}
        {error ? <div className="file-view-message">{error}</div>
          : !data ? <div className="loading"><div className="spinner" /></div>
            : isSub ? <SubmoduleDiff data={data} />
            : isImage && view !== 'history' ? <ImageDiff data={data} />
            : data.binary && view !== 'history' ? <div className="file-view-message">Binary file — no text diff available.</div>
              : view === 'file' && preview && isMd ? <MarkdownPreview source={draft ?? data.modified} />
              : view === 'file' ? (
                <MonacoFile value={draft ?? data.modified} file={ctx.path} readOnly={!editing} dirty={dirty} wrap={wrap}
                  onChange={(v) => { if (!editing) return; if (v === data.modified) { baseRef.current = null; setDraft(null) } else { if (baseRef.current === null) baseRef.current = data.modified; setDraft(v) } }} onSave={save} />
              ) : view === 'blame' ? <BlameView repo={repo} ctx={ctx} />
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
    for (let i = 0; i < h.lines.length;) {
      if (h.lines[i].type !== 'del') { i++; continue }
      const dels: number[] = []
      while (i < h.lines.length && h.lines[i].type === 'del') dels.push(i++)
      const adds: number[] = []
      while (i < h.lines.length && h.lines[i].type === 'add') adds.push(i++)
      for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
        const a = h.lines[dels[k]].content, b = h.lines[adds[k]].content
        const d = wordDiff(a, b)
        marks.set(dels[k], d.removed)
        marks.set(adds[k], d.added)
      }
    }
    return marks
  }), [diffSig]) // eslint-disable-line react-hooks/exhaustive-deps

  const goto = (d: number) => {
    const els = scroller.current?.querySelectorAll<HTMLElement>('.hunk')
    if (!els?.length) return
    current.current = Math.max(0, Math.min(els.length - 1, current.current + d))
    els[current.current].scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  useImperativeHandle(ref, () => ({ next: () => goto(1), prev: () => goto(-1) }))

  const editable = ctx.kind === 'unstaged' || ctx.kind === 'staged'
  // like the original: lines are staged by selecting text and using the context menu
  const lineMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const selection = window.getSelection()
    const picked = new Map<number, number[]>()
    if (selection && !selection.isCollapsed) {
      scroller.current?.querySelectorAll<HTMLElement>('.hunk-line[data-h]').forEach((el) => {
        if (!selection.containsNode(el, true) || el.classList.contains('context')) return
        const h = Number(el.dataset.h), i = Number(el.dataset.i)
        picked.set(h, [...(picked.get(h) ?? []), i])
      })
    }
    const first = [...picked.entries()][0]
    const can = editable && !!first
    const items: MI[] = []
    if (ctx.kind === 'unstaged') items.push({ label: 'Discard Selection', enabled: can, act: () => A.applyHunk(path, ctx, first![0], first![1], 'discard') }, { label: 'Stage selected lines', enabled: can, act: () => A.applyHunk(path, ctx, first![0], first![1], 'stage') })
    else if (ctx.kind === 'staged') items.push({ label: 'Unstage selected lines', enabled: can, act: () => A.applyHunk(path, ctx, first![0], first![1], 'unstage') })
    if (items.length) items.push('-')
    items.push({ label: 'Copy', enabled: !!selection && !selection.isCollapsed, act: () => { void navigator.clipboard.writeText(selection?.toString() ?? '') } })
    void A.popup(items)
  }

  if (!hunks.length) return <div className="file-view-message left">File contents are unchanged.</div>
  return (
    <div className="hunk-view" ref={scroller} onContextMenu={lineMenu}>
      {hunks.map((h: DiffHunk, hi) => {
        return (
          <div className="hunk" key={hi}>
            <div className="hunk-header">
              <span className="hunk-range">{h.header.replace(/^(@@[^@]*@@).*/, '$1')}</span>
              <span className="grow" />
              {ctx.kind === 'commit' ? <button className="btn btn-default btn-xs" title="Undo this change in the working directory" onClick={() => A.applyHunk(path, ctx, hi, null, 'revert')}>Revert Hunk</button> : null}
              {ctx.kind === 'unstaged' && ctx.status === '?' ? null : ctx.kind === 'unstaged' ? (
                <>
                  <button className="btn btn-danger btn-xs" onClick={() => A.applyHunk(path, ctx, hi, null, 'discard')}>Discard Hunk</button>
                  <button className="btn btn-success btn-xs" onClick={() => A.applyHunk(path, ctx, hi, null, 'stage')}>Stage Hunk</button>
                </>
              ) : ctx.kind === 'staged' ? (
                <button className="btn btn-danger btn-xs" onClick={() => A.applyHunk(path, ctx, hi, null, 'unstage')}>Unstage Hunk</button>
              ) : null}
            </div>
            <div className="hunk-lines">
              {h.lines.map((l, li) => {
                if (l.type === 'nonewline') return <div key={li} className="hunk-line nonewline"><span className="ln" /><span className="ln" /><span className="mark" /><span className="code">{l.content}</span></div>
                const base = l.type === 'del' ? oldHtml[(l.oldLine ?? 1) - 1] : newHtml[(l.newLine ?? 1) - 1]
                const marks = words[hi]?.get(li)
                const html = base && marks?.length ? markRanges(base, marks, l.type === 'add' ? 'wd-add' : 'wd-del') : base
                return (
                  <div key={li} data-h={hi} data-i={li} className={`hunk-line ${l.type}`}>
                    <span className="ln">{l.oldLine ?? ''}</span>
                    <span className="ln">{l.newLine ?? ''}</span>
                    <span className="mark">{l.type === 'add' ? '+' : l.type === 'del' ? '—' : ''}</span>
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
  const order = new Map<string, number>()
  for (const l of lines) if (!order.has(l.sha)) order.set(l.sha, order.size)
  return (
    <div className="blame-view">
      {lines.map((l, i) => {
        const first = i === 0 || lines[i - 1].sha !== l.sha
        const uncommitted = /^0+$/.test(l.sha)
        return (
          <div key={i} className={`blame-line${first ? ' first' : ''}`} style={{ ['--blame-color' as string]: laneColor(order.get(l.sha) ?? 0) }}>
            <span className="blame-bar" />
            <span className="blame-meta" onClick={() => { if (!uncommitted) { A.selectCommit(path, l.sha); updateRepo(path, { focus: { sha: l.sha, t: Date.now() }, center: { kind: 'graph' } }) } }}>
              {first ? <>
                <span className="blame-avatar" style={{ backgroundImage: `url(${avatarUrl('', l.author)})` }} />
                <span className="blame-summary truncate" title={`${l.sha.slice(0, 7)} · ${l.author}`}>{uncommitted ? 'Uncommitted changes' : l.summary}</span>
                <span className="blame-date">{fullDate(l.date).split(" @ ")[0]}</span>
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
// File history opens its own screen (like the original)

/** the commit a file context belongs to, for File History / File Blame */
export function historyStart(ctx: FileContext): string | undefined {
  return ctx.kind === 'commit' || ctx.kind === 'stash' ? ctx.sha : ctx.kind === 'compare' ? ctx.b ?? undefined : undefined
}
export function openFileHistory(path: string, ctx: FileContext, blame = false): void {
  updateRepo(path, { center: { kind: 'history', file: ctx.path, sha: historyStart(ctx), blame } })
}

// ---------------------------------------------------------------------------------------------
// Submodule change: the commits the submodule pointed to, like the original

function SubmoduleDiff({ data }: { data: FileContents }) {
  const box = (kind: 'old' | 'new', v?: { sha: string; message: string }) => v ? (
    <div className={`submodule-box ${kind}`}>
      <table className="submodule-table"><tbody>
        <tr><th>Commit</th><td className="submodule-sha">{v.sha}</td></tr>
        <tr><th>Commit Message</th><td>{v.message || <span className="text-secondary">(not available locally)</span>}</td></tr>
      </tbody></table>
    </div>
  ) : null
  return <div className="submodule-diff">{box('old', data.submodule?.old)}{box('new', data.submodule?.new)}</div>
}

// ---------------------------------------------------------------------------------------------
// Image diff (side by side, like the reference app)

function ImageDiff({ data }: { data: FileContents }) {
  const [dims, setDims] = useState<{ a?: string; b?: string }>({})
  return (
    <div className="image-diff">
      {(['originalImage', 'modifiedImage'] as const).filter((k) => data[k]).map((k) => {
        const i = k === 'modifiedImage' ? 1 : 0
        const src = data[k]
        return (
          <div key={k} className={`image-pane ${i ? 'image-new' : 'image-old'}`}>
            <div className="image-pane-label">{i ? 'New image' : 'Old image'}{dims[i ? 'b' : 'a'] ? <span className="text-secondary"> · {dims[i ? 'b' : 'a']}</span> : null}</div>
            <div className="image-pane-body">
              {src ? <img src={src} onLoad={(e) => { const im = e.currentTarget; setDims((d) => ({ ...d, [i ? 'b' : 'a']: `${im.naturalWidth}×${im.naturalHeight}` })) }} /> : <span className="text-secondary">{i ? 'Deleted' : 'Added'}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
