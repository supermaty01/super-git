import { useState } from 'react'
import { useStore, MGMT_TAB, openModal } from '../store'
import * as A from '../actions'
import { tabMenu } from '../menus'
import { Icon } from './Icon'
import { switchProfile } from '../actions2'

const NO_PROFILES: import('@shared/types').Profile[] = []

export function TabsBar() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.activeTab)
  const [drag, setDrag] = useState<number | null>(null)
  const profiles = useStore((s) => s.settings?.profiles ?? NO_PROFILES)
  const activeProfile = useStore((s) => s.settings?.activeProfile)
  const prof = profiles.find((p) => p.id === activeProfile) ?? profiles[0]

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
            title={t.path}
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
            <span className="tab-close"><span className="tab-close-button" title="Close tab (Ctrl+W)" onClick={(e) => { e.stopPropagation(); void A.closeTab(t.id) }}><Icon name="times-thin" /></span></span>
          </div>
        ))}
        <div className="tab-add no-drag" title="New tab" onClick={() => A.activateTab(MGMT_TAB)}><Icon name="plus" /></div>
      </div>
      <div className="tabs-right no-drag">
        <span className="tabs-right-btn" title="Keyboard shortcuts (Ctrl+/)" onClick={() => openModal('shortcuts')}><Icon name="keyboard" /></span>
        <span className="tabs-right-btn" title="Preferences (Ctrl+,)" onClick={() => openModal('prefs')}><Icon name="cog" /></span>
        <span className="tabs-profile" title={prof?.gitEmail ? `${prof.gitName} <${prof.gitEmail}>` : 'Profile'} onClick={() => A.popup([
          ...profiles.map((p) => ({ label: p.name, checked: p.id === activeProfile, act: () => switchProfile(p.id) })),
          '-',
          { label: 'Manage profiles…', act: () => openModal('prefs', { section: 'profiles' }) }
        ])}>
          <Icon name="user" /> {prof?.name ?? 'Profile'} <Icon name="caret-down" className="crumb-caret" />
        </span>
      </div>
    </div>
  )
}
