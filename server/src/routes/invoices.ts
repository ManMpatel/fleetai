import express, { Request, Response } from 'express'
import InvoiceTemplate from '../models/InvoiceTemplate'
import Invoice from '../models/Invoice'

// Mounted behind requireAuth + requireTenant — every query below is scoped to req.orgId.
const router = express.Router()

// ── Templates ──────────────────────────────────────────────────
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const query = InvoiceTemplate.find({ orgId: req.orgId }).sort({ createdAt: -1 })
    // ?light=true leaves the (large) logo out — the email window only needs names.
    if (req.query.light === 'true') query.select('-logoBase64')
    const templates = await query

    // Templates created before "default" existed: the oldest one becomes the default.
    if (templates.length > 0 && !templates.some(t => t.isDefault)) {
      const oldest = templates[templates.length - 1]
      await InvoiceTemplate.updateOne({ _id: oldest._id, orgId: req.orgId }, { $set: { isDefault: true } })
      oldest.isDefault = true
    }
    res.json(templates)
  } catch {
    res.status(500).json({ error: 'Failed to fetch templates' })
  }
})

router.post('/templates', async (req: Request, res: Response) => {
  try {
    const { logoBase64, businessName, address, phone, email, abn, bankName, bsb, account, color } = req.body
    if (!businessName) return res.status(400).json({ error: 'Business name required' })
    // The first template a business creates becomes its default.
    const isFirst = (await InvoiceTemplate.countDocuments({ orgId: req.orgId })) === 0
    const t = await InvoiceTemplate.create({
      orgId: req.orgId, name: businessName, isDefault: isFirst,
      color: typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '#d4541a',
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

// Make this template the one used by default (invoice emails, and pre-selected on the Invoices tab).
router.post('/templates/:id/default', async (req: Request, res: Response) => {
  try {
    const t = await InvoiceTemplate.findOne({ _id: req.params.id, orgId: req.orgId }).select('_id')
    if (!t) return res.status(404).json({ error: 'Not found' })
    await InvoiceTemplate.updateMany({ orgId: req.orgId, _id: { $ne: t._id } }, { $set: { isDefault: false } })
    await InvoiceTemplate.updateOne({ _id: t._id, orgId: req.orgId }, { $set: { isDefault: true } })
    res.json({ ok: true, defaultId: String(t._id) })
  } catch {
    res.status(500).json({ error: 'Failed to set default' })
  }
})

router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    await InvoiceTemplate.deleteOne({ _id: req.params.id, orgId: req.orgId })
    // Invoices already emailed to customers are kept so their links keep working.
    await Invoice.deleteMany({ orgId: req.orgId, templateId: req.params.id, source: { $ne: 'service-email' } })

    // If the default was deleted, the oldest remaining template takes over.
    const remaining = await InvoiceTemplate.find({ orgId: req.orgId }).sort({ createdAt: 1 }).select('_id isDefault')
    if (remaining.length > 0 && !remaining.some(t => t.isDefault)) {
      await InvoiceTemplate.updateOne({ _id: remaining[0]._id, orgId: req.orgId }, { $set: { isDefault: true } })
    }
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
    // Up to 20 manual invoices are kept; emailed invoices are kept on top of that.
    const invoices = await Invoice.find({ orgId: req.orgId }).sort({ createdAt: -1 }).limit(100)
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
    // These are set by the server only (emailed invoices) — never accepted from the browser.
    const { source: _s, publicToken: _t, serviceRecordId: _r, templateSnapshot: _ts, ...body } = req.body
    const invoice = await Invoice.create({ ...body, orgId: req.orgId })
    await InvoiceTemplate.findOneAndUpdate({ _id: req.body.templateId, orgId: req.orgId }, { $inc: { usageCount: 1 } })
    // Only manual invoices count towards the 20 limit; emailed ones are never deleted here.
    const manual = { orgId: req.orgId, source: { $ne: 'service-email' } }
    const count = await Invoice.countDocuments(manual)
    if (count > 20) {
      const oldest = await Invoice.findOne(manual).sort({ createdAt: 1 })
      if (oldest) await Invoice.deleteOne({ _id: oldest._id, orgId: req.orgId })
    }
    res.json(invoice)
  } catch {
    res.status(500).json({ error: 'Failed to save invoice' })
  }
})

export default router
