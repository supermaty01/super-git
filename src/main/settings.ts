import { app, safeStorage } from 'electron'
import { promises as fs, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Settings, ProviderId } from '../shared/types'

const DEFAULTS: Settings = {
  zoom: 1.1,
  diffMode: 'split',
  fileListMode: 'path',
  defaultPullMode: 'ff',
  commitLimit: 2000,
  layout: { leftWidth: 300, rightWidth: 420, refColWidth: 150, graphColWidth: 0, leftOpen: true },
  defaultCloneDir: path.join(os.homedir(), 'source', 'repos'),
  azure: { orgUrl: '', hasToken: false },
  tabs: [],
  activeTab: null,
  recent: [],
  favorites: [],
  showWhitespace: false,
  wordWrap: false,
  editorFont: 'Consolas',
  hiddenRefs: {},
  soloRefs: {},
  autoFetchMinutes: 1,
  theme: 'dark',
  graphColumns: { ref: true, graph: true, message: true, author: false, date: false, sha: false, changes: false },
  graphShow: { tags: true, stashes: true, remotes: true },
  externalEditor: 'code',
  terminalShell: 'powershell',
  terminalHeight: 260,
  pinnedRefs: {},
  smartVisibility: {},
  compactGraph: false,
  hiddenSections: [],
  profiles: [{ id: 'default', name: 'Default Profile', gitName: '', gitEmail: '' }],
  activeProfile: 'default',
  integrations: {},
  autoPrune: true,
  rememberTabs: true,
  updateSubmodules: false,
  gitPath: '',
  showToolbarLabels: true,
  commitDescription: 'always',
  ghostRefs: true,
  highlightOnRefHover: true,
  authorInitials: false,
  dateFormat: 'locale',
  clock: '24h',
  toastPosition: 'bottom-left',
  spellcheck: false,
  showAllCommits: false,
  useInAppTerminal: false,
  syncGitConfigWithProfile: false,
  sshUseAgent: true,
  sshPrivateKey: '',
  sshPublicKey: '',
  desktopNotifications: true,
  autoUpdate: true,
  defaultSmartVisibility: false,
  pushAfterCommit: false,
  forcePushSkipSecondWarning: false,
  skipHooksDefault: false,
  stripComments: true,
  editorFontSize: 12,
  editorTabSize: 4,
  editorLineNumbers: true,
  editorSyntax: true,
  editorEol: 'auto',
  terminalFont: 'Consolas',
  terminalFontSize: 13,
  terminalLineHeight: 1.2,
  terminalCursor: 'block',
  terminalDimUnfocused: false,
  externalTerminal: ''
}

const file = () => path.join(app.getPath('userData'), 'settings.json')
const tokenFile = () => path.join(app.getPath('userData'), 'ado-token.bin')

let cache: Settings | null = null
let writeTimer: NodeJS.Timeout | null = null

export function getSettings(): Settings {
  if (cache) return cache
  let loaded: Partial<Settings> = {}
  try { if (existsSync(file())) loaded = JSON.parse(readFileSync(file(), 'utf8').replace(/^﻿/, '')) } catch { loaded = {} }
  cache = {
    ...DEFAULTS, ...loaded,
    layout: { ...DEFAULTS.layout, ...(loaded.layout ?? {}) },
    azure: { ...DEFAULTS.azure, ...(loaded.azure ?? {}) },
    graphColumns: { ...DEFAULTS.graphColumns, ...(loaded.graphColumns ?? {}) },
    graphShow: { ...DEFAULTS.graphShow, ...(loaded.graphShow ?? {}) }
  }
  if (!cache.profiles?.length) cache.profiles = DEFAULTS.profiles
  cache.integrations = { ...(loaded.integrations ?? {}) }
  cache.azure.hasToken = existsSync(tokenFile())
  // migrate the Azure DevOps PAT connection from before integrations existed
  if (cache.azure.hasToken && cache.azure.orgUrl && !cache.integrations.azure) {
    cache.integrations.azure = { provider: 'azure', host: cache.azure.orgUrl, username: cache.azure.userName ?? '', displayName: cache.azure.userName, method: 'token', connectedAt: Date.now() }
  }
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings()
  cache = { ...cur, ...patch, layout: { ...cur.layout, ...(patch.layout ?? {}) }, azure: { ...cur.azure, ...(patch.azure ?? {}) } }
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => { void flushSettings() }, 250)
  return cache
}

export async function flushSettings(): Promise<void> {
  if (!cache) return
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(cache, null, 2), 'utf8')
}

export function addRecent(repoPath: string, name: string): void {
  const s = getSettings()
  const recent = [{ path: repoPath, name, lastOpened: Date.now() }, ...s.recent.filter((r) => r.path.toLowerCase() !== repoPath.toLowerCase())].slice(0, 50)
  updateSettings({ recent })
}

export async function saveToken(token: string): Promise<void> {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8')
  await fs.writeFile(tokenFile(), data)
  updateSettings({ azure: { ...getSettings().azure, hasToken: true } })
}

export function readToken(): string | null {
  try {
    if (!existsSync(tokenFile())) return null
    const buf = readFileSync(tokenFile())
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return null
  }
}

export async function clearToken(): Promise<void> {
  await fs.rm(tokenFile(), { force: true })
  updateSettings({ azure: { orgUrl: getSettings().azure.orgUrl, hasToken: false, userName: undefined } })
}

// ---------------------------------------------------------------------------------------------
// Per-provider personal access tokens (encrypted with DPAPI via safeStorage)

const providerTokenFile = (p: ProviderId) => (p === 'azure' ? tokenFile() : path.join(app.getPath('userData'), `token-${p}.bin`))

export async function saveProviderToken(p: ProviderId, token: string): Promise<void> {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8')
  await fs.writeFile(providerTokenFile(p), data)
}

export function readProviderToken(p: ProviderId): string | null {
  try {
    const f = providerTokenFile(p)
    if (!existsSync(f)) return null
    const buf = readFileSync(f)
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return null
  }
}

export async function clearProviderToken(p: ProviderId): Promise<void> {
  await fs.rm(providerTokenFile(p), { force: true })
}
