import { useEffect, useState } from 'react'
import { useStore, activeRepoPath } from '../store'
import { api } from '../lib/api'
import { Icon } from './Icon'
import { openModal } from '../store'

// the original's zoom select lists these, highest first
const ZOOMS = [300, 250, 200, 175, 150, 140, 130, 120, 110, 100, 90, 80]

export function StatusBar() {
  const zoom = useStore((s) => s.settings?.zoom ?? 1)
  const progress = useStore((s) => s.progress)
  const busy = useStore((s) => {
    const p = activeRepoPath()
    return p ? s.repos[p]?.busy : null
  })
  const [version, setVersion] = useState('')
  useEffect(() => { void api.getVersion().then(setVersion) }, [])
  const [readOnly, setReadOnly] = useState(false)
  useEffect(() => { void api.gitInfo().then((i) => setReadOnly(i.readOnly)).catch(() => undefined) }, [])
  const text = busy ? `${busy}${progress?.text ? ` — ${progress.text}` : '...'}` : ''
  const pct = Math.round(zoom * 100)
  const zooms = ZOOMS.includes(pct) ? ZOOMS : [...ZOOMS, pct].sort((a, b) => b - a)
  return (
    <div className="status-bar">
      <div className="status-left">
        {busy ? <><Icon name="spinner" spin /> <span className="truncate">{text}</span></> : null}
      </div>
      <div className="status-right">
        {readOnly ? <span className="readonly-badge" title="Started with SUPERGIT_READONLY=1: nothing that changes a repository can run">READ-ONLY</span> : null}
        <span className="status-item status-icon" title="Activity Logs" onClick={() => openModal('activity')}><Icon name="list" /></span>
        <span className="status-item status-icon" title="Keyboard Shortcuts (Ctrl + /)" onClick={() => openModal('shortcuts')}><Icon name="keyboard" /></span>
        <label className="status-zoom" title="Zoom">
          <Icon name="search" />
          <select value={pct} onChange={(e) => void api.setZoom(Number(e.target.value) / 100)}>
            {zooms.map((z) => <option key={z} value={z}>{z}%</option>)}
          </select>
        </label>
        <button className="status-version" title="View Release Notes" onClick={() => void api.openExternal('https://github.com/supermaty01/super-git/releases')}>{version}</button>
      </div>
    </div>
  )
}
