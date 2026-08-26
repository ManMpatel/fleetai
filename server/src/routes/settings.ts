import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import Organization from '../models/Organization'
import { encrypt, hash } from '../services/encryption'
import { integrationStatus } from '../services/integrationStatus'

// Tenant self-service settings. Mounted behind requireAuth + requireTenant, so every
// handler operates on req.orgId and never on an id supplied by the caller.
const router = Router()

/** Secrets are write-only over the API — we report whether they are set, never the value. */
function publicSettings(org: any) {
  const status = integrationStatus(org)
  return {
    displayName: org.displayName || org.name || org.email,
    logoUrl: org.logoUrl || null,
    slug: org.slug || null,
    timezone: org.timezone,
    currency: org.currency,
    fleetSummary: org.fleetSummary || '',
    payway: {
      configured: status.payway.configured,
      fromEnv: status.payway.fromEnv,
      merchantId: org.payway?.merchantId || null,
      bankAccountId: org.payway?.bankAccountId || null,
    },
    whatsapp: {
      configured: status.whatsapp.configured,
      fromEnv: status.whatsapp.fromEnv,
      phoneId: org.whatsapp?.phoneId || null,
      enabled: status.whatsapp.enabled,
    },
    gmail: {
      configured: status.gmail.configured,
      fromEnv: status.gmail.fromEnv,
      address: org.gmail?.address || null,
      enabled: status.gmail.enabled,
    },
    sms: {
      configured: status.sms.configured,
      fromEnv: status.sms.fromEnv,
      username: org.sms?.username || null,
      enabled: status.sms.enabled,
    },
    tabletLinked: !!org.tabletTokenHash,
  }
}

// GET /api/settings
router.get('/', async (req: Request, res: Response) => {
  res.json(publicSettings(req.org))
})

// PUT /api/settings — branding and locale
router.put('/', async (req: Request, res: Response) => {
  try {
    const { displayName, logoUrl, timezone, currency, fleetSummary } = req.body
    const updates: Record<string, unknown> = {}
    if (displayName !== undefined) updates.displayName = displayName
    if (logoUrl !== undefined) updates.logoUrl = logoUrl
    if (timezone !== undefined) updates.timezone = timezone
    if (currency !== undefined) updates.currency = currency
    if (fleetSummary !== undefined) updates.fleetSummary = fleetSummary

    const org = await Organization.findByIdAndUpdate(req.orgId, { $set: updates }, { new: true })
    res.json(publicSettings(org))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/settings/payway — this tenant's own merchant account
router.put('/payway', async (req: Request, res: Response) => {
  try {
    const { merchantId, secretKey, publishableKey, bankAccountId } = req.body
    const updates: Record<string, unknown> = {}
    if (merchantId !== undefined) updates['payway.merchantId'] = merchantId
    if (bankAccountId !== undefined) updates['payway.bankAccountId'] = bankAccountId
    if (secretKey) updates['payway.secretKeyEnc'] = encrypt(secretKey)
    if (publishableKey) updates['payway.publishableKeyEnc'] = encrypt(publishableKey)

    const org = await Organization.findByIdAndUpdate(req.orgId, { $set: updates }, { new: true })
    res.json(publicSettings(org))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/settings/whatsapp
router.put('/whatsapp', async (req: Request, res: Response) => {
  try {
    const { phoneId, token, enabled } = req.body
    const updates: Record<string, unknown> = {}

    if (phoneId !== undefined) {
      // The inbound webhook routes on this value, so it must identify exactly one tenant.
      const clash = await Organization.findOne({ 'whatsapp.phoneId': phoneId })
      if (clash && !clash._id.equals(req.orgId!)) {
        return res.status(409).json({ error: 'That WhatsApp number is already connected to another account' })
      }
      updates['whatsapp.phoneId'] = phoneId
    }
    if (token) updates['whatsapp.tokenEnc'] = encrypt(token)
    if (enabled !== undefined) updates['whatsapp.enabled'] = !!enabled

    const org = await Organization.findByIdAndUpdate(req.orgId, { $set: updates }, { new: true })
    res.json(publicSettings(org))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/settings/gmail
router.put('/gmail', async (req: Request, res: Response) => {
  try {
    const { address, refreshToken, enabled } = req.body
    const updates: Record<string, unknown> = {}
    if (address !== undefined) updates['gmail.address'] = address
    if (refreshToken) updates['gmail.refreshTokenEnc'] = encrypt(refreshToken)
    if (enabled !== undefined) updates['gmail.enabled'] = !!enabled

    const org = await Organization.findByIdAndUpdate(req.orgId, { $set: updates }, { new: true })
    res.json(publicSettings(org))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/settings/tablet-token — issue (or rotate) the workshop tablet credential
router.post('/tablet-token', async (req: Request, res: Response) => {
  try {
    const token = crypto.randomBytes(32).toString('base64url')
    await Organization.findByIdAndUpdate(req.orgId, { $set: { tabletTokenHash: hash(token) } })
    // Shown once. Only the hash is stored, so it cannot be recovered later.
    res.json({ token })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/settings/tablet-token — revoke a lost or stolen tablet
router.delete('/tablet-token', async (req: Request, res: Response) => {
  try {
    await Organization.findByIdAndUpdate(req.orgId, { $unset: { tabletTokenHash: 1 } })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
