import { Router, Request, Response } from 'express'
import axios from 'axios'
import { Types } from 'mongoose'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Vehicle from '../models/Vehicle'
import Renter from '../models/Renter'
import Notification from '../models/Notification'
import Organization, { IOrganization } from '../models/Organization'
import { decrypt } from './encryption'
import { pauseDebit, paywayCredsFor } from './payway'
import { scopedPopulate } from '../models/plugins/tenantScope'
import { isLegacyOrg, legacyOrgEmail, legacyWhatsApp } from '../config/legacyTenant'

const router = Router()

// ── Pending confirmations (in-memory) ─────────────────────
// Keyed by `${orgId}:${from}` — the same phone number may legitimately be a contact for
// more than one tenant, and their pending states must not collide.
interface PendingReturn {
  plate: string
  renterId: string
  renterName: string
  renterPhone: string
  vehicleModel: string
  startDate: Date
  endDate: Date
  weeklyRate: number
  totalWeeks: number
  totalAmount: number
  expiresAt: number
}

interface PendingDebitStop {
  plate: string
  renterPhone: string
  renterName: string
  expiresAt: number
}

const pendingReturns = new Map<string, PendingReturn>()
const pendingDebitStops = new Map<string, PendingDebitStop>()

const sessionKey = (orgId: Types.ObjectId, from: string) => `${orgId.toString()}:${from}`

// ── Intent categories ──────────────────────────────────────
type Intent = 'returned' | 'service_in' | 'service_done' | 'damage' | 'inquiry' | 'confirm' | 'edit' | 'yes' | 'no' | 'unknown'

const INTENT_PATTERNS: Record<Intent, RegExp> = {
  returned: /\b(return(ed)?|back|done|finished|drop(ped)? off|brought back|all good|handing? (back|in))\b/i,
  service_in: /\b(service\s*in|going\s*(in|to)\s*(service|garage|mechanic)|sending\s*(for\s*)?service|workshop|repair\s*in|dropping\s*(off\s*)?for\s*service)\b/i,
  service_done: /\b(service\s*(done|complete|finished|out|back)|picked\s*up|ready|fixed|out\s*of\s*service|mechanic\s*done)\b/i,
  damage: /\b(damage(d)?|scratch(ed)?|dent(ed)?|accident|hit|broken|crack(ed)?|smash(ed)?|bang(ed)?|mirror|tyre)\b/i,
  inquiry: /\b(where|which|how\s*many|status|check|info|available|rego|fine|toll)\b/i,
  confirm: /^\s*confirm\s*$/i,
  edit: /^\s*edit\s*$/i,
  yes: /^\s*yes\s*$/i,
  no: /^\s*no\s*$/i,
  unknown: /.*/,
}

function detectIntent(text: string): Intent {
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS) as [Intent, RegExp][]) {
    if (intent === 'unknown') continue
    if (pattern.test(text)) return intent
  }
  return 'unknown'
}

function extractPlateFromText(text: string): string | null {
  const match = text.match(/\b([A-Z]{1,3}[0-9]{1,4}[A-Z]{0,3}|[0-9]{1,4}[A-Z]{2,3})\b/i)
  return match ? match[1].toUpperCase().replace(/\s+/g, '') : null
}

// ── Inbound payload parsing ────────────────────────────────
// The outbound path uses the Meta Graph API, but this webhook has historically received
// Twilio-shaped form fields. Both are handled so the behaviour does not regress; the
// tenant is identified by the *receiving* business number in either shape.
interface InboundMessage {
  phoneId: string | null
  to: string | null
  from: string
  text: string
  mediaId: string | null
  mediaUrl: string | null
}

export function parseInbound(body: any): InboundMessage | null {
  // Meta Cloud API (JSON)
  const change = body?.entry?.[0]?.changes?.[0]?.value
  if (change) {
    const message = change.messages?.[0]
    if (!message) return null
    return {
      phoneId: change.metadata?.phone_number_id ?? null,
      to: change.metadata?.display_phone_number ?? null,
      from: message.from ?? '',
      text: (message.text?.body ?? '').trim(),
      mediaId: message.image?.id ?? message.document?.id ?? null,
      mediaUrl: null,
    }
  }

  // Twilio (form-encoded)
  if (typeof body?.From === 'string') {
    return {
      phoneId: null,
      to: (body.To ?? '').replace('whatsapp:', '').replace('+', '') || null,
      from: body.From ?? '',
      text: (body.Body ?? '').trim(),
      mediaId: null,
      mediaUrl: parseInt(body.NumMedia ?? '0', 10) > 0 ? (body.MediaUrl0 ?? null) : null,
    }
  }

  return null
}

