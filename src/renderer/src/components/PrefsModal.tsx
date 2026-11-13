import { useEffect, useState, type ReactNode } from 'react'
import { useStore, closeModal, toast, activeRepoPath } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { saveSettings, switchProfile } from '../actions2'
import { errMsg, formatMoment } from '../lib/format'
import { THEMES, SYNC_THEME } from '../lib/theme'
import { Icon } from './Icon'
import { IntegrationsSection } from './Integrations'
import { K2GeneralPrefs, RepoConflictPrefs } from './K2Prefs'
import type { PullMode, Settings, SshKey, GpgKey, LfsInfo, Profile } from '@shared/types'

function Frame({ nav, tab, setTab, children }: { nav: Array<[string, string, string]>; tab: string; setTab: (t: string) => void; children: ReactNode }) {
  const profile = useStore((s) => s.settings!.profiles.find((p) => p.id === s.settings!.activeProfile)?.name ?? 'Default Profile')
  return (
    <div className="modal prefs-modal">
      <div className="clone-layout">
        <div className="clone-nav">
          <div className="clone-nav-item prefs-exit" onClick={closeModal}><Icon name="sign-out" /> Exit Preferences</div>
          <div className="prefs-nav-caption">Current profile</div>
          <div className="prefs-repo-line"><Icon name="user" /><span>{profile}</span></div>
          {nav.map(([id, label, icon]) => id === 'heading:global'
            ? <div key={id} className="prefs-nav-caption">{label}</div>
            : id.startsWith('heading:')
              ? <div key={id}><div className="prefs-nav-caption">Repo-Specific Preferences</div><div className="prefs-repo-line"><Icon name="folder" /><span>{label}</span></div></div>
              : <div key={id} className={`clone-nav-item${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}><Icon name={icon} /> {label}</div>)}
        </div>
        <div className="clone-content">{children}</div>
      </div>
    </div>
  )
}

const Row = ({ label, children, right, help }: { label: string; children: ReactNode; right?: ReactNode; help?: ReactNode }) => (
  <>
    <div className="form-grid-row"><span className="form-label">{label}</span>{children}{right ?? <span />}</div>
    {help ? <div className="text-secondary fs-small indent-form pref-help">{help}</div> : null}
  </>
)

/** checkbox row bound to an app setting */
function Check<K extends keyof Settings>({ k, label, help, inline, def = false, invert = false }: { k: K; label: string; help?: ReactNode; inline?: string; def?: boolean; invert?: boolean }) {
  const raw = useStore((s) => s.settings![k]) as boolean | undefined
  const v = (raw ?? def) !== invert
  const box = <input type="checkbox" checked={v} onChange={(e) => saveSettings({ [k]: e.target.checked !== invert } as Partial<Settings>)} />
  return <Row label={label} help={help}>{inline ? <label className="form-check">{box}<span>{inline}</span></label> : box}</Row>
}

/** a help line with the warning colour and triangle (GitKraken's performance notes) */
const Warn = ({ children }: { children: ReactNode }) => <div className="prefs-warn"><Icon name="warning" /> {children}</div>

/** select row bound to an app setting */
function Pick<K extends keyof Settings>({ k, label, options, help }: { k: K; label: string; options: Array<[string, string]>; help?: ReactNode }) {
  const v = useStore((s) => s.settings![k]) as string
  return (
    <Row label={label} help={help}>
      <select className="form-control" value={v} onChange={(e) => saveSettings({ [k]: e.target.value } as Partial<Settings>)}>
        {options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
      </select>
    </Row>
  )
}

/** number row bound to an app setting (saved on blur / Enter) */
function Num<K extends keyof Settings>({ k, label, min, max, step = 1, help }: { k: K; label: string; min: number; max: number; step?: number; help?: ReactNode }) {
  const v = useStore((s) => s.settings![k]) as number
  const [text, setText] = useState(String(v))
  useEffect(() => setText(String(v)), [v])
  const commit = () => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n)) saveSettings({ [k]: Math.min(max, Math.max(min, n)) } as Partial<Settings>)
    else setText(String(v))
  }
  return <Row label={label} help={help}><input className="form-control narrow" type="number" min={min} max={max} step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} /></Row>
}

/** a value from the global git config, with a setter that unsets on '' */
function useGlobalGit(key: string): [string, (v: string) => Promise<void>] {
  const [v, setV] = useState('')
  useEffect(() => { void api.gitConfigGet(key).then((x) => setV(x ?? '')) }, [key])
  const set = async (next: string) => {
    setV(next)
    try {
      if (next === '') await api.gitConfigUnset(key)
      else await api.gitConfigSet(key, next)
    } catch (e) { toast({ kind: 'error', title: `Could not save ${key}`, message: errMsg(e) }) }
  }
  return [v, set]
}

function GitBool({ k, label, help, defaultOn = false, invert = false }: { k: string; label: string; help?: ReactNode; defaultOn?: boolean; invert?: boolean }) {
  const [v, set] = useGlobalGit(k)
  const on = (v === '' ? defaultOn : v === 'true') !== invert
  return <Row label={label} help={help}><input type="checkbox" checked={on} onChange={(e) => set(String(e.target.checked !== invert))} /></Row>
}

function GitText({ k, label, placeholder, help, browse }: { k: string; label: string; placeholder?: string; help?: ReactNode; browse?: string }) {
  const [v, set] = useGlobalGit(k)
  const [text, setText] = useState('')
  useEffect(() => setText(v), [v])
  const pick = async () => {
    const f = await api.pickOpenFile(browse!, [{ name: 'All files', extensions: ['*'] }])
    if (f) void set(f.replace(/\\/g, '/'))
  }
  return (
    <Row label={label} help={help} right={browse ? <button className="btn btn-primary btn-small" onClick={pick}>Browse</button> : undefined}>
      <input className="form-control" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text.trim() !== v) void set(text.trim()) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </Row>
  )
}

// =============================================================================================
// Application preferences

// the original's order
const NAV: Array<[string, string, string]> = [
  ['general', 'General', 'cog'], ['profiles', 'Profiles', 'user'], ['ssh', 'SSH', 'key'], ['integrations', 'Integrations', 'link'],
  ['tools', 'External Tools', 'external'], ['notifications', 'Notifications', 'bell'], ['ui', 'UI Customization', 'eye'],
  ['signing', 'Commit Signing', 'check-circle'], ['editor', 'Editor', 'file-lines'],
  ['terminal', 'In-App Terminal', 'terminal'], ['experimental', 'Experimental', 'refresh']
]
const REPO_NAV: Array<[string, string, string]> = [
  ['repo:encoding', 'Encoding', 'paragraph'], ['repo:gitflow', 'Gitflow', 'merge'], ['repo:hooks', 'Git Hooks', 'commit'], ['repo:conflict', 'Conflict Prevention', 'merge'], ['repo:commit', 'Commit', 'commit'],
  ['repo:lfs', 'LFS', 'download'], ['repo:sparse', 'Sparse Checkout', 'filter'],
  ['repo:submodules', 'Submodules', 'folder-tree'], ['repo:general', 'Identity', 'user'], ['repo:gitignore', '.gitignore', 'file-lines']
]
const LEGACY_SECTIONS: Record<string, string> = { azure: 'integrations', keys: 'ssh', appearance: 'ui' }

export function PrefsModal({ section, repoPath }: { section?: string; repoPath?: string }) {
  const repo = repoPath ?? activeRepoPath() ?? null
  // the old global "Commit" section now lives under the repo-specific Commit page
  const initial = section === 'commit' && repo ? 'repo:commit' : (LEGACY_SECTIONS[section ?? ''] ?? section ?? 'general')
  const [tab, setTab] = useState(initial)
  const nav = repo ? [['heading:global', 'Preferences', ''] as [string, string, string], ...NAV, ['heading:repo', `Repo: ${repo.split(/[\\/]/).pop()}`, ''] as [string, string, string], ...REPO_NAV] : [['heading:global', 'Preferences', ''] as [string, string, string], ...NAV]
  const repoTab = tab.startsWith('repo:') ? tab.slice(5) : null
  return (
    <Frame tab={tab} setTab={setTab} nav={nav}>
      {repoTab && repo ? <RepoSection path={repo} tab={repoTab} />
        : tab === 'general' ? <GeneralSection />
        : tab === 'ui' ? <UiSection />
          : tab === 'profiles' ? <ProfilesSection />
            : tab === 'integrations' ? <IntegrationsSection />
              : tab === 'experimental' ? <ExperimentalSection />
                : tab === 'signing' ? <SigningSection />
                  : tab === 'ssh' ? <SshSection />
                    : tab === 'editor' ? <EditorSection />
                      : tab === 'notifications' ? <NotificationsSection />
                      : tab === 'terminal' ? <TerminalSection />
                        : <ToolsSection />}
    </Frame>
  )
}

function NotificationsSection() {
  return (
    <>
      <div className="clone-title">Notifications</div>
      <Check k="desktopNotifications" label="Enable Desktop Notifications" help="Allow SuperGit to send desktop notifications." />
    </>
  )
}

function SshKeyPaths() {
  const settings = useStore((s) => s.settings!)
  const browse = async (k: 'sshPrivateKey' | 'sshPublicKey') => {
    const f = await api.pickOpenFile(k === 'sshPrivateKey' ? 'Select SSH private key' : 'Select SSH public key', [{ name: 'All files', extensions: ['*'] }])
    if (f) saveSettings({ [k]: f } as Partial<Settings>)
  }
  return (
    <>
      <Row label="SSH private key" right={<button className="btn btn-primary btn-small" onClick={() => browse('sshPrivateKey')}>Browse</button>}>
        <input className="form-control" placeholder="~/.ssh/id_ed25519" value={settings.sshPrivateKey} onChange={(e) => saveSettings({ sshPrivateKey: e.target.value })} />
      </Row>
      <Row label="SSH public key" right={<button className="btn btn-primary btn-small" onClick={() => browse('sshPublicKey')}>Browse</button>}>
        <input className="form-control" placeholder="~/.ssh/id_ed25519.pub" value={settings.sshPublicKey} onChange={(e) => saveSettings({ sshPublicKey: e.target.value })} />
      </Row>
    </>
  )
}

function GeneralSection() {
  const settings = useStore((s) => s.settings!)
  const [autocrlf, setAutocrlf] = useGlobalGit('core.autocrlf')
  return (
    <>
      <div className="clone-title">General</div>
      <Num k="autoFetchMinutes" label="Auto-Fetch Interval" min={0} max={60} help="In minutes, between 0 and 60 (0 disables auto-fetch). Fetches all visible remotes." />
      <Warn>If you have many visible remotes, this may impact performance. LFS objects will not be automatically fetched.</Warn>
      <Check k="autoPrune" label="Auto-Prune" />
      <Check k="updateSubmodules" label="Keep submodules up to date" inline="Automatically update all submodules after performing a Git action" />
      <GitText k="init.defaultBranch" label="Default Branch Name" placeholder="main" help="Sets the default branch name when initializing new repositories." />
      <GitBool k="mergetool.keepBackup" label="Delete &quot;.orig&quot; files after merging" defaultOn invert />
      <Check k="showAllCommits" label="Show All Commits in Graph" />
      <Warn>Enabling this option may adversely affect performance.</Warn>
      <Check k="lazyLoadCommits" label="Lazy Load Commits in Graph" def />
      <Check k="rememberTabs" label="Remember tabs" />
      <Check k="groupWorktreeTabs" label="Group worktree tabs" def inline="Keep the tabs of a repository and its worktrees together" />
      <K2GeneralPrefs />
      <GitBool k="core.longpaths" label="Longpaths" help="Sets core.longpaths in your global Git Config. By default, Windows only supports file paths less than 260 characters. Enable support for longer file paths." />
      <Row label="AutoCRLF" help="Sets core.autocrlf in your global Git Config.">
        <select className="form-control" value={autocrlf} onChange={(e) => setAutocrlf(e.target.value)}>
          <option value="">Git config default</option>
          <option value="true">true</option>
          <option value="input">input</option>
          <option value="false">false</option>
        </select>
      </Row>
      <Check k="extendedLogging" label="Use extended logging in activity log" />

      <div className="clone-title mt3">SuperGit</div>
      <Row label="Default clone / init folder" right={<button className="btn btn-primary" onClick={async () => { const d = await api.pickDirectory('Default folder', settings.defaultCloneDir); if (d) saveSettings({ defaultCloneDir: d }) }}>Browse</button>}>
        <input className="form-control" value={settings.defaultCloneDir} onChange={(e) => saveSettings({ defaultCloneDir: e.target.value })} />
      </Row>
      <Check k="autoUpdate" label="Check for updates automatically" help="Download new versions of SuperGit from GitHub in the background; you choose when to restart. Help > Check for Updates checks right away." />
      <Row label="Default pull behaviour">
        <select className="form-control" value={settings.defaultPullMode} onChange={(e) => saveSettings({ defaultPullMode: e.target.value as PullMode })}>
          <option value="fetch">Fetch All</option><option value="ff">Pull (fast-forward if possible)</option><option value="ff-only">Pull (fast-forward only)</option><option value="rebase">Pull (rebase)</option>
        </select>
      </Row>
      <Num k="commitLimit" label="Initial Commits in Graph" min={200} max={100000} step={500} help="More commits load from the bottom of the graph. Large values can slow the graph down." />
      <Check k="useInAppTerminal" label="Use In-App Terminal instead" help="“Open Terminal” (Alt+T) opens the terminal panel instead of an external terminal." />
    </>
  )
}

function ExperimentalSection() {
  const settings = useStore((s) => s.settings!)
  const [git, setGit] = useState<{ path: string; version: string } | null>(null)
  const [gitPath, setGitPath] = useState(settings.gitPath)
  useEffect(() => { void api.gitInfo().then(setGit) }, [settings.gitPath])
  const browseGit = async () => {
    const f = await api.pickOpenFile('Select git.exe', [{ name: 'git', extensions: ['exe'] }])
    if (f) { setGitPath(f); saveSettings({ gitPath: f }) }
  }
  return (
    <>
      <div className="clone-title">Experimental</div>
      <Row label="Git executable" right={<button className="btn btn-primary" onClick={browseGit}>Browse</button>}
        help={git ? <>Using <code>{git.path}</code> (git {git.version || 'not found'}). Leave empty to auto-detect.</> : null}>
        <input className="form-control" placeholder="Auto-detect" value={gitPath} onChange={(e) => setGitPath(e.target.value)} onBlur={() => { if (gitPath.trim() !== settings.gitPath) saveSettings({ gitPath: gitPath.trim() }) }} />
      </Row>
    </>
  )
}

const LOCALES = ['ar', 'bg', 'ca', 'cs', 'da', 'de', 'de-AT', 'de-CH', 'el', 'en-AU', 'en-CA', 'en-GB', 'en-IE', 'en-IN', 'en-NZ', 'en-US', 'es', 'es-MX', 'es-AR', 'et', 'fa', 'fi', 'fr', 'fr-CA', 'fr-CH', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'nl-BE', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW']

function localeLabel(code: string, now: Date): string {
  let name = code
  try { name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code } catch { /* keep the code */ }
  let sample = ''
  try { sample = new Intl.DateTimeFormat(code, { day: 'numeric', month: 'long', year: 'numeric' }).format(now) } catch { /* unsupported */ }
  return `${name} [${code}]: ${sample}`
}

const DATE_DEFAULTS = { date: 'DD/MM/YYYY', dateWord: 'D MMM YYYY', dateTime: 'DD/MM/YYYY HH:mm', dateVerbose: 'D MMMM YYYY HH:mm' }
const DATE_FIELDS: Array<[keyof typeof DATE_DEFAULTS, string]> = [['date', 'Date Format'], ['dateWord', 'Date word Format'], ['dateTime', 'Date/Time Format'], ['dateVerbose', 'Date verbose Format']]

function DateFormatRow({ field, label }: { field: keyof typeof DATE_DEFAULTS; label: string }) {
  const settings = useStore((s) => s.settings!)
  const v = settings.dateFormats?.[field] ?? ''
  const [text, setText] = useState(v)
  const shown = text.trim() || DATE_DEFAULTS[field]
  const commit = () => { if (text.trim() !== v) saveSettings({ dateFormats: { ...settings.dateFormats, [field]: text.trim() } }) }
  return (
    <Row label={label} right={<span className="date-preview">{formatMoment(new Date(), shown, settings.dateLocale)}</span>}>
      <input className="form-control" placeholder={DATE_DEFAULTS[field]} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </Row>
  )
}

function UiSection() {
  const settings = useStore((s) => s.settings!)
  const now = new Date()
  const col = (c: keyof typeof settings.graphColumns, label: string) => (
    <Row label={label}><input type="checkbox" checked={settings.graphColumns[c]} onChange={(e) => saveSettings({ graphColumns: { ...settings.graphColumns, [c]: e.target.checked } })} /></Row>
  )
  const show = (c: 'remotes' | 'tags' | 'stashes', label: string) => (
    <Row label={label}><input type="checkbox" checked={settings.graphShow[c]} onChange={(e) => saveSettings({ graphShow: { ...settings.graphShow, [c]: e.target.checked } })} /></Row>
  )
  return (
    <>
      <div className="clone-title">UI Customization</div>
      <Row label="Theme">
        <select className="form-control" value={settings.theme} onChange={(e) => { saveSettings({ theme: e.target.value }); void api.setTheme(e.target.value) }}>
          {[...THEMES, SYNC_THEME].map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Row>
      <Pick k="toastPosition" label="Notification Location" options={[['top-left', 'Top Left'], ['top-right', 'Top Right'], ['bottom-left', 'Bottom Left'], ['bottom-right', 'Bottom Right']]} />

      <div className="clone-title mt3">Date/Time</div>
      <div className="pref-help prefs-intro">See <a className="btn-link" onClick={() => void api.openExternal('https://momentjs.com/docs/#/displaying/format/')}>here</a> for formatting options. Restart SuperGit for changes to take effect.</div>
      <Row label="Date/Time Locale">
        <select className="form-control" value={settings.dateLocale ?? ''} onChange={(e) => saveSettings({ dateLocale: e.target.value })}>
          <option value="">System</option>
          {LOCALES.map((c) => <option key={c} value={c}>{localeLabel(c, now)}</option>)}
        </select>
      </Row>
      {DATE_FIELDS.map(([f, label]) => <DateFormatRow key={f} field={f} label={label} />)}
      <Pick k="clock" label="Time format" options={[['24h', '24-hour (14:30)'], ['12h', '12-hour (2:30 PM)']]} />

      <Check k="showToolbarLabels" label="Show toolbar icon labels" def />
      <Check k="spellcheck" label="Enable spell checking" />
      <Check k="authorInitials" label="Display author initials and generic remote icons instead of avatars" />
      <Check k="ghostRefs" label="Show ghost branch/tag when hovering over or selecting a commit" />
      <Check k="highlightOnRefHover" label="Highlight associated rows when hovering over a branch" />
      <Row label="Branch visibility in commit graph">
        <select className="form-control" value={settings.defaultSmartVisibility ? 'smart' : 'all'} onChange={(e) => saveSettings({ defaultSmartVisibility: e.target.value === 'smart' })}>
          <option value="all">All</option><option value="smart">Smart Branch Visibility</option>
        </select>
      </Row>
      {col('ref', 'Show branches and tags in graph')}
      {show('remotes', 'Show remote branches in graph')}
      {show('tags', 'Show tags in graph')}
      {show('stashes', 'Show stashes in graph')}
      {col('author', 'Show commit author in graph')}
      {col('date', 'Show commit date/time in graph')}
      {col('message', 'Show commit message in graph')}
      <Pick k="commitDescription" label="Show commit description in graph" options={[['always', 'Always'], ['hover', 'On hover'], ['never', 'Never']]} />
      {col('sha', 'Show commit sha in graph')}
      {col('changes', 'Show commit changes in graph')}
      {col('graph', 'Show commit tree in graph')}
      <Check k="compactGraph" label="Compact Graph Column" />
      <Row label="Graph columns" right={<span />}>
        <span className="inline-pair">
          <button className="btn btn-default" onClick={() => saveSettings({ compactGraph: false, layout: { ...useStore.getState().settings!.layout, refColWidth: 150, graphColWidth: 0 } })}>Reset columns to default layout</button>
          <button className="btn btn-default" onClick={() => saveSettings({ compactGraph: true, layout: { ...useStore.getState().settings!.layout, refColWidth: 110, graphColWidth: 0 } })}>Reset columns to compact layout</button>
        </span>
      </Row>

      <div className="clone-title mt3">Diff &amp; files</div>
      <Pick k="diffMode" label="Default diff view" options={[['hunk', 'Hunk'], ['inline', 'Inline'], ['split', 'Split']]} />
      <Pick k="fileListMode" label="File list" options={[['path', 'Path'], ['tree', 'Tree']]} />
    </>
  )
}

function EditorSection() {
  const font = useStore((s) => s.settings!.editorFont)
  return (
    <>
      <div className="clone-title">Editor</div>
      <Row label="Font"><input className="form-control" value={font} onChange={(e) => saveSettings({ editorFont: e.target.value })} /></Row>
      <Num k="editorFontSize" label="Font Size" min={8} max={32} />
      <Num k="editorTabSize" label="Tab Size" min={1} max={12} />
      <Pick k="editorEol" label="End of Line Character" options={[['auto', 'Keep the file’s line endings'], ['lf', 'LF'], ['crlf', 'CRLF']]} />
      <Check k="editorSyntax" label="Syntax Highlighting" />
      <Check k="editorLineNumbers" label="Show Line Numbers" />
      <Check k="wordWrap" label="Word Wrap" />
      <Check k="showWhitespace" label="Ignore whitespace changes in diffs" />
    </>
  )
}

function TerminalSection() {
  const font = useStore((s) => s.settings!.terminalFont)
  return (
    <>
      <div className="clone-title">In-App Terminal</div>
      <Row label="Font" help="Changes to this setting will only apply to new tabs or after restarting SuperGit"><input className="form-control" value={font} onChange={(e) => saveSettings({ terminalFont: e.target.value })} /></Row>
      <Num k="terminalFontSize" label="Font Size" min={8} max={32} />
      <Num k="terminalLineHeight" label="Line Height" min={1} max={2} step={0.1} />
      <Pick k="terminalCursor" label="Cursor Style" options={[['block', 'Block'], ['underline', 'Underline'], ['bar', 'Bar']]} />
      <Check k="terminalDimUnfocused" label="Dim terminal when unfocused" />
      <Pick k="terminalShell" label="Default In-App Terminal" options={[['gitbash', 'Git Bash'], ['powershell', 'PowerShell'], ['pwsh', 'PowerShell 7 (pwsh)'], ['cmd', 'Command Prompt']]} help="Changing it restarts the open terminal." />
    </>
  )
}

const EDITOR_PRESETS: Array<[string, string, string]> = [
  ['code', 'Visual Studio Code', 'code'], ['cursor', 'Cursor', 'cursor'], ['windsurf', 'Windsurf', 'windsurf'], ['zed', 'Zed', 'zed'], ['sublime', 'Sublime Text', 'subl'],
  ['atom', 'Atom', 'atom'], ['idea', 'IntelliJ IDEA', 'idea64'], ['pycharm', 'PyCharm', 'pycharm64'], ['rider', 'Rider', 'rider64'], ['vs', 'Visual Studio', 'devenv /Edit']
]
const TERMINAL_PRESETS: Array<[string, string, string]> = [
  ['wt', 'Windows Terminal', ''], ['gitbash', 'Git Bash', '"C:/Program Files/Git/git-bash.exe" --cd={path}'], ['powershell', 'PowerShell', 'start powershell -NoExit -Command "Set-Location -LiteralPath {path}"'],
  ['cmd', 'cmd', 'start cmd /K "cd /d {path}"']
]

function ToolsSection() {
  const settings = useStore((s) => s.settings!)
  const ePreset = settings.editorPreset ?? (EDITOR_PRESETS.find(([, , c]) => c === settings.externalEditor)?.[0] ?? 'custom')
  const tPreset = settings.terminalPreset ?? (TERMINAL_PRESETS.find(([, , c]) => c === settings.externalTerminal)?.[0] ?? (settings.externalTerminal ? 'custom' : 'wt'))
  return (
    <>
      <div className="clone-title">External Tools</div>
      <MergeToolConfig />
      <div className="clone-title mt3">Editor</div>
      <Row label="Editor">
        <select className="form-control" value={ePreset} onChange={(e) => {
          const id = e.target.value
          const p = EDITOR_PRESETS.find(([i]) => i === id)
          saveSettings(p ? { editorPreset: id, externalEditor: p[2] } : { editorPreset: id })
        }}>
          <option value="none">&lt;None&gt;</option>
          {EDITOR_PRESETS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          <option value="custom">&lt;Custom&gt;</option>
        </select>
      </Row>
      {ePreset === 'custom' ? (
        <>
          <Row label="Open File Command" help={<>Use <code>{'{path}'}</code> where the file path goes, for example <code>{'code --goto {path}'}</code>.</>}>
            <input className="form-control" value={settings.editorOpenFileCmd ?? settings.externalEditor} onChange={(e) => saveSettings({ editorOpenFileCmd: e.target.value })} />
          </Row>
          <Row label="Open Repo Command" help={<>Use <code>{'{path}'}</code> where the repository folder goes.</>}>
            <input className="form-control" value={settings.editorOpenRepoCmd ?? ''} onChange={(e) => saveSettings({ editorOpenRepoCmd: e.target.value })} />
          </Row>
        </>
      ) : null}
      <div className="clone-title mt3">Terminal</div>
      <Row label="Terminal">
        <select className="form-control" value={tPreset} onChange={(e) => {
          const id = e.target.value
          const p = TERMINAL_PRESETS.find(([i]) => i === id)
          saveSettings(p ? { terminalPreset: id, externalTerminal: p[2] } : { terminalPreset: id })
        }}>
          {TERMINAL_PRESETS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          <option value="custom">&lt;Custom&gt;</option>
        </select>
      </Row>
      {tPreset === 'custom' ? (
        <Row label="Open Terminal Command" help={<>Command that opens a terminal; <code>{'{path}'}</code> is replaced with the repository folder.</>}>
          <input className="form-control" value={settings.externalTerminal} onChange={(e) => saveSettings({ externalTerminal: e.target.value })} />
        </Row>
      ) : null}
    </>
  )
}

function MergeToolConfig() {
  const [merge, setMerge] = useState('')
  const [diff, setDiff] = useState('')
  useEffect(() => {
    void api.gitConfigGet('merge.tool').then((v) => setMerge(v ?? ''))
    void api.gitConfigGet('diff.tool').then((v) => setDiff(v ?? ''))
  }, [])
  const presets = ['', 'vscode', 'araxis', 'bc', 'bc3', 'kdiff3', 'p4merge', 'meld', 'winmerge', 'tortoisemerge', 'vimdiff']
  const TOOL_NAMES: Record<string, string> = { vscode: 'Visual Studio Code', araxis: 'Araxis Merge', bc: 'Beyond Compare', bc3: 'Beyond Compare 3', kdiff3: 'KDiff3', p4merge: 'P4Merge', meld: 'Meld', winmerge: 'WinMerge', tortoisemerge: 'TortoiseMerge', vimdiff: 'Vimdiff' }
  const setTool = async (kind: 'merge' | 'diff', v: string) => {
    if (kind === 'merge') setMerge(v); else setDiff(v)
    try {
      if (v === 'vscode') {
        await api.gitConfigSet(`${kind}tool.vscode.cmd`, kind === 'merge' ? 'code --wait --merge "$REMOTE" "$LOCAL" "$BASE" "$MERGED"' : 'code --wait --diff "$LOCAL" "$REMOTE"')
      }
      if (v) await api.gitConfigSet(`${kind}.tool`, v)
      else await api.gitConfigUnset(`${kind}.tool`)
    } catch (e) { toast({ kind: 'error', title: 'Could not save git config', message: errMsg(e) }) }
  }
  return (
    <>
      <div className="clone-title mt3">Merge Tool</div>
      <Row label="Merge Tool" help="Sets merge.tool in your global Git Config.">
        <select className="form-control" value={merge} onChange={(e) => setTool('merge', e.target.value)}>
          {[...new Set([...presets, merge])].map((p) => <option key={p} value={p}>{p ? (TOOL_NAMES[p] ?? p) : '<None>'}</option>)}
        </select>
      </Row>
      <div className="clone-title mt3">Diff Tool</div>
      <Row label="Diff Tool" help="Sets diff.tool in your global Git Config.">
        <select className="form-control" value={merge && diff === merge ? '__merge' : diff} onChange={(e) => setTool('diff', e.target.value === '__merge' ? merge : e.target.value)}>
          <option value="">&lt;None&gt;</option>
          {merge ? <option value="__merge">&lt;Use Merge Tool&gt;</option> : null}
          {[...new Set([...presets.filter(Boolean), ...(diff && diff !== merge ? [diff] : [])])].map((p) => <option key={p} value={p}>{TOOL_NAMES[p] ?? p}</option>)}
        </select>
      </Row>
    </>
  )
}

function ProfilesSection() {
  const settings = useStore((s) => s.settings!)
  const [gName, setGName] = useState('')
  const [gEmail, setGEmail] = useState('')
  useEffect(() => {
    void api.gitConfigGet('user.name').then((v) => setGName(v ?? ''))
    void api.gitConfigGet('user.email').then((v) => setGEmail(v ?? ''))
  }, [])
  const update = (id: string, patch: Partial<Profile>) => saveSettings({ profiles: settings.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const add = () => {
    const p: Profile = { id: crypto.randomUUID(), name: `Profile ${settings.profiles.length + 1}`, gitName: '', gitEmail: '' }
    saveSettings({ profiles: [...settings.profiles, p] })
  }
  const remove = (id: string) => saveSettings({ profiles: settings.profiles.filter((p) => p.id !== id), activeProfile: settings.activeProfile === id ? settings.profiles[0].id : settings.activeProfile })
  return (
    <>
      <div className="clone-title">Profiles</div>
      <div className="text-secondary fs-small mb2">Each profile can author commits with its own name and email (a repository's own <code>user.email</code> always takes priority). Leave blank to use your global git identity.</div>
      {settings.profiles.map((p) => (
        <div key={p.id} className={`profile-card${p.id === settings.activeProfile ? ' active' : ''}`}>
          <div className="profile-card-head">
            <input className="form-control profile-name" value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} />
            {p.id === settings.activeProfile ? <span className="pill pill-teal">Active</span> : <button className="btn btn-primary btn-xs" onClick={() => switchProfile(p.id)}>Use this profile</button>}
            {settings.profiles.length > 1 ? <span className="rm-action" title="Delete profile" onClick={() => remove(p.id)}><Icon name="trash" /></span> : null}
          </div>
          <Row label="Author name"><input className="form-control" placeholder={gName || 'from git config'} value={p.gitName} onChange={(e) => update(p.id, { gitName: e.target.value })} /></Row>
          <Row label="Author email"><input className="form-control" placeholder={gEmail || 'from git config'} value={p.gitEmail} onChange={(e) => update(p.id, { gitEmail: e.target.value })} /></Row>
        </div>
      ))}
      <button className="btn btn-success btn-small" onClick={add}><Icon name="plus" /> Add profile</button>
      <Check k="syncGitConfigWithProfile" label="Keep my .gitconfig updated with my profile" help="Switching profiles writes the profile's name and email to your global git config (user.name / user.email)." />
      <div className="clone-title mt3">Global git identity</div>
      <Row label="user.name"><input className="form-control" value={gName} onChange={(e) => setGName(e.target.value)} /></Row>
      <Row label="user.email"><input className="form-control" value={gEmail} onChange={(e) => setGEmail(e.target.value)} /></Row>
      <div className="clone-actions"><button className="btn btn-success btn-small" onClick={async () => {
        try { await api.gitConfigSet('user.name', gName); await api.gitConfigSet('user.email', gEmail); toast({ kind: 'success', title: 'Global git identity saved' }) } catch (e) { toast({ kind: 'error', title: 'Could not save', message: errMsg(e) }) }
      }}>Save global identity</button></div>
    </>
  )
}

function SshSection() {
  const [ssh, setSsh] = useState<SshKey[] | null>(null)
  const [email, setEmail] = useState('')
  const [keyName, setKeyName] = useState('id_ed25519')
  const load = () => {
    void api.sshKeys().then(setSsh)
    void api.gitConfigGet('user.email').then((e) => { if (e) setEmail(e) })
  }
  useEffect(load, [])
  const generate = async () => {
    try {
      const k = await api.sshGenerate(email, keyName)
      await api.copy(k.publicKey)
      toast({ kind: 'success', title: 'SSH key generated', message: `${k.file}\nPublic key copied to the clipboard: add it to your hosting service's SSH keys.` })
      load()
    } catch (e) { toast({ kind: 'error', title: 'Could not generate key', message: errMsg(e) }) }
  }
  return (
    <>
      <div className="clone-title">SSH</div>
      <Check k="sshUseAgent" label="Use local SSH agent" help="Let ssh use the keys loaded in your SSH agent (and ~/.ssh). Turn off to use the private key below." />
      {!useStore.getState().settings!.sshUseAgent ? <SshKeyPaths /> : null}
      {ssh === null ? <div className="text-secondary">Loading…</div> : ssh.length ? ssh.map((k) => (
        <div key={k.file} className="key-row">
          <span className="key-type">{k.type}</span>
          <span className="truncate key-file" title={k.file}>{k.file}</span>
          <span className="text-secondary truncate">{k.comment}</span>
          <button className="btn btn-default btn-xs" onClick={() => { void api.copy(k.publicKey); toast({ kind: 'success', title: 'Public key copied' }, 2000) }}>Copy public key</button>
        </div>
      )) : <div className="text-secondary mb2">No SSH keys in ~/.ssh</div>}
      <Row label="Generate new Private/Public key" right={<button className="btn btn-success" onClick={generate}>Generate</button>}>
        <span className="inline-pair"><input className="form-control" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} /><input className="form-control" placeholder="file name" value={keyName} onChange={(e) => setKeyName(e.target.value)} /></span>
      </Row>
      <GitBool k="credential.helper" label="Use default Git Credential Manager" help="HTTPS sign-ins go through Git Credential Manager (credential.helper=manager)." />
      <GitText k="core.sshCommand" label="SSH command (core.sshCommand)" placeholder="ssh (bundled with Git)" help={<>For example <code>C:/Windows/System32/OpenSSH/ssh.exe</code> to use the Windows OpenSSH agent.</>} />
    </>
  )
}

function SigningSection() {
  const [ssh, setSsh] = useState<SshKey[] | null>(null)
  const [gpg, setGpg] = useState<GpgKey[] | null>(null)
  const [signing, setSigning] = useState({ gpgsign: false, key: '', format: 'openpgp' })
  useEffect(() => {
    void api.sshKeys().then(setSsh)
    void api.gpgKeys().then(setGpg)
    void Promise.all([api.gitConfigGet('commit.gpgsign'), api.gitConfigGet('user.signingkey'), api.gitConfigGet('gpg.format')]).then(([s, k, f]) => {
      setSigning({ gpgsign: s === 'true', key: k ?? '', format: f ?? 'openpgp' })
    })
  }, [])
  const saveSigning = async (patch: Partial<typeof signing>) => {
    const next = { ...signing, ...patch }
    setSigning(next)
    try {
      await api.gitConfigSet('commit.gpgsign', String(next.gpgsign))
      await api.gitConfigSet('gpg.format', next.format)
      if (next.key) await api.gitConfigSet('user.signingkey', next.key)
      else await api.gitConfigUnset('user.signingkey')
    } catch (e) { toast({ kind: 'error', title: 'Could not save signing config', message: errMsg(e) }) }
  }
  return (
    <>
      <div className="clone-title">Commit Signing</div>
      <Row label="GPG Format">
        <select className="form-control" value={signing.format} onChange={(e) => saveSigning({ format: e.target.value })}>
          <option value="openpgp">OPENPGP</option><option value="ssh">SSH</option>
        </select>
      </Row>
      {signing.format === 'openpgp'
        ? <GitText k="gpg.program" label="GPG Program" placeholder="gpg (bundled with Git)" browse="Select gpg.exe" help="Path to gpg.exe, for example Gpg4win's C:/Program Files (x86)/GnuPG/bin/gpg.exe." />
        : <>
          <GitText k="gpg.ssh.program" label="SSH signing program" placeholder="ssh-keygen" browse="Select ssh-keygen.exe" />
          <GitText k="gpg.ssh.allowedSignersFile" label="Allowed signers file" placeholder="(none)" browse="Select allowed signers file" help="Needed to verify SSH signatures (gpg.ssh.allowedSignersFile)." />
        </>}
      <Row label="Signing Key">
        {signing.format === 'ssh' ? (
          <select className="form-control" value={signing.key} onChange={(e) => saveSigning({ key: e.target.value })}>
            <option value="">&lt;None&gt;</option>
            {(ssh ?? []).map((k) => <option key={k.file} value={k.file}>{k.file}</option>)}
          </select>
        ) : (
          <select className="form-control" value={signing.key} onChange={(e) => saveSigning({ key: e.target.value })}>
            <option value="">&lt;None&gt;</option>
            {(gpg ?? []).map((k) => <option key={k.id} value={k.id}>{k.id} — {k.uid}</option>)}
          </select>
        )}
      </Row>
      {signing.format === 'openpgp' && signing.key ? (
        <Row label="Public key" right={<span />}>
          <button className="btn btn-default" onClick={async () => { try { await api.copy(await api.gpgPublicKey(signing.key)); toast({ kind: 'success', title: 'GPG public key copied' }, 2000) } catch (e) { toast({ kind: 'error', title: 'Could not export the key', message: errMsg(e) }) } }}>Copy GPG public key</button>
        </Row>
      ) : null}
      {signing.format === 'openpgp' && gpg && !gpg.length ? <div className="text-secondary fs-small indent-form">No GPG secret keys found (gpg --list-secret-keys).</div> : null}
      <Row label="Sign Commits by Default"><input type="checkbox" checked={signing.gpgsign} onChange={(e) => saveSigning({ gpgsign: e.target.checked })} /></Row>
      <GitBool k="tag.gpgSign" label="Sign Tags by Default" />
    </>
  )
}

// =============================================================================================
// Repository preferences

export function RepoPrefsModal({ path, section }: { path: string; section?: string }) {
  return <PrefsModal repoPath={path} section={`repo:${section ?? 'general'}`} />
}

function RepoSection({ path, tab }: { path: string; tab: string }) {
  return tab === 'gitignore' ? <GitignoreEditor path={path} />
    : tab === 'gitflow' ? <GitflowConfigView path={path} />
      : tab === 'lfs' ? <LfsView path={path} />
        : tab === 'hooks' ? <HooksView path={path} />
          : tab === 'commit' ? <RepoCommit path={path} />
            : tab === 'submodules' ? <RepoSubmodules path={path} />
              : tab === 'sparse' ? <SparseCheckout path={path} />
                : tab === 'encoding' ? <RepoEncoding path={path} />
                : tab === 'conflict' ? <RepoConflictPrefs path={path} />
                  : <RepoGeneral path={path} />
}

function RepoCommit({ path }: { path: string }) {
  const [vals, setVals] = useRepoConfig(path, ['commit.template', 'commit.gpgsign'])
  return (
    <>
      <div className="clone-title">Commit</div>
      <Check k="pushAfterCommit" label="Push after each commit" help="Only when the branch already has an upstream." />
      <Check k="skipHooksDefault" label="Skip git hooks by default when committing" />
      <div className="clone-title mt3">Merge Behavior</div>
      <Check k="mergeSquash" label="Squash" help="When enabled, merging branches locally will stage all changes without creating a merge commit automatically. You will need to commit manually." />
      <div className="clone-title mt3">Commit Template</div>
      <Row label="Template file" right={<button className="btn btn-primary" onClick={async () => { const f = await api.pickOpenFile('Commit template', [{ name: 'Text', extensions: ['txt', 'md', '*'] }]); if (f) setVals({ ...vals, 'commit.template': f }) }}>Browse</button>}
        help="A message template for this repository only (commit.template in .git/config). Leave empty to use the global template.">
        <input className="form-control" placeholder="(uses the global template)" value={vals['commit.template'] ?? ''} onChange={(e) => setVals({ ...vals, 'commit.template': e.target.value })} />
      </Row>
      <Check k="stripComments" label="Remove comments from commit messages" help="Lines starting with # are dropped from the message." />
      <Row label="Sign commits in this repository">
        <select className="form-control" value={vals['commit.gpgsign'] ?? ''} onChange={(e) => setVals({ ...vals, 'commit.gpgsign': e.target.value })}>
          <option value="">Use the global setting</option><option value="true">Always</option><option value="false">Never</option>
        </select>
      </Row>
      <div className="clone-actions"><button className="btn btn-success" onClick={() => saveRepoConfig(path, vals)}>Save Commit Template</button></div>
    </>
  )
}

function RepoSubmodules({ path }: { path: string }) {
  const [vals, setVals] = useRepoConfig(path, ['supergit.updateSubmodules', 'fetch.recurseSubmodules'])
  const global = useStore((s) => s.settings!.updateSubmodules)
  const set = (k: string, v: string) => { const next = { ...vals, [k]: v }; setVals(next); void saveRepoConfig(path, { [k]: v }) }
  return (
    <>
      <div className="clone-title">Submodules</div>
      <Row label="Keep submodules up to date" help="Overrides the global “Keep submodules up to date” setting for this repository.">
        <select className="form-control" value={vals['supergit.updateSubmodules'] ?? ''} onChange={(e) => set('supergit.updateSubmodules', e.target.value)}>
          <option value="">Use global setting ({global ? 'Enabled' : 'Disabled'})</option><option value="true">Enabled for this repo</option><option value="false">Disabled for this repo</option>
        </select>
      </Row>
      <Row label="Fetch submodules" help="When fetching, also fetch submodules (fetch.recurseSubmodules).">
        <select className="form-control" value={vals['fetch.recurseSubmodules'] ?? ''} onChange={(e) => set('fetch.recurseSubmodules', e.target.value)}>
          <option value="">On demand (git default)</option><option value="true">Always</option><option value="false">Never</option>
        </select>
      </Row>
    </>
  )
}

const ENCODINGS = ['UTF-8', 'UTF-16LE', 'UTF-16BE', 'ISO-8859-1', 'ISO-8859-2', 'ISO-8859-15', 'windows-1250', 'windows-1251', 'windows-1252', 'windows-1253', 'windows-1254', 'windows-1257', 'KOI8-R', 'GB18030', 'GBK', 'Big5', 'Shift_JIS', 'EUC-JP', 'EUC-KR', 'ASCII']

function RepoEncoding({ path }: { path: string }) {
  const [vals, setVals] = useRepoConfig(path, ['i18n.commitEncoding', 'gui.encoding'])
  const set = (v: string) => { setVals({ 'i18n.commitEncoding': v, 'gui.encoding': v }); void saveRepoConfig(path, { 'i18n.commitEncoding': v, 'gui.encoding': v === 'UTF-8' ? '' : v }) }
  const cur = vals['i18n.commitEncoding'] ?? ''
  return (
    <>
      <div className="clone-title">Encoding</div>
      <Row label="Repository encoding" help="Default encoding for commit messages and files in this repository (i18n.commitEncoding and gui.encoding in .git/config).">
        <select className="form-control" value={cur} onChange={(e) => set(e.target.value)}>
          <option value="">Default (UTF-8)</option>
          {[...new Set([...ENCODINGS, ...(cur ? [cur] : [])])].map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </Row>
    </>
  )
}

function SparseCheckout({ path }: { path: string }) {
  const [state, setStateLocal] = useState<{ enabled: boolean; patterns: string[] } | null>(null)
  const [text, setText] = useState('')
  const load = () => { void api.sparseCheckout(path).then((s) => { setStateLocal(s); setText(s.patterns.join('\n')) }) }
  useEffect(load, [path])
  const apply = async (patterns: string[] | null) => {
    await A.run(path, () => api.sparseCheckoutSet(path, patterns), { busy: 'Updating sparse checkout', success: patterns ? 'Sparse checkout updated' : 'Sparse checkout turned off', errorTitle: 'Sparse checkout failed' })
    load()
  }
  if (!state) return <div className="text-secondary">Loading…</div>
  return (
    <>
      <div className="clone-title">Sparse Checkout {state.enabled ? <span className="pill pill-teal">Enabled</span> : null}</div>
      <div className="text-secondary fs-small mb2">Only the listed folders (one per line) are checked out in the working directory; the rest of the history stays in the repository.</div>
      <textarea className="form-control code-area" rows={8} placeholder={'src\ndocs'} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="clone-actions">
        {state.enabled ? <button className="btn btn-danger btn-small" onClick={() => apply(null)}>Disable</button> : null}
        <button className="btn btn-success btn-small" disabled={!text.trim()} onClick={() => apply(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))}>{state.enabled ? 'Update' : 'Enable'}</button>
      </div>
    </>
  )
}

function useRepoConfig(path: string, keys: string[]) {
  const [vals, setVals] = useState<Record<string, string>>({})
  useEffect(() => {
    void Promise.all(keys.map((k) => api.gitConfigGet(k, path).then((v) => [k, v ?? ''] as const))).then((r) => setVals(Object.fromEntries(r)))
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps
  return [vals, setVals] as const
}

async function saveRepoConfig(path: string, entries: Record<string, string>) {
  try {
    for (const [k, v] of Object.entries(entries)) {
      if (v.trim()) await api.gitConfigSet(k, v.trim(), path)
      else await api.gitConfigUnset(k, path)
    }
    toast({ kind: 'success', title: 'Repository settings saved' }, 2000)
    void A.refresh(path)
  } catch (e) { toast({ kind: 'error', title: 'Could not save', message: errMsg(e) }) }
}

function RepoGeneral({ path }: { path: string }) {
  const [vals, setVals] = useRepoConfig(path, ['user.name', 'user.email'])
  return (
    <>
      <div className="clone-title">Repository identity</div>
      <div className="text-secondary fs-small mb2">Overrides your profile / global identity for commits in this repository only (stored in .git/config).</div>
      <Row label="Author name"><input className="form-control" placeholder="(not set)" value={vals['user.name'] ?? ''} onChange={(e) => setVals({ ...vals, 'user.name': e.target.value })} /></Row>
      <Row label="Author email"><input className="form-control" placeholder="(not set)" value={vals['user.email'] ?? ''} onChange={(e) => setVals({ ...vals, 'user.email': e.target.value })} /></Row>
      <div className="clone-actions"><button className="btn btn-success btn-small" onClick={() => saveRepoConfig(path, vals)}>Save</button></div>
      <div className="clone-title mt3">Path</div>
      <div className="text-secondary">{path}</div>
    </>
  )
}

function GitignoreEditor({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null)
  const [pattern, setPattern] = useState('')
  useEffect(() => { void api.readFile(path, '.gitignore').then(setText) }, [path])
  const save = async (content: string) => {
    await A.run(path, () => api.writeFile(path, '.gitignore', content), { success: '.gitignore saved' })
    setText(content)
  }
  if (text === null) return <div className="text-secondary">Loading…</div>
  return (
    <>
      <div className="clone-title">.gitignore</div>
      <div className="inline-pair mb2">
        <input className="form-control" placeholder="Add pattern, e.g. *.log or build/" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && pattern.trim()) { void save(`${text.replace(/\s*$/, '')}\n${pattern.trim()}\n`.replace(/^\n/, '')); setPattern('') } }} />
        <button className="btn btn-success btn-small" disabled={!pattern.trim()} onClick={() => { void save(`${text.replace(/\s*$/, '')}\n${pattern.trim()}\n`.replace(/^\n/, '')); setPattern('') }}>Add</button>
      </div>
      <textarea className="form-control code-area" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="clone-actions"><button className="btn btn-success btn-small" onClick={() => save(text)}>Save .gitignore</button></div>
    </>
  )
}

