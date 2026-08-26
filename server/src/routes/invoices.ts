import express, { Request, Response } from 'express'
import InvoiceTemplate from '../models/InvoiceTemplate'
import Invoice from '../models/Invoice'

// Mounted behind requireAuth + requireTenant — every query below is scoped to req.orgId.
const router = express.Router()

// ── Templates ──────────────────────────────────────────────────
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const templates = await InvoiceTemplate.find({ orgId: req.orgId }).sort({ createdAt: -1 })
    res.json(templates)
  } catch {
    res.status(500).json({ error: 'Failed to fetch templates' })
  }
})

router.post('/templates', async (req: Request, res: Response) => {
  try {
    const { logoBase64, businessName, address, phone, email, abn, bankName, bsb, account } = req.body
    if (!businessName) return res.status(400).json({ error: 'Business name required' })
    const t = await InvoiceTemplate.create({
      orgId: req.orgId, name: businessName,
      logoBase64, businessName, address, phone, email, abn, bankName, bsb, account,
    })
    res.json(t.toObject())
  } catch {
    res.status(500).json({ error: 'Failed to create template' })
  }
})

router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    const t = await InvoiceTemplate.findOneAndUpdate(
      { _id: req.params.id, orgId: req.orgId },
      { $set: req.body },
      { new: true }
    )
    if (!t) return res.status(404).json({ error: 'Not found' })
    res.json(t.toObject())
  } catch {
    res.status(500).json({ error: 'Failed to update template' })
  }
})

router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    await InvoiceTemplate.deleteOne({ _id: req.params.id, orgId: req.orgId })
    await Invoice.deleteMany({ orgId: req.orgId, templateId: req.params.id })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Failed to delete' })
  }
})

// ── Invoices ───────────────────────────────────────────────────
router.get('/next-number', async (req: Request, res: Response) => {
  try {
    const last = await Invoice.findOne({ orgId: req.orgId }).sort({ number: -1 })
    res.json({ number: last ? last.number + 1 : 3001 })
  } catch {
    res.status(500).json({ error: 'Failed' })
  }
})

router.get('/', async (req: Request, res: Response) => {
  try {
    const invoices = await Invoice.find({ orgId: req.orgId }).sort({ createdAt: -1 }).limit(20)
    res.json(invoices)
  } catch {
    res.status(500).json({ error: 'Failed' })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const inv = await Invoice.findOne({ _id: req.params.id, orgId: req.orgId })
    if (!inv) return res.status(404).json({ error: 'Not found' })
    res.json(inv)
  } catch {
    res.status(500).json({ error: 'Failed' })
  }
})

router.post('/', async (req: Request, res: Response) => {
  try {
    const invoice = await Invoice.create({ ...req.body, orgId: req.orgId })
    await InvoiceTemplate.findOneAndUpdate({ _id: req.body.templateId, orgId: req.orgId }, { $inc: { usageCount: 1 } })
    const count = await Invoice.countDocuments({ orgId: req.orgId })
    if (count > 20) {
      const oldest = await Invoice.findOne({ orgId: req.orgId }).sort({ createdAt: 1 })
      if (oldest) await Invoice.deleteOne({ _id: oldest._id })
    }
    res.json(invoice)
  } catch {
    res.status(500).json({ error: 'Failed to save invoice' })
  }
})

export default router
