// Hosting service integrations: "click to connect" through Git Credential Manager's browser sign-in,
// with a personal access token as the fallback, plus the repository browser used by the Clone dialog.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore, setState, toast } from '../store'
import { api } from '../lib/api'
import { errMsg } from '../lib/format'
import { Icon } from './Icon'
import type { ProviderId, HostedRepo } from '@shared/types'

export interface ProviderMeta {
  id: ProviderId
  name: string
  icon: string
  /** fixed host for the cloud services */
  host?: string
  selfHosted?: boolean
  /** Azure DevOps asks for the organization */
  org?: boolean
  /** Bitbucket API tokens authenticate with the account email */
  needsUsername?: boolean
  tokenUrl: (host: string) => string
  tokenHelp: string
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'github', name: 'GitHub', icon: 'github', host: 'github.com', tokenUrl: () => 'https://github.com/settings/tokens/new?scopes=repo,read:user&description=SuperGit', tokenHelp: 'a classic token with the repo and read:user scopes' },
  { id: 'gitlab', name: 'GitLab', icon: 'gitlab', host: 'gitlab.com', tokenUrl: () => 'https://gitlab.com/-/user_settings/personal_access_tokens?name=SuperGit&scopes=read_api,read_user,write_repository', tokenHelp: 'the read_api, read_user and write_repository scopes' },
  { id: 'bitbucket', name: 'Bitbucket', icon: 'bitbucket', host: 'bitbucket.org', needsUsername: true, tokenUrl: () => 'https://id.atlassian.com/manage-profile/security/api-tokens', tokenHelp: 'an Atlassian API token with Bitbucket repository read and write scopes (use your Atlassian account email as the username)' },
  { id: 'azure', name: 'Azure DevOps', icon: 'ado', org: true, tokenUrl: (org) => `${org}/_usersSettings/tokens`, tokenHelp: 'the Code (Read & Write) scope' },
  { id: 'github-enterprise', name: 'GitHub Enterprise', icon: 'github', selfHosted: true, tokenUrl: (h) => `https://${h}/settings/tokens/new?scopes=repo,read:user&description=SuperGit`, tokenHelp: 'a classic token with the repo and read:user scopes' },
  { id: 'gitlab-self', name: 'GitLab Self-Managed', icon: 'gitlab', selfHosted: true, tokenUrl: (h) => `https://${h}/-/user_settings/personal_access_tokens?name=SuperGit&scopes=read_api,read_user,write_repository`, tokenHelp: 'the read_api, read_user and write_repository scopes' },
  { id: 'bitbucket-server', name: 'Bitbucket Data Center', icon: 'bitbucket', selfHosted: true, tokenUrl: (h) => `https://${h}/plugins/servlet/access-tokens/manage`, tokenHelp: 'an HTTP access token with repository write permission' }
]

export const providerMeta = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!

const orgUrl = (s: string) => {
  const t = s.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(t) ? t : /^[\w.-]+$/.test(t) ? `https://dev.azure.com/${t}` : `https://${t}`
}

function ProviderLogo({ meta, size = 'md' }: { meta: ProviderMeta; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`provider-logo provider-${meta.id.split('-')[0]} size-${size}`}><Icon name={meta.icon} /></span>
}

// ---------------------------------------------------------------------------------------------
// connect / connected

