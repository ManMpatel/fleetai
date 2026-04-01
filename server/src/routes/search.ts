import { Router, Request, Response } from 'express'
import Renter from '../models/Renter'
import Vehicle from '../models/Vehicle'
import { requireOwner } from '../middleware/ownerAuth'

const router = Router()
router.use(requireOwner)

// GET /api/search?q=plate|name|phone
router.get('/', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim()
    const ownerId = req.ownerEmail
    if (!q) return res.json({ type: null, results: [] })

    const isPlate = /^[a-zA-Z0-9]{2,8}$/.test(q) && !/\s/.test(q)

    if (isPlate) {
      // ── Search by plate ──────────────────────────────
      const plate = q.toUpperCase()
      const vehicle = await Vehicle.findOne({ plate, ownerId })
        .populate('currentRenter', 'name phone email status')
        .populate('fines')
        .populate('tolls')

      if (!vehicle) return res.json({ type: 'plate', results: [] })

      // All renters who have this plate in their rentalHistory
      const previousRenters = await Renter.find({
        ownerId,
        'rentalHistory.plate': plate,
      }).select('name phone email rentalHistory status')

      const history = previousRenters.map(r => ({
        renter: { _id: r._id, name: r.name, phone: r.phone, email: r.email, status: r.status },
        rentals: r.rentalHistory.filter(h => h.plate === plate)
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
      }))

      return res.json({
        type: 'plate',
        vehicle: {
          ...( vehicle as any).toObject(),
          currentRenter: vehicle.currentRenter,
        },
        history,
      })
    } else {
      // ── Search by name or phone ───────────────────────
      const renters = await Renter.find({
        ownerId,
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { phone: { $regex: q, $options: 'i' } },
        ]
      }).populate('currentVehicle', 'plate model type status')

      if (renters.length === 0) return res.json({ type: 'renter', results: [] })

      const results = renters.map(r => ({
        renter: r.toObject(),
        rentals: (r.rentalHistory || []).sort(
          (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
        )
      }))

      return res.json({ type: 'renter', results })
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router