/**
 * Resolved WhatsApp credentials for a tenant.
 *
 * The founding operator's number and token are still environment variables, so the one
 * organisation named by LEGACY_ORG_EMAIL falls back to them. Everyone else must connect
 * their own number in Settings, or have the platform admin enter it for them.
 */
export function whatsappCredsFor(org: IOrganization): { phoneId: string; token: string } | null {
  const phoneId = org.whatsapp?.phoneId
  const token = org.whatsapp?.tokenEnc ? decrypt(org.whatsapp.tokenEnc) : null
  if (phoneId && token) return { phoneId, token }

  if (isLegacyOrg(org)) {
    const env = legacyWhatsApp()
    if (env) return { phoneId: phoneId || env.phoneId, token: token || env.token }
  }
  return null
}

/** True when this tenant may send and receive — stored config, or the legacy env pair. */
export function whatsappActiveFor(org: IOrganization): boolean {
  if (org.whatsapp?.enabled && org.whatsapp.tokenEnc) return true
  return isLegacyOrg(org) && !!legacyWhatsApp()
}

/** Finds the tenant that owns the business number this message was sent to. */
async function resolveTenant(inbound: InboundMessage): Promise<IOrganization | null> {
  if (inbound.phoneId) {
    const byPhoneId = await Organization.findOne({ 'whatsapp.phoneId': inbound.phoneId })
    if (byPhoneId) return byPhoneId
  }
  if (inbound.to) {
    const digits = inbound.to.replace(/[^0-9]/g, '')
    const byNumber = await Organization.findOne({ 'whatsapp.phoneId': digits })
    if (byNumber) return byNumber
  }

  // The founding operator's number is configured in the environment rather than on their
  // organisation record, so it will not match either lookup above.
  const env = legacyWhatsApp()
  const legacyEmail = legacyOrgEmail()
  if (env && legacyEmail) {
    const matchesEnv =
      inbound.phoneId === env.phoneId ||
      (!!inbound.to && inbound.to.replace(/[^0-9]/g, '') === env.phoneId.replace(/[^0-9]/g, ''))
    // Twilio-shaped payloads carry no phone_number_id at all; with the fallback configured
    // there is exactly one tenant it can belong to.
    if (matchesEnv || (!inbound.phoneId && !inbound.to)) {
      return Organization.findOne({ email: legacyEmail })
    }
  }
  return null
}

function whatsappToken(org: IOrganization): string | null {
  return whatsappCredsFor(org)?.token ?? null
}

// ── Send WhatsApp message on behalf of a tenant ────────────
export async function sendWhatsAppText(org: IOrganization, to: string, body: string): Promise<void> {
  const creds = whatsappCredsFor(org)
  if (!creds) {
    throw new Error('WhatsApp is not connected for this organisation')
  }
  const { token, phoneId } = creds

  const cleanTo = to.replace('whatsapp:', '').replace('+', '')

  await axios.post(
    `https://graph.facebook.com/v22.0/${phoneId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'text',
      text: { body },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  )
}

async function replyQuietly(org: IOrganization, to: string, body: string): Promise<void> {
  try {
    await sendWhatsAppText(org, to, body)
  } catch (err: any) {
    console.error('WhatsApp reply failed:', err.message)
  }
}

// ── Gemini Vision: read plate from image ──────────────────
async function readPlateFromImage(org: IOrganization, inbound: InboundMessage): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || apiKey === 'your_key_here') return null

  try {
    const token = whatsappToken(org)
    let imageUrl = inbound.mediaUrl

    // Meta returns a media id; the download URL has to be looked up and fetched with auth.
    if (!imageUrl && inbound.mediaId && token) {
      const meta = await axios.get(`https://graph.facebook.com/v22.0/${inbound.mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      })
      imageUrl = meta.data?.url ?? null
    }
    if (!imageUrl) return null

    const imgRes = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })

    const mimeType = (imgRes.headers['content-type'] as string) || 'image/jpeg'
    const imageBase64 = Buffer.from(imgRes.data).toString('base64')

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const result = await model.generateContent([
      `Look at this image and find any Australian vehicle number plate.
Return ONLY the plate number in uppercase with no spaces (e.g. ABC123 or EN23AB).
If you cannot clearly read a plate, return the word NULL.
Do not include any explanation.`,
      { inlineData: { data: imageBase64, mimeType } },
    ])

    const raw = result.response.text().trim().toUpperCase().replace(/\s+/g, '')
    if (!raw || raw === 'NULL' || raw.length < 3 || raw.length > 8) return null
    return raw
  } catch (err: any) {
    console.error('Gemini Vision error:', err.message)
    return null
  }
}

