import { Router, Request, Response } from 'express'
import axios from 'axios'
import Organization from '../models/Organization'
import Renter from '../models/Renter'
import Vehicle from '../models/Vehicle'
import ServiceRecord from '../models/ServiceRecord'
import { encrypt } from '../services/encryption'

// Platform operator routes. Mounted behind requireAuth + requireAdmin, which keys on the
// email claim inside the verified JWT. Previously this trusted an x-owner-email header,
// so anyone could claim super admin by setting a string.
const router = Router()

// Platform-wide aggregates are legitimately cross-tenant; per-tenant counts below are not.
const platformWide = { allowCrossTenant: true }

// The Auth0 database connection new client logins are created in. Override only if the
// Auth0 tenant renamed it away from the default.
const DB_CONNECTION = process.env.AUTH0_DB_CONNECTION || 'Username-Password-Authentication'

/** The operator's own login is not removable through the UI they are removing it from. */
function isPlatformOperator(email: string) {
  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase()
  return !!superAdminEmail && email.toLowerCase() === superAdminEmail
}

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

// Fields safe to hand to the admin dashboard. Ciphertext and the tablet token hash are
// deliberately excluded — the admin decides whether a credential is set, never reads it.
const OWNER_PROJECTION =
  '_id email name picture status approvedAt createdAt displayName slug auth0Id ' +
  'payway.merchantId payway.bankAccountId payway.secretKeyEnc payway.publishableKeyEnc ' +
  'whatsapp.phoneId whatsapp.enabled whatsapp.tokenEnc ' +
  'gmail.address gmail.enabled gmail.refreshTokenEnc ' +
  'sms.username sms.sender sms.enabled sms.passwordEnc tabletTokenHash'

/** Collapses every secret to a boolean before the record leaves the server. */
function ownerSummary(org: any) {
  return {
    _id: org._id,
    email: org.email,
    name: org.name,
    picture: org.picture,
    status: org.status,
    approvedAt: org.approvedAt,
    createdAt: org.createdAt,
    displayName: org.displayName || org.name || org.email,
    slug: org.slug || null,
    hasAuth0Id: !!org.auth0Id,
    credentials: {
      payway: {
        configured: !!org.payway?.secretKeyEnc,
        merchantId: org.payway?.merchantId || null,
        bankAccountId: org.payway?.bankAccountId || null,
      },
      whatsapp: {
        configured: !!org.whatsapp?.tokenEnc,
        phoneId: org.whatsapp?.phoneId || null,
        enabled: !!org.whatsapp?.enabled,
      },
      gmail: {
        configured: !!org.gmail?.refreshTokenEnc,
        address: org.gmail?.address || null,
        enabled: !!org.gmail?.enabled,
      },
      sms: {
        configured: !!org.sms?.passwordEnc,
        username: org.sms?.username || null,
        sender: org.sms?.sender || null,
        enabled: !!org.sms?.enabled,
      },
      tabletLinked: !!org.tabletTokenHash,
    },
  }
}

