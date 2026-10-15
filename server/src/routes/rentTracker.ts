import { Router, Request, Response, NextFunction } from 'express'
import Vehicle from '../models/Vehicle'
import Renter from '../models/Renter'
import RentEntry from '../models/RentEntry'
import RentRow from '../models/RentRow'
import { rentTrackerAllowed } from '../config/rentTracker'
import { buildGrid } from '../services/rentGrid'
import { isMonday, isMonthKey } from '../services/rentWeeks'

const router = Router()

// Every route in this file is for the named accounts only.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!rentTrackerAllowed(req.org?.email)) {
    return res.status(403).json({ error: 'Rent Tracker is not switched on for this account' })
  }
  next()
})

const OBJECT_ID = /^[a-f0-9]{24}$/i

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
// brackets and dashes may sit between any two characters.
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

// PUT /api/rent-tracker/entry  { vehicleId, weekStart, amount | null, nd? }
// amount null (and no nd) clears the cell; nd true marks the week as "no rent due".
router.put('/entry', async (req: Request, res: Response) => {
  try {
    const { vehicleId, weekStart, amount, nd } = (req.body ?? {}) as Record<string, unknown>
    if (typeof vehicleId !== 'string' || !OBJECT_ID.test(vehicleId)) return res.status(400).json({ error: 'vehicleId is required' })
    if (typeof weekStart !== 'string' || !isMonday(weekStart)) return res.status(400).json({ error: 'weekStart must be a Monday, like 2026-10-12' })
    if (nd !== undefined && typeof nd !== 'boolean') return res.status(400).json({ error: 'nd must be true or false' })
    const clear = amount === null || amount === undefined
    if (nd === true && !clear) return res.status(400).json({ error: 'Send either nd or an amount, not both' })

    const vehicle = await Vehicle.findOne({ _id: vehicleId, orgId: req.orgId }).select('_id')
    if (!vehicle) return res.status(404).json({ error: 'Car not found' })
    const where = { orgId: req.orgId, vehicleId: vehicle._id, weekStart }

    if (nd === true) {
      await upsert(RentEntry, where, { amount: null, nd: true })
      return res.json({ ok: true, entry: { amount: null, nd: true } })
    }
    if (clear) {
      await RentEntry.deleteOne(where)
      return res.json({ ok: true, entry: null })
    }
    const value = parseAmount(amount)
    if (value === null) return res.status(400).json({ error: 'The amount must be from 0 to 1,000,000 with at most 2 decimals' })
    await upsert(RentEntry, where, { amount: value, nd: false })
    res.json({ ok: true, entry: { amount: value, nd: false } })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/rent-tracker/row/:vehicleId  { weeklyRent?, startWeek? }
// startWeek null goes back to the automatic start week.
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

    await upsert(RentRow, { orgId: req.orgId, vehicleId: vehicle._id }, set)
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

export default router
