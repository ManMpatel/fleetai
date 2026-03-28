/**
 * WhatsApp Service — Twilio webhook handler
 *
 * Incoming messages from renters → Gemini Vision reads plate from photos
 * → Intent detected from text → Vehicle status updated in MongoDB
 * → Confirmation reply sent back via Twilio WhatsApp
 *
 * Webhook URL to configure in Twilio console:
 *   POST https://your-server.com/api/whatsapp/incoming
 */

import { Router, Request, Response } from 'express'
import twilio from 'twilio'
import axios from 'axios'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Vehicle from '../models/Vehicle'
import Notification from '../models/Notification'

const router = Router()

// ── Intent categories ──────────────────────────────────────
type Intent = 'returned' | 'service_in' | 'service_done' | 'damage' | 'inquiry' | 'unknown'

const INTENT_PATTERNS: Record<Intent, RegExp> = {
  returned: /\b(return(ed)?|back|done|finished|drop(ped)? off|brought back|all good|handing? (back|in))\b/i,
  service_in: /\b(service\s*in|going\s*(in|to)\s*(service|garage|mechanic)|sending\s*(for\s*)?service|workshop|repair\s*in|dropping\s*(off\s*)?for\s*service)\b/i,
  service_done: /\b(service\s*(done|complete|finished|out|back)|picked\s*up|ready|fixed|out\s*of\s*service|mechanic\s*done)\b/i,
  damage: /\b(damage(d)?|scratch(ed)?|dent(ed)?|accident|hit|broken|crack(ed)?|smash(ed)?|bang(ed)?|mirror|tyre)\b/i,
  inquiry: /\b(where|which|how\s*many|status|check|info|available|rego|fine|toll)\b/i,
  unknown: /.*/,
}

function detectIntent(text: string): Intent {
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS) as [Intent, RegExp][]) {
    if (intent === 'unknown') continue
    if (pattern.test(text)) return intent
  }
  return 'unknown'
}

// ── Extract plate from text (Australian format) ────────────
function extractPlateFromText(text: string): string | null {
  // Matches NSW/VIC/QLD style: 2-3 letters + 2-3 digits, or 1-3 letters + 2-4 digits + letters
  const match = text.match(/\b([A-Z]{1,3}[0-9]{1,4}[A-Z]{0,3}|[0-9]{1,4}[A-Z]{2,3})\b/i)
  return match ? match[1].toUpperCase().replace(/\s+/g, '') : null
}

