import { Router, Request, Response } from 'express'
import axios from 'axios'
import Owner from '../models/Owner'

const router = Router()

const SUPER_ADMIN = 'manpatel1144@gmail.com'

function requireSuperAdmin(req: Request, res: Response, next: Function) {
  const email = req.headers['x-owner-email'] as string
  if (email !== SUPER_ADMIN) {
    return res.status(403).json({ error: 'Super admin only' })
  }
  next()
}

async function getManagementToken() {
  const { data } = await axios.post(
    `https://${process.env.AUTH0_DOMAIN}/oauth/token`,
    {
      client_id:     process.env.AUTH0_MGMT_CLIENT_ID,
      client_secret: process.env.AUTH0_MGMT_CLIENT_SECRET,
      audience:      `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type:    'client_credentials'
    }
  )
  return data.access_token
}

// GET all owners with status
router.get('/owners', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const owners = await Owner.find().sort({ createdAt: -1 })
    res.json(owners)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Approve owner
router.patch('/owners/:email/approve', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const owner = await Owner.findOneAndUpdate(
      { email: decodeURIComponent(req.params.email) },
      { status: 'approved', approvedAt: new Date() },
      { new: true }
    )
    if (!owner) return res.status(404).json({ error: 'Owner not found' })
    res.json(owner)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Reject owner
router.patch('/owners/:email/reject', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const owner = await Owner.findOneAndUpdate(
      { email: decodeURIComponent(req.params.email) },
      { status: 'rejected' },
      { new: true }
    )
    if (!owner) return res.status(404).json({ error: 'Owner not found' })
    res.json(owner)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Revoke access (back to pending)
router.patch('/owners/:email/revoke', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const owner = await Owner.findOneAndUpdate(
      { email: decodeURIComponent(req.params.email) },
      { status: 'pending', $unset: { approvedAt: 1 } },
      { new: true }
    )
    if (!owner) return res.status(404).json({ error: 'Owner not found' })
    res.json(owner)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Auth0 users
router.get('/users', requireSuperAdmin, async (_req, res) => {
  try {
    const token = await getManagementToken()
    const { data } = await axios.get(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { per_page: 50, include_totals: true, sort: 'last_login:-1' }
      }
    )
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Block/unblock user
router.patch('/users/:userId', requireSuperAdmin, async (req, res) => {
  try {
    const token = await getManagementToken()
    const { blocked } = req.body as { blocked: boolean }
    const { data } = await axios.patch(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(req.params.userId)}`,
      { blocked },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Login logs
router.get('/logs', requireSuperAdmin, async (_req, res) => {
  try {
    const token = await getManagementToken()
    const { data } = await axios.get(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/logs`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { per_page: 20, sort: 'date:-1', q: 'type:s OR type:f' }
      }
    )
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/stats — MongoDB platform stats
router.get('/stats', requireSuperAdmin, async (_req, res) => {
  try {
    const Renter  = (await import('../models/Renter')).default
    const Vehicle = (await import('../models/Vehicle')).default
    const ServiceRecord = (await import('../models/ServiceRecord')).default

    const [totalOwners, approvedOwners, totalRenters, activeRenters,
           pendingRenters, totalVehicles, rentedVehicles, totalServices] = await Promise.all([
      Owner.countDocuments(),
      Owner.countDocuments({ status: 'approved' }),
      Renter.countDocuments(),
      Renter.countDocuments({ status: 'active' }),
      Renter.countDocuments({ status: 'pending' }),
      Vehicle.countDocuments(),
      Vehicle.countDocuments({ status: 'rented' }),
      ServiceRecord.countDocuments(),
    ])

    // Per-owner breakdown
    const owners = await Owner.find().sort({ createdAt: -1 })
    const breakdown = await Promise.all(owners.map(async o => {
      const [renters, vehicles, services] = await Promise.all([
        Renter.countDocuments({ ownerId: o.email }),
        Vehicle.countDocuments({ ownerId: o.email }),
        ServiceRecord.countDocuments({ ownerId: o.email }),
      ])
      return { email: o.email, name: o.name, status: o.status, picture: o.picture, renters, vehicles, services, createdAt: o.createdAt }
    }))

    res.json({ totalOwners, approvedOwners, totalRenters, activeRenters,
               pendingRenters, totalVehicles, rentedVehicles, totalServices, breakdown })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/stats
router.get('/stats', requireSuperAdmin, async (_req, res) => {
  try {
    const Renter = (await import('../models/Renter')).default
    const Vehicle = (await import('../models/Vehicle')).default
    const ServiceRecord = (await import('../models/ServiceRecord')).default
    const owners = await Owner.find().sort({ createdAt: -1 })
    const [totalRenters, activeRenters, pendingRenters, totalVehicles, rentedVehicles, totalServices] = await Promise.all([
      Renter.countDocuments(),
      Renter.countDocuments({ status: 'active' }),
      Renter.countDocuments({ status: 'pending' }),
      Vehicle.countDocuments(),
      Vehicle.countDocuments({ status: 'rented' }),
      ServiceRecord.countDocuments(),
    ])
    const breakdown = await Promise.all(owners.map(async o => {
      const [renters, vehicles, services] = await Promise.all([
        Renter.countDocuments({ ownerId: o.email }),
        Vehicle.countDocuments({ ownerId: o.email }),
        ServiceRecord.countDocuments({ ownerId: o.email }),
      ])
      return { email: o.email, name: o.name, status: o.status, picture: o.picture, renters, vehicles, services, createdAt: o.createdAt }
    }))
    res.json({ totalOwners: owners.length, approvedOwners: owners.filter(o => o.status === 'approved').length, totalRenters, activeRenters, pendingRenters, totalVehicles, rentedVehicles, totalServices, breakdown })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/sync-payway-dates — one-time, delete after use
router.post('/sync-payway-dates', async (req: Request, res: Response) => {
  try {
    const { getCustomerSchedule } = await import('../services/payway')
    const Renter = (await import('../models/Renter')).default

    const renters = await Renter.find({
      'payway.status': { $in: ['active', 'paused'] },
      'payway.customerId': { $exists: true },
    })

    const results = []
    for (const renter of renters) {
      const customerId = renter.payway!.customerId!
      const schedule = await getCustomerSchedule(customerId)
      console.log(`📥 PayWay schedule for ${renter.name} (${customerId}):`, JSON.stringify(schedule, null, 2))
      if (schedule.success && schedule.nextPaymentDate) {
        renter.payway!.nextDebitDate = schedule.nextPaymentDate
        await renter.save()
        results.push({ name: renter.name, nextDebitDate: schedule.nextPaymentDate, status: 'updated' })
      } else {
        results.push({ name: renter.name, status: 'failed', error: schedule.error })
      }
    }

    res.json({ updated: results.length, results })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
export default router