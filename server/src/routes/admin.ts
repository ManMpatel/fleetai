import { Router, Request, Response } from 'express'
import axios from 'axios'
import Organization from '../models/Organization'
import Renter from '../models/Renter'
import Vehicle from '../models/Vehicle'
import ServiceRecord from '../models/ServiceRecord'

// Platform operator routes. Mounted behind requireAuth + requireAdmin, which keys on the
// email claim inside the verified JWT. Previously this trusted an x-owner-email header,
// so anyone could claim super admin by setting a string.
const router = Router()

// Platform-wide aggregates are legitimately cross-tenant; per-tenant counts below are not.
const platformWide = { allowCrossTenant: true }

async function getManagementToken() {
  const { data } = await axios.post(
    `https://${process.env.AUTH0_DOMAIN}/oauth/token`,
    {
      client_id:     process.env.AUTH0_MGMT_CLIENT_ID,
      client_secret: process.env.AUTH0_MGMT_CLIENT_SECRET,
      audience:      `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type:    'client_credentials',
    }
  )
  return data.access_token
}

// GET /api/admin/owners
router.get('/owners', async (_req: Request, res: Response) => {
  try {
    const orgs = await Organization.find().sort({ createdAt: -1 })
    res.json(orgs)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

async function setStatus(req: Request, res: Response, update: Record<string, unknown>) {
  try {
    const org = await Organization.findOneAndUpdate(
      { email: decodeURIComponent(req.params.email) },
      update,
      { new: true }
    )
    if (!org) return res.status(404).json({ error: 'Organization not found' })
    res.json(org)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

router.patch('/owners/:email/approve', (req, res) => setStatus(req, res, { status: 'approved', approvedAt: new Date() }))
router.patch('/owners/:email/reject',  (req, res) => setStatus(req, res, { status: 'rejected' }))
router.patch('/owners/:email/revoke',  (req, res) => setStatus(req, res, { status: 'pending', $unset: { approvedAt: 1 } }))

// GET /api/admin/users — Auth0 directory
router.get('/users', async (_req, res) => {
  try {
    const token = await getManagementToken()
    const { data } = await axios.get(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { per_page: 50, include_totals: true, sort: 'last_login:-1' },
      }
    )
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/users/:userId — block/unblock
router.patch('/users/:userId', async (req, res) => {
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

// GET /api/admin/logs
router.get('/logs', async (_req, res) => {
  try {
    const token = await getManagementToken()
    const { data } = await axios.get(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/logs`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { per_page: 20, sort: 'date:-1', q: 'type:s OR type:f' },
      }
    )
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/sync-all-transactions — backfill PayWay transaction history across every tenant
router.post('/sync-all-transactions', async (_req: Request, res: Response) => {
  try {
    const { fetchAllTransactions, paywayCredsFor } = await import('../services/payway')
    const Transaction = (await import('../models/Transaction')).default

    const renters = await Renter.find({ 'payway.customerId': { $exists: true } }).setOptions(platformWide)
    const orgCache = new Map<string, any>()
    const results = []

    for (const renter of renters) {
      try {
        const key = String(renter.orgId)
        if (!orgCache.has(key)) orgCache.set(key, await Organization.findById(renter.orgId))
        const org = orgCache.get(key)
        if (!org) { results.push({ name: renter.name, error: 'Organization not found' }); continue }

        const creds = paywayCredsFor(org)
        const txns = await fetchAllTransactions(creds, renter.payway!.customerId!)
        let saved = 0
        for (const t of txns) {
          const r = await Transaction.updateOne(
            { transactionId: t.transactionId },
            { $setOnInsert: { ...t, renterId: renter.phone, orgId: renter.orgId } },
            { upsert: true }
          )
          if (r.upsertedCount) saved++
        }
        results.push({ name: renter.name, total: txns.length, saved })
      } catch (e: any) {
        results.push({ name: renter.name, error: e.message })
      }
    }
    res.json({ success: true, results })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/trigger-payment-check — run the daily PayWay decline sweep on demand
router.post('/trigger-payment-check', async (_req: Request, res: Response) => {
  try {
    const { checkPaymentStatus } = await import('../services/rag')
    await checkPaymentStatus()
    res.json({ success: true, message: 'Payment check triggered' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/stats
router.get('/stats', async (_req, res) => {
  try {
    const [totalOwners, approvedOwners, totalRenters, activeRenters,
           pendingRenters, totalVehicles, rentedVehicles, totalServices] = await Promise.all([
      Organization.countDocuments(),
      Organization.countDocuments({ status: 'approved' }),
      Renter.countDocuments().setOptions(platformWide),
      Renter.countDocuments({ status: 'active' }).setOptions(platformWide),
      Renter.countDocuments({ status: 'pending' }).setOptions(platformWide),
      Vehicle.countDocuments().setOptions(platformWide),
      Vehicle.countDocuments({ status: 'rented' }).setOptions(platformWide),
      ServiceRecord.countDocuments().setOptions(platformWide),
    ])

    const orgs = await Organization.find().sort({ createdAt: -1 })
    const breakdown = await Promise.all(orgs.map(async o => {
      const [renters, vehicles, services] = await Promise.all([
        Renter.countDocuments({ orgId: o._id }),
        Vehicle.countDocuments({ orgId: o._id }),
        ServiceRecord.countDocuments({ orgId: o._id }),
      ])
      return {
        email: o.email, name: o.displayName || o.name, status: o.status, picture: o.picture,
        renters, vehicles, services, createdAt: o.createdAt,
      }
    }))

    res.json({ totalOwners, approvedOwners, totalRenters, activeRenters,
               pendingRenters, totalVehicles, rentedVehicles, totalServices, breakdown })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
