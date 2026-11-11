import { useEffect, useMemo, useState } from 'react'
import type { RepoView } from '../store'
import * as A from '../actions'
import { api } from '../lib/api'
import { avatarUrl } from '../lib/avatar'
import { fullDate } from '../lib/format'
import { Icon } from './Icon'
import { DiffView } from './DiffView'
import type { Commit, FileContext } from '@shared/types'

type Entry = Commit & { path: string }

/**
 * File History / File Blame, laid out like the original: a full-width screen with the commits that touched the file
 * (followed across renames, from the commit it was opened on) and that commit's diff, file or blame on the right.
 */
export function FileHistoryView({ repo, file, sha, blame }: { repo: RepoView; file: string; sha?: string; blame?: boolean }) {
  const path = repo.path
  const [list, setList] = useState<Entry[] | null>(null)
  const [sel, setSel] = useState(0)
  useEffect(() => {
    let alive = true
    setList(null)
    api.fileHistory(path, file, sha).then((l) => { if (alive) { setList(l); setSel(0) } }).catch(() => alive && setList([]))
    return () => { alive = false }
  }, [path, file, sha])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input, textarea, .monaco-editor')) A.closeCenter(path) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [path])

  const cur = list?.[sel]
  const older = list?.[sel + 1]
  const ctx = useMemo<FileContext | null>(() => cur ? {
    kind: 'commit', sha: cur.sha, parent: cur.parents[0], path: cur.path,
    oldPath: older && older.path !== cur.path ? older.path : undefined,
    status: !older ? 'A' : older.path !== cur.path ? 'R' : 'M'
  } : null, [cur, older])

  return (
    <div className="file-history">
      <div className="fh-header">
        <span className="fh-title">File History: {file}</span>
        <span className="grow" />
        <span className="fh-encoding">UTF-8</span>
        <span className="fh-close" title="Close (Esc)" onClick={() => A.closeCenter(path)}><Icon name="times" /></span>
      </div>
      <div className="fh-body">
        <div className="fh-list">
          {!list ? <div className="loading"><div className="spinner" /></div> : null}
          {list?.map((h, i) => {
            const prev = list[i + 1]
            const status = !prev ? { label: 'ADDED', cls: 'added', text: h.path } : prev.path !== h.path ? { label: 'RENAMED', cls: 'renamed', text: `${prev.path} → ${h.path}` } : null
            return (
              <div key={h.sha} className={`fh-row${i === sel ? ' is-selected' : ''}`} onClick={() => setSel(i)}>
                <div className="fh-info">
                  <span className="fh-avatar" style={{ backgroundImage: `url(${avatarUrl(h.email, h.author)})` }} />
                  <div className="fh-middle">
                    <div className="fh-message truncate">{h.summary}</div>
                    <div className="fh-signature truncate">{fullDate(h.date).split(' @ ')[0]} by {h.author}</div>
                  </div>
                  <span className="fh-sha" title="Show this commit in the graph" onClick={(e) => { e.stopPropagation(); A.selectCommit(path, h.sha); A.closeCenter(path) }}>{h.sha.slice(0, 6)}</span>
                </div>
                {status ? <div className={`fh-status ${status.cls}`}><span className="fh-status-label">{status.label}</span><span className="truncate">{status.text}</span></div> : null}
              </div>
            )
          })}
          {list && !list.length ? <div className="fh-end">No history for this file</div> : null}
          {list?.length ? <div className="fh-end">End of History</div> : null}
        </div>
        <div className="fh-content">
          {ctx ? <DiffView key={`${ctx.kind}:${'sha' in ctx ? ctx.sha : ''}`} repo={repo} ctx={ctx} startView={blame ? 'blame' : 'diff'} historyMode /> : null}
        </div>
      </div>
    </div>
  )
}
