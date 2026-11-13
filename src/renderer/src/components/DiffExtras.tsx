import { useEffect, useMemo, useRef, useState } from 'react'

export const ENCODINGS = ['GUESS ENCODING', 'BINARY', 'UTF-8', 'UTF-8 BOM', 'UTF-16LE', 'UTF-16BE', 'UTF-32LE', 'UTF-32BE',
  ...Array.from({ length: 9 }, (_, i) => `windows-${1250 + i}`), 'Windows 874',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16].map((n) => `ISO-8859-${n}`),
  'Mac Roman', 'CP437', 'CP850', 'CP852', 'CP865', 'CP866', 'KOI8-R', 'KOI8-U', 'KOI8-RU', 'KOI8-T', 'GBK', 'GB18030', 'GB2312', 'Big5', 'Big5-HKSCS', 'Shift_JIS', 'EUC-JP', 'EUC-KR']

/** The "UTF-8" button in the file header: a dropdown listing the encodings, like the original's. */
export function EncodingDropdown({ className = 'fv-encoding' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [enc, setEnc] = useState('UTF-8')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className="encoding-wrap" ref={ref}>
      <button id="encoding-dropdown" className={className} onClick={() => setOpen(!open)}>{enc}</button>
      {open ? (
        <div className="encoding-menu">
          {ENCODINGS.map((e) => <div key={e} className={`encoding-item${e === enc ? ' current' : ''}`} onClick={() => { setEnc(e); setOpen(false) }}>{e}</div>)}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Markdown preview (small, dependency-free renderer; HTML in the source is escaped)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s: string): string {
  const codes: string[] = []
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, a, u) => /^(https?:|data:image)/.test(u) ? `<img alt="${a}" src="${u}">` : `[${a}]`)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, a, u) => /^(https?:|mailto:|#)/.test(u) ? `<a href="${u}" target="_blank" rel="noreferrer">${a}</a>` : a)
  t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)|(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, (_, p1, a, p2, b) => `${p1 ?? p2}<em>${a ?? b}</em>`)
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`)
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  const isBlockStart = (l: string) => /^(#{1,6}\s|>|\s*([-*+]|\d+\.)\s|```|\s*([-*_]\s*){3,}$)/.test(l)
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    const fence = /^```(.*)$/.exec(l)
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(l)
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }
    if (/^\s*([-*_]\s*){3,}$/.test(l)) { out.push('<hr>'); i++; continue }
    if (/^>/.test(l)) {
      const buf: string[] = []
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`)
      continue
    }
    const li = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(l)
    if (li) {
      const ordered = /\d/.test(li[2])
      const items: string[] = []
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i])
        if (!m) break
        const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3])
        items.push(`<li>${task ? `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${inline(task[2])}` : inline(m[3])}</li>`)
        i++
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }
    if (/\|/.test(l) && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')) {
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()))
      const head = cells(l)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]))
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !(buf.length && isBlockStart(lines[i]))) buf.push(lines[i++])
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`)
  }
  return out.join('\n')
}

export function MarkdownPreview({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source])
  return <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
}
