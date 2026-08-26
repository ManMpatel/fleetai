import axios from 'axios'
import { decrypt } from './encryption'
import type { IOrganization } from '../models/Organization'

const PAYWAY_BASE = 'https://api.payway.com.au/rest/v1'

/**
 * PayWay credentials belong to the tenant, not the platform. Direct debits settle into
 * the merchant account these keys belong to, so passing the wrong tenant's credentials
 * moves one operator's money into another's bank account.
 */
export interface PayWayCreds {
  secretKey?: string
  publishableKey?: string
  merchantId?: string
  bankAccountId?: string
}

/** Decrypts a tenant's stored PayWay credentials. */
export function paywayCredsFor(org: IOrganization): PayWayCreds {
  return {
    secretKey: org.payway?.secretKeyEnc ? decrypt(org.payway.secretKeyEnc) : undefined,
    publishableKey: org.payway?.publishableKeyEnc ? decrypt(org.payway.publishableKeyEnc) : undefined,
    merchantId: org.payway?.merchantId,
    bankAccountId: org.payway?.bankAccountId || '0000000A',
  }
}

function secretAuthHeader(creds: PayWayCreds) {
  return {
    Authorization: `Basic ${Buffer.from(`${creds.secretKey}:`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

function publishableAuthHeader(creds: PayWayCreds) {
  return {
    Authorization: `Basic ${Buffer.from(`${creds.publishableKey}:`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

/** A tenant that has not connected PayWay falls back to the mock path, as before. */
export function isConfigured(creds: PayWayCreds): boolean {
  return !!(creds.secretKey && creds.secretKey !== 'test_placeholder')
}

// ── Step 1: Create single use token from BSB/Account ──────
export async function createBankAccountToken(
  creds: PayWayCreds,
  bsb: string,
  accountNumber: string,
  accountName: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  if (!isConfigured(creds)) {
    console.log('⚠️  PayWay not configured for this tenant — mock token')
    return { success: true, token: 'MOCK_TOKEN_123' }
  }

  try {
    const params = new URLSearchParams({
      paymentMethod: 'bankAccount',
      bsb: bsb.replace(/[^0-9]/g, '').replace(/(\d{3})(\d{3})/, '$1-$2'),
      accountNumber,
      accountName,
    })

    const res = await axios.post(
      `${PAYWAY_BASE}/single-use-tokens`,
      params.toString(),
      { headers: publishableAuthHeader(creds) }
    )

    console.log(`✅ PayWay token created: ${res.data.singleUseTokenId}`)
    return { success: true, token: res.data.singleUseTokenId }
  } catch (err: any) {
    console.error('❌ PayWay token error:', err.response?.data || err.message)
    return { success: false, error: JSON.stringify(err.response?.data || err.message) }
  }
}

// ── Step 2: Create customer using token ───────────────────
export async function createPayWayCustomer(
  creds: PayWayCreds,
  renter: {
    orgId: string
    phone: string
    name: string
    email?: string
    bsbNumber?: string
    accountNumber?: string
    accountHolderName?: string
  }
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  // Customer ids are namespaced by tenant so two operators renting to the same person
  // never collide, even if they later share a merchant account.
  const fallbackCustomerId = `${renter.orgId}_${renter.phone.replace(/[^0-9]/g, '')}`

  if (!isConfigured(creds)) {
    console.log('⚠️  PayWay not configured for this tenant — mock createCustomer for:', renter.phone)
    return { success: true, customerId: `MOCK_${fallbackCustomerId}` }
  }

  try {
    let singleUseTokenId = ''
    if (renter.bsbNumber && renter.accountNumber) {
      const tokenResult = await createBankAccountToken(
        creds,
        renter.bsbNumber,
        renter.accountNumber,
        renter.accountHolderName || renter.name
      )
      if (!tokenResult.success || !tokenResult.token) {
        return { success: false, error: tokenResult.error }
      }
      singleUseTokenId = tokenResult.token
    }

    const params = new URLSearchParams({
      singleUseTokenId,
      merchantId: creds.merchantId || 'TEST',
      bankAccountId: creds.bankAccountId || '0000000A',
      customerName: renter.name,
      emailAddress: renter.email || '',
      sendEmailReceipts: 'false',
      phoneNumber: renter.phone,
    })

    const res = await axios.post(
      `${PAYWAY_BASE}/customers`,
      params.toString(),
      { headers: secretAuthHeader(creds) }
    )

    const paywayCustomerId = res.data.customerNumber || fallbackCustomerId
    console.log(`✅ PayWay customer created: ${paywayCustomerId}`)
    return { success: true, customerId: paywayCustomerId }
  } catch (err: any) {
    console.error('❌ PayWay createCustomer error:', err.response?.data || err.message)
    return { success: false, error: JSON.stringify(err.response?.data || err.message) }
  }
}

// ── Setup weekly direct debit schedule ────────────────────
export async function setupWeeklyDebit(
  creds: PayWayCreds,
  customerId: string,
  weeklyAmount: number,
  startDate: Date
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured(creds)) {
    console.log(`⚠️  PayWay not configured — mock setupWeeklyDebit: $${weeklyAmount}/week for ${customerId}`)
    return { success: true }
  }

  try {
    const nextDate = new Date(startDate)
    if (nextDate <= new Date()) {
      nextDate.setDate(new Date().getDate() + 7)
    }

    const params = new URLSearchParams({
      frequency: 'WEEKLY',
      nextPaymentDate: nextDate.toISOString().slice(0, 10),
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: weeklyAmount.toFixed(2),
    })

    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: secretAuthHeader(creds) }
    )

    console.log(`✅ PayWay weekly debit setup: ${customerId} $${weeklyAmount}/week`)
    return { success: true }
  } catch (err: any) {
    console.error('❌ PayWay setupWeeklyDebit error:', err.response?.data || err.message)
    return { success: false, error: JSON.stringify(err.response?.data || err.message) }
  }
}

// ── Pause auto-debit ──────────────────────────────────────
export async function pauseDebit(
  creds: PayWayCreds,
  customerId: string,
  weeklyAmount: number = 10
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured(creds)) {
    console.log(`⚠️  PayWay not configured — mock pauseDebit for ${customerId}`)
    return { success: true }
  }

  try {
    // PayWay has no explicit pause — the next payment date is pushed far out instead.
    const params = new URLSearchParams({
      frequency: 'WEEKLY',
      nextPaymentDate: '2099-12-31',
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: weeklyAmount.toFixed(2),
    })

    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: secretAuthHeader(creds) }
    )
    console.log(`✅ PayWay debit paused: ${customerId}`)
    return { success: true }
  } catch (err: any) {
    console.error('❌ PayWay pauseDebit error:', err.response?.data || err.message)
    return { success: false, error: err.message }
  }
}

