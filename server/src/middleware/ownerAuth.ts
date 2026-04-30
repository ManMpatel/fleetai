import { Request, Response, NextFunction } from 'express'
import Owner from '../models/Owner'
import { encrypt, decrypt } from '../services/encryption'

declare global {
  namespace Express {
    interface Request {
      ownerEmail?: string
    }
  }
}

export async function requireOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const email = req.headers['x-owner-email'] as string
    if (!email) return res.status(401).json({ error: 'Not authenticated' })

    const owner = await Owner.findOne({ email })
    if (!owner)                    return res.status(403).json({ error: 'Owner not found',    code: 'NOT_REGISTERED' })
    if (owner.status === 'pending')  return res.status(403).json({ error: 'Approval pending',  code: 'PENDING' })
    if (owner.status === 'rejected') return res.status(403).json({ error: 'Access rejected',   code: 'REJECTED' })

    req.ownerEmail = email
    next()
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed' })
  }
}

export async function registerOwner(req: Request, res: Response) {
  try {
    const { email, name, picture, auth0Id } = req.body
    if (!email) return res.status(400).json({ error: 'Email required' })

    let owner = await Owner.findOne({ email })
    const SUPER_ADMIN = 'manpatel1144@gmail.com'
    if (!owner) {
    owner = await Owner.create({ 
        email, name, picture, auth0Id, 
        status: email === SUPER_ADMIN ? 'approved' : 'pending' 
    }) } else {
      owner.name    = name    || owner.name
      owner.picture = picture || owner.picture
      await owner.save()
    }

    res.json({ status: owner.status, email: owner.email })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

export async function getOwnerStatus(req: Request, res: Response) {
  try {
    const email = req.query.email as string
    if (!email) return res.status(400).json({ error: 'Email required' })

    const owner = await Owner.findOne({ email })
    if (!owner) return res.json({ status: 'not_registered' })

    res.json({ status: owner.status })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' })
  }
}

// GET /api/auth/slug — get owner's current slug
export async function getOwnerSlug(req: Request, res: Response) {
  try {
    const email = req.headers['x-owner-email'] as string
    if (!email) return res.status(401).json({ error: 'Not authenticated' })
    const owner = await Owner.findOne({ email })
    if (!owner) return res.status(404).json({ error: 'Owner not found' })
    res.json({ slug: owner.slug || null })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get slug' })
  }
}

// POST /api/auth/slug — set owner's slug
export async function setOwnerSlug(req: Request, res: Response) {
  try {
    const email = req.headers['x-owner-email'] as string
    if (!email) return res.status(401).json({ error: 'Not authenticated' })
    const { slug } = req.body
    if (!slug) return res.status(400).json({ error: 'Slug required' })

    // Clean slug — lowercase, alphanumeric + hyphens only
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)

    // Check not taken
    const existing = await Owner.findOne({ slug: cleanSlug })
    if (existing && existing.email !== email) {
      return res.status(409).json({ error: 'This name is already taken' })
    }

    const owner = await Owner.findOneAndUpdate(
      { email },
      { slug: cleanSlug },
      { new: true }
    )
    res.json({ slug: owner?.slug })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

// GET /api/auth/resolve/:slug — resolve slug to owner email (public)
export async function resolveSlug(req: Request, res: Response) {
  try {
    const owner = await Owner.findOne({ slug: req.params.slug })
    if (!owner) return res.status(404).json({ error: 'Invalid link' })
    res.json({ email: owner.email, name: (owner as any).businessName || owner.name })
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve slug' })
  }
}export async function getBusinessName(req: Request, res: Response) {
  try {
    const email = req.headers['x-owner-email'] as string
    if (!email) return res.status(401).json({ error: 'Not authenticated' })
    const owner = await Owner.findOne({ email })
    res.json({ businessName: (owner as any)?.businessName || '' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get business name' })
  }
}

export async function setBusinessName(req: Request, res: Response) {
  try {
    const email = req.headers['x-owner-email'] as string
    if (!email) return res.status(401).json({ error: 'Not authenticated' })
    const { businessName } = req.body
    if (!businessName?.trim()) return res.status(400).json({ error: 'Business name required' })
    await Owner.findOneAndUpdate({ email }, { businessName: businessName.trim() })
    res.json({ businessName: businessName.trim() })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save business name' })
  }
}

// GET /api/auth/payway-settings — returns non-secret fields only
export async function getPayWaySettings(req: Request, res: Response) {
  try {
    const email = req.headers['x-owner-email'] as string
    if (!email) return res.status(401).json({ error: 'Not authenticated' })
    const owner = await Owner.findOne({ email })
    if (!owner) return res.status(404).json({ error: 'Owner not found' })
    res.json({
      hasKeys: !!(owner as any).paywaySecretKey,
      merchantId: (owner as any).paywayMerchantId ? decrypt((owner as any).paywayMerchantId) : '',
      bankAccountId: (owner as any).paywayBankAccountId ? decrypt((owner as any).paywayBankAccountId) : '',
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get PayWay settings' })
  }
}

// POST /api/auth/payway-settings — encrypt and save all 4 keys
export async function setPayWaySettings(req: Request, res: Response) {
  try {
    const email = req.headers['x-owner-email'] as string
    if (!email) return res.status(401).json({ error: 'Not authenticated' })
    const { secretKey, publishableKey, merchantId, bankAccountId } = req.body
    if (!secretKey || !publishableKey || !merchantId || !bankAccountId) {
      return res.status(400).json({ error: 'All 4 PayWay fields are required' })
    }
    await Owner.findOneAndUpdate(
      { email },
      {
        paywaySecretKey:      encrypt(secretKey.trim()),
        paywayPublishableKey: encrypt(publishableKey.trim()),
        paywayMerchantId:     encrypt(merchantId.trim()),
        paywayBankAccountId:  encrypt(bankAccountId.trim()),
      }
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save PayWay settings' })
  }
}

// Helper: fetch and decrypt owner's PayWay keys — falls back to env vars if not set
export async function getOwnerPayWayKeys(ownerEmail: string): Promise<{ secretKey: string; publishableKey: string; merchantId: string; bankAccountId: string } | undefined> {
  try {
    const owner = await Owner.findOne({ email: ownerEmail })
    if (!(owner as any)?.paywaySecretKey) return undefined
    return {
      secretKey:      decrypt((owner as any).paywaySecretKey),
      publishableKey: decrypt((owner as any).paywayPublishableKey),
      merchantId:     decrypt((owner as any).paywayMerchantId),
      bankAccountId:  decrypt((owner as any).paywayBankAccountId),
    }
  } catch { return undefined }
}

export async function getSmsSettings(req: Request, res: Response) {
  try {
    const email = req.headers['x-owner-email'] as string
    if (!email) return res.status(401).json({ error: 'Not authenticated' })
    const owner = await Owner.findOne({ email })
    res.json({
      mmApiUsername: (owner as any)?.mmApiUsername || '',
      mmApiPassword: (owner as any)?.mmApiPassword ? '••••••••' : '',
      configured: !!((owner as any)?.mmApiUsername && (owner as any)?.mmApiPassword)
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get SMS settings' })
  }
}

export async function setSmsSettings(req: Request, res: Response) {
  try {
    const email = req.headers['x-owner-email'] as string
    if (!email) return res.status(401).json({ error: 'Not authenticated' })
    const { mmApiUsername, mmApiPassword } = req.body
    if (!mmApiUsername || !mmApiPassword) return res.status(400).json({ error: 'Both fields required' })
    await Owner.findOneAndUpdate({ email }, { mmApiUsername, mmApiPassword })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to save SMS settings' })
  }
}