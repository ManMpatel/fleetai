/**
 * Env-var credentials for the founding operator.
 *
 * Before multi-tenancy there was one operator and their PayWay, WhatsApp, Gmail and SMS
 * credentials lived in the server environment. Multi-tenancy moved credentials onto the
 * Organization record, which would silently strand that operator: PayWay would drop to
 * the mock path, WhatsApp sends would throw, and fine ingestion would stop.
 *
 * This module keeps the old environment variables working, but for exactly ONE tenant —
 * the organisation whose login email matches LEGACY_ORG_EMAIL. Every other tenant, now
 * and in future, must supply its own credentials. That restriction is the whole point:
 * an unscoped fallback would settle a new operator's direct debits into the founding
 * operator's merchant account.
 *
 * Anything the legacy org later saves through the dashboard or the admin credentials
 * modal wins over the environment, so migrating off these variables is just a matter of
 * entering the values once and unsetting LEGACY_ORG_EMAIL.
 */

export interface LegacyPayWay {
  secretKey?: string
  publishableKey?: string
  merchantId?: string
  bankAccountId?: string
}

export interface LegacyWhatsApp {
  phoneId: string
  token: string
}

export interface LegacySms {
  username: string
  password: string
}

/** The login email of the founding operator, or null when the fallback is switched off. */
export function legacyOrgEmail(): string | null {
  const email = (process.env.LEGACY_ORG_EMAIL || '').trim().toLowerCase()
  return email || null
}

/** True only for the one organisation named by LEGACY_ORG_EMAIL. */
export function isLegacyOrg(org: { email?: string } | null | undefined): boolean {
  const legacy = legacyOrgEmail()
  if (!legacy || !org?.email) return false
  return org.email.trim().toLowerCase() === legacy
}

function value(name: string): string | undefined {
  const raw = (process.env[name] || '').trim()
  if (!raw || raw === 'your_key_here' || raw === 'test_placeholder') return undefined
  return raw
}

/** PayWay keys from the environment. Null unless a secret key is actually present. */
export function legacyPayWay(): LegacyPayWay | null {
  const secretKey = value('PAYWAY_SECRET_KEY')
  if (!secretKey) return null
  return {
    secretKey,
    publishableKey: value('PAYWAY_PUBLISHABLE_KEY'),
    merchantId: value('PAYWAY_MERCHANT_ID'),
    bankAccountId: value('PAYWAY_BANK_ACCOUNT_ID'),
  }
}

/** WhatsApp Business credentials from the environment. Both halves are required. */
export function legacyWhatsApp(): LegacyWhatsApp | null {
  const phoneId = value('WHATSAPP_PHONE_ID')
  const token = value('WHATSAPP_TOKEN')
  if (!phoneId || !token) return null
  return { phoneId, token }
}

/** Gmail refresh token for fine/toll ingestion. */
export function legacyGmailRefreshToken(): string | null {
  return value('GMAIL_REFRESH_TOKEN') || null
}

/** Mobile Message SMS credentials. */
export function legacySms(): LegacySms | null {
  const username = value('SMS_API_USERNAME') || value('MM_API_USERNAME')
  const password = value('SMS_API_PASSWORD') || value('MM_API_PASSWORD')
  if (!username || !password) return null
  return { username, password }
}

/** Startup diagnostics — printed once so a half-configured fallback is visible in logs. */
export function describeLegacyConfig(): string[] {
  const email = legacyOrgEmail()
  if (!email) {
    return ['LEGACY_ORG_EMAIL not set — every tenant must supply its own credentials']
  }
  const parts = [
    `PayWay ${legacyPayWay() ? '✅' : '❌'}`,
    `WhatsApp ${legacyWhatsApp() ? '✅' : '❌'}`,
    `Gmail ${legacyGmailRefreshToken() ? '✅' : '❌'}`,
    `SMS ${legacySms() ? '✅' : '❌'}`,
  ]
  return [`Env credential fallback active for ${email} — ${parts.join('  ')}`]
}
