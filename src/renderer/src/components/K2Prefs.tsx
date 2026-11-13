import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore, toast, showPrompt } from '../store'
import { api } from '../lib/api'
import { errMsg } from '../lib/format'
import { k2Of, saveK2 } from './ConflictDetection'
import '../styles/k2.css'

const Row = ({ label, children, help }: { label: string; children: ReactNode; help?: ReactNode }) => (
  <>
    <div className="form-grid-row"><span className="form-label">{label}</span>{children}<span /></div>
    {help ? <div className="text-secondary fs-small indent-form pref-help">{help}</div> : null}
  </>
)

/** Preferences > General: "Forget all Usernames and Passwords" and the global conflict detection switch, like the original */
export function K2GeneralPrefs() {
  const k2 = useStore((s) => k2Of(s.settings))
  const [busy, setBusy] = useState(false)
  const forget = () => showPrompt({
    kind: 'confirm', message: 'Forget all usernames and passwords stored for the remotes of your repositories?',
    buttons: [{
      label: 'Forget All', style: 'danger', run: async () => {
        setBusy(true)
        try {
          const n = await api.forgetCredentials()
          toast(n ? { kind: 'success', title: 'Credentials removed', message: `Forgot the stored credentials of ${n} host${n === 1 ? '' : 's'}.` } : { kind: 'info', title: 'SuperGit has no stored user/pass credentials to remove' })
        } catch (e) { toast({ kind: 'error', title: 'Could not remove credentials', message: errMsg(e) }) } finally { setBusy(false) }
      }
    }]
  })
  return (
    <>
      <Row label="Forget all Usernames and Passwords" help="Removes the usernames and passwords git's credential manager stored for the https remotes of your repositories.">
        <span><button className="btn btn-danger btn-small" disabled={busy} onClick={forget}>Forget All</button></span>
      </Row>
      <Row label="Enable proactive conflict detection with target branch" help="Unchecking this will disable proactive conflict detection for all repositories. You can disable an individual repository from Repo-Specific Preferences.">
        <input type="checkbox" checked={k2.conflictDetection !== false} onChange={(e) => saveK2((k) => ({ ...k, conflictDetection: e.target.checked }), k2)} />
      </Row>
    </>
  )
}

/** Repo-Specific Preferences > Conflict Prevention */
export function RepoConflictPrefs({ path }: { path: string }) {
  const k2 = useStore((s) => k2Of(s.settings))
  const repo = k2.repoConflict?.[path] ?? {}
  const global = k2.conflictDetection !== false
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const [text, setText] = useState((repo.rules ?? []).join('\n'))
  const timer = useRef(0)
  const latest = useRef(k2)
  latest.current = k2
  const pending = useRef<(() => void) | null>(null)
  // leaving the page right after typing still saves the rules
  useEffect(() => () => { window.clearTimeout(timer.current); pending.current?.() }, [])
  const setRepo = (patch: { enabled?: boolean; rules?: string[] }) =>
    saveK2((k) => ({ ...k, repoConflict: { ...k.repoConflict, [path]: { ...(k.repoConflict?.[path] ?? {}), ...patch } } }), latest.current)
  const onRules = (v: string) => {
    setText(v)
    window.clearTimeout(timer.current)
    pending.current = () => { pending.current = null; setRepo({ rules: v.split('\n').map((l) => l.trim()).filter(Boolean) }) }
    timer.current = window.setTimeout(() => pending.current?.(), 250)
  }
  const ex = (pattern: string, details: ReactNode) => <><code>{pattern}</code><i>{details}</i></>
  return (
    <>
      <div className="clone-title">Conflict Prevention</div>
      <div className="text-secondary mb2">SuperGit can automatically compare your branch against its "Base" branch to see if any conflicts arise while you're working.</div>
      <Row label="Enable proactive conflict detection with target branch"
        help={global ? <>Unchecking this will disable proactive conflict detection only for {name}.<br />To disable it globally, go to Preferences &gt; General.</> : 'Globally disabled for all repositories. To re-enable, go to Preferences > General.'}>
        <input type="checkbox" checked={global && repo.enabled !== false} disabled={!global} onChange={(e) => setRepo({ enabled: e.target.checked })} />
      </Row>
      <Row label="Base branches" help="(1 per line)">
        <textarea className="form-control k2-rules" spellCheck={false} placeholder="**" value={text} onChange={(e) => onRules(e.target.value)} />
      </Row>
      <div className="indent-form">
        <p>When looking for conflicts, SuperGit will try to determine which "base branch" your active branch started from. You can improve its accuracy by limiting which branches are considered as a possible base branch.</p>
        <div className="k2-rule-examples">
          {ex('origin/main', <>include a single branch ( <code>main</code> ) on <code>origin</code></>)}
          {ex('origin/**', <>include all branches on <code>origin</code></>)}
          {ex('origin/feature/**', <>include branches on <code>origin</code> which begin with <code>feature/</code></>)}
          {ex('!origin/abc', <>exclude a single branch ( <code>abc</code> ) on <code>origin</code></>)}
        </div>
      </div>
    </>
  )
}
