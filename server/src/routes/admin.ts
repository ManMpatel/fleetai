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
      client_id:     process.env.AUTH0_CLIENT_ID,
      client_secret: process.env.AUTH0_CLIENT_SECRET,
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

export default router