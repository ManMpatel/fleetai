import crypto from 'crypto'

const ALGORITHM = 'aes-256-cbc'

// Tenant PayWay / WhatsApp / Gmail secrets are encrypted with this key, so a missing or
// weak key is a hard startup failure rather than a silent fallback to a literal baked
// into the source.
function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || ''
  const bytes = Buffer.from(raw, 'utf8')
  if (bytes.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY is missing or shorter than 32 bytes. Set it in the server ' +
      'environment before starting — renter bank details and tenant API credentials ' +
      'are encrypted with it.'
    )
  }
  // Derivation must stay byte-identical to the original implementation: existing
  // ciphertext and licence/passport hashes in the database depend on it.
  return bytes.subarray(0, 32)
}

const KEY = loadKey()

export function encrypt(text: string): string {
  if (!text) return ''
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(text: string): string {
  if (!text) return ''
  // Values written before encryption was introduced have no IV prefix.
  if (!text.includes(':')) return text

  const [ivHex, encryptedHex] = text.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

// Deterministic HMAC — used for duplicate lookups on encrypted fields, and for storing
// employee PINs and tablet device tokens without keeping the plaintext.
export function hash(text: string): string {
  if (!text) return ''
  return crypto.createHmac('sha256', KEY).update(text.toLowerCase().trim()).digest('hex')
}