export function ProviderConnect({ provider }: { provider: ProviderId }) {
  const meta = providerMeta(provider)
  const acc = useStore((s) => s.settings!.integrations[provider])
  const azureOrg = useStore((s) => s.settings!.azure.orgUrl)
  const [host, setHost] = useState(meta.org ? azureOrg : '')
  const [useToken, setUseToken] = useState(false)
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState<null | 'oauth' | 'token'>(null)
  const needsHost = meta.selfHosted || meta.org
  const effectiveHost = meta.org ? orgUrl(host) : (meta.host ?? host.trim())

  const connect = async (method: 'oauth' | 'token') => {
    setBusy(method)
    try {
      const a = await api.providerConnect(provider, { method, host: needsHost ? host : undefined, token: method === 'token' ? token : undefined, username: username || undefined })
      setState({ settings: await api.getSettings() })
      setToken('')
      toast({ kind: 'success', title: `Connected to ${meta.name}`, message: `Signed in as ${a.displayName ?? a.username}` })
    } catch (e) {
      toast({ kind: 'error', title: `Could not connect to ${meta.name}`, message: errMsg(e) })
    } finally { setBusy(null) }
  }

  if (acc) {
    return (
      <div className="provider-panel">
        <div className="provider-account">
          {acc.avatarUrl ? <img className="provider-avatar" src={acc.avatarUrl} alt="" /> : <span className="provider-avatar placeholder"><Icon name="user" /></span>}
          <div className="provider-account-info">
            <div className="provider-account-name">{acc.displayName || acc.username}</div>
            <div className="text-secondary">{acc.username && acc.displayName !== acc.username ? `@${acc.username} · ` : ''}{acc.host}</div>
            <div className="text-secondary fs-small">{acc.method === 'oauth' ? 'Signed in with the browser (Git Credential Manager)' : 'Personal access token, stored encrypted on this computer'}</div>
          </div>
          <span className="pill pill-teal"><Icon name="check" /> Connected</span>
        </div>
        {acc.browseError ? <div className="provider-warning"><Icon name="warning" /> {acc.browseError}</div> : null}
        <div className="text-secondary fs-small">
          Clone, fetch, pull and push to {meta.org ? 'this organization' : acc.host} use this account. Browse its repositories from <b>Clone a Repository</b>.
        </div>
        <div className="provider-actions">
          <button className="btn btn-danger btn-small" onClick={async () => {
            await api.providerDisconnect(provider)
            setState({ settings: await api.getSettings() })
            toast({ kind: 'info', title: `Disconnected from ${meta.name}` }, 3000)
          }}><Icon name="sign-out" /> Disconnect</button>
        </div>
      </div>
    )
  }

  return (
    <div className="provider-panel">
      {needsHost ? (
        <div className="form-grid-row">
          <span className="form-label">{meta.org ? 'Organization' : 'Server address'}</span>
          <input className="form-control" placeholder={meta.org ? 'https://dev.azure.com/your-org' : 'git.example.com'} value={host} onChange={(e) => setHost(e.target.value)} />
          <span />
        </div>
      ) : null}
      <button className={`btn provider-connect-btn provider-btn-${meta.id.split('-')[0]}`} disabled={!!busy || (needsHost && !host.trim())} onClick={() => connect('oauth')}>
        {busy === 'oauth' ? <><Icon name="spinner" spin /> Waiting for you to sign in…</> : <><Icon name={meta.icon} /> Connect to {meta.name}</>}
      </button>
      <div className="text-secondary fs-small">
        Opens the sign-in from Git Credential Manager (included with Git for Windows). {meta.selfHosted ? 'Self-hosted servers may ask for a token instead of a browser sign-in.' : 'Your browser handles the login; SuperGit never sees your password.'}
        {' '}If you already signed in for git, this connects right away.
      </div>
      <div className="provider-divider"><span>or</span></div>
      {!useToken ? (
        <span className="btn-link" onClick={() => setUseToken(true)}><Icon name="key" /> Use a personal access token</span>
      ) : (
        <>
          {meta.needsUsername ? (
            <div className="form-grid-row">
              <span className="form-label">Username / email</span>
              <input className="form-control" value={username} onChange={(e) => setUsername(e.target.value)} />
              <span />
            </div>
          ) : null}
          <div className="form-grid-row">
            <span className="form-label">Personal access token</span>
            <input className="form-control" type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && token.trim()) void connect('token') }} />
            <button className="btn btn-success btn-small" disabled={!!busy || !token.trim() || (needsHost && !host.trim())} onClick={() => connect('token')}>{busy === 'token' ? 'Connecting…' : 'Connect'}</button>
          </div>
          <div className="text-secondary fs-small">
            Create one with {meta.tokenHelp}. It is stored encrypted on this computer and only sent to {meta.name}.{' '}
            {(!needsHost || host.trim()) ? <span className="btn-link" onClick={() => api.openExternal(meta.tokenUrl(effectiveHost))}>Generate a token on {meta.name}</span> : null}
          </div>
        </>
      )}
    </div>
  )
}

