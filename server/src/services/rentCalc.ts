import { addDays, weeksBetween } from './rentWeeks'

// The Rent Tracker maths: plain functions on whole cents, no database, so they can be tested alone.
//
// The rent due for one week = the weekly rent x the days of that week / 7, rounded to the cent
// once (7 days = the whole rent, ND = no rent due = 0).
//
// Owing is one pile, not week by week:
//   Owing = all the rent due from the start week up to this week - ALL the money typed for the renter.
// Money typed in a week is not tied to that week: more than the week asked for stays in the pile
// and covers the next weeks by itself, less leaves the rest owing. Money typed before the start
// week or in a coming week counts too.

export const toCents = (n: number) => Math.round(n * 100)

// The days of rent in a week: a whole number from 1 to 7. Anything else means the whole week.
export const dayCount = (d: unknown): number => (typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 7 ? d : 7)

// What was typed for one week of the renter who has the car (amount in dollars, as saved).
export interface OwnWeek { amount: number | null; nd: boolean; days: number }

// The rent due for one week, in cents.
export function weekDueC(rentC: number, week?: { nd?: boolean; days?: number }): number {
  if (week?.nd) return 0
  return Math.round((rentC * dayCount(week?.days)) / 7)
}

// The small letters under a week box, in dollars:
//   carry  money (+) or rent (-) brought in from the weeks before
//   total  carry + the money typed in this week
//   days   the days of rent in this week (7 = the whole week)
//   due    the rent for this week (the weekly rent x days / 7)
//   bal    total - due. For this week it also holds the money typed for coming weeks, so it is
//          always minus the Owing of the row. Above 0 = left over, below 0 = behind.
export interface WeekCalc { carry: number; total: number; days: number; due: number; bal: number }

// dueC    rent due from the start week up to this week
// paidC   all the money typed for the renter, in any week
// owingC  dueC - paidC, never below 0
// aheadC  paidC - dueC, never below 0 (paid more than is due so far)
// calc    the small letters of every week that counts (start week up to this week, not ND);
//         empty when the weekly rent is not set
export interface RowMaths { dueC: number; paidC: number; owingC: number; aheadC: number; calc: Record<string, WeekCalc> }

// For a car nobody has: no rent counts.
export const NO_MATHS: RowMaths = { dueC: 0, paidC: 0, owingC: 0, aheadC: 0, calc: {} }

// rentC is the weekly rent in cents, startWeek and currentWeek are Mondays ('YYYY-MM-DD'), own is
// what was typed for the renter, by week.
export function rowMaths(rentC: number, startWeek: string, currentWeek: string, own: Map<string, OwnWeek>): RowMaths {
  let paidC = 0
  let beforeC = 0
  let afterC = 0
  for (const [week, e] of own) {
    if (e.amount == null) continue
    const cents = toCents(e.amount)
    paidC += cents
    if (week < startWeek) beforeC += cents
    else if (week > currentWeek) afterC += cents
  }

  const calc: Record<string, WeekCalc> = {}
  let dueC = 0
  if (startWeek <= currentWeek) {
    const last = weeksBetween(startWeek, currentWeek)
    let bal = beforeC
    for (let i = 0; i <= last; i++) {
      const week = addDays(startWeek, i * 7)
      const e = own.get(week)
      const due = weekDueC(rentC, e)
      const typed = e?.amount != null ? toCents(e.amount) : 0
      const carry = bal
      bal = carry + typed - due
      dueC += due
      if (i === last) bal += afterC
      if (rentC > 0 && !e?.nd) calc[week] = { carry: carry / 100, total: (carry + typed) / 100, days: dayCount(e?.days), due: due / 100, bal: bal / 100 }
    }
  }

  return { dueC, paidC, owingC: Math.max(0, dueC - paidC), aheadC: Math.max(0, paidC - dueC), calc }
}
