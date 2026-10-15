import RentCell from './RentCell'
import { addDays, mondayOf, money, shortDate, weekSpan } from './format'
import type { CellValue, Grid, GridRow } from './types'

interface Props {
  grid: Grid
  rows: GridRow[]
  onCell: (row: GridRow, week: string, next: CellValue | null) => void
  onRent: (row: GridRow, value: number) => void
  onStart: (row: GridRow, week: string) => void
  onPickRenter: (row: GridRow) => void
  onReturned: (row: GridRow) => void
}

type Col =
  | { kind: 'week'; week: string; month: string; shadow: boolean }
  | { kind: 'month'; month: string }

const STICKY_CAR = 'sticky left-0 z-10 bg-surface'
const STICKY_RENTER = 'sticky md:left-[104px] z-10 bg-surface border-r'

// The Rent Tracker table: one row per car, one column per week, a total per month.
export default function RentTable({ grid, rows, onCell, onRent, onStart, onPickRenter, onReturned }: Props) {
  const cols: Col[] = []
  const spans: { label: string; span: number }[] = []
  for (const g of grid.groups) {
    const before = cols.length
    if (g.shadow) cols.push({ kind: 'week', week: g.shadow, month: g.month, shadow: true })
    for (const w of g.weeks) cols.push({ kind: 'week', week: w, month: g.month, shadow: false })
    cols.push({ kind: 'month', month: g.month })
    spans.push({ label: g.label, span: cols.length - before })
  }

  const th = 'sticky z-20 bg-surface2 border-b border-border px-2 py-2 text-xs font-medium text-text-secondary'

  return (
    <div className="overflow-auto max-h-[calc(100vh-300px)] min-h-[260px] border border-border rounded-xl bg-surface">
      <table className="min-w-max text-sm border-separate border-spacing-0">
        <thead>
          <tr>
            <th rowSpan={2} className={`${th} top-0 left-0 z-30 w-[104px] min-w-[104px] text-left`}>Car</th>
            <th rowSpan={2} className={`${th} top-0 md:left-[104px] z-30 w-[172px] min-w-[172px] text-left border-r`}>Renter</th>
            <th rowSpan={2} className={`${th} top-0 w-[80px] min-w-[80px] text-right`}>Rent/week</th>
            <th rowSpan={2} className={`${th} top-0 w-[128px] min-w-[128px] text-left`}>Rent starts</th>
            {spans.map(s => <th key={s.label} colSpan={s.span} className={`${th} top-0 text-center border-l`}>{s.label}</th>)}
            <th rowSpan={2} className={`${th} top-0 right-0 z-30 w-[92px] min-w-[92px] text-right border-l`}>Owing</th>
          </tr>
          <tr>
            {cols.map(c => c.kind === 'month' ? (
              <th key={'m' + c.month} className={`${th} top-[33px] w-[88px] min-w-[88px] text-right`}>Month total</th>
            ) : (
              <th key={c.week + (c.shadow ? 's' : '')} className={`${th} top-[33px] w-[84px] min-w-[84px] text-right ${
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
          {rows.map((row, r) => (
            <tr key={row.vehicleId}>
              <td className={`${STICKY_CAR} border-b border-border px-3 py-1.5`}>
                <div className="font-mono font-semibold text-text-primary">{row.plate}</div>
                <div className="text-[11px] text-text-muted truncate max-w-[84px]">{row.model}</div>
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
                    className="w-[116px] px-1.5 py-1 text-xs bg-transparent border border-transparent rounded text-text-secondary focus:border-accent focus:outline-none"
                  />
                ) : <span className="px-1.5 text-text-muted">-</span>}
              </td>
              {cols.map(c => {
                if (c.kind === 'month') {
                  return <td key={'m' + c.month} className="border-b border-border border-l bg-surface2 px-3 text-right font-semibold text-text-primary whitespace-nowrap">{money(row.monthTotals[c.month] ?? 0)}</td>
                }
                const entry = row.entries[c.week]
                const counted = !!row.renter && c.week >= row.startWeek
                const tone = !counted ? 'before' : !entry && c.week <= grid.currentWeek ? 'unpaid' : 'normal'
                return (
                  <td key={c.week + (c.shadow ? 's' : '')} className="border-b border-border p-0.5">
                    <RentCell
                      coord={`${r}:${c.week}`}
                      label={`Rent received ${row.plate} week of ${shortDate(c.week)}`}
                      value={entry}
                      readOnly={c.shadow}
                      tone={tone}
                      onCommit={next => onCell(row, c.week, next)}
                    />
                  </td>
                )
              })}
              <td className="sticky right-0 z-10 bg-surface border-b border-border border-l px-3 text-right whitespace-nowrap">
                {row.renter
                  ? <span className={row.owing > 0 ? 'font-semibold text-red' : 'text-green'}>{money(row.owing)}</span>
                  : <span className="text-text-muted">-</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {(['received', 'expected'] as const).map((kind, i) => (
            <tr key={kind}>
              <td className={`sticky left-0 ${i === 0 ? 'bottom-10' : 'bottom-0'} z-20 bg-surface h-10 px-3 text-xs font-semibold text-text-secondary border-t border-border whitespace-nowrap`}>
                {kind === 'received' ? 'Received' : 'Expected'}
              </td>
              <td className={`sticky md:left-[104px] ${i === 0 ? 'bottom-10' : 'bottom-0'} z-20 bg-surface border-r h-10 px-3 text-[11px] text-text-muted border-t border-border`}>all cars</td>
              <td className={`sticky ${i === 0 ? 'bottom-10' : 'bottom-0'} z-10 bg-surface border-t border-border`} colSpan={2} />
              {cols.map(c => (
                <td key={c.kind === 'month' ? 'm' + c.month : c.week + (c.shadow ? 's' : '')}
                  className={`sticky ${i === 0 ? 'bottom-10' : 'bottom-0'} z-10 bg-surface border-t border-border px-3 text-right text-xs font-semibold whitespace-nowrap ${
                    kind === 'received' ? 'text-text-primary' : 'text-text-muted'
                  } ${c.kind === 'month' ? 'border-l' : ''}`}>
                  {c.kind === 'month'
                    ? money(grid.totals.months[c.month]?.[kind] ?? 0)
                    : c.shadow ? '' : money(grid.totals.weeks[c.week]?.[kind] ?? 0)}
                </td>
              ))}
              <td className={`sticky right-0 ${i === 0 ? 'bottom-10' : 'bottom-0'} z-20 bg-surface border-t border-border border-l px-3 text-right text-xs font-semibold text-red`}>
                {kind === 'received' ? money(grid.totals.overall.owing) : ''}
              </td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  )
}