function calcWeeks(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime()
  return Math.max(1, Math.ceil(ms / (7 * 86400000)))
}

// ── Handle vehicle return ──────────────────────────────────
async function handleReturn(org: IOrganization, plate: string, from: string): Promise<string> {
  const vehicle = await Vehicle.findOne({ plate, orgId: org._id }).populate(scopedPopulate('currentRenter'))
  if (!vehicle) return `❌ Plate *${plate}* not found in fleet.`
  if (vehicle.status !== 'rented' || !vehicle.currentRenter) {
    return `ℹ️ *${plate}* is not currently rented out.`
  }

  const renter = await Renter.findOne({ _id: (vehicle.currentRenter as any)._id, orgId: org._id })
  if (!renter) return `❌ Could not find renter details for *${plate}*.`

  const endDate = new Date()
  const startDate = vehicle.rentStartDate || renter.rentStartDate || new Date()
  const weeklyRate = renter.weeklyRate || renter.payway?.weeklyAmount || 0
  const totalWeeks = calcWeeks(startDate, endDate)
  const totalAmount = weeklyRate * totalWeeks

  pendingReturns.set(sessionKey(org._id, from), {
    plate,
    renterId: renter._id.toString(),
    renterName: renter.name,
    renterPhone: renter.phone,
    vehicleModel: (vehicle as any).model || 'Vehicle',
    startDate,
    endDate,
    weeklyRate,
    totalWeeks,
    totalAmount,
    expiresAt: Date.now() + 10 * 60 * 1000,
  })

  const fmt = (d: Date) => d.toLocaleDateString('en-AU')

  return `🛵 *RETURN CONFIRMATION*
─────────────────────
Plate: *${plate}*
Model: ${(vehicle as any).model || 'Vehicle'}
Renter: *${renter.name}*
Phone: ${renter.phone}
─────────────────────
Start: ${fmt(startDate)}
End: ${fmt(endDate)}
Weeks: ${totalWeeks}
Rate: $${weeklyRate}/week
Total: *$${totalAmount.toFixed(2)}*
─────────────────────
Reply *CONFIRM* or *EDIT*`
}

// ── Execute confirmed return ───────────────────────────────
async function executeReturn(org: IOrganization, from: string): Promise<string> {
  const key = sessionKey(org._id, from)
  const pending = pendingReturns.get(key)
  if (!pending || Date.now() > pending.expiresAt) {
    pendingReturns.delete(key)
    return '⚠️ Confirmation expired. Please send the vehicle photo again.'
  }

  const vehicle = await Vehicle.findOne({ plate: pending.plate, orgId: org._id })
  if (!vehicle) {
    pendingReturns.delete(key)
    return `❌ Vehicle ${pending.plate} not found.`
  }

  const renter = await Renter.findOne({ _id: pending.renterId, orgId: org._id })
  if (!renter) {
    pendingReturns.delete(key)
    return '❌ Renter not found.'
  }

  renter.rentalHistory.push({
    vehicle: vehicle._id as any,
    plate: pending.plate,
    startDate: pending.startDate,
    endDate: pending.endDate,
    weeklyRate: pending.weeklyRate,
    totalWeeks: pending.totalWeeks,
    totalAmount: pending.totalAmount,
  })
  renter.currentVehicle = undefined
  renter.rentStartDate = undefined
  await renter.save()

  vehicle.status = 'available'
  vehicle.currentRenter = undefined
  vehicle.rentStartDate = undefined
  await vehicle.save()

  await Notification.create({
    orgId: org._id,
    type: 'info',
    title: `Vehicle returned — ${pending.plate}`,
    description: `${pending.renterName} returned ${pending.plate}. ${pending.totalWeeks} weeks @ $${pending.weeklyRate}/wk = $${pending.totalAmount.toFixed(2)}`,
    plate: pending.plate,
    actionRequired: false,
  })

  pendingReturns.delete(key)

  pendingDebitStops.set(key, {
    plate: pending.plate,
    renterPhone: pending.renterPhone,
    renterName: pending.renterName,
    expiresAt: Date.now() + 10 * 60 * 1000,
  })

  const availableCount = await Vehicle.countDocuments({ orgId: org._id, status: 'available' })

  return `✅ *${pending.plate}* marked *available*.
${pending.renterName} return confirmed. You now have *${availableCount}* vehicle${availableCount !== 1 ? 's' : ''} ready.

─────────────────────
Stop auto-debit for *${pending.renterName}*?
Reply *YES* or *NO*`
}

