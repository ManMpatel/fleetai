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

// ── POST /api/renters — create renter (public — onboard form) ─────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = { ...req.body }

    // Whitelist allowed fields — strip anything unexpected
    const allowed = ['name', 'phone', 'email', 'dateOfBirth', 'licenceNumber', 'vehicleType',
      'address', 'bankName', 'accountHolderName', 'bsbNumber', 'accountNumber',
      'emergencyContactName', 'emergencyContactPhone', 'licencePhotoUrl', 'selfieUrl',
      'passportPhotoUrl', 'passportNumber', 'ownerId', 'status']
    Object.keys(body).forEach(k => { if (!allowed.includes(k)) delete body[k] })

    // Encrypt bank details
    if (body.bsbNumber) body.bsbNumber = encrypt(body.bsbNumber)
    if (body.accountNumber) body.accountNumber = encrypt(body.accountNumber)
    if (body.accountHolderName) body.accountHolderName = encrypt(body.accountHolderName)

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
      const dob = new Date(renter.dateOfBirth)
      const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000))
      checks.push(age >= 18
        ? { label: 'Age check', status: 'pass', detail: `${age} years old — over 18` }
        : { label: 'Age check', status: 'fail', detail: `${age} years old — under 18` })
    } else {
      checks.push({ label: 'Age check', status: 'warn', detail: 'Date of birth not provided' })
    }

    // Licence number unique
    if (renter.licenceNumber) {
      const dupLicence = await Renter.findOne({
        licenceNumber: renter.licenceNumber,
        _id: { $ne: renter._id },
        ownerId: req.ownerEmail
      })
      checks.push(dupLicence
        ? { label: 'Licence number', status: 'fail', detail: `Already used by another renter` }
        : { label: 'Licence number', status: 'pass', detail: `${renter.licenceNumber} — unique` })
    } else {
      checks.push({ label: 'Licence number', status: 'warn', detail: 'Not provided' })
    }

    // Licence photo uploaded
    checks.push(renter.licencePhotoUrl
      ? { label: 'Licence photo', status: 'pass', detail: 'Uploaded' }
      : { label: 'Licence photo', status: 'fail', detail: 'Not uploaded' })

    // Selfie uploaded
    checks.push((renter as any).selfieUrl
      ? { label: 'Selfie photo', status: 'pass', detail: 'Uploaded' }
      : { label: 'Selfie photo', status: 'fail', detail: 'Not uploaded' })

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

    // Plate in fleet
    if ((renter as any).currentVehicle || renter.vehicleType) {
      const Vehicle = (await import('../models/Vehicle')).default
      const plate = renter.licenceNumber // placeholder — plate comes from form
      // Check if any unassigned vehicle exists for this owner
      const available = await Vehicle.findOne({ ownerId: req.ownerEmail, status: 'available' })
      checks.push(available
        ? { label: 'Fleet vehicles', status: 'pass', detail: 'Available vehicles exist for assignment' }
        : { label: 'Fleet vehicles', status: 'warn', detail: 'No available vehicles — assign manually' })
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

// POST /api/renters/:phone/ai-verify — Gemini photo verification
router.post('/:phone/ai-verify', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, ownerId: req.ownerEmail })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.licencePhotoUrl) return res.status(400).json({ error: 'No licence photo uploaded' })

    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const fetchBase64 = async (url: string) => {
      const r = await axios.get(url, { responseType: 'arraybuffer' })
      return {
        data: Buffer.from(r.data).toString('base64'),
        mimeType: (r.headers['content-type'] as string) || 'image/jpeg',
      }
    }

    const licImg = await fetchBase64(renter.licencePhotoUrl)
    const passportUrl = (renter as any).passportPhotoUrl
    const passImg = passportUrl ? await fetchBase64(passportUrl) : null

    const parts: any[] = [{ inlineData: licImg }]
    if (passImg) parts.push({ inlineData: passImg })

    const address = [renter.address?.street, renter.address?.city, renter.address?.state, renter.address?.postcode].filter(Boolean).join(', ') || 'not provided'

    parts.push({ text: `You are verifying identity documents for an Australian scooter rental company.

Renter submitted details:
- Full name: ${renter.name}
- Date of birth: ${renter.dateOfBirth || 'not provided'}
- Address: ${address}
- Licence number: ${renter.licenceNumber || 'not provided'}
- Passport number: ${(renter as any).passportNumber || 'not provided'}

Image 1 is the driver's licence.${passImg ? ' Image 2 is the passport.' : ' No passport was uploaded.'}

Verify each field against the documents:
1. name: Does the name on the LICENCE match "${renter.name}"?
2. dob: Does the DOB on the LICENCE match "${renter.dateOfBirth}"?
3. address: Is the submitted address visible and matching on the LICENCE? (Many Australian licences do NOT show address — if not visible, use warn with detail "Not shown on licence")
4. licenceNumber: Does the licence number on LICENCE match "${renter.licenceNumber}"?
5. passportNumber: ${passImg ? `Does the passport number on the PASSPORT match "${(renter as any).passportNumber}"?` : 'No passport uploaded — respond with warn and detail "No passport uploaded"'}

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