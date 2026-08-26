import { Router, Request, Response } from 'express'
import axios from 'axios'
import Renter from '../models/Renter'
import Vehicle from '../models/Vehicle'
import Fine from '../models/Fine'
import Notification from '../models/Notification'
import Organization from '../models/Organization'
import Transaction from '../models/Transaction'
import { encrypt, decrypt, hash } from '../services/encryption'
import { requireAuth } from '../middleware/auth'
import { requireTenant } from '../middleware/tenant'
import { sendWhatsAppText } from '../services/whatsapp'
import { scopedPopulate } from '../models/plugins/tenantScope'
import {
  paywayCredsFor,
  createPayWayCustomer,
  setupWeeklyDebit,
  pauseDebit,
  resumeDebit,
  updateBankAccount,
  retryFailedPayment,
  pushNextPayment,
  voidTransaction,
  refundTransaction,
  fetchAllTransactions,
} from '../services/payway'

const router = Router()

const SENSITIVE_FIELDS = [
  'licenceNumber', 'passportNumber', 'dateOfBirth',
  'bankName', 'bsbNumber', 'accountNumber', 'accountHolderName',
] as const

const BANK_FIELDS = ['bsbNumber', 'accountNumber', 'accountHolderName'] as const

// Fields an onboarding renter may submit. orgId/status are deliberately absent — the
// tenant is derived from the share link server-side, never from the request body.
const ONBOARD_FIELDS = [
  'name', 'phone', 'email', 'dateOfBirth', 'licenceNumber', 'passportNumber',
  'vehicleType', 'address', 'bankName', 'accountHolderName', 'bsbNumber', 'accountNumber',
  'emergencyContactName', 'emergencyContactPhone', 'licencePhotoUrl', 'selfieUrl',
  'licencePhotoBase64', 'selfieBase64', 'passportPhotoBase64', 'signatureBase64',
]

function generateDocRef() {
  const year = new Date().getFullYear()
  const rand = String(Math.floor(10000 + Math.random() * 90000))
  return `FLT-${year}-${rand}`
}

function encryptSensitive(body: Record<string, any>) {
  if (body.licenceNumber) {
    body.licenceNumberHash = hash(body.licenceNumber)
    body.licenceNumber = encrypt(body.licenceNumber)
  }
  if (body.passportNumber) {
    body.passportNumberHash = hash(body.passportNumber)
    body.passportNumber = encrypt(body.passportNumber)
  }
  for (const field of ['dateOfBirth', 'bankName', 'bsbNumber', 'accountNumber', 'accountHolderName']) {
    if (body[field]) body[field] = encrypt(body[field])
  }
  return body
}

function decryptRenter(doc: any, fields: readonly string[] = SENSITIVE_FIELDS) {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc
  for (const field of fields) {
    if (obj[field]) obj[field] = decrypt(obj[field])
  }
  return obj
}

// ── Public: renter onboarding ───────────────────────────────
// The tenant comes from the slug in the share link. A forged orgId in the body is
// ignored because orgId is not in the field whitelist.
router.post('/public/onboard', async (req: Request, res: Response) => {
  try {
    const { slug } = req.body as { slug?: string }
    if (!slug) return res.status(400).json({ error: 'Invalid link' })

    const org = await Organization.findOne({ slug, status: 'approved' })
    if (!org) return res.status(404).json({ error: 'Invalid link' })

    const body: Record<string, any> = {}
    for (const key of ONBOARD_FIELDS) {
      if (req.body[key] !== undefined) body[key] = req.body[key]
    }
    if (!body.name || !body.phone) {
      return res.status(400).json({ error: 'Name and phone are required' })
    }

    encryptSensitive(body)
    body.docRef = generateDocRef()

    const renter = new Renter({ ...body, orgId: org._id, status: 'pending' })
    await renter.save()

    await Notification.create({
      orgId: org._id,
      type: 'info',
      title: `New renter application — ${renter.name}`,
      description: `${renter.name} (${renter.phone}) submitted onboarding details for review.`,
      actionRequired: true,
    })

    res.status(201).json({ success: true })
  } catch (err: any) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This phone number is already registered' })
    }
    res.status(400).json({ error: err.message })
  }
})

// ── Everything below requires an approved tenant login ──────
router.use(requireAuth, requireTenant)

