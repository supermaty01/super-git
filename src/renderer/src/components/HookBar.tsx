import { useState } from 'react'
import { useStore, setState } from '../store'

/** The red bar above the status bar after a commit hook failed: "View Log" shows the hook output, "Dismiss" closes it. */
export function HookBar() {
  const failure = useStore((s) => s.hookFailure)
  const [log, setLog] = useState(false)
  if (!failure) return null
  const dismiss = () => { setLog(false); setState({ hookFailure: null }) }
  return (
    <>
      {log ? (
        <div className="hook-log">
          <div className="hook-log-title">{failure.title}</div>
          <pre>{failure.log || 'The hook printed no output.'}</pre>
        </div>
      ) : null}
      <div className="hook-bar">
        <span className="hook-bar-text">{failure.title}</span>
        <button className="hook-bar-btn" onClick={() => setLog((v) => !v)}>View Log</button>
        <button className="hook-bar-btn" onClick={dismiss}>Dismiss</button>
      </div>
    </>
  )
}
