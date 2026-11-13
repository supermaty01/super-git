import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, bridge } from '../lib/api'
import { useStore } from '../store'
import * as A2 from '../actions2'
import * as A from '../actions'
import { Icon } from './Icon'
import { resolveTheme } from '../lib/theme'

function termTheme(light: boolean) {
  return light
    ? { background: '#000000', foreground: '#D8DEE9', cursor: '#4d88ff', selectionBackground: '#4d88ff40' }
    : { background: '#000000', foreground: '#D8DEE9', cursor: '#4D88FF', selectionBackground: '#4D88FF40', black: '#000000', red: '#EF6B73', green: '#3DD68C', yellow: '#F0C75E', blue: '#5E9EFF', magenta: '#D176D6', cyan: '#50C4D8', white: '#D8DEE9', brightBlack: '#616E88', brightRed: '#F5939C', brightGreen: '#6EDFA6', brightYellow: '#F5D88B', brightBlue: '#89B8FF', brightMagenta: '#E2A0E8', brightCyan: '#7CD5E3', brightWhite: '#ECEFF4' }
}

const SHELL_LABEL: Record<string, string> = { powershell: 'powershell.exe', pwsh: 'pwsh.exe', cmd: 'cmd.exe', gitbash: 'bash.exe' }
const SHELL_CHOICES: Array<[string, string]> = [['powershell', 'Windows PowerShell'], ['pwsh', 'PowerShell 7 (pwsh)'], ['cmd', 'Command Prompt'], ['gitbash', 'Git Bash']]

interface TermTab { key: number; title: string; /** bumped by Restart: a new shell in the same tab */ gen: number }
let nextKey = 1

/** Terminal panel with tabs, like the original (Ctrl+Shift+N new tab, Ctrl+Shift+W close, Ctrl+PageUp/PageDown, Ctrl+Shift+1…9). */
export function TerminalPanel({ path }: { path: string }) {
  const height = useStore((s) => s.settings!.terminalHeight)
  const shell = useStore((s) => s.settings!.terminalShell)
  const dim = useStore((s) => s.settings!.terminalDimUnfocused)
  const [focused, setFocused] = useState(true)
  const [tabs, setTabs] = useState<TermTab[]>(() => [{ key: nextKey++, title: SHELL_LABEL[shell] ?? shell, gen: 0 }])
  const [active, setActive] = useState(tabs[0].key)

  // every tab runs the selected shell (changing it restarts them), so the tab names follow it
  const label = SHELL_LABEL[shell] ?? shell
  // the latest tabs / active tab, so menu commands and quick repeats never act on stale state
  const tabsRef = useRef(tabs)
  const activeRef = useRef(active)
  tabsRef.current = tabs
  activeRef.current = active
  const update = (next: TermTab[], nextActive: number) => {
    tabsRef.current = next
    activeRef.current = nextActive
    setTabs(next)
    setActive(nextActive)
  }

  const add = () => { const t = { key: nextKey++, title: label, gen: 0 }; update([...tabsRef.current, t], t.key) }
  const close = (key: number) => {
    const l = tabsRef.current
    const rest = l.filter((t) => t.key !== key)
    if (rest.length === l.length) return
    if (!rest.length) { A2.toggleTerminal(path, false); return }
    const cur = activeRef.current
    update(rest, key === cur ? rest[Math.max(0, l.findIndex((t) => t.key === key) - 1)].key : cur)
  }
  const select = (key: number) => update(tabsRef.current, key)
  // commands from the menu / shortcuts
  useEffect(() => {
    const on = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail
      const l = tabsRef.current
      const i = l.findIndex((t) => t.key === activeRef.current)
      if (cmd === 'new') add()
      else if (cmd === 'close') close(activeRef.current)
      else if (cmd === 'next' && l.length) select(l[(i + 1) % l.length].key)
      else if (cmd === 'prev' && l.length) select(l[(i - 1 + l.length) % l.length].key)
      else if (/^\d$/.test(cmd) && l[Number(cmd) - 1]) select(l[Number(cmd) - 1].key)
    }
    window.addEventListener('sg-terminal', on)
    return () => window.removeEventListener('sg-terminal', on)
  }) // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="terminal-tabs">
          {tabs.map((t, i) => (
            <span key={t.key} className={`terminal-tab${t.key === active ? ' active' : ''}`} title={`${label} · ${path} (Ctrl+Shift+${i + 1})`} onClick={() => select(t.key)}>
              <Icon name="terminal" /> {label}
              <span className="terminal-tab-close" title="Close terminal tab (Ctrl+Shift+W)" onClick={(e) => { e.stopPropagation(); close(t.key) }}><Icon name="times-thin" /></span>
            </span>
          ))}
          <span className="terminal-btn" title="New terminal tab (Ctrl+Shift+N)" onClick={add}><Icon name="plus" /></span>
        </div>
        <span className="grow" />
        <span className="terminal-btn" title="Select the terminal shell" onClick={() => void A.popup(SHELL_CHOICES.map(([id, label]) => ({ label, checked: id === shell, act: () => A2.saveSettings({ terminalShell: id as typeof shell }) })))}><Icon name="chevron-down" /></span>
        <span className="terminal-btn" title="Kill terminal" onClick={() => close(active)}><Icon name="trash" /></span>
        <span className="terminal-btn" title="Close terminal (Ctrl+`)" onClick={() => A2.toggleTerminal(path, false)}><Icon name="times" /></span>
      </div>
      {tabs.map((t) => <TermSession key={`${t.key}:${t.gen}`} path={path} visible={t.key === active} />)}
    </div>
  )
}

function TermSession({ path, visible }: { path: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const shell = useStore((s) => s.settings!.terminalShell)
  const theme = useStore((s) => s.settings!.theme)
  const [, setExited] = useState(false)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const st = useStore.getState().settings!
    const light = resolveTheme(st.theme).scheme === 'light'
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
      // the app's own shortcuts still work from the terminal: the command palette, tab switching, terminal tabs
      if (ev.ctrlKey && !ev.altKey && (ev.key.toLowerCase() === 'p' || ev.key === 'Tab' || ev.key === 'PageUp' || ev.key === 'PageDown')) return false
      if (ev.ctrlKey && ev.shiftKey && !ev.altKey && /^(KeyN|KeyW|Digit[1-9])$/.test(ev.code)) return false
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
  }, [path, shell])

  // a tab that becomes visible is fitted to the panel and focused
  useEffect(() => {
    if (!visible) return
    try { fitRef.current?.fit() } catch { /* hidden */ }
    termRef.current?.focus()
  }, [visible])

  useEffect(() => { if (termRef.current) termRef.current.options.theme = termTheme(resolveTheme(theme).scheme === 'light') }, [theme])

  // font / cursor preferences apply to the running terminal
  const font = useStore((s) => s.settings!.terminalFont)
  const fontSize = useStore((s) => s.settings!.terminalFontSize)
  const lineHeight = useStore((s) => s.settings!.terminalLineHeight)
  const cursor = useStore((s) => s.settings!.terminalCursor)
  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.options.fontFamily = `${font}, Consolas, "Cascadia Mono", monospace`
    t.options.fontSize = fontSize
    t.options.lineHeight = lineHeight
    t.options.cursorStyle = cursor
    try { fitRef.current?.fit() } catch { /* hidden */ }
  }, [font, fontSize, lineHeight, cursor])

  return <div className="terminal-host" ref={host} style={visible ? undefined : { display: 'none' }} />
}
