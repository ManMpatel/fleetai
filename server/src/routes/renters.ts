import { Router, Request, Response } from 'express'
import Renter from '../models/Renter'
import Vehicle from '../models/Vehicle'
import Fine from '../models/Fine'
import Notification from '../models/Notification'
import { encrypt, decrypt, hash } from '../services/encryption'
import { requireOwner } from '../middleware/ownerAuth'
import axios from 'axios'
import {
  createPayWayCustomer,
  setupWeeklyDebit,
  pauseDebit,
  resumeDebit,
  getPaymentHistory,
  voidTransaction,
  refundTransaction,
  pushNextPayment,
  retryFailedPayment,
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
      if (obj.licenceNumber)    obj.licenceNumber    = decrypt(obj.licenceNumber)
      if (obj.passportNumber)   obj.passportNumber   = decrypt(obj.passportNumber)
      if (obj.dateOfBirth)      obj.dateOfBirth      = decrypt(obj.dateOfBirth)
      if (obj.bankName)         obj.bankName         = decrypt(obj.bankName)
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

// ── POST /api/renters — create renter (public — onboard form) ─────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = { ...req.body }

    // Whitelist allowed fields — strip anything unexpected
    const allowed = ['name', 'phone', 'email', 'dateOfBirth', 'licenceNumber', 'passportNumber',
      'vehicleType', 'address', 'bankName', 'accountHolderName', 'bsbNumber', 'accountNumber',
      'emergencyContactName', 'emergencyContactPhone', 'licencePhotoUrl', 'selfieUrl',
      'licencePhotoBase64', 'selfieBase64', 'passportPhotoBase64', 'ownerId', 'status']
    Object.keys(body).forEach(k => { if (!allowed.includes(k)) delete body[k] })

    // Encrypt sensitive fields
    if (body.licenceNumber) { body.licenceNumberHash = hash(body.licenceNumber); body.licenceNumber = encrypt(body.licenceNumber) }
    if (body.passportNumber) { body.passportNumberHash = hash(body.passportNumber); body.passportNumber = encrypt(body.passportNumber) }
    if (body.dateOfBirth) body.dateOfBirth = encrypt(body.dateOfBirth)
    if (body.bankName) body.bankName = encrypt(body.bankName)
    if (body.bsbNumber) body.bsbNumber = encrypt(body.bsbNumber)
    if (body.accountNumber) body.accountNumber = encrypt(body.accountNumber)
    if (body.accountHolderName) body.accountHolderName = encrypt(body.accountHolderName)

    const year = new Date().getFullYear()
    const rand = String(Math.floor(10000 + Math.random() * 90000))
    body.docRef = `FLT-${year}-${rand}`

    const renter = new Renter(body)
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

    if (body.licenceNumber) { body.licenceNumberHash = hash(body.licenceNumber); body.licenceNumber = encrypt(body.licenceNumber) }
    if (body.passportNumber) { body.passportNumberHash = hash(body.passportNumber); body.passportNumber = encrypt(body.passportNumber) }
    if (body.dateOfBirth) body.dateOfBirth = encrypt(body.dateOfBirth)
    if (body.bankName) body.bankName = encrypt(body.bankName)
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
      bsbNumber: renter.bsbNumber ? decrypt(renter.bsbNumber) : undefined,
      accountNumber: renter.accountNumber ? decrypt(renter.accountNumber) : undefined,
      accountHolderName: renter.accountHolderName ? decrypt(renter.accountHolderName) : undefined,
    })

    if (!created.success) return res.status(500).json({ error: 'Failed to create PayWay customer' })

    const startDate = new Date()
    startDate.setDate(startDate.getDate() + intervalDays)
    await setupWeeklyDebit(created.customerId!, weeklyAmount, startDate)

    const nextDebit = new Date()
    nextDebit.setDate(nextDebit.getDate() + intervalDays)

    renter.payway = { customerId: created.customerId, accountToken: (created as any).accountToken || undefined, status: 'active', weeklyAmount, startDate: new Date(), nextDebitDate: nextDebit }
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
// POST /api/renters/:phone/link-payway
router.post('/:phone/link-payway', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const { paywayCustomerId, weeklyAmount } = req.body as { paywayCustomerId: string; weeklyAmount: number }

    if (!paywayCustomerId || !weeklyAmount) {
      return res.status(400).json({ error: 'paywayCustomerId and weeklyAmount are required' })
    }

    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const nextDebit = new Date()
    nextDebit.setDate(nextDebit.getDate() + 7)

    renter.payway = {
      customerId: paywayCustomerId.trim(),
      status: 'active',
      weeklyAmount,
      startDate: new Date(),
      nextDebitDate: nextDebit,
    }
    await renter.save()

    await Notification.create({
      ownerId: req.ownerEmail,
      type: 'info',
      title: `PayWay linked — ${renter.name}`,
      description: `Existing PayWay customer ${paywayCustomerId} linked to ${renter.name}`,
      actionRequired: false,
    })

    res.json({ success: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/:phone/charge-extra
router.post('/:phone/charge-extra', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const { extraAmount, note } = req.body as { extraAmount: number; note: string }

    if (!extraAmount || extraAmount <= 0) {
      return res.status(400).json({ error: 'extraAmount is required' })
    }

    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })
    if (renter.payway.status !== 'active') return res.status(400).json({ error: 'Auto-debit is not active' })

    const weeklyAmount = renter.payway.weeklyAmount || 0
    const existingExtra = renter.payway.pendingExtraAmount || 0
    const totalExtra = existingExtra + extraAmount
    const nextAmount = weeklyAmount + totalExtra

    const secretKey = process.env.PAYWAY_SECRET_KEY || ''
    const customerId = renter.payway.customerId
    const nextDate = new Date(Date.now() + 7 * 86400000)
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const dd = String(nextDate.getDate()).padStart(2, '0')
    const mon = MONTHS[nextDate.getMonth()]
    const yyyy = nextDate.getFullYear()

    console.log(`📤 PayWay charge-extra — customerId: ${customerId}, extra: $${extraAmount}, total next: $${nextAmount}`)

    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: `${dd} ${mon} ${yyyy}`,
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: nextAmount.toFixed(2),
    })

    const pwRes = await axios.put(
      `https://api.payway.com.au/rest/v1/customers/${customerId}/schedule`,
      params.toString(),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      }
    )

    console.log(`✅ PayWay charge-extra set — nextPaymentAmount: $${nextAmount}, response: ${JSON.stringify(pwRes.data)}`)

    renter.payway!.pendingExtraAmount = totalExtra
    if (!renter.payway!.extraCharges) renter.payway!.extraCharges = []
    renter.payway!.extraCharges.push({ amount: extraAmount, note: note || '', date: new Date() })
    await renter.save()

    await Notification.create({
      ownerId: req.ownerEmail,
      type: 'info',
      title: `Extra charge scheduled — ${renter.name}`,
      description: `$${extraAmount} extra added to next debit. Total next charge: $${nextAmount}. Note: ${note || 'No note'}`,
      actionRequired: false,
    })

    res.json({ success: true, nextAmount, regularAmount: weeklyAmount, totalExtra })
  } catch (err: any) {
    console.error('❌ charge-extra error:', err.response?.data || err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/:phone/void-transaction
router.post('/:phone/void-transaction', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const { transactionId } = req.body as { transactionId: string }
    if (!transactionId) return res.status(400).json({ error: 'transactionId is required' })

    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const result = await voidTransaction(transactionId)
    if (!result.success) return res.status(400).json({ error: result.error || 'Void failed' })

    await Notification.create({
      ownerId: req.ownerEmail,
      type: 'info',
      title: `Transaction voided — ${renter.name}`,
      description: `Transaction ${transactionId} voided successfully.`,
      actionRequired: false,
    })

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/:phone/refund-transaction
router.post('/:phone/refund-transaction', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const { transactionId, amount } = req.body as { transactionId: string; amount: number }
    if (!transactionId || !amount) return res.status(400).json({ error: 'transactionId and amount are required' })

    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const result = await refundTransaction(transactionId, amount)
    if (!result.success) return res.status(400).json({ error: result.error || 'Refund failed' })

    await Notification.create({
      ownerId: req.ownerEmail,
      type: 'info',
      title: `Refund processed — ${renter.name}`,
      description: `$${amount} refunded for transaction ${transactionId}.`,
      actionRequired: false,
    })

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/:phone/retry-payment
router.post('/:phone/retry-payment', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const DISHONOUR_FEE = 10

    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })

    const weeklyAmount = renter.payway.weeklyAmount || 0
    const retryAmount = weeklyAmount + DISHONOUR_FEE

    const result = await retryFailedPayment(renter.payway.customerId, retryAmount)
    if (!result.success) return res.status(400).json({ error: result.error || 'Retry failed' })

    await Notification.create({
      ownerId: req.ownerEmail,
      type: 'info',
      title: `Payment retried — ${renter.name}`,
      description: `$${retryAmount} charged (includes $${DISHONOUR_FEE} dishonour fee). Original: $${weeklyAmount}.`,
      actionRequired: false,
    })

    res.json({ success: true, retryAmount, dishonourFee: DISHONOUR_FEE })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/:phone/push-payment
router.post('/:phone/push-payment', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const { weeks } = req.body as { weeks: number }
    if (!weeks || ![1, 2].includes(weeks)) return res.status(400).json({ error: 'weeks must be 1 or 2' })

    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })
    if (renter.payway.status !== 'active') return res.status(400).json({ error: 'Debit is not active' })

    const result = await pushNextPayment(renter.payway.customerId, renter.payway.weeklyAmount || 0, weeks)
    if (!result.success) return res.status(400).json({ error: result.error || 'Push failed' })

    const newDate = new Date()
    newDate.setDate(newDate.getDate() + weeks * 7)
    renter.payway.nextDebitDate = newDate
    await renter.save()

    await Notification.create({
      ownerId: req.ownerEmail,
      type: 'info',
      title: `Payment pushed ${weeks} week${weeks > 1 ? 's' : ''} — ${renter.name}`,
      description: `Next debit moved to ${result.newDate}`,
      actionRequired: false,
    })

    res.json({ success: true, newDate: result.newDate })
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

// GET /api/renters/:phone/verify
router.get('/:phone/verify', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const checks: { label: string; status: 'pass' | 'fail' | 'warn'; detail: string }[] = []

    // Phone format
    const phoneClean = phone.replace(/\s/g, '')
    checks.push(phoneClean.match(/^04\d{8}$/)
      ? { label: 'Phone number', status: 'pass', detail: 'Valid Australian mobile' }
      : { label: 'Phone number', status: 'warn', detail: 'Not a standard AU mobile format' })

    // Email
    if (renter.email) {
      checks.push(renter.email.includes('@')
        ? { label: 'Email', status: 'pass', detail: renter.email }
        : { label: 'Email', status: 'fail', detail: 'Invalid email format' })
    } else {
      checks.push({ label: 'Email', status: 'warn', detail: 'Not provided' })
    }

    // Age 18+
    if (renter.dateOfBirth) {
      const dob = new Date(decrypt(renter.dateOfBirth))
      const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000))
      checks.push(age >= 18
        ? { label: 'Age check', status: 'pass', detail: `${age} years old — over 18` }
        : { label: 'Age check', status: 'fail', detail: `${age} years old — under 18` })
    } else {
      checks.push({ label: 'Age check', status: 'warn', detail: 'Date of birth not provided' })
    }

    // Licence number unique
    if (renter.licenceNumber) {
      const decryptedLicence = decrypt(renter.licenceNumber)
      const dupLicence = await Renter.findOne({
        licenceNumberHash: hash(decryptedLicence),
        _id: { $ne: renter._id },
        ownerId: req.ownerEmail
      })
      checks.push(dupLicence
        ? { label: 'Licence number', status: 'fail', detail: `Already used by ${dupLicence.name}` }
        : { label: 'Licence number', status: 'pass', detail: `${decryptedLicence} — unique` })
    } else {
      checks.push({ label: 'Licence number', status: 'warn', detail: 'Not provided' })
    }

    // Passport number unique
    if ((renter as any).passportNumber) {
      const decryptedPassport = decrypt((renter as any).passportNumber)
      const dupPassport = await Renter.findOne({
        passportNumberHash: hash(decryptedPassport),
        _id: { $ne: renter._id },
        ownerId: req.ownerEmail
      })
      checks.push(dupPassport
        ? { label: 'Passport number', status: 'fail', detail: `Already used by ${dupPassport.name}` }
        : { label: 'Passport number', status: 'pass', detail: `${decryptedPassport} — unique` })
    } else {
      checks.push({ label: 'Passport number', status: 'warn', detail: 'Not provided' })
    }

    // BSB format
    if (renter.bsbNumber) {
      const bsb = decrypt(renter.bsbNumber)
      const bsbClean = bsb.replace('-', '')
      const AU_BANKS: Record<string, string> = {
        '01': 'ANZ', '09': 'ANZ', '06': 'Commonwealth', '76': 'Commonwealth',
        '08': 'NAB', '03': 'Westpac', '73': 'Westpac', '48': 'Suncorp',
        '63': 'Bendigo', '80': 'Credit Union', '70': 'Credit Union',
        '28': 'Bankwest', '30': 'Macquarie', '18': 'Citibank', '19': 'St George',
        '33': 'BankSA', '55': 'Bank of Melbourne',
      }
      if (bsbClean.match(/^\d{6}$/)) {
        const bank = AU_BANKS[bsbClean.slice(0, 2)]
        checks.push({ label: 'BSB number', status: 'pass', detail: bank ? `Valid — ${bank}` : 'Valid format' })
      } else {
        checks.push({ label: 'BSB number', status: 'warn', detail: 'Must be 6 digits (e.g. 062-000)' })
      }
    } else {
      checks.push({ label: 'BSB number', status: 'warn', detail: 'Not provided' })
    }

    // Account number format
    if (renter.accountNumber) {
      const acc = decrypt(renter.accountNumber)
      checks.push(acc.match(/^\d{6,10}$/)
        ? { label: 'Account number', status: 'pass', detail: 'Valid format' }
        : { label: 'Account number', status: 'warn', detail: 'Unusual format — verify manually' })
    } else {
      checks.push({ label: 'Account number', status: 'warn', detail: 'Not provided' })
    }

    const fails = checks.filter(c => c.status === 'fail').length
    const warns = checks.filter(c => c.status === 'warn').length
    res.json({ checks, fails, warns })
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
      { $set: { status: 'active' }, $unset: { licencePhotoBase64: '', passportPhotoBase64: '' } },
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

// POST /api/renters/:phone/ai-verify — Gemini photo verification
router.post('/:phone/ai-verify', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    const licenceB64 = (renter as any).licencePhotoBase64 || null
    const passportB64 = (renter as any).passportPhotoBase64 || null

    if (!licenceB64) return res.status(400).json({ error: 'No licence photo uploaded' })

    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const licImg = { data: licenceB64, mimeType: 'image/jpeg' }
    const passImg = passportB64 ? { data: passportB64, mimeType: 'image/jpeg' } : null

    const parts: any[] = [{ inlineData: licImg }]
    if (passImg) parts.push({ inlineData: passImg })

    const address = [renter.address?.street, renter.address?.city, renter.address?.state, renter.address?.postcode].filter(Boolean).join(', ') || 'not provided'

    const plainDob = renter.dateOfBirth ? decrypt(renter.dateOfBirth) : 'not provided'
    const plainLicence = renter.licenceNumber ? decrypt(renter.licenceNumber) : 'not provided'
    const plainPassport = (renter as any).passportNumber ? decrypt((renter as any).passportNumber) : 'not provided'

    parts.push({ text: `You are verifying identity documents for an Australian scooter rental company.

Renter submitted details:
- Full name: ${renter.name}
- Date of birth: ${plainDob}
- Address: ${address}
- Licence number: ${plainLicence}
- Passport number: ${plainPassport}

Image 1 is the driver's licence.${passImg ? ' Image 2 is the passport.' : ' No passport was uploaded.'}

Verify each field against the documents:
1. name: Does the name on the LICENCE match "${renter.name}"?
2. dob: Does the DOB on the LICENCE match "${plainDob}"?
3. address: Is the submitted address visible and matching on the LICENCE? (Many Australian licences do NOT show address — if not visible, use warn with detail "Not shown on licence")
4. licenceNumber: Does the licence number on LICENCE match "${plainLicence}"?
5. passportNumber: ${passImg ? `Does the passport number on the PASSPORT match "${plainPassport}"?` : 'No passport uploaded — respond with warn and detail "No passport uploaded"'}

Respond ONLY with this exact JSON (no markdown, no extra text):
{"name":{"status":"pass|fail|warn","detail":"short reason"},"dob":{"status":"pass|fail|warn","detail":"short reason"},"address":{"status":"pass|fail|warn","detail":"short reason"},"licenceNumber":{"status":"pass|fail|warn","detail":"short reason"},"passportNumber":{"status":"pass|fail|warn","detail":"short reason"}}` })

    const result = await model.generateContent(parts)
    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse AI response' })
    const aiResults = JSON.parse(jsonMatch[0])
    res.json({ success: true, results: aiResults })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router