import { Types } from 'mongoose'
import Vehicle from '../models/Vehicle'
import RentEntry from '../models/RentEntry'
import RentRow from '../models/RentRow'
import { scopedPopulate } from '../models/plugins/tenantScope'
import { TRACKER_START } from '../config/rentTracker'
import { addMonths, dateInTz, mondayOf, mondaysInMonth, monthLabel, shadowWeekOf, weeksBetween } from './rentWeeks'

// Money is added up in whole cents so that 0.1 + 0.2 style rounding never shows on screen.
const toCents = (n: number) => Math.round(n * 100)
const timeOf = (d: unknown) => (d ? new Date(d as string).getTime() : 0)

interface Pair { received: number; expected: number }
interface Group { month: string; label: string; shadow: string | null; weeks: string[] }

// Everything the Rent Tracker table needs for one view: the weeks on screen, one row per car in
// stock, the money received in each week and what each renter still owes.
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
  const shown = groups.flatMap(g => (g.shadow ? [g.shadow] : []).concat(g.weeks))
  const from = shown[0]
  const to = shown[shown.length - 1]

  // Cars in stock (Rego Import): everything except stolen or sold. Older cars have no regoStatus.
  const vehicles: any[] = await Vehicle.find({ orgId, regoStatus: { $nin: ['stolen', 'sold'] } })
    .select('plate model status currentRenter rentStartDate')
    .populate(scopedPopulate('currentRenter', 'name phone email'))
    .sort({ plate: 1 })
    .lean()
  const ids = vehicles.map(v => v._id)
  const mine = { orgId, vehicleId: { $in: ids } }

  const [settings, inView, receivedSums, ndWeeks, thisWeekDocs]: any[] = await Promise.all([
    RentRow.find(mine).lean(),
    RentEntry.find({ ...mine, weekStart: { $gte: from, $lte: to } }).select('vehicleId weekStart amount nd').lean(),
    RentEntry.aggregate([{ $match: { ...mine, amount: { $ne: null } } }, { $group: { _id: '$vehicleId', total: { $sum: '$amount' } } }]),
    RentEntry.find({ ...mine, nd: true }).select('vehicleId weekStart').lean(),
    RentEntry.find({ ...mine, weekStart: currentWeek }).select('vehicleId amount nd').lean(),
  ])

  const settingsBy = new Map<string, any>(settings.map((s: any) => [String(s.vehicleId), s]))
  const receivedBy = new Map<string, number>(receivedSums.map((s: any) => [String(s._id), toCents(s.total)]))
  const ndBy = new Map<string, Set<string>>()
  for (const e of ndWeeks) {
    const k = String(e.vehicleId)
    if (!ndBy.has(k)) ndBy.set(k, new Set())
    ndBy.get(k)!.add(e.weekStart)
  }
  const viewBy = new Map<string, Map<string, { amount: number | null; nd: boolean }>>()
  for (const e of inView) {
    const k = String(e.vehicleId)
    if (!viewBy.has(k)) viewBy.set(k, new Map())
    viewBy.get(k)!.set(e.weekStart, { amount: e.amount ?? null, nd: !!e.nd })
  }
  const thisWeekBy = new Map<string, number>(thisWeekDocs.filter((e: any) => e.amount != null).map((e: any) => [String(e.vehicleId), toCents(e.amount)]))

  const weekSums = new Map<string, Pair>()
  for (const g of groups) for (const w of g.weeks) weekSums.set(w, { received: 0, expected: 0 })
  const thisWeek: Pair = { received: 0, expected: 0 }
  const overall = { received: 0, expected: 0, owing: 0 }

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

    const nd = ndBy.get(id) ?? new Set<string>()
    let weeksDue = 0
    if (renter && startWeek <= currentWeek) {
      weeksDue = weeksBetween(startWeek, currentWeek) + 1
      for (const w of nd) if (w >= startWeek && w <= currentWeek) weeksDue--
    }
    const expectedC = rentC * weeksDue
    const receivedC = receivedBy.get(id) ?? 0
    const owingC = renter ? Math.max(0, expectedC - receivedC) : 0
    overall.received += receivedC
    overall.expected += expectedC
    overall.owing += owingC

    const cells = viewBy.get(id) ?? new Map()
    const entries: Record<string, { amount: number | null; nd: boolean }> = {}
    const monthTotals: Record<string, number> = {}
    for (const g of groups) {
      for (const w of g.shadow ? [g.shadow, ...g.weeks] : g.weeks) if (cells.has(w)) entries[w] = cells.get(w)
      let monthC = 0
      for (const w of g.weeks) {
        const sum = weekSums.get(w)!
        const amount = cells.get(w)?.amount
        if (amount != null) { monthC += toCents(amount); sum.received += toCents(amount) }
        if (renter && w >= startWeek && !nd.has(w)) sum.expected += rentC
      }
      monthTotals[g.month] = monthC / 100
    }

    thisWeek.received += thisWeekBy.get(id) ?? 0
    if (renter && currentWeek >= startWeek && !nd.has(currentWeek)) thisWeek.expected += rentC

    return {
      vehicleId: id,
      plate: v.plate as string,
      model: (v.model as string) || '',
      status: v.status as string,
      renter: renter ? { _id: String(renter._id), name: renter.name as string, phone: renter.phone as string, email: (renter.email as string) || '' } : null,
      weeklyRent: rentC / 100,
      startWeek,
      startIsCustom,
      entries,
      monthTotals,
      expected: expectedC / 100,
      received: receivedC / 100,
      owing: owingC / 100,
    }
  })

  const out = (p: Pair) => ({ received: p.received / 100, expected: p.expected / 100 })
  const weekTotals: Record<string, Pair> = {}
  weekSums.forEach((p, w) => { weekTotals[w] = out(p) })
  const monthSums: Record<string, Pair> = {}
  for (const g of groups) {
    const p: Pair = { received: 0, expected: 0 }
    for (const w of g.weeks) { p.received += weekSums.get(w)!.received; p.expected += weekSums.get(w)!.expected }
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
      overall: { received: overall.received / 100, expected: overall.expected / 100, owing: overall.owing / 100 },
    },
  }
}
