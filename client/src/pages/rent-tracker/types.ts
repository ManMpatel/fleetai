export interface RenterRef {
  _id: string
  name: string
  phone: string
  email: string
}

// One cell of the table. No value at all means "not paid yet".
export interface CellValue {
  amount: number | null
  nd: boolean
}

export interface GridGroup {
  month: string
  label: string
  shadow: string | null
  weeks: string[]
}

export interface MoneyPair {
  received: number
  expected: number
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
  monthTotals: Record<string, number>
  expected: number
  received: number
  owing: number
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