// GET /api/admin/owners
router.get('/owners', async (_req: Request, res: Response) => {
  try {
    const orgs = await Organization.find().select(OWNER_PROJECTION).sort({ createdAt: -1 })
    res.json(orgs.map(ownerSummary))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * PUT /api/admin/owners/:email/credentials
 *
 * The platform operator onboards a new client by entering that client's own PayWay,
 * WhatsApp, Gmail and SMS credentials here. Secrets are encrypted on write and are never
 * readable again through the API — a blank field means "leave whatever is stored alone",
 * which is what makes the form safe to re-open and edit.
 */
router.put('/owners/:email/credentials', async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase()
    const org = await Organization.findOne({ email })
    if (!org) return res.status(404).json({ error: 'Organization not found' })

    const { payway, whatsapp, gmail, sms } = req.body as Record<string, any>
    const set: Record<string, unknown> = {}

    if (payway) {
      if (payway.merchantId !== undefined) set['payway.merchantId'] = String(payway.merchantId).trim()
      if (payway.bankAccountId !== undefined) set['payway.bankAccountId'] = String(payway.bankAccountId).trim() || '0000000A'
      if (payway.secretKey) set['payway.secretKeyEnc'] = encrypt(String(payway.secretKey).trim())
      if (payway.publishableKey) set['payway.publishableKeyEnc'] = encrypt(String(payway.publishableKey).trim())
    }

    if (whatsapp) {
      if (whatsapp.phoneId !== undefined) {
        const phoneId = String(whatsapp.phoneId).trim()
        if (phoneId) {
          // The inbound webhook routes on this value, so it must identify one tenant.
          const clash = await Organization.findOne({ 'whatsapp.phoneId': phoneId })
          if (clash && !clash._id.equals(org._id)) {
            return res.status(409).json({ error: 'That WhatsApp number is already connected to another organisation' })
          }
        }
        set['whatsapp.phoneId'] = phoneId
      }
      if (whatsapp.token) set['whatsapp.tokenEnc'] = encrypt(String(whatsapp.token).trim())
      if (whatsapp.enabled !== undefined) set['whatsapp.enabled'] = !!whatsapp.enabled
    }

    if (gmail) {
      if (gmail.address !== undefined) set['gmail.address'] = String(gmail.address).trim()
      if (gmail.refreshToken) set['gmail.refreshTokenEnc'] = encrypt(String(gmail.refreshToken).trim())
      if (gmail.enabled !== undefined) set['gmail.enabled'] = !!gmail.enabled
    }

    if (sms) {
      if (sms.username !== undefined) set['sms.username'] = String(sms.username).trim()
      if (sms.sender !== undefined) set['sms.sender'] = String(sms.sender).trim()
      if (sms.password) set['sms.passwordEnc'] = encrypt(String(sms.password).trim())
      if (sms.enabled !== undefined) set['sms.enabled'] = !!sms.enabled
    }

    if (Object.keys(set).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' })
    }

    const updated = await Organization.findByIdAndUpdate(org._id, { $set: set }, { new: true })
      .select(OWNER_PROJECTION)
    res.json(ownerSummary(updated))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

async function setStatus(req: Request, res: Response, update: Record<string, unknown>) {
  try {
    const org = await Organization.findOneAndUpdate(
      { email: decodeURIComponent(req.params.email) },
      update,
      { new: true }
    ).select(OWNER_PROJECTION)
    if (!org) return res.status(404).json({ error: 'Organization not found' })
    res.json(ownerSummary(org))
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

/**
 * POST /api/admin/users — onboard a client in one step.
 *
 * Creates the Auth0 login they sign in with plus the Organization record every
 * tenant-scoped query keys on, and approves it: the operator making this call is the same
 * person who would otherwise approve the request from the Owners tab.
 *
 * Credentials are deliberately NOT accepted here. The dashboard opens the credentials form
 * against the returned organisation straight after, so every secret travels through the one
 * route that encrypts it.
 */
router.post('/users', async (req: Request, res: Response) => {
  try {
    const email    = String((req.body as any).email || '').trim().toLowerCase()
    const name     = String((req.body as any).name || '').trim()
    const password = String((req.body as any).password || '')

    if (!email.includes('@'))  return res.status(400).json({ error: 'A valid email is required' })
    if (password.length < 8)   return res.status(400).json({ error: 'Password must be at least 8 characters' })

    const existing = await Organization.findOne({ email })
    if (existing) return res.status(409).json({ error: 'An organisation with that email already exists' })

    const token = await getManagementToken()

    let auth0User: any
    try {
      const { data } = await axios.post(
        `https://${process.env.AUTH0_DOMAIN}/api/v2/users`,
        {
          email,
          name: name || email,
          password,
          connection: DB_CONNECTION,
          email_verified: false,
          verify_email: false,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      auth0User = data
    } catch (err: any) {
      // Auth0 states the actual reason — password policy, address already taken. Passing it
      // through is the difference between an operator fixing it and guessing at it.
      const detail = err.response?.data?.message || err.response?.data?.error || err.message
      return res.status(err.response?.status === 409 ? 409 : 400).json({ error: detail })
    }

    try {
      const org = await Organization.create({
        email,
        name: name || email,
        displayName: name || email,
        auth0Id: auth0User.user_id,
        status: 'approved',
        approvedAt: new Date(),
      })
      const created = await Organization.findById(org._id).select(OWNER_PROJECTION)
      res.status(201).json({ user: auth0User, owner: ownerSummary(created) })
    } catch (err: any) {
      // A login with no tenancy behind it can sign in and reach nothing. Roll it back
      // rather than leaving the operator to find the orphan in the Auth0 dashboard.
      await axios.delete(
        `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(auth0User.user_id)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(() => {})
      res.status(500).json({ error: `Login created but organisation failed: ${err.message}` })
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * DELETE /api/admin/users/:userId — remove a client's access.
 *
 * Deletes the Auth0 login and revokes the organisation. The organisation record and
 * everything scoped to it — renters, vehicles, services, transactions — is deliberately
 * kept: dropping it would orphan that data with no way back. Creating a fresh login for
 * the same email and re-approving from the Owners tab restores access to it.
 */
router.delete('/users/:userId', async (req: Request, res: Response) => {
  try {
    const userId = decodeURIComponent(req.params.userId)
    const token = await getManagementToken()

    const { data: target } = await axios.get(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    const email = String(target?.email || '').toLowerCase()
    if (isPlatformOperator(email)) {
      return res.status(400).json({ error: 'The platform administrator account cannot be removed here' })
    }

    await axios.delete(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    // auth0Id is cleared too, so a later login for this address cannot resolve to a
    // tenancy the operator has just closed.
    const org = email
      ? await Organization.findOneAndUpdate(
          { email },
          { $set: { status: 'rejected' }, $unset: { auth0Id: 1, approvedAt: 1 } },
          { new: true }
        ).select(OWNER_PROJECTION)
      : null

    res.json({ removed: userId, owner: org ? ownerSummary(org) : null })
  } catch (err: any) {
    const detail = err.response?.data?.message || err.message
    res.status(err.response?.status === 404 ? 404 : 500).json({ error: detail })
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
            { transactionId: t.transactionId, orgId: renter.orgId },
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
