import { Router, Request, Response } from 'express'
import Vehicle from '../models/Vehicle'
import Notification from '../models/Notification'

const router = Router()

// GET /api/fleet — all vehicles
router.get('/', async (_req: Request, res: Response) => {
  try {
    const vehicles = await Vehicle.find()
      .populate('currentRenter', 'name phone email')
      .populate('fines')
      .populate('tolls')
      .sort({ plate: 1 })
    res.json(vehicles)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fleet' })
  }
})

// GET /api/fleet/:plate — single vehicle
router.get('/:plate', async (req: Request, res: Response) => {
  try {
    const vehicle = await Vehicle.findOne({ plate: req.params.plate.toUpperCase() })
      .populate('currentRenter', 'name phone email licenceNumber')
      .populate('fines')
      .populate('tolls')
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })
    res.json(vehicle)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vehicle' })
  }
})

// POST /api/fleet — create vehicle
router.post('/', async (req: Request, res: Response) => {
  try {
    const vehicle = new Vehicle(req.body)
    await vehicle.save()
    res.status(201).json(vehicle)
  } catch (err: any) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Plate already exists' })
    }
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/fleet/:plate — update vehicle
router.put('/:plate', async (req: Request, res: Response) => {
  try {
    const vehicle = await Vehicle.findOneAndUpdate(
      { plate: req.params.plate.toUpperCase() },
      { $set: req.body },
      { new: true, runValidators: true }
    )
      .populate('currentRenter', 'name phone email')
      .populate('fines')
      .populate('tolls')

    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })

    // Auto-create rego notification if expiry changed and is within 30 days
    if (req.body.regoExpiry) {
      const expiry = new Date(req.body.regoExpiry)
      const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000)
      if (daysLeft <= 30 && daysLeft > 0) {
        await Notification.create({
          type: 'rego',
          title: `Rego expiring soon — ${vehicle.plate}`,
          description: `Registration expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} on ${expiry.toLocaleDateString('en-AU')}`,
          plate: vehicle.plate,
          actionRequired: true,
        })
      }
    }

    res.json(vehicle)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// DELETE /api/fleet/:plate — remove vehicle
router.delete('/:plate', async (req: Request, res: Response) => {
  try {
    const vehicle = await Vehicle.findOneAndDelete({ plate: req.params.plate.toUpperCase() })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })
    res.json({ message: 'Vehicle deleted', plate: vehicle.plate })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vehicle' })
  }
})

export default router
