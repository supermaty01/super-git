import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, bridge } from '../lib/api'
import { useStore } from '../store'
import * as A2 from '../actions2'
import { Icon } from './Icon'

function termTheme(light: boolean) {
  return light
    ? { background: '#fcfcfc', foreground: '#333333', cursor: '#4d88ff', selectionBackground: '#4d88ff40' }
    : { background: '#060707', foreground: '#D8DEE9', cursor: '#4D88FF', selectionBackground: '#4D88FF40', black: '#060707', red: '#EF6B73', green: '#3DD68C', yellow: '#F0C75E', blue: '#5E9EFF', magenta: '#D176D6', cyan: '#50C4D8', white: '#D8DEE9', brightBlack: '#616E88', brightRed: '#F5939C', brightGreen: '#6EDFA6', brightYellow: '#F5D88B', brightBlue: '#89B8FF', brightMagenta: '#E2A0E8', brightCyan: '#7CD5E3', brightWhite: '#ECEFF4' }
}

const SHELL_LABEL: Record<string, string> = { powershell: 'PowerShell', pwsh: 'pwsh', cmd: 'cmd', gitbash: 'Git Bash' }

export function TerminalPanel({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null)
  const height = useStore((s) => s.settings!.terminalHeight)
  const shell = useStore((s) => s.settings!.terminalShell)
  const theme = useStore((s) => s.settings!.theme)
  const [session, setSession] = useState(0)
  const [exited, setExited] = useState(false)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const st = useStore.getState().settings!
    const light = st.theme === 'light'
    const term = new Terminal({
      fontFamily: `${st.terminalFont}, Consolas, "Cascadia Mono", monospace`,
      fontSize: st.terminalFontSize,
      lineHeight: st.terminalLineHeight,
      cursorStyle: st.terminalCursor,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: termTheme(light)
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    fitRef.current = fit
    term.open(host.current!)
    try { fit.fit() } catch { /* not visible yet */ }
    let id = -1
    let disposed = false
    setExited(false)
    const offData = bridge().onTermData((e) => { if (e.id === id) term.write(e.data) })
    const offExit = bridge().onTermExit((e) => { if (e.id === id) { term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n'); setExited(true) } })
    void api.termStart(path, term.cols, term.rows).then((n) => {
      if (disposed) { void api.termKill(n); return }
      id = n
      term.focus()
    }).catch((err) => term.write(`\x1b[31mCould not start terminal: ${String((err as Error).message)}\x1b[0m\r\n`))
    term.onData((d) => { if (id >= 0) void api.termWrite(id, d) })
    term.onResize(({ cols, rows }) => { if (id >= 0) void api.termResize(id, cols, rows) })
    // Ctrl+C copies when there is a selection, Ctrl+V pastes
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      if (ev.ctrlKey && ev.key === 'c' && term.hasSelection()) { void api.copy(term.getSelection()); return false }
      if (ev.ctrlKey && ev.key === 'v') { void navigator.clipboard.readText().then((t) => { if (id >= 0) void api.termWrite(id, t) }); return false }
      if (ev.ctrlKey && ev.key === '`') return false
      return true
    })
    const ro = new ResizeObserver(() => {
      try { fit.fit() } catch { return }
      if (id >= 0) void api.termResize(id, term.cols, term.rows)
    })
    ro.observe(host.current!)
    return () => {
      disposed = true
      ro.disconnect()
      offData()
      offExit()
      if (id >= 0) void api.termKill(id)
      term.dispose()
    }
  }, [path, session, shell])

  useEffect(() => { if (termRef.current) termRef.current.options.theme = termTheme(theme === 'light') }, [theme])

  // font / cursor preferences apply to the running terminal
  const font = useStore((s) => s.settings!.terminalFont)
  const fontSize = useStore((s) => s.settings!.terminalFontSize)
  const lineHeight = useStore((s) => s.settings!.terminalLineHeight)
  const cursor = useStore((s) => s.settings!.terminalCursor)
  const dim = useStore((s) => s.settings!.terminalDimUnfocused)
  const [focused, setFocused] = useState(true)
  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.options.fontFamily = `${font}, Consolas, "Cascadia Mono", monospace`
    t.options.fontSize = fontSize
    t.options.lineHeight = lineHeight
    t.options.cursorStyle = cursor
    try { fitRef.current?.fit() } catch { /* hidden */ }
  }, [font, fontSize, lineHeight, cursor])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    let last = e.clientY
    const move = (ev: MouseEvent) => {
      const dy = last - ev.clientY
      last = ev.clientY
      const cur = useStore.getState().settings!.terminalHeight
      useStore.setState((s) => ({ settings: { ...s.settings!, terminalHeight: Math.max(120, Math.min(window.innerHeight - 250, cur + dy)) } }))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void api.setSettings({ terminalHeight: useStore.getState().settings!.terminalHeight })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className={`terminal-panel${dim && !focused ? ' dimmed' : ''}`} style={{ height }} onFocusCapture={() => setFocused(true)} onBlurCapture={() => setFocused(false)}>
      <div className="terminal-resize" onMouseDown={startResize} />
      <div className="terminal-header">
        <Icon name="terminal" />
        <span className="terminal-title">TERMINAL</span>
        <span className="text-secondary">{SHELL_LABEL[shell] ?? shell} · {path}</span>
        <span className="grow" />
        {exited ? <button className="btn btn-xs btn-default" onClick={() => setSession((n) => n + 1)}>Restart</button> : null}
        <span className="terminal-btn" title="New session" onClick={() => setSession((n) => n + 1)}><Icon name="plus" /></span>
        <span className="terminal-btn" title="Open external terminal" onClick={() => api.openTerminal(path)}><Icon name="external" /></span>
        <span className="terminal-btn" title="Close terminal (Ctrl+`)" onClick={() => A2.toggleTerminal(path, false)}><Icon name="times" /></span>
      </div>
      <div className="terminal-host" ref={host} />
    </div>
  )
}
