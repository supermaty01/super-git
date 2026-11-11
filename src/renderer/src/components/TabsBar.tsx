import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, MGMT_TAB, openModal, setState } from '../store'
import * as A from '../actions'
import { tabMenu } from '../menus'
import { Icon } from './Icon'
import { switchProfile } from '../actions2'
import { avatarUrl } from '../lib/avatar'
import { relTime } from '../lib/format'

const NO_PROFILES: import('@shared/types').Profile[] = []
const NOTE_ICON = { error: 'x-circle', success: 'check-circle', info: 'info', progress: 'spinner' } as const

export function TabsBar() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.activeTab)
  const [drag, setDrag] = useState<number | null>(null)
  const profiles = useStore((s) => s.settings?.profiles ?? NO_PROFILES)
  const activeProfile = useStore((s) => s.settings?.activeProfile)
  const prof = profiles.find((p) => p.id === activeProfile) ?? profiles[0]
  const unread = useStore((s) => s.unread)
  const listOpen = useStore((s) => s.tabsList)
  const [bellOpen, setBellOpen] = useState(false)

  return (
    <div className="tabs-bar">
      <div className={`tabs-home no-drag${active === MGMT_TAB ? ' active' : ''}`} title="Repo Management" onClick={() => A.activateTab(MGMT_TAB)}>
        <Icon name="folder" />
      </div>
      <div className="tabs-scroll">
        {tabs.map((t, i) => (
          <div
            key={t.id}
            className={`tab no-drag${t.id === active ? ' selected' : ''}${drag === i ? ' dragging' : ''}`}
            title={`${t.name}\n${t.path}`}
            draggable
            onDragStart={() => setDrag(i)}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (drag !== null && drag !== i) A.reorderTabs(drag, i); setDrag(null) }}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); void A.closeTab(t.id) } }}
            onClick={() => A.activateTab(t.id)}
            onContextMenu={(e) => { e.preventDefault(); void tabMenu(t.id) }}
          >
            <span className="tab-icon"><Icon name="repo-tab" /></span>
            <span className="tab-title">{t.name}</span>
            <span className="tab-close"><span className="tab-close-button" onClick={(e) => { e.stopPropagation(); void A.closeTab(t.id) }}><Icon name="times-thin" /></span></span>
          </div>
        ))}
        <div className="tab-add no-drag" title="New tab (Ctrl + T)" onClick={() => A.activateTab(MGMT_TAB)}><Icon name="plus" /></div>
        <div className={`tab-list-btn no-drag${listOpen ? ' active' : ''}`} title="Tabs list (Ctrl + Shift + A)" onClick={() => setState({ tabsList: !listOpen })}><Icon name="chevron-down" /></div>
      </div>
      <div className="tabs-right no-drag">
        <span className={`tabs-right-btn bell${bellOpen ? ' active' : ''}`} title="Notifications" onClick={() => { setBellOpen(!bellOpen); setState({ unread: 0 }) }}>
          <Icon name="bell" />
          {unread ? <span className="bell-badge">{unread > 99 ? '99+' : unread}</span> : null}
        </span>
        <span className="tabs-right-btn" title="Preferences (Ctrl + ,)" onClick={() => openModal('prefs')}><Icon name="cog-o" /></span>
        <span className="tabs-profile" title={prof?.gitEmail ? `${prof.gitName} <${prof.gitEmail}>` : 'Profile'} onClick={() => A.popup([
          ...profiles.map((p) => ({ label: p.name, checked: p.id === activeProfile, act: () => switchProfile(p.id) })),
          '-',
          { label: 'Manage profiles…', act: () => openModal('prefs', { section: 'profiles' }) }
        ])}>
          {prof?.gitEmail ? <span className="tabs-profile-avatar" style={{ backgroundImage: `url(${avatarUrl(prof.gitEmail, prof.gitName ?? prof.name)})` }} /> : <Icon name="user" />}
          {prof?.name ?? 'Profile'} <Icon name="caret-down" className="crumb-caret" />
        </span>
      </div>
      {listOpen ? <TabsList onClose={() => setState({ tabsList: false })} /> : null}
      {bellOpen ? <Notifications onClose={() => setBellOpen(false)} /> : null}
    </div>
  )
}

/** "Search Tabs" dropdown listing the open tabs (the original's tabs list) */
function TabsList({ onClose }: { onClose: () => void }) {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.activeTab)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => tabs.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase())), [tabs, q])
  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tab-list-btn')) onClose() }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])
  const go = (id: string) => { onClose(); void A.activateTab(id) }
  return (
    <div className="tabs-list-dropdown" ref={ref}>
      <input autoFocus className="form-control" placeholder="Search Tabs" value={q}
        onChange={(e) => { setQ(e.target.value); setIdx(0) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(shown.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' && shown[idx]) go(shown[idx].id)
        }} />
      <div className="tabs-list-heading">OPEN TABS</div>
      {shown.map((t, i) => (
        <div key={t.id} className={`tabs-list-row${i === idx ? ' active' : ''}${t.id === active ? ' current' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => go(t.id)} title={t.path}>
          <Icon name="repo-tab" className="tabs-list-icon" />
          <span className="truncate">{t.name}</span>
          <span className="tabs-list-close" title="Close tab" onClick={(e) => { e.stopPropagation(); void A.closeTab(t.id) }}><Icon name="times-thin" /></span>
        </div>
      ))}
      {!shown.length ? <div className="tabs-list-empty">No tabs match</div> : null}
    </div>
  )
}

/** the bell: every message the app has shown, newest first */
function Notifications({ onClose }: { onClose: () => void }) {
  const items = useStore((s) => s.notifications)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.bell')) onClose() }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])
  return (
    <div className="notifications-dropdown" ref={ref}>
      <div className="notifications-header">
        <span>Notifications</span>
        {items.length ? <span className="btn-link" onClick={() => setState({ notifications: [], unread: 0 })}>Clear all</span> : null}
      </div>
      <div className="notifications-list">
        {items.map((n) => (
          <div key={n.id} className={`notification-row notification-${n.kind}`}>
            <Icon name={NOTE_ICON[n.kind]} className="notification-icon" />
            <div className="notification-text">
              <div className="notification-title">{n.title}</div>
              {n.message ? <div className="notification-message">{n.message}</div> : null}
              <div className="notification-time">{relTime(n.time)}</div>
            </div>
          </div>
        ))}
        {!items.length ? <div className="notifications-empty">No notifications</div> : null}
      </div>
    </div>
  )
}
