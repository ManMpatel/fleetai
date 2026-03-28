/**
 * Gmail Service — reads unread emails, extracts PDF attachments,
 * uses Gemini to detect fines/tolls, and creates MongoDB records.
 *
 * Authentication: Google OAuth2
 * Required .env vars:
 *   GMAIL_CLIENT_ID       — from Google Cloud Console
 *   GMAIL_CLIENT_SECRET   — from Google Cloud Console
 *   GMAIL_REFRESH_TOKEN   — generated via OAuth2 playground
 *   GEMINI_API_KEY        — Gemini API key
 *
 * To get your OAuth2 tokens:
 *   1. Go to https://console.cloud.google.com → APIs & Services → Credentials
 *   2. Create an OAuth2 client (Desktop app type)
 *   3. Go to https://developers.google.com/oauthplayground
 *   4. Authorize scope: https://www.googleapis.com/auth/gmail.modify
 *   5. Exchange auth code for tokens → copy Refresh Token
 */

import { google } from 'googleapis'
import { GoogleGenerativeAI } from '@google/generative-ai'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>
import Fine from '../models/Fine'
import Vehicle from '../models/Vehicle'
import Notification from '../models/Notification'
import Renter from '../models/Renter'

// ── OAuth2 client ──────────────────────────────────────────
function createOAuth2Client() {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  )
  client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN })
  return client
}

function isConfigured(): boolean {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN &&
    process.env.GMAIL_CLIENT_ID !== 'your_client_id_here'
  )
}

// ── Main entry — called by cron every 2 minutes ────────────
export async function checkGmailForFines(): Promise<void> {
  if (!isConfigured()) {
    console.log('⚠️  Gmail OAuth2 not configured — skipping email check')
    return
  }
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_key_here') {
    console.log('⚠️  Gemini API key not set — skipping Gmail PDF analysis')
    return
  }

  try {
    const auth = createOAuth2Client()
    const gmail = google.gmail({ version: 'v1', auth })

    // Fetch unread emails that have attachments
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread has:attachment (fine OR toll OR infringement OR penalty OR "Service NSW" OR "Revenue NSW" OR "Transurban" OR "Linkt")',
      maxResults: 20,
    })

    const messages = listRes.data.messages ?? []
    if (messages.length === 0) {
      console.log('📭 No new fine/toll emails')
      return
    }

    console.log(`📬 Found ${messages.length} unread email(s) to process`)

    for (const msg of messages) {
      try {
        await processEmail(gmail, msg.id!)
      } catch (err: any) {
        console.error(`❌ Error processing email ${msg.id}:`, err.message)
      }
    }
  } catch (err: any) {
    if (err.message?.includes('invalid_grant')) {
      console.error('❌ Gmail OAuth2 token invalid — please refresh GMAIL_REFRESH_TOKEN in .env')
    } else {
      console.error('❌ Gmail check error:', err.message)
    }
  }
}

// ── Process a single email ─────────────────────────────────
async function processEmail(gmail: any, messageId: string): Promise<void> {
  const msgRes = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  })

  const payload = msgRes.data.payload
  const parts = getAllParts(payload)
  let processed = false

  for (const part of parts) {
    const mime = part.mimeType ?? ''
    const filename = (part.filename ?? '').toLowerCase()

    // Accept PDFs and images
    const isPdf = mime === 'application/pdf' || filename.endsWith('.pdf')
    const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png)$/.test(filename)

    if (!isPdf && !isImage) continue

    let dataB64: string | undefined

    if (part.body?.data) {
      dataB64 = part.body.data
    } else if (part.body?.attachmentId) {
      const attRes = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.body.attachmentId,
      })
      dataB64 = attRes.data.data
    }

    if (!dataB64) continue

    const buffer = Buffer.from(dataB64, 'base64url') // Gmail uses URL-safe base64

    if (isPdf) {
      const extracted = await extractTextFromPdf(buffer)
      if (extracted) {
        await analyzeFineDocument(extracted, mime, null, messageId)
        processed = true
      }
    } else if (isImage) {
      await analyzeFineDocument(null, mime, buffer.toString('base64'), messageId)
      processed = true
    }
  }

  // Mark email as read after processing
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  })

  if (processed) {
    console.log(`✅ Processed email ${messageId}`)
  }
}

// ── Recursively flatten MIME parts ────────────────────────
function getAllParts(payload: any): any[] {
  if (!payload) return []
  const parts: any[] = []
  if (payload.body?.data || payload.body?.attachmentId) {
    parts.push(payload)
  }
  for (const part of payload.parts ?? []) {
    parts.push(...getAllParts(part))
  }
  return parts
}

// ── Extract text from a PDF buffer ────────────────────────
async function extractTextFromPdf(buffer: Buffer): Promise<string | null> {
  try {
    const data = await pdfParse(buffer)
    return data.text?.trim() || null
  } catch {
    return null
  }
}

