// Integrated terminal: pseudo-terminal sessions streamed to the renderer (xterm.js).
import type { WebContents } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { IPty } from '@lydell/node-pty'

let ptyModule: typeof import('@lydell/node-pty') | null = null
function pty() {
  // loaded lazily so a missing native binary never breaks app startup
  if (!ptyModule) ptyModule = require('@lydell/node-pty') as typeof import('@lydell/node-pty')
  return ptyModule
}

const sessions = new Map<number, IPty>()
let nextId = 1

function shellFor(kind: string): { file: string; args: string[] } {
  if (kind === 'cmd') return { file: 'cmd.exe', args: [] }
  if (kind === 'pwsh') {
    const dirs = [...(process.env.PATH ?? '').split(path.delimiter), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'PowerShell', '7')]
    const found = dirs.filter(Boolean).map((d) => path.join(d as string, 'pwsh.exe')).find((c) => existsSync(c))
    if (!found) throw new Error('PowerShell 7 (pwsh.exe) is not installed. Pick another shell from the terminal\'s shell menu.')
    return { file: found, args: ['-NoLogo'] }
  }
  if (kind === 'gitbash') {
    const candidates = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
      .filter(Boolean).map((b) => path.join(b as string, 'Git', 'bin', 'bash.exe'))
    const bash = candidates.find((c) => existsSync(c))
    if (bash) return { file: bash, args: ['--login', '-i'] }
  }
  return { file: 'powershell.exe', args: ['-NoLogo'] }
}

export function startTerminal(wc: WebContents, cwd: string, shell: string, cols: number, rows: number): number {
  const { file, args } = shellFor(shell)
  const id = nextId++
  const p = pty().spawn(file, args, {
    name: 'xterm-256color', cols: Math.max(2, cols), rows: Math.max(2, rows), cwd,
    env: { ...(process.env as Record<string, string>), TERM_PROGRAM: 'SuperGit' }
  })
  sessions.set(id, p)
  p.onData((data) => { if (!wc.isDestroyed()) wc.send('term-data', { id, data }) })
  p.onExit(({ exitCode }) => {
    sessions.delete(id)
    if (!wc.isDestroyed()) wc.send('term-exit', { id, code: exitCode })
  })
  return id
}

export function writeTerminal(id: number, data: string): void { sessions.get(id)?.write(data) }
export function resizeTerminal(id: number, cols: number, rows: number): void {
  try { sessions.get(id)?.resize(Math.max(2, cols), Math.max(2, rows)) } catch { /* already exited */ }
}
export function killTerminal(id: number): void {
  const p = sessions.get(id)
  sessions.delete(id)
  try { p?.kill() } catch { /* ignore */ }
}
export function killAllTerminals(): void { for (const id of [...sessions.keys()]) killTerminal(id) }
