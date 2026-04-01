import { Router, Request, Response } from 'express'
import Renter from '../models/Renter'
import Vehicle from '../models/Vehicle'
import Fine from '../models/Fine'
import Notification from '../models/Notification'
import { encrypt, decrypt } from '../services/encryption'
import { requireOwner } from '../middleware/ownerAuth'
import axios from 'axios'
import {
  createPayWayCustomer,
  setupWeeklyDebit,
  pauseDebit,
  resumeDebit,
  getPaymentHistory,
} from '../services/payway'

const router = Router()

// Public route — no auth needed (renter fills this in)
router.post('/send-onboarding', async (req: Request, res: Response) => {
  try {
    const { phone, ownerEmail } = req.body as { phone: string; ownerEmail?: string }
    if (!phone) return res.status(400).json({ error: 'phone is required' })

    const waToken = process.env.WHATSAPP_TOKEN
    const phoneId = process.env.WHATSAPP_PHONE_ID

    if (!waToken || !phoneId) {
      return res.status(503).json({ success: false, error: 'WhatsApp not configured' })
    }

    const cleanPhone = phone.replace(/\s+/g, '')
    const formattedPhone = cleanPhone.replace(/^0/, '61')

    const appUrl = process.env.APP_URL || 'https://fleetai-tau.vercel.app'
    const ownerParam = ownerEmail ? `?owner=${encodeURIComponent(ownerEmail)}` : ''
    const link = `${appUrl}/onboard/${encodeURIComponent(cleanPhone)}${ownerParam}`

    await axios.post(
      `https://graph.facebook.com/v22.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'text',
        text: { body: `Hi! 👋 Please fill in your rental details using this link:\n\n${link}\n\nThis takes about 2 minutes. You'll need your licence and bank details ready.` }
      },
      {
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json'
        }
      }
    )

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// All routes below require approved owner
router.use(requireOwner)

// GET /api/renters
router.get('/', async (req: Request, res: Response) => {
  try {
    const renters = await Renter.find({ ownerId: req.ownerEmail })
      .populate('currentVehicle', 'plate model type')
      .sort({ name: 1 })

    const decrypted = renters.map(r => {
      const obj = r.toObject() as any
      if (obj.bsbNumber)        obj.bsbNumber        = decrypt(obj.bsbNumber)
      if (obj.accountNumber)    obj.accountNumber    = decrypt(obj.accountNumber)
      if (obj.accountHolderName) obj.accountHolderName = decrypt(obj.accountHolderName)
      return obj
    })

    res.json(decrypted)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch renters' })
  }
})

// GET /api/renters/:phone
router.get('/:phone', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
      .populate('currentVehicle', 'plate model type status')
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const obj = renter.toObject() as any
    if (obj.bsbNumber)        obj.bsbNumber        = decrypt(obj.bsbNumber)
    if (obj.accountNumber)    obj.accountNumber    = decrypt(obj.accountNumber)
    if (obj.accountHolderName) obj.accountHolderName = decrypt(obj.accountHolderName)

    res.json(obj)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch renter' })
  }
})

