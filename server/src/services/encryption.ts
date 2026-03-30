import crypto from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || 'FleetAI2026SydneyScooterSecret32', 'utf8').slice(0, 32)

export function encrypt(text: string): string {
  if (!text) return ''
  try {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`
  } catch {
    return text
  }
}

export function decrypt(text: string): string {
  if (!text) return ''
  try {
    if (!text.includes(':')) return text // not encrypted
    const [ivHex, encryptedHex] = text.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const encrypted = Buffer.from(encryptedHex, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    return text // return as-is if decryption fails
  }
}