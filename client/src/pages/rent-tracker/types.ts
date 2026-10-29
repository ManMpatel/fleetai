export interface RenterRef {
  _id: string
  name: string
  phone: string
  email: string
}

// One cell of the table. No value at all means "not paid yet". days = the days of rent in that
// week, 1 to 7 (7 = the whole week). A cell with no money, no ND and under 7 days only holds the days.
export interface CellValue {
  amount: number | null
  nd: boolean
  days: number
}

// The small letters under a week box, in dollars (worked out on the server, see rentCalc.ts):
// carry = money (+) or rent (-) brought in from the weeks before, total = carry + the money typed
// in this week, days = days of rent in this week, due = the rent for this week, bal = total - due
// (above 0 = left over, below 0 = behind).
export interface WeekCalc {
  carry: number
  total: number
  days: number
  due: number
  bal: number
}

export interface GridGroup {
  month: string
  label: string
  shadow: string | null
  weeks: string[]
}

// earlier = the part of received that came from earlier renters of the cars (already inside received).
export interface MoneyPair {
  received: number
  expected: number
  earlier: number
}

export interface GridRow {
  vehicleId: string
  plate: string
  model: string
  status: string
  renter: RenterRef | null
  weeklyRent: number
  startWeek: string
  startIsCustom: boolean
  entries: Record<string, CellValue>
  calc: Record<string, WeekCalc>
  monthTotals: Record<string, number>
  expected: number
  received: number
  owing: number
  ahead: number
  earlier: number
}

export interface Grid {
  tz: string
  today: string
  currentWeek: string
  trackerStart: string
  window: { end: string; months: 1 | 6; prev: string; next: string }
  groups: GridGroup[]
  rows: GridRow[]
  totals: {
    weeks: Record<string, MoneyPair>
    months: Record<string, MoneyPair>
    thisWeek: MoneyPair
    overall: MoneyPair & { owing: number }
  }
}

export interface RenterHit {
  _id: string
  name: string
  phone: string
  email: string
  cars: number
}

// A car that can be added to the table (Add number plate).
export interface CarHit {
  _id: string
  plate: string
  model: string
  status: string
  inTracker: boolean
}

export interface CarSearch {
  total: number
  cars: CarHit[]
}

export interface HistoryWeek {
  weekStart: string
  amount: number | null
  nd: boolean
}

export interface HistoryRenter {
  renter: RenterRef
  total: number
  weeks: HistoryWeek[]
}

// Who paid what on one number plate (History).
export interface History {
  vehicleId: string
  plate: string
  model: string
  total: number
  current: { renter: RenterRef; total: number } | null
  previous: HistoryRenter[]
  noRenter: { total: number; weeks: HistoryWeek[] } | null
}
