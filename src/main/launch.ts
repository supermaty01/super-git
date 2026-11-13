// What SuperGit was asked to open from outside: the command line (`supergit .`, "Open with SuperGit"
// in Explorer), a second launch while it is running, or a supergit:// link. Requests are turned into
// renderer commands and held until the renderer is ready, so a cold start does not lose them.
import { app, type WebContents } from 'electron'
import { statSync } from 'node:fs'
import path from 'node:path'
import * as git from './git'
import { parseCliArgs, parseSuperGitUri, repoUriPath, URI_SCHEME, type CliRequest } from '../shared/cli'

/** the arguments after the executable; in development also after the app script (electron out/main/index.js) */
export function userArgs(argv: string[]): string[] {
  return argv.slice(process.defaultApp ? 2 : 1)
}

export function parseLaunch(argv: string[], cwd: string): CliRequest {
  return parseCliArgs(userArgs(argv), cwd, (c, p) => path.resolve(c, p))
}

/** the repository root for a path inside it (a file opens its repository, a .git folder its work tree) */
export async function repoRootFor(p: string): Promise<string | null> {
  let dir = p
  try {
    if (!statSync(dir).isDirectory()) dir = path.dirname(dir)
  } catch { return null }
  if (path.basename(dir).toLowerCase() === '.git') dir = path.dirname(dir)
  const info = await git.resolveRepo(dir).catch(() => null)
  return info?.root ?? null
}

/** renderer commands for one request (see runCommand in App.tsx) */
export async function commandsFor(req: CliRequest): Promise<string[]> {
  if (req.uri) {
    const u = parseSuperGitUri(req.uri)
    if (u && u.cmd === 'repo') {
      const p = repoUriPath(u, process.platform === 'win32')
      return p ? commandsFor({ help: false, version: false, path: path.resolve(p) }) : []
    }
    return [`deeplink:${req.uri}`]
  }
  if (req.path) {
    const root = await repoRootFor(req.path)
    return [root ? `open:${root}` : `open-failed:${req.path}`]
  }
  return []
}

// ---------------------------------------------------------------------------------------------
// delivery: queued until the renderer has finished starting (it asks with takeStartupFolder)

let target: WebContents | null = null
let ready = false
const queue: string[] = []

export function attach(wc: WebContents): void {
  target = wc
  // a reload starts the renderer over: hold commands until it asks again
  wc.on('did-start-loading', () => { ready = false })
}

export function deliver(cmds: string[]): void {
  if (ready && target && !target.isDestroyed()) for (const c of cmds) target.send('command', c)
  else queue.push(...cmds)
}

/** the renderer is ready: everything queued goes out now */
export function rendererReady(): void {
  ready = true
  const cmds = queue.splice(0)
  if (cmds.length) setImmediate(() => deliver(cmds))
}

/** a request (command line or link) once the app is running */
export async function handle(req: CliRequest): Promise<void> {
  deliver(await commandsFor(req))
}

/** supergit:// opens this copy (installed copies only: a development or portable build would take it over) */
export function registerProtocol(): void {
  if (process.platform !== 'win32') return
  if (process.env.SUPERGIT_USER_DATA && !process.env.SUPERGIT_REGISTER_PROTOCOL) return
  if (!app.isPackaged && !process.env.SUPERGIT_REGISTER_PROTOCOL) return
  if (process.env.PORTABLE_EXECUTABLE_DIR) return
  try {
    if (app.isDefaultProtocolClient(URI_SCHEME)) return
    if (process.defaultApp) app.setAsDefaultProtocolClient(URI_SCHEME, process.execPath, [path.resolve(process.argv[1])])
    else app.setAsDefaultProtocolClient(URI_SCHEME)
  } catch { /* not fatal */ }
}
