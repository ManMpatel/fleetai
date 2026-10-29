import { Types } from 'mongoose'
import Renter from '../models/Renter'
import RentEntry from '../models/RentEntry'

const toCents = (n: number) => Math.round(n * 100)

interface Week { weekStart: string; amount: number | null; nd: boolean }
interface Person { _id: string | null; name: string; phone: string; email: string }

// The money story of one car (one number plate): who paid what, week by week.
//   total      all the money typed for this car, every renter together
//   current    the renter who has the car now and what they have paid (their weeks are in the table)
//   previous   earlier renters, newest first (by their latest week, then by when money was last typed);
//              their weeks oldest first
//   noRenter   money typed while nobody had the car (only possible for money typed before renters
//              were kept apart), or null
// It is read on demand when History is opened, so the table itself never has to load renter names.
export async function buildHistory(orgId: Types.ObjectId, vehicle: { _id: Types.ObjectId; plate: string; model?: string; currentRenter?: unknown }) {
  const entries: any[] = await RentEntry.find({ orgId, vehicleId: vehicle._id })
    .select('renterId weekStart amount nd updatedAt')
    .sort({ weekStart: 1 })
    .lean()

  const byRenter = new Map<string, { weeks: Week[]; totalC: number; touched: number }>()
  let totalC = 0
  for (const e of entries) {
    // A week that only remembers its days (no money, not ND) is not part of the money story.
    if (e.amount == null && !e.nd) continue
    const key = e.renterId ? String(e.renterId) : 'none'
    if (!byRenter.has(key)) byRenter.set(key, { weeks: [], totalC: 0, touched: 0 })
    const group = byRenter.get(key)!
    group.touched = Math.max(group.touched, e.updatedAt ? new Date(e.updatedAt).getTime() : 0)
    group.weeks.push({ weekStart: e.weekStart as string, amount: e.amount ?? null, nd: !!e.nd })
    if (e.amount != null) {
      group.totalC += toCents(e.amount)
      totalC += toCents(e.amount)
    }
  }

  // Names and mobiles of the renters involved (a few documents, read only now).
  const holder = vehicle.currentRenter ? String(vehicle.currentRenter) : null
  const wanted = [...new Set([...byRenter.keys(), ...(holder ? [holder] : [])])].filter(k => k !== 'none')
  const found: any[] = wanted.length === 0 ? [] : await Renter.find({ orgId, _id: { $in: wanted } }).select('name phone email').lean()
  const known = new Map<string, any>(found.map(r => [String(r._id), r]))
  // Same rule as the table: a renter who no longer exists is not "the renter of the car".
  const currentId = holder && known.has(holder) ? holder : null
  const person = (id: string): Person => {
    const r = known.get(id)
    return { _id: id, name: r ? (r.name as string) : 'Unknown renter', phone: r ? ((r.phone as string) || '') : '', email: r ? ((r.email as string) || '') : '' }
  }

  const previous = [...byRenter.entries()]
    .filter(([key]) => key !== 'none' && key !== currentId)
    .map(([key, g]) => ({ renter: person(key), total: g.totalC / 100, weeks: g.weeks, touched: g.touched }))
    .sort((a, b) => b.weeks[b.weeks.length - 1].weekStart.localeCompare(a.weeks[a.weeks.length - 1].weekStart) || b.touched - a.touched)
    .map(({ touched, ...rest }) => rest)

  const none = byRenter.get('none')
  return {
    vehicleId: String(vehicle._id),
    plate: vehicle.plate,
    model: vehicle.model || '',
    total: totalC / 100,
    current: currentId ? { renter: person(currentId), total: (byRenter.get(currentId)?.totalC ?? 0) / 100 } : null,
    previous,
    noRenter: none ? { total: none.totalC / 100, weeks: none.weeks } : null,
  }
}
