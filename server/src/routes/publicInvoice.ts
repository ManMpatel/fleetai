import { Router, Request, Response } from 'express'
import mongoose from 'mongoose'
import Invoice from '../models/Invoice'
import InvoiceTemplate from '../models/InvoiceTemplate'

// PUBLIC — no login. The long random token in the link is the only credential, so it is
// looked up by token alone (the one deliberate cross-tenant read here) and the response only
// carries what is printed on the invoice itself: never the org id or any other tenant data.
const router = Router()

// GET /api/public/invoice/:token
router.get('/invoice/:token', async (req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store')
    res.set('X-Robots-Tag', 'noindex, nofollow')

    const token = String(req.params.token || '')
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(404).json({ error: 'Invoice not found' })

    const inv = await Invoice.findOne({ publicToken: token }).setOptions({ allowCrossTenant: true }).lean()
    if (!inv) return res.status(404).json({ error: 'Invoice not found' })

    // Prefer the live template (current logo and bank details); fall back to what was saved
    // with the invoice if the template has been deleted.
    const live = mongoose.isValidObjectId(inv.templateId)
      ? await InvoiceTemplate.findOne({ _id: inv.templateId, orgId: inv.orgId }).lean()
      : null
    const t: any = live || inv.templateSnapshot || {}

    res.json({
      invoice: {
        number: inv.number,
        billToName: inv.billToName || '',
        billToAddress: inv.billToAddress || '',
        customerId: inv.customerId || '',
        terms: inv.terms || '',
        invoiceDate: inv.invoiceDate || '',
        serviceDate: inv.serviceDate || '',
        kilometres: inv.kilometres || '',
        rego: inv.rego || '',
        lineItems: (inv.lineItems || []).map(l => ({
          description: l.description || '',
          days: l.days ?? 1,
          unitPrice: l.unitPrice ?? 0,
          amount: l.amount ?? 0,
        })),
        subtotal: inv.subtotal ?? 0,
        gst: inv.gst ?? 0,
        total: inv.total ?? 0,
        gstMode: inv.gstMode || 'added',
        balancePaid: inv.balancePaid !== false,
        source: inv.source || 'manual',
      },
      template: {
        businessName: t.businessName || inv.templateName || '',
        address: t.address || '',
        phone: t.phone || '',
        email: t.email || '',
        abn: t.abn || '',
        bankName: t.bankName || '',
        bsb: t.bsb || '',
        account: t.account || '',
        color: t.color || '#d4541a',
        logoBase64: live?.logoBase64 || '',
      },
    })
  } catch {
    res.status(500).json({ error: 'Failed to load invoice' })
  }
})

export default router
