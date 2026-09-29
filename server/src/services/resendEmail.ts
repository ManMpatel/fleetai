import { Resend } from 'resend'
import { decrypt } from './encryption'
import type { IOrganization } from '../models/Organization'

export async function sendResendEmail(
  org: IOrganization,
  to: string,
  subject: string,
  html: string,
  attachment?: { filename: string; content: Buffer },
): Promise<void> {
  const fleetApiKey = process.env.RESEND_API_KEY
  let apiKey: string
  let fromAddress: string
  const fromName = org.resendEmail?.fromName || (org.displayName ?? org.name ?? 'FleetAI')

  if (org.resendEmail?.provider === 'custom' && org.resendEmail?.apiKeyEnc) {
    apiKey = decrypt(org.resendEmail.apiKeyEnc)
    fromAddress = org.resendEmail.fromEmail || 'noreply@fleetai.co.in'
  } else {
    if (!fleetApiKey) throw new Error('Email not configured — add a Resend API key in Settings')
    apiKey = fleetApiKey
    fromAddress = 'noreply@fleetai.co.in'
  }

  const resend = new Resend(apiKey)
  const payload: Parameters<typeof resend.emails.send>[0] = {
    from: `${fromName} <${fromAddress}>`,
    to: [to],
    subject,
    html,
  }
  if (attachment) {
    payload.attachments = [{ filename: attachment.filename, content: attachment.content }]
  }

  const { error } = await resend.emails.send(payload)
  if (error) throw new Error(error.message)
}
