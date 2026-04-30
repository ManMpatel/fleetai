import axios from 'axios'
import Owner from '../models/Owner'

export async function sendSMS(ownerEmail: string, phone: string, message: string): Promise<void> {
  const owner = await Owner.findOne({ email: ownerEmail })
  const username = (owner as any)?.mmApiUsername
  const password = (owner as any)?.mmApiPassword

  if (!username || !password) {
    throw new Error('SMS not configured — owner has not set Mobile Message credentials')
  }

  const formatted = phone.replace(/\s+/g, '').replace(/^0/, '61')
  const token = Buffer.from(`${username}:${password}`).toString('base64')

  await axios.post(
    'https://api.mobilemessage.com.au/v1/messages',
    { to: formatted, message, from: 'FleetAI' },
    { headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' } }
  )
}