import type { CSSProperties, ReactElement } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faFolder as farFolder, faTrashCan as farTrashCan, faBell, faClock, faKeyboard, faCopy, faFile, faFolderOpen as farFolderOpen, faEye, faEyeSlash, faSquare as farSquare,
  faCircle as farCircle, faCircleDot as farCircleDot
} from '@fortawesome/free-regular-svg-icons'
import {
  faXmark, faPlus, faChevronDown, faChevronRight, faChevronUp, faChevronLeft, faGear, faCaretDown, faMagnifyingGlass, faCodeBranch, faRotateLeft,
  faRotateRight, faTerminal, faCircleChevronLeft, faCircleChevronRight, faList, faLaptop, faCloud, faTag, faCheck, faPencil, faArrowUpAZ,
  faBars, faFolderTree, faFilter, faTree, faTrash, faArrowUp, faArrowDown, faTriangleExclamation, faMinus, faPen, faArrowRightArrowLeft, faEllipsisVertical,
  faCodeMerge, faCodeCommit, faArrowsRotate, faCircleInfo, faArrowUpRightFromSquare, faFloppyDisk, faParagraph, faAlignLeft, faHouse, faCodeCompare,
  faInbox, faCircleCheck, faCircleXmark, faSpinner, faGripLines, faFileLines, faClockRotateLeft, faUser, faFolderOpen, faFolderPlus, faDownload,
  faCompress, faExpand, faLink, faCircle, faLock, faServer, faKey, faRightFromBracket, faCaretUp
} from '@fortawesome/free-solid-svg-icons'
import { faGithub, faGitlab, faBitbucket, faMicrosoft } from '@fortawesome/free-brands-svg-icons'

const FA: Record<string, IconDefinition> = {
  folder: farFolder, 'folder-open': farFolderOpen, 'folder-solid-open': faFolderOpen, 'folder-plus': faFolderPlus, bell: faBell, clock: faClock,
  keyboard: faKeyboard, copy: faCopy, file: faFile, 'file-lines': faFileLines, times: faXmark, plus: faPlus, 'chevron-down': faChevronDown,
  'chevron-right': faChevronRight, 'chevron-up': faChevronUp, 'chevron-left': faChevronLeft, cog: faGear, 'caret-down': faCaretDown, 'caret-up': faCaretUp, 'circle-o': farCircle, 'dot-circle-o': farCircleDot,
  search: faMagnifyingGlass, 'code-branch': faCodeBranch, undo: faRotateLeft, redo: faRotateRight, terminal: faTerminal,
  'chevron-circle-left': faCircleChevronLeft, 'chevron-circle-right': faCircleChevronRight, list: faList, laptop: faLaptop, cloud: faCloud,
  tag: faTag, check: faCheck, pencil: faPencil, 'sort-alpha': faArrowUpAZ, bars: faBars, 'folder-tree': faFolderTree, filter: faFilter, tree: faTree,
  trash: faTrash, 'trash-o': farTrashCan, 'arrow-up': faArrowUp, 'arrow-down': faArrowDown, warning: faTriangleExclamation, minus: faMinus, pen: faPen,
  swap: faArrowRightArrowLeft, 'ellipsis-v': faEllipsisVertical, merge: faCodeMerge, commit: faCodeCommit, refresh: faArrowsRotate,
  info: faCircleInfo, external: faArrowUpRightFromSquare, save: faFloppyDisk, paragraph: faParagraph, 'align-left': faAlignLeft,
  house: faHouse, compare: faCodeCompare, inbox: faInbox, 'check-circle': faCircleCheck, 'x-circle': faCircleXmark, spinner: faSpinner,
  grip: faGripLines, history: faClockRotateLeft, user: faUser, download: faDownload, compress: faCompress, expand: faExpand, link: faLink,
  eye: faEye, 'eye-slash': faEyeSlash, square: farSquare, circle: faCircle, lock: faLock,
  github: faGithub, gitlab: faGitlab, bitbucket: faBitbucket, microsoft: faMicrosoft, server: faServer, key: faKey, 'sign-out': faRightFromBracket
}