// ── Handle debit stop response ─────────────────────────────
async function handleDebitStopResponse(org: IOrganization, from: string, answer: 'yes' | 'no'): Promise<string> {
  const key = sessionKey(org._id, from)
  const pending = pendingDebitStops.get(key)
  if (!pending || Date.now() > pending.expiresAt) {
    pendingDebitStops.delete(key)
    return '⚠️ Session expired.'
  }

  pendingDebitStops.delete(key)

  if (answer === 'no') {
    return `ℹ️ Auto-debit for *${pending.renterName}* left active.`
  }

  const renter = await Renter.findOne({ phone: pending.renterPhone, orgId: org._id })
  if (!renter) {
    return `❌ Could not find renter ${pending.renterName} to pause debit.`
  }

  if (renter.payway?.customerId && renter.payway.status === 'active') {
    await pauseDebit(paywayCredsFor(org), renter.payway.customerId, renter.payway.weeklyAmount || 10)
    renter.payway.status = 'paused'
    await renter.save()

    await Notification.create({
      orgId: org._id,
      type: 'info',
      title: `Auto-debit paused — ${renter.name}`,
      description: `Auto-debit paused for ${renter.name} after vehicle return (${pending.plate})`,
      actionRequired: false,
    })

    return `✅ Auto-debit *paused* for *${renter.name}*.\nYou can resume it anytime from the FleetAI dashboard.`
  }

  if (renter.payway) {
    renter.payway.status = 'paused'
    await renter.save()
  }

  return `✅ Auto-debit marked as *paused* for *${renter.name}*.`
}

// ── Execute other intents ──────────────────────────────────
async function executeIntent(
  org: IOrganization,
  intent: Intent,
  plate: string,
  messageText: string
): Promise<string> {
  const vehicle = await Vehicle.findOne({ plate, orgId: org._id })
    .populate(scopedPopulate('currentRenter', 'name phone'))
    .populate(scopedPopulate('fines'))

  if (!vehicle) return `❌ Plate *${plate}* not found in fleet.`

  const modelName = (vehicle as any).model ?? 'Vehicle'
  const renterName = vehicle.currentRenter && typeof vehicle.currentRenter === 'object'
    ? (vehicle.currentRenter as any).name
    : null

  switch (intent) {
    case 'service_in': {
      vehicle.status = 'service'
      await vehicle.save()

      await Notification.create({
        orgId: org._id,
        type: 'info',
        title: `Vehicle in for service — ${plate}`,
        description: `${modelName} ${plate} sent to service. Message: "${messageText}"`,
        plate,
        actionRequired: false,
      })

      return `🔧 *${plate}* (${modelName}) marked *in service*.\nRemember to update when it is ready.`
    }

    case 'service_done': {
      vehicle.status = 'available'
      vehicle.lastService = new Date()
      await vehicle.save()

      const availableCount = await Vehicle.countDocuments({ orgId: org._id, status: 'available' })

      await Notification.create({
        orgId: org._id,
        type: 'info',
        title: `Service complete — ${plate}`,
        description: `${modelName} ${plate} back from service and marked available.`,
        plate,
        actionRequired: false,
      })

      return `✅ *${plate}* service complete — marked *available*.\nYou now have *${availableCount}* vehicle${availableCount !== 1 ? 's' : ''} ready.`
    }

    case 'damage': {
      await Notification.create({
        orgId: org._id,
        type: 'info',
        title: `Damage reported — ${plate}`,
        description: `Damage report for ${plate}: "${messageText}"${renterName ? ` (renter: ${renterName})` : ''}`,
        plate,
        actionRequired: true,
      })

      return `📋 Damage report for *${plate}* logged. Owner has been notified.\n${renterName ? `${renterName}, p` : 'P'}lease do not ride until inspected.`
    }

    case 'inquiry': {
      const unpaid = (vehicle.fines as any[]).filter((f: any) => !f.paid).length
      const regoDate = vehicle.regoExpiry
        ? new Date(vehicle.regoExpiry).toLocaleDateString('en-AU')
        : 'not set'
      const regoExpired = vehicle.regoExpiry && new Date(vehicle.regoExpiry) < new Date()

      return (
        `ℹ️ *${plate}* — ${modelName} ${vehicle.year}\n` +
        `Status: *${vehicle.status}*\n` +
        `Rego: ${regoDate}${regoExpired ? ' ⚠️ EXPIRED' : ''}\n` +
        `Unpaid fines: ${unpaid > 0 ? `*${unpaid}*` : 'none'}\n` +
        (renterName ? `Current renter: ${renterName}` : '')
      )
    }

    default:
      return `ℹ️ Got your message about *${plate}*. Owner will follow up shortly.`
  }
}