// POST /api/renters
router.post('/', async (req: Request, res: Response) => {
  try {
    const renter = new Renter({ ...req.body, ownerId: req.ownerEmail })
    await renter.save()
    res.status(201).json(renter)
  } catch (err: any) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Phone number already registered' })
    }
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/renters/:phone
router.put('/:phone', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const body  = { ...req.body }

    if (body.bsbNumber)        body.bsbNumber        = encrypt(body.bsbNumber)
    if (body.accountNumber)    body.accountNumber    = encrypt(body.accountNumber)
    if (body.accountHolderName) body.accountHolderName = encrypt(body.accountHolderName)

    const renter = await Renter.findOneAndUpdate(
      { phone, ownerId: req.ownerEmail },
      { $set: body },
      { new: true, runValidators: true }
    ).populate('currentVehicle', 'plate model type status')
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const obj = renter.toObject() as any
    if (obj.bsbNumber)        obj.bsbNumber        = decrypt(obj.bsbNumber)
    if (obj.accountNumber)    obj.accountNumber    = decrypt(obj.accountNumber)
    if (obj.accountHolderName) obj.accountHolderName = decrypt(obj.accountHolderName)

    res.json(obj)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// GET /api/renters/:phone/history
router.get('/:phone/history', async (req: Request, res: Response) => {
  try {
    const phone  = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const historyWithFines = await Promise.all(
      renter.rentalHistory.map(async (record) => {
        const fines = record.endDate
          ? await Fine.find({ vehicle: record.vehicle, date: { $gte: record.startDate, $lte: record.endDate } })
          : await Fine.find({ vehicle: record.vehicle, date: { $gte: record.startDate } })
        return { ...record, fines }
      })
    )

    res.json(historyWithFines)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rental history' })
  }
})

// POST /api/renters/:phone/activate
router.post('/:phone/activate', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const { weeklyAmount, intervalDays = 7 } = req.body as { weeklyAmount: number; intervalDays?: number }

    if (!weeklyAmount || weeklyAmount <= 0) {
      return res.status(400).json({ error: 'weeklyAmount is required' })
    }

    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const created = await createPayWayCustomer({
      phone: renter.phone, name: renter.name, email: renter.email,
      bsbNumber: renter.bsbNumber, accountNumber: renter.accountNumber,
      accountHolderName: renter.accountHolderName,
    })

    if (!created.success) return res.status(500).json({ error: 'Failed to create PayWay customer' })

    const startDate = new Date()
    startDate.setDate(startDate.getDate() + intervalDays)
    await setupWeeklyDebit(created.customerId!, weeklyAmount, startDate)

    const nextDebit = new Date()
    nextDebit.setDate(nextDebit.getDate() + intervalDays)

    renter.payway = { customerId: created.customerId, status: 'active', weeklyAmount, startDate: new Date(), nextDebitDate: nextDebit }
    await renter.save()

    await Notification.create({
      ownerId: req.ownerEmail,
      type: 'info',
      title: `Auto-debit activated — ${renter.name}`,
      description: `$${weeklyAmount} every ${intervalDays} day${intervalDays !== 1 ? 's' : ''} for ${renter.name}`,
      actionRequired: false,
    })

    res.json({ success: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/:phone/pause
router.post('/:phone/pause', async (req: Request, res: Response) => {
  try {
    const phone  = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })

    await pauseDebit(renter.payway.customerId, renter.payway.weeklyAmount || 10)
    renter.payway.status = 'paused'
    await renter.save()

    await Notification.create({
      ownerId: req.ownerEmail,
      type: 'info',
      title: `Auto-debit paused — ${renter.name}`,
      description: `Weekly debit paused for ${renter.name} (${phone})`,
      actionRequired: false,
    })

    res.json({ success: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/:phone/resume
router.post('/:phone/resume', async (req: Request, res: Response) => {
  try {
    const phone  = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })

    await resumeDebit(renter.payway.customerId, renter.payway.weeklyAmount || 0)
    renter.payway.status = 'active'
    await renter.save()

    res.json({ success: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/renters/:phone/payments
router.get('/:phone/payments', async (req: Request, res: Response) => {
  try {
    const phone  = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.json({ payments: [] })

    const result = await getPaymentHistory(renter.payway.customerId)
    res.json({ payments: result.payments || [] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/:phone/approve
router.post('/:phone/approve', async (req: Request, res: Response) => {
  try {
    const phone  = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOneAndUpdate(
      { phone, ownerId: req.ownerEmail },
      { $set: { status: 'active' } },
      { new: true }
    )
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    await Notification.create({
      ownerId: req.ownerEmail,
      type: 'info',
      title: `New renter approved — ${renter.name}`,
      description: `${renter.name} (${phone}) has been approved and activated.`,
      actionRequired: false,
    })

    res.json({ success: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/renters/:phone/reject
router.delete('/:phone/reject', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    await Renter.findOneAndDelete({ phone, ownerId: req.ownerEmail })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/find-by-date
router.post('/find-by-date', async (req: Request, res: Response) => {
  try {
    const { plate, date } = req.body as { plate: string; date: string }
    if (!plate || !date) return res.status(400).json({ error: 'plate and date are required' })

    const fineDate = new Date(date)
    const vehicle  = await Vehicle.findOne({ plate: plate.toUpperCase() })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })

    const renter = await Renter.findOne({
      ownerId: req.ownerEmail,
      rentalHistory: {
        $elemMatch: {
          vehicle: vehicle._id,
          startDate: { $lte: fineDate },
          $or: [{ endDate: { $gte: fineDate } }, { endDate: null }, { endDate: { $exists: false } }],
        },
      },
    })

    if (!renter) {
      const currentRenter = await Renter.findOne({
        ownerId: req.ownerEmail,
        currentVehicle: vehicle._id,
        rentStartDate: { $lte: fineDate },
      })
      if (currentRenter) return res.json({ found: true, renter: currentRenter })
      return res.json({ found: false, message: 'No renter found for this date' })
    }

    res.json({ found: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router