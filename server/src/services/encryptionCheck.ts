/**
 * Proves at startup that ENCRYPTION_KEY is the key the stored data was actually written
 * with.
 *
 * Before multi-tenancy, encryption.ts fell back to a key literal baked into the source and
 * both encrypt() and decrypt() swallowed every error. That made a wrong key invisible:
 * decrypt() handed back ciphertext and the app carried on. The key is now required and
 * decrypt() throws, which is correct — but it moves the discovery of a wrong key to the
 * first renter someone opens, as a 500, hours after deploying.
 *
 * So we check it here instead, against real ciphertext, before the server accepts traffic.
 * A wrong AES-256-CBC key almost always fails PKCS#7 padding on the way out; on the rare
 * occasion it doesn't, the plaintext test below catches the garbage.
 */

import mongoose from 'mongoose'
import { decrypt } from './encryption'

/** One encrypted field to test against, and where it came from. */
interface Probe {
  collection: string
  field: string
  value: string
}

/** Encrypted values are all short human-readable strings — account numbers, licence numbers, API keys. */
function looksLikePlaintext(value: string): boolean {
  if (!value) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    // Control bytes (tab/newline aside) and U+FFFD mean we decoded noise, not text.
    if (code === 0xfffd) return false
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false
  }
  return true
}

/** Values written before encryption existed have no IV prefix and decrypt to themselves. */
function isCiphertext(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}:[0-9a-f]+$/i.test(value)
}

async function findProbes(db: mongoose.mongo.Db, limit = 3): Promise<Probe[]> {
  // Ordered widest-first: whichever of these a given deployment has, we find something.
  const candidates: Array<[string, string]> = [
    ['owners', 'payway.secretKeyEnc'],
    ['owners', 'whatsapp.tokenEnc'],
    ['owners', 'gmail.refreshTokenEnc'],
    ['owners', 'sms.passwordEnc'],
    ['renters', 'bsbNumber'],
    ['renters', 'accountNumber'],
    ['renters', 'licenceNumber'],
  ]

  const probes: Probe[] = []
  for (const [collection, field] of candidates) {
    if (probes.length >= limit) break
    try {
      const doc = await db.collection(collection).findOne(
        { [field]: { $exists: true, $ne: null } },
        { projection: { [field]: 1 } }
      )
      const value = field.split('.').reduce<any>((acc, key) => acc?.[key], doc)
      if (isCiphertext(value)) probes.push({ collection, field, value })
    } catch {
      // Collection missing on a fresh database — nothing to prove against here.
    }
  }
  return probes
}

/**
 * Throws when the configured key cannot read the database's existing ciphertext.
 *
 * A database with nothing encrypted yet (a fresh deployment) passes trivially — there is
 * no evidence either way, and refusing to boot would be wrong.
 */
export async function assertEncryptionKeyMatchesStoredData(): Promise<void> {
  const db = mongoose.connection.db
  if (!db) throw new Error('assertEncryptionKeyMatchesStoredData() ran before MongoDB connected')

  const probes = await findProbes(db)
  if (probes.length === 0) {
    console.log('   Encryption key: no stored ciphertext to verify against (new database)')
    return
  }

  const failures: string[] = []
  for (const probe of probes) {
    try {
      const plaintext = decrypt(probe.value)
      if (!looksLikePlaintext(plaintext)) {
        failures.push(`${probe.collection}.${probe.field} decrypted to binary garbage`)
      }
    } catch (err: any) {
      failures.push(`${probe.collection}.${probe.field} failed to decrypt (${err.message})`)
    }
  }

  if (failures.length > 0) {
    throw new Error(
      'ENCRYPTION_KEY does not match the key this database was encrypted with.\n\n' +
      failures.map(f => `      • ${f}`).join('\n') + '\n\n' +
      '      Every renter bank account, licence and passport number, and every stored\n' +
      '      PayWay/WhatsApp/Gmail/SMS credential was written with a different key. Starting\n' +
      '      with this one would fail on the first renter anyone opens.\n\n' +
      '      If this deployment previously ran with ENCRYPTION_KEY unset, the value you need\n' +
      '      is the literal default that used to sit in services/encryption.ts — recover it\n' +
      '      with:  git show fc6ad67:server/src/services/encryption.ts\n\n' +
      '      Do not rotate the key here. Rotation needs a decrypt-with-old, encrypt-with-new\n' +
      '      pass over the data first.'
    )
  }

  console.log(`   Encryption key: verified against ${probes.length} stored value(s) ✅`)
}
