import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { money, weekLabel } from './format'
import type { GridRow, History, HistoryWeek } from './types'

interface Props {
  row: GridRow
  onClose: () => void
}

function Weeks({ weeks }: { weeks: HistoryWeek[] }) {
  return (
    <ul className="mt-2 grid gap-x-8 gap-y-0.5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {weeks.map(w => (
        <li key={w.weekStart} className="flex items-baseline justify-between gap-3 text-sm border-b border-border py-0.5">
          <span className="text-text-secondary">{weekLabel(w.weekStart)}</span>
          <span className={w.nd ? 'text-amber font-semibold' : w.amount === 0 ? 'text-text-muted' : 'text-text-primary font-medium'}>
            {w.nd ? 'ND (no rent due)' : w.amount === 0 ? '$0 (no reminder)' : money(w.amount ?? 0)}
          </span>
        </li>
      ))}
    </ul>
  )
}

// The money story of one number plate, read when opened: the total for the plate, the renter now,
// and every earlier renter with what they paid week by week. It only shows; nothing is typed here.
export default function HistoryPanel({ row, onClose }: Props) {
  const [data, setData] = useState<History | null>(null)
  const [error, setError] = useState('')
  const latest = useRef(0)

  const load = useCallback(async () => {
    const mine = ++latest.current
    try {
      const res = await axios.get<History>(`/api/rent-tracker/history/${row.vehicleId}`)
      if (mine === latest.current) { setData(res.data); setError('') }
    } catch (err: any) {
      if (mine === latest.current) setError(err.response?.data?.error || 'Could not load the history')
    }
  }, [row.vehicleId])

  // Read again, quietly, when the renter or the money of this row changes while History is open.
  useEffect(() => { load() }, [load, row.renter?._id, row.earlier, row.received])

  const empty = !!data && data.total === 0 && data.previous.length === 0 && !data.noRenter

  return (
    <div role="region" aria-label={`History for ${row.plate}`} className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h3 className="text-sm font-semibold text-text-primary">History of <span className="font-mono">{row.plate}</span></h3>
          {data && <p className="text-sm text-text-secondary">Total money for this plate: <strong className="text-text-primary">{money(data.total)}</strong></p>}
        </div>
        <button onClick={onClose} aria-label={`Close history for ${row.plate}`} className="text-xs text-text-muted hover:text-text-primary underline">Close</button>
      </div>

      {!data && !error && <p className="mt-2 text-sm text-text-muted">Loading history...</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red">{error} <button onClick={load} className="underline">Try again</button></p>}

      {data && (
        <>
          <p className="mt-1 text-sm text-text-secondary">
            {data.current
              ? <>Now: <strong className="text-text-primary">{data.current.renter.name}</strong>{data.current.renter.phone ? ` (${data.current.renter.phone})` : ''} - {money(data.current.total)} so far (see the row above)</>
              : 'Nobody has this car now.'}
          </p>
          {empty && <p className="mt-2 text-sm text-text-muted">Nothing else to show yet - no money has been entered for earlier renters of this plate.</p>}

          {data.previous.length > 0 && <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Earlier renters, newest first</p>}
          {data.previous.map(p => (
            <section key={p.renter._id ?? p.renter.name} aria-label={`Earlier renter ${p.renter.name}`} className="mt-2 rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <p className="text-sm font-medium text-text-primary">
                  {p.renter.name}{p.renter.phone && <>{' '}<span className="ml-1 font-normal text-text-muted">{p.renter.phone}</span></>}
                </p>
                <p className="text-sm text-text-secondary">Paid in total <strong className="text-text-primary">{money(p.total)}</strong></p>
              </div>
              <Weeks weeks={p.weeks} />
            </section>
          ))}

          {data.noRenter && (
            <section aria-label="Money typed when nobody had the car" className="mt-2 rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <p className="text-sm font-medium text-text-primary">Money typed when nobody had the car</p>
                <p className="text-sm text-text-secondary">Total <strong className="text-text-primary">{money(data.noRenter.total)}</strong></p>
              </div>
              <Weeks weeks={data.noRenter.weeks} />
            </section>
          )}
        </>
      )}
    </div>
  )
}
