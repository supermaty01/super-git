import type { ReactNode } from 'react'

/**
 * The original's custom checkbox (`gkDs-checkbox`): a 12x12 box (rgba(0,0,0,.2), 1px rgba(255,255,255,.45)
 * border, 1px radius) with a white check when ticked, and a label that is clickable on its text only.
 * Styles: styles/checkbox.css. Reusable anywhere a native checkbox would look out of place.
 */
export function Checkbox({ checked, onChange, disabled, children, className, title }: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children?: ReactNode
  className?: string
  title?: string
}) {
  return (
    <label className={`sg-checkbox${disabled ? ' disabled' : ''}${className ? ' ' + className : ''}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="sg-checkbox-box" aria-hidden="true">
        {checked ? <svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
      </span>
      {children !== undefined ? <span className="sg-checkbox-label">{children}</span> : null}
    </label>
  )
}
