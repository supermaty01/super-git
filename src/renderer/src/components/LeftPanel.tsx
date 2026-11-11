import { useMemo, useState, type ReactNode, type DragEvent, type MouseEvent as RME } from 'react'
import type { RepoView } from '../store'
import { updateRepo, setState, getState, openModal } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import * as A2 from '../actions2'
import { useStore } from '../store'
import { parseStash, stashKey } from '../lib/format'
import { refMenu, remoteMenu, stashMenu, worktreeMenu, tagMenu, dropMenu, folderMenu, sectionMenu, submoduleMenu } from '../menus'
import { Icon } from './Icon'
import { LoadingOverlay } from './LoadingOverlay'
import type { Ref, Remote, Submodule, Stash, Worktree } from '@shared/types'

interface TreeNode { name: string; path: string; ref?: Ref; children: TreeNode[] }

function buildTree(refs: Ref[], strip: (r: Ref) => string): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const r of refs) {
    const parts = strip(r).split('/')
    let node = root
    parts.forEach((p, i) => {
      const isLeaf = i === parts.length - 1
      if (isLeaf) { node.children.push({ name: p, path: node.path + p, ref: r, children: [] }); return }
      let next = node.children.find((c) => !c.ref && c.name === p)
      if (!next) { next = { name: p, path: node.path + p + '/', children: [] }; node.children.push(next) }
      node = next
    })
  }
  const sort = (n: TreeNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); n.children.forEach(sort) }
  sort(root)
  return root.children
}

const DND = 'application/x-supergit-ref'
export function refDragProps(path: string, ref: Ref) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData(DND, ref.name); e.dataTransfer.effectAllowed = 'move' },
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DND)) { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('drop-target') } },
    onDragLeave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('drop-target'),
    onDrop: (e: DragEvent) => {
      (e.currentTarget as HTMLElement).classList.remove('drop-target')
      const name = e.dataTransfer.getData(DND)
      const src = A.snap(path).refs.find((r) => r.name === name)
      if (src) { e.preventDefault(); void dropMenu(path, src, ref) }
    }
  }
}

function focusCommit(path: string, sha: string) {
  A.selectCommit(path, sha)
  updateRepo(path, { focus: { sha, t: Date.now() } })
}

const SECTIONS = [
  { id: 'gitflow', label: 'GITFLOW', icon: 'swap' },
  { id: 'local', label: 'LOCAL', icon: 'laptop-o' },
  { id: 'remote', label: 'REMOTE', icon: 'cloud-o' },
  { id: 'worktrees', label: 'WORKTREES', icon: 'tree-o' },
  { id: 'stashes', label: 'STASHES', icon: 'inbox-o' },
  { id: 'tags', label: 'TAGS', icon: 'tag-o' },
  { id: 'submodules', label: 'SUBMODULES', icon: 'folder-tree' }
] as const

const NONE: string[] = []
const INDENT = 15

/** all branch refs below a tree node */
function refsUnder(nodes: TreeNode[]): Ref[] {
  return nodes.flatMap((n) => (n.ref ? [n.ref] : refsUnder(n.children)))
}

interface RowProps {
  depth: number
  icon: ReactNode
  children: ReactNode
  className?: string
  current?: boolean
  /** highlight as current without the check mark (worktrees) */
  noCheck?: boolean
  /** eye toggle in the lead column; undefined = no eye */
  hidden?: boolean
  onEye?: () => void
  right?: ReactNode
  onMenu?: (e: RME) => void
  title?: string
  onClick?: () => void
  onDoubleClick?: () => void
  extra?: Record<string, unknown>
}

