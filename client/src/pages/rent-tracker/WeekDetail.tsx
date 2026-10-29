import { daysTip, plain, signed } from './format'
import type { WeekCalc } from './types'

interface Props {
  calc: WeekCalc
  days: number
  coord: string
  label: string
  onDays: (days: number) => void
}

// The days of rent in a week, counted from the day the car was taken: Monday = 7 ... Sunday = 1.
const DAYS = [7, 6, 5, 4, 3, 2, 1]

// What a rolled-down row shows under one week box: the days row (7 6 5 4 3 2 1; click a number to
// set the days of rent in that week, 7 is the normal full week) and the small calculation of the
// week in small stone-grey letters: money carried in, the total, the part week, and what is left or
// how far behind. Only the lines that have something to say are shown.
export default function WeekDetail({ calc, days, coord, label, onDays }: Props) {
  const lines: { text: string; strong?: boolean }[] = []
  const typedThisWeek = Math.round((calc.total - calc.carry) * 100) > 0
  if (calc.carry !== 0) lines.push({ text: `${signed(calc.carry)} carried in` })
  if (calc.carry !== 0 && typedThisWeek) lines.push({ text: `= ${plain(calc.total)} in total` })
  if (calc.days !== 7) lines.push({ text: `${calc.days} ${calc.days === 1 ? 'day' : 'days'} = ${plain(calc.due)}` })
  if (calc.bal > 0) lines.push({ text: `left ${plain(calc.bal)}` })
  else if (calc.bal < 0) lines.push({ text: `behind ${plain(-calc.bal)}`, strong: true })

  return (
    <div className="tabular-nums">
      <div role="group" aria-label={label} className="flex gap-0.5">
        {DAYS.map(d => (
          <button
            key={d}
            type="button"
            tabIndex={-1}
            title={daysTip(d)}
            aria-label={`${d} ${d === 1 ? 'day' : 'days'}`}
            aria-pressed={d === days}
            onClick={() => { if (d !== days) onDays(d) }}
            className={`flex-1 h-[17px] rounded text-[10px] leading-[17px] text-center ${
              d !== days ? 'text-text-muted hover:bg-surface hover:text-text-secondary'
                : d === 7 ? 'bg-surface text-text-secondary'
                : 'bg-accent text-white font-bold'
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      {lines.length > 0 && (
        <div data-calc={coord} className="mt-1 text-right text-[10px] leading-[1.35] text-stone-500 dark:text-stone-400">
          {lines.map(l => (
            <div key={l.text} className={l.strong ? 'font-bold text-stone-700 dark:text-stone-200' : undefined}>{l.text}</div>
          ))}
        </div>
      )}
    </div>
  )
}