function GitflowConfigView({ path }: { path: string }) {
  const snap = useStore((s) => s.repos[path]?.snapshot)
  const gf = snap?.gitflow
  const [cfg, setCfg] = useState(() => ({ master: gf?.master ?? 'main', develop: gf?.develop ?? 'develop', feature: gf?.feature ?? 'feature/', release: gf?.release ?? 'release/', hotfix: gf?.hotfix ?? 'hotfix/', versionTag: gf?.versionTag ?? '' }))
  useEffect(() => {
    if (!gf?.initialized && snap?.refs.some((r) => r.short === 'master' && r.type === 'head') && !snap.refs.some((r) => r.short === 'main' && r.type === 'head')) setCfg((c) => ({ ...c, master: 'master' }))
  }, [gf?.initialized, snap?.refs])
  const field = (k: keyof typeof cfg, label: string) => <Row label={label}><input className="form-control" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} /></Row>
  return (
    <>
      <div className="clone-title">Gitflow {gf?.initialized ? <span className="pill pill-teal">Initialized</span> : null}</div>
      <div className="clone-title mt3">Branches</div>
      {field('master', 'Main/Master')}
      {field('develop', 'Develop')}
      <div className="clone-title mt3">Prefixes</div>
      {field('feature', 'Feature')}
      {field('release', 'Release')}
      {field('hotfix', 'Hotfix')}
      {field('versionTag', 'Version Tag')}
      <div className="clone-actions">
        <button className="btn btn-success btn-small" onClick={() => A.run(path, () => api.gitflowInit(path, cfg), { success: gf?.initialized ? 'Gitflow settings saved' : 'Gitflow initialized', errorTitle: 'Gitflow init failed' })}>{gf?.initialized ? 'Save' : 'Initialize Gitflow'}</button>
      </div>
    </>
  )
}

