import { Fragment, useEffect, useRef, useState } from 'react'
import HistoryPanel from './HistoryPanel'
import RentCell from './RentCell'
import WeekDetail from './WeekDetail'
import { addDays, isBlank, mondayOf, money, plain, shortDate, weekSpan } from './format'
import type { CellValue, Grid, GridRow, MoneyPair } from './types'

interface Props {
  grid: Grid
  rows: GridRow[]
  onCell: (row: GridRow, week: string, next: CellValue | null) => void
  onDays: (row: GridRow, week: string, days: number) => void
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
// the table always fills the box (and scrolls sideways when the box is too narrow). A week column
// is wide enough for the days row (7 6 5 4 3 2 1) and the small calculation under the box; the
// last-month week at the start is only shown, so it is narrow. The last column holds the arrow
// that rolls a row down.
const W = { car: 96, renter: 156, rent: 72, starts: 120, week: 100, shadow: 72, month: 88, owing: 88, actions: 64 }

const STICKY_CAR = 'sticky left-0 z-10 bg-surface'
const STICKY_RENTER = 'sticky md:left-[96px] z-10 bg-surface border-r'

const icon = 'w-4 h-4'
const clock = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={icon}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 7v5l3 2" />
  </svg>
)
const trash = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={icon}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

// The little buttons inside a rolled-down row.
const BAND_BTN = 'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium'