// ── Resume auto-debit ─────────────────────────────────────
export async function resumeDebit(
  creds: PayWayCreds,
  customerId: string,
  weeklyAmount: number
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured(creds)) {
    console.log(`⚠️  PayWay not configured — mock resumeDebit for ${customerId}`)
    return { success: true }
  }

  try {
    const nextDate = new Date()
    nextDate.setDate(nextDate.getDate() + 7)

    const params = new URLSearchParams({
      frequency: 'WEEKLY',
      nextPaymentDate: nextDate.toISOString().slice(0, 10),
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: weeklyAmount.toFixed(2),
    })

    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: secretAuthHeader(creds) }
    )
    console.log(`✅ PayWay debit resumed: ${customerId}`)
    return { success: true }
  } catch (err: any) {
    console.error('❌ PayWay resumeDebit error:', err.response?.data || err.message)
    return { success: false, error: err.message }
  }
}

// ── Get payment history ───────────────────────────────────
export async function getPaymentHistory(
  creds: PayWayCreds,
  customerId: string
): Promise<{ success: boolean; payments?: any[]; error?: string }> {
  if (!isConfigured(creds)) {
    return {
      success: true,
      payments: [
        { date: '2026-03-01', amount: 150, status: 'approved', description: 'Weekly rental' },
        { date: '2026-03-08', amount: 150, status: 'approved', description: 'Weekly rental' },
      ],
    }
  }

  try {
    const res = await axios.get(
      `${PAYWAY_BASE}/customers/${customerId}/transactions`,
      { headers: secretAuthHeader(creds), params: { offset: 0, limit: 10 } }
    )
    return { success: true, payments: res.data.data || [] }
  } catch (err: any) {
    // No payment history yet is normal, not an error worth surfacing.
    return { success: true, payments: [] }
  }
}

// ── Push next payment date out by N weeks ─────────────────
export async function pushNextPayment(
  creds: PayWayCreds,
  customerId: string,
  weeklyAmount: number,
  weeks: number
): Promise<{ success: boolean; newDate?: string; error?: string }> {
  if (!isConfigured(creds)) {
    console.log(`⚠️  PayWay not configured — mock push ${weeks} week(s) for ${customerId}`)
    return { success: true, newDate: 'mock-date' }
  }
  try {
    const nextDate = new Date()
    nextDate.setDate(nextDate.getDate() + weeks * 7)
    const params = new URLSearchParams({
      frequency: 'WEEKLY',
      nextPaymentDate: nextDate.toISOString().slice(0, 10),
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: weeklyAmount.toFixed(2),
    })
    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: secretAuthHeader(creds) }
    )
    console.log(`✅ PayWay next payment pushed ${weeks}wk for ${customerId}`)
    return { success: true, newDate: nextDate.toISOString().slice(0, 10) }
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message
    console.error('❌ PayWay push error:', msg)
    return { success: false, error: msg }
  }
}

