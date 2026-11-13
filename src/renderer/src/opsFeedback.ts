// Feedback for long-running operations that is not part of one toolbar action: the submodule progress toast.
import { setState, toast, removeToast } from './store'

let timer: number | null = null
let toastId: number | null = null
let message = ''

/**
 * Progress events from the main process. "submodule-update" carries the path being updated (empty when finished);
 * like the original, the "Updating submodule | Path: ..." toast only appears when the update takes longer than 500 ms.
 */
export function handleProgress(e: { repo: string; op: string; text: string }): boolean {
  if (e.op === 'remote-message') {
    // "Remote: <name>" with the server's lines, cut at 400 characters
    try {
      const m = JSON.parse(e.text) as { remote: string; text: string }
      toast({ kind: 'info', title: `Remote: ${m.remote}`, message: m.text.length > 400 ? `${m.text.slice(0, 400)}...` : m.text })
    } catch { /* ignore */ }
    return true
  }
  if (e.op !== 'submodule-update') return false
  if (!e.text) {
    if (timer) { window.clearTimeout(timer); timer = null }
    if (toastId !== null) { removeToast(toastId); toastId = null }
    return true
  }
  message = `Path: ${e.text}`
  if (toastId !== null) {
    const id = toastId
    setState((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, message } : t)) }))
  } else if (!timer) {
    timer = window.setTimeout(() => { timer = null; toastId = toast({ kind: 'progress', title: 'Updating submodule', message }, 0) }, 500)
  }
  return true
}