function LfsView({ path }: { path: string }) {
  const [info, setInfo] = useState<LfsInfo | null>(null)
  const [pattern, setPattern] = useState('')
  const load = () => { void api.lfsInfo(path).then(setInfo) }
  useEffect(load, [path])
  const act = async (fn: () => Promise<unknown>, success?: string) => { await A.run(path, fn, { success, busy: 'Git LFS' }); load() }
  if (!info) return <div className="text-secondary">Loading…</div>
  if (!info.installed) return <><div className="clone-title">Git LFS</div><div className="text-secondary">Git LFS is not installed. Install it from https://git-lfs.com and restart SuperGit.</div></>
  return (
    <>
      <div className="clone-title">Git LFS {info.enabled ? <span className="pill pill-teal">Enabled</span> : null}</div>
      {!info.enabled ? <div className="clone-actions" style={{ justifyContent: 'flex-start' }}><button className="btn btn-success btn-small" onClick={() => act(() => api.lfsInstall(path), 'Git LFS initialized for this repository')}>Initialize LFS</button></div> : null}
      <div className="form-label mb1">Tracked patterns (.gitattributes)</div>
      <div className="lfs-patterns">
        {info.patterns.length ? info.patterns.map((p) => (
          <div key={p} className="key-row"><code className="grow">{p}</code><button className="btn btn-danger btn-xs" onClick={() => act(() => api.lfsUntrack(path, p))}>Untrack</button></div>
        )) : <div className="text-secondary">No patterns tracked.</div>}
      </div>
      <div className="inline-pair mt2">
        <input className="form-control" placeholder="Pattern, e.g. *.psd" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        <button className="btn btn-success btn-small" disabled={!pattern.trim()} onClick={() => { void act(() => api.lfsTrack(path, pattern.trim())); setPattern('') }}>Track</button>
      </div>
      <div className="clone-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-default btn-small" onClick={() => act(() => api.lfsCommand(path, 'fetch'), 'LFS fetch complete')}>LFS Fetch</button>
        <button className="btn btn-default btn-small" onClick={() => act(() => api.lfsCommand(path, 'pull'), 'LFS pull complete')}>LFS Pull</button>
        <button className="btn btn-default btn-small" onClick={() => act(() => api.lfsCommand(path, 'prune'), 'LFS prune complete')}>LFS Prune</button>
      </div>
    </>
  )
}