// POST /api/renters/send-onboarding
router.post('/send-onboarding', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body as { phone?: string }
    if (!phone) return res.status(400).json({ error: 'phone is required' })

    const org = req.org!
    if (!org.slug) {
      return res.status(400).json({ error: 'Set your share link name before sending onboarding links' })
    }

    const cleanPhone = phone.replace(/\s+/g, '')
    const appUrl = process.env.APP_URL || 'https://fleetai.co.in'
    const link = `${appUrl}/onboard/${encodeURIComponent(org.slug)}`
    const message =
      'Hi! 👋 Please fill in your rental details using this link:\n\n' + link +
      '\n\nThis takes about 2 minutes. Have your licence and bank details ready.'

    await sendWhatsAppText(org, cleanPhone.replace(/^0/, '61'), message)

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/renters
router.get('/', async (req: Request, res: Response) => {
  try {
    const renters = await Renter.find({ orgId: req.orgId })
      .populate(scopedPopulate('currentVehicle', 'plate model type'))
      .populate(scopedPopulate('currentVehicles', 'plate model type'))
      .sort({ name: 1 })

    res.json(renters.map(r => decryptRenter(r)))
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch renters' })
  }
})

// POST /api/renters — owner creates a renter directly from the dashboard
router.post('/', async (req: Request, res: Response) => {
  try {
    const body: Record<string, any> = {}
    for (const key of ONBOARD_FIELDS) {
      if (req.body[key] !== undefined) body[key] = req.body[key]
    }
    if (req.body.status) body.status = req.body.status

    encryptSensitive(body)
    body.docRef = generateDocRef()

    const renter = new Renter({ ...body, orgId: req.orgId })
    await renter.save()
    res.status(201).json(decryptRenter(renter))
  } catch (err: any) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Phone number already registered' })
    }
    res.status(400).json({ error: err.message })
  }
})

// POST /api/renters/find-by-date — which renter held this plate on this date
router.post('/find-by-date', async (req: Request, res: Response) => {
  try {
    const { plate, date } = req.body as { plate: string; date: string }
    if (!plate || !date) return res.status(400).json({ error: 'plate and date are required' })

    const fineDate = new Date(date)
    const vehicle = await Vehicle.findOne({ plate: plate.toUpperCase(), orgId: req.orgId })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })

    const renter = await Renter.findOne({
      orgId: req.orgId,
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
        orgId: req.orgId,
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

// GET /api/renters/:phone
router.get('/:phone', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, orgId: req.orgId })
      .populate(scopedPopulate('currentVehicle', 'plate model type status'))
      .populate(scopedPopulate('currentVehicles', 'plate model type status'))
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    res.json(decryptRenter(renter, BANK_FIELDS))
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch renter' })
  }
})

