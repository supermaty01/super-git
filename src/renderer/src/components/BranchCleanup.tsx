import { useEffect, useMemo, useRef, useState } from 'react'
import { closeModal, toast } from '../store'
import { api } from '../lib/api'
import * as A from '../actions'
import { relTime, errMsg } from '../lib/format'
import { Icon } from './Icon'
import type { CleanupBranch } from '@shared/k2'
import {
  buildCleanupRows, branchCountLabel, deleteButtonLabel, remoteWarning, nextCleanupSort, DEFAULT_CLEANUP_SORT, DEFAULT_DAYS_OLD,
  MIN_DAYS_OLD, MAX_DAYS_OLD, type CleanupSort, type CleanupSortColumn, type UpstreamFilter, type MergeFilter
} from '@shared/k2logic'
import '../styles/k2.css'

/** a checkbox that can also be indeterminate (the select-all boxes in the header) */
export function TriCheck({ checked, onChange, disabled, label }: { checked: boolean | 'indeterminate'; onChange: () => void; disabled?: boolean; label?: string }) {
  return (
    <label className={`sg-checkbox k2-tricheck${disabled ? ' disabled' : ''}${checked ? ' on' : ''}`} aria-label={label} title={label}>
      <input type="checkbox" checked={checked === true} disabled={disabled} onChange={() => onChange()} />
      <span className="sg-checkbox-box" aria-hidden="true">
        {checked === true ? <svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
        {checked === 'indeterminate' ? <svg viewBox="0 0 12 12"><path d="M3 6h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg> : null}
      </span>
    </label>
  )
}

/**
 * "Clean Up Local Branches", like the original's: filters (older than N days, remote status, merge status),
 * a sortable table of the local branches (not the current one, not those checked out in other worktrees),
 * a per-row "also delete the remote branch" box, and one delete for everything selected.
 */
export function BranchCleanupModal({ path }: { path: string }) {
  const [branches, setBranches] = useState<CleanupBranch[] | null>(null)
  const [daysOld, setDaysOld] = useState(DEFAULT_DAYS_OLD)
  const [daysText, setDaysText] = useState(String(DEFAULT_DAYS_OLD))
  const [upstream, setUpstream] = useState<UpstreamFilter>('all')
  const [merge, setMerge] = useState<MergeFilter>('all')
  const [sort, setSort] = useState<CleanupSort>(DEFAULT_CLEANUP_SORT)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteRemote, setDeleteRemote] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const debounce = useRef(0)

  useEffect(() => {
    let live = true
    api.branchCleanupInfo(path).then((b) => { if (live) setBranches(b) }).catch((e) => { if (live) { setBranches([]); toast({ kind: 'error', title: 'Could not list branches', message: errMsg(e) }) } })
    return () => { live = false }
  }, [path])

  const now = useMemo(() => Date.now(), [])
  const { matching, pinned } = useMemo(() => buildCleanupRows({ branches: branches ?? [], daysOld, now, selected, sort, upstream, merge }),
    [branches, daysOld, now, selected, sort, upstream, merge])
  const rows = useMemo(() => [...pinned, ...matching], [pinned, matching])
  const pinnedNames = useMemo(() => new Set(pinned.map((b) => b.name)), [pinned])
  const remoteRows = rows.filter((b) => b.upstream?.type === 'remote').map((b) => b.name)
  const allLocal = rows.length > 0 && rows.every((b) => selected.has(b.name))
  const someLocal = !allLocal && rows.some((b) => selected.has(b.name))
  const allRemote = remoteRows.length > 0 && remoteRows.every((n) => deleteRemote.has(n))
  const someRemote = !allRemote && remoteRows.some((n) => deleteRemote.has(n))
  const remoteCount = rows.filter((b) => b.upstream?.type === 'remote' && deleteRemote.has(b.name) && selected.has(b.name)).length

  const toggle = (set: Set<string>, name: string) => { const n = new Set(set); if (n.has(name)) n.delete(name); else n.add(name); return n }
  const setDays = (v: string) => {
    if (v !== '' && !/^\d+$/.test(v)) return
    if (v.length > 4) return
    setDaysText(v)
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(() => { const n = parseInt(v, 10); if (n >= MIN_DAYS_OLD) setDaysOld(n) }, 250)
  }
  const blurDays = () => {
    if (daysText === '') { setDaysText(String(daysOld)); return }
    const n = Math.min(MAX_DAYS_OLD, Math.max(MIN_DAYS_OLD, parseInt(daysText, 10)))
    setDaysOld(n); setDaysText(String(n))
  }

  const remove = async () => {
    const list = (branches ?? []).filter((b) => selected.has(b.name))
    if (!list.length || busy) return
    setBusy(true)
    closeModal()
    let deleted = 0
    await A.run(path, async () => {
      for (const b of list) {
        try {
          if (deleteRemote.has(b.name) && b.upstream?.type === 'remote') await api.deleteRemoteBranch(path, b.upstream.remoteName, b.upstream.branchName)
          await api.deleteBranch(path, b.name, true)
          deleted++
        } catch (e) {
          toast({ kind: 'error', title: `Delete Failed: refs/heads/${b.name}`, message: errMsg(e) })
        }
      }
    }, { busy: A.DELETING })
    if (deleted) toast({ kind: 'success', title: deleted === 1 ? `Deleted: refs/heads/${list[0].name}` : `Deleted ${deleted} local branches` })
  }

  const header = (id: CleanupSortColumn, label: string, cls?: string) => (
    <th className={`k2-th sortable${cls ? ' ' + cls : ''}${sort.columnId === id ? ' sorted' : ''}`} onClick={() => setSort(nextCleanupSort(sort, id))}>
      <span className="k2-th-inner">{label}<Icon name={sort.columnId === id && sort.direction === 'desc' ? 'arrow-down' : 'arrow-up'} className="k2-sort-icon" /></span>
    </th>
  )

  return (
    <div className="modal k2-cleanup" role="dialog" aria-label="Clean Up Local Branches">
      <div className="modal-header">
        <span>Clean Up Local Branches</span>
        <span className="modal-close" onClick={closeModal}><Icon name="times" /></span>
      </div>
      <div className="modal-body k2-cleanup-body">
        <div className="k2-filters">
          <span className="k2-filter">
            <span>Older than (days):</span>
            <input className="form-control k2-days" size={4} value={daysText} onChange={(e) => setDays(e.target.value)} onBlur={blurDays} />
          </span>
          <span className="k2-filter">
            <span>Remote status:</span>
            <select className="form-control k2-select" aria-label="Remote status:" value={upstream} onChange={(e) => setUpstream(e.target.value as UpstreamFilter)}>
              <option value="all">Any</option>
              <option value="hasUpstream">Has upstream</option>
              <option value="noUpstream">Doesn't have upstream</option>
            </select>
          </span>
          <span className="k2-filter">
            <span>Merge status:</span>
            <select className="form-control k2-select" aria-label="Merge status:" value={merge} onChange={(e) => setMerge(e.target.value as MergeFilter)}>
              <option value="all">Any</option>
              <option value="merged">Merged</option>
              <option value="unmerged">Unmerged</option>
            </select>
          </span>
        </div>
        <div className="k2-count">{branchCountLabel(matching.length)}</div>
        <div className="k2-table-wrap">
          <table className="k2-table">
            <thead>
              <tr>
                <th className="k2-th k2-col-check"><TriCheck label="Select all branches" checked={allLocal || (someLocal && 'indeterminate')}
                  onChange={() => setSelected(allLocal || someLocal ? new Set() : new Set([...selected, ...rows.map((b) => b.name)]))} /></th>
                {header('branch', 'Branch')}
                {header('lastCommit', 'Last Commit', 'k2-col-date')}
                {header('merged', 'Merged', 'k2-col-merged center')}
                <th className="k2-th k2-col-check"><TriCheck label="Also delete all remote branches" checked={allRemote || (someRemote && 'indeterminate')}
                  onChange={() => setDeleteRemote(allRemote || someRemote ? new Set() : new Set([...deleteRemote, ...remoteRows]))} /></th>
                {header('upstream', 'Remote', 'k2-col-remote')}
              </tr>
            </thead>
            <tbody>
              {branches === null ? <tr><td colSpan={6} className="k2-empty"><Icon name="circle-notch" spin /></td></tr>
                : !rows.length ? <tr><td colSpan={6} className="k2-empty">No branches match the current filters</td></tr>
                  : rows.map((b) => {
                    const pin = pinnedNames.has(b.name)
                    const sel = selected.has(b.name)
                    const tip = pin ? "This branch doesn't match the current filters but is still selected" : undefined
                    const up = b.upstream
                    return (
                      <tr key={b.name} className={`k2-row${pin ? ' pinned' : ''}${sel ? ' selected' : ''}`} title={tip}>
                        <td className="k2-col-check"><TriCheck label={b.name} checked={sel} onChange={() => setSelected(toggle(selected, b.name))} /></td>
                        <td className="k2-col-name"><span className="truncate">{b.name}</span></td>
                        <td className="k2-col-date secondary" title={new Date(b.lastCommitDate).toLocaleString()}>{relTime(b.lastCommitDate)}</td>
                        <td className="k2-col-merged center secondary">{b.merged ? 'Yes' : 'No'}</td>
                        <td className="k2-col-check">
                          {up?.type === 'remote' ? <TriCheck label={`Also delete remote branch ${b.name}`} disabled={!sel}
                            checked={!sel && deleteRemote.has(b.name) ? 'indeterminate' : deleteRemote.has(b.name)} onChange={() => setDeleteRemote(toggle(deleteRemote, b.name))} /> : null}
                        </td>
                        <td className="k2-col-remote">
                          <span className="k2-remote">
                            <span className="k2-remote-icon">{up?.type === 'remote' ? <Icon name="cloud-o" /> : up?.type === 'local' ? <Icon name="laptop-o" className="text-disabled" /> : null}</span>
                            <span className={`truncate${up ? '' : ' secondary'}`}>
                              {up?.type === 'remote' ? up.remoteName : up?.type === 'local' ? 'Local' : 'None'}
                              {up?.type === 'remote' && up.branchName !== b.name ? <span className="muted">/{up.branchName}</span> : null}
                            </span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>
        <div className="k2-alert" style={{ visibility: remoteCount > 0 ? 'visible' : 'hidden' }}>
          <Icon name="warning" className="k2-alert-icon" />
          <span>{remoteWarning(remoteCount)}</span>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-primary btn-medium" disabled={selected.size === 0 || busy} onClick={() => void remove()}>{deleteButtonLabel(selected.size, remoteCount)}</button>
        <button className="btn btn-default btn-medium" onClick={closeModal}>Cancel</button>
      </div>
    </div>
  )
}
