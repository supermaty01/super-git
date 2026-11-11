import { useEffect, useState } from 'react'
import { useStore, activeRepoPath } from '../store'
import { api } from '../lib/api'
import { Icon } from './Icon'

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
        <span className="status-item" title="Zoom (Ctrl + / Ctrl - / Ctrl 0)" onClick={() => api.setZoom(1)}>
          <Icon name="search" /> {Math.round(zoom * 100)}%
        </span>
        <span className="status-version">{version}</span>
      </div>
    </div>
  )
}
