/**
 * PayWay Service — Recurring Billing + Customer Vault
 * REST API: https://api.payway.com.au/rest/v1
 *
 * Required .env vars:
 *   PAYWAY_SECRET_KEY       — secret API key from PayWay dashboard
 *   PAYWAY_PUBLISHABLE_KEY  — publishable API key
 *   PAYWAY_MERCHANT_ID      — 8 digit merchant ID (or TEST for sandbox)
 *
 * Docs: https://www.payway.com.au/docs/rest.html
 */

import axios from 'axios'

const PAYWAY_BASE = 'https://api.payway.com.au/rest/v1'

function getAuthHeader() {
  const secretKey = process.env.PAYWAY_SECRET_KEY || 'test_placeholder'
  return {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

function isConfigured(): boolean {
  return !!(
    process.env.PAYWAY_SECRET_KEY &&
    process.env.PAYWAY_SECRET_KEY !== 'test_placeholder'
  )
}

// ── Create a new customer in PayWay vault ──────────────────
export async function createPayWayCustomer(renter: {
  phone: string
  name: string
  email?: string
}): Promise<{ success: boolean; customerId?: string; error?: string }> {
  if (!isConfigured()) {
    console.log('⚠️  PayWay not configured — mock createCustomer for:', renter.phone)
    return { success: true, customerId: `MOCK_${renter.phone}` }
  }

  try {
    const merchantId = process.env.PAYWAY_MERCHANT_ID || 'TEST'
    const customerId = renter.phone.replace(/\s+/g, '')

    const params = new URLSearchParams({
      customerName: renter.name,
      emailAddress: renter.email || '',
      sendEmailReceipts: 'false',
      phoneNumber: renter.phone,
      merchantId,
      yourSystemReference: customerId,
    })

    const res = await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}`,
      params.toString(),
      { headers: getAuthHeader() }
    )

    console.log(`✅ PayWay customer created: ${customerId}`)
    return { success: true, customerId: res.data.customerNumber || customerId }
  } catch (err: any) {
    console.error('❌ PayWay createCustomer error:', err.response?.data || err.message)
    return { success: false, error: err.message }
  }
}

// ── Setup weekly direct debit schedule ────────────────────
export async function setupWeeklyDebit(
  customerId: string,
  weeklyAmount: number,
  startDate: Date
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock setupWeeklyDebit: $${weeklyAmount}/week for ${customerId}`)
    return { success: true }
  }

  try {
    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: startDate.toISOString().slice(0, 10),
      regularPrincipalAmount: weeklyAmount.toFixed(2),
    })

    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: getAuthHeader() }
    )

    console.log(`✅ PayWay weekly debit setup: ${customerId} $${weeklyAmount}/week`)
    return { success: true }
  } catch (err: any) {
    console.error('❌ PayWay setupWeeklyDebit error:', err.response?.data || err.message)
    return { success: false, error: err.message }
  }
}

// ── Pause auto-debit (on scooter return) ──────────────────
export async function pauseDebit(
  customerId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock pauseDebit for ${customerId}`)
    return { success: true }
  }

  try {
    const params = new URLSearchParams({ stopped: 'true' })
    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: getAuthHeader() }
    )

    console.log(`✅ PayWay debit paused: ${customerId}`)
    return { success: true }
  } catch (err: any) {
    console.error('❌ PayWay pauseDebit error:', err.response?.data || err.message)
    return { success: false, error: err.message }
  }
}

// ── Resume auto-debit ──────────────────────────────────────
export async function resumeDebit(
  customerId: string,
  weeklyAmount: number
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock resumeDebit for ${customerId}`)
    return { success: true }
  }

  try {
    const nextMonday = new Date()
    nextMonday.setDate(nextMonday.getDate() + ((7 - nextMonday.getDay() + 1) % 7 || 7))

    const params = new URLSearchParams({
      stopped: 'false',
      nextPaymentDate: nextMonday.toISOString().slice(0, 10),
      regularPrincipalAmount: weeklyAmount.toFixed(2),
    })

    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: getAuthHeader() }
    )

    console.log(`✅ PayWay debit resumed: ${customerId}`)
    return { success: true }
  } catch (err: any) {
    console.error('❌ PayWay resumeDebit error:', err.response?.data || err.message)
    return { success: false, error: err.message }
  }
}

// ── Get payment history ────────────────────────────────────
export async function getPaymentHistory(
  customerId: string
): Promise<{ success: boolean; payments?: any[]; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock getPaymentHistory for ${customerId}`)
    return {
      success: true,
      payments: [
        { date: '2026-03-01', amount: 150, status: 'approved', description: 'Weekly rental' },
        { date: '2026-03-08', amount: 150, status: 'approved', description: 'Weekly rental' },
        { date: '2026-03-15', amount: 150, status: 'approved', description: 'Weekly rental' },
      ],
    }
  }

  try {
    const res = await axios.get(
      `${PAYWAY_BASE}/customers/${customerId}/transactions`,
      { headers: getAuthHeader() }
    )

    return { success: true, payments: res.data.data || [] }
  } catch (err: any) {
    console.error('❌ PayWay getPaymentHistory error:', err.response?.data || err.message)
    return { success: false, error: err.message }
  }
}