// ── POST /api/whatsapp/incoming ────────────────────────────
router.post('/incoming', async (req: Request, res: Response) => {
  // Acknowledge immediately — providers expect a fast 200.
  res.sendStatus(200)

  const inbound = parseInbound(req.body)
  if (!inbound || !inbound.from) return

  // The tenant is the owner of the number that RECEIVED the message. It is never taken
  // from the sender, who is an untrusted third party.
  const org = await resolveTenant(inbound)
  if (!org) {
    console.warn('⚠️  WhatsApp message for an unrecognised business number — ignoring')
    return
  }
  if (org.status !== 'approved' || !whatsappActiveFor(org)) {
    console.warn(`⚠️  WhatsApp message for ${org.email} but the integration is not active`)
    return
  }

  const { from, text: messageText } = inbound
  console.log(`📱 WhatsApp [${org.slug || org.email}] from ${from}: "${messageText}"`)

  try {
    const key = sessionKey(org._id, from)
    const intent = detectIntent(messageText)

    if (intent === 'confirm' && pendingReturns.has(key)) {
      return void await replyQuietly(org, from, await executeReturn(org, from))
    }

    if (intent === 'yes' && pendingDebitStops.has(key)) {
      return void await replyQuietly(org, from, await handleDebitStopResponse(org, from, 'yes'))
    }

    if (intent === 'no' && pendingDebitStops.has(key)) {
      return void await replyQuietly(org, from, await handleDebitStopResponse(org, from, 'no'))
    }

    if (intent === 'edit' && pendingReturns.has(key)) {
      pendingReturns.delete(key)
      return void await replyQuietly(org, from, '✏️ Return cancelled. Please re-send the vehicle photo to start again.')
    }

    let plate: string | null = null
    if (inbound.mediaId || inbound.mediaUrl) {
      plate = await readPlateFromImage(org, inbound)
      if (plate) console.log(`📷 Gemini Vision detected plate: ${plate}`)
    }
    if (!plate) {
      plate = extractPlateFromText(messageText)
    }

    let reply: string
    if (!plate) {
      reply = (inbound.mediaId || inbound.mediaUrl)
        ? 'Could not read the plate from that photo. Make sure the plate is clear and well-lit, or type the plate number.'
        : '👋 Send me a photo of the vehicle plate or type the plate + what happened.\n\nExamples:\n• *EN23AB returned*\n• *HK26GH service in*\n• *GT25EF damage* (with photo)'
    } else if (intent === 'returned') {
      reply = await handleReturn(org, plate, from)
    } else {
      reply = await executeIntent(org, intent, plate, messageText)
    }

    await replyQuietly(org, from, reply)
  } catch (err: any) {
    console.error('WhatsApp processing error:', err.message)
    await replyQuietly(org, from, '⚠️ Something went wrong. Please contact the owner directly.')
  }
})

export default router
