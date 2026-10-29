import { Router, Request, Response, NextFunction } from 'express'
import Vehicle from '../models/Vehicle'
import Renter from '../models/Renter'
import RentEntry from '../models/RentEntry'
import RentRow from '../models/RentRow'
import { rentTrackerAllowed } from '../config/rentTracker'
import { buildGrid } from '../services/rentGrid'
import { buildHistory } from '../services/rentHistory'
import { BIN_DAYS, binDaysLeft } from '../services/rentBin'
import { rentTrackerReady } from '../services/rentStartup'
import { dateInTz, isMonday, isMonthKey } from '../services/rentWeeks'

const router = Router()

// Every route in this file is for the named accounts only.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!rentTrackerAllowed(req.org?.email)) {
    return res.status(403).json({ error: 'Rent Tracker is not switched on for this account' })
  }
  next()
})

// The one-time start-up step (see rentStartup.ts) finishes before the first request is answered.
router.use(async (_req: Request, _res: Response, next: NextFunction) => {
  await rentTrackerReady()
  next()
})

const OBJECT_ID = /^[a-f0-9]{24}$/i
const NOT_ON_TABLE = 'This car is not in the Rent Tracker'

// A money amount: a number from 0 to 1,000,000 with at most 2 decimals (rounded to cents).
function parseAmount(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1000000) return null
  const cents = Math.round(x * 100)
  return Math.abs(x * 100 - cents) < 1e-6 ? cents / 100 : null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A mobile typed as "0412 345 678" must find "0412345678" and the other way round, so spaces,
// brackets and dashes may sit between any two characters. Number plates work the same way.
function looseRegex(text: string): RegExp {
  return new RegExp(text.replace(/[\s()-]/g, '').split('').map(escapeRegex).join('[\\s()-]*'), 'i')
}

// A save that races another save of the same cell can hit the unique index once; try again.
async function upsert(model: any, filter: object, set: object): Promise<void> {
  try {
    await model.findOneAndUpdate(filter, { $set: set }, { upsert: true })
  } catch (err: any) {
    if (err?.code !== 11000) throw err
    await model.findOneAndUpdate(filter, { $set: set }, { upsert: true })
  }
}