// The Rent Tracker table: one row per car the owner added, one column per week, a total per
// month. A row is short: the week boxes, the month totals and Owing. The arrow at the end of a row
// rolls down a band under it with the days row and the small calculation of every week, and the
// History and Delete row buttons. History opens the money of the earlier renters of that car.
export default function RentTable({ grid, rows, onCell, onDays, onRent, onStart, onPickRenter, onReturned, onRemove }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(0)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [rolled, setRolled] = useState<Set<string>>(() => new Set())

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

  // A table that is wider than its box opens at the right end, where the newest weeks, the month
  // total and Owing are. It does not jump back while you type: only another month (or the 6 month
  // view) does.
  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [grid.window.end, grid.window.months])

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    return next
  })

  // The arrow rolls a row down or up. Every row starts closed; rolling a row up also closes its History.
  const roll = (id: string) => {
    const wasRolled = rolled.has(id)
    setRolled(prev => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
    if (wasRolled) setOpen(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  // A row that is gone from the table (deleted) forgets that it was rolled down: when it is restored
  // it comes back closed.
  useEffect(() => {
    const ids = new Set(grid.rows.map(r => r.vehicleId))
    const keep = (prev: Set<string>) => {
      let all = true
      prev.forEach(id => { if (!ids.has(id)) all = false })
      return all ? prev : new Set(Array.from(prev).filter(id => ids.has(id)))
    }
    setRolled(keep)
    setOpen(keep)
  }, [grid.rows])

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
  const colWidth = (c: Col) => (c.kind === 'month' ? W.month : c.shadow ? W.shadow : W.week)
  const minWidth = W.car + W.renter + W.rent + W.starts + W.owing + W.actions + cols.reduce((n, c) => n + colWidth(c), 0)

  const th = 'sticky z-20 bg-surface2 border-b border-border px-2 py-2 text-xs font-medium text-text-secondary'

  return (
    <div ref={boxRef} className="overflow-auto max-h-[calc(100vh-300px)] min-h-[260px] border border-border rounded-xl bg-surface">
      <table className="w-full table-fixed text-sm border-separate border-spacing-0" style={{ minWidth }}>
        <colgroup>
          <col style={{ width: W.car }} />
          <col style={{ width: W.renter }} />
          <col style={{ width: W.rent }} />
          <col style={{ width: W.starts }} />
          {cols.map(c => (c.kind === 'month' ? <col key={colKey(c)} style={{ width: W.month }} /> : c.shadow ? <col key={colKey(c)} style={{ width: W.shadow }} /> : <col key={colKey(c)} />))}
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
            <th rowSpan={2} className={`${th} top-0 md:right-0 z-30 border-l`}><span className="sr-only">Details</span></th>
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
            const isRolled = rolled.has(row.vehicleId)
            const isOpen = isRolled && open.has(row.vehicleId)
            const hasEarlier = row.earlier > 0
            const hasDays = !!row.calc && Object.keys(row.calc).length > 0
            // a rolled-down row has no line between it and its band
            const bb = isRolled ? 'border-b border-transparent' : 'border-b border-border'
            return (
              <Fragment key={row.vehicleId}>
                <tr>
                  <td className={`${STICKY_CAR} ${bb} px-3 py-1.5 align-top`}>
                    <div className="font-mono font-semibold text-text-primary">{row.plate}</div>
                    <div className="text-[11px] text-text-muted truncate">{row.model}</div>
                  </td>
                  <td className={`${STICKY_RENTER} ${bb} px-1.5 py-1 align-top`}>
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
                  <td className={`${bb} px-0.5 pt-1.5 pb-0.5 align-top`}>
                    <RentCell
                      coord={`${r}:rent`}
                      label={`Weekly rent ${row.plate}`}
                      value={row.weeklyRent > 0 ? { amount: row.weeklyRent, nd: false, days: 7 } : undefined}
                      placeholder="set"
                      noNd
                      tone="normal"
                      onCommit={next => onRent(row, next?.amount ?? 0)}
                    />
                  </td>
                  <td className={`${bb} px-1.5 pt-[11px] align-top`}>
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
                    ) : <span className="inline-block px-1.5 pt-[3px] text-text-muted">-</span>}
                  </td>
                  {cols.map(c => {
                    if (c.kind === 'month') {
                      return (
                        <td key={colKey(c)} className={`${bb} border-l bg-surface2 px-2 pt-3.5 align-top text-right font-semibold text-text-primary whitespace-nowrap`}>
                          {row.renter ? money(row.monthTotals[c.month] ?? 0) : <span className="font-normal text-text-muted">-</span>}
                        </td>
                      )
                    }
                    const entry = row.entries[c.week]
                    // A week counts for the renter from the start week up to this week (not ND): only then has
                    // it a small calculation. An empty box is red only when the renter is really behind after
                    // that week; when earlier money already pays the week it says "covered". A part week has a
                    // small "4d" in the box.
                    const calc = c.shadow ? undefined : row.calc?.[c.week]
                    const counted = !!row.renter && c.week >= row.startWeek
                    const tone = !counted ? 'before' : isBlank(entry) && !!calc && calc.bal < 0 ? 'unpaid' : 'normal'
                    return (
                      <td key={colKey(c)} className={`${bb} px-1 pt-1.5 pb-2 align-top`}>
                        <RentCell
                          boxed
                          coord={`${r}:${c.week}`}
                          label={`Rent received ${row.plate} week of ${shortDate(c.week)}`}
                          value={entry}
                          readOnly={c.shadow}
                          disabled={!row.renter && !c.shadow}
                          tone={tone}
                          partDays={calc && calc.days !== 7 ? calc.days : undefined}
                          covered={!!calc && isBlank(entry) && calc.bal >= 0}
                          onCommit={next => onCell(row, c.week, next)}
                        />
                      </td>
                    )
                  })}
                  <td
                    title={row.renter && row.ahead > 0 ? `Paid ahead by ${money(row.ahead)}` : undefined}
                    className={`sticky right-0 md:right-[64px] z-10 bg-surface ${bb} border-l px-2 pt-3.5 align-top text-right whitespace-nowrap`}
                  >
                    {row.renter ? (
                      <>
                        <div className={row.owing > 0 ? 'font-semibold text-red' : 'text-green'}>{money(row.owing)}</div>
                        {(row.expected > 0 || row.received > 0) && (
                          <div className="mt-1 text-[10px] leading-[1.35] tabular-nums text-stone-500 dark:text-stone-400">
                            due {plain(row.expected)}<br />paid {plain(row.received)}
                          </div>
                        )}
                      </>
                    ) : <span className="text-text-muted">-</span>}
                  </td>
                  <td className={`md:sticky md:right-0 z-10 bg-surface ${bb} border-l px-1 pt-[9px] align-top text-center`}>
                    <button
                      onClick={() => roll(row.vehicleId)}
                      aria-label={`${isRolled ? 'Hide' : 'Show'} details for ${row.plate}`}
                      aria-expanded={isRolled}
                      aria-controls={`rt-detail-${row.vehicleId}`}
                      title={isRolled ? 'Close' : 'Days of rent, History and Delete row'}
                      className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border ${
                        isRolled
                          ? 'border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-accent-bg text-accent'
                          : 'border-border bg-surface text-text-muted hover:bg-surface2 hover:text-text-primary'
                      }`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={`${icon} transition-transform ${isRolled ? 'rotate-180' : ''}`}>
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </td>
                </tr>
                {isRolled && (
                  <tr id={`rt-detail-${row.vehicleId}`}>
                    <td colSpan={2} className="md:sticky md:left-0 z-10 bg-surface2 border-b border-border border-r px-3 pt-1.5 pb-3 align-top">
                      <div className="text-[12.5px] font-bold text-stone-700 dark:text-stone-200">{hasDays ? 'Days of rent in each week' : 'More for this car'}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => toggle(row.vehicleId)}
                          aria-label={`History ${row.plate}`}
                          aria-expanded={isOpen}
                          title={hasEarlier ? `History - earlier renters paid ${money(row.earlier)}` : 'History'}
                          className={`${BAND_BTN} ${
                            isOpen ? 'border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-accent-bg text-accent'
                              : hasEarlier ? 'border-border bg-surface text-accent hover:bg-surface2'
                              : 'border-border bg-surface text-text-secondary hover:bg-surface2'
                          }`}
                        >
                          {clock} History
                        </button>
                        <button
                          onClick={() => onRemove(row)}
                          aria-label={`Delete row ${row.plate}`}
                          title="Delete this row (it goes to the Recycle bin for 30 days)"
                          className={`${BAND_BTN} border-[color-mix(in_srgb,var(--red)_35%,transparent)] bg-surface text-red hover:bg-red-bg`}
                        >
                          {trash} Delete row
                        </button>
                      </div>
                    </td>
                    <td colSpan={2} className="bg-surface2 border-b border-border px-2 pt-1.5 pb-3 align-top">
                      <p className="text-[11.5px] leading-[1.45] text-stone-500 dark:text-stone-400">
                        {hasDays
                          ? 'Car taken on a Tuesday = 6, on a Thursday = 4. A normal week = 7 (nothing to click).'
                          : row.renter ? 'Days of rent show here once the weekly rent is set and the rent has started.' : 'Days of rent show here once a renter has the car.'}
                      </p>
                    </td>
                    {cols.map(c => {
                      const calc = c.kind === 'week' && !c.shadow ? row.calc?.[c.week] : undefined
                      if (c.kind === 'week' && calc) {
                        return (
                          <td key={colKey(c)} className="bg-surface2 border-b border-border px-1 pt-1.5 pb-3 align-top">
                            <WeekDetail
                              calc={calc}
                              days={row.entries[c.week]?.days ?? 7}
                              coord={`${r}:${c.week}`}
                              label={`Days of rent ${row.plate} week of ${shortDate(c.week)}`}
                              onDays={days => onDays(row, c.week, days)}
                            />
                          </td>
                        )
                      }
                      return <td key={colKey(c)} className={`bg-surface2 border-b border-border ${c.kind === 'month' ? 'border-l' : ''}`} />
                    })}
                    <td className="sticky right-0 md:right-[64px] z-10 bg-surface2 border-b border-border border-l" />
                    <td className="md:sticky md:right-0 z-10 bg-surface2 border-b border-border border-l" />
                  </tr>
                )}
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
