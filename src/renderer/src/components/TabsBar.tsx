import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, MGMT_TAB, openModal, setState } from '../store'
import * as A from '../actions'
import { tabMenu } from '../menus'
import { Icon } from './Icon'
import { ProfilePopover } from './ProfilePopover'
import { avatarUrl } from '../lib/avatar'
import { relTime, basename } from '../lib/format'
import type { TabInfo } from '@shared/types'
import type { MI } from '../actions'
import { api } from '../lib/api'
import { commonGitDir, groupedOrder, groupRuns } from '../lib/tabGroups'
import { Fa } from './NewTab'
import { faGripVertical } from '@fortawesome/free-solid-svg-icons'

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
  const [profileOpen, setProfileOpen] = useState(false)
  const tip = useTabTip()
  const groupOn = useStore((s) => s.settings?.groupWorktreeTabs !== false)
  const groupKey = useWorktreeKeys(tabs)
  const keyOf = (t: TabInfo) => (groupOn ? groupKey[t.path] : undefined)
  const runs = groupRuns(tabs, keyOf)
  // a worktree tab opened later joins its repository's group
  useEffect(() => {
    if (!groupOn) return
    const next = groupedOrder(tabs, keyOf)
    if (next.some((t, i) => t !== tabs[i])) { setState({ tabs: next }); A.persistTabs() }
  }, [tabs, groupKey, groupOn]) // eslint-disable-line react-hooks/exhaustive-deps
  const [dragGroup, setDragGroup] = useState<{ start: number; end: number } | null>(null)
  const dropOn = (to: number) => {
    if (dragGroup) {
      const block = tabs.slice(dragGroup.start, dragGroup.end)
      const rest = tabs.filter((t) => !block.includes(t))
      const at = to > dragGroup.start ? to - block.length + 1 : to
      rest.splice(Math.max(0, Math.min(rest.length, at)), 0, ...block)
      setState({ tabs: rest }); A.persistTabs(); setDragGroup(null)
    }
  }

  const renderTab = (t: TabInfo, i: number, run: { start: number; end: number } | null) => {
    const inGroup = run ? tabs.slice(run.start, run.end) : []
    const groupItems: MI[] = run ? [
      { label: 'Close group', act: async () => { for (const x of inGroup) await A.closeTab(x.id) } },
      { label: 'Close others in group', act: async () => { for (const x of inGroup) if (x.id !== t.id) await A.closeTab(x.id) }, enabled: inGroup.length > 1 }
    ] : []
    return (
      <div
        key={t.id}
        className={`tab no-drag${t.id === active ? ' selected' : ''}${drag === i ? ' dragging' : ''}${A.isNewTab(t) ? ' new-tab' : ''}`}
        draggable
        onDragStart={(e) => { e.stopPropagation(); setDrag(i); tip.hide() }}
        onDragEnd={() => setDrag(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.stopPropagation(); if (dragGroup) dropOn(i); else if (drag !== null && drag !== i) A.reorderTabs(drag, i); setDrag(null) }}
        onMouseDown={(e) => { tip.hide(); if (e.button === 1) { e.preventDefault(); void A.closeTab(t.id) } }}
        onMouseEnter={(e) => tip.enter(t, e.currentTarget)}
        onMouseLeave={() => tip.leave()}
        onClick={() => A.activateTab(t.id)}
        onContextMenu={(e) => { e.preventDefault(); void tabMenu(t.id, groupItems) }}
      >
        {A.isNewTab(t) ? null : <span className="tab-icon"><Icon name="repo-tab" /></span>}
        <span className="tab-title">{t.name}</span>
        <span className="tab-close"><span className="tab-close-button" onClick={(e) => { e.stopPropagation(); void A.closeTab(t.id) }}><Icon name="times-thin" /></span></span>
      </div>
    )
  }

  return (
    <div className="tabs-bar">
      <div className={`tabs-home no-drag${active === MGMT_TAB ? ' active' : ''}`} title="Repo Management" onClick={() => A.activateTab(MGMT_TAB)}>
        <Icon name="folder" />
      </div>
      <div className="tabs-scroll">
        {runs.map((run) => {
          const items = tabs.slice(run.start, run.end).map((t, j) => renderTab(t, run.start + j, run.key ? run : null))
          if (!run.key) return items
          return (
            <div key={`group-${run.key}`} className={`tab-group no-drag${dragGroup && dragGroup.start === run.start ? ' dragging' : ''}`}>
              <span className="tab-group-handle" draggable title="Drag to move the group"
                onDragStart={() => { setDragGroup({ start: run.start, end: run.end }); tip.hide() }} onDragEnd={() => setDragGroup(null)}>
                <Fa icon={faGripVertical} />
              </span>
              {items}
            </div>
          )
        })}
        <div className="tab-add no-drag" title="New tab (Ctrl + T)" onClick={() => void A.newTab()}><Icon name="plus" /></div>
      </div>
      {tip.card}
      <div className="tabs-right no-drag">
        <span className={`tabs-right-btn tab-list-btn${listOpen ? ' active' : ''}`} title="Tabs list (Ctrl + Shift + A)" onClick={() => setState({ tabsList: !listOpen })}><Icon name="chevron-down" /></span>
        <span className={`tabs-right-btn bell${bellOpen ? ' active' : ''}`} title="Notifications" onClick={() => { setBellOpen(!bellOpen); setState({ unread: 0 }) }}>
          <Icon name="bell" />
          {unread ? <span className="bell-badge">{unread > 99 ? '99+' : unread}</span> : null}
        </span>
        <span className="tabs-right-btn" title="Preferences (Ctrl + ,)" onClick={() => openModal('prefs')}><Icon name="cog-o" /></span>
        <span className={`tabs-profile${profileOpen ? ' active' : ''}`} title={prof?.gitEmail ? `${prof.gitName} <${prof.gitEmail}>` : 'Profile'} onClick={() => setProfileOpen(!profileOpen)}>
          {prof?.gitEmail ? <span className="tabs-profile-avatar" style={{ backgroundImage: `url(${avatarUrl(prof.gitEmail, prof.gitName ?? prof.name)})` }} /> : <Icon name="user" />}
          {prof?.name ?? 'Profile'} <Icon name="caret-down" className="crumb-caret" />
        </span>
      </div>
      {listOpen ? <TabsList onClose={() => setState({ tabsList: false })} /> : null}
      {profileOpen ? <ProfilePopover onClose={() => setProfileOpen(false)} /> : null}
      {bellOpen ? <Notifications onClose={() => setBellOpen(false)} /> : null}
    </div>
  )
}

