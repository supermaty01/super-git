// Monaco editor with syntax colouring only (no language-service workers needed).
import 'monaco-editor/esm/vs/editor/editor.all.js'
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution.js'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { colorBrackets } from './decorate'

;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() }

monaco.editor.defineTheme('supergit-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#090A0B',
    'editor.foreground': '#FFFFFF',
    'editorLineNumber.foreground': '#6b6c6d',
    'editorLineNumber.activeForeground': '#c7c8c8',
    'editorGutter.background': '#090A0B',
    'editor.lineHighlightBackground': '#ffffff08',
    'editor.selectionBackground': '#4d88ff55',
    'diffEditor.insertedLineBackground': '#5cb85c33',
    'diffEditor.removedLineBackground': '#d9413d33',
    'diffEditor.insertedTextBackground': '#5cb85c40',
    'diffEditor.removedTextBackground': '#d9413d45',
    'diffEditor.diagonalFill': '#ffffff14',
    'diffEditorGutter.insertedLineBackground': '#5cb85c33',
    'diffEditorGutter.removedLineBackground': '#d9413d33',
    'editorOverviewRuler.border': '#00000000',
    'scrollbarSlider.background': '#ffffff26',
    'scrollbarSlider.hoverBackground': '#ffffff40',
    'editorIndentGuide.background1': '#ffffff14',
    'editorWhitespace.foreground': '#ffffff30'
  }
})
monaco.editor.defineTheme('supergit-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#FCFCFC',
    'editorGutter.background': '#FCFCFC',
    'diffEditor.insertedLineBackground': '#00a85726',
    'diffEditor.removedLineBackground': '#9f1a1626',
    'diffEditor.insertedTextBackground': '#00a85740',
    'diffEditor.removedTextBackground': '#9f1a1640',
    'editorOverviewRuler.border': '#00000000'
  }
})
monaco.editor.setTheme('supergit-dark')
export function setMonacoTheme(theme: 'dark' | 'light'): void { monaco.editor.setTheme(theme === 'light' ? 'supergit-light' : 'supergit-dark') }

const extMap = new Map<string, string>()
const nameMap = new Map<string, string>()
for (const l of monaco.languages.getLanguages()) {
  for (const e of l.extensions ?? []) if (!extMap.has(e.toLowerCase())) extMap.set(e.toLowerCase(), l.id)
  for (const f of l.filenames ?? []) nameMap.set(f.toLowerCase(), l.id)
}
const EXTRA: Record<string, string> = { '.cshtml': 'razor', '.csproj': 'xml', '.props': 'xml', '.targets': 'xml', '.config': 'xml', '.resx': 'xml', '.tsx': 'typescript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.vue': 'html', '.svelte': 'html', '.gradle': 'java', '.kts': 'kotlin' }

// ---------------------------------------------------------------------------------------------
// Editor preferences (font size, tab size, line numbers, syntax highlighting, end of line)

export const editorPrefs = { fontSize: 12, tabSize: 4, lineNumbers: true, syntax: true, eol: 'auto' as 'auto' | 'lf' | 'crlf' }

/** options shared by every editor; lineNumbers can be forced on (merge tool uses the gutter) */
export function editorOptions(forceLineNumbers = false): monaco.editor.IEditorOptions {
  return {
    fontSize: editorPrefs.fontSize,
    lineHeight: Math.round(editorPrefs.fontSize * 1.5),
    lineNumbers: editorPrefs.lineNumbers || forceLineNumbers ? 'on' : 'off',
    // like the original: brackets coloured by nesting depth
    bracketPairColorization: { enabled: true }
  }
}

export function setEditorPrefs(p: Partial<typeof editorPrefs>): void {
  const before = editorPrefs.syntax
  Object.assign(editorPrefs, p)
  for (const e of monaco.editor.getEditors()) {
    const forced = !!e.getContainerDomNode().closest('.merge-tool')
    e.updateOptions(editorOptions(forced))
  }
  for (const m of monaco.editor.getModels()) {
    m.updateOptions({ tabSize: editorPrefs.tabSize })
    if (before !== editorPrefs.syntax) {
      monaco.editor.setModelLanguage(m, editorPrefs.syntax ? (m as unknown as { __lang?: string }).__lang ?? m.getLanguageId() : 'plaintext')
    }
  }
}

/** creates a model honouring the tab size / syntax / end-of-line preferences */
export function createModel(text: string, file: string): monaco.editor.ITextModel {
  const lang = languageFor(file, true)
  const m = monaco.editor.createModel(text, editorPrefs.syntax ? lang : 'plaintext')
  ;(m as unknown as { __lang?: string }).__lang = lang
  m.updateOptions({ tabSize: editorPrefs.tabSize })
  if (editorPrefs.eol !== 'auto') m.setEOL(editorPrefs.eol === 'lf' ? monaco.editor.EndOfLineSequence.LF : monaco.editor.EndOfLineSequence.CRLF)
  return m
}

export function languageFor(file: string, ignoreSyntaxPref = false): string {
  if (!ignoreSyntaxPref && !editorPrefs.syntax) return 'plaintext'
  const base = file.split('/').pop()!.toLowerCase()
  if (nameMap.has(base)) return nameMap.get(base)!
  const dot = base.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  const ext = base.slice(dot)
  return EXTRA[ext] ?? extMap.get(ext) ?? 'plaintext'
}

/** Returns syntax-highlighted HTML for each line of `text`. */
export async function colorizeLines(text: string, lang: string): Promise<string[]> {
  if (text.length > 400_000 || lang === 'plaintext') return text.split('\n').map(escapeHtml)
  const html = await monaco.editor.colorize(text, lang, { tabSize: editorPrefs.tabSize })
  return html.split('<br/>')
}

// token classes of comments and strings in the current theme (brackets inside them are not coloured)
let skipClasses: Promise<Set<string>> | null = null
function tokenSkipClasses(): Promise<Set<string>> {
  skipClasses ??= Promise.all([
    monaco.editor.colorize('// c', 'javascript', {}),
    monaco.editor.colorize('"s"', 'javascript', {})
  ]).then((html) => new Set(html.map((h) => /class="(mtk\d+)"/.exec(h)?.[1]).filter((x): x is string => !!x)))
  return skipClasses
}

/** Syntax-coloured lines with brackets coloured by depth, as the editor shows them. */
export async function colorizeRich(text: string, lang: string): Promise<string[]> {
  const lines = await colorizeLines(text, lang)
  if (lang === 'plaintext' || text.length > 400_000) return lines
  return colorBrackets(lines, await tokenSkipClasses())
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export { monaco }
