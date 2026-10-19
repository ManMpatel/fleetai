import { Router, Request, Response } from 'express'
import Organization from '../models/Organization'
import ServiceRecord from '../models/ServiceRecord'
import TollFolder from '../models/TollFolder'
import Renter from '../models/Renter'
import Invoice from '../models/Invoice'
import { sendResendEmail } from '../services/resendEmail'
import { getFolderPdfBuffer } from '../services/tollFiles'
import {
  GST_MODES, upsertServiceInvoice, discardServiceInvoice, invoiceEmailBlock,
} from '../services/serviceInvoice'
import type { GstMode, ServiceInvoiceOk } from '../services/serviceInvoice'

const router = Router()

// The browser builds invoice PDFs (there is no invoice renderer on the server), so an invoice to email arrives
// as base64. Only a real PDF of a sensible size is accepted.
const MAX_INVOICE_PDF_BASE64 = 14000000   // about 10 MB of PDF
function decodeInvoicePdf(data: unknown): Buffer | null {
  if (typeof data !== 'string' || data.length === 0 || data.length > MAX_INVOICE_PDF_BASE64) return null
  const pdf = Buffer.from(data, 'base64')
  return pdf.length > 5 && pdf.subarray(0, 5).toString('latin1') === '%PDF-' ? pdf : null
}

