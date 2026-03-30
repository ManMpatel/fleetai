import { Router } from 'express'
import axios from 'axios'

const router = Router()

async function getManagementToken() {
  const { data } = await axios.post(
    `https://${process.env.AUTH0_DOMAIN}/oauth/token`,
    {
      client_id: process.env.AUTH0_CLIENT_ID,
      client_secret: process.env.AUTH0_CLIENT_SECRET,
      audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type: 'client_credentials'
    }
  )
  return data.access_token
}

// GET all users
router.get('/users', async (_req, res) => {
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

// PATCH block/unblock user
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

// GET login logs
router.get('/logs', async (_req, res) => {
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