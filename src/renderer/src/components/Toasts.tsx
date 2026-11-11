import { useStore, dismissToast } from '../store'
import { Icon } from './Icon'

const ICON = { error: 'x-circle', success: 'check-circle', info: 'info', progress: 'spinner' } as const

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const pos = useStore((s) => s.settings?.toastPosition ?? 'bottom-left')
  return (
    <div className={`toasts toasts-${pos}`}>
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <Icon name={ICON[t.kind]} spin={t.kind === 'progress'} className="toast-icon" />
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message ? <div className="toast-message">{t.message}</div> : null}
            {t.actions?.length ? (
              <div className="toast-actions">
                {t.actions.map((a) => <button key={a.label} className="btn btn-xs" onClick={() => { a.run(); dismissToast(t.id) }}>{a.label}</button>)}
              </div>
            ) : null}
          </div>
          <span className="toast-close" onClick={() => dismissToast(t.id)}><Icon name="times" /></span>
        </div>
      ))}
    </div>
  )
}