// GET /api/rent-tracker/grid?month=YYYY-MM&months=1|6
router.get('/grid', async (req: Request, res: Response) => {
  try {
    const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : undefined
    if (month !== undefined && !isMonthKey(month)) return res.status(400).json({ error: 'month must look like 2026-10' })
    const months = req.query.months === undefined ? 1 : Number(req.query.months)
    if (months !== 1 && months !== 6) return res.status(400).json({ error: 'months must be 1 or 6' })
    res.json(await buildGrid(req.orgId!, req.org?.timezone || 'Australia/Sydney', month, months))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/rent-tracker/entry  { vehicleId, weekStart, amount?, nd?, days?, renterId? }
// Each of amount, nd and days is changed only when it is sent (a day change leaves the money alone):
//   amount a number   the money received (it also takes away ND)
//   amount null       clears the money (and ND)
//   nd true           the week is "no rent due" (the money is cleared)
//   days 1 to 7       the days of rent in that week (7 = the whole week)
// A week with no money, no ND and 7 days has nothing to remember, so its document is deleted.
// The money always goes to the renter who has the car right now. renterId is the renter the
// table was showing; when it is not the renter of the car any more the save is refused (409)
// so that nothing lands on the wrong renter.
router.put('/entry', async (req: Request, res: Response) => {
  try {
    const { vehicleId, weekStart, amount, nd, days, renterId } = (req.body ?? {}) as Record<string, unknown>
    if (typeof vehicleId !== 'string' || !OBJECT_ID.test(vehicleId)) return res.status(400).json({ error: 'vehicleId is required' })
    if (typeof weekStart !== 'string' || !isMonday(weekStart)) return res.status(400).json({ error: 'weekStart must be a Monday, like 2026-10-12' })
    if (nd !== undefined && typeof nd !== 'boolean') return res.status(400).json({ error: 'nd must be true or false' })
    if (days !== undefined && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 7)) return res.status(400).json({ error: 'days must be a whole number from 1 to 7' })
    if (renterId !== undefined && renterId !== null && (typeof renterId !== 'string' || !OBJECT_ID.test(renterId))) return res.status(400).json({ error: 'renterId is not valid' })
    if (amount === undefined && nd === undefined && days === undefined) return res.status(400).json({ error: 'Nothing to save' })
    if (nd === true && amount !== undefined && amount !== null) return res.status(400).json({ error: 'Send either nd or an amount, not both' })
    const value = amount === undefined || amount === null ? null : parseAmount(amount)
    if (amount !== undefined && amount !== null && value === null) return res.status(400).json({ error: 'The amount must be from 0 to 1,000,000 with at most 2 decimals' })

    const vehicle: any = await Vehicle.findOne({ _id: vehicleId, orgId: req.orgId }).select('_id currentRenter')
    if (!vehicle) return res.status(404).json({ error: 'Car not found' })
    const onTable = await RentRow.findOne({ orgId: req.orgId, vehicleId: vehicle._id, removed: { $ne: true } }).select('_id').lean()
    if (!onTable) return res.status(404).json({ error: NOT_ON_TABLE })
    if (!vehicle.currentRenter) return res.status(400).json({ error: 'Put a renter on this car first' })
    if (typeof renterId === 'string' && renterId.toLowerCase() !== String(vehicle.currentRenter)) {
      return res.status(409).json({ error: 'The renter of this car has changed. The table has been reloaded - please type it again.' })
    }
    const where = { orgId: req.orgId, vehicleId: vehicle._id, weekStart, renterId: vehicle.currentRenter }

    // Only what was sent is written, so two quick saves of the same cell (the money, then the days)
    // can never wipe each other out.
    const set: Record<string, unknown> = {}
    if (nd === true) Object.assign(set, { amount: null, nd: true })
    else if (amount !== undefined) Object.assign(set, { amount: value, nd: false })
    else if (nd === false) set.nd = false
    if (days !== undefined) set.days = days

    // A document is only created when there is something to remember; clearing or setting 7 days
    // on a week that has no document changes nothing.
    const keeps = set.nd === true || typeof set.amount === 'number' || (typeof set.days === 'number' && set.days !== 7)
    if (keeps) await upsert(RentEntry, where, set)
    else await RentEntry.updateOne(where, { $set: set })
    await RentEntry.deleteOne({ ...where, amount: null, nd: false, days: { $in: [7, null] } })

    const saved: any = await RentEntry.findOne(where).select('amount nd days').lean()
    res.json({ ok: true, entry: saved ? { amount: saved.amount ?? null, nd: !!saved.nd, days: saved.days ?? 7 } : null })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/rent-tracker/row/:vehicleId  { weeklyRent?, startWeek? }
// startWeek null goes back to the automatic start week. The car must be on the table.
router.put('/row/:vehicleId', async (req: Request, res: Response) => {
  try {
    const { vehicleId } = req.params
    if (!OBJECT_ID.test(vehicleId)) return res.status(400).json({ error: 'vehicleId is not valid' })
    const { weeklyRent, startWeek } = (req.body ?? {}) as Record<string, unknown>

    const vehicle: any = await Vehicle.findOne({ _id: vehicleId, orgId: req.orgId }).select('currentRenter rentStartDate')
    if (!vehicle) return res.status(404).json({ error: 'Car not found' })

    const set: Record<string, unknown> = {}
    if (weeklyRent !== undefined) {
      const value = parseAmount(weeklyRent)
      if (value === null) return res.status(400).json({ error: 'The weekly rent must be from 0 to 1,000,000 with at most 2 decimals' })
      set.weeklyRent = value
    }
    if (startWeek !== undefined) {
      if (startWeek === null) {
        Object.assign(set, { startWeek: null, startRenterId: null, startAssignedAt: null })
      } else {
        if (typeof startWeek !== 'string' || !isMonday(startWeek)) return res.status(400).json({ error: 'startWeek must be a Monday, like 2026-10-12' })
        if (!vehicle.currentRenter) return res.status(400).json({ error: 'Put a renter on this car first' })
        Object.assign(set, { startWeek, startRenterId: vehicle.currentRenter, startAssignedAt: vehicle.rentStartDate ?? null })
      }
    }
    if (Object.keys(set).length === 0) return res.status(400).json({ error: 'Nothing to save' })

    const done = await RentRow.updateOne({ orgId: req.orgId, vehicleId: vehicle._id, removed: { $ne: true } }, { $set: set })
    if (done.matchedCount === 0) return res.status(404).json({ error: NOT_ON_TABLE })
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/rent-tracker/renters?q=  - active renters only, by name, mobile or email
router.get('/renters', async (req: Request, res: Response) => {
  try {
    const q = (typeof req.query.q === 'string' ? req.query.q : '').trim().slice(0, 60)
    const filter: Record<string, unknown> = { orgId: req.orgId, status: 'active' }
    if (q) {
      filter.$or = [
        { name: new RegExp(escapeRegex(q), 'i') },
        { email: new RegExp(escapeRegex(q), 'i') },
        ...(q.replace(/[\s()-]/g, '') ? [{ phone: looseRegex(q) }] : []),
      ]
    }
    const renters: any[] = await Renter.find(filter).select('name phone email currentVehicles').sort({ name: 1 }).limit(20).lean()
    res.json(renters.map(r => ({
      _id: String(r._id),
      name: r.name as string,
      phone: r.phone as string,
      email: (r.email as string) || '',
      cars: Array.isArray(r.currentVehicles) ? r.currentVehicles.length : 0,
    })))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/rent-tracker/cars?q=  - the cars that can be added to the table: everything in stock
// (Rego Import), found by number plate or model. At most 30 come back, with the total found.
router.get('/cars', async (req: Request, res: Response) => {
  try {
    const q = (typeof req.query.q === 'string' ? req.query.q : '').trim().slice(0, 40)
    const filter: Record<string, unknown> = { orgId: req.orgId, regoStatus: { $nin: ['stolen', 'sold'] } }
    if (q) {
      filter.$or = [
        ...(q.replace(/[\s()-]/g, '') ? [{ plate: looseRegex(q) }] : []),
        { model: new RegExp(escapeRegex(q), 'i') },
      ]
    }
    const [cars, total]: [any[], number] = await Promise.all([
      Vehicle.find(filter).select('plate model status').sort({ plate: 1 }).limit(30).lean(),
      Vehicle.countDocuments(filter),
    ])
    const onTable = cars.length === 0
      ? []
      : await RentRow.find({ orgId: req.orgId, vehicleId: { $in: cars.map(c => c._id) }, removed: { $ne: true } }).select('vehicleId').lean()
    const added = new Set<string>(onTable.map((r: any) => String(r.vehicleId)))
    res.json({
      total,
      cars: cars.map(c => ({ _id: String(c._id), plate: c.plate as string, model: (c.model as string) || '', status: c.status as string, inTracker: added.has(String(c._id)) })),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/rent-tracker/cars  { vehicleId }  - put a car on the table (also a car that is in the
// Recycle bin: it comes back with its weekly rent, start week and money)
router.post('/cars', async (req: Request, res: Response) => {
  try {
    const { vehicleId } = (req.body ?? {}) as Record<string, unknown>
    if (typeof vehicleId !== 'string' || !OBJECT_ID.test(vehicleId)) return res.status(400).json({ error: 'vehicleId is required' })
    const vehicle: any = await Vehicle.findOne({ _id: vehicleId, orgId: req.orgId }).select('_id regoStatus')
    if (!vehicle) return res.status(404).json({ error: 'Car not found' })
    if (vehicle.regoStatus === 'stolen' || vehicle.regoStatus === 'sold') {
      return res.status(400).json({ error: 'This car is marked stolen or sold, so it cannot be added' })
    }
    await upsert(RentRow, { orgId: req.orgId, vehicleId: vehicle._id }, { removed: false, removedAt: null })
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/rent-tracker/cars/:vehicleId  - "Delete row": the row goes to the Recycle bin for 30
// days (see rentBin.ts). The car stays in Fleet and Rego Import, and the money typed for it is kept.
// A second click on a row that is already in the bin changes nothing (its 30 days keep counting).
router.delete('/cars/:vehicleId', async (req: Request, res: Response) => {
  try {
    const { vehicleId } = req.params
    if (!OBJECT_ID.test(vehicleId)) return res.status(400).json({ error: 'vehicleId is not valid' })
    const done = await RentRow.updateOne({ orgId: req.orgId, vehicleId, removed: { $ne: true } }, { $set: { removed: true, removedAt: new Date() } })
    if (done.matchedCount === 0) {
      const inBin = await RentRow.findOne({ orgId: req.orgId, vehicleId, removed: true }).select('_id').lean()
      if (!inBin) return res.status(404).json({ error: NOT_ON_TABLE })
    }
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/rent-tracker/bin  - the Recycle bin, the newest deleted row first:
// { days: 30, rows: [{ vehicleId, plate, model, weeklyRent, removedOn: 'YYYY-MM-DD' | null, daysLeft }] }
router.get('/bin', async (req: Request, res: Response) => {
  try {
    const rows: any[] = await RentRow.find({ orgId: req.orgId, removed: true }).select('vehicleId weeklyRent removedAt').lean()
    const cars: any[] = rows.length === 0
      ? []
      : await Vehicle.find({ orgId: req.orgId, _id: { $in: rows.map(r => r.vehicleId) } }).select('plate model').lean()
    const car = new Map<string, any>(cars.map(c => [String(c._id), c]))
    const tz = req.org?.timezone || 'Australia/Sydney'
    const now = new Date()
    const list = rows
      .filter(r => car.has(String(r.vehicleId)))
      .map(r => ({
        vehicleId: String(r.vehicleId),
        plate: car.get(String(r.vehicleId)).plate as string,
        model: (car.get(String(r.vehicleId)).model as string) || '',
        weeklyRent: (r.weeklyRent as number) || 0,
        removedOn: r.removedAt ? dateInTz(new Date(r.removedAt), tz) : null,
        daysLeft: binDaysLeft(r.removedAt, now),
        at: r.removedAt ? new Date(r.removedAt).getTime() : 0,
      }))
      .sort((a, b) => b.at - a.at || a.plate.localeCompare(b.plate))
      .map(({ at: _at, ...item }) => item)
    res.json({ days: BIN_DAYS, rows: list })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/rent-tracker/bin/:vehicleId/restore  - put a row from the Recycle bin back on the table,
// exactly as it was (weekly rent, start week, money). A row that is already back is fine too.
router.post('/bin/:vehicleId/restore', async (req: Request, res: Response) => {
  try {
    const { vehicleId } = req.params
    if (!OBJECT_ID.test(vehicleId)) return res.status(400).json({ error: 'vehicleId is not valid' })
    const vehicle: any = await Vehicle.findOne({ _id: vehicleId, orgId: req.orgId }).select('_id regoStatus')
    if (!vehicle) return res.status(404).json({ error: 'Car not found' })
    if (vehicle.regoStatus === 'stolen' || vehicle.regoStatus === 'sold') {
      return res.status(400).json({ error: 'This car is marked stolen or sold, so it cannot be put back' })
    }
    const done = await RentRow.updateOne({ orgId: req.orgId, vehicleId: vehicle._id, removed: true }, { $set: { removed: false, removedAt: null } })
    if (done.matchedCount === 0) {
      const back = await RentRow.findOne({ orgId: req.orgId, vehicleId: vehicle._id, removed: { $ne: true } }).select('_id').lean()
      if (!back) return res.status(404).json({ error: 'This row is not in the Recycle bin (it may have been deleted for good)' })
    }
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/rent-tracker/history/:vehicleId  - who paid what on this car, week by week
router.get('/history/:vehicleId', async (req: Request, res: Response) => {
  try {
    const { vehicleId } = req.params
    if (!OBJECT_ID.test(vehicleId)) return res.status(400).json({ error: 'vehicleId is not valid' })
    const vehicle: any = await Vehicle.findOne({ _id: vehicleId, orgId: req.orgId }).select('plate model currentRenter').lean()
    if (!vehicle) return res.status(404).json({ error: 'Car not found' })
    res.json(await buildHistory(req.orgId!, vehicle))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
