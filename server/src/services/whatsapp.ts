import { Router, Request, Response } from 'express'
import axios from 'axios'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Vehicle from '../models/Vehicle'
import Renter from '../models/Renter'
import Notification from '../models/Notification'
import { pauseDebit } from './payway'

const router = Router()

// ── Pending confirmations (in-memory) ─────────────────────
// Stores return confirmations waiting for owner CONFIRM/EDIT
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

const pendingReturns = new Map<string, PendingReturn>()

// Stores pending debit-stop waiting for YES/NO
interface PendingDebitStop {
  plate: string
  renterPhone: string
  renterName: string
  expiresAt: number
}

const pendingDebitStops = new Map<string, PendingDebitStop>()

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

// ── Extract plate from text ────────────────────────────────
function extractPlateFromText(text: string): string | null {
  const match = text.match(/\b([A-Z]{1,3}[0-9]{1,4}[A-Z]{0,3}|[0-9]{1,4}[A-Z]{2,3})\b/i)
  return match ? match[1].toUpperCase().replace(/\s+/g, '') : null
}

// ── Gemini Vision: read plate from image ──────────────────
async function readPlateFromImage(imageUrl: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || apiKey === 'your_key_here') return null

  try {
    const imgRes = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
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

// ── Send WhatsApp reply ────────────────────────────────────
async function sendWhatsAppReply(to: string, body: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID

  if (!token || !phoneId) {
    console.warn('⚠️  Meta WhatsApp not configured')
    return
  }

  // Convert "whatsapp:+61..." format to just "61..."
  const cleanTo = to.replace('whatsapp:', '').replace('+', '')

  await axios.post(
    `https://graph.facebook.com/v22.0/${phoneId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'text',
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  )
}

// ── Calculate weeks between two dates ─────────────────────
function calcWeeks(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime()
  return Math.max(1, Math.ceil(ms / (7 * 86400000)))
}

// ── Handle scooter return ──────────────────────────────────
async function handleReturn(plate: string, from: string, messageText: string): Promise<string> {
  const vehicle = await Vehicle.findOne({ plate })
    .populate('currentRenter')

  if (!vehicle) {
    return `❌ Plate *${plate}* not found in fleet.`
  }

  if (vehicle.status !== 'rented' || !vehicle.currentRenter) {
    return `ℹ️ *${plate}* is not currently rented out.`
  }

  const renter = await Renter.findById((vehicle.currentRenter as any)._id)
  if (!renter) {
    return `❌ Could not find renter details for *${plate}*.`
  }

  const endDate = new Date()
  const startDate = vehicle.rentStartDate || renter.rentStartDate || new Date()
  const weeklyRate = renter.weeklyRate || renter.payway?.weeklyAmount || 0
  const totalWeeks = calcWeeks(startDate, endDate)
  const totalAmount = weeklyRate * totalWeeks

  // Store pending confirmation
  const pending: PendingReturn = {
    plate,
    renterId: renter._id.toString(),
    renterName: renter.name,
    renterPhone: renter.phone,
    vehicleModel: (vehicle as any).model || 'Honda Duo',
    startDate,
    endDate,
    weeklyRate,
    totalWeeks,
    totalAmount,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min expiry
  }
  pendingReturns.set(from, pending)

  const fmt = (d: Date) => d.toLocaleDateString('en-AU')

  return `🛵 *RETURN CONFIRMATION*
─────────────────────
Plate: *${plate}*
Model: ${pending.vehicleModel}
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
async function executeReturn(from: string): Promise<string> {
  const pending = pendingReturns.get(from)
  if (!pending || Date.now() > pending.expiresAt) {
    pendingReturns.delete(from)
    return '⚠️ Confirmation expired. Please send the scooter photo again.'
  }

  const vehicle = await Vehicle.findOne({ plate: pending.plate })
  if (!vehicle) {
    pendingReturns.delete(from)
    return `❌ Vehicle ${pending.plate} not found.`
  }

  const renter = await Renter.findById(pending.renterId)
  if (!renter) {
    pendingReturns.delete(from)
    return `❌ Renter not found.`
  }

  // Save rental history to renter profile
  renter.rentalHistory.push({
    vehicle: vehicle._id as any,
    plate: pending.plate,
    startDate: pending.startDate,
    endDate: pending.endDate,
    weeklyRate: pending.weeklyRate,
    totalWeeks: pending.totalWeeks,
    totalAmount: pending.totalAmount,
  })

  // Clear current rental from renter
  renter.currentVehicle = undefined
  renter.rentStartDate = undefined
  await renter.save()

  // Mark vehicle available
  vehicle.status = 'available'
  vehicle.currentRenter = undefined
  vehicle.rentStartDate = undefined
  await vehicle.save()

  // Create notification in dashboard
  await Notification.create({
    type: 'info',
    title: `Scooter returned — ${pending.plate}`,
    description: `${pending.renterName} returned ${pending.plate}. ${pending.totalWeeks} weeks @ $${pending.weeklyRate}/wk = $${pending.totalAmount.toFixed(2)}`,
    plate: pending.plate,
    actionRequired: false,
  })

  pendingReturns.delete(from)

  // Store pending debit stop question
  const debitPending: PendingDebitStop = {
    plate: pending.plate,
    renterPhone: pending.renterPhone,
    renterName: pending.renterName,
    expiresAt: Date.now() + 10 * 60 * 1000,
  }
  pendingDebitStops.set(from, debitPending)

  const availableCount = await Vehicle.countDocuments({ status: 'available' })

  return `✅ *${pending.plate}* marked *available*.
${pending.renterName} return confirmed. You now have *${availableCount}* vehicle${availableCount !== 1 ? 's' : ''} ready.

─────────────────────
Stop auto-debit for *${pending.renterName}*?
Reply *YES* or *NO*`
}

// ── Handle debit stop response ─────────────────────────────
async function handleDebitStopResponse(from: string, answer: 'yes' | 'no'): Promise<string> {
  const pending = pendingDebitStops.get(from)
  if (!pending || Date.now() > pending.expiresAt) {
    pendingDebitStops.delete(from)
    return '⚠️ Session expired.'
  }

  pendingDebitStops.delete(from)

  if (answer === 'no') {
    return `ℹ️ Auto-debit for *${pending.renterName}* left active.`
  }

  // Find renter and pause debit
  const renter = await Renter.findOne({ phone: pending.renterPhone })
  if (!renter) {
    return `❌ Could not find renter ${pending.renterName} to pause debit.`
  }

  if (renter.payway?.customerId && renter.payway.status === 'active') {
    await pauseDebit(renter.payway.customerId)
    renter.payway.status = 'paused'
    await renter.save()

    await Notification.create({
      type: 'info',
      title: `Auto-debit paused — ${renter.name}`,
      description: `Auto-debit paused for ${renter.name} after scooter return (${pending.plate})`,
      actionRequired: false,
    })

    return `✅ Auto-debit *paused* for *${renter.name}*.\nYou can resume it anytime from the FleetAI dashboard.`
  }

  // PayWay not setup yet — just update status
  if (renter.payway) {
    renter.payway.status = 'paused'
    await renter.save()
  }

  return `✅ Auto-debit marked as *paused* for *${renter.name}*.`
}

// ── Execute other intents ──────────────────────────────────
async function executeIntent(
  intent: Intent,
  plate: string,
  messageText: string,
  from: string
): Promise<string> {
  const vehicle = await Vehicle.findOne({ plate })
    .populate('currentRenter', 'name phone')
    .populate('fines')

  if (!vehicle) {
    return `❌ Plate *${plate}* not found in fleet.`
  }

  const modelName = (vehicle as any).model ?? 'Vehicle'
  const renterName = vehicle.currentRenter && typeof vehicle.currentRenter === 'object'
    ? (vehicle.currentRenter as any).name
    : null

  switch (intent) {
    case 'service_in': {
      vehicle.status = 'service'
      await vehicle.save()

      await Notification.create({
        type: 'info',
        title: `Vehicle in for service — ${plate}`,
        description: `${modelName} ${plate} sent to service. Message: "${messageText}"`,
        plate,
        actionRequired: false,
      })

      return `🔧 *${plate}* (${modelName}) marked *in service*.\nRemember to update when it's ready.`
    }

    case 'service_done': {
      vehicle.status = 'available'
      vehicle.lastService = new Date()
      await vehicle.save()

      const availableCount = await Vehicle.countDocuments({ status: 'available' })

      await Notification.create({
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
        type: 'info',
        title: `Damage reported — ${plate}`,
        description: `Damage report for ${plate}: "${messageText}"${renterName ? ` (renter: ${renterName})` : ''}`,
        plate,
        actionRequired: true,
      })

      return `📋 Damage report for *${plate}* logged. Owner has been notified.\n${renterName ? `${renterName}, p` : 'P'}lease don't ride until inspected.`
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
  // Meta sends a hub verification token — validate it
  const metaToken = req.headers['x-hub-signature-256']
  if (process.env.NODE_ENV === 'production' && !metaToken) {
    console.warn('⚠️  Missing Meta signature')
  }

  // Respond immediately — Twilio requires fast response
  res.sendStatus(200)
 

  const body = req.body as Record<string, string>
  const messageText = (body.Body ?? '').trim()
  const from = body.From ?? ''
  const numMedia = parseInt(body.NumMedia ?? '0', 10)

  console.log(`📱 WhatsApp from ${from}: "${messageText}" (${numMedia} media)`)

  try {
    const intent = detectIntent(messageText)

    // ── Handle CONFIRM reply ──
    if (intent === 'confirm') {
      if (pendingReturns.has(from)) {
        const reply = await executeReturn(from)
        await sendWhatsAppReply(from, reply)
        return
      }
    }

    // ── Handle YES/NO for debit stop ──
    if (intent === 'yes' && pendingDebitStops.has(from)) {
      const reply = await handleDebitStopResponse(from, 'yes')
      await sendWhatsAppReply(from, reply)
      return
    }

    if (intent === 'no' && pendingDebitStops.has(from)) {
      const reply = await handleDebitStopResponse(from, 'no')
      await sendWhatsAppReply(from, reply)
      return
    }

    // ── Handle EDIT reply ──
    if (intent === 'edit' && pendingReturns.has(from)) {
      pendingReturns.delete(from)
      await sendWhatsAppReply(from, '✏️ Return cancelled. Please re-send the scooter photo to start again.')
      return
    }

    // ── Normal message flow ──
    let plate: string | null = null

    // Try image first
    if (numMedia > 0 && body.MediaUrl0) {
      console.log(`🔍 Analysing image from ${from}...`)
      plate = await readPlateFromImage(body.MediaUrl0)
      if (plate) console.log(`📷 Gemini Vision detected plate: ${plate}`)
    }

    // Fallback to text
    if (!plate) {
      plate = extractPlateFromText(messageText)
      if (plate) console.log(`📝 Plate from text: ${plate}`)
    }

    let reply: string

    if (!plate) {
      if (numMedia > 0) {
        reply = '🤔 Couldn\'t read the plate from that photo. Make sure the plate is clear and well-lit, or type the plate number.'
      } else {
        reply = '👋 Send me a photo of the scooter plate or type the plate + what happened.\n\nExamples:\n• *EN23AB returned*\n• *HK26GH service in*\n• *GT25EF damage* (with photo)'
      }
    } else if (intent === 'returned') {
      reply = await handleReturn(plate, from, messageText)
    } else {
      reply = await executeIntent(intent, plate, messageText, from)
    }

    await sendWhatsAppReply(from, reply)
    console.log(`💬 Replied to ${from}: ${reply.slice(0, 80)}...`)

  } catch (err: any) {
    console.error('WhatsApp processing error:', err.message)
    try {
      await sendWhatsAppReply(from, '⚠️ Something went wrong. Please contact the owner directly.')
    } catch {}
  }
})

export default router
