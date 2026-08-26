/**
 * Whether a tenant's integrations are actually usable, as opposed to merely stored.
 *
 * "Configured" has two sources: credentials saved on the organisation record, and — for
 * the founding operator only — the environment variables the platform ran on before
 * multi-tenancy. Reporting only the first would tell that operator PayWay and WhatsApp
 * are disconnected while their debits and messages are working perfectly, which is the
 * kind of wrong status that gets acted on.
 */

import type { IOrganization } from '../models/Organization'
import {
  isLegacyOrg,
  legacyGmailRefreshToken,
  legacyPayWay,
  legacySms,
  legacyWhatsApp,
} from '../config/legacyTenant'

interface Flags {
  /** Usable right now, from either source. */
  configured: boolean
  /** Usable only because of the environment fallback — nothing is stored on the record. */
  fromEnv: boolean
  /** Actively switched on. Env-backed integrations are on by virtue of being set. */
  enabled: boolean
}

export interface IntegrationStatus {
  payway: Flags
  whatsapp: Flags
  gmail: Flags
  sms: Flags
}

function flags(stored: boolean, env: boolean, enabled: boolean): Flags {
  return {
    configured: stored || env,
    fromEnv: !stored && env,
    enabled: stored ? enabled : env,
  }
}

export function integrationStatus(org: IOrganization): IntegrationStatus {
  const legacy = isLegacyOrg(org)

  return {
    payway: flags(!!org.payway?.secretKeyEnc, legacy && !!legacyPayWay(), true),
    whatsapp: flags(!!org.whatsapp?.tokenEnc, legacy && !!legacyWhatsApp(), !!org.whatsapp?.enabled),
    gmail: flags(!!org.gmail?.refreshTokenEnc, legacy && !!legacyGmailRefreshToken(), !!org.gmail?.enabled),
    sms: flags(!!org.sms?.passwordEnc, legacy && !!legacySms(), !!org.sms?.enabled),
  }
}
