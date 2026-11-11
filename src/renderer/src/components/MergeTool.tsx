import { useEffect, useMemo, useRef, useState } from 'react'
import { diff3Merge } from 'node-diff3'
import type { RepoView } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import * as A2 from '../actions2'
import { monaco, createModel, editorOptions } from '../lib/monaco'
import { errMsg } from '../lib/format'
import { useStore } from '../store'
import { Icon } from './Icon'
import type { ConflictSides } from '@shared/types'

type Region =
  | { kind: 'ok'; lines: string[] }
  | { kind: 'conflict'; id: number; a: string[]; aIndex: number; o: string[]; b: string[]; bIndex: number }

interface Pick { a: number[]; b: number[]; order: Array<'a' | 'b'> }

function splitLines(text: string): { lines: string[]; eol: string; finalNewline: boolean } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const norm = text.replace(/\r\n/g, '\n')
  const finalNewline = norm.endsWith('\n')
  const lines = norm.split('\n')
  if (finalNewline) lines.pop()
  return { lines, eol, finalNewline }
}

export function computeRegions(sides: ConflictSides): { regions: Region[]; eol: string; finalNewline: boolean; ours: string[]; theirs: string[] } {
  const o = splitLines(sides.ours)
  const b = splitLines(sides.base)
  const t = splitLines(sides.theirs)
  const res = diff3Merge(o.lines, b.lines, t.lines, { excludeFalseConflicts: true })
  let id = 0
  const regions: Region[] = res.map((r) => r.ok
    ? { kind: 'ok' as const, lines: r.ok }
    : { kind: 'conflict' as const, id: id++, a: r.conflict!.a, aIndex: r.conflict!.aIndex, o: r.conflict!.o, b: r.conflict!.b, bIndex: r.conflict!.bIndex })
  return { regions, eol: o.eol, finalNewline: o.finalNewline || t.finalNewline, ours: o.lines, theirs: t.lines }
}

interface OutputInfo { text: string; marks: Array<{ start: number; end: number; kind: 'a' | 'b' | 'out' }>; conflictStarts: number[] }

function buildOutput(regions: Region[], picks: Record<number, Pick>): OutputInfo {
  const out: string[] = []
  const marks: OutputInfo['marks'] = []
  const conflictStarts: number[] = []
  for (const r of regions) {
    if (r.kind === 'ok') { out.push(...r.lines); continue }
    conflictStarts.push(out.length + 1)
    const p = picks[r.id]
    if (!p || (!p.a.length && !p.b.length)) {
      const start = out.length + 1
      out.push(...(r.o.length ? r.o : ['']))
      marks.push({ start, end: out.length, kind: 'out' })
      continue
    }
    for (const side of p.order) {
      const idxs = [...(side === 'a' ? p.a : p.b)].sort((x, y) => x - y)
      if (!idxs.length) continue
      const start = out.length + 1
      out.push(...idxs.map((i) => (side === 'a' ? r.a : r.b)[i]))
      marks.push({ start, end: out.length, kind: side })
    }
  }
  return { text: out.join('\n'), marks, conflictStarts }
}

