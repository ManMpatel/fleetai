import crypto from 'crypto'
import { Router, Request, Response, NextFunction } from 'express'
import FormTemplate from '../models/FormTemplate'
import FormEntry from '../models/FormEntry'
import { featureAllowed } from '../config/featureAccess'
import { FORM_SECTIONS, sectionById, sectionsFor, normalizePhone } from '../config/claimForm'
import { cleanAnswers } from '../config/claimFormData'
import { ownerDefaults } from '../services/formPrefill'
import { sendResendEmail } from '../services/resendEmail'

// OWNER side of Forms: build templates, send the template link to renters, and see the history.
// The renter's side (the public form page and the submit) is routes/publicForms.ts.
const router = Router()

// Every route in this file is for the named accounts only (server/src/config/featureAccess.ts).
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!featureAllowed('forms', req.org?.email)) {
    return res.status(403).json({ error: 'Forms are not switched on for this account' })
  }
  next()
})

const OBJECT_ID = /^[a-f0-9]{24}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_TEMPLATES = 50

type SendVia = 'email' | 'whatsapp' | 'copy'

function str(x: unknown, max: number): string {
  return typeof x === 'string' ? x.trim().slice(0, max) : ''
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The link in an email. The dashboard builds the copy / WhatsApp link from its own address. */
function linkFor(code: string): string {
  const base = (process.env.APP_URL || 'https://fleetai.co.in').replace(/\/+$/, '')
  return `${base}/form/${code}`
}

function templateJson(t: any, counts?: { sent: number; submitted: number }) {
  return {
    id: String(t._id),
    name: t.name,
    intro: t.intro || '',
    sectionIds: t.sectionIds || [],
    code: t.code,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    sent: counts?.sent ?? 0,
    submitted: counts?.submitted ?? 0,
  }
}

// Never includes the answers or the pictures: the list stays small however many forms come back.
function entryJson(e: any) {
  return {
    id: String(e._id),
    templateId: String(e.templateId),
    templateName: e.templateName || '',
    renterName: e.renterName || '',
    renterPhone: e.renterPhone || '',
    renterEmail: e.renterEmail || '',
    via: e.via,
    sentTo: e.sentTo || '',
    sentAt: e.sentAt || null,
    status: e.status,
    submittedAt: e.submittedAt || null,
    completedAt: e.completedAt || null,
    createdAt: e.createdAt,
  }
}

type TemplateInput = { ok: true; name: string; intro: string; sectionIds: string[] } | { ok: false; error: string }

function parseTemplate(body: any): TemplateInput {
  const name = str(body?.name, 80)
  if (!name) return { ok: false, error: 'Give the template a name' }
  const intro = str(body?.intro, 600)
  const raw: unknown[] = Array.isArray(body?.sectionIds) ? body.sectionIds : []
  if (raw.some(id => typeof id !== 'string' || !sectionById(id))) return { ok: false, error: 'One of the sections is not known' }
  const sections = sectionsFor(raw as string[])
  if (sections.length === 0) return { ok: false, error: 'Tick at least one section' }
  if (!sections.some(s => s.filler === 'renter')) return { ok: false, error: 'Tick at least one section for the renter to fill in' }
  return { ok: true, name, intro, sectionIds: sections.map(s => s.id) }
}

interface SendDefaults { renterName?: string; renterPhone?: string; renterEmail?: string }
type SendInput =
  | { ok: true; via: SendVia; renterName: string; phone: string; email: string; message: string }
  | { ok: false; error: string }

// The browser fills in what it knows; anything it leaves out falls back to the row being resent.
function parseSend(body: any, d: SendDefaults = {}): SendInput {
  const via = body?.via
  if (via !== 'email' && via !== 'whatsapp' && via !== 'copy') return { ok: false, error: 'Choose how to send it' }

  const renterName = str(body?.renterName ?? d.renterName, 80)
  if (!renterName) return { ok: false, error: "Type the renter's name" }

  const phoneText = str(body?.phone ?? d.renterPhone, 30)
  const phone = normalizePhone(phoneText)
  if (phoneText && phone.replace(/\D/g, '').length < 9) return { ok: false, error: 'That mobile number looks too short' }
  if (via === 'whatsapp' && !phone) return { ok: false, error: "Type the renter's mobile number to send on WhatsApp" }

  const email = str(body?.email ?? d.renterEmail, 120).toLowerCase()
  if (email && !EMAIL.test(email)) return { ok: false, error: 'That email address does not look right' }
  if (via === 'email' && !email) return { ok: false, error: "Type the renter's email address" }

  return { ok: true, via, renterName, phone, email, message: str(body?.message, 1000) }
}

function emailHtml(o: { business: string; renterName: string; formName: string; link: string; message: string }): string {
  const message = o.message
    ? `<p style="margin:14px 0">${escapeHtml(o.message).replace(/\n/g, '<br/>')}</p>`
    : ''
  return `
    <div style="font-family:sans-serif;max-width:560px;color:#222;font-size:15px;line-height:1.5">
      <p>Hi ${escapeHtml(o.renterName)},</p>
      <p>${escapeHtml(o.business)} needs you to fill in a form: <strong>${escapeHtml(o.formName)}</strong>.</p>
      ${message}
      <p style="margin:22px 0">
        <a href="${escapeHtml(o.link)}" style="display:inline-block;background:#d4541a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Open the form</a>
      </p>
      <p style="font-size:13px;color:#666">Or copy this link into your browser:<br/>${escapeHtml(o.link)}</p>
      <p style="font-size:13px;color:#666">You can fill it in on your phone. You will be asked to attach your driver licence and photos, and to sign on the screen.</p>
    </div>`
}

async function sendFormEmail(req: Request, to: string, renterName: string, template: { name: string; code: string }, message: string): Promise<void> {
  const org = req.org!
  await sendResendEmail(
    org,
    to,
    `Please complete the form: ${template.name}`.slice(0, 150),
    emailHtml({
      business: org.displayName || org.name || 'Your rental provider',
      renterName,
      formName: template.name,
      link: linkFor(template.code),
      message,
    }),
  )
}

// GET /api/forms/library - every section of the claim form (names, who fills it in, the boxes).
router.get('/library', (_req: Request, res: Response) => {
  res.json({ sections: FORM_SECTIONS })
})

// GET /api/forms/templates
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const [templates, entries] = await Promise.all([
      FormTemplate.find({ orgId: req.orgId }).sort({ createdAt: -1 }).lean(),
      FormEntry.find({ orgId: req.orgId }).select('templateId status').lean(),
    ])
    const counts = new Map<string, { sent: number; submitted: number }>()
    for (const e of entries) {
      const key = String(e.templateId)
      const c = counts.get(key) || { sent: 0, submitted: 0 }
      c.sent += 1
      if (e.status !== 'sent') c.submitted += 1
      counts.set(key, c)
    }
    res.json({ templates: templates.map(t => templateJson(t, counts.get(String(t._id)))) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/forms/templates   { name, intro, sectionIds }
router.post('/templates', async (req: Request, res: Response) => {
  try {
    const input = parseTemplate(req.body)
    if (!input.ok) return res.status(400).json({ error: input.error })

    const have = await FormTemplate.countDocuments({ orgId: req.orgId })
    if (have >= MAX_TEMPLATES) return res.status(400).json({ error: `You can keep up to ${MAX_TEMPLATES} templates. Delete one you no longer use.` })

    const template = await FormTemplate.create({
      orgId: req.orgId,
      name: input.name,
      intro: input.intro,
      sectionIds: input.sectionIds,
      code: crypto.randomBytes(18).toString('base64url'),
    })
    res.status(201).json({ template: templateJson(template) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/forms/templates/:id   { name, intro, sectionIds }   (the link stays the same)
router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    if (!OBJECT_ID.test(req.params.id)) return res.status(404).json({ error: 'Template not found' })
    const input = parseTemplate(req.body)
    if (!input.ok) return res.status(400).json({ error: input.error })

    const template = await FormTemplate.findOneAndUpdate(
      { _id: req.params.id, orgId: req.orgId },
      { $set: { name: input.name, intro: input.intro, sectionIds: input.sectionIds } },
      { new: true },
    )
    if (!template) return res.status(404).json({ error: 'Template not found' })
    res.json({ template: templateJson(template) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/forms/templates/:id - the link stops working; forms already sent stay in the history.
router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    if (!OBJECT_ID.test(req.params.id)) return res.status(404).json({ error: 'Template not found' })
    const gone = await FormTemplate.findOneAndDelete({ _id: req.params.id, orgId: req.orgId })
    if (!gone) return res.status(404).json({ error: 'Template not found' })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/forms/templates/:id/send   { via: 'email'|'whatsapp'|'copy', renterName, phone?, email?, message? }
// Writes the history row. Email is sent from here; WhatsApp and copy happen in the browser, which
// tells us it did them so the history is complete.
router.post('/templates/:id/send', async (req: Request, res: Response) => {
  try {
    if (!OBJECT_ID.test(req.params.id)) return res.status(404).json({ error: 'Template not found' })
    const template = await FormTemplate.findOne({ _id: req.params.id, orgId: req.orgId })
    if (!template) return res.status(404).json({ error: 'Template not found' })

    const input = parseSend(req.body)
    if (!input.ok) return res.status(400).json({ error: input.error })

    if (input.via === 'email') {
      try {
        await sendFormEmail(req, input.email, input.renterName, template, input.message)
      } catch (err: any) {
        return res.status(502).json({ error: `The email could not be sent: ${err.message}` })
      }
    }

    const entry = await FormEntry.create({
      orgId: req.orgId,
      templateId: template._id,
      templateName: template.name,
      sectionIds: template.sectionIds,
      renterName: input.renterName,
      renterPhone: input.phone,
      renterEmail: input.email,
      via: input.via,
      sentTo: input.via === 'email' ? input.email : input.via === 'whatsapp' ? input.phone : '',
      sentAt: new Date(),
      status: 'sent',
    })
    res.status(201).json({ entry: entryJson(entry) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// What the owner's screen needs to show a form that came back: the answers, how many pictures each
// box has, and the owner-part suggestions. The pictures themselves are fetched separately.
function entryDetailJson(e: any) {
  return { ...entryJson(e), renterData: e.renterData || {}, ownerData: e.ownerData || {}, fileCounts: e.fileCounts || {} }
}

// GET /api/forms/entries - the history, newest first, without answers or pictures.
router.get('/entries', async (req: Request, res: Response) => {
  try {
    const entries = await FormEntry.find({ orgId: req.orgId })
      .select('-renterData -ownerData -files')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
    res.json({ entries: entries.map(entryJson) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/forms/entries/:id/resend - send the same link again to a renter who has not sent it back.
router.post('/entries/:id/resend', async (req: Request, res: Response) => {
  try {
    if (!OBJECT_ID.test(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const entry = await FormEntry.findOne({ _id: req.params.id, orgId: req.orgId })
    if (!entry) return res.status(404).json({ error: 'Not found' })
    if (entry.status !== 'sent') return res.status(409).json({ error: 'The renter already sent this form back' })

    const template = await FormTemplate.findOne({ _id: entry.templateId, orgId: req.orgId })
    if (!template) return res.status(410).json({ error: 'This template was deleted, so its link no longer works' })

    const input = parseSend(req.body, { renterName: entry.renterName, renterPhone: entry.renterPhone, renterEmail: entry.renterEmail })
    if (!input.ok) return res.status(400).json({ error: input.error })

    if (input.via === 'email') {
      try {
        await sendFormEmail(req, input.email, input.renterName, template, input.message)
      } catch (err: any) {
        return res.status(502).json({ error: `The email could not be sent: ${err.message}` })
      }
    }

    entry.set({
      renterName: input.renterName,
      renterPhone: input.phone,
      renterEmail: input.email,
      via: input.via,
      sentTo: input.via === 'email' ? input.email : input.via === 'whatsapp' ? input.phone : '',
      sentAt: new Date(),
    })
    await entry.save()
    res.json({ entry: entryJson(entry), code: template.code })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/forms/entries/:id - one form: the answers, the sections it has, and suggestions for the owner's part.
router.get('/entries/:id', async (req: Request, res: Response) => {
  try {
    if (!OBJECT_ID.test(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const entry = await FormEntry.findOne({ _id: req.params.id, orgId: req.orgId }).select('-files').lean()
    if (!entry) return res.status(404).json({ error: 'Not found' })
    const sections = sectionsFor(entry.sectionIds || [])
    const defaults = entry.status === 'sent' ? {} : await ownerDefaults(req.orgId!, entry, sections)
    res.json({ entry: entryDetailJson(entry), sections, ownerDefaults: defaults })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/forms/entries/:id/files - the pictures (licence, photos, signature) as data URLs.
router.get('/entries/:id/files', async (req: Request, res: Response) => {
  try {
    if (!OBJECT_ID.test(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const entry = await FormEntry.findOne({ _id: req.params.id, orgId: req.orgId }).select('files').lean()
    if (!entry) return res.status(404).json({ error: 'Not found' })
    res.json({ files: entry.files || {} })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/forms/entries/:id/owner   { data, status?: 'submitted' | 'completed' }
// Saves the owner's part of a form the renter has sent back. status completed marks it finished.
router.put('/entries/:id/owner', async (req: Request, res: Response) => {
  try {
    if (!OBJECT_ID.test(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const entry = await FormEntry.findOne({ _id: req.params.id, orgId: req.orgId })
    if (!entry) return res.status(404).json({ error: 'Not found' })
    if (entry.status === 'sent') return res.status(409).json({ error: 'The renter has not sent this form back yet' })

    const status = req.body?.status
    if (status !== undefined && status !== 'submitted' && status !== 'completed') return res.status(400).json({ error: 'Unknown status' })

    const mine = sectionsFor(entry.sectionIds || []).filter(s => s.filler === 'owner')
    const cleaned = cleanAnswers(mine, req.body?.data)
    if (cleaned.errors.length > 0) return res.status(400).json({ error: cleaned.errors[0], problems: cleaned.errors })

    entry.ownerData = cleaned.data
    entry.markModified('ownerData')
    if (status === 'completed') {
      entry.status = 'completed'
      entry.completedAt = entry.completedAt || new Date()
    } else if (status === 'submitted') {
      entry.status = 'submitted'
      entry.completedAt = undefined
    }
    await entry.save()
    res.json({ entry: entryDetailJson(entry) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/forms/entries/:id - removes the row together with the answers and pictures.
router.delete('/entries/:id', async (req: Request, res: Response) => {
  try {
    if (!OBJECT_ID.test(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const gone = await FormEntry.findOneAndDelete({ _id: req.params.id, orgId: req.orgId })
    if (!gone) return res.status(404).json({ error: 'Not found' })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
