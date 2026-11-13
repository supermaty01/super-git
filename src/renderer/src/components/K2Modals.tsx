import { useState } from 'react'
import { useStore, closeModal, openModal, toast, activeRepoPath } from '../store'
import { api } from '../lib/api'
import { errMsg } from '../lib/format'
import { Icon } from './Icon'
import { parseHostKeyChanged, parseSslProblem } from '@shared/k2logic'
import '../styles/k2.css'

/** "REMOTE HOST IDENTIFICATION HAS CHANGED!": the original's modal with "Update known_hosts with new key" */
export function HostKeyChangedModal({ host, remote, detail }: { host: string; remote?: string; detail: string }) {
  const [busy, setBusy] = useState(false)
  const fix = async () => {
    setBusy(true)
    try {
      await api.sshForgetHost(host)
      closeModal()
      toast({ kind: 'success', title: 'known_hosts updated', message: `The old key of ${host} was removed. Retry the operation and accept the new key if it is correct.` })
    } catch (e) { toast({ kind: 'error', title: 'Could not update known_hosts', message: errMsg(e) }) } finally { setBusy(false) }
  }
  return (
    <div className="modal k2-hostkey" role="dialog">
      <div className="modal-header">
        <span className="k2-modal-title"><Icon name="warning" className="k2-warn" /> WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!</span>
        <span className="modal-close" onClick={closeModal}><Icon name="times" /></span>
      </div>
      <div className="modal-body">
        <div className="mb2">{remote ? <>Remote: {remote}</> : <>Host: {host}</>}</div>
        <pre className="k2-pre">{detail}</pre>
      </div>
      <div className="modal-footer">
        <button className="btn btn-default btn-medium" onClick={closeModal}>Cancel</button>
        <button className="btn btn-warning btn-medium" disabled={busy} onClick={() => void fix()}>Update known_hosts with new key</button>
      </div>
    </div>
  )
}

/** "SSL certificate problem": like the original's Invalid SSL Certificate modal, for git remotes */
export function InvalidSslModal({ url, detail, path }: { url: string; detail: string; path: string | null }) {
  const [advanced, setAdvanced] = useState(false)
  const proceed = async () => {
    if (!path) return
    try {
      await api.gitConfigSet(`http.${url}.sslVerify`, 'false', path)
      closeModal()
      toast({ kind: 'info', title: 'SSL verification turned off', message: `For ${url} in this repository (http.${url}.sslVerify=false). Retry the operation.` })
    } catch (e) { toast({ kind: 'error', title: 'Could not change the setting', message: errMsg(e) }) }
  }
  return (
    <div className="modal k2-ssl" role="dialog">
      <div className="modal-header">
        <span className="k2-modal-title"><Icon name="warning" className="k2-warn" /> Invalid SSL Certificate</span>
        <span className="modal-close" onClick={closeModal}><Icon name="times" /></span>
      </div>
      <div className="modal-body">
        <p>The remote <b>{url}</b> is using an invalid SSL certificate and the connection is not secure.</p>
        <pre className="k2-pre">{detail}</pre>
        <p>Please contact your system administrator to fix the certificate for this self-hosted server.</p>
        <div className="btn-link" onClick={() => setAdvanced((a) => !a)}>Advanced</div>
        {advanced ? <>
          <p className="text-secondary">Attackers may be attempting to steal information through this connection. Proceeding with an invalid SSL certificate is not safe.</p>
          <button className="btn btn-danger btn-small" disabled={!path} onClick={() => void proceed()}>Proceed with invalid SSL certificate (unsafe)</button>
        </> : null}
      </div>
      <div className="modal-footer"><button className="btn btn-default btn-medium" onClick={closeModal}>Close</button></div>
    </div>
  )
}

// error toasts from fetch / pull / push / clone: a changed host key or a bad certificate opens the modal
let seen = 0
useStore.subscribe((s) => {
  const last = s.toasts[s.toasts.length - 1]
  if (!last || last.id <= seen) return
  seen = last.id
  if (last.kind !== 'error' || s.modal) return
  const text = `${last.title}\n${last.message ?? ''}`
  const hk = parseHostKeyChanged(text)
  if (hk) { setTimeout(() => openModal('hostKeyChanged', { host: hk.host, detail: last.message ?? '' }), 0); return }
  const ssl = parseSslProblem(text)
  if (ssl) setTimeout(() => openModal('invalidSsl', { url: ssl.url, detail: ssl.problem, path: activeRepoPath() }), 0)
})