// GET /api/email/recipients?q=
// Returns matching renters (with email) + recent recipients saved on the org.
router.get('/recipients', async (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) || '').trim()
    const org = req.org!
    const recentRecipients: string[] = org.resendEmail?.recentRecipients || []

    const renterQuery: any = { orgId: req.orgId, email: { $exists: true, $ne: '' } }
    if (q) {
      renterQuery.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ]
    }
    const renters = await Renter.find(renterQuery).select('name email').limit(10)

    const recent = q
      ? recentRecipients.filter(e => e.toLowerCase().includes(q.toLowerCase()))
      : recentRecipients

    res.json({
      renters: renters.map(r => ({ name: r.name, email: r.email })),
      recent,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/email/send
// Body: { to, subject, message, attachmentType, attachmentId }
// attachmentType: 'toll-folder' — attaches the merged PDF; marks folder as sent.
// attachmentType: 'invoice' - attaches the invoice PDF the browser built (pdfBase64); needs an invoice of this business.
// attachmentType: 'service-record' — embeds record details in the HTML body.
router.post('/send', async (req: Request, res: Response) => {
  try {
    const {
      to, subject, message,
      attachmentType, attachmentId,
      includeInvoice, templateId, gstMode, balancePaid, pdfBase64,
    } = req.body as {
      to: string
      subject: string
      message: string
      attachmentType: 'toll-folder' | 'service-record' | 'invoice'
      attachmentId: string
      includeInvoice?: boolean
      templateId?: string
      gstMode?: string
      balancePaid?: boolean
      pdfBase64?: string
    }

    if (!to || !subject || !attachmentType || !attachmentId) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const org = req.org!
    const msgHtml = (message || '').replace(/\n/g, '<br/>')

    if (attachmentType === 'toll-folder') {
      const folder = await TollFolder.findOne({ _id: attachmentId, orgId: req.orgId })
      if (!folder) return res.status(404).json({ error: 'Folder not found' })
      if (folder.imagesDeleted) return res.status(410).json({ error: 'These toll notices were automatically deleted when their storage time ended' })

      // The PDF of this plate: the stored one, or cut from the original scan now if there is none yet
      // (a folder of any size works, there is no "not ready yet").
      const pdfBuffer = await getFolderPdfBuffer(String(folder._id), String(req.orgId))
      const filename = `${folder.plate || 'toll-notice'}.pdf`

      await sendResendEmail(
        org, to, subject,
        `<div style="font-family:sans-serif"><p>${msgHtml}</p></div>`,
        { filename, content: pdfBuffer },
      )

      folder.sentStatus = 'sent'
      folder.sentTo = to
      folder.sentAt = new Date()
      await folder.save()

      await saveRecipient(org._id.toString(), to)
      return res.json({ success: true, sentTo: to, sentAt: folder.sentAt })
    }

    if (attachmentType === 'service-record') {
      const record = await ServiceRecord.findOne({ _id: attachmentId, orgId: req.orgId })
      if (!record) return res.status(404).json({ error: 'Record not found' })

      // Optional invoice — created (or refreshed) from this record and linked inside the email.
      let inv: ServiceInvoiceOk | null = null
      if (includeInvoice === true) {
        if (gstMode !== undefined && !GST_MODES.includes(gstMode as GstMode)) {
          return res.status(400).json({ error: 'Invalid GST option' })
        }
        const made = await upsertServiceInvoice({
          org, record, toEmail: to, templateId: templateId || undefined,
          gstMode: (gstMode as GstMode | undefined) ?? 'none',
          balancePaid: balancePaid === true,
        })
        if (!made.ok) return res.status(made.status).json({ error: made.error })
        inv = made
      }

      const date = new Date(record.date).toLocaleDateString('en-AU', { dateStyle: 'medium' })

      let itemsHtml = ''
      if (record.items && record.items.length > 0) {
        const rows = record.items
          .map(i => `<tr>
            <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0">${i.name}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;text-align:right">
              ${i.price != null ? `$${Number(i.price).toFixed(2)}` : '—'}
            </td>
          </tr>`)
          .join('')
        const totalRow = record.cost != null
          ? `<tr><td style="padding:8px;font-weight:600">${inv && inv.gstMode === 'added' ? 'Subtotal (before GST)' : 'Total'}</td>
             <td style="padding:8px;text-align:right;font-weight:600">$${Number(record.cost).toFixed(2)}</td></tr>`
          : ''
        itemsHtml = `<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px">
          ${rows}${totalRow}
        </table>`
      } else if (record.cost != null) {
        itemsHtml = `<p style="margin:8px 0"><strong>Cost:</strong> $${Number(record.cost).toFixed(2)}</p>`
      }

      const html = `
        <div style="font-family:sans-serif;max-width:600px;color:#222">
          <p>${msgHtml}</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
          <h3 style="margin:0 0 12px;font-size:16px;font-weight:600">Service Record</h3>
          <p style="margin:4px 0;font-size:14px"><strong>Date:</strong> ${date}</p>
          <p style="margin:4px 0;font-size:14px"><strong>Vehicle:</strong> ${record.plate}</p>
          ${record.kilometres ? `<p style="margin:4px 0;font-size:14px"><strong>Kilometres:</strong> ${record.kilometres} km</p>` : ''}
          ${record.employeeName ? `<p style="margin:4px 0;font-size:14px"><strong>Technician:</strong> ${record.employeeName}</p>` : ''}
          ${itemsHtml}
          ${record.notes ? `<p style="margin:8px 0;font-size:14px"><strong>Notes:</strong> ${record.notes}</p>` : ''}
          ${inv ? invoiceEmailBlock(inv) : ''}
        </div>`

      try {
        await sendResendEmail(org, to, subject, html)
      } catch (sendErr) {
        // The email did not go out, so do not leave a brand-new invoice behind.
        if (inv && inv.created) await discardServiceInvoice(org._id, inv).catch(() => {})
        throw sendErr
      }
      await saveRecipient(org._id.toString(), to)
      return res.json({
        success: true,
        sentTo: to,
        ...(inv ? { invoice: { number: inv.number, total: inv.total, url: inv.url } } : {}),
      })
    }

    if (attachmentType === 'invoice') {
      const invoice = await Invoice.findOne({ _id: attachmentId, orgId: req.orgId }).select('number')
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
      const pdf = decodeInvoicePdf(pdfBase64)
      if (!pdf) return res.status(400).json({ error: 'The invoice PDF is missing or not a valid PDF' })

      await sendResendEmail(
        org, to, subject,
        `<div style="font-family:sans-serif"><p>${msgHtml}</p></div>`,
        { filename: `Invoice-${invoice.number}.pdf`, content: pdf },
      )

      await saveRecipient(org._id.toString(), to)
      return res.json({ success: true, sentTo: to })
    }

    return res.status(400).json({ error: 'Invalid attachment type' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

async function saveRecipient(orgId: string, email: string) {
  await Organization.findByIdAndUpdate(orgId, {
    $pull: { 'resendEmail.recentRecipients': email },
  })
  await Organization.findByIdAndUpdate(orgId, {
    $push: {
      'resendEmail.recentRecipients': {
        $each: [email],
        $position: 0,
        $slice: 10,
      },
    },
  })
}

export default router
