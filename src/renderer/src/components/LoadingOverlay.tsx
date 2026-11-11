import iconUrl from '../../../../build/icon.png'

/** Half-transparent cover with a spinner and a message, shown over a panel while an operation runs. */
export function LoadingOverlay({ message }: { message: string }) {
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