/** one left panel row: [lead column: check / eye] [indent] [icon] [name] [right] [⋮] */
function Row(p: RowProps) {
  return (
    <div
      className={`lp-row${p.current ? ' current' : ''}${p.hidden ? ' is-hidden' : ''}${p.className ? ' ' + p.className : ''}`}
      title={p.title}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      onContextMenu={(e) => { if (p.onMenu) { e.preventDefault(); p.onMenu(e) } }}
      {...(p.extra ?? {})}
    >
      <span className="lp-lead">
        {p.current && !p.noCheck ? <span className="lp-current-badge"><Icon name="check" /></span> : p.onEye ? (
          <span className={`lp-eye${p.hidden ? ' always' : ''}`} title={p.hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); p.onEye!() }}>
            <Icon name={p.hidden ? 'eye-slash' : 'eye'} />
          </span>
        ) : null}
      </span>
      <span className="lp-indent" style={{ width: p.depth * INDENT }} />
      <span className="lp-icon">{p.icon}</span>
      <span className="lp-label">{p.children}</span>
      {p.right ? <span className="lp-right">{p.right}</span> : null}
      {p.onMenu ? <span className="lp-ellipsis" onClick={(e) => { e.stopPropagation(); p.onMenu!(e) }}><Icon name="ellipsis-v" /></span> : null}
    </div>
  )
}

