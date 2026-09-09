import nodemailer from 'nodemailer'
import type { IOrganization } from '../models/Organization'
import { decrypt } from './encryption'

// Sending mailbox for TollBatch. Deliberately separate from the read-only `gmail`
// integration (services/gmail.ts) — that one has no in-app OAuth consent flow, so
// adding a send scope would mean manually regenerating and re-pasting a token per
// tenant. This is a plain SMTP app-specific password instead, self-serviceable by any
// business owner from Settings in a couple of minutes.

export interface TollEmailCreds {
  address: string
  appPassword: string
  smtpHost: string
  smtpPort: number
}

// Gmail covers the overwhelming majority of businesses pasting an app-specific
// password; smtpHost/smtpPort only need setting for anyone else (Outlook, a custom
// domain mailbox, etc).
const DEFAULT_SMTP_HOST = 'smtp.gmail.com'
const DEFAULT_SMTP_PORT = 465

export function tollEmailCredsFor(org: IOrganization): TollEmailCreds | null {
  const address = org.tollEmail?.address
  const appPassword = org.tollEmail?.appPasswordEnc ? decrypt(org.tollEmail.appPasswordEnc) : null
  if (!address || !appPassword) return null

  return {
    address,
    appPassword,
    smtpHost: org.tollEmail?.smtpHost || DEFAULT_SMTP_HOST,
    smtpPort: org.tollEmail?.smtpPort || DEFAULT_SMTP_PORT,
  }
}

/** True when this tenant has a usable sending mailbox connected and switched on. */
export function tollEmailActiveFor(org: IOrganization): boolean {
  return !!org.tollEmail?.enabled && !!tollEmailCredsFor(org)
}

/**
 * Sends one merged toll PDF to one recipient on behalf of a tenant.
 *
 * Throws on any failure (bad address, auth rejected, SMTP unreachable) rather than
 * swallowing it — the caller is a request handler that must show the owner the real
 * failure reason, never a blanket "sent" when it wasn't.
 */
export async function sendTollEmail(
  org: IOrganization,
  to: string,
  subject: string,
  pdfBuffer: Buffer,
  filename: string
): Promise<void> {
  const creds = tollEmailCredsFor(org)
  if (!creds) {
    throw new Error('No sending email is connected for this organisation — add one in Settings')
  }

  const transporter = nodemailer.createTransport({
    host: creds.smtpHost,
    port: creds.smtpPort,
    secure: creds.smtpPort === 465,
    auth: { user: creds.address, pass: creds.appPassword },
  })

  await transporter.sendMail({
    from: creds.address,
    to,
    subject,
    text: `Please find attached your toll notices (${filename}).`,
    attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
  })
}
