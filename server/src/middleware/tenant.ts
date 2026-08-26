import { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import Organization, { IOrganization } from '../models/Organization'
import { hash } from '../services/encryption'
import { integrationStatus } from '../services/integrationStatus'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      orgId?: Types.ObjectId
      org?: IOrganization
    }
  }
}

// Auth0 access tokens only carry profile claims if a Rule/Action adds them. We check the
// namespaced claim first, then the standard one. Identity is NEVER taken from the body or
// from a header, only from the payload express-oauth2-jwt-bearer has already verified.
const EMAIL_CLAIMS = [
  `https://${process.env.AUTH0_DOMAIN || 'fleetai.au.auth0.com'}/email`,
  'https://fleetai.au.auth0.com/email',
  'email',
]

export function verifiedEmail(req: Request): string | null {
  const payload = (req as any).auth?.payload
  if (!payload) return null
  for (const claim of EMAIL_CLAIMS) {
    const value = payload[claim]
    if (typeof value === 'string' && value.includes('@')) return value.toLowerCase()
  }
  return null
}

export function verifiedSub(req: Request): string | null {
  const sub = (req as any).auth?.payload?.sub
  return typeof sub === 'string' && sub.length > 0 ? sub : null
}

/**
 * Platform operator check. Matches on the token's email claim, or on the Auth0 subject
 * when the deployment's tokens carry no email claim (SUPER_ADMIN_AUTH0_ID). Fails closed:
 * with neither variable set, nobody is a super admin.
 */
export function isSuperAdminRequest(req: Request): boolean {
  const superAdminSub = process.env.SUPER_ADMIN_AUTH0_ID || ''
  if (superAdminSub && verifiedSub(req) === superAdminSub) return true

  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase()
  if (!superAdminEmail) return false
  const email = verifiedEmail(req)
  return !!email && email === superAdminEmail
}

/**
 * Resolves the calling tenant from the verified Auth0 token. Must be mounted after
 * requireAuth. Sets req.orgId, the single source of tenancy for every downstream query.
 */
export async function requireTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const sub = verifiedSub(req)
    if (!sub) return res.status(401).json({ error: 'Not authenticated' })

    let org = await Organization.findOne({ auth0Id: sub })

    // Organizations created before auth0Id was recorded resolve once by verified email
    // claim, and are backfilled so subsequent requests match on sub.
    if (!org) {
      const email = verifiedEmail(req)
      if (email) {
        org = await Organization.findOne({ email })
        if (org && !org.auth0Id) {
          org.auth0Id = sub
          await org.save()
        }
      }
    }

    if (!org)                      return res.status(403).json({ error: 'Organization not found', code: 'NOT_REGISTERED' })
    if (org.status === 'pending')  return res.status(403).json({ error: 'Approval pending',       code: 'PENDING' })
    if (org.status === 'rejected') return res.status(403).json({ error: 'Access rejected',        code: 'REJECTED' })

    req.orgId = org._id
    req.org = org
    next()
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed' })
  }
}

/**
 * Resolves the tenant from a workshop tablet device token instead of a user JWT.
 * The tablet is unattended, so it gets a long-lived revocable token rather than a login.
 */
export async function requireTabletToken(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) return res.status(401).json({ error: 'Tablet not linked', code: 'NO_TOKEN' })

    const org = await Organization.findOne({ tabletTokenHash: hash(token) })
    if (!org) return res.status(401).json({ error: 'Tablet link invalid or revoked', code: 'BAD_TOKEN' })
    if (org.status !== 'approved') return res.status(403).json({ error: 'Access rejected', code: 'REJECTED' })

    req.orgId = org._id
    req.org = org
    next()
  } catch (err) {
    res.status(500).json({ error: 'Tablet auth failed' })
  }
}

// ── Auth endpoints ──────────────────────────────────────────

/** The single payload the dashboard needs at boot: access state plus tenant branding. */
function statusPayload(req: Request, org: IOrganization) {
  const status = integrationStatus(org)
  return {
    status: org.status,
    email: org.email,
    isSuperAdmin: isSuperAdminRequest(req),
    org: {
      displayName: org.displayName || org.name || org.email,
      logoUrl: org.logoUrl || null,
      slug: org.slug || null,
      timezone: org.timezone,
      currency: org.currency,
      paywayConfigured: status.payway.configured,
      whatsappConfigured: status.whatsapp.configured,
      gmailConfigured: status.gmail.configured,
      smsConfigured: status.sms.configured,
      tabletLinked: !!org.tabletTokenHash,
    },
  }
}

/** POST /api/auth/register — behind requireAuth. Identity comes from the token. */
export async function registerOrganization(req: Request, res: Response) {
  try {
    const sub = verifiedSub(req)
    if (!sub) return res.status(401).json({ error: 'Not authenticated' })

    const claimEmail = verifiedEmail(req)
    // name/picture/email from the body are display data only; nothing authorizes on them.
    const { email: bodyEmail, name, picture } = req.body as Record<string, string>
    const email = claimEmail || (bodyEmail || '').toLowerCase()
    if (!email) return res.status(400).json({ error: 'Email required' })

    let org = await Organization.findOne({ auth0Id: sub })
    if (!org) org = await Organization.findOne({ email })

    if (!org) {
      // Only token-verified identity can bootstrap the super admin, never a body value.
      const isSuperAdmin = isSuperAdminRequest(req)
      org = await Organization.create({
        email,
        name,
        picture,
        auth0Id: sub,
        displayName: name,
        status: isSuperAdmin ? 'approved' : 'pending',
      })
    } else {
      org.auth0Id = sub
      org.name = name || org.name
      org.picture = picture || org.picture
      await org.save()
    }

    res.json(statusPayload(req, org))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

/** GET /api/auth/status — behind requireAuth. */
export async function getOrganizationStatus(req: Request, res: Response) {
  try {
    const sub = verifiedSub(req)
    if (!sub) return res.status(401).json({ error: 'Not authenticated' })

    const org = await Organization.findOne({ auth0Id: sub })
    if (!org) return res.json({ status: 'not_registered', isSuperAdmin: false })

    res.json(statusPayload(req, org))
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' })
  }
}

/** GET /api/auth/slug — behind requireAuth + requireTenant. */
export async function getOrganizationSlug(req: Request, res: Response) {
  res.json({ slug: req.org?.slug || null })
}

/** POST /api/auth/slug — behind requireAuth + requireTenant. */
export async function setOrganizationSlug(req: Request, res: Response) {
  try {
    const { slug } = req.body as { slug?: string }
    if (!slug) return res.status(400).json({ error: 'Slug required' })

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)
    if (!cleanSlug) return res.status(400).json({ error: 'Slug must contain letters or numbers' })

    const existing = await Organization.findOne({ slug: cleanSlug })
    if (existing && !existing._id.equals(req.orgId!)) {
      return res.status(409).json({ error: 'This name is already taken' })
    }

    const org = await Organization.findByIdAndUpdate(req.orgId, { slug: cleanSlug }, { new: true })
    res.json({ slug: org?.slug })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

/**
 * GET /api/auth/resolve/:slug — public. Maps a share link to the tenant that owns it.
 * Returns display data only; the orgId is never exposed to the client.
 */
export async function resolveSlug(req: Request, res: Response) {
  try {
    const org = await Organization.findOne({ slug: req.params.slug, status: 'approved' })
    if (!org) return res.status(404).json({ error: 'Invalid link' })
    res.json({
      slug: org.slug,
      name: org.displayName || org.name || '',
      logoUrl: org.logoUrl || null,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve slug' })
  }
}
