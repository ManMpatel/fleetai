import { Router, Request, Response } from 'express'
import Vehicle from '../models/Vehicle'
import Notification from '../models/Notification'
import { scopedPopulate } from '../models/plugins/tenantScope'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  try {
    const vehicles = await Vehicle.find({ orgId: req.orgId })
      .populate(scopedPopulate('currentRenter', 'name phone email'))
      .populate(scopedPopulate('fines'))
      .populate(scopedPopulate('tolls'))
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
      orgId: req.orgId
    })
      .populate(scopedPopulate('currentRenter', 'name phone email licenceNumber'))
      .populate(scopedPopulate('fines'))
      .populate(scopedPopulate('tolls'))
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
    const existing = await Vehicle.findOne({ plate, orgId: req.orgId })
    if (existing) {
      const updated = await Vehicle.findOneAndUpdate(
        { plate, orgId: req.orgId },
        { $set: {
          regoExpiry: req.body.regoExpiry,
          ...(req.body.model && { model: req.body.model }),
          ...(req.body.year && { year: req.body.year }),
        }},
        { new: true }
      )
      return res.status(200).json({ ...updated?.toObject(), _updated: true })
    }

    const vehicle = new Vehicle({ ...req.body, plate, orgId: req.orgId })
    await vehicle.save()
    res.status(201).json(vehicle)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

router.put('/:plate', async (req: Request, res: Response) => {
  try {
    const vehicle = await Vehicle.findOneAndUpdate(
      { plate: req.params.plate.toUpperCase(), orgId: req.orgId },
      { $set: req.body },
      { new: true, runValidators: true }
    )
      .populate(scopedPopulate('currentRenter', 'name phone email'))
      .populate(scopedPopulate('fines'))
      .populate(scopedPopulate('tolls'))

    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })

    if (req.body.regoExpiry) {
      const expiry = new Date(req.body.regoExpiry)
      const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000)
      if (daysLeft <= 30 && daysLeft > 0) {
        await Notification.create({
          orgId: req.orgId,
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
      orgId: req.orgId
    })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })
    res.json({ message: 'Vehicle deleted', plate: vehicle.plate })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vehicle' })
  }
})

// POST /api/fleet/:plate/assign
router.post('/:plate/assign', async (req: Request, res: Response) => {
  try {
    const plate = req.params.plate.toUpperCase()
    const { renterId } = req.body
    if (!renterId) return res.status(400).json({ error: 'renterId is required' })

    const vehicle = await Vehicle.findOne({ plate, orgId: req.orgId })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })

    const Renter = (await import('../models/Renter')).default
    const renter = await Renter.findOne({ _id: renterId, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const now = new Date()

    // If vehicle already assigned to someone else — close their history
    if (vehicle.currentRenter && vehicle.currentRenter.toString() !== renterId) {
      const oldRenter = await Renter.findOne({ _id: vehicle.currentRenter, orgId: req.orgId })
      if (oldRenter) {
        const h = (oldRenter.rentalHistory as any[]).find(
          e => e.vehicle?.toString() === (vehicle._id as any).toString() && !e.endDate
        )
        if (h) h.endDate = now
        ;(oldRenter as any).currentVehicle = null
        await oldRenter.save()
      }
    }

    // If renter already has a different vehicle — close it
    if ((renter as any).currentVehicle &&
        (renter as any).currentVehicle.toString() !== (vehicle._id as any).toString()) {
      const oldVehicle = await Vehicle.findOne({ _id: (renter as any).currentVehicle, orgId: req.orgId })
      if (oldVehicle) {
        const h = (renter.rentalHistory as any[]).find(
          e => e.vehicle?.toString() === (oldVehicle._id as any).toString() && !e.endDate
        )
        if (h) h.endDate = now
        ;(oldVehicle as any).currentRenter = null
        ;(oldVehicle as any).status = 'available'
        ;(oldVehicle as any).rentStartDate = null
        await oldVehicle.save()
      }
    }

    // Do the assignment
    ;(vehicle as any).currentRenter = renter._id
    ;(vehicle as any).status = 'rented'
    ;(vehicle as any).rentStartDate = now
    await vehicle.save()

    ;(renter as any).currentVehicle = vehicle._id
    ;(renter as any).rentStartDate = now
    ;(renter.rentalHistory as any[]).push({ vehicle: vehicle._id, plate: vehicle.plate, startDate: now })
    await renter.save()

    res.json({ success: true, plate: vehicle.plate, renterName: renter.name })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/fleet/:plate/unassign
router.post('/:plate/unassign', async (req: Request, res: Response) => {
  try {
    const plate = req.params.plate.toUpperCase()
    const vehicle = await Vehicle.findOne({ plate, orgId: req.orgId })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })

    if (vehicle.currentRenter) {
      const Renter = (await import('../models/Renter')).default
      const renter = await Renter.findOne({ _id: vehicle.currentRenter, orgId: req.orgId })
      if (renter) {
        const now = new Date()
        const h = (renter.rentalHistory as any[]).find(
          e => e.vehicle?.toString() === (vehicle._id as any).toString() && !e.endDate
        )
        if (h) h.endDate = now
        ;(renter as any).currentVehicle = null
        ;(renter as any).rentStartDate = null
        await renter.save()
      }
    }

    ;(vehicle as any).currentRenter = null
    ;(vehicle as any).status = 'available'
    ;(vehicle as any).rentStartDate = null
    await vehicle.save()

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router