import { useRef } from 'react'

/** Vertical drag handle; reports horizontal deltas in CSS pixels. */
export function Resizer({ onDrag, onEnd, className, style }: { onDrag: (dx: number) => void; onEnd?: () => void; className?: string; style?: React.CSSProperties }) {
  const last = useRef(0)
  return (
    <div
      className={`resizer${className ? ' ' + className : ''}`}
      style={style}
      onMouseDown={(e) => {
        e.preventDefault()
        last.current = e.clientX
        const move = (ev: MouseEvent) => { const dx = ev.clientX - last.current; last.current = ev.clientX; if (dx) onDrag(dx) }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          document.body.classList.remove('resizing')
          onEnd?.()
        }
        document.body.classList.add('resizing')
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    />
  )
}