function HooksView({ path }: { path: string }) {
  const [vals, setVals] = useRepoConfig(path, ['core.hooksPath', 'commit.template'])
  return (
    <>
      <div className="clone-title">Hooks &amp; commit template</div>
      <Row label="Hooks path (core.hooksPath)" right={<button className="btn btn-primary btn-small" onClick={async () => { const d = await api.pickDirectory('Hooks folder', path); if (d) setVals({ ...vals, 'core.hooksPath': d }) }}>Browse</button>}>
        <input className="form-control" placeholder=".git/hooks (default)" value={vals['core.hooksPath'] ?? ''} onChange={(e) => setVals({ ...vals, 'core.hooksPath': e.target.value })} />
      </Row>
      <Row label="Commit template file" right={<button className="btn btn-primary btn-small" onClick={async () => { const f = await api.pickOpenFile('Commit template', [{ name: 'Text', extensions: ['txt', 'md', '*'] }]); if (f) setVals({ ...vals, 'commit.template': f }) }}>Browse</button>}>
        <input className="form-control" placeholder="(none)" value={vals['commit.template'] ?? ''} onChange={(e) => setVals({ ...vals, 'commit.template': e.target.value })} />
      </Row>
      <div className="text-secondary fs-small indent-form mb2">The template pre-fills the commit message box. Hooks run normally; use "Skip hooks" in Commit options to bypass them for one commit.</div>
      <div className="clone-actions"><button className="btn btn-success btn-small" onClick={() => saveRepoConfig(path, vals)}>Save</button></div>
    </>
  )
}

export { ShortcutsModal } from './ShortcutsModal'
