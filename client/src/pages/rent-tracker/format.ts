import type { CellValue } from './types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86400000

// Dates here are plain 'YYYY-MM-DD' calendar dates (the Monday that names a week).
function utcOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function ymdOf(ms: number): string {
  const t = new Date(ms)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

export function addDays(ymd: string, n: number): string {
  return ymdOf(utcOf(ymd) + n * DAY_MS)
}

export function mondayOf(ymd: string): string {
  const day = new Date(utcOf(ymd)).getUTCDay()
  return addDays(ymd, -((day + 6) % 7))
}

// '2026-10' plus n months -> '2026-11' (n may be negative)
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

// '2026-10-12' -> '12 Oct'
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

// '2026-10-12' -> '12 Oct - 18 Oct' (the whole Monday to Sunday week)
export function weekSpan(ymd: string): string {
  return `${shortDate(ymd)} - ${shortDate(addDays(ymd, 6))}`
}

export function money(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
}

export type ParsedCell =
  | { kind: 'empty' }
  | { kind: 'nd' }
  | { kind: 'amount'; amount: number }
  | { kind: 'bad' }

// What was typed into a cell: nothing (not paid), ND (no rent due) or an amount like 250 or 250.50.
export function parseCell(text: string): ParsedCell {
  let t = text.trim().replace(/^\$\s*/, '')
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '')
  if (t === '') return { kind: 'empty' }
  if (/^nd$/i.test(t)) return { kind: 'nd' }
  if (/^\d+(\.\d{1,2})?$/.test(t) && Number(t) <= 1000000) return { kind: 'amount', amount: Number(t) }
  return { kind: 'bad' }
}

export function cellText(v: CellValue | undefined): string {
  if (!v) return ''
  if (v.nd) return 'ND'
  return v.amount == null ? '' : String(v.amount)
}

export function sameCell(a: CellValue | null | undefined, b: CellValue | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.nd === b.nd && a.amount === b.amount
}
