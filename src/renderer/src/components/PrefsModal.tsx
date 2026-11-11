import { useEffect, useState, type ReactNode } from 'react'
import { useStore, closeModal, toast } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { saveSettings, switchProfile } from '../actions2'
import { errMsg } from '../lib/format'
import { setMonacoTheme } from '../lib/monaco'
import { setGraphTheme } from '../graph/colors'
import { Icon } from './Icon'
import { IntegrationsSection } from './Integrations'
import type { PullMode, Settings, SshKey, GpgKey, LfsInfo, Profile } from '@shared/types'

function Frame({ title, nav, tab, setTab, children }: { title: string; nav: Array<[string, string, string]>; tab: string; setTab: (t: string) => void; children: ReactNode }) {
  return (
    <div className="modal prefs-modal">
      <div className="modal-header"><span>{title}</span><span className="modal-close" onClick={closeModal}><Icon name="times" /></span></div>
      <div className="clone-layout">
        <div className="clone-nav">
          {nav.map(([id, label, icon]) => (
            <div key={id} className={`clone-nav-item${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}><Icon name={icon} /> {label}</div>
          ))}
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
function Check<K extends keyof Settings>({ k, label, help }: { k: K; label: string; help?: ReactNode }) {
  const v = useStore((s) => s.settings![k]) as boolean
  return <Row label={label} help={help}><input type="checkbox" checked={v} onChange={(e) => saveSettings({ [k]: e.target.checked } as Partial<Settings>)} /></Row>
}

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

function GitBool({ k, label, help, defaultOn = false }: { k: string; label: string; help?: ReactNode; defaultOn?: boolean }) {
  const [v, set] = useGlobalGit(k)
  const on = v === '' ? defaultOn : v === 'true'
  return <Row label={label} help={help}><input type="checkbox" checked={on} onChange={(e) => set(String(e.target.checked))} /></Row>
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

export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme
  setGraphTheme(theme)
  setMonacoTheme(theme)
}

// =============================================================================================
// Application preferences

const NAV: Array<[string, string, string]> = [
  ['general', 'General', 'cog'], ['ui', 'UI Customization', 'eye'], ['profiles', 'Profiles', 'user'], ['integrations', 'Integrations', 'link'],
  ['commit', 'Commit', 'commit'], ['signing', 'Commit Signing', 'check-circle'], ['ssh', 'SSH', 'key'], ['editor', 'Editor', 'file-lines'],
  ['terminal', 'In-App Terminal', 'terminal'], ['tools', 'External Tools', 'external']
]
const LEGACY_SECTIONS: Record<string, string> = { azure: 'integrations', keys: 'ssh', appearance: 'ui' }

export function PrefsModal({ section }: { section?: string }) {
  const [tab, setTab] = useState(LEGACY_SECTIONS[section ?? ''] ?? section ?? 'general')
  return (
    <Frame title="Preferences" tab={tab} setTab={setTab} nav={NAV}>
      {tab === 'general' ? <GeneralSection />
        : tab === 'ui' ? <UiSection />
          : tab === 'profiles' ? <ProfilesSection />
            : tab === 'integrations' ? <IntegrationsSection />
              : tab === 'commit' ? <CommitSection />
                : tab === 'signing' ? <SigningSection />
                  : tab === 'ssh' ? <SshSection />
                    : tab === 'editor' ? <EditorSection />
                      : tab === 'terminal' ? <TerminalSection />
                        : <ToolsSection />}
    </Frame>
  )
}

function GeneralSection() {
  const settings = useStore((s) => s.settings!)
  const [autocrlf, setAutocrlf] = useGlobalGit('core.autocrlf')
  const [git, setGit] = useState<{ path: string; version: string } | null>(null)
  const [gitPath, setGitPath] = useState(settings.gitPath)
  useEffect(() => { void api.gitInfo().then(setGit) }, [settings.gitPath])
  const browseGit = async () => {
    const f = await api.pickOpenFile('Select git.exe', [{ name: 'git', extensions: ['exe'] }])
    if (f) { setGitPath(f); saveSettings({ gitPath: f }) }
  }
  return (
    <>
      <div className="clone-title">General</div>
      <Row label="Default clone / init folder" right={<button className="btn btn-primary btn-small" onClick={async () => { const d = await api.pickDirectory('Default folder', settings.defaultCloneDir); if (d) saveSettings({ defaultCloneDir: d }) }}>Browse</button>}>
        <input className="form-control" value={settings.defaultCloneDir} onChange={(e) => saveSettings({ defaultCloneDir: e.target.value })} />
      </Row>
      <Num k="autoFetchMinutes" label="Auto-Fetch Interval (minutes)" min={0} max={60} help="0 turns automatic fetching off." />
      <Check k="autoPrune" label="Auto-Prune" help="Remove remote-tracking branches that were deleted on the remote when fetching." />
      <Row label="Default pull behaviour">
        <select className="form-control" value={settings.defaultPullMode} onChange={(e) => saveSettings({ defaultPullMode: e.target.value as PullMode })}>
          <option value="fetch">Fetch All</option><option value="ff">Pull (fast-forward if possible)</option><option value="ff-only">Pull (fast-forward only)</option><option value="rebase">Pull (rebase)</option>
        </select>
      </Row>
      <Num k="commitLimit" label="Initial Commits in Graph" min={200} max={100000} step={500} help="More commits load from the bottom of the graph. Large values can slow the graph down." />
      <GitText k="init.defaultBranch" label="Default Branch Name" placeholder="master (git default)" help="The first branch of new repositories (init.defaultBranch in your global git config)." />
      <Check k="rememberTabs" label="Remember tabs" help="Reopen the repositories that were open when SuperGit closed." />
      <Check k="updateSubmodules" label="Keep submodules up to date" help="Update all submodules after checkouts, pulls, merges and other actions that move HEAD." />
      <GitBool k="mergetool.keepBackup" label="Keep .orig files after merging" defaultOn help="Turn off to delete the .orig backups that git's merge tool leaves behind (mergetool.keepBackup)." />

      <div className="clone-title mt3">Git</div>
      <Row label="Line endings (core.autocrlf)" help="Sets core.autocrlf in your global git config.">
        <select className="form-control" value={autocrlf} onChange={(e) => setAutocrlf(e.target.value)}>
          <option value="">Git config default</option>
          <option value="true">true (check out CRLF, commit LF)</option>
          <option value="input">input (commit LF)</option>
          <option value="false">false (no conversion)</option>
        </select>
      </Row>
      <GitBool k="core.longpaths" label="Long paths" help="Allow paths longer than 260 characters on Windows (core.longpaths)." />
      <Row label="Git executable" right={<button className="btn btn-primary btn-small" onClick={browseGit}>Browse</button>}
        help={git ? <>Using <code>{git.path}</code> (git {git.version || 'not found'})</> : null}>
        <input className="form-control" placeholder="Auto-detect" value={gitPath} onChange={(e) => setGitPath(e.target.value)} onBlur={() => { if (gitPath.trim() !== settings.gitPath) saveSettings({ gitPath: gitPath.trim() }) }} />
      </Row>
    </>
  )
}

const COLUMN_LABELS = { ref: 'Branch / Tag', graph: 'Graph', message: 'Commit message', author: 'Author', date: 'Date / Time', sha: 'SHA', changes: 'Changes' } as const

function UiSection() {
  const settings = useStore((s) => s.settings!)
  return (
    <>
      <div className="clone-title">UI Customization</div>
      <Row label="Theme">
        <div className="btn-group toggle-group">
          {(['dark', 'light'] as const).map((t) => (
            <button key={t} className={`toggle-btn${settings.theme === t ? ' checked' : ''}`} onClick={() => { saveSettings({ theme: t }); void api.setTheme(t); applyTheme(t) }}>{t === 'dark' ? 'Dark' : 'Light'}</button>
          ))}
        </div>
      </Row>
      <Row label="Zoom">
        <span className="zoom-row">
          <button className="btn btn-default btn-small" onClick={() => api.setZoom(settings.zoom - 0.1)}>−</button>
          <span>{Math.round(settings.zoom * 100)}%</span>
          <button className="btn btn-default btn-small" onClick={() => api.setZoom(settings.zoom + 0.1)}>+</button>
        </span>
      </Row>
      <Check k="showToolbarLabels" label="Show toolbar icon labels" />
      <Pick k="toastPosition" label="Notification location" options={[['bottom-left', 'Bottom Left'], ['bottom-right', 'Bottom Right'], ['top-left', 'Top Left'], ['top-right', 'Top Right']]} />
      <Pick k="dateFormat" label="Date format" options={[['locale', 'System locale'], ['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY'], ['ymd', 'YYYY-MM-DD']]} />
      <Pick k="clock" label="Time format" options={[['24h', '24-hour (14:30)'], ['12h', '12-hour (2:30 PM)']]} />
      <Check k="spellcheck" label="Enable spell checking" help="In the commit summary and description." />

      <div className="clone-title mt3">Graph</div>
      <Row label="Columns">
        <span className="check-list">
          {(Object.keys(COLUMN_LABELS) as Array<keyof typeof COLUMN_LABELS>).map((c) => (
            <label key={c} className="form-check"><input type="checkbox" checked={settings.graphColumns[c]} onChange={(e) => saveSettings({ graphColumns: { ...settings.graphColumns, [c]: e.target.checked } })} /> {COLUMN_LABELS[c]}</label>
          ))}
        </span>
      </Row>
      <Row label="Show in graph">
        <span className="check-list">
          {(['remotes', 'tags', 'stashes'] as const).map((c) => (
            <label key={c} className="form-check"><input type="checkbox" checked={settings.graphShow[c]} onChange={(e) => saveSettings({ graphShow: { ...settings.graphShow, [c]: e.target.checked } })} /> {c[0].toUpperCase() + c.slice(1)}</label>
          ))}
        </span>
      </Row>
      <Pick k="commitDescription" label="Show commit description in graph" options={[['always', 'Always'], ['hover', 'On hover'], ['never', 'Never']]} />
      <Check k="ghostRefs" label="Show ghost branch / tag when hovering or selecting a commit" />
      <Check k="highlightOnRefHover" label="Highlight associated rows when hovering over a branch" />
      <Check k="authorInitials" label="Display author initials instead of avatars" />
      <Check k="compactGraph" label="Compact graph column" />

      <div className="clone-title mt3">Diff &amp; files</div>
      <Pick k="diffMode" label="Default diff view" options={[['hunk', 'Hunk'], ['inline', 'Inline'], ['split', 'Split']]} />
      <Pick k="fileListMode" label="File list" options={[['path', 'Path'], ['tree', 'Tree']]} />
    </>
  )
}

function CommitSection() {
  return (
    <>
      <div className="clone-title">Commit</div>
      <Check k="pushAfterCommit" label="Push after each commit" help="Only when the branch already has an upstream." />
      <Check k="skipHooksDefault" label="Skip git hooks by default when committing" help="Pre-selects “Skip git hooks” in the commit options." />
      <Check k="stripComments" label="Remove comments from commit messages" help="Lines starting with # are dropped from the message." />
      <GitText k="commit.template" label="Global commit template" placeholder="(none)" browse="Select commit template" help="Sets commit.template in your global git config. A repository's own template (Repository Preferences) takes priority." />
    </>
  )
}

function EditorSection() {
  const font = useStore((s) => s.settings!.editorFont)
  return (
    <>
      <div className="clone-title">Editor</div>
      <Row label="Font"><input className="form-control" value={font} onChange={(e) => saveSettings({ editorFont: e.target.value })} /></Row>
      <Num k="editorFontSize" label="Font size" min={8} max={32} />
      <Num k="editorTabSize" label="Tab size" min={1} max={12} />
      <Check k="wordWrap" label="Word wrap" />
      <Check k="editorLineNumbers" label="Show line numbers" />
      <Check k="editorSyntax" label="Syntax highlighting" />
      <Check k="showWhitespace" label="Ignore whitespace changes in diffs" />
      <Pick k="editorEol" label="End of line when editing files" options={[['auto', 'Keep the file’s line endings'], ['lf', 'LF'], ['crlf', 'CRLF']]} />
    </>
  )
}

function TerminalSection() {
  const font = useStore((s) => s.settings!.terminalFont)
  return (
    <>
      <div className="clone-title">In-App Terminal</div>
      <Pick k="terminalShell" label="Default in-app terminal" options={[['powershell', 'Windows PowerShell'], ['pwsh', 'PowerShell 7 (pwsh)'], ['cmd', 'Command Prompt'], ['gitbash', 'Git Bash']]} help="Changing it restarts the open terminal." />
      <Row label="Font"><input className="form-control" value={font} onChange={(e) => saveSettings({ terminalFont: e.target.value })} /></Row>
      <Num k="terminalFontSize" label="Font size" min={8} max={32} />
      <Num k="terminalLineHeight" label="Line height" min={1} max={2} step={0.1} />
      <Pick k="terminalCursor" label="Cursor style" options={[['block', 'Block'], ['underline', 'Underline'], ['bar', 'Bar']]} />
      <Check k="terminalDimUnfocused" label="Dim terminal when unfocused" />
    </>
  )
}

function ToolsSection() {
  const settings = useStore((s) => s.settings!)
  return (
    <>
      <div className="clone-title">External Tools</div>
      <Row label="External editor" help={<>Run as <code>{'<command> "<file>"'}</code>. Examples: <code>code</code>, <code>notepad++</code>, <code>rider64</code>, <code>devenv /Edit</code>.</>}>
        <input className="form-control" placeholder="code" value={settings.externalEditor} onChange={(e) => saveSettings({ externalEditor: e.target.value })} />
      </Row>
      <Row label="External terminal" help={<>Command that opens a terminal; <code>{'{path}'}</code> is replaced with the repository folder. Empty uses Windows Terminal (or PowerShell). Examples: <code>{'wt -d {path}'}</code>, <code>{'"C:/Program Files/Git/git-bash.exe" --cd={path}'}</code>.</>}>
        <input className="form-control" placeholder="Windows Terminal" value={settings.externalTerminal} onChange={(e) => saveSettings({ externalTerminal: e.target.value })} />
      </Row>
      <MergeToolConfig />
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
  const presets = ['', 'vscode', 'vimdiff', 'kdiff3', 'meld', 'bc', 'p4merge', 'winmerge', 'tortoisemerge']
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
      <Row label="External merge tool (merge.tool)">
        <select className="form-control" value={merge} onChange={(e) => setTool('merge', e.target.value)}>
          {[...new Set([...presets, merge])].map((p) => <option key={p} value={p}>{p || '(none)'}</option>)}
        </select>
      </Row>
      <Row label="External diff tool (diff.tool)">
        <select className="form-control" value={diff} onChange={(e) => setTool('diff', e.target.value)}>
          {[...new Set([...presets, diff])].map((p) => <option key={p} value={p}>{p || '(none)'}</option>)}
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
      {ssh === null ? <div className="text-secondary">Loading…</div> : ssh.length ? ssh.map((k) => (
        <div key={k.file} className="key-row">
          <span className="key-type">{k.type}</span>
          <span className="truncate key-file" title={k.file}>{k.file}</span>
          <span className="text-secondary truncate">{k.comment}</span>
          <button className="btn btn-default btn-xs" onClick={() => { void api.copy(k.publicKey); toast({ kind: 'success', title: 'Public key copied' }, 2000) }}>Copy public key</button>
        </div>
      )) : <div className="text-secondary mb2">No SSH keys in ~/.ssh</div>}
      <Row label="Generate new key" right={<button className="btn btn-success btn-small" onClick={generate}>Generate</button>}>
        <span className="inline-pair"><input className="form-control" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} /><input className="form-control" placeholder="file name" value={keyName} onChange={(e) => setKeyName(e.target.value)} /></span>
      </Row>
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
      <Row label="Sign commits by default"><input type="checkbox" checked={signing.gpgsign} onChange={(e) => saveSigning({ gpgsign: e.target.checked })} /></Row>
      <GitBool k="tag.gpgSign" label="Sign tags by default" />
      <Row label="Signing format">
        <select className="form-control" value={signing.format} onChange={(e) => saveSigning({ format: e.target.value })}>
          <option value="openpgp">GPG (openpgp)</option><option value="ssh">SSH</option>
        </select>
      </Row>
      <Row label="Signing key">
        {signing.format === 'ssh' ? (
          <select className="form-control" value={signing.key} onChange={(e) => saveSigning({ key: e.target.value })}>
            <option value="">(none)</option>
            {(ssh ?? []).map((k) => <option key={k.file} value={k.file}>{k.file}</option>)}
          </select>
        ) : (
          <select className="form-control" value={signing.key} onChange={(e) => saveSigning({ key: e.target.value })}>
            <option value="">(default key)</option>
            {(gpg ?? []).map((k) => <option key={k.id} value={k.id}>{k.id} — {k.uid}</option>)}
          </select>
        )}
      </Row>
      {signing.format === 'openpgp' && gpg && !gpg.length ? <div className="text-secondary fs-small indent-form">No GPG secret keys found (gpg --list-secret-keys).</div> : null}
      {signing.format === 'openpgp'
        ? <GitText k="gpg.program" label="GPG program" placeholder="gpg (bundled with Git)" browse="Select gpg.exe" help="Path to gpg.exe, for example Gpg4win's C:/Program Files (x86)/GnuPG/bin/gpg.exe." />
        : <>
          <GitText k="gpg.ssh.program" label="SSH signing program" placeholder="ssh-keygen" browse="Select ssh-keygen.exe" />
          <GitText k="gpg.ssh.allowedSignersFile" label="Allowed signers file" placeholder="(none)" browse="Select allowed signers file" help="Needed to verify SSH signatures (gpg.ssh.allowedSignersFile)." />
        </>}
    </>
  )
}

// =============================================================================================
// Repository preferences

export function RepoPrefsModal({ path, section }: { path: string; section?: string }) {
  const [tab, setTab] = useState(section ?? 'general')
  return (
    <Frame title={`Repository Preferences — ${path.split(/[\\/]/).pop()}`} tab={tab} setTab={setTab} nav={[
      ['general', 'General', 'cog'], ['gitignore', '.gitignore', 'file-lines'], ['gitflow', 'Gitflow', 'merge'], ['lfs', 'Git LFS', 'download'], ['hooks', 'Hooks & Template', 'commit']
    ]}>
      {tab === 'general' ? <RepoGeneral path={path} /> : tab === 'gitignore' ? <GitignoreEditor path={path} /> : tab === 'gitflow' ? <GitflowConfigView path={path} /> : tab === 'lfs' ? <LfsView path={path} /> : <HooksView path={path} />}
    </Frame>
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
      <div className="text-secondary fs-small mb2">Gitflow is implemented with plain git commands — no extra tools needed. Once initialized, a GITFLOW section appears in the left panel.</div>
      {field('master', 'Production branch')}
      {field('develop', 'Development branch')}
      {field('feature', 'Feature prefix')}
      {field('release', 'Release prefix')}
      {field('hotfix', 'Hotfix prefix')}
      {field('versionTag', 'Version tag prefix')}
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

// =============================================================================================

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+P', 'Command palette / fuzzy finder (files, branches, commands)'],
  ['Ctrl+F', 'Search commits'],
  ['Ctrl+Enter', 'Commit (in the commit message)'],
  ['Ctrl+Shift+S / Ctrl+Shift+U', 'Stage all / unstage all'],
  ['Ctrl+Shift+M', 'Focus the commit message'],
  ['Ctrl+B', 'Create branch'],
  ['Ctrl+L', 'Fetch all'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+`', 'Toggle terminal'],
  ['Ctrl+T', 'Repository management'],
  ['Ctrl+W / Ctrl+Shift+T', 'Close tab / reopen closed tab'],
  ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous tab'],
  ['Ctrl+J / Ctrl+K', 'Show or hide the left panel / commit details panel'],
  ['Ctrl+1 … Ctrl+9', 'Go to tab 1 … 9'],
  ['Ctrl+Alt+1 … Ctrl+Alt+9', 'Open favorite repository 1 … 9'],
  ['Ctrl+N / Ctrl+I / Ctrl+O', 'Clone / init / open a repository'],
  ['Ctrl+Shift+E', 'Open the repository in the external editor'],
  ['Alt+T / Alt+O', 'Open an external terminal / the file manager here'],
  ['Ctrl+Shift+F or F11', 'Full screen'],
  ['Ctrl+, ', 'Preferences'],
  ['Ctrl+= / Ctrl+- / Ctrl+0', 'Zoom in / out / reset'],
  ['↑ / ↓ (graph)', 'Move selection, Shift to extend'],
  ['Esc', 'Close diff / search'],
  ['Ctrl+/', 'This list']
]

export function ShortcutsModal() {
  return (
    <div className="modal" style={{ width: 560 }}>
      <div className="modal-header"><span>Keyboard Shortcuts</span><span className="modal-close" onClick={closeModal}><Icon name="times" /></span></div>
      <div className="modal-body">
        {SHORTCUTS.map(([k, d]) => <div key={k} className="shortcut-row"><kbd>{k}</kbd><span>{d}</span></div>)}
      </div>
    </div>
  )
}