export function LeftPanel({ repo, collapsed, width }: { repo: RepoView; collapsed: boolean; width: number }) {
  const s = repo.snapshot
  const path = repo.path
  const [open, setOpen] = useState<Record<string, boolean>>({ gitflow: true, local: true, remote: true })
  const [closedFolders, setClosedFolders] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')
  const hidden = useStore((st) => st.settings?.hiddenRefs[path] ?? NONE)
  const solo = useStore((st) => st.settings?.soloRefs[path] ?? NONE)
  const hiddenSections = useStore((st) => st.settings?.hiddenSections ?? NONE)

  const data = useMemo(() => {
    if (!s) return null
    const f = filter.trim().toLowerCase()
    const match = (n: string) => !f || n.toLowerCase().includes(f)
    const locals = s.refs.filter((r) => r.type === 'head' && match(r.short))
    const remoteRefs = s.refs.filter((r) => r.type === 'remote' && match(r.short) && !r.short.endsWith('/HEAD'))
    const tags = s.refs.filter((r) => r.type === 'tag' && match(r.short)).sort((a, b) => b.short.localeCompare(a.short, undefined, { numeric: true }))
    const remotes = s.remotes.map((rm) => ({ remote: rm, tree: buildTree(remoteRefs.filter((r) => r.remote === rm.name), (r) => r.short.slice(rm.name.length + 1)) }))
    return {
      localTree: buildTree(locals, (r) => r.short),
      remotes,
      worktrees: s.worktrees.filter((w) => match(w.branch ?? w.path)),
      stashes: s.stashes.filter((st) => match(st.message)),
      tags
    }
  }, [s, filter])

  if (!s || !data) return null

  const counts: Record<string, number> = {
    gitflow: s.refs.filter((r) => r.type === 'head').length,
    local: s.refs.filter((r) => r.type === 'head').length,
    remote: s.refs.filter((r) => r.type === 'remote' && !r.short.endsWith('/HEAD')).length,
    worktrees: s.worktrees.length,
    stashes: s.stashes.length,
    tags: s.refs.filter((r) => r.type === 'tag').length,
    submodules: s.submodules.length
  }
  // "Viewing" counts the branches and tags shown in the graph, as "shown/total" once some are hidden
  const viewable = s.refs.filter((r) => r.type === 'head' || r.type === 'tag' || (r.type === 'remote' && !r.short.endsWith('/HEAD')))
  const viewing = (solo.length ? viewable.filter((r) => solo.includes(r.name)) : viewable.filter((r) => !hidden.includes(r.name))).length
  // a section with hidden entries shows "shown/total", like the Viewing counter
  const isShown = (r: Ref) => (solo.length ? solo.includes(r.name) : !hidden.includes(r.name))
  const countLabel = (id: string): string => {
    const type = id === 'local' || id === 'gitflow' ? 'head' : id === 'remote' ? 'remote' : id === 'tags' ? 'tag' : null
    if (!type) return String(counts[id])
    const all = viewable.filter((r) => r.type === type)
    const n = all.filter(isShown).length
    return n === all.length ? String(all.length) : `${n}/${all.length}`
  }
  const shown = (id: string) => !hiddenSections.includes(id) && (id !== 'gitflow' || s.gitflow.initialized)

  const toggleLeft = (v: boolean) => {
    setState((st) => ({ settings: { ...st.settings!, layout: { ...st.settings!.layout, leftOpen: v } } }))
    void api.setSettings({ layout: { ...getState().settings!.layout, leftOpen: v } })
  }

  if (collapsed) {
    return (
      <div className="left-strip">
        <div className="strip-item" title="Expand left panel" onClick={() => { if (repo.center.kind === 'file') A.closeCenter(path); toggleLeft(true) }}>
          <Icon name="chevron-circle-right" />
        </div>
        {SECTIONS.filter((sec) => shown(sec.id)).map((sec) => (
          <div key={sec.id} className="strip-item" title={sec.label[0] + sec.label.slice(1).toLowerCase()} onClick={() => { if (repo.center.kind === 'file') A.closeCenter(path); toggleLeft(true); setOpen((o) => ({ ...o, [sec.id]: true })) }}>
            <Icon name={sec.icon} />
            <span className="strip-count">{counts[sec.id]}</span>
          </div>
        ))}
      </div>
    )
  }

  const filtering = !!filter.trim()
  const isOpen = (id: string) => filtering || !!open[id]
  const folderOpen = (key: string) => filtering || !closedFolders[key]
  const toggleFolder = (key: string) => setClosedFolders((c) => ({ ...c, [key]: !c[key] }))
  const maximize = (id: string) => setOpen(Object.fromEntries(SECTIONS.map((x) => [x.id, x.id === id])))
  const gf = s.gitflow

  const gitflowType = (r: Ref): 'feature' | 'release' | 'hotfix' | null => {
    if (!gf.initialized) return null
    for (const t of ['feature', 'release', 'hotfix'] as const) if (gf[t] && r.short.startsWith(gf[t])) return t
    return null
  }

  const branchMenu = (r: Ref, inGitflow: boolean) => {
    const t = inGitflow ? gitflowType(r) : null
    if (!t) return void refMenu(path, r, { inLeftPanel: true })
    const name = r.short.slice(gf[t].length)
    void A.popup([
      { label: `Finish ${t} ${name}`, act: () => A2.gitflowFinish(path, t, name) },
      '-',
      { label: `Checkout ${r.short}`, act: () => A.checkoutRef(path, r), enabled: !r.isCurrent },
      { label: `Delete ${r.short}`, act: () => A.deleteLocalBranch(path, r), enabled: !r.isCurrent }
    ])
  }

  const renderTree = (nodes: TreeNode[], depth: number, keyPrefix: string, gitflow = false): ReactNode[] =>
    nodes.flatMap((n) => {
      if (n.ref) {
        const r = n.ref
        const isHidden = hidden.includes(r.name)
        const soloed = solo.includes(r.name)
        return [
          <Row key={keyPrefix + r.name} depth={depth} current={r.isCurrent} hidden={isHidden} onEye={() => A2.setHidden(path, [r.name], !isHidden)}
            className={`lp-branch${soloed ? ' is-soloed' : ''}`}
            icon={<Icon name="code-branch" />}
            title={r.upstreamGone ? `${r.short} (upstream branch was deleted)` : undefined}
            onClick={() => focusCommit(path, r.sha)}
            onDoubleClick={() => A.checkoutRef(path, r)}
            onMenu={() => branchMenu(r, gitflow)}
            extra={refDragProps(path, r)}
            right={<>
              {r.type === 'head' && (r.ahead || r.behind) ? (
                <span className="lp-track">
                  {r.behind ? <span>{r.behind}<Icon name="arrow-down" /></span> : null}
                  {r.ahead ? <span>{r.ahead}<Icon name="arrow-up" /></span> : null}
                </span>
              ) : null}
              {soloed ? <span className="lp-solo-badge" title="Soloed — click to stop soloing" onClick={(e) => { e.stopPropagation(); A2.setSolo(path, [r.name], false) }}>S</span> : null}
              {gitflow && gitflowType(r) ? (
                <button className="btn btn-success btn-xs lp-finish" onClick={(e) => { e.stopPropagation(); const t = gitflowType(r)!; void A2.gitflowFinish(path, t, r.short.slice(gf[t].length)) }}>Finish</button>
              ) : null}
            </>}
          >
            <span className="lp-name">{n.name}</span>
          </Row>
        ]
      }
      const key = keyPrefix + n.path
      const o = folderOpen(key)
      const inner = refsUnder(n.children)
      const names = inner.map((r) => r.name)
      const allHidden = names.length > 0 && names.every((x) => hidden.includes(x))
      const flowType = gitflow && depth === 0 ? (['feature', 'release', 'hotfix'] as const).find((t) => gf[t] === n.path) : undefined
      return [
        <Row key={key} depth={depth} hidden={allHidden} onEye={() => A2.setHidden(path, names, !allHidden)} className="lp-folder"
          icon={<Icon name="folder" />}
          onClick={() => toggleFolder(key)}
          onMenu={() => {
            if (flowType) void A.popup([{ label: `Start ${flowType}`, act: () => A2.gitflowStartDialog(path, flowType) }])
            else void folderMenu(path, n.path.replace(/\/$/, ''), inner)
          }}
        >
          <span className="lp-name">{n.name}</span>
        </Row>,
        ...(o ? renderTree(n.children, depth + 1, keyPrefix, gitflow) : [])
      ]
    })

  const header = (id: string, extra?: ReactNode) => {
    const sec = SECTIONS.find((x) => x.id === id)!
    return (
      <div className={`lp-header hover-target${isOpen(id) ? ' open' : ''}`} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
        onContextMenu={(e) => { e.preventDefault(); void sectionMenu(path, id, () => maximize(id)) }}>
        <Icon name={isOpen(id) ? 'chevron-down' : 'chevron-right'} className="lp-chevron" />
        <Icon name={sec.icon} className="lp-header-icon" />
        <span className="lp-caps">{sec.label}</span>
        {extra ? <span className="hover-show" onClick={(e) => e.stopPropagation()}>{extra}</span> : null}
        <span className={`lp-count${extra ? ' hover-hide' : ''}`}>{countLabel(id)}</span>
      </div>
    )
  }

  // like the original, every open section is its own scrolling area; the last open one takes the spare room
  const lastOpen = [...SECTIONS].reverse().find((x) => (x.id === 'local' || shown(x.id)) && isOpen(x.id))?.id
  const secClass = (id: string) => `lp-section${isOpen(id) ? ' open' : ''}${id === lastOpen ? ' grow' : ''}`

  const gitflowStart = () => A.popup([
    { label: 'Start Feature', act: () => A2.gitflowStartDialog(path, 'feature') },
    { label: 'Start Release', act: () => A2.gitflowStartDialog(path, 'release') },
    { label: 'Start Hotfix', act: () => A2.gitflowStartDialog(path, 'hotfix') },
    '-',
    { label: 'Gitflow settings…', act: () => openModal('repoPrefs', { path, section: 'gitflow' }) }
  ])

  return (
    <div className="left-panel" style={{ width }}>
      <div className="lp-top">
        <div className="lp-viewing">
          <span className="lp-collapse" title="Collapse left panel" onClick={() => toggleLeft(false)}><Icon name="chevron-circle-left" /></span>
          Viewing <span className="lp-viewing-count">{viewing === viewable.length ? viewing : `${viewing}/${viewable.length}`}</span>
          {viewing !== viewable.length ? <span className="lp-show-all" onClick={() => { A2.setHidden(path, hidden.filter((n) => !n.startsWith('stash:')), false); if (solo.length) A2.setSolo(path, solo, false) }}>Show All</span> : null}
        </div>
        <div className="lp-filter">
          <input placeholder="Filter (Ctrl + Alt + f)" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setFilter('') }} />
          <span className="lp-filter-icon" onClick={() => setFilter('')}><Icon name={filter ? 'times' : 'search'} /></span>
        </div>
      </div>
      {repo.busy === A.CHECKING_OUT || repo.busy === A.DELETING ? <LoadingOverlay message={repo.busy} /> : null}
      <div className="lp-scroll">
        {shown('gitflow') ? (
          <div className={secClass('gitflow')}>
            {header('gitflow', <button className="btn btn-success btn-small" title="Start a gitflow branch" onClick={gitflowStart}><Icon name="plus" /></button>)}
            {isOpen('gitflow') ? <div className="lp-body">{renderTree(data.localTree, 0, 'g:', true)}</div> : null}
          </div>
        ) : null}

        <div className={secClass('local')}>
          {header('local')}
          {isOpen('local') ? <div className="lp-body">{renderTree(data.localTree, 0, 'l:')}</div> : null}
        </div>

        {shown('remote') ? (
          <div className={secClass('remote')}>
            {header('remote', <button className="btn btn-success btn-small" title="Add Remote" onClick={() => openModal('remote', { path })}><Icon name="plus" /></button>)}
            {isOpen('remote') ? <div className="lp-body">{data.remotes.map(({ remote, tree }) => {
              const names = refsUnder(tree).map((r) => r.name)
              const allHidden = names.length > 0 && names.every((x) => hidden.includes(x))
              const key = 'r:' + remote.name
              return (
                <div key={remote.name}>
                  <RemoteRow path={path} remote={remote} hidden={allHidden} onEye={() => A2.setHidden(path, names, !allHidden)} onToggle={() => toggleFolder(key)} />
                  {folderOpen(key) ? renderTree(tree, 1, `r:${remote.name}/`) : null}
                </div>
              )
            })}</div> : null}
          </div>
        ) : null}

        {shown('worktrees') ? (
          <div className={secClass('worktrees')}>
            {header('worktrees', <>
              <button className="btn btn-primary btn-small mr1" title="Prune" onClick={() => A.run(path, () => api.pruneWorktrees(path))}><Icon name="refresh" /></button>
              <button className="btn btn-success btn-small" title="Add a new worktree" onClick={() => A.addWorktreeDialog(path)}><Icon name="plus" /></button>
            </>)}
            {isOpen('worktrees') ? <div className="lp-body">{data.worktrees.map((w) => <WorktreeRow key={w.path} path={path} w={w} />)}</div> : null}
          </div>
        ) : null}

        {shown('stashes') ? (
          <div className={secClass('stashes')}>
            {header('stashes')}
            {isOpen('stashes') ? <div className="lp-body">{data.stashes.map((st) => <StashRow key={st.sha} path={path} st={st} hidden={hidden.includes(stashKey(st.sha))} />)}</div> : null}
          </div>
        ) : null}

        {shown('tags') ? (
          <div className={secClass('tags')}>
            {header('tags', <button className="btn btn-success btn-small" title="Create tag at HEAD" onClick={() => A.startCreateRef(path, 'tag')}><Icon name="plus" /></button>)}
            {isOpen('tags') ? <div className="lp-body">{data.tags.map((t) => {
              const isHidden = hidden.includes(t.name)
              return (
                <Row key={t.name} depth={0} hidden={isHidden} onEye={() => A2.setHidden(path, [t.name], !isHidden)} icon={<Icon name="tag-o" />}
                  title={t.subject || undefined}
                  onClick={() => focusCommit(path, t.sha)}
                  onDoubleClick={() => A.checkoutCommit(path, t.sha)}
                  onMenu={() => void tagMenu(path, t, { inLeftPanel: true })}>
                  <span className="lp-name">{t.short}</span>
                </Row>
              )
            })}</div> : null}
          </div>
        ) : null}

        {shown('submodules') ? (
          <div className={secClass('submodules')}>
            {header('submodules', <>
              <button className="btn btn-primary btn-small mr1" title="Update all submodules" onClick={() => A2.submoduleUpdate(path)}><Icon name="refresh" /></button>
              <button className="btn btn-success btn-small" title="Add submodule" onClick={() => A2.submoduleAddDialog(path)}><Icon name="plus" /></button>
            </>)}
            {isOpen('submodules') ? <div className="lp-body">{s.submodules.map((sm) => <SubmoduleRow key={sm.path} path={path} sm={sm} />)}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RemoteRow({ path, remote, hidden, onEye, onToggle }: { path: string; remote: Remote; hidden: boolean; onEye: () => void; onToggle: () => void }) {
  const u = remote.fetchUrl
  const host = /dev\.azure\.com|visualstudio\.com/.test(u) ? 'ado' : /github/i.test(u) ? 'github' : /gitlab/i.test(u) ? 'gitlab' : /bitbucket/i.test(u) ? 'bitbucket' : null
  return (
    <Row depth={0} hidden={hidden} onEye={onEye} className="lp-remote" title={remote.fetchUrl}
      icon={host === 'ado' ? <span className="remote-avatar"><Icon name="ado" /></span> : <Icon name={host ?? 'globe'} />}
      onClick={onToggle} onMenu={() => void remoteMenu(path, remote)}>
      <span className="lp-name">{remote.name}</span>
    </Row>
  )
}

function WorktreeRow({ path, w }: { path: string; w: Worktree }) {
  const folder = w.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return (
    <Row depth={0} current={w.isCurrent} noCheck className="lp-worktree" icon={<Icon name={w.isMain ? 'house-o' : 'tree-o'} />} title={w.path}
      onClick={() => w.sha && focusCommit(path, w.sha)}
      onDoubleClick={() => { if (!w.isCurrent) void A.openRepo(w.path) }}
      onMenu={() => void worktreeMenu(path, w)}
      right={w.locked ? <Icon name="lock" /> : null}>
      <Icon name="code-branch" className="lp-inline-icon" />
      <span className="lp-name">{w.branch ?? `${w.sha.slice(0, 7)} (detached)`}</span>
      <Icon name="folder" className="lp-inline-icon dim" />
      <span className="lp-sub">{folder}</span>
    </Row>
  )
}

function StashRow({ path, st, hidden }: { path: string; st: Stash; hidden: boolean }) {
  const { msg, branch } = parseStash(st.message)
  return (
    <Row depth={0} hidden={hidden} onEye={() => A2.setHidden(path, [stashKey(st.sha)], !hidden)} icon={<Icon name="inbox-o" />} title={st.message}
      onClick={() => focusCommit(path, st.sha)}
      onDoubleClick={() => A.stashApply(path, st.index)}
      onMenu={() => void stashMenu(path, st)}>
      <span className="lp-name">{msg}{branch ? <> <span className="lp-on">on:</span> <span className="lp-on-branch">{branch}</span></> : null}</span>
    </Row>
  )
}

function SubmoduleRow({ path, sm }: { path: string; sm: Submodule }) {
  const label = sm.state === '-' ? 'not initialized' : sm.state === '+' ? 'modified (different commit)' : sm.state === 'U' ? 'merge conflict' : sm.describe ?? ''
  return (
    <Row depth={0} title={`${sm.path}\n${sm.url ?? ''}\n${label}`}
      icon={<Icon name="folder-tree" className={sm.state === '+' ? 'color-orange' : sm.state === '-' ? 'dim' : sm.state === 'U' ? 'color-red' : ''} />}
      onDoubleClick={() => (sm.state === '-' ? A2.submoduleUpdate(path, sm.path) : A2.openSubmodule(path, sm.path))}
      onMenu={() => void submoduleMenu(path, sm)}>
      <span className="lp-name">{sm.path}</span>
      <span className="lp-sub">{sm.state === '-' ? 'not initialized' : sm.sha.slice(0, 7)}</span>
    </Row>
  )
}
