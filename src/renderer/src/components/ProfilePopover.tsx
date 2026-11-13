import { useEffect, useRef } from 'react'
import { useStore, openModal } from '../store'
import { switchProfile } from '../actions2'
import { avatarUrl } from '../lib/avatar'
import { Icon } from './Icon'
import type { Profile } from '@shared/types'

function Avatar({ p }: { p: Profile }) {
  return p.gitEmail
    ? <span className="pp-avatar" style={{ backgroundImage: `url(${avatarUrl(p.gitEmail, p.gitName ?? p.name)})` }} />
    : <span className="pp-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
}

/** the original's in-app profile popover: current profile, commit signature, other profiles, manage profiles (closes on an outside click only) */
export function ProfilePopover({ onClose }: { onClose: () => void }) {
  const profiles = useStore((s) => s.settings?.profiles ?? [])
  const activeId = useStore((s) => s.settings?.activeProfile)
  const cur = profiles.find((p) => p.id === activeId) ?? profiles[0]
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tabs-profile')) onClose() }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])
  if (!cur) return null
  const others = profiles.filter((p) => p.id !== cur.id)
  return (
    <div className="profile-popover" ref={ref}>
      <h4>Current profile</h4>
      <div className="pp-card current">
        <Avatar p={cur} />
        <div style={{ minWidth: 0 }}><div className="pp-name">{cur.name}</div></div>
      </div>
      {others.length ? (
        <div className="pp-section">
          <h4>Switch profile</h4>
          {others.map((p) => (
            <div key={p.id} className="pp-card" onClick={() => { onClose(); void switchProfile(p.id) }}>
              <Avatar p={p} />
              <div className="pp-name">{p.name}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="pp-section">
        <h4>Commit signature</h4>
        <div className="pp-name">{cur.gitName || 'No name set'}</div>
        <div className="pp-sub">{cur.gitEmail || 'No email set'}</div>
      </div>
      <div className="pp-manage" onClick={() => { onClose(); openModal('prefs', { section: 'profiles' }) }}>
        <Icon name="cog" /> Manage profiles
      </div>
    </div>
  )
}