/** Hand-drawn glyphs for icons that only exist in commercial icon sets. Drawn on a 16x16 grid with strokes. */
const CUSTOM: Record<string, ReactElement> = {
  // outline gear (preferences), like the original's regular-weight cog
  'cog-o': <><circle cx="8" cy="8" r="2.2" /><path d="M6.9 1.5h2.2l.4 1.8 1.3.6 1.6-1 1.6 1.6-1 1.6.6 1.3 1.8.4v2.2l-1.8.4-.6 1.3 1 1.6-1.6 1.6-1.6-1-1.3.6-.4 1.8H6.9l-.4-1.8-1.3-.6-1.6 1-1.6-1.6 1-1.6-.6-1.3-1.8-.4V6.9l1.8-.4.6-1.3-1-1.6 1.6-1.6 1.6 1 1.3-.6z" /></>,
  // thin × (tab close), the weight of the original's regular icon
  'times-thin': <path d="M4 4l8 8M12 4l-8 8" />,
  // outline tray (stashes), conifer (worktrees) and house (the main worktree)
  'inbox-o': <><path d="M1.5 9.5 3.6 3h8.8l2.1 6.5v4h-13z" /><path d="M1.5 9.5h3.6l1 2h3.8l1-2h3.6" /></>,
  'tree-o': <><path d="M8 1.5 4.6 6h1.9L3.4 10.5h9.2L9.5 6h1.9z" /><path d="M8 10.5v4" /></>,
  'house-o': <><path d="M1.5 7.5 8 2l6.5 5.5" /><path d="M3.5 6.5V14h9V6.5" /><path d="M6.5 14v-3.5h3V14" /></>,
  // worktree: trunk with a side branch and a leaf folder
  worktree: <><path d="M5 2v12M5 9c0-2.5 6-2 6-5" /><circle cx="11" cy="3.5" r="1.5" /><path d="M2.5 14h5" /></>,
  // outline laptop (local branch)
  'laptop-o': <><rect x="3" y="3.5" width="10" height="7" rx="1" /><path d="M1 12.5h14" /></>,
  // outline cloud (remote branch)
  'cloud-o': <><path d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .3-5.6 4 4 0 0 0-7.7-.6A3.1 3.1 0 0 0 4.5 12.5z" /></>,
  // outline tag
  'tag-o': <><path d="M1.8 2.5v4.6l7 7 5.4-5.4-7-7H2.8a1 1 0 0 0-1 1z" /><circle cx="5" cy="5.2" r="1" /></>,
  // globe (remote)
  globe: <><circle cx="8" cy="8" r="6.3" /><path d="M1.7 8h12.6M8 1.7c-3.6 3.8-3.6 8.8 0 12.6M8 1.7c3.6 3.8 3.6 8.8 0 12.6" /></>,
  // tray used inside the stash graph node
  'stash-tray': <><path d="M2 9h3.5l1 2h3l1-2H14v4.5H2z" /><path d="M4 6.5h8M5 4h6" /></>,
  // arrow pointing down onto a bar (pull)
  pull: <><path d="M8 1.5v9M4 7l4 4 4-4" /><path d="M2.5 14.5h11" /></>,
  // arrow pointing up from a bar (push)
  push: <><path d="M8 12.5v-9M4 7l4-4 4 4" /><path d="M2.5 14.5h11" /></>,
  // tray with arrow in (stash)
  stash: <><path d="M8 1v7M5 5.5 8 8.5l3-3" /><path d="M1.5 9.5h3.5l1 2h4l1-2h3.5v5h-13z" /></>,
  // tray with arrow out (pop)
  pop: <><path d="M8 8.5v-7M5 4 8 1l3 3" /><path d="M1.5 9.5h3.5l1 2h4l1-2h3.5v5h-13z" /></>,
  // branch-ish glyph used in tabs (repo tab)
  'repo-tab': <><circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="5.5" r="1.6" /><path d="M4.5 5.1v5.8M11.5 7.1c0 3-7 2-7 3.8" /></>,
  // launch / actions (sliders)
  actions: <><path d="M2 4h12M2 8h12M2 12h12" /><circle cx="5" cy="4" r="1.4" fill="currentColor" /><circle cx="11" cy="8" r="1.4" fill="currentColor" /><circle cx="7" cy="12" r="1.4" fill="currentColor" /></>,
  // hunk view (box with lines)
  'view-hunk': <><rect x="2" y="2.5" width="12" height="11" rx="1" /><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h5" /></>,
  // inline view (list)
  'view-inline': <><path d="M5.5 4h8M5.5 8h8M5.5 12h8" /><circle cx="2.8" cy="4" r=".9" fill="currentColor" /><circle cx="2.8" cy="8" r=".9" fill="currentColor" /><circle cx="2.8" cy="12" r=".9" fill="currentColor" /></>,
  // split view (two columns)
  'view-split': <><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><path d="M8 2.5v11" /></>,
  // azure devops-like generic glyph
  ado: <><path d="M2 5.5 9.5 2v12L2 11zM9.5 3.5l4.5 1.5v6.5l-4.5 1.5" /></>
}

export function Icon({ name, className, style, title, spin }: { name: string; className?: string; style?: CSSProperties; title?: string; spin?: boolean }) {
  const custom = CUSTOM[name]
  const cls = `icon icon-${name}${spin ? ' icon-spin' : ''}${className ? ' ' + className : ''}`
  if (custom) {
    return (
      <svg className={cls} style={style} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {title ? <title>{title}</title> : null}
        {custom}
      </svg>
    )
  }
  const def = FA[name]
  if (!def) return null
  const [w, h, , , path] = def.icon
  return (
    <svg className={cls} style={style} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" fill="currentColor">
      {title ? <title>{title}</title> : null}
      {Array.isArray(path) ? path.map((d, i) => <path key={i} d={d} />) : <path d={path} />}
    </svg>
  )
}