// ── Send document to Gemini and create records ─────────────
async function analyzeFineDocument(
  text: string | null,
  mimeType: string,
  imageBase64: string | null,
  emailId: string
): Promise<void> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

  const instruction = `Analyze this document and determine if it is an Australian traffic fine, toll notice, parking infringement, or penalty notice.

If it IS a fine/toll/infringement, extract these fields and return ONLY valid JSON:
{
  "isFine": true,
  "type": "fine" or "toll",
  "plate": "NSW plate number e.g. ABC123 — uppercase no spaces",
  "amount": 123.45,
  "description": "concise description e.g. Speed 15km/h over limit — M2 Motorway",
  "date": "YYYY-MM-DD"
}

If it is NOT a fine/toll, return exactly:
{"isFine": false}

Return ONLY valid JSON, no markdown, no explanation.`

  let parts: any[]
  if (imageBase64) {
    parts = [instruction, { inlineData: { data: imageBase64, mimeType } }]
  } else if (text) {
    parts = [`${instruction}\n\nDocument text:\n${text.slice(0, 4000)}`]
  } else {
    return
  }

  const result = await model.generateContent(parts)
  const raw = result.response.text().trim()

  // Strip markdown code fences if Gemini wraps in ```json
  const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  let parsed: any
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    console.warn('⚠️  Gemini returned non-JSON for email', emailId, ':', raw.slice(0, 200))
    return
  }

  if (!parsed.isFine) {
    console.log(`📧 Email ${emailId}: not a fine/toll — skipping`)
    return
  }

  const rawPlate = String(parsed.plate ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')

  if (!rawPlate) {
    console.warn('⚠️  Gemini found a fine but no plate in email', emailId)
    await Notification.create({
      type: parsed.type ?? 'fine',
      title: `${parsed.type === 'toll' ? 'Toll' : 'Fine'} detected — plate unreadable`,
      description: `$${parsed.amount ?? '?'} — ${parsed.description ?? 'See email'}. Could not match to fleet vehicle.`,
      actionRequired: true,
    })
    return
  }

  // Look up vehicle in fleet
  const vehicle = await Vehicle.findOne({ plate: rawPlate })

  if (!vehicle) {
    console.warn(`⚠️  Fine for ${rawPlate} — not in fleet`)
    await Notification.create({
      type: parsed.type ?? 'fine',
      title: `${parsed.type === 'toll' ? 'Toll' : 'Fine'} — ${rawPlate} (not in fleet)`,
      description: `$${parsed.amount} — ${parsed.description}. Plate ${rawPlate} not found in fleet.`,
      plate: rawPlate,
      actionRequired: true,
    })
    return
  }

  // Create fine record
  const fine = await Fine.create({
    vehicle: vehicle._id,
    type: parsed.type ?? 'fine',
    amount: Number(parsed.amount) || 0,
    description: parsed.description ?? 'Email attachment fine',
    date: parsed.date ? new Date(parsed.date) : new Date(),
    paid: false,
  })

  if (parsed.type === 'toll') {
    vehicle.tolls.push(fine._id as any)
  } else {
    vehicle.fines.push(fine._id as any)
  }
  await vehicle.save()

  // ── Find who was riding at fine date ──────────────────
  const fineDate = parsed.date ? new Date(parsed.date) : new Date()
  let riderInfo = ''

  try {
    // Check current renter first
    const currentRenter = await Renter.findOne({ currentVehicle: vehicle._id })
    if (currentRenter && currentRenter.rentStartDate && currentRenter.rentStartDate <= fineDate) {
      riderInfo = `Likely rider: ${currentRenter.name} (${currentRenter.phone})`
    } else {
      // Search rental history
      const historicalRenter = await Renter.findOne({
        'rentalHistory': {
          $elemMatch: {
            vehicle: vehicle._id,
            startDate: { $lte: fineDate },
            $or: [
              { endDate: { $gte: fineDate } },
              { endDate: null },
              { endDate: { $exists: false } },
            ],
          },
        },
      })
      if (historicalRenter) {
        riderInfo = `Likely rider: ${historicalRenter.name} (${historicalRenter.phone})`
      }
    }
  } catch (err) {
    console.warn('Could not find rider for fine:', err)
  }

  await Notification.create({
    type: parsed.type ?? 'fine',
    title: `New ${parsed.type === 'toll' ? 'toll' : 'fine'} — ${vehicle.plate}`,
    description: `$${Number(parsed.amount).toFixed(2)} — ${parsed.description}. Detected from email.${riderInfo ? ` ${riderInfo}.` : ''}`,
    plate: vehicle.plate,
    actionRequired: true,
  })

  console.log(`✅ Created ${parsed.type} $${parsed.amount} for ${vehicle.plate} (from email)${riderInfo ? ` | ${riderInfo}` : ''}`)
}