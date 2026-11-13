import { useEffect, useMemo, useRef, useState } from 'react'
import type { RepoView } from '../store'
import { useStore, updateRepo, openModal } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { saveSettings } from '../actions2'
import { Icon } from './Icon'
import type { ConflictCheck, K2Settings } from '@shared/k2'
import '../styles/k2.css'

/** Settings.k2 with the original's defaults */
const NONE: K2Settings = {}
const NO_RULES: string[] = []
export const k2Of = (s: { k2?: K2Settings } | null | undefined): K2Settings => s?.k2 ?? NONE
export const conflictDetectionOn = (k2: K2Settings, path: string) => k2.conflictDetection !== false && k2.repoConflict?.[path]?.enabled !== false
export function saveK2(patch: (k: K2Settings) => K2Settings, cur: K2Settings): void { saveSettings({ k2: patch(cur) }) }

const results = new Map<string, ConflictCheck | null>()

/** compares the current branch with its target whenever HEAD or a branch moves (debounced), like the original */
function useConflictCheck(repo: RepoView): ConflictCheck | null {
  const path = repo.path
  const k2 = useStore((s) => k2Of(s.settings))
  const on = conflictDetectionOn(k2, path)
  const rules = k2.repoConflict?.[path]?.rules ?? NO_RULES
  const s = repo.snapshot
  const key = useMemo(() => (s ? [s.head.sha, s.head.branch, ...s.refs.filter((r) => r.type === 'head' || r.type === 'remote').map((r) => r.name + r.sha), ...rules].join('|') : ''), [s, rules])
  const [res, setRes] = useState<ConflictCheck | null>(() => results.get(path) ?? null)
  const seq = useRef(0)
  useEffect(() => {
    if (!on || !key || (s && s.status.state.kind !== 'none')) { setRes(null); return }
    const n = ++seq.current
    const t = window.setTimeout(() => {
      api.conflictCheck(path, rules).then((r) => { if (n === seq.current) { results.set(path, r); setRes(r) } }).catch(() => { if (n === seq.current) setRes(null) })
    }, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, on])
  return on ? res : null
}

function BranchPill({ name, onClick }: { name: string; onClick?: () => void }) {
  return <span className={`k2-branch-pill${onClick ? ' selectable' : ''}`} onClick={onClick}>{name}</span>
}

function Option({ icon, label, onClick, rotate }: { icon: string; label: React.ReactNode; onClick: () => void; rotate?: boolean }) {
  return (
    <div className="k2-cd-option" onClick={onClick}>
      <Icon name={icon} className={`k2-cd-option-icon${rotate ? ' rot90' : ''}`} />
      <span>{label}</span>
    </div>
  )
}

/**
 * The toolbar's conflict prevention button and popover: "Conflict detected with target branch" with rebase / merge
 * options and the overlapping files, or "Up to Date with Merge Target". Local only (git merge-tree); the original's
 * team / cloud parts need its servers and are left out.
 */
export function ConflictDetectionButton({ repo }: { repo: RepoView }) {
  const path = repo.path
  const res = useConflictCheck(repo)
  const k2 = useStore((s) => k2Of(s.settings))
  const [open, setOpen] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  }, [open])
  if (!conflictDetectionOn(k2, path)) return null
  if (!res) return <div className="k2-cd-placeholder" />
  const conflict = res.files.length > 0
  const s = repo.snapshot
  const headSha = s?.head.sha ?? ''
  const select = (sha: string) => { setOpen(false); updateRepo(path, { selection: { kind: 'commits', shas: [sha], anchor: sha }, focus: { sha, t: Date.now() }, center: { kind: 'graph' } }) }
  const remote = s?.remotes.map((r) => r.name).sort((a, b) => b.length - a.length).find((r) => res.target.startsWith(r + '/'))
  const settings = () => { setOpen(false); openModal('repoPrefs', { path, section: 'conflict' }) }
  const tip = conflict ? `A conflict is detected with ${res.target}. Click to view details and resolve.` : `No conflicts detected against ${res.target}`
  return (
    <div className="k2-cd" ref={ref}>
      <button className={`toolbar-btn k2-cd-btn${open ? ' active' : ''}`} title={open ? undefined : tip} onClick={() => setOpen((o) => !o)} data-test-class="button-toolbar-conflict-detection">
        <span className="k2-cd-icon">
          <Icon name="code-branch" />
          {conflict ? <Icon name="warning" className="k2-cd-badge warning" /> : <Icon name="check" className="k2-cd-badge success" />}
        </span>
      </button>
      {open ? (
        <div className="k2-cd-popover">
          {conflict ? <>
            <div className="k2-cd-title"><Icon name="warning" className="warning" /><h4>Conflict detected with target branch</h4></div>
            <div className="k2-cd-desc">
              <div className="k2-cd-branch" onClick={() => select(headSha)}>Your branch: <BranchPill name={res.branch} /></div>
              <div className="k2-cd-branch" onClick={() => select(res.targetSha)}>Merge target: <BranchPill name={res.target} /></div>
            </div>
            <div className="k2-cd-files-toggle" onClick={() => setShowFiles((v) => !v)}>
              <Icon name={showFiles ? 'chevron-down' : 'chevron-right'} /> Show {res.files.length} overlapping files
            </div>
            {showFiles ? (
              <div className="k2-cd-files">
                {res.files.map((f) => (
                  <div key={f.path} className="k2-cd-file">
                    <div>File: {f.path}</div>
                    {f.lines.map(([a, b]) => <div key={a} className="k2-cd-lines">{a === b ? `Line: ${a}` : `Lines: ${a}-${b}`}</div>)}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="k2-cd-explainer">Conflicts tend to become harder to resolve as the two branches continue to change. If you plan to merge or rebase, we recommend doing an early one now to resolve existing conflicts before they get worse.</div>
            <hr className="k2-cd-hr" />
            <div className="k2-cd-header caps">View and Resolve</div>
            <div className="k2-cd-options">
              <Option icon="commit" rotate label={<>Rebase <BranchPill name={res.branch} /> onto <BranchPill name={res.target} /></>} onClick={() => { setOpen(false); void A.rebaseOnto(path, res.target) }} />
              <Option icon="code-branch" label={<>Merge <BranchPill name={res.target} /> into <BranchPill name={res.branch} /></>} onClick={() => { setOpen(false); void A.mergeInto(path, res.target) }} />
            </div>
            <div className="k2-cd-header caps">Other Options</div>
            <div className="k2-cd-options">
              {remote ? <Option icon="eye-slash" label={<>Stop detecting conflicts with remote <BranchPill name={remote} /></>} onClick={() => {
                setOpen(false)
                const cur = k2.repoConflict?.[path] ?? {}
                saveK2((k) => ({ ...k, repoConflict: { ...k.repoConflict, [path]: { ...cur, rules: [...(cur.rules ?? []), `!refs/remotes/${remote}`] } } }), k2)
              }} /> : null}
              <Option icon="cog" label="Set target branches in settings" onClick={settings} />
            </div>
          </> : <>
            <div className="k2-cd-title"><Icon name="check" className="success" /><h4>Up to Date with Merge Target</h4></div>
            <div className="k2-cd-desc text">Your current branch <BranchPill name={res.branch} /> will not cause conflicts when merging with its target branch <BranchPill name={res.target} />.</div>
            <hr className="k2-cd-hr" />
            <div className="k2-cd-options">
              <Option icon="cog" label="Set target branches in settings" onClick={settings} />
            </div>
          </>}
        </div>
      ) : null}
    </div>
  )
}
