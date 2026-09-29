import { Router, Request, Response } from 'express'
import Organization from '../models/Organization'
import ServiceRecord from '../models/ServiceRecord'
import TollFolder from '../models/TollFolder'
import Renter from '../models/Renter'
import { sendResendEmail } from '../services/resendEmail'
import { readMergedPdf } from '../services/tollStorage'

const router = Router()

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
// attachmentType: 'service-record' — embeds record details in the HTML body.
router.post('/send', async (req: Request, res: Response) => {
  try {
    const {
      to, subject, message,
      attachmentType, attachmentId,
    } = req.body as {
      to: string
      subject: string
      message: string
      attachmentType: 'toll-folder' | 'service-record'
      attachmentId: string
    }

    if (!to || !subject || !attachmentType || !attachmentId) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const org = req.org!
    const msgHtml = (message || '').replace(/\n/g, '<br/>')

    if (attachmentType === 'toll-folder') {
      const folder = await TollFolder.findOne({ _id: attachmentId, orgId: req.orgId })
      if (!folder) return res.status(404).json({ error: 'Folder not found' })
      if (!folder.mergedPdfFileId) return res.status(400).json({ error: 'PDF not ready yet — wait for processing to finish' })

      const pdfBuffer = await readMergedPdf(folder.mergedPdfFileId as any)
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
          ? `<tr><td style="padding:8px;font-weight:600">Total</td>
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
        </div>`

      await sendResendEmail(org, to, subject, html)
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
