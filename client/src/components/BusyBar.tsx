// Small "something is happening" pieces for buttons and cards that wait for the server
// (building a PDF, sending an e-mail). Only shown when the wait is long enough to notice.

/** A thin bar with a light that keeps sliding across it. */
export function BusyStrip({ className = '' }: { className?: string }) {
  return (
    <div role="progressbar" aria-label="Working" className={`h-0.5 w-full overflow-hidden rounded-full bg-surface2 ${className}`}>
      <div className="h-full w-1/3 rounded-full bg-accent animate-toll-bar motion-reduce:animate-none" />
    </div>
  )
}

/** The small turning wheel used inside buttons. */
export function Spinner({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`${className} animate-spin shrink-0`} aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}
