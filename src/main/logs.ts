// Help > Support Logs: an error log (main-process failures and renderer errors) and a performance
// log (startup timings), kept as plain text files in <userData>\logs and opened in the default editor.
import { app, shell, type WebContents } from 'electron'
import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 1_000_000
const t0 = Date.now()
const marks: Array<[string, number]> = []

function logDir(): string {
  const d = path.join(app.getPath('userData'), 'logs')
  try { mkdirSync(d, { recursive: true }) } catch { /* ignore */ }
  return d
}
const errorLog = () => path.join(logDir(), 'error.log')
const perfLog = () => path.join(logDir(), 'performance.log')

function append(file: string, text: string): void {
  try {
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`)
    appendFileSync(file, text, 'utf8')
  } catch { /* logging never breaks the app */ }
}

export function logError(source: string, err: unknown): void {
  const msg = err instanceof Error ? err.stack || err.message : String(err)
  append(errorLog(), `[${new Date().toISOString()}] [${source}] ${msg}\n`)
}

/** a startup milestone for the performance log (written once the window has shown) */
export function mark(name: string): void {
  marks.push([name, Date.now() - t0])
}

export function flushPerf(): void {
  const lines = marks.map(([n, ms]) => `  ${String(ms).padStart(6)} ms  ${n}`)
  append(perfLog(), `[${new Date(t0).toISOString()}] SuperGit ${app.getVersion()} startup\n${lines.join('\n')}\n\n`)
}

/** errors from the main process and the window's renderer go to the error log */
export function captureErrors(): void {
  // the monitor only observes: the app's own handling of the error is unchanged
  process.on('uncaughtExceptionMonitor', (e, origin) => logError(origin === 'unhandledRejection' ? 'main (promise)' : 'main', e))
  app.on('render-process-gone', (_e, _wc, d) => logError('renderer', `render process gone: ${d.reason} (exit code ${d.exitCode})`))
  app.on('child-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') logError('main', `${d.type} process gone: ${d.reason}`) })
}

export function captureRendererErrors(wc: WebContents): void {
  wc.on('console-message', (e) => {
    const ev = e as unknown as { level?: string | number; message?: string; sourceId?: string; lineNumber?: number }
    if (ev.level === 'error' || ev.level === 3) logError('renderer', `${ev.message ?? ''}${ev.sourceId ? ` (${ev.sourceId}:${ev.lineNumber ?? 0})` : ''}`)
  })
  wc.on('preload-error', (_e, p, err) => logError('preload', `${p}: ${err.stack || err.message}`))
}

function openLog(file: string, header: string): void {
  if (!existsSync(file)) { try { writeFileSync(file, header, 'utf8') } catch { /* ignore */ } }
  void shell.openPath(file)
}

export const openErrorLog = () => openLog(errorLog(), 'SuperGit error log. Nothing has gone wrong so far.\n')
export const openPerfLog = () => openLog(perfLog(), 'SuperGit performance log (startup timings).\n')
