import { useEffect, useState } from 'react'
import { useStore, activeRepoPath } from '../store'
import { api } from '../lib/api'
import { Icon } from './Icon'
import { openModal } from '../store'
import * as A from '../actions'

// the original's zoom presets
const ZOOMS = [300, 250, 200, 175, 150, 125, 110, 100, 90, 80]

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
  return (
    <div className="status-bar">
      <div className="status-left">
        {busy ? <><Icon name="spinner" spin /> <span className="truncate">{text}</span></> : null}
      </div>
      <div className="status-right">
        {readOnly ? <span className="readonly-badge" title="Started with SUPERGIT_READONLY=1: nothing that changes a repository can run">READ-ONLY</span> : null}
        <span className="status-item" title="Activity Log" onClick={() => openModal('activity')}><Icon name="list" /></span>
        <span className="status-item" title="Keyboard Shortcuts (Ctrl + /)" onClick={() => openModal('shortcuts')}><Icon name="keyboard" /></span>
        <span className="status-item" title="Zoom (Ctrl + = / Ctrl + - / Ctrl + 0)" onClick={() => void A.popup(ZOOMS.map((z) => ({ label: `${z}%`, checked: Math.round(zoom * 100) === z, act: () => api.setZoom(z / 100) })))}>
          <Icon name="search" /> {Math.round(zoom * 100)}%
        </span>
        <span className="status-version">{version}</span>
      </div>
    </div>
  )
}
