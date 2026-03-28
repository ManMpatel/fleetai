import { Router, Request, Response } from 'express'
import Notification from '../models/Notification'

const router = Router()

// GET /api/notifications
router.get('/', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {}
    if (req.query.type) filter.type = req.query.type
    if (req.query.read !== undefined) filter.read = req.query.read === 'true'

    const notifications = await Notification.find(filter).sort({ date: -1 }).limit(200)
    res.json(notifications)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

// POST /api/notifications
router.post('/', async (req: Request, res: Response) => {
  try {
    const notification = new Notification(req.body)
    await notification.save()
    res.status(201).json(notification)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/notifications/read-all — must come BEFORE /:id
router.put('/read-all', async (_req: Request, res: Response) => {
  try {
    await Notification.updateMany({ read: false }, { $set: { read: true } })
    res.json({ message: 'All notifications marked as read' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all as read' })
  }
})

// PUT /api/notifications/:id — mark single as read
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { $set: { read: true } },
      { new: true }
    )
    if (!notification) return res.status(404).json({ error: 'Notification not found' })
    res.json(notification)
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification' })
  }
})

export default router
