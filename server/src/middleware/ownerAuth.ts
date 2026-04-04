import { Request, Response, NextFunction } from 'express'
import Owner from '../models/Owner'

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
    res.json({ email: owner.email, name: owner.name })
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve slug' })
  }
}