// ── Gemini Vision: read plate from image ──────────────────
async function readPlateFromImage(imageUrl: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || apiKey === 'your_key_here') return null

  try {
    // Download image from Twilio (requires Basic Auth)
    const imgRes = await axios.get<ArrayBuffer>(imageUrl, {
      auth: {
        username: process.env.TWILIO_SID!,
        password: process.env.TWILIO_TOKEN!,
      },
      responseType: 'arraybuffer',
      timeout: 15000,
    })

    const mimeType = (imgRes.headers['content-type'] as string) || 'image/jpeg'
    const imageBase64 = Buffer.from(imgRes.data).toString('base64')

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const result = await model.generateContent([
      `Look at this image and find any Australian vehicle number plate (registration plate).
Return ONLY the plate number in uppercase with no spaces (e.g. ABC123 or EN23AB).
If you cannot clearly read a plate, return the word NULL.
Do not include any explanation, just the plate number or NULL.`,
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

// ── Send WhatsApp reply via Twilio REST ───────────────────
async function sendWhatsAppReply(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_SID
  const token = process.env.TWILIO_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM

  if (!sid || !token || !from) {
    console.warn('⚠️  Twilio credentials not set — cannot send WhatsApp reply')
    return
  }

  const client = twilio(sid, token)
  await client.messages.create({ from, to, body })
}

// ── Build TwiML "empty" response (we reply async via REST) ─
function emptyTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
}

// ── Execute intent on vehicle ──────────────────────────────
async function executeIntent(
  intent: Intent,
  plate: string,
  messageText: string,
  from: string
): Promise<string> {
  const vehicle = await Vehicle.findOne({ plate })
    .populate('currentRenter', 'name')
    .populate('fines')

  if (!vehicle) {
    return `❌ Plate *${plate}* not found in fleet. Please check and resend.`
  }

  const modelName = (vehicle as any).model ?? 'Vehicle'
  const renterName =
    vehicle.currentRenter && typeof vehicle.currentRenter === 'object'
      ? (vehicle.currentRenter as any).name
      : null

  switch (intent) {
    case 'returned': {
      vehicle.status = 'available'
      vehicle.currentRenter = undefined
      vehicle.rentStartDate = undefined
      await vehicle.save()

      const availableCount = await Vehicle.countDocuments({ status: 'available' })

      await Notification.create({
        type: 'info',
        title: `Vehicle returned — ${plate}`,
        description: `${modelName} ${plate} marked available. ${renterName ? `Returned by ${renterName}.` : ''} Message: "${messageText}"`,
        plate,
        actionRequired: false,
      })

      return `✅ *${plate}* (${modelName}) marked *available*.\n${renterName ? `Thanks ${renterName}! ` : ''}You now have *${availableCount}* scooter${availableCount !== 1 ? 's' : ''} ready to rent.`
    }

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

      return `✅ *${plate}* (${modelName}) service complete — marked *available*.\nYou now have *${availableCount}* vehicle${availableCount !== 1 ? 's' : ''} ready.`
    }

    case 'damage': {
      await Notification.create({
        type: 'info',
        title: `Damage reported — ${plate}`,
        description: `Damage report for ${plate}: "${messageText}"${renterName ? ` (renter: ${renterName})` : ''}`,
        plate,
        actionRequired: true,
      })

      return `📋 Damage report for *${plate}* logged. The owner has been notified.\n${renterName ? `${renterName}, p` : 'P'}lease don't ride until inspected.`
    }

    case 'inquiry': {
      const unpaid = (vehicle.fines as any[]).filter((f) => !f.paid).length
      const regoDate = vehicle.regoExpiry
        ? vehicle.regoExpiry.toLocaleDateString('en-AU')
        : 'not set'
      const regoExpired = vehicle.regoExpiry && vehicle.regoExpiry < new Date()

      return (
        `ℹ️ *${plate}* — ${modelName} ${vehicle.year}\n` +
        `Status: *${vehicle.status}*\n` +
        `Rego: ${regoDate}${regoExpired ? ' ⚠️ EXPIRED' : ''}\n` +
        `Unpaid fines: ${unpaid > 0 ? `*${unpaid}*` : 'none'}\n` +
        (renterName ? `Current renter: ${renterName}` : '')
      )
    }

    default:
      return `ℹ️ Got your message about *${plate}*. The owner will follow up shortly.`
  }
}

// ── POST /api/whatsapp/incoming ────────────────────────────
router.post('/incoming', async (req: Request, res: Response) => {
  // Validate Twilio signature in production
  if (process.env.NODE_ENV === 'production' && process.env.TWILIO_TOKEN) {
    const signature = req.headers['x-twilio-signature'] as string
    const url = `${req.protocol}://${req.get('host')}/api/whatsapp/incoming`
    const isValid = twilio.validateRequest(process.env.TWILIO_TOKEN, signature, url, req.body)
    if (!isValid) {
      console.warn('⚠️  Invalid Twilio signature — rejecting webhook')
      return res.status(403).send('Forbidden')
    }
  }

  // Respond immediately with empty TwiML — Twilio requires fast response
  res.set('Content-Type', 'text/xml')
  res.send(emptyTwiml())

  // Process asynchronously
  const body = req.body as Record<string, string>
  const messageText = (body.Body ?? '').trim()
  const from = body.From ?? ''
  const numMedia = parseInt(body.NumMedia ?? '0', 10)

  console.log(`📱 WhatsApp from ${from}: "${messageText}" (${numMedia} media)`)

  try {
    let plate: string | null = null

    // 1. Try to get plate from image (Gemini Vision)
    if (numMedia > 0 && body.MediaUrl0) {
      console.log(`🔍 Analysing image from ${from}...`)
      plate = await readPlateFromImage(body.MediaUrl0)
      if (plate) console.log(`📷 Gemini Vision detected plate: ${plate}`)
    }

    // 2. Fallback: extract plate from message text
    if (!plate) {
      plate = extractPlateFromText(messageText)
      if (plate) console.log(`📝 Plate from text: ${plate}`)
    }

    // 3. Detect intent
    const intent = detectIntent(messageText)
    console.log(`🎯 Intent: ${intent} | Plate: ${plate ?? 'none'}`)

    let reply: string

    if (!plate) {
      if (numMedia > 0) {
        reply =
          '🤔 I couldn\'t read the plate from that photo. Please make sure the plate is clear and well-lit, or type the plate number.'
      } else {
        reply =
          '👋 Hi! Send me a photo of the scooter plate or type the plate number + what happened.\n\nExamples:\n• *EN23AB returned*\n• *HK26GH service in*\n• *GT25EF damage* (with photo)'
      }
    } else {
      reply = await executeIntent(intent, plate, messageText, from)
    }

    // 4. Send reply
    await sendWhatsAppReply(from, reply)
    console.log(`💬 Replied to ${from}: ${reply.slice(0, 80)}...`)
  } catch (err: any) {
    console.error('WhatsApp processing error:', err.message)
    // Best-effort error reply
    try {
      await sendWhatsAppReply(
        from,
        '⚠️ Something went wrong processing your message. Please contact the owner directly.'
      )
    } catch {}
  }
})

export default router
