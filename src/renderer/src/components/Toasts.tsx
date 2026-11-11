import { useStore, dismissToast } from '../store'
import { Icon } from './Icon'

const ICON = { error: 'x-circle', success: 'check-circle', info: 'info', progress: 'spinner' } as const

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const pos = useStore((s) => s.settings?.toastPosition ?? 'bottom-left')
  return (
    <div className={`toasts toasts-${pos}`}>
      {toasts.map((t) => (
        // like the original: a coloured icon strip, title and message; clicking the card dismisses it
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => { if (t.kind !== 'progress' && !t.actions?.length) dismissToast(t.id) }}>
          <div className="toast-icon-box"><Icon name={ICON[t.kind]} spin={t.kind === 'progress'} /></div>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message ? <div className="toast-message">{t.message}</div> : null}
            {t.actions?.length ? (
              <div className="toast-actions">
                {t.actions.map((a) => <button key={a.label} className="btn btn-small" onClick={(e) => { e.stopPropagation(); a.run(); dismissToast(t.id) }}>{a.label}</button>)}
              </div>
            ) : null}
          </div>
          <span className="toast-close" onClick={(e) => { e.stopPropagation(); dismissToast(t.id) }}><Icon name="times" /></span>
        </div>
      ))}
    </div>
  )
}
