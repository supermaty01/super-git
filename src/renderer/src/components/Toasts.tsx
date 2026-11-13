import { useLayoutEffect, useRef } from 'react'
import { useStore, dismissToast } from '../store'
import { Icon } from './Icon'

const ICON = { error: 'x-circle', success: 'check-circle', info: 'info', progress: 'spinner' } as const

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const pos = useStore((s) => s.settings?.toastPosition ?? 'bottom-left')
  const tops = useRef(new Map<number, number>())
  const nodes = useRef(new Map<number, HTMLDivElement>())

  // the stack re-flows with a .23s transition when a toast leaves (FLIP: move back by the delta, then let it slide)
  useLayoutEffect(() => {
    const next = new Map<number, number>()
    nodes.current.forEach((el, id) => {
      const top = el.getBoundingClientRect().top
      next.set(id, top)
      const before = tops.current.get(id)
      if (before !== undefined && Math.abs(before - top) > 0.5) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${before - top}px)`
        void el.offsetHeight
        el.style.transition = 'transform .23s cubic-bezier(.21,1.02,.73,1)'
        el.style.transform = ''
      }
    })
    tops.current = next
  }, [toasts])

  // like the original: bottom stacks grow upwards from the first toast, top stacks grow downwards
  const side = pos.endsWith('right') ? 'right' : 'left'
  return (
    <div className={`toasts toasts-${pos}`}>
      {toasts.map((t) => (
        <div key={t.id} className={`toast-wrap toast-wrap-${side}${t.leaving ? ' leaving' : ''}`} ref={(el) => { if (el) nodes.current.set(t.id, el); else nodes.current.delete(t.id) }}>
          <div className={`toast toast-${t.kind}`}>
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
            {t.kind !== 'progress' ? <span className="toast-close pointer text-secondary" onClick={(e) => { e.stopPropagation(); dismissToast(t.id) }}><Icon name="times" /></span> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
