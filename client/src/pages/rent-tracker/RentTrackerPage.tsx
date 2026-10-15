import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { useStore } from '../../store/useStore'
import RentTable from './RentTable'
import RenterPicker from './RenterPicker'
import { addMonths, money } from './format'
import type { CellValue, Grid, GridRow, MoneyPair, RenterHit } from './types'

function withEntry(entries: Record<string, CellValue>, week: string, next: CellValue | null) {
  const copy = { ...entries }
  if (next) copy[week] = next
  else delete copy[week]
  return copy
}

const patchRow = (id: string, patch: (r: GridRow) => GridRow) => (g: Grid): Grid => ({
  ...g,
  rows: g.rows.map(r => (r.vehicleId === id ? patch(r) : r)),
})

function Card({ title, main, sub }: { title: string; main: string; sub: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3">
      <p className="text-xs font-medium text-text-muted">{title}</p>
      <p className="text-2xl font-bold text-text-primary mt-0.5">{main}</p>
      <p className="text-xs text-text-secondary mt-0.5">{sub}</p>
    </div>
  )
}

const pill = 'px-3 py-2 rounded-lg text-sm font-medium border border-border bg-surface text-text-secondary hover:border-accent'

export default function RentTrackerPage() {
  const allowed = useStore(s => !!s.session?.features?.rentTracker)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [end, setEnd] = useState<string | undefined>(undefined)
  const [months, setMonths] = useState<1 | 6>(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState<GridRow | null>(null)
  const view = useRef({ end, months })
  view.current = { end, months }
  const latest = useRef(0)
  const busy = useRef(0)

  const load = useCallback(async (quiet = false) => {
    const mine = ++latest.current
    if (!quiet) setLoading(true)
    try {
      const { data } = await axios.get<Grid>('/api/rent-tracker/grid', { params: { month: view.current.end, months: view.current.months } })
      if (mine === latest.current) { setGrid(data); setError('') }
    } catch (err: any) {
      if (mine === latest.current) setError(err.response?.data?.error || 'Could not load the Rent Tracker')
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, end, months, load])

  // Every change is shown at once, sent to the server, and the table is reloaded when the last
  // pending save is done (so the totals always come from the server).
  async function save(request: () => Promise<unknown>, optimistic?: (g: Grid) => Grid) {
    busy.current++
    if (optimistic) setGrid(g => (g ? optimistic(g) : g))
    try {
      await request()
      setNotice('')
    } catch (err: any) {
      setNotice(err.response?.data?.error || 'Could not save - please try again')
    } finally {
      busy.current--
      if (busy.current === 0) load(true)
    }
  }

  const onCell = (row: GridRow, week: string, next: CellValue | null) =>
    save(
      () => axios.put('/api/rent-tracker/entry', { vehicleId: row.vehicleId, weekStart: week, amount: next ? next.amount : null, nd: next?.nd ? true : undefined }),
      patchRow(row.vehicleId, r => ({ ...r, entries: withEntry(r.entries, week, next) })),
    )
  const onRent = (row: GridRow, value: number) =>
    save(() => axios.put(`/api/rent-tracker/row/${row.vehicleId}`, { weeklyRent: value }), patchRow(row.vehicleId, r => ({ ...r, weeklyRent: value })))
  const onStart = (row: GridRow, week: string) =>
    save(() => axios.put(`/api/rent-tracker/row/${row.vehicleId}`, { startWeek: week }), patchRow(row.vehicleId, r => ({ ...r, startWeek: week, startIsCustom: true })))

  // Giving a car to a renter, or taking it back, uses the same Fleet actions as the Renters page.
  async function assign(row: GridRow, hit: RenterHit) {
    setPicking(null)
    if (row.renter && !window.confirm(`Give ${row.plate} to ${hit.name}? ${row.renter.name} will no longer have this car.`)) return
    await save(() => axios.post(`/api/fleet/${encodeURIComponent(row.plate)}/assign`, { renterId: hit._id }))
  }
  async function returned(row: GridRow) {
    if (!window.confirm(`Mark ${row.plate} as returned? The car becomes Available in Fleet and the Owing for ${row.renter?.name} stops counting.`)) return
    await save(() => axios.post(`/api/fleet/${encodeURIComponent(row.plate)}/unassign`))
  }

  if (!allowed) {
    return <div className="flex-1 flex items-center justify-center p-8 text-sm text-text-muted">Rent Tracker is not available for this account.</div>
  }

  const q = query.trim().toLowerCase()
  const compact = q.replace(/[\s()-]/g, '')
  const rows = !grid ? [] : !q ? grid.rows : grid.rows.filter(r =>
    r.plate.toLowerCase().includes(q) || r.plate.toLowerCase().replace(/[\s-]/g, '').includes(compact) ||
    r.model.toLowerCase().includes(q) ||
    (!!r.renter && (r.renter.name.toLowerCase().includes(q) || r.renter.email.toLowerCase().includes(q) ||
      (compact !== '' && r.renter.phone.replace(/[\s()-]/g, '').includes(compact)))))

  // Arrows move from the month asked for last, so quick clicks add up while the table is still loading.
  const shownEnd = end ?? grid?.window.end
  const first = grid?.groups[0]
  const last = grid?.groups[grid.groups.length - 1]
  const onThisMonth = !!grid && grid.window.end === grid.today.slice(0, 7)
  const endPair: MoneyPair | undefined = grid && last ? grid.totals.months[last.month] : undefined

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      <div className="px-6 py-5 border-b border-border bg-surface">
        <h1 className="text-xl font-bold text-text-primary">Rent Tracker</h1>
        <p className="text-text-muted text-sm mt-0.5">Type the rent you receive each week. Empty = not paid, 0 = no reminder this week, ND = no rent due.</p>
      </div>

      <div className="px-6 py-5 space-y-4">
        {grid && endPair && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card title="This week" main={money(grid.totals.thisWeek.received)} sub={`Expected ${money(grid.totals.thisWeek.expected)}`} />
            <Card title={onThisMonth ? 'This month' : last!.label} main={money(endPair.received)} sub={`Expected ${money(endPair.expected)}`} />
            <Card title="Overall" main={money(grid.totals.overall.received)} sub={`Expected ${money(grid.totals.overall.expected)} - Owing ${money(grid.totals.overall.owing)}`} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search plate, name, mobile or email"
            aria-label="Search cars"
            className="w-72 px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-1 ml-auto">
            <button aria-label="Previous month" disabled={!shownEnd} onClick={() => shownEnd && setEnd(addMonths(shownEnd, -1))} className={pill}>&lt;</button>
            <span className="min-w-[230px] px-2 text-center text-sm font-semibold text-text-primary">
              {first && last ? (first === last ? first.label : `${first.label} - ${last.label}`) : '...'}
            </span>
            <button aria-label="Next month" disabled={!shownEnd} onClick={() => shownEnd && setEnd(addMonths(shownEnd, 1))} className={pill}>&gt;</button>
          </div>
          {grid && !onThisMonth && <button onClick={() => setEnd(undefined)} className={pill}>This month</button>}
          <button aria-pressed={months === 6} onClick={() => setMonths(months === 6 ? 1 : 6)} className={`${pill} ${months === 6 ? '!border-accent !text-accent' : ''}`}>
            {months === 6 ? 'Back to one month' : 'Last 6 months'}
          </button>
        </div>

        {notice && <p role="alert" className="text-sm text-red">{notice}</p>}
        {error && (
          <p role="alert" className="text-sm text-red">
            {error} <button onClick={() => load()} className="underline">Try again</button>
          </p>
        )}

        {!grid && loading && <p className="text-sm text-text-muted">Loading...</p>}
        {grid && grid.rows.length === 0 && <p className="text-sm text-text-muted">No cars yet. Add the plates in Rego Import first.</p>}
        {grid && grid.rows.length > 0 && rows.length === 0 && (
          <p className="text-sm text-text-muted">No car found for "{query.trim()}". Add the plate in Rego Import first.</p>
        )}
        {grid && rows.length > 0 && (
          <div className={loading ? 'opacity-60' : ''}>
            <RentTable grid={grid} rows={rows} onCell={onCell} onRent={onRent} onStart={onStart} onPickRenter={setPicking} onReturned={returned} />
          </div>
        )}
      </div>

      {picking && (
        <RenterPicker
          plate={picking.plate}
          currentRenterId={picking.renter?._id ?? null}
          onPick={hit => assign(picking, hit)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