// ── Update bank account on existing customer ──────────────
export async function updateBankAccount(
  creds: PayWayCreds,
  customerId: string,
  bsb: string,
  accountNumber: string,
  accountName: string
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured(creds)) {
    console.log(`⚠️  PayWay not configured — mock updateBankAccount for ${customerId}`)
    return { success: true }
  }
  try {
    const tokenResult = await createBankAccountToken(creds, bsb, accountNumber, accountName)
    if (!tokenResult.success || !tokenResult.token) {
      return { success: false, error: tokenResult.error }
    }
    const params = new URLSearchParams({
      singleUseTokenId: tokenResult.token,
      bankAccountId: creds.bankAccountId || '0000000A',
    })
    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/payment-setup`,
      params.toString(),
      { headers: secretAuthHeader(creds) }
    )
    console.log(`✅ PayWay bank account updated for ${customerId}`)
    return { success: true }
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message
    console.error('❌ PayWay updateBankAccount error:', msg)
    return { success: false, error: msg }
  }
}

// ── Retry a failed payment ────────────────────────────────
export async function retryFailedPayment(
  creds: PayWayCreds,
  customerId: string,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured(creds)) {
    console.log(`⚠️  PayWay not configured — mock retry for ${customerId} $${amount}`)
    return { success: true }
  }
  try {
    const idempotencyKey = `retry-${customerId}-${Date.now()}`
    const params = new URLSearchParams({
      customerNumber: customerId,
      principalAmount: amount.toFixed(2),
      currency: 'aud',
      orderNumber: idempotencyKey.slice(0, 20),
    })
    await axios.post(
      `${PAYWAY_BASE}/transactions`,
      params.toString(),
      { headers: { ...secretAuthHeader(creds), 'Idempotency-Key': idempotencyKey } }
    )
    console.log(`✅ PayWay retry success — $${amount} for ${customerId}`)
    return { success: true }
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message
    console.error('❌ PayWay retry error:', msg)
    return { success: false, error: msg }
  }
}

// ── Void a transaction ────────────────────────────────────
export async function voidTransaction(
  creds: PayWayCreds,
  transactionId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured(creds)) {
    console.log(`⚠️  PayWay not configured — mock void for ${transactionId}`)
    return { success: true }
  }
  try {
    await axios.post(
      `${PAYWAY_BASE}/transactions/${transactionId}/void`,
      '',
      { headers: secretAuthHeader(creds) }
    )
    console.log(`✅ PayWay void success: ${transactionId}`)
    return { success: true }
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message
    console.error('❌ PayWay void error:', msg)
    return { success: false, error: msg }
  }
}

// ── Refund a transaction ──────────────────────────────────
export async function refundTransaction(
  creds: PayWayCreds,
  transactionId: string,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured(creds)) {
    console.log(`⚠️  PayWay not configured — mock refund for ${transactionId}`)
    return { success: true }
  }
  try {
    const params = new URLSearchParams({
      transactionType: 'refund',
      parentTransactionId: transactionId,
      principalAmount: amount.toFixed(2),
    })
    await axios.post(
      `${PAYWAY_BASE}/transactions`,
      params.toString(),
      { headers: secretAuthHeader(creds) }
    )
    console.log(`✅ PayWay refund success: ${transactionId} $${amount}`)
    return { success: true }
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message
    console.error('❌ PayWay refund error:', msg)
    return { success: false, error: msg }
  }
}

// ── Fetch ALL transactions with pagination ────────────────
export async function fetchAllTransactions(
  creds: PayWayCreds,
  customerId: string
): Promise<any[]> {
  if (!isConfigured(creds)) return []
  const all: any[] = []
  let url: string | null = `${PAYWAY_BASE}/transactions/search-customer`
  let params: any = { customerNumber: customerId }

  while (url) {
    try {
      const res: any = await axios.get(url, {
        headers: { Authorization: secretAuthHeader(creds).Authorization },
        params,
      })
      const data = res.data
      const raw = data.data || []
      for (const t of raw) {
        all.push({
          transactionId: t.transactionId,
          date:          t.settlementDate || null,
          amount:        t.paymentAmount || 0,
          status:        t.status || 'unknown',
          description:   t.transactionType || 'Direct debit',
          isVoidable:    t.voidable ?? false,
          isRefundable:  t.refundable ?? false,
          responseCode:  t.responseCode || null,
        })
      }
      const nextLink = (data.links || []).find((l: any) => l.rel === 'next')
      if (nextLink) {
        url = nextLink.href
        params = {}
      } else {
        url = null
      }
    } catch (err: any) {
      console.error('❌ fetchAllTransactions error:', err.response?.data || err.message)
      break
    }
  }
  return all
}

// ── Get customer schedule (next payment date) ─────────────
export async function getCustomerSchedule(
  creds: PayWayCreds,
  customerId: string
): Promise<{ success: boolean; nextPaymentDate?: Date; error?: string }> {
  if (!isConfigured(creds)) return { success: true }
  try {
    const res = await axios.get(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      { headers: { Authorization: secretAuthHeader(creds).Authorization } }
    )
    const raw = res.data.nextPaymentDate
    if (!raw) return { success: true }
    return { success: true, nextPaymentDate: new Date(raw) }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
