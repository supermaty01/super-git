import { api } from '../lib/api'
import * as A from '../actions'
import { updateRepo } from '../store'
import type { RepoView } from '../store'

/** The parent sha in the commit panel: click or "Jump to commit in graph" selects it; a hidden commit says so. Right-click: copy / jump. */
export function ParentLink({ repo, sha }: { repo: RepoView; sha: string }) {
  const path = repo.path
  const inGraph = !!repo.snapshot?.commits.some((c) => c.sha === sha)
  const jump = () => { if (!inGraph) return; A.selectCommit(path, sha); updateRepo(path, { focus: { sha, t: Date.now() } }) }
  return (
    <span
      className="commit-parent-link"
      title={inGraph ? 'Jump to commit in graph' : "Can't jump to commit in graph, because it's not visible."}
      onClick={jump}
      onContextMenu={(e) => {
        e.preventDefault()
        void A.popup([
          { label: 'Copy commit sha', act: () => api.copy(sha) },
          ...(inGraph ? [{ label: 'Jump to commit in graph', act: jump }] : [])
        ])
      }}
    >{sha.slice(0, 6)}</span>
  )
}
