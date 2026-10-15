import { Fragment, useEffect, useRef, useState } from 'react'
import HistoryPanel from './HistoryPanel'
import RentCell from './RentCell'
import { addDays, mondayOf, money, shortDate, weekSpan } from './format'
import type { CellValue, Grid, GridRow, MoneyPair } from './types'

interface Props {
  grid: Grid
  rows: GridRow[]
  onCell: (row: GridRow, week: string, next: CellValue | null) => void
  onRent: (row: GridRow, value: number) => void
  onStart: (row: GridRow, week: string) => void
  onPickRenter: (row: GridRow) => void
  onReturned: (row: GridRow) => void
  onRemove: (row: GridRow) => void
}

type Col =
  | { kind: 'week'; week: string; month: string; shadow: boolean }
  | { kind: 'month'; month: string }

// Column widths in px. The week columns have no width of their own: they share what is left, so
// the table always fills the box (and scrolls sideways when the box is too narrow).
const W = { car: 96, renter: 156, rent: 72, starts: 120, week: 80, month: 88, owing: 88, actions: 64 }

const STICKY_CAR = 'sticky left-0 z-10 bg-surface'
const STICKY_RENTER = 'sticky md:left-[96px] z-10 bg-surface border-r'

const clock = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 7v5l3 2" />
  </svg>
)

