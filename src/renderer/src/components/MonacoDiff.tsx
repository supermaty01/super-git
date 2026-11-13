import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { monaco, createModel, editorOptions } from '../lib/monaco'
import { useStore } from '../store'

export interface MonacoDiffHandle { next(): void; prev(): void }

export const MonacoDiff = forwardRef<MonacoDiffHandle, { original: string; modified: string; file: string; sideBySide: boolean; ignoreWs: boolean; wrap: boolean }>(
  function MonacoDiff({ original, modified, file, sideBySide, ignoreWs, wrap }, ref) {
    const el = useRef<HTMLDivElement>(null)
    const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
    const font = useStore((s) => s.settings!.editorFont)

    useImperativeHandle(ref, () => ({
      next: () => editor.current?.goToDiff('next'),
      prev: () => editor.current?.goToDiff('previous')
    }))

    useEffect(() => {
      const e = monaco.editor.createDiffEditor(el.current!, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: sideBySide,
        useInlineViewWhenSpaceIsLimited: false,
        ignoreTrimWhitespace: ignoreWs,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontFamily: `${font}, Consolas, "Courier New", monospace`,
        ...editorOptions(),
        renderOverviewRuler: true,
        glyphMargin: false,
        folding: false,
        contextmenu: false,
        wordWrap: wrap ? 'on' : 'off',
        diffWordWrap: wrap ? 'on' : 'off',
        renderMarginRevertIcon: false,
        enableSplitViewResizing: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
      })
      editor.current = e
      return () => {
        const m = e.getModel()
        e.dispose()
        m?.original.dispose()
        m?.modified.dispose()
        editor.current = null
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
      editor.current?.updateOptions({ renderSideBySide: sideBySide, ignoreTrimWhitespace: ignoreWs, wordWrap: wrap ? 'on' : 'off', diffWordWrap: wrap ? 'on' : 'off', fontFamily: `${font}, Consolas, "Courier New", monospace` })
    }, [sideBySide, ignoreWs, wrap, font])

    useEffect(() => {
      const e = editor.current
      if (!e) return
      const old = e.getModel()
      const o = createModel(original, file)
      const m = createModel(modified, file)
      e.setModel({ original: o, modified: m })
      old?.original.dispose()
      old?.modified.dispose()
    }, [original, modified, file])

    return <div className="monaco-host" ref={el} />
  }
)

export function MonacoFile({ value, file, readOnly, dirty, wrap, onChange, onSave }: { value: string; file: string; readOnly: boolean; dirty?: boolean; wrap: boolean; onChange?: (v: string) => void; onSave?: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const font = useStore((s) => s.settings!.editorFont)
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    const e = monaco.editor.create(el.current!, {
      model: createModel(value, file), readOnly, automaticLayout: true, minimap: { enabled: true }, scrollBeyondLastLine: false,
      fontFamily: `${font}, Consolas, "Courier New", monospace`, ...editorOptions(), wordWrap: wrap ? 'on' : 'off', contextmenu: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
    })
    e.onDidChangeModelContent(() => changeRef.current?.(e.getValue()))
    e.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current?.())
    editor.current = e
    return () => { e.getModel()?.dispose(); e.dispose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  useEffect(() => { editor.current?.updateOptions({ readOnly, wordWrap: wrap ? 'on' : 'off' }) }, [readOnly, wrap])
  useEffect(() => {
    const e = editor.current
    if (e && e.getValue() !== value && (readOnly || !dirty)) e.setValue(value)
  }, [value, readOnly, dirty])

  return <div className="monaco-host" ref={el} />
}
