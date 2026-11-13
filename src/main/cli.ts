// The `supergit` command (bin\supergit.cmd and bin\supergit run this file with SuperGit.exe and
// ELECTRON_RUN_AS_NODE=1, like the original's cli.js). --help and --version print and exit without
// opening a window; otherwise SuperGit starts detached (or the running window takes the request
// through its single-instance lock) and the terminal gets its prompt back straight away.
// No Electron imports: this runs as plain Node.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseCliArgs, helpText } from '../shared/cli'

function version(): string {
  // out/main/cli.js -> <app>/package.json (inside app.asar when packaged; Electron's Node reads asar files)
  for (const p of [path.join(__dirname, '..', '..', 'package.json'), path.join(__dirname, '..', 'package.json')]) {
    try { return JSON.parse(readFileSync(p, 'utf8')).version as string } catch { /* try the next one */ }
  }
  return 'unknown'
}

function main(): void {
  const argv = process.argv.slice(2) // [0] SuperGit.exe, [1] this script
  const req = parseCliArgs(argv, process.cwd(), (cwd, p) => path.resolve(cwd, p))
  if (req.help) { process.stdout.write(`${helpText()}\n`); process.exit(0) }
  if (req.version) { process.stdout.write(`${version()}\n`); process.exit(0) }

  // relative paths are resolved here, so they survive the hand-over to an instance that is already running
  const args: string[] = []
  // development build (electron.exe out/main/cli.js): the app folder goes first, as `electron .` would
  const appDir = path.join(__dirname, '..', '..')
  if (!/\.asar([\\/]|$)/i.test(appDir) && /^electron(\.exe)?$/i.test(path.basename(process.execPath))) args.push(appDir)
  if (req.uri) args.push(`--uri=${req.uri}`)
  else if (req.path) args.push(`--path=${req.path}`)
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', env, cwd: process.cwd(), windowsHide: false })
    child.on('error', (e) => { process.stderr.write(`${e.message}\n`); process.exit(1) })
    child.unref()
    // give spawn a moment to report a missing executable before exiting
    setTimeout(() => process.exit(0), 50)
  } catch (e) {
    process.stderr.write(`${(e as Error).message ?? e}\n`)
    process.exit(1)
  }
}

main()
