import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faFolderOpen, faCloudArrowDown, faSquarePlus, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import { useStore, openModal } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'

const REPO_URL = 'https://github.com/supermaty01/super-git'

/** a Font Awesome icon that the shared icon map does not carry */
export function Fa({ icon, className }: { icon: IconDefinition; className?: string }) {
  const [w, h, , , path] = icon.icon
  return (
    <svg className={`icon${className ? ' ' + className : ''}`} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" fill="currentColor">
      {Array.isArray(path) ? path.map((d, i) => <path key={i} d={d} />) : <path d={path} />}
    </svg>
  )
}

/**
 * The original's "New Tab" page (Ctrl+T / "+"): Open / Clone / Create and the recent repositories on the left,
 * resources on the right. Opening a repository from here replaces this tab with the repository.
 */
export function NewTab() {
  const recent = useStore((s) => s.settings?.recent ?? [])
  const open = async () => {
    const dir = await api.pickDirectory('Open a repository')
    if (dir) await A.openRepo(dir)
  }
  return (
    <div className="new-tab-view">
      <div className="new-tab-main">
        <h2 className="new-tab-h2">Repositories</h2>
        <div className="new-tab-buttons">
          <button className="btn-plain" onClick={open}><Fa icon={faFolderOpen} /> Open</button>
          <button className="btn-plain" onClick={() => openModal('clone')}><Fa icon={faCloudArrowDown} /> Clone</button>
          <button className="btn-plain" onClick={() => openModal('init')}><Fa icon={faSquarePlus} /> Create</button>
        </div>
        {recent.length ? (
          <>
            <h3 className="new-tab-h3">Recent</h3>
            <div className="new-tab-recent">
              {recent.slice(0, 20).map((r) => (
                <div key={r.path} className="new-tab-recent-row">
                  <span className="new-tab-recent-name" onClick={() => void A.openRepo(r.path)}>{r.name}</span>
                  <span className="new-tab-recent-path">{r.path}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className="new-tab-side">
        <h3 className="new-tab-h3 first">Resources</h3>
        <div className="new-tab-link" onClick={() => void api.openExternal(`${REPO_URL}/releases`)}>Release Notes</div>
        <div className="new-tab-link" onClick={() => void api.openExternal(`${REPO_URL}#readme`)}>Documentation <Fa icon={faArrowUpRightFromSquare} /></div>
      </div>
    </div>
  )
}