export function MergeTool({ repo, file }: { repo: RepoView; file: string }) {
  const path = repo.path
  const [sides, setSides] = useState<ConflictSides | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<number, Pick>>({})
  const [current, setCurrent] = useState(0)
  const [dirty, setDirty] = useState(false)
  const font = useStore((s) => s.settings!.editorFont)
  const aEl = useRef<HTMLDivElement>(null)
  const bEl = useRef<HTMLDivElement>(null)
  const oEl = useRef<HTMLDivElement>(null)
  const eds = useRef<{ a?: monaco.editor.IStandaloneCodeEditor; b?: monaco.editor.IStandaloneCodeEditor; o?: monaco.editor.IStandaloneCodeEditor; decA?: monaco.editor.IEditorDecorationsCollection; decB?: monaco.editor.IEditorDecorationsCollection; decO?: monaco.editor.IEditorDecorationsCollection }>({})
  const picksRef = useRef(picks)
  picksRef.current = picks

  useEffect(() => {
    let alive = true
    setSides(null); setPicks({}); setCurrent(0); setDirty(false)
    api.conflictSides(path, file).then((s) => alive && setSides(s)).catch((e) => alive && setErr(errMsg(e)))
    return () => { alive = false }
  }, [path, file])

  const model = useMemo(() => (sides ? computeRegions(sides) : null), [sides])
  const conflicts = useMemo(() => (model?.regions.filter((r) => r.kind === 'conflict') ?? []) as Extract<Region, { kind: 'conflict' }>[], [model])
  const output = useMemo(() => (model ? buildOutput(model.regions, picks) : null), [model, picks])

  // lines (0-based in ours/theirs) that belong to a conflict, mapped to [conflictId, relativeIndex]
  const lineMap = useMemo(() => {
    const a = new Map<number, [number, number]>()
    const b = new Map<number, [number, number]>()
    for (const c of conflicts) {
      c.a.forEach((_, i) => a.set(c.aIndex + i, [c.id, i]))
      c.b.forEach((_, i) => b.set(c.bIndex + i, [c.id, i]))
    }
    return { a, b }
  }, [conflicts])
  const lineMapRef = useRef(lineMap)
  lineMapRef.current = lineMap

  const toggle = (side: 'a' | 'b', conflictId: number, rel: number | 'all', force?: boolean) => {
    setPicks((prev) => {
      const c = conflicts.find((x) => x.id === conflictId)!
      const p: Pick = prev[conflictId] ? { a: [...prev[conflictId].a], b: [...prev[conflictId].b], order: [...prev[conflictId].order] } : { a: [], b: [], order: [] }
      const all = (side === 'a' ? c.a : c.b).map((_, i) => i)
      let list = p[side]
      if (rel === 'all') list = (force ?? list.length !== all.length) ? all : []
      else list = list.includes(rel) ? list.filter((x) => x !== rel) : [...list, rel]
      p[side] = list
      if (list.length && !p.order.includes(side)) p.order.push(side)
      if (!list.length) p.order = p.order.filter((s) => s !== side)
      return { ...prev, [conflictId]: p }
    })
    setDirty(false)
  }
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle

  // create editors once sides are loaded
  useEffect(() => {
    if (!sides || !model) return
    const common: monaco.editor.IStandaloneEditorConstructionOptions = {
      automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontFamily: `${font}, Consolas, monospace`, ...editorOptions(true),
      glyphMargin: true, folding: false, lineDecorationsWidth: 6, contextmenu: false, scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
    }
    const a = monaco.editor.create(aEl.current!, { ...common, readOnly: true, model: createModel(model.ours.join('\n'), file) })
    const b = monaco.editor.create(bEl.current!, { ...common, readOnly: true, model: createModel(model.theirs.join('\n'), file) })
    const o = monaco.editor.create(oEl.current!, { ...common, readOnly: false, model: createModel('', file) })
    const onGlyph = (side: 'a' | 'b') => (e: monaco.editor.IEditorMouseEvent) => {
      const t = e.target.type
      if (t !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && t !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return
      const ln = e.target.position?.lineNumber
      if (!ln) return
      const hit = lineMapRef.current[side].get(ln - 1)
      if (hit) toggleRef.current(side, hit[0], hit[1])
    }
    a.onMouseDown(onGlyph('a'))
    b.onMouseDown(onGlyph('b'))
    o.onDidChangeModelContent((ev) => { if (!ev.isFlush) setDirty(true) })
    // keep A/B scrolled together
    a.onDidScrollChange((e) => { if (e.scrollTopChanged) b.setScrollTop(e.scrollTop) })
    b.onDidScrollChange((e) => { if (e.scrollTopChanged) a.setScrollTop(e.scrollTop) })
    eds.current = { a, b, o, decA: a.createDecorationsCollection(), decB: b.createDecorationsCollection(), decO: o.createDecorationsCollection() }
    return () => {
      for (const ed of [a, b, o]) { ed.getModel()?.dispose(); ed.dispose() }
      eds.current = {}
    }
  }, [sides, model, file, font])

  // decorations for A / B
  useEffect(() => {
    const { decA, decB } = eds.current
    if (!decA || !decB) return
    const mk = (side: 'a' | 'b') => {
      const decs: monaco.editor.IModelDeltaDecoration[] = []
      for (const c of conflicts) {
        const lines = side === 'a' ? c.a : c.b
        const start = side === 'a' ? c.aIndex : c.bIndex
        const chosen = picks[c.id]?.[side] ?? []
        lines.forEach((_, i) => {
          decs.push({
            range: new monaco.Range(start + i + 1, 1, start + i + 1, 1),
            options: {
              isWholeLine: true,
              className: side === 'a' ? 'mt-line-a' : 'mt-line-b',
              linesDecorationsClassName: side === 'a' ? 'mt-bar-a' : 'mt-bar-b',
              glyphMarginClassName: `mt-check${chosen.includes(i) ? ' checked' : ''}`
            }
          })
        })
      }
      return decs
    }
    decA.set(mk('a'))
    decB.set(mk('b'))
  }, [conflicts, picks, sides])

  // regenerate output whenever picks change
  useEffect(() => {
    const { o, decO } = eds.current
    if (!o || !decO || !output) return
    o.setValue(output.text)
    decO.set(output.marks.map((m) => ({
      range: new monaco.Range(m.start, 1, m.end, 1),
      options: {
        isWholeLine: true,
        className: m.kind === 'a' ? 'mt-line-a' : m.kind === 'b' ? 'mt-line-b' : 'mt-line-out',
        linesDecorationsClassName: m.kind === 'a' ? 'mt-bar-a' : m.kind === 'b' ? 'mt-bar-b' : 'mt-bar-out',
        glyphMarginClassName: m.kind === 'a' ? 'mt-glyph-a' : m.kind === 'b' ? 'mt-glyph-b' : undefined
      }
    })))
  }, [output])

  const gotoConflict = (i: number) => {
    if (!conflicts.length || !output) return
    const idx = (i + conflicts.length) % conflicts.length
    setCurrent(idx)
    const c = conflicts[idx]
    eds.current.a?.revealLineInCenter(c.aIndex + 1)
    eds.current.b?.revealLineInCenter(c.bIndex + 1)
    eds.current.o?.revealLineInCenter(output.conflictStarts[idx] ?? 1)
  }
  useEffect(() => { if (conflicts.length) setTimeout(() => gotoConflict(0), 50) }, [conflicts.length, sides]) // eslint-disable-line react-hooks/exhaustive-deps

  const allSide = (side: 'a' | 'b') => conflicts.length > 0 && conflicts.every((c) => (picks[c.id]?.[side].length ?? 0) === (side === 'a' ? c.a : c.b).length)
  const toggleAll = (side: 'a' | 'b') => {
    const on = !allSide(side)
    for (const c of conflicts) toggle(side, c.id, 'all', on)
  }
  const unresolved = conflicts.filter((c) => !picks[c.id] || (!picks[c.id].a.length && !picks[c.id].b.length)).length

  const save = async () => {
    const o = eds.current.o
    if (!o || !model) return
    if (unresolved && !dirty) {
      const r = await api.confirm({ title: 'Unresolved conflicts', message: `${unresolved} conflict(s) have no selection.`, detail: 'The output will contain the original (base) text for those sections. Save anyway?', buttons: ['Save', 'Cancel'], type: 'warning' })
      if (r !== 0) return
    }
    let text = o.getValue().replace(/\r\n/g, '\n')
    if (model.finalNewline && !text.endsWith('\n')) text += '\n'
    if (model.eol === '\r\n') text = text.replace(/\n/g, '\r\n')
    const ok = await A.run(path, async () => { await api.resolveConflict(path, file, text); return true }, { errorTitle: 'Could not save the resolution' })
    if (ok) A.closeCenter(path)
  }

  if (err) return <div className="file-view-message">{err}</div>
  const st = repo.snapshot!.status.state
  return (
    <div className="merge-tool">
      <div className="mt-topbar">
        <Icon name="warning" className="color-orange" />
        <span className="mt-file">{file}</span>
        <span className="text-secondary">({conflicts.length} conflict{conflicts.length === 1 ? '' : 's'})</span>
        <span className="grow" />
        <button className="btn btn-primary-outline btn-small" onClick={() => A2.externalMergeTool(path, file)}>Open in external merge tool <Icon name="external" /></button>
        <button className="btn btn-success btn-small" onClick={save}>Save <Icon name="save" /></button>
        <span className="file-view-close" title="Close" onClick={() => A.closeCenter(path)}><Icon name="times" /></span>
      </div>
      <div className="mt-top">
        <div className="mt-pane">
          <div className="mt-pane-header">
            <input type="checkbox" checked={allSide('a')} onChange={() => toggleAll('a')} />
            <span className="mt-badge mt-badge-a">A</span>
            <span>Commit {sides?.oursSha.slice(0, 6)} on <i className="mt-branch-a">{sides?.oursLabel}</i>{st.kind === 'rebase' ? <span className="text-secondary"> (upstream)</span> : null}</span>
          </div>
          <div className="mt-editor" ref={aEl} />
        </div>
        <div className="mt-pane">
          <div className="mt-pane-header">
            <input type="checkbox" checked={allSide('b')} onChange={() => toggleAll('b')} />
            <span className="mt-badge mt-badge-b">B</span>
            <span>Commit {sides?.theirsSha.slice(0, 6)} on <i className="mt-branch-b">{sides?.theirsLabel}</i></span>
          </div>
          <div className="mt-editor" ref={bEl} />
        </div>
      </div>
      <div className="mt-bottom">
        <div className="mt-output-header">
          <span className="mt-output-title">Output</span>
          <span className="grow" />
          <span className="mt-nav">
            {conflicts.length ? <>conflict {current + 1} of {conflicts.length}</> : 'no conflicts'}
            <button className="btn btn-xs btn-nav" onClick={() => gotoConflict(current - 1)}><Icon name="chevron-up" /></button>
            <button className="btn btn-xs btn-nav" onClick={() => gotoConflict(current + 1)}><Icon name="chevron-down" /></button>
          </span>
          <span className="grow" />
          {Object.keys(picks).length || dirty ? <button className="btn btn-default btn-xs" onClick={() => { setPicks({}); setDirty(false); if (eds.current.o && output) eds.current.o.setValue(buildOutput(model!.regions, {}).text) }}>Reset</button> : <span style={{ width: 40 }} />}
        </div>
        <div className="mt-editor" ref={oEl} />
      </div>
    </div>
  )
}