// PUT /api/renters/:phone
router.put('/:phone', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const body = { ...req.body }
    // Tenancy is never editable through a data update.
    delete body.orgId
    delete body.ownerId

    // Track address changes for the audit trail.
    const existing = await Renter.findOne({ phone, orgId: req.orgId })
    const historyEntries: any[] = []
    if (existing && body.address) {
      const a = existing.address as any
      const fields: [string, string][] = [
        ['Street', 'street'], ['City', 'city'], ['State', 'state'], ['Postcode', 'postcode']
      ]
      for (const [label, key] of fields) {
        if (body.address[key] && body.address[key] !== a?.[key]) {
          historyEntries.push({ field: label, oldValue: a?.[key] || '—', newValue: body.address[key] })
        }
      }
    }

    encryptSensitive(body)

    const renter = await Renter.findOneAndUpdate(
      { phone, orgId: req.orgId },
      {
        $set: body,
        ...(historyEntries.length > 0 ? { $push: { changeHistory: { $each: historyEntries } } } : {}),
      },
      { new: true, runValidators: true }
    )
      .populate(scopedPopulate('currentVehicle', 'plate model type status'))
      .populate(scopedPopulate('currentVehicles', 'plate model type status'))
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    res.json(decryptRenter(renter, BANK_FIELDS))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// GET /api/renters/:phone/history
router.get('/:phone/history', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const historyWithFines = await Promise.all(
      renter.rentalHistory.map(async (record) => {
        const dateFilter = record.endDate
          ? { $gte: record.startDate, $lte: record.endDate }
          : { $gte: record.startDate }
        const fines = await Fine.find({ orgId: req.orgId, vehicle: record.vehicle, date: dateFilter })
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

    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    // Debits must settle into this tenant's own merchant account.
    const creds = paywayCredsFor(req.org!)

    const created = await createPayWayCustomer(creds, {
      orgId: String(req.orgId),
      phone: renter.phone,
      name: renter.name,
      email: renter.email,
      bsbNumber: renter.bsbNumber ? decrypt(renter.bsbNumber) : '',
      accountNumber: renter.accountNumber ? decrypt(renter.accountNumber) : '',
      accountHolderName: renter.accountHolderName ? decrypt(renter.accountHolderName) : renter.name,
    })

    if (!created.success) return res.status(502).json({ error: 'Failed to create PayWay customer' })

    const startDate = new Date()
    startDate.setDate(startDate.getDate() + intervalDays)
    await setupWeeklyDebit(creds, created.customerId!, weeklyAmount, startDate)

    renter.payway = {
      customerId: created.customerId,
      status: 'active',
      weeklyAmount,
      startDate: new Date(),
      nextDebitDate: startDate,
      activity: [{ type: 'success', message: `Auto-debit activated — $${weeklyAmount}/week`, createdAt: new Date() }],
    }
    await renter.save()

    // Backfill transaction history for the payments tab (void/refund needs the real ids).
    try {
      const allTxns = await fetchAllTransactions(creds, created.customerId!)
      for (const t of allTxns) {
        await Transaction.updateOne(
          { transactionId: t.transactionId },
          { $setOnInsert: { ...t, renterId: renter.phone, orgId: req.orgId } },
          { upsert: true }
        )
      }
    } catch (e: any) {
      console.error('⚠️ Failed to fetch transaction history:', e.message)
    }

    await Notification.create({
      orgId: req.orgId,
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

// GET /api/renters/payway-schedule/:customerId — this tenant's own PayWay account only
router.get('/payway-schedule/:customerId', async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params
    const creds = paywayCredsFor(req.org!)
    const authHeader = `Basic ${Buffer.from(`${creds.secretKey}:`).toString('base64')}`
    const response = await axios.get(
      `https://api.payway.com.au/rest/v1/customers/${customerId}/schedule`,
      { headers: { Authorization: authHeader, Accept: 'application/json' } }
    )
    const amount = response.data.regularPrincipalAmount
    const nextPaymentDate = response.data.nextPaymentDate
    if (!amount) return res.status(404).json({ error: 'No schedule found for this customer' })
    res.json({ weeklyAmount: amount, nextPaymentDate })
  } catch (err: any) {
    if (err.response?.status === 404) return res.status(404).json({ error: 'Customer not found in PayWay' })
    res.status(500).json({ error: 'Failed to fetch PayWay schedule' })
  }
})

// POST /api/renters/:phone/link-payway — attach an existing PayWay customer id
router.post('/:phone/link-payway', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const { paywayCustomerId, weeklyAmount, nextPaymentDate } = req.body as { paywayCustomerId: string; weeklyAmount: number; nextPaymentDate?: string }

    if (!paywayCustomerId || !weeklyAmount) {
      return res.status(400).json({ error: 'paywayCustomerId and weeklyAmount are required' })
    }

    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const nextDebit = new Date()
    nextDebit.setDate(nextDebit.getDate() + 7)

    renter.payway = {
      customerId: paywayCustomerId.trim(),
      status: 'active',
      weeklyAmount,
      startDate: new Date(),
      nextDebitDate: nextPaymentDate ? new Date(nextPaymentDate) : nextDebit,
    }
    await renter.save()

    try {
      const creds = paywayCredsFor(req.org!)
      const allTxns = await fetchAllTransactions(creds, paywayCustomerId.trim())
      for (const t of allTxns) {
        await Transaction.updateOne(
          { transactionId: t.transactionId },
          { $setOnInsert: { ...t, renterId: renter.phone, orgId: req.orgId } },
          { upsert: true }
        )
      }
    } catch (e: any) {
      console.error('⚠️ Failed to fetch transaction history:', e.message)
    }

    await Notification.create({
      orgId: req.orgId,
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

    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })
    if (renter.payway.status !== 'active') return res.status(400).json({ error: 'Auto-debit is not active' })

    const creds = paywayCredsFor(req.org!)
    const weeklyAmount = renter.payway.weeklyAmount || 0
    const existingExtra = renter.payway.pendingExtraAmount || 0
    const totalExtra = existingExtra + extraAmount
    const nextAmount = weeklyAmount + totalExtra

    const customerId = renter.payway.customerId
    const nextDate = new Date(Date.now() + 7 * 86400000)
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const dd = String(nextDate.getDate()).padStart(2, '0')
    const mon = MONTHS[nextDate.getMonth()]
    const yyyy = nextDate.getFullYear()

    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: `${dd} ${mon} ${yyyy}`,
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: nextAmount.toFixed(2),
    })

    await axios.put(
      `https://api.payway.com.au/rest/v1/customers/${customerId}/schedule`,
      params.toString(),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${creds.secretKey}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      }
    )

    renter.payway!.pendingExtraAmount = totalExtra
    if (!renter.payway!.extraCharges) renter.payway!.extraCharges = []
    renter.payway!.extraCharges.push({ amount: extraAmount, note: note || '', date: new Date() })
    if (!renter.payway!.activity) renter.payway!.activity = []
    const extraExpiry = new Date(); extraExpiry.setDate(extraExpiry.getDate() + 7)
    renter.payway!.activity!.push({
      type: 'warning',
      message: `$${extraAmount} extra scheduled`,
      detail: `${note || 'No reason given'} — added to next debit`,
      expiresAt: extraExpiry,
      createdAt: new Date(),
    })
    await renter.save()

    await Notification.create({
      orgId: req.orgId,
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

    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const creds = paywayCredsFor(req.org!)
    const result = await voidTransaction(creds, transactionId)
    if (!result.success) return res.status(400).json({ error: result.error || 'Void failed' })

    await Transaction.updateOne({ transactionId: Number(transactionId), orgId: req.orgId }, { isVoidable: false })

    await Notification.create({
      orgId: req.orgId,
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

    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const creds = paywayCredsFor(req.org!)
    const result = await refundTransaction(creds, transactionId, amount)
    if (!result.success) return res.status(400).json({ error: result.error || 'Refund failed' })

    await Transaction.updateOne({ transactionId: Number(transactionId), orgId: req.orgId }, { isRefundable: false })

    await Notification.create({
      orgId: req.orgId,
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

// POST /api/renters/:phone/update-bank
router.post('/:phone/update-bank', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const { bsbNumber, accountNumber, accountHolderName, bankName } = req.body

    if (!bsbNumber || !accountNumber || !accountHolderName) {
      return res.status(400).json({ error: 'bsbNumber, accountNumber and accountHolderName are required' })
    }

    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer — activate debit first' })

    const creds = paywayCredsFor(req.org!)
    const result = await updateBankAccount(
      creds,
      renter.payway.customerId,
      bsbNumber.replace(/[^0-9]/g, ''),
      accountNumber,
      accountHolderName
    )
    if (!result.success) return res.status(400).json({ error: result.error || 'Bank update failed' })

    if (bankName) renter.bankName = encrypt(bankName)
    renter.bsbNumber = encrypt(bsbNumber)
    renter.accountNumber = encrypt(accountNumber)
    renter.accountHolderName = encrypt(accountHolderName)
    await renter.save()

    await Notification.create({
      orgId: req.orgId,
      type: 'info',
      title: `Bank account updated — ${renter.name}`,
      description: `New bank details saved and updated in PayWay. Schedule continues unchanged.`,
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

    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })

    const weeklyAmount = renter.payway.weeklyAmount || 0
    const retryAmount = weeklyAmount + DISHONOUR_FEE

    const creds = paywayCredsFor(req.org!)
    const result = await retryFailedPayment(creds, renter.payway.customerId, retryAmount)
    if (!result.success) return res.status(400).json({ error: result.error || 'Retry failed' })

    await Notification.create({
      orgId: req.orgId,
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

    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })
    if (renter.payway.status !== 'active') return res.status(400).json({ error: 'Debit is not active' })

    const creds = paywayCredsFor(req.org!)
    const result = await pushNextPayment(creds, renter.payway.customerId, renter.payway.weeklyAmount || 0, weeks)
    if (!result.success) return res.status(400).json({ error: result.error || 'Push failed' })

    const newDate = new Date()
    newDate.setDate(newDate.getDate() + weeks * 7)
    renter.payway.nextDebitDate = newDate
    if (!renter.payway.activity) renter.payway.activity = []
    renter.payway.activity.push({
      type: 'info',
      message: `Pushed ${weeks} week${weeks > 1 ? 's' : ''}`,
      detail: `Next debit moved to ${result.newDate}`,
      expiresAt: newDate,
      createdAt: new Date(),
    })
    await renter.save()

    await Notification.create({
      orgId: req.orgId,
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
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })

    await pauseDebit(paywayCredsFor(req.org!), renter.payway.customerId, renter.payway.weeklyAmount || 10)
    renter.payway.status = 'paused'
    if (!renter.payway.activity) renter.payway.activity = []
    renter.payway.activity.push({ type: 'info', message: 'Auto-debit paused', detail: 'Resume anytime from the dashboard', createdAt: new Date() })
    await renter.save()

    await Notification.create({
      orgId: req.orgId,
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
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.status(400).json({ error: 'No PayWay customer found' })

    await resumeDebit(paywayCredsFor(req.org!), renter.payway.customerId, renter.payway.weeklyAmount || 0)
    renter.payway.status = 'active'
    await renter.save()

    res.json({ success: true, renter })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/renters/:phone/payments — full transaction list with void/refund eligibility
router.get('/:phone/payments', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })
    if (!renter.payway?.customerId) return res.json({ payments: [] })

    const creds = paywayCredsFor(req.org!)
    const payments = await fetchAllTransactions(creds, renter.payway.customerId)
    res.json({ payments })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/renters/:phone/verify
router.get('/:phone/verify', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const checks: { label: string; status: 'pass' | 'fail' | 'warn'; detail: string }[] = []

    const phoneClean = phone.replace(/\s/g, '')
    checks.push(phoneClean.match(/^04\d{8}$/)
      ? { label: 'Phone number', status: 'pass', detail: 'Valid Australian mobile' }
      : { label: 'Phone number', status: 'warn', detail: 'Not a standard AU mobile format' })

    if (renter.email) {
      checks.push(renter.email.includes('@')
        ? { label: 'Email', status: 'pass', detail: renter.email }
        : { label: 'Email', status: 'fail', detail: 'Invalid email format' })
    } else {
      checks.push({ label: 'Email', status: 'warn', detail: 'Not provided' })
    }

    if (renter.dateOfBirth) {
      const dob = new Date(decrypt(renter.dateOfBirth))
      const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000))
      checks.push(age >= 18
        ? { label: 'Age check', status: 'pass', detail: `${age} years old — over 18` }
        : { label: 'Age check', status: 'fail', detail: `${age} years old — under 18` })
    } else {
      checks.push({ label: 'Age check', status: 'warn', detail: 'Date of birth not provided' })
    }

    if (renter.licenceNumber) {
      const decryptedLicence = decrypt(renter.licenceNumber)
      // Duplicate licences are only meaningful within one operator's own book.
      const dupLicence = await Renter.findOne({
        orgId: req.orgId,
        licenceNumberHash: hash(decryptedLicence),
        _id: { $ne: renter._id },
      })
      checks.push(dupLicence
        ? { label: 'Licence number', status: 'fail', detail: `Already used by ${dupLicence.name}` }
        : { label: 'Licence number', status: 'pass', detail: `${decryptedLicence} — unique` })
    } else {
      checks.push({ label: 'Licence number', status: 'warn', detail: 'Not provided' })
    }

    if ((renter as any).passportNumber) {
      const decryptedPassport = decrypt((renter as any).passportNumber)
      const dupPassport = await Renter.findOne({
        orgId: req.orgId,
        passportNumberHash: hash(decryptedPassport),
        _id: { $ne: renter._id },
      })
      checks.push(dupPassport
        ? { label: 'Passport number', status: 'fail', detail: `Already used by ${dupPassport.name}` }
        : { label: 'Passport number', status: 'pass', detail: `${decryptedPassport} — unique` })
    } else {
      checks.push({ label: 'Passport number', status: 'warn', detail: 'Not provided' })
    }

    checks.push(renter.licencePhotoUrl || (renter as any).licencePhotoBase64
      ? { label: 'Licence photo', status: 'pass', detail: 'Uploaded' }
      : { label: 'Licence photo', status: 'fail', detail: 'Not uploaded' })

    checks.push((renter as any).selfieUrl || (renter as any).selfieBase64
      ? { label: 'Selfie photo', status: 'pass', detail: 'Uploaded' }
      : { label: 'Selfie photo', status: 'fail', detail: 'Not uploaded' })

    if (renter.bsbNumber) {
      const bsbClean = decrypt(renter.bsbNumber).replace('-', '')
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

    if (renter.accountNumber) {
      const acc = decrypt(renter.accountNumber)
      checks.push(acc.match(/^\d{6,10}$/)
        ? { label: 'Account number', status: 'pass', detail: 'Valid format' }
        : { label: 'Account number', status: 'warn', detail: 'Unusual format — verify manually' })
    } else {
      checks.push({ label: 'Account number', status: 'warn', detail: 'Not provided' })
    }

    if ((renter as any).currentVehicle || renter.vehicleType) {
      const available = await Vehicle.findOne({ orgId: req.orgId, status: 'available' })
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
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOneAndUpdate(
      { phone, orgId: req.orgId },
      { $set: { status: 'active', approvedAt: new Date() }, $unset: { licencePhotoBase64: '', passportPhotoBase64: '' } },
      { new: true }
    )
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    await Notification.create({
      orgId: req.orgId,
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
    const deleted = await Renter.findOneAndDelete({ phone, orgId: req.orgId })
    if (!deleted) return res.status(404).json({ error: 'Renter not found' })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/renters/:phone/ai-verify — Gemini photo verification
router.post('/:phone/ai-verify', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone)
    const renter = await Renter.findOne({ phone, orgId: req.orgId })
    if (!renter) return res.status(404).json({ error: 'Renter not found' })

    const licenceB64 = (renter as any).licencePhotoBase64 || null
    const passportB64 = (renter as any).passportPhotoBase64 || null
    if (!licenceB64) return res.status(400).json({ error: 'No licence photo uploaded' })

    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const parts: any[] = [{ inlineData: { data: licenceB64, mimeType: 'image/jpeg' } }]
    if (passportB64) parts.push({ inlineData: { data: passportB64, mimeType: 'image/jpeg' } })

    const address = [renter.address?.street, renter.address?.city, renter.address?.state, renter.address?.postcode]
      .filter(Boolean).join(', ') || 'not provided'

    const dob = renter.dateOfBirth ? decrypt(renter.dateOfBirth) : 'not provided'
    const licenceNumber = renter.licenceNumber ? decrypt(renter.licenceNumber) : 'not provided'
    const passportNumber = (renter as any).passportNumber ? decrypt((renter as any).passportNumber) : 'not provided'

    parts.push({ text: `You are verifying identity documents for an Australian vehicle rental company.

Renter submitted details:
- Full name: ${renter.name}
- Date of birth: ${dob}
- Address: ${address}
- Licence number: ${licenceNumber}
- Passport number: ${passportNumber}

Image 1 is the driver's licence.${passportB64 ? ' Image 2 is the passport.' : ' No passport was uploaded.'}

Verify each field against the documents:
1. name: Does the name on the LICENCE match "${renter.name}"?
2. dob: Does the DOB on the LICENCE match "${dob}"?
3. address: Is the submitted address visible and matching on the LICENCE? (Many Australian licences do NOT show address — if not visible, use warn with detail "Not shown on licence")
4. licenceNumber: Does the licence number on LICENCE match "${licenceNumber}"?
5. passportNumber: ${passportB64 ? `Does the passport number on the PASSPORT match "${passportNumber}"?` : 'No passport uploaded — respond with warn and detail "No passport uploaded"'}

Respond ONLY with this exact JSON (no markdown, no extra text):
{"name":{"status":"pass|fail|warn","detail":"short reason"},"dob":{"status":"pass|fail|warn","detail":"short reason"},"address":{"status":"pass|fail|warn","detail":"short reason"},"licenceNumber":{"status":"pass|fail|warn","detail":"short reason"},"passportNumber":{"status":"pass|fail|warn","detail":"short reason"}}` })

    const result = await model.generateContent(parts)
    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(502).json({ error: 'Could not parse AI response' })

    res.json({ success: true, results: JSON.parse(jsonMatch[0]) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
