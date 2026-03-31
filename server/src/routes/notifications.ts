import { Router, Request, Response } from 'express'
import Notification from '../models/Notification'
import { requireOwner } from '../middleware/ownerAuth'

const router = Router()

router.use(requireOwner)

router.get('/', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = { ownerId: req.ownerEmail }
    if (req.query.type) filter.type = req.query.type
    if (req.query.read !== undefined) filter.read = req.query.read === 'true'

    const notifications = await Notification.find(filter).sort({ date: -1 }).limit(200)
    res.json(notifications)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

router.post('/', async (req: Request, res: Response) => {
  try {
    const notification = new Notification({ ...req.body, ownerId: req.ownerEmail })
    await notification.save()
    res.status(201).json(notification)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

router.put('/read-all', async (req: Request, res: Response) => {
  try {
    await Notification.updateMany(
      { ownerId: req.ownerEmail, read: false },
      { $set: { read: true } }
    )
    res.json({ message: 'All notifications marked as read' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all as read' })
  }
})

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.ownerEmail },
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