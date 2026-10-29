import { useEffect, useRef, useState } from 'react'
import { shortDate } from './format'

// A row waiting in the Recycle bin (GET /api/rent-tracker/bin). removedOn = the day it was deleted
// ('YYYY-MM-DD', null when not known), daysLeft = whole days before it is deleted for good.
export interface BinRow {
  vehicleId: string
  plate: string
  model: string
  weeklyRent: number
  removedOn: string | null
  daysLeft: number
}

export interface Bin {
  days: number
  rows: BinRow[]
}

interface Props {
  bin: Bin
  // Puts a row back on the table. Gives back '' when it worked, or the text to show when it did not.
  onRestore: (row: BinRow) => Promise<string>
  onClose: () => void
}

// 0 days left = the nightly clean-up has not run yet; 10 days or less = shown in red
function leftText(n: number): string {
  return n <= 0 ? 'Deleted soon' : n === 1 ? '1 day left' : `${n} days left`
}

// The Recycle bin window: the rows deleted in the last 30 days, newest first, each with the days it
// has left and a Restore button. A restored row goes back on the table with its weekly rent, its
// start date and all its money (the money is never touched by a delete).
export default function RecycleBin({ bin, onRestore, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (before && document.contains(before)) before.focus()
    }
  }, [])

  async function restore(row: BinRow) {
    setBusy(row.vehicleId)
    setError('')
    setDone('')
    const problem = await onRestore(row)
    setBusy(null)
    if (problem) setError(problem)
    else setDone(`${row.plate} is back on the table.`)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rt-bin-title"
        className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-lg p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="rt-bin-title" className="text-[17px] font-bold text-text-primary">Recycle bin</h2>
          <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary text-lg leading-none">x</button>
        </div>
        <p className="mt-1 text-[13.5px] text-text-muted">A deleted row stays here for {bin.days} days, then it is deleted for good.</p>

        {error && <p role="alert" className="mt-3 rounded-lg bg-red-bg px-3 py-2 text-xs text-red">{error}</p>}
        {done && <p role="status" className="mt-3 rounded-lg bg-green-bg px-3 py-2 text-xs font-semibold text-green">{done}</p>}

        <div className="mt-2 max-h-80 overflow-y-auto">
          {bin.rows.length === 0 && (
            <p className="px-1 py-4 text-sm text-text-muted">Nothing here. A row you delete from the table waits here for {bin.days} days.</p>
          )}
          {bin.rows.map(row => (
            <div key={row.vehicleId} className="mt-2 flex items-center gap-3 rounded-[10px] border border-border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <span className="font-mono text-sm font-bold text-text-primary">{row.plate}</span>
                  {row.model && <span className="text-sm text-text-muted"> &middot; {row.model}</span>}
                </div>
                <div className="text-xs text-text-muted">{row.removedOn ? `Deleted ${shortDate(row.removedOn)}` : 'Deleted (date not known)'}</div>
              </div>
              <span className={`whitespace-nowrap rounded-full px-[9px] py-0.5 text-xs font-semibold ${row.daysLeft <= 10 ? 'bg-red-bg text-red' : 'bg-amber-bg text-amber'}`}>
                {leftText(row.daysLeft)}
              </span>
              <button
                onClick={() => restore(row)}
                disabled={busy !== null}
                aria-label={`Restore ${row.plate}`}
                className="h-8 rounded-[9px] border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-accent-bg px-3.5 text-[13px] font-semibold text-accent hover:opacity-90 disabled:opacity-50"
              >
                {busy === row.vehicleId ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          ))}
        </div>

        {bin.rows.length > 0 && (
          <p className="mt-4 text-[12.5px] leading-[1.5] text-text-muted">Restore puts the row back on the table exactly as it was: its weekly rent, its start date and all its money.</p>
        )}
        <div className="mt-4 flex justify-end">
          <button ref={closeRef} onClick={onClose} className="h-[38px] rounded-[9px] border border-border bg-surface px-[18px] text-sm font-semibold text-text-secondary hover:bg-surface2">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
