import { Router, Request, Response } from 'express'
import Vehicle from '../models/Vehicle'
import Notification from '../models/Notification'
import { requireOwner } from '../middleware/ownerAuth'

const router = Router()

router.use(requireOwner)

router.get('/', async (req: Request, res: Response) => {
  try {
    const vehicles = await Vehicle.find({ ownerId: req.ownerEmail })
      .populate('currentRenter', 'name phone email')
      .populate('fines')
      .populate('tolls')
      .sort({ plate: 1 })
    res.json(vehicles)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fleet' })
  }
})

router.get('/:plate', async (req: Request, res: Response) => {
  try {
    const vehicle = await Vehicle.findOne({
      plate: req.params.plate.toUpperCase(),
      ownerId: req.ownerEmail
    })
      .populate('currentRenter', 'name phone email licenceNumber')
      .populate('fines')
      .populate('tolls')
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })
    res.json(vehicle)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vehicle' })
  }
})

router.post('/', async (req: Request, res: Response) => {
  try {
    const plate = req.body.plate?.toUpperCase()
    if (!plate) return res.status(400).json({ error: 'Plate is required' })

    // Check if plate already exists — if so, just update rego expiry
    const existing = await Vehicle.findOne({ plate, ownerId: req.ownerEmail })
    if (existing) {
      const updated = await Vehicle.findOneAndUpdate(
        { plate, ownerId: req.ownerEmail },
        { $set: {
          regoExpiry: req.body.regoExpiry,
          ...(req.body.model && { model: req.body.model }),
          ...(req.body.year && { year: req.body.year }),
        }},
        { new: true }
      )
      return res.status(200).json({ ...updated?.toObject(), _updated: true })
    }

    const vehicle = new Vehicle({ ...req.body, plate, ownerId: req.ownerEmail })
    await vehicle.save()
    res.status(201).json(vehicle)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

router.put('/:plate', async (req: Request, res: Response) => {
  try {
    const vehicle = await Vehicle.findOneAndUpdate(
      { plate: req.params.plate.toUpperCase(), ownerId: req.ownerEmail },
      { $set: req.body },
      { new: true, runValidators: true }
    )
      .populate('currentRenter', 'name phone email')
      .populate('fines')
      .populate('tolls')

    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })

    if (req.body.regoExpiry) {
      const expiry = new Date(req.body.regoExpiry)
      const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000)
      if (daysLeft <= 30 && daysLeft > 0) {
        await Notification.create({
          ownerId: req.ownerEmail,
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

router.delete('/:plate', async (req: Request, res: Response) => {
  try {
    const vehicle = await Vehicle.findOneAndDelete({
      plate: req.params.plate.toUpperCase(),
      ownerId: req.ownerEmail
    })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })
    res.json({ message: 'Vehicle deleted', plate: vehicle.plate })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vehicle' })
  }
})

export default router