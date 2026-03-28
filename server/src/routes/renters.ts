import { Router, Request, Response } from 'express'
import Renter from '../models/Renter'
import Vehicle from '../models/Vehicle'
import Fine from '../models/Fine'
import Notification from '../models/Notification'
import {
  createPayWayCustomer,
  setupWeeklyDebit,
  pauseDebit,
  resumeDebit,
  getPaymentHistory,
} from '../services/payway'

const router = Router()

// ── GET /api/renters — all renters ─────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  try {
    const renters = await Renter.find()
      .populate('currentVehicle', 'plate model type')
      .sort({ name: 1 })
    res.json(renters)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch renters' })
  }
})

// ── GET /api/renters/:phone — single renter ────────────────
router.get('/:phone', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone })
      .populate('currentVehicle', 'plate model type status')
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    res.json(renter)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch renter' })
  }
})

// ── POST /api/renters — create renter ─────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const renter = new Renter(req.body)
    await renter.save()
    res.status(201).json(renter)
  } catch (err: any) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Phone number already registered' })
    }
    res.status(400).json({ error: err.message })
  }
})

// ── PUT /api/renters/:phone — update renter ───────────────
router.put('/:phone', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOneAndUpdate(
      { phone },
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate('currentVehicle', 'plate model type status')
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    res.json(renter)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// ── GET /api/renters/:phone/history — rental + fine history
router.get('/:phone/history', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    // For each rental period, find fines that occurred during that time
    const historyWithFines = await Promise.all(
    renter.rentalHistory.map(async (record) => {
        const fines = record.endDate
        ? await Fine.find({
            vehicle: record.vehicle,
            date: { $gte: record.startDate, $lte: record.endDate },
            })
        : await Fine.find({
            vehicle: record.vehicle,
            date: { $gte: record.startDate },
            })
        return {
        vehicle: record.vehicle,
        plate: record.plate,
        startDate: record.startDate,
        endDate: record.endDate,
        weeklyRate: record.weeklyRate,
        totalWeeks: record.totalWeeks,
        totalAmount: record.totalAmount,
        fines,
        }
    })
    )

    res.json(historyWithFines)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rental history' })
  }
})

// ── POST /api/renters/:phone/activate — setup PayWay + start debit
router.post('/:phone/activate', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const { weeklyAmount } = req.body as { weeklyAmount: number }

    if (!weeklyAmount || weeklyAmount <= 0) {
      return res.status(400).json({ error: 'weeklyAmount is required' })
    }

    const renter = await Renter.findOne({ phone })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    // Create PayWay customer
    const created = await createPayWayCustomer({
      phone: renter.phone,
      name: renter.name,
      email: renter.email,
    })

    if (!created.success) {
      return res.status(500).json({ error: 'Failed to create PayWay customer' })
    }

    // Setup weekly debit from rental start date
    const startDate = renter.rentStartDate || new Date()
    await setupWeeklyDebit(created.customerId!, weeklyAmount, startDate)

    // Update renter in MongoDB
    const nextDebit = new Date(startDate)
    nextDebit.setDate(nextDebit.getDate() + 7)

    renter.payway = {
      customerId: created.customerId,
      status: 'active',
      weeklyAmount,
      startDate,
      nextDebitDate: nextDebit,
    }
    await renter.save()

    await Notification.create({
      type: 'info',
      title: `Auto-debit activated — ${renter.name}`,
      description: `Weekly debit of $${weeklyAmount} activated for ${renter.name} (${phone})`,
      actionRequired: false,
    })

    res.json({ success: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/renters/:phone/pause — pause auto-debit ─────
router.post('/:phone/pause', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) {
      return res.status(400).json({ error: 'No PayWay customer found' })
    }

    await pauseDebit(renter.payway.customerId)
    renter.payway.status = 'paused'
    await renter.save()

    await Notification.create({
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

// ── POST /api/renters/:phone/resume — resume auto-debit ───
router.post('/:phone/resume', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) {
      return res.status(400).json({ error: 'No PayWay customer found' })
    }

    const amount = renter.payway.weeklyAmount || 0
    await resumeDebit(renter.payway.customerId, amount)
    renter.payway.status = 'active'
    await renter.save()

    res.json({ success: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/renters/:phone/payments — payment history ────
router.get('/:phone/payments', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) {
      return res.json({ payments: [] })
    }

    const result = await getPaymentHistory(renter.payway.customerId)
    res.json({ payments: result.payments || [] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/renters/find-by-date — fine attribution ─────
router.post('/find-by-date', async (req: Request, res: Response) => {
  try {
    const { plate, date } = req.body as { plate: string; date: string }
    if (!plate || !date) {
      return res.status(400).json({ error: 'plate and date are required' })
    }

    const fineDate = new Date(date)
    const vehicle = await Vehicle.findOne({ plate: plate.toUpperCase() })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })

    // Find renter who had this vehicle on this date
    const renter = await Renter.findOne({
      rentalHistory: {
        $elemMatch: {
          vehicle: vehicle._id,
          startDate: { $lte: fineDate },
          $or: [
            { endDate: { $gte: fineDate } },
            { endDate: null },
            { endDate: { $exists: false } },
          ],
        },
      },
    })

    // Also check current renter if no history match
    if (!renter) {
      const currentRenter = await Renter.findOne({
        currentVehicle: vehicle._id,
        rentStartDate: { $lte: fineDate },
      })
      if (currentRenter) {
        return res.json({ found: true, renter: currentRenter })
      }
      return res.json({ found: false, message: 'No renter found for this date' })
    }

    res.json({ found: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/renters/send-onboarding ─────────────────────
router.post('/send-onboarding', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body as { phone: string }
    if (!phone) return res.status(400).json({ error: 'phone is required' })

    const sid = process.env.TWILIO_SID
    const token = process.env.TWILIO_TOKEN
    const from = process.env.TWILIO_WHATSAPP_FROM

    if (!sid || !token || !from) {
      return res.status(503).json({ 
        success: false, 
        error: 'Twilio not configured' 
      })
    }

    const cleanPhone = phone.replace(/\s+/g, '')
    const whatsappTo = cleanPhone.startsWith('whatsapp:') 
      ? cleanPhone 
      : `whatsapp:+61${cleanPhone.replace(/^0/, '')}`

    const appUrl = process.env.APP_URL || 'http://localhost:3000'
    const link = `${appUrl}/onboard/${encodeURIComponent(cleanPhone)}`

    const twilio = require('twilio')(sid, token)
    await twilio.messages.create({
      from,
      to: whatsappTo,
      body: `Hi! 👋 Please fill in your rental details using this link:\n\n${link}\n\nThis takes about 2 minutes. You'll need your licence and bank details ready.`
    })

    res.json({ success: true })
  } catch (err: any) {
    console.error('Send onboarding error:', err.message)
    res.status(500).json({ 
      success: false, 
      error: err.message 
    })
  }
})

export default router