/** repository key (common git dir) per open tab path, so a repository's worktree tabs can be grouped */
const keyCache = new Map<string, string>()
function useWorktreeKeys(tabs: TabInfo[]): Record<string, string> {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const paths = tabs.map((t) => t.path).filter(Boolean)
  useEffect(() => {
    let alive = true
    void (async () => {
      const next: Record<string, string> = {}
      for (const p of paths) {
        let k = keyCache.get(p)
        if (!k) {
          const info = await api.resolveRepo(p).catch(() => null)
          if (!info) continue
          k = commonGitDir(info.gitDir)
          keyCache.set(p, k)
        }
        next[p] = k
      }
      if (alive) setKeys((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next))
    })()
    return () => { alive = false }
  }, [paths.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  return keys
}

/** the original's tab hover delay, and the time after leaving a tab during which another tab's card shows at once */
const TIP_HOVER_MS = 600
const TIP_RESET_MS = 300

/** folder shown on a tab's card: the repository's parent folder (the original's `path.join(repoPath, '..')`) */
export function parentDir(p: string): string {
  const s = p.replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  if (i < 0) return s
  return i === 2 && s[1] === ':' ? s.slice(0, 3) : s.slice(0, i)
}

/** the card shown under a hovered tab: name, then the folder it lives in (New Tab: its shortcut) */
function useTabTip() {
  const [shown, setShown] = useState<{ tab: TabInfo; left: number; top: number } | null>(null)
  const timer = useRef<number | null>(null)
  const lastHidden = useRef(0)
  const clear = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null } }
  const hide = () => { clear(); setShown((s) => { if (s) lastHidden.current = Date.now(); return null }) }
  useEffect(() => {
    const off = () => hide()
    window.addEventListener('keydown', off, true)
    window.addEventListener('blur', off)
    return () => { clear(); window.removeEventListener('keydown', off, true); window.removeEventListener('blur', off) }
  }, [])
  const enter = (tab: TabInfo, el: HTMLElement) => {
    clear()
    const show = () => { if (el.isConnected && el.matches(':hover')) { const r = el.getBoundingClientRect(); setShown({ tab, left: r.left, top: r.bottom }) } }
    if (Date.now() - lastHidden.current < TIP_RESET_MS) show()
    else timer.current = window.setTimeout(show, TIP_HOVER_MS)
  }
  const leave = hide
  const card = shown ? (
    <div className="tab-card" style={{ left: shown.left, top: shown.top }}>
      {A.isNewTab(shown.tab) ? (
        <div className="tab-card-inner">
          <span className="tab-card-title">New Tab</span>
          <span className="tab-card-sub">Ctrl + T</span>
        </div>
      ) : (
        <div className="tab-card-inner">
          <span className="tab-card-title truncate"><Icon name="repo-tab" className="tab-card-icon" />{shown.tab.name}</span>
          <span className="tab-card-sub"><Icon name="folder" className="tab-card-folder" /><span className="tab-card-path">{shown.tab.name !== basename(shown.tab.path) ? shown.tab.path : parentDir(shown.tab.path)}</span></span>
        </div>
      )}
    </div>
  ) : null
  return { enter, leave, hide, card }
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
  // right-aligned under the chevron (the original's react-select popover)
  const [pos, setPos] = useState<{ right: number; top: number }>({ right: 150, top: 36 })
  useLayoutEffect(() => {
    const r = document.querySelector('.tab-list-btn')?.getBoundingClientRect()
    if (r) setPos({ right: Math.max(4, window.innerWidth - r.right), top: r.bottom + 5 })
  }, [])
  return (
    <div className="tabs-list-dropdown" ref={ref} style={pos}>
      <input autoFocus className="tabs-list-search" placeholder="Search Tabs" value={q}
        onChange={(e) => { setQ(e.target.value); setIdx(0) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(shown.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' && shown[idx]) go(shown[idx].id)
        }} />
      <div className="tabs-list-menu">
        <div className="tabs-list-heading">Open Tabs</div>
        {shown.map((t, i) => (
          <div key={t.id} className={`tabs-list-row${i === idx ? ' active' : ''}${t.id === active ? ' current' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => go(t.id)}>
            {A.isNewTab(t) ? null : <Icon name="repo-tab" className="tabs-list-icon" />}
            <span className="truncate">{t.name}</span>
            <span className="tabs-list-close" onClick={(e) => { e.stopPropagation(); void A.closeTab(t.id) }}><Icon name="times" /></span>
          </div>
        ))}
        {!shown.length ? <div className="tabs-list-empty">No results found</div> : null}
      </div>
    </div>
  )
}

/** the bell: every message the app has shown, newest first */
function Notifications({ onClose }: { onClose: () => void }) {
  const items = useStore((s) => s.notifications)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.bell')) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc, true) }
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
