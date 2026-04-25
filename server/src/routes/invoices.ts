import express from 'express'
import { requireAuth } from '../middleware/auth'
import InvoiceTemplate from '../models/InvoiceTemplate'
import Invoice from '../models/Invoice'

const router = express.Router()
router.use(requireAuth)

// ── Templates ──────────────────────────────────────────────────
router.get('/templates', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const templates = await InvoiceTemplate.find({ ownerId }).sort({ createdAt: -1 })
    res.json(templates)
  } catch {
    res.status(500).json({ error: 'Failed to fetch templates' })
  }
})

router.post('/templates', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const { logoBase64, businessName, address, phone, email, abn, bankName, bsb, account } = req.body
    if (!businessName) return res.status(400).json({ error: 'Business name required' })
    const t = await InvoiceTemplate.create({
      ownerId, name: businessName,
      logoBase64, businessName, address, phone, email, abn, bankName, bsb, account,
    })
    res.json(t.toObject())
  } catch {
    res.status(500).json({ error: 'Failed to create template' })
  }
})

router.put('/templates/:id', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const t = await InvoiceTemplate.findOneAndUpdate(
      { _id: req.params.id, ownerId },
      { $set: req.body },
      { new: true }
    )
    if (!t) return res.status(404).json({ error: 'Not found' })
    res.json(t.toObject())
  } catch {
    res.status(500).json({ error: 'Failed to update template' })
  }
})

router.delete('/templates/:id', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    await InvoiceTemplate.deleteOne({ _id: req.params.id, ownerId })
    await Invoice.deleteMany({ ownerId, templateId: req.params.id })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Failed to delete' })
  }
})

// ── Invoices ───────────────────────────────────────────────────
router.get('/next-number', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const last = await Invoice.findOne({ ownerId }).sort({ number: -1 })
    res.json({ number: last ? last.number + 1 : 3001 })
  } catch {
    res.status(500).json({ error: 'Failed' })
  }
})

router.get('/', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const invoices = await Invoice.find({ ownerId }).sort({ createdAt: -1 }).limit(20)
    res.json(invoices)
  } catch {
    res.status(500).json({ error: 'Failed' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const inv = await Invoice.findOne({ _id: req.params.id, ownerId })
    if (!inv) return res.status(404).json({ error: 'Not found' })
    res.json(inv)
  } catch {
    res.status(500).json({ error: 'Failed' })
  }
})

router.post('/', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const invoice = await Invoice.create({ ownerId, ...req.body })
    await InvoiceTemplate.findByIdAndUpdate(req.body.templateId, { $inc: { usageCount: 1 } })
    const count = await Invoice.countDocuments({ ownerId })
    if (count > 20) {
      const oldest = await Invoice.findOne({ ownerId }).sort({ createdAt: 1 })
      if (oldest) await Invoice.deleteOne({ _id: oldest._id })
    }
    res.json(invoice)
  } catch {
    res.status(500).json({ error: 'Failed to save invoice' })
  }
})

export default router