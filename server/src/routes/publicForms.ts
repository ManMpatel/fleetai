import { Router, Request, Response } from 'express'
import FormTemplate from '../models/FormTemplate'
import FormEntry from '../models/FormEntry'
import Organization from '../models/Organization'
import Notification from '../models/Notification'
import { sectionsFor, normalizePhone } from '../config/claimForm'
import { cleanAnswers, cleanIdentity, cleanPictures, missingRequired } from '../config/claimFormData'
import { findRenterByPhone } from '../services/formPrefill'

// PUBLIC - no login. The long random code in the link is the only credential, so the template is
// looked up by the code alone (the one deliberate cross-tenant read here). What goes back to the
// browser is only what the renter is meant to see: the form's name, the business name, and the
// boxes he fills in. Never the orgId, the owner's sections, or anything about other renters.
const router = Router()

const CODE = /^[A-Za-z0-9_-]{20,64}$/

function quiet(res: Response) {
  res.set('Cache-Control', 'no-store')
  res.set('X-Robots-Tag', 'noindex, nofollow')
}

async function loadForm(code: unknown) {
  if (typeof code !== 'string' || !CODE.test(code)) return null
  const template = await FormTemplate.findOne({ code }).setOptions({ allowCrossTenant: true })
  if (!template) return null
  const org = await Organization.findOne({ _id: template.orgId, status: 'approved' })
  if (!org) return null
  return { template, org }
}

// GET /api/public/forms/:code
router.get('/:code', async (req: Request, res: Response) => {
  quiet(res)
  try {
    const found = await loadForm(req.params.code)
    if (!found) return res.status(404).json({ error: 'This form is not available' })
    const { template, org } = found
    const sections = sectionsFor(template.sectionIds).filter(s => s.filler === 'renter')
    res.json({
      form: {
        name: template.name,
        intro: template.intro || '',
        business: org.displayName || org.name || '',
        logoUrl: org.logoUrl || null,
        // Without the driver section there is nowhere to say who is sending it, so the page asks.
        askWho: !sections.some(s => s.id === 'driver'),
        sections,
      },
    })
  } catch {
    res.status(500).json({ error: 'Could not load the form' })
  }
})

// POST /api/public/forms/:code/submit   { data, files, renter?, consent, hp }
router.post('/:code/submit', async (req: Request, res: Response) => {
  quiet(res)
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    // Bots fill in every box they can find; a person never sees this one. Say thanks and keep nothing.
    if (typeof body.hp === 'string' && body.hp.trim() !== '') return res.json({ ok: true })

    const found = await loadForm(req.params.code)
    if (!found) return res.status(404).json({ error: 'This form is not available any more' })
    const { template, org } = found

    if (body.consent !== true) return res.status(400).json({ error: 'Please tick the box to agree before you send the form' })

    // Only the renter's sections count, whatever the browser sends.
    const sections = sectionsFor(template.sectionIds).filter(s => s.filler === 'renter')
    const answers = cleanAnswers(sections, body.data)
    const pictures = cleanPictures(sections, body.files)

    let name: string
    let phone: string
    let email: string
    const identityProblems: string[] = []
    if (sections.some(s => s.id === 'driver')) {
      const d = answers.data.driver || {}
      name = `${d.firstName || ''} ${d.surname || ''}`.trim()
      phone = normalizePhone(d.mobile || '')
      email = d.email || ''
    } else {
      const who = cleanIdentity(body.renter)
      name = who.name
      phone = normalizePhone(who.phone)
      email = who.email
      identityProblems.push(...who.errors)
    }

    const problems = [...identityProblems, ...answers.errors, ...pictures.errors]
    if (problems.length > 0) return res.status(400).json({ error: problems[0], problems })

    const missing = missingRequired(sections, answers.data, pictures.counts)
    if (missing.length > 0) return res.status(400).json({ error: `Please fill in: ${missing.join('; ')}`, missing })
    if (!name || phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Please give your name and mobile number' })

    const now = new Date()
    const renter = await findRenterByPhone(org._id, phone)
    const content = {
      templateName: template.name,
      sectionIds: template.sectionIds,
      renterData: answers.data,
      files: pictures.files,
      fileCounts: pictures.counts,
      status: 'submitted' as const,
      submittedAt: now,
      renterPhone: phone,
      ...(renter ? { renterRef: renter._id } : {}),
    }

    // A form that was sent to this mobile number and has not come back yet is the row this answer
    // belongs to (the sent row, same template). Otherwise the answer gets a row of its own.
    let entry = null
    const waiting = await FormEntry.findOne({ orgId: org._id, templateId: template._id, renterPhone: phone, status: 'sent' }).sort({ sentAt: -1 })
    if (waiting) {
      entry = await FormEntry.findOneAndUpdate(
        { _id: waiting._id, orgId: org._id, status: 'sent' },
        { $set: { ...content, renterName: waiting.renterName || name, renterEmail: waiting.renterEmail || email } },
        { new: true },
      )
    }
    if (!entry) {
      entry = await FormEntry.create({
        orgId: org._id, templateId: template._id, renterName: name, renterEmail: email, via: 'link', sentTo: '', ...content,
      })
    }

    try {
      await Notification.create({
        orgId: org._id,
        type: 'info',
        title: 'Form received',
        description: `${name} sent back "${template.name}". Open Forms to finish your part and download the PDF.`,
        actionRequired: true,
      })
    } catch (err) {
      console.error('Could not save the form notification', err)
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('Form submit failed', err)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

export default router