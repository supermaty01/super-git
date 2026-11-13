import { useEffect, useRef, useState } from 'react'
import { useStore, closePrompt, type PromptSpec } from '../store'

/** Replaces the toolbar while a prompt is pending (same placement and styling as the original). */
export function ToolbarPrompt() {
  const prompt = useStore((s) => s.prompt)
  if (!prompt) return null
  return <PromptBar key={JSON.stringify([prompt.kind, prompt.message])} p={prompt} />
}

function PromptBar({ p }: { p: PromptSpec }) {
  const [value, setValue] = useState(p.kind === 'input' ? p.value ?? '' : p.kind === 'upstream' ? '' : '')
  const [remote, setRemote] = useState(p.kind === 'upstream' ? p.remote : '')
  const [noAsk, setNoAsk] = useState(false)
  const [checked, setChecked] = useState(p.kind === 'input' ? p.checkbox?.value ?? false : false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) { el.focus(); const n = el.value.length; el.setSelectionRange(n, n) }
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closePrompt() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const submit = () => {
    if (p.kind === 'input') {
      if (!value.trim() && (!p.extraButtons || p.requireValue)) return
      closePrompt()
      void p.onSubmit(value, checked)
    } else if (p.kind === 'upstream') {
      closePrompt()
      void p.onSubmit(remote, value.trim() || p.branch)
    }
  }

  return (
    <div className="user-input-content">
      <div className="prompt-message">{p.message}</div>
      <div className="prompt-actions">
        {p.kind === 'input' ? (
          <input
            ref={inputRef}
            className={`prompt-input${p.large === false ? '' : ' large-input'}`}
            value={value}
            placeholder={p.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
        ) : null}
        {p.kind === 'upstream' ? (
          <>
            <select className="prompt-select" value={remote} onChange={(e) => setRemote(e.target.value)}>
              {p.remotes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <span className="slash-separator">/</span>
            <input ref={inputRef} className="prompt-input upstream" value={value} placeholder={p.placeholder ?? p.branch}
              onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
          </>
        ) : null}
        {p.kind === 'confirm' ? (
          p.buttons.map((b, i) => (
            <button key={b.label} autoFocus={i === 0} className={`btn btn-xs prompt-btn btn-${b.style ?? 'default'}`} onClick={() => { closePrompt(); p.dontAskAgain?.(noAsk); void b.run() }}>{b.label}</button>
          ))
        ) : (
          <>
            <button className="btn btn-xs prompt-btn btn-success" disabled={p.kind === 'input' && p.requireValue && !value.trim()} onClick={submit}>{p.kind === 'input' && p.submitLabel ? p.submitLabel : 'Submit'}</button>
            {p.kind === 'input' && p.extraButtons ? p.extraButtons.map((b) => (
              <button key={b.label} className={`btn btn-xs prompt-btn btn-${b.style ?? 'default'}`} onClick={() => { closePrompt(); void b.run() }}>{b.label}</button>
            )) : null}
          </>
        )}
        <button className="btn btn-xs prompt-btn btn-default" onClick={closePrompt}>{p.kind === 'confirm' && p.cancelLabel ? p.cancelLabel : 'Cancel'}</button>
        {p.kind === 'input' && p.checkbox ? (
          <label className="prompt-check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {p.checkbox.label}</label>
        ) : null}
        {p.kind === 'confirm' && p.dontAskAgain ? (
          <label className="prompt-check"><input type="checkbox" checked={noAsk} onChange={(e) => setNoAsk(e.target.checked)} /> Don't ask again</label>
        ) : null}
      </div>
    </div>
  )
}
