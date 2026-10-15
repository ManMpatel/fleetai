import { useRef, useState } from 'react'
import { cellText, parseCell, sameCell } from './format'
import type { CellValue } from './types'

interface Props {
  value: CellValue | undefined
  label: string
  coord: string
  readOnly?: boolean
  disabled?: boolean
  noNd?: boolean
  placeholder?: string
  tone: 'normal' | 'before' | 'unpaid'
  onCommit: (next: CellValue | null) => void
}

const TONE = {
  normal: 'bg-transparent',
  before: 'bg-surface2 text-text-muted',
  unpaid: 'bg-red-bg',
}

// One money cell. Empty = not paid, a number = money received, 0 = no reminder this week,
// ND = no rent due. Saves when you leave the cell; Enter saves and moves down; Escape cancels.
// disabled = greyed out (nobody has the car); readOnly = shown but not editable (last month's week).
export default function RentCell({ value, label, coord, readOnly, disabled, noNd, placeholder, tone, onCommit }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const cancelled = useRef(false)

  const text = cellText(value)
  const look = value?.nd ? 'text-amber font-semibold' : value && value.amount === 0 ? 'text-text-muted' : 'text-text-primary'

  if (readOnly) {
    return <div className={`h-9 px-2 flex items-center justify-end text-sm opacity-50 ${look}`}>{text}</div>
  }
  // A car with nobody on it has no money to type: the cell is greyed out until a renter is added.
  if (disabled) {
    return (
      <div title="Add a renter first" data-cell-off={coord} className="h-9">
        <input disabled tabIndex={-1} aria-label={label} className="w-full h-9 px-2 rounded border border-transparent bg-surface2 opacity-60 cursor-not-allowed" />
      </div>
    )
  }

  function commit() {
    if (cancelled.current) { cancelled.current = false; setDraft(null); return }
    if (draft === null) return
    const parsed = parseCell(draft)
    setDraft(null)
    if (parsed.kind === 'bad' || (noNd && parsed.kind === 'nd')) {
      setBad(true)
      window.setTimeout(() => setBad(false), 1800)
      return
    }
    const next: CellValue | null =
      parsed.kind === 'empty' ? null : parsed.kind === 'nd' ? { amount: null, nd: true } : { amount: parsed.amount, nd: false }
    if (!sameCell(value, next)) onCommit(next)
  }

  function keys(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const [row, col] = coord.split(':')
      e.currentTarget.blur()
      // down to the next cell that can be typed in (cars with nobody on them are greyed out and skipped)
      for (let r = Number(row) + 1; ; r++) {
        const next = document.querySelector<HTMLInputElement>(`[data-cell="${r}:${col}"]`)
        if (next) { next.focus(); break }
        if (!document.querySelector(`[data-cell-off="${r}:${col}"]`)) break
      }
    } else if (e.key === 'Escape') {
      cancelled.current = true
      e.currentTarget.blur()
    }
  }

  return (
    <input
      data-cell={coord}
      aria-label={label}
      title={bad ? (noNd ? 'Type an amount like 250 or 250.50' : 'Type an amount like 250 or 250.50, or ND for no rent due') : undefined}
      placeholder={placeholder}
      value={draft ?? text}
      onFocus={e => { setDraft(text); e.target.select() }}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={keys}
      autoComplete="off"
      className={`w-full h-9 px-2 text-right text-sm rounded border outline-none transition-colors ${
        bad ? 'border-red' : 'border-transparent focus:border-accent'
      } ${look} ${TONE[tone]}`}
    />
  )
}
