import { useEffect, useRef, useState } from 'react'

interface Tip { text: string; x: number; y: number; place: 'top' | 'bottom' | 'right'; shift: number; /** inside the left panel: instant, bootstrap look */ lp?: boolean; toolbar?: boolean }

let flashTo: ((el: HTMLElement, text: string, place: 'right' | 'bottom') => void) | null = null
/** a short confirmation bubble next to an element (right, or centred below like the commit sha's "Copied!") */
export function flashTip(el: HTMLElement, text: string, place: 'right' | 'bottom' = 'right'): void { flashTo?.(el, text, place) }

/**
 * Global tooltip layer. Any element with a `title` gets the original's dark bootstrap-style tooltip
 * (black, 12px, arrow, placed below) instead of the native OS tooltip.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | null>(null)
  const current = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const clear = () => {
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
      current.current = null
      setTip(null)
    }
    const onOver = (e: MouseEvent) => {
      let el = e.target as HTMLElement | null
      while (el && el !== document.body) {
        // elements the original gives a native OS tooltip (graph cells) keep their title
        if (el.hasAttribute?.('data-native-title')) { if (current.current) clear(); return }
        if (el instanceof Element && el.hasAttribute('title') && !(el instanceof SVGTitleElement)) {
          const t = el.getAttribute('title') ?? ''
          el.removeAttribute('title')
          if (t) el.setAttribute('data-gk-title', t)
          else el.removeAttribute('data-gk-title')
        }
        if (el.hasAttribute?.('data-gk-title')) break
        // svg <title> children (icons) — ignore, the native one is suppressed by pointer handling
        el = el.parentElement
      }
      if (!el || el === document.body) { if (current.current) clear(); return }
      if (el === current.current) return
      clear()
      current.current = el
      const target = el
      const lp = !!target.closest('.left-panel')
      // toolbar buttons show their tooltip at once, 8px below the button (like the original)
      const inToolbar = !!target.closest('.toolbar')
      timer.current = window.setTimeout(() => {
        if (!target.isConnected) return
        const text = target.getAttribute('data-gk-title')
        if (!text) return
        const r = target.getBoundingClientRect()
        if (lp && target.closest('.lp-header') && target.matches('button')) { setTip({ text, x: r.right + 7, y: r.top + r.height / 2, place: 'right', shift: 0, lp }); return }
        const below = r.bottom + 40 < window.innerHeight
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + (inToolbar ? 8 : 5) : r.top - 5, place: below ? 'bottom' : 'top', shift: 0, lp, toolbar: inToolbar })
      }, lp || inToolbar ? 0 : 450)
    }
    let flashTimer: number | null = null
    flashTo = (el, text, place) => {
      clear()
      if (flashTimer) window.clearTimeout(flashTimer)
      const r = el.getBoundingClientRect()
      setTip(place === 'bottom' ? { text, x: r.left + r.width / 2, y: r.bottom + 5, place: 'bottom', shift: 0 } : { text, x: r.right + 6, y: r.top + r.height / 2, place: 'right', shift: 0 })
      flashTimer = window.setTimeout(() => { flashTimer = null; setTip(null) }, 1500)
    }
    const onDown = () => clear()
    // the element under the tooltip can disappear or stop being hovered without any mouse event
    // (re-render after a click, keyboard shortcut): drop the tooltip then too
    const watch = window.setInterval(() => {
      const el = current.current
      if (el && (!el.isConnected || !el.matches(':hover'))) clear()
    }, 300)
    document.addEventListener('click', onDown, true)
    document.addEventListener('keydown', onDown, true)
    document.addEventListener('mouseover', onOver, true)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('wheel', onDown, { capture: true, passive: true })
    window.addEventListener('blur', onDown)
    return () => {
      flashTo = null
      if (flashTimer) window.clearTimeout(flashTimer)
      window.clearInterval(watch)
      document.removeEventListener('click', onDown, true)
      document.removeEventListener('keydown', onDown, true)
      document.removeEventListener('mouseover', onOver, true)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('wheel', onDown, true)
      window.removeEventListener('blur', onDown)
    }
  }, [])

  // keep the bubble inside the window, moving the arrow instead
  const [pos, setPos] = useState<{ left: number; top: number; shift: number } | null>(null)
  useEffect(() => {
    if (!tip) { setPos(null); return }
    const el = tipRef.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight
    if (tip.place === 'right') { setPos({ left: tip.x, top: tip.y - h / 2, shift: 0 }); return }
    let left = tip.x - w / 2
    const min = 4, max = window.innerWidth - w - 4
    const clamped = Math.max(min, Math.min(max, left))
    const shift = left - clamped
    left = clamped
    setPos({ left, top: tip.place === 'bottom' ? tip.y : tip.y - h, shift })
  }, [tip])

  if (!tip) return null
  return (
    <div ref={tipRef} className={`gk-tooltip ${tip.place}${tip.lp ? ' lp-tip' : ''}${tip.toolbar ? ' toolbar-tip' : ''}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, ['--arrow-shift' as string]: `${pos?.shift ?? 0}px`, visibility: pos ? 'visible' : 'hidden' }}>
      {tip.text}
    </div>
  )
}
