// Repository Management rows: branch, ahead / behind and the WIP summary (the original's "✎ 2  + 1" pill).

export interface RepoSummary {
  /** null when HEAD is detached */
  branch: string | null
  ahead: number
  behind: number
  /** tracked files with changes (staged or not) */
  modified: number
  /** new files (untracked or added) */
  added: number
}

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseSummary(out: string): RepoSummary {
  const s: RepoSummary = { branch: null, ahead: 0, behind: 0, modified: 0, added: 0 }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const l = parts[i]
    if (l.startsWith('# branch.head ')) { const h = l.slice(14); s.branch = h === '(detached)' ? null : h }
    else if (l.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(l)
      if (m) { s.ahead = +m[1]; s.behind = +m[2] }
    } else if (l.startsWith('? ')) s.added++
    else if (l.startsWith('1 ') || l.startsWith('2 ')) {
      const xy = l.slice(2, 4)
      if (xy[0] === 'A') s.added++
      else s.modified++
      if (l.startsWith('2 ')) i++ // renames carry the original path as the next entry
    } else if (l.startsWith('u ')) s.modified++
  }
  return s
}

/** folders that are never searched for repositories */
export const SCAN_SKIP = new Set(['node_modules', '$recycle.bin', 'system volume information', 'appdata'])