/** Preferences → Integrations */
export function IntegrationsSection() {
  const integrations = useStore((s) => s.settings!.integrations)
  const [sel, setSel] = useState<ProviderId>('github')
  const meta = providerMeta(sel)
  return (
    <>
      <div className="clone-title">Integrations</div>
      <div className="text-secondary fs-small mb2">Connect your hosting services to browse and clone their repositories. Sign-ins go straight to each service; there is no SuperGit server in between.</div>
      <div className="integrations-layout">
        <div className="integrations-list">
          {PROVIDERS.map((p) => (
            <div key={p.id} className={`integrations-item${sel === p.id ? ' active' : ''}`} onClick={() => setSel(p.id)}>
              <ProviderLogo meta={p} size="sm" />
              <span className="truncate">{p.name}</span>
              {integrations[p.id] ? <span className="integrations-dot" title="Connected" /> : null}
            </div>
          ))}
        </div>
        <div className="integrations-detail">
          <div className="integrations-head"><ProviderLogo meta={meta} size="lg" /><span>{meta.name}</span></div>
          <ProviderConnect key={sel} provider={sel} />
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// repository browser (Clone dialog)

export function ProviderRepos({ provider, dirRow, busy, progress, onClone }: { provider: ProviderId; dirRow: ReactNode; busy: boolean; progress: string; onClone: (r: HostedRepo) => void }) {
  const meta = providerMeta(provider)
  const acc = useStore((s) => s.settings!.integrations[provider])
  const [repos, setRepos] = useState<HostedRepo[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<HostedRepo | null>(null)
  const [ssh, setSsh] = useState(false)
  useEffect(() => {
    setRepos(null); setErr(null); setSel(null)
    if (!acc) return
    api.providerRepos(provider).then(setRepos).catch((e: unknown) => setErr(errMsg(e)))
  }, [provider, acc?.host, acc?.username, acc?.connectedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const grouped = useMemo(() => {
    const m = new Map<string, HostedRepo[]>()
    const ql = q.toLowerCase()
    for (const r of repos ?? []) {
      if (ql && !r.fullName.toLowerCase().includes(ql)) continue
      m.set(r.group, [...(m.get(r.group) ?? []), r])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [repos, q])

  if (!acc) return <><div className="clone-title">{meta.name}</div><ProviderConnect provider={provider} /></>
  const pick = (r: HostedRepo) => onClone(ssh && r.sshUrl ? { ...r, cloneUrl: r.sshUrl } : r)
  return (
    <>
      <div className="clone-title">{meta.name} <span className="text-secondary fs-small">({acc.host} · {acc.displayName || acc.username})</span></div>
      {dirRow}
      <div className="ado-search"><Icon name="search" /><input autoFocus placeholder="Search repositories" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="ado-list">
        {err ? <div className="color-red">{err}</div> : !repos ? <div className="text-secondary"><Icon name="spinner" spin /> Loading repositories…</div> : !grouped.length ? <div className="text-secondary">No repositories found.</div> : grouped.map(([group, list]) => (
          <div key={group}>
            <div className="ado-project">{group}</div>
            {list.map((r) => (
              <div key={r.id} className={`ado-repo${sel?.id === r.id ? ' selected' : ''}`} title={r.description} onClick={() => setSel(r)} onDoubleClick={() => pick(r)}>
                <Icon name={r.isPrivate ? 'lock' : 'code-branch'} /> {r.name}
                {r.defaultBranch ? <span className="text-secondary"> · {r.defaultBranch}</span> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="clone-actions">
        {sel?.sshUrl ? <label className="form-check mr-auto"><input type="checkbox" checked={ssh} onChange={(e) => setSsh(e.target.checked)} /> Clone with SSH</label> : null}
        {busy ? <span className="clone-progress"><Icon name="spinner" spin /> {progress}</span> : null}
        <button className="btn btn-success btn-small" disabled={!sel || busy} onClick={() => sel && pick(sel)}>Clone the repo!</button>
      </div>
    </>
  )
}