// The Rent Tracker table: one row per car the owner added, one column per week, a total per
// month. Under a row, History opens with the money of the earlier renters of that car.
export default function RentTable({ grid, rows, onCell, onRent, onStart, onPickRenter, onReturned, onRemove }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(0)
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  // History is as wide as the visible part of the table, and stays in view when it is scrolled sideways.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setViewW(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [])

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    return next
  })

  const cols: Col[] = []
  const spans: { label: string; span: number }[] = []
  for (const g of grid.groups) {
    const before = cols.length
    if (g.shadow) cols.push({ kind: 'week', week: g.shadow, month: g.month, shadow: true })
    for (const w of g.weeks) cols.push({ kind: 'week', week: w, month: g.month, shadow: false })
    cols.push({ kind: 'month', month: g.month })
    spans.push({ label: g.label, span: cols.length - before })
  }
  const colKey = (c: Col) => (c.kind === 'month' ? 'm' + c.month : c.week + (c.shadow ? 's' : ''))
  const total = 4 + cols.length + 2
  const minWidth = W.car + W.renter + W.rent + W.starts + W.owing + W.actions + cols.reduce((n, c) => n + (c.kind === 'month' ? W.month : W.week), 0)

  const th = 'sticky z-20 bg-surface2 border-b border-border px-2 py-2 text-xs font-medium text-text-secondary'

  return (
    <div ref={boxRef} className="overflow-auto max-h-[calc(100vh-300px)] min-h-[260px] border border-border rounded-xl bg-surface">
      <table className="w-full table-fixed text-sm border-separate border-spacing-0" style={{ minWidth }}>
        <colgroup>
          <col style={{ width: W.car }} />
          <col style={{ width: W.renter }} />
          <col style={{ width: W.rent }} />
          <col style={{ width: W.starts }} />
          {cols.map(c => (c.kind === 'month' ? <col key={colKey(c)} style={{ width: W.month }} /> : <col key={colKey(c)} />))}
          <col style={{ width: W.owing }} />
          <col style={{ width: W.actions }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} className={`${th} top-0 left-0 z-30 text-left`}>Car</th>
            <th rowSpan={2} className={`${th} top-0 md:left-[96px] z-30 text-left border-r`}>Renter</th>
            <th rowSpan={2} className={`${th} top-0 text-right`}>Rent/week</th>
            <th rowSpan={2} className={`${th} top-0 text-left`}>Rent starts</th>
            {spans.map(s => <th key={s.label} colSpan={s.span} className={`${th} top-0 text-center border-l`}>{s.label}</th>)}
            <th rowSpan={2} className={`${th} top-0 right-0 md:right-[64px] z-30 text-right border-l`}>Owing</th>
            <th rowSpan={2} className={`${th} top-0 md:right-0 z-30 border-l`}><span className="sr-only">Actions</span></th>
          </tr>
          <tr>
            {cols.map(c => c.kind === 'month' ? (
              <th key={colKey(c)} className={`${th} top-[33px] text-right`}>Month total</th>
            ) : (
              <th key={colKey(c)} className={`${th} top-[33px] text-right ${
                c.week === grid.currentWeek ? '!bg-accent-bg !text-accent' : ''
              } ${c.shadow ? 'opacity-60' : ''}`} title={weekSpan(c.week)}>
                <span className="block">{shortDate(c.week)}</span>
                <span className="block font-normal text-[10px] text-text-muted">
                  {c.shadow ? 'last month' : c.week === grid.currentWeek ? 'this week' : 'to ' + shortDate(addDays(c.week, 6))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const isOpen = open.has(row.vehicleId)
            const hasEarlier = row.earlier > 0
            return (
              <Fragment key={row.vehicleId}>
                <tr>
                  <td className={`${STICKY_CAR} border-b border-border px-3 py-1.5`}>
                    <div className="font-mono font-semibold text-text-primary">{row.plate}</div>
                    <div className="text-[11px] text-text-muted truncate">{row.model}</div>
                  </td>
                  <td className={`${STICKY_RENTER} border-b border-border px-1.5 py-1`}>
                    {row.renter ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => onPickRenter(row)} title="Change renter" className="min-w-0 flex-1 text-left rounded-md px-1.5 py-1 hover:bg-surface2">
                          <span className="block text-sm font-medium text-text-primary truncate">{row.renter.name}</span>
                          <span className="block text-[11px] text-text-muted truncate">{row.renter.phone}</span>
                        </button>
                        <button onClick={() => onReturned(row)} title="Car returned" aria-label={`Car returned ${row.plate}`} className="shrink-0 p-1.5 rounded-md text-text-muted hover:text-red hover:bg-surface2">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                            <path d="M9 14L4 9l5-5" />
                            <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => onPickRenter(row)} className="w-full text-left text-sm text-text-muted hover:text-accent rounded-md px-1.5 py-2 hover:bg-surface2">
                        + Add renter
                      </button>
                    )}
                  </td>
                  <td className="border-b border-border p-0.5">
                    <RentCell
                      coord={`${r}:rent`}
                      label={`Weekly rent ${row.plate}`}
                      value={row.weeklyRent > 0 ? { amount: row.weeklyRent, nd: false } : undefined}
                      placeholder="set"
                      noNd
                      tone="normal"
                      onCommit={next => onRent(row, next?.amount ?? 0)}
                    />
                  </td>
                  <td className="border-b border-border px-1.5">
                    {row.renter ? (
                      <input
                        key={row.startWeek}
                        type="date"
                        aria-label={`Rent starts ${row.plate}`}
                        title={row.startIsCustom ? 'Rent counts from this week (you chose it)' : 'Rent counts from this week (when the car was given to the renter)'}
                        defaultValue={row.startWeek}
                        onBlur={e => {
                          const v = e.target.value
                          if (v >= '2000-01-01' && v <= '2100-12-31' && mondayOf(v) !== row.startWeek) onStart(row, mondayOf(v))
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        className="w-[108px] px-1.5 py-1 text-xs bg-transparent border border-transparent rounded text-text-secondary focus:border-accent focus:outline-none"
                      />
                    ) : <span className="px-1.5 text-text-muted">-</span>}
                  </td>
                  {cols.map(c => {
                    if (c.kind === 'month') {
                      return (
                        <td key={colKey(c)} className="border-b border-border border-l bg-surface2 px-2 text-right font-semibold text-text-primary whitespace-nowrap">
                          {row.renter ? money(row.monthTotals[c.month] ?? 0) : <span className="font-normal text-text-muted">-</span>}
                        </td>
                      )
                    }
                    const entry = row.entries[c.week]
                    const counted = !!row.renter && c.week >= row.startWeek
                    const tone = !counted ? 'before' : !entry && c.week <= grid.currentWeek ? 'unpaid' : 'normal'
                    return (
                      <td key={colKey(c)} className="border-b border-border p-0.5">
                        <RentCell
                          coord={`${r}:${c.week}`}
                          label={`Rent received ${row.plate} week of ${shortDate(c.week)}`}
                          value={entry}
                          readOnly={c.shadow}
                          disabled={!row.renter && !c.shadow}
                          tone={tone}
                          onCommit={next => onCell(row, c.week, next)}
                        />
                      </td>
                    )
                  })}
                  <td className="sticky right-0 md:right-[64px] z-10 bg-surface border-b border-border border-l px-2 text-right whitespace-nowrap">
                    {row.renter
                      ? <span className={row.owing > 0 ? 'font-semibold text-red' : 'text-green'}>{money(row.owing)}</span>
                      : <span className="text-text-muted">-</span>}
                  </td>
                  <td className="md:sticky md:right-0 z-10 bg-surface border-b border-border border-l px-1">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        onClick={() => toggle(row.vehicleId)}
                        aria-label={`History ${row.plate}`}
                        aria-expanded={isOpen}
                        title={hasEarlier ? `History - earlier renters paid ${money(row.earlier)}` : 'History'}
                        className={`p-1 rounded-md hover:bg-surface2 ${isOpen ? 'bg-accent-bg text-accent' : hasEarlier ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
                      >
                        {clock}
                      </button>
                      <button
                        onClick={() => onRemove(row)}
                        aria-label={`Remove ${row.plate} from the Rent Tracker`}
                        title="Take this car off the Rent Tracker"
                        className="p-1 rounded-md text-text-muted hover:text-red hover:bg-surface2"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="w-4 h-4">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={total} className="border-b border-border bg-surface2 p-0">
                      <div className="sticky left-0 max-w-full" style={viewW ? { width: viewW } : undefined}>
                        <HistoryPanel row={row} onClose={() => toggle(row.vehicleId)} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          <tr aria-hidden="true">
            <td colSpan={total} className="h-4 p-0 bg-surface2" />
          </tr>
        </tbody>
        <tfoot>
          {(['received', 'expected'] as const).map((kind, i) => {
            const bottom = i === 0 ? 'bottom-10' : 'bottom-0'
            return (
              <tr key={kind}>
                <td className={`sticky left-0 ${bottom} z-20 bg-surface h-10 px-3 text-xs font-semibold text-text-secondary border-t border-border whitespace-nowrap`}>
                  {kind === 'received' ? 'Received' : 'Expected'}
                </td>
                <td className={`sticky md:left-[96px] ${bottom} z-20 bg-surface border-r h-10 px-3 text-[11px] text-text-muted border-t border-border`}>all cars</td>
                <td className={`sticky ${bottom} z-10 bg-surface border-t border-border`} colSpan={2} />
                {cols.map(c => {
                  const pair: MoneyPair | undefined = c.kind === 'month' ? grid.totals.months[c.month] : c.shadow ? undefined : grid.totals.weeks[c.week]
                  const earlier = kind === 'received' && pair ? pair.earlier : 0
                  return (
                    <td key={colKey(c)}
                      className={`sticky ${bottom} z-10 bg-surface border-t border-border px-2 text-right text-xs font-semibold whitespace-nowrap ${
                        kind === 'received' ? 'text-text-primary' : 'text-text-muted'
                      } ${c.kind === 'month' ? 'border-l' : ''}`}>
                      {pair ? money(pair[kind]) : ''}
                      {earlier > 0 && <span title={`Includes ${money(earlier)} from earlier renters`} className="ml-0.5 text-accent cursor-help">*</span>}
                    </td>
                  )
                })}
                <td className={`sticky right-0 md:right-[64px] ${bottom} z-20 bg-surface border-t border-border border-l px-2 text-right text-xs font-semibold text-red`}>
                  {kind === 'received' ? money(grid.totals.overall.owing) : ''}
                </td>
                <td className={`sticky md:right-0 ${bottom} z-20 bg-surface border-t border-border border-l`} />
              </tr>
            )
          })}
        </tfoot>
      </table>
    </div>
  )
}
