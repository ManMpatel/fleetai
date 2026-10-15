// Calendar helpers for the Rent Tracker.
// A week runs Monday to Sunday and is named by its Monday, written 'YYYY-MM-DD'. A month is
// 'YYYY-MM'. This is plain calendar arithmetic with no time of day, so the only timezone
// question is "what is today's date for this business" (dateInTz).

const DAY_MS = 86400000
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function toUtc(ymd: string): Date | null {
  const k = YMD.exec(ymd)
  if (!k) return null
  const y = Number(k[1]), m = Number(k[2]), d = Number(k[3])
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null
}

function fromUtc(t: Date): string {
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}`
}

export function addDays(ymd: string, n: number): string {
  const t = toUtc(ymd)
  if (!t) throw new Error(`Not a date: ${ymd}`)
  return fromUtc(new Date(t.getTime() + n * DAY_MS))
}

export function isMonday(ymd: string): boolean {
  const t = toUtc(ymd)
  return !!t && t.getUTCDay() === 1 && t.getUTCFullYear() >= 2000 && t.getUTCFullYear() <= 2100
}

export function mondayOf(ymd: string): string {
  const t = toUtc(ymd)
  if (!t) throw new Error(`Not a date: ${ymd}`)
  return addDays(ymd, -((t.getUTCDay() + 6) % 7))
}

// Whole weeks from one Monday to a later one (negative when it is earlier).
export function weeksBetween(fromMonday: string, toMonday: string): number {
  const a = toUtc(fromMonday), b = toUtc(toMonday)
  if (!a || !b) throw new Error('Not a date')
  return Math.round((b.getTime() - a.getTime()) / (7 * DAY_MS))
}

// The calendar date of an instant in the given IANA timezone, as 'YYYY-MM-DD'.
export function dateInTz(when: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(when)
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return tz === 'Australia/Sydney' ? when.toISOString().slice(0, 10) : dateInTz(when, 'Australia/Sydney')
  }
}

export function isMonthKey(s: string): boolean {
  const k = MONTH.exec(s)
  return !!k && Number(k[1]) >= 2000 && Number(k[1]) <= 2100
}

export function addMonths(month: string, n: number): string {
  const k = MONTH.exec(month)
  if (!k) throw new Error(`Not a month: ${month}`)
  const idx = Number(k[1]) * 12 + (Number(k[2]) - 1) + n
  return `${pad(Math.floor(idx / 12), 4)}-${pad((idx % 12) + 1, 2)}`
}

export function monthLabel(month: string): string {
  const k = MONTH.exec(month)
  if (!k) throw new Error(`Not a month: ${month}`)
  return `${MONTH_NAMES[Number(k[2]) - 1]} ${k[1]}`
}

// Every Monday that falls inside the month. A week counts in the month where it STARTS.
export function mondaysInMonth(month: string): string[] {
  const first = `${month}-01`
  const dow = toUtc(first)!.getUTCDay()
  let day = addDays(first, (8 - dow) % 7)
  const out: string[] = []
  while (day.startsWith(month)) {
    out.push(day)
    day = addDays(day, 7)
  }
  return out
}

// The week that began in the previous month but runs into this one (null when the month starts
// on a Monday). It is shown again, read-only, at the start of the month it runs into.
export function shadowWeekOf(month: string): string | null {
  const first = `${month}-01`
  return toUtc(first)!.getUTCDay() === 1 ? null : mondayOf(first)
}
