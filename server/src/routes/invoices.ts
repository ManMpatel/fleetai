import express from 'express'
import { requireAuth } from '../middleware/auth'
import InvoiceTemplate from '../models/InvoiceTemplate'
import Invoice from '../models/Invoice'

const router = express.Router()
router.use(requireAuth)

// ── Templates ──────────────────────────────────────────
router.get('/templates', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const templates = await InvoiceTemplate.find({ ownerId }).sort({ createdAt: -1 }).select('-pdfBase64')
    res.json(templates)
  } catch {
    res.status(500).json({ error: 'Failed to fetch templates' })
  }
})

router.post('/templates', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const { name, pdfBase64 } = req.body
    if (!name || !pdfBase64) return res.status(400).json({ error: 'Name and PDF required' })
    const t = await InvoiceTemplate.create({ ownerId, name, pdfBase64 })
    const obj = t.toObject() as any
    delete obj.pdfBase64
    res.json(obj)
  } catch {
    res.status(500).json({ error: 'Failed to upload template' })
  }
})

router.get('/templates/:id/pdf', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const t = await InvoiceTemplate.findOne({ _id: req.params.id, ownerId })
    if (!t) return res.status(404).json({ error: 'Not found' })
    res.json({ pdfBase64: t.pdfBase64 })
  } catch {
    res.status(500).json({ error: 'Failed to fetch PDF' })
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

// ── Invoices ───────────────────────────────────────────
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
    res.status(500).json({ error: 'Failed to fetch invoices' })
  }
})

router.post('/', async (req, res) => {
  try {
    const ownerId = (req as any).auth?.payload?.sub
    const invoice = await Invoice.create({ ownerId, ...req.body })

    // Increment template usage count
    await InvoiceTemplate.findByIdAndUpdate(req.body.templateId, { $inc: { usageCount: 1 } })

    // Enforce 20 invoice limit — delete oldest
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


export default router