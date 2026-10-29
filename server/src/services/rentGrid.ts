import { Types } from 'mongoose'
import Vehicle from '../models/Vehicle'
import RentEntry from '../models/RentEntry'
import RentRow from '../models/RentRow'
import { scopedPopulate } from '../models/plugins/tenantScope'
import { TRACKER_START } from '../config/rentTracker'
import { NO_MATHS, OwnWeek, WeekCalc, dayCount, rowMaths, toCents, weekDueC } from './rentCalc'
import { addMonths, dateInTz, mondayOf, mondaysInMonth, monthLabel, shadowWeekOf } from './rentWeeks'

// Money is added up in whole cents (see rentCalc.ts) so that 0.1 + 0.2 style rounding never shows on screen.
const timeOf = (d: unknown) => (d ? new Date(d as string).getTime() : 0)

// earlier = the part of received that came from earlier renters of the car (it is already inside
// received, so the screen can say "includes $X from earlier renters").
interface Pair { received: number; expected: number; earlier: number }
interface Group { month: string; label: string; shadow: string | null; weeks: string[] }

// Everything the Rent Tracker table needs for one view: the weeks on screen, one row per car the
// owner has added (Add number plate), the money received in each week and what each renter still
// owes. Money belongs to the renter who had the car when it was typed: a row shows and counts the
// money of the renter who has the car now, and the money of earlier renters stays in History.
// The week, month and overall "received" totals count everybody's money; Expected and Owing are
// for the renters who have a car now. Expected counts the rent of a week by its days (a renter
// who takes the car on a Thursday owes 4 days of that week) and Owing is the rent due so far minus
// all the money typed for the renter (rentCalc.ts).
// endMonth 'YYYY-MM' (default: this month) is the last month shown; months is 1 or 6.
export async function buildGrid(orgId: Types.ObjectId, tz: string, endMonth: string | undefined, months: 1 | 6, now = new Date()) {
  const today = dateInTz(now, tz)
  const currentWeek = mondayOf(today)
  const end = endMonth || today.slice(0, 7)

  const groups: Group[] = []
  for (let i = months - 1; i >= 0; i--) {
    const month = addMonths(end, -i)
    groups.push({ month, label: monthLabel(month), shadow: months === 1 ? shadowWeekOf(month) : null, weeks: mondaysInMonth(month) })
  }

  // The cars on the table: added by the owner and not taken off again. Stolen or sold cars never
  // show. Older cars have no regoStatus.
  const settings: any[] = await RentRow.find({ orgId, removed: { $ne: true } }).lean()
  const vehicles: any[] = settings.length === 0
    ? []
    : await Vehicle.find({ orgId, _id: { $in: settings.map(s => s.vehicleId) }, regoStatus: { $nin: ['stolen', 'sold'] } })
        .select('plate model status currentRenter rentStartDate')
        .populate(scopedPopulate('currentRenter', 'name phone email'))
        .sort({ plate: 1 })
        .lean()
  const ids = vehicles.map(v => v._id)
  const entries: any[] = ids.length === 0
    ? []
    : await RentEntry.find({ orgId, vehicleId: { $in: ids } }).select('vehicleId renterId weekStart amount nd days').lean()

  const settingsBy = new Map<string, any>(settings.map((s: any) => [String(s.vehicleId), s]))
  const entriesBy = new Map<string, any[]>()
  for (const e of entries) {
    const k = String(e.vehicleId)
    if (!entriesBy.has(k)) entriesBy.set(k, [])
    entriesBy.get(k)!.push(e)
  }

  const weekSums = new Map<string, Pair>()
  for (const g of groups) for (const w of g.weeks) weekSums.set(w, { received: 0, expected: 0, earlier: 0 })
  const thisWeek: Pair = { received: 0, expected: 0, earlier: 0 }
  const overall = { received: 0, expected: 0, owing: 0, earlier: 0 }

  const rows = vehicles.map(v => {
    const id = String(v._id)
    const renter = v.currentRenter && v.currentRenter._id ? v.currentRenter : null
    const set = settingsBy.get(id)
    const rentC = toCents(set?.weeklyRent ?? 0)

    // Rent counts from the week the car was given to the renter (never before the tracker went
    // live), unless a start week was chosen for this very rental.
    const assignWeek = renter && v.rentStartDate ? mondayOf(dateInTz(new Date(v.rentStartDate), tz)) : null
    let startWeek = assignWeek && assignWeek > TRACKER_START ? assignWeek : TRACKER_START
    let startIsCustom = false
    if (renter && set?.startWeek && String(set.startRenterId) === String(renter._id) && timeOf(set.startAssignedAt) === timeOf(v.rentStartDate)) {
      startWeek = set.startWeek
      startIsCustom = true
    }

    // The money of this car, split into the renter who has it now (own) and everybody before.
    // A week with no money, no ND and the whole 7 days has nothing to show (an old empty document).
    const cur = renter ? String(renter._id) : null
    const own = new Map<string, OwnWeek>()
    const earlierByWeek = new Map<string, number>()
    let earlierC = 0
    for (const e of entriesBy.get(id) ?? []) {
      if (cur && e.renterId && String(e.renterId) === cur) {
        const days = dayCount(e.days)
        if (e.amount != null || e.nd || days !== 7) own.set(e.weekStart, { amount: e.amount ?? null, nd: !!e.nd, days })
      } else if (e.amount != null) {
        earlierC += toCents(e.amount)
        earlierByWeek.set(e.weekStart, (earlierByWeek.get(e.weekStart) ?? 0) + toCents(e.amount))
      }
    }

    // Rent due so far, all the money typed for the renter, and the small letters of every week.
    const maths = renter ? rowMaths(rentC, startWeek, currentWeek, own) : NO_MATHS
    overall.received += maths.paidC + earlierC
    overall.earlier += earlierC
    overall.expected += maths.dueC
    overall.owing += maths.owingC

    const entriesOut: Record<string, OwnWeek> = {}
    const calcOut: Record<string, WeekCalc> = {}
    const monthTotals: Record<string, number> = {}
    for (const g of groups) {
      for (const w of g.shadow ? [g.shadow, ...g.weeks] : g.weeks) if (own.has(w)) entriesOut[w] = own.get(w)!
      let monthC = 0
      for (const w of g.weeks) {
        const sum = weekSums.get(w)!
        const amount = own.get(w)?.amount
        if (amount != null) { monthC += toCents(amount); sum.received += toCents(amount) }
        const before = earlierByWeek.get(w) ?? 0
        sum.received += before
        sum.earlier += before
        if (renter && w >= startWeek) sum.expected += weekDueC(rentC, own.get(w))
        if (maths.calc[w]) calcOut[w] = maths.calc[w]
      }
      monthTotals[g.month] = monthC / 100
    }

    const nowAmount = own.get(currentWeek)?.amount
    const nowBefore = earlierByWeek.get(currentWeek) ?? 0
    thisWeek.received += (nowAmount != null ? toCents(nowAmount) : 0) + nowBefore
    thisWeek.earlier += nowBefore
    if (renter && currentWeek >= startWeek) thisWeek.expected += weekDueC(rentC, own.get(currentWeek))

    return {
      vehicleId: id,
      plate: v.plate as string,
      model: (v.model as string) || '',
      status: v.status as string,
      renter: renter ? { _id: String(renter._id), name: renter.name as string, phone: renter.phone as string, email: (renter.email as string) || '' } : null,
      weeklyRent: rentC / 100,
      startWeek,
      startIsCustom,
      entries: entriesOut,
      calc: calcOut,
      monthTotals,
      expected: maths.dueC / 100,
      received: maths.paidC / 100,
      owing: maths.owingC / 100,
      ahead: maths.aheadC / 100,
      earlier: earlierC / 100,
    }
  })

  const out = (p: Pair) => ({ received: p.received / 100, expected: p.expected / 100, earlier: p.earlier / 100 })
  const weekTotals: Record<string, ReturnType<typeof out>> = {}
  weekSums.forEach((p, w) => { weekTotals[w] = out(p) })
  const monthSums: Record<string, ReturnType<typeof out>> = {}
  for (const g of groups) {
    const p: Pair = { received: 0, expected: 0, earlier: 0 }
    for (const w of g.weeks) {
      const s = weekSums.get(w)!
      p.received += s.received
      p.expected += s.expected
      p.earlier += s.earlier
    }
    monthSums[g.month] = out(p)
  }

  return {
    tz,
    today,
    currentWeek,
    trackerStart: TRACKER_START,
    window: { end, months, prev: addMonths(end, -1), next: addMonths(end, 1) },
    groups,
    rows,
    totals: {
      weeks: weekTotals,
      months: monthSums,
      thisWeek: out(thisWeek),
      overall: { received: overall.received / 100, expected: overall.expected / 100, owing: overall.owing / 100, earlier: overall.earlier / 100 },
    },
  }
}
