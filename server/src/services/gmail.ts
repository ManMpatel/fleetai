/**
 * Gmail Service — reads unread emails, extracts PDF attachments, uses Gemini to detect
 * fines/tolls, and creates MongoDB records.
 *
 * Each tenant connects their own mailbox: the OAuth client is platform-level (one Google
 * Cloud app), but the refresh token — which is what identifies the mailbox — is stored
 * per Organization and encrypted. A fine found in one tenant's mailbox can only ever be
 * matched against that tenant's vehicles.
 *
 * Platform .env vars:
 *   GMAIL_CLIENT_ID       — from Google Cloud Console
 *   GMAIL_CLIENT_SECRET   — from Google Cloud Console
 *   GEMINI_API_KEY        — Gemini API key
 *
 * Per tenant (set via PUT /api/settings/gmail):
 *   gmail.refreshTokenEnc — the operator's own Gmail refresh token
 */

import { google } from 'googleapis'
import { GoogleGenerativeAI } from '@google/generative-ai'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>
import Fine from '../models/Fine'
import Vehicle from '../models/Vehicle'
import Notification from '../models/Notification'
import Renter from '../models/Renter'
import Organization, { IOrganization } from '../models/Organization'
import { decrypt } from './encryption'

function createOAuth2Client(refreshToken: string) {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  )
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

function platformConfigured(): boolean {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_CLIENT_ID !== 'your_client_id_here'
  )
}

// ── Cron entry point — fans out across tenants ─────────────
export async function checkGmailForFines(): Promise<void> {
  if (!platformConfigured()) {
    console.log('⚠️  Gmail OAuth2 app not configured — skipping email check')
    return
  }
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_key_here') {
    console.log('⚠️  Gemini API key not set — skipping Gmail PDF analysis')
    return
  }

  const orgs = await Organization.find({
    status: 'approved',
    'gmail.enabled': true,
    'gmail.refreshTokenEnc': { $exists: true, $ne: null },
  })

  if (orgs.length === 0) {
    console.log('📭 No tenants have Gmail ingestion connected')
    return
  }

  for (const org of orgs) {
    try {
      await checkGmailForOrg(org)
    } catch (err: any) {
      console.error(`❌ Gmail check failed for ${org.email}:`, err.message)
    }
  }
}

async function checkGmailForOrg(org: IOrganization): Promise<void> {
  const refreshToken = decrypt(org.gmail!.refreshTokenEnc!)

  try {
    const auth = createOAuth2Client(refreshToken)
    const gmail = google.gmail({ version: 'v1', auth })

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread has:attachment (fine OR toll OR infringement OR penalty OR "Service NSW" OR "Revenue NSW" OR "Transurban" OR "Linkt")',
      maxResults: 20,
    })

    const messages = listRes.data.messages ?? []
    if (messages.length === 0) return

    console.log(`📬 [${org.slug || org.email}] ${messages.length} unread email(s) to process`)

    for (const msg of messages) {
      try {
        await processEmail(org, gmail, msg.id!)
      } catch (err: any) {
        console.error(`❌ Error processing email ${msg.id}:`, err.message)
      }
    }
  } catch (err: any) {
    if (err.message?.includes('invalid_grant')) {
      console.error(`❌ Gmail token invalid for ${org.email} — the operator must reconnect their mailbox`)
      await Organization.findByIdAndUpdate(org._id, { $set: { 'gmail.enabled': false } })
      await Notification.create({
        orgId: org._id,
        type: 'info',
        title: 'Gmail connection expired',
        description: 'Fine and toll email ingestion has been paused. Reconnect your mailbox in Settings.',
        actionRequired: true,
      })
    } else {
      throw err
    }
  }
}

// ── Process a single email ─────────────────────────────────
async function processEmail(org: IOrganization, gmail: any, messageId: string): Promise<void> {
  const msgRes = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })

  const parts = getAllParts(msgRes.data.payload)
  let processed = false

  for (const part of parts) {
    const mime = part.mimeType ?? ''
    const filename = (part.filename ?? '').toLowerCase()

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
        await analyzeFineDocument(org, extracted, mime, null, messageId)
        processed = true
      }
    } else {
      await analyzeFineDocument(org, null, mime, buffer.toString('base64'), messageId)
      processed = true
    }
  }

  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  })

  if (processed) console.log(`✅ Processed email ${messageId}`)
}

function getAllParts(payload: any): any[] {
  if (!payload) return []
  const parts: any[] = []
  if (payload.body?.data || payload.body?.attachmentId) parts.push(payload)
  for (const part of payload.parts ?? []) parts.push(...getAllParts(part))
  return parts
}

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
  org: IOrganization,
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
  const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  let parsed: any
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    console.warn('⚠️  Gemini returned non-JSON for email', emailId, ':', raw.slice(0, 200))
    return
  }

  if (!parsed.isFine) return

  const fineType = parsed.type === 'toll' ? 'toll' : 'fine'
  const rawPlate = String(parsed.plate ?? '').toUpperCase().replace(/\s+/g, '')

  if (!rawPlate) {
    await Notification.create({
      orgId: org._id,
      type: fineType,
      title: `${fineType === 'toll' ? 'Toll' : 'Fine'} detected — plate unreadable`,
      description: `$${parsed.amount ?? '?'} — ${parsed.description ?? 'See email'}. Could not match to a fleet vehicle.`,
      actionRequired: true,
    })
    return
  }

  // Only ever matched against the mailbox owner's own fleet.
  const vehicle = await Vehicle.findOne({ plate: rawPlate, orgId: org._id })

  if (!vehicle) {
    await Notification.create({
      orgId: org._id,
      type: fineType,
      title: `${fineType === 'toll' ? 'Toll' : 'Fine'} — ${rawPlate} (not in fleet)`,
      description: `$${parsed.amount} — ${parsed.description}. Plate ${rawPlate} not found in your fleet.`,
      plate: rawPlate,
      actionRequired: true,
    })
    return
  }

  const fineDate = parsed.date ? new Date(parsed.date) : new Date()

  const fine = await Fine.create({
    orgId: org._id,
    vehicle: vehicle._id,
    type: fineType,
    amount: Number(parsed.amount) || 0,
    description: parsed.description ?? 'Email attachment fine',
    date: fineDate,
    paid: false,
  })

  if (fineType === 'toll') {
    vehicle.tolls.push(fine._id as any)
  } else {
    vehicle.fines.push(fine._id as any)
  }
  await vehicle.save()

  // ── Who was riding at the fine date ──────────────────
  let riderInfo = ''
  try {
    const currentRenter = await Renter.findOne({ currentVehicle: vehicle._id, orgId: org._id })
    if (currentRenter && currentRenter.rentStartDate && currentRenter.rentStartDate <= fineDate) {
      riderInfo = `Likely rider: ${currentRenter.name} (${currentRenter.phone})`
    } else {
      const historicalRenter = await Renter.findOne({
        orgId: org._id,
        rentalHistory: {
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
    orgId: org._id,
    type: fineType,
    title: `New ${fineType} — ${vehicle.plate}`,
    description: `$${Number(parsed.amount).toFixed(2)} — ${parsed.description}. Detected from email.${riderInfo ? ` ${riderInfo}.` : ''}`,
    plate: vehicle.plate,
    actionRequired: true,
  })

  console.log(`✅ Created ${fineType} $${parsed.amount} for ${vehicle.plate} (${org.slug || org.email})`)
}
