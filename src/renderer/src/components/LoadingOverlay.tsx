import { useEffect, useState } from 'react'
import iconUrl from '../../../../build/icon.png'

/**
 * Half-transparent cover with a spinner and a message, shown over a panel while an operation runs.
 * `delay`: like the original, quick operations (checkouts) never show it.
 */
export function LoadingOverlay({ message, delay = 0 }: { message: string; delay?: number }) {
  const [shown, setShown] = useState(delay <= 0)
  useEffect(() => {
    if (delay <= 0) return
    const t = window.setTimeout(() => setShown(true), delay)
    return () => window.clearTimeout(t)
  }, [delay])
  if (!shown) return null
  return (
    <div className="loading-overlay" data-testid="loading-overlay">
      <div className="loading-spinner">
        <div className="spinner">
          <img className="bg-img" src={iconUrl} alt="" />
          <span className="ring outer" />
          <span className="ring inner" />
        </div>
        <div className="message">{message}</div>
      </div>
    </div>
  )
}
