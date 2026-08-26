/**
 * Mobile Message SMS.
 *
 * Onboarding links and payment-decline notices were sent by SMS before multi-tenancy, and
 * renters are not guaranteed to be on WhatsApp, so the channel is kept. Credentials are
 * per tenant like every other integration; the founding operator falls back to the
 * SMS_API_USERNAME / SMS_API_PASSWORD environment pair.
 */

import axios from 'axios'
import { decrypt } from './encryption'
import { isLegacyOrg, legacySms } from '../config/legacyTenant'
import type { IOrganization } from '../models/Organization'

export interface SmsCreds {
  username: string
  password: string
  sender?: string
}

export function smsCredsFor(org: IOrganization): SmsCreds | null {
  const username = org.sms?.username
  const password = org.sms?.passwordEnc ? decrypt(org.sms.passwordEnc) : null
  if (username && password) return { username, password, sender: org.sms?.sender }

  if (isLegacyOrg(org)) {
    const env = legacySms()
    if (env) return { ...env, sender: org.sms?.sender || process.env.SMS_SENDER }
  }
  return null
}

export function smsConfiguredFor(org: IOrganization): boolean {
  return smsCredsFor(org) !== null
}

/** Sends one SMS on behalf of a tenant. Throws when that tenant has no SMS credentials. */
export async function sendSMS(org: IOrganization, phone: string, message: string): Promise<void> {
  const creds = smsCredsFor(org)
  if (!creds) {
    throw new Error('SMS is not connected for this organisation')
  }

  const formatted = phone.replace(/\s+/g, '').replace(/^\+/, '').replace(/^0/, '61')
  const token = Buffer.from(`${creds.username}:${creds.password}`).toString('base64')

  const payload: Record<string, unknown> = { to: formatted, message }
  if (creds.sender) payload.sender = creds.sender

  const response = await axios.post(
    'https://api.mobilemessage.com.au/v1/messages',
    { messages: [payload] },
    { headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' } }
  )
  console.log(`✅ SMS sent to ${formatted}:`, JSON.stringify(response.data))
}
