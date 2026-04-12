import axios from 'axios'

const PAYWAY_BASE = 'https://api.payway.com.au/rest/v1'

function getSecretAuthHeader() {
  const secretKey = process.env.PAYWAY_SECRET_KEY || 'test_placeholder'
  return {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

function getPublishableAuthHeader() {
  const publishableKey = process.env.PAYWAY_PUBLISHABLE_KEY || 'test_placeholder'
  return {
    Authorization: `Basic ${Buffer.from(`${publishableKey}:`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

function isConfigured(): boolean {
  return !!(
    process.env.PAYWAY_SECRET_KEY &&
    process.env.PAYWAY_SECRET_KEY !== 'test_placeholder'
  )
}

// ── Step 1: Create single use token from BSB/Account ──────
export async function createBankAccountToken(
  bsb: string,
  accountNumber: string,
  accountName: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  if (!isConfigured()) {
    console.log('⚠️  PayWay not configured — mock token')
    return { success: true, token: 'MOCK_TOKEN_123' }
  }

  try {
    const params = new URLSearchParams({
      paymentMethod: 'bankAccount',
      bsb: bsb.replace(/[^0-9]/g, ''),
      accountNumber,
      accountName,
    })

    console.log(`📤 PayWay token request — BSB: ${params.get('bsb')}, Account: ${params.get('accountNumber')}, Name: ${params.get('accountName')}`)
    const res = await axios.post(
      `${PAYWAY_BASE}/single-use-tokens`,
      params.toString(),
      { headers: getPublishableAuthHeader() }
    )

    console.log(`✅ PayWay token created: ${res.data.singleUseTokenId}`)
    return { success: true, token: res.data.singleUseTokenId }
  } catch (err: any) {
    console.error('❌ PayWay token error — full response:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: JSON.stringify(err.response?.data || err.message) }
  }
}

// ── Step 2: Create customer using token ───────────────────
export async function createPayWayCustomer(renter: {
  phone: string
  name: string
  email?: string
  bsbNumber?: string
  accountNumber?: string
  accountHolderName?: string
}): Promise<{ success: boolean; customerId?: string; accountToken?: string | null; error?: string }> {
  if (!isConfigured()) {
    console.log('⚠️  PayWay not configured — mock createCustomer for:', renter.phone)
    return { success: true, customerId: `MOCK_${renter.phone}` }
  }

  try {
    const merchantId = process.env.PAYWAY_MERCHANT_ID || 'TEST'
    const customerId = renter.phone.replace(/\s+/g, '').replace(/[^0-9]/g, '')

    // Step 1 — get single use token for bank account
    let singleUseTokenId = ''
    if (renter.bsbNumber && renter.accountNumber) {
      const tokenResult = await createBankAccountToken(
        renter.bsbNumber,
        renter.accountNumber,
        renter.accountHolderName || renter.name
      )
      if (!tokenResult.success || !tokenResult.token) {
        return { success: false, error: tokenResult.error }
      }
      singleUseTokenId = tokenResult.token
    }

    // Step 2 — create customer with token
    const params = new URLSearchParams({
      singleUseTokenId,
      merchantId,
      bankAccountId: process.env.PAYWAY_BANK_ACCOUNT_ID || '0000000A',
      customerName: renter.name,
      emailAddress: renter.email || '',
      sendEmailReceipts: 'false',
    })

    console.log(`📤 PayWay create customer — customerNumber: ${customerId}, name: ${renter.name}, merchantId: ${merchantId}, bankAccountId: ${process.env.PAYWAY_BANK_ACCOUNT_ID || '0000000A'}`)
    const res = await axios.post(
      `${PAYWAY_BASE}/customers`,
      params.toString(),
      { headers: getSecretAuthHeader() }
    )

    const paywayCustomerId = res.data.customerNumber || customerId
    const accountToken = res.data.paymentSources?.[0]?.accountToken || null
    console.log(`✅ PayWay customer created — customerNumber: ${paywayCustomerId}, accountToken: ${accountToken}`)
    return { success: true, customerId: paywayCustomerId, accountToken }
  } catch (err: any) {
    console.error('❌ PayWay createCustomer error — full response:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: JSON.stringify(err.response?.data || err.message) }
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
    const nextDate = new Date(startDate)
    // Make sure start date is in the future
    if (nextDate <= new Date()) {
      nextDate.setDate(new Date().getDate() + 7)
    }

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const dd = String(nextDate.getDate()).padStart(2, '0')
    const mon = MONTHS[nextDate.getMonth()]
    const yyyy = nextDate.getFullYear()

    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: `${dd} ${mon} ${yyyy}`,
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: weeklyAmount.toFixed(2),
    })

    console.log(`📤 PayWay schedule — customerId: ${customerId}, amount: $${weeklyAmount}, frequency: WEEKLY, nextDate: ${nextDate.toISOString().slice(0, 10)}`)
    const schedRes = await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: getSecretAuthHeader() }
    )

    console.log(`✅ PayWay schedule set — response: ${JSON.stringify(schedRes.data)}`)
    return { success: true }
  } catch (err: any) {
    console.error('❌ PayWay setupWeeklyDebit error — full response:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: JSON.stringify(err.response?.data || err.message) }
  }
}

// ── Push next payment date forward ────────────────────────
export async function pushNextPayment(
  customerId: string,
  weeklyAmount: number,
  weeks: number
): Promise<{ success: boolean; newDate?: string; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock push ${weeks} week(s) for ${customerId}`)
    return { success: true, newDate: 'mock-date' }
  }
  try {
    const nextDate = new Date()
    nextDate.setDate(nextDate.getDate() + weeks * 7)
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const dd = String(nextDate.getDate()).padStart(2, '0')
    const mon = MONTHS[nextDate.getMonth()]
    const yyyy = nextDate.getFullYear()
    const formatted = `${dd} ${mon} ${yyyy}`

    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: formatted,
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: weeklyAmount.toFixed(2),
    })
    console.log(`📤 PayWay push ${weeks}wk — customerId: ${customerId}, newDate: ${formatted}`)
    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: getSecretAuthHeader() }
    )
    console.log(`✅ PayWay next payment pushed to ${formatted}`)
    return { success: true, newDate: formatted }
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message
    console.error('❌ PayWay push error:', msg)
    return { success: false, error: msg }
  }
}

// ── Pause auto-debit ──────────────────────────────────────

export async function pauseDebit(
  customerId: string,
  weeklyAmount: number = 10
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock pauseDebit for ${customerId}`)
    return { success: true }
  }

  try {
    // PayWay doesn't have a "pause" — we set next payment far in future
    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: '31 Dec 2099',
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: weeklyAmount.toFixed(2),
    })
    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: getSecretAuthHeader() }
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
  customerId: string,
  weeklyAmount: number
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock resumeDebit for ${customerId}`)
    return { success: true }
  }

  try {
    const nextDate = new Date()
    nextDate.setDate(nextDate.getDate() + 7)

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const dd = String(nextDate.getDate()).padStart(2, '0')
    const mon = MONTHS[nextDate.getMonth()]
    const yyyy = nextDate.getFullYear()

    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: `${dd} ${mon} ${yyyy}`,
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: weeklyAmount.toFixed(2),
    })

    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: getSecretAuthHeader() }
    )
    console.log(`✅ PayWay debit resumed: ${customerId}`)
    return { success: true }
  } catch (err: any) {
    console.error('❌ PayWay resumeDebit error:', err.response?.data || err.message)
    return { success: false, error: err.message }
  }
}

// ── Disable/delete customer from PayWay vault ─────────────
export async function disableCustomer(
  customerId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock disable for ${customerId}`)
    return { success: true }
  }
  try {
    console.log(`📤 PayWay disable customer — customerId: ${customerId}`)
    await axios.delete(
      `${PAYWAY_BASE}/customers/${customerId}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.PAYWAY_SECRET_KEY || ''}:`).toString('base64')}`,
        }
      }
    )
    console.log(`✅ PayWay customer disabled: ${customerId}`)
    return { success: true }
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message
    console.error('❌ PayWay disableCustomer error:', msg)
    return { success: false, error: msg }
  }
}

// ── Update bank account on existing customer ──────────────
export async function updateBankAccount(
  customerId: string,
  bsb: string,
  accountNumber: string,
  accountName: string
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock updateBankAccount for ${customerId}`)
    return { success: true }
  }
  try {
    const tokenResult = await createBankAccountToken(bsb, accountNumber, accountName)
    if (!tokenResult.success || !tokenResult.token) {
      return { success: false, error: tokenResult.error }
    }
    const params = new URLSearchParams({
      singleUseTokenId: tokenResult.token,
      bankAccountId: process.env.PAYWAY_BANK_ACCOUNT_ID || '0000000A',
    })
    console.log(`📤 PayWay update bank account — customerId: ${customerId}`)
    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/payment-setup`,
      params.toString(),
      { headers: getSecretAuthHeader() }
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
  customerId: string,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
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
    console.log(`📤 PayWay retry — customerId: ${customerId}, amount: $${amount}`)
    await axios.post(
      `${PAYWAY_BASE}/transactions`,
      params.toString(),
      {
        headers: {
          ...getSecretAuthHeader(),
          'Idempotency-Key': idempotencyKey,
        }
      }
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
  transactionId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock void for ${transactionId}`)
    return { success: true }
  }
  try {
    console.log(`📤 PayWay void — transactionId: ${transactionId}`)
    await axios.post(
      `${PAYWAY_BASE}/transactions/${transactionId}/void`,
      '',
      { headers: getSecretAuthHeader() }
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
  transactionId: string,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock refund for ${transactionId}`)
    return { success: true }
  }
  try {
    console.log(`📤 PayWay refund — transactionId: ${transactionId}, amount: $${amount}`)
    const params = new URLSearchParams({
      transactionType: 'refund',
      parentTransactionId: transactionId,
      principalAmount: amount.toFixed(2),
    })
    await axios.post(
      `${PAYWAY_BASE}/transactions`,
      params.toString(),
      { headers: getSecretAuthHeader() }
    )
    console.log(`✅ PayWay refund success: ${transactionId} $${amount}`)
    return { success: true }
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message
    console.error('❌ PayWay refund error:', msg)
    return { success: false, error: msg }
  }
}


// ── Get payment history ───────────────────────────────────
export async function getPaymentHistory(
  customerId: string
): Promise<{ success: boolean; payments?: any[]; error?: string }> {
  if (!isConfigured()) {
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
      {
        headers: getSecretAuthHeader(),
        params: { offset: 0, limit: 10 }
      }
    )
    const raw = res.data.data || []
    const payments = raw.map((t: any) => ({
      transactionId: t.transactionId || null,
      date: t.transactionTime || t.settlementDate || null,
      amount: t.principalAmount || 0,
      status: t.status || (t.responseCode === '00' || t.responseCode === '08' ? 'approved' : 'declined'),
      responseCode: t.responseCode || null,
      description: t.responseText || 'Direct debit',
      isVoidable: t.voidable ?? false,
      isRefundable: t.refundable ?? false,
    }))
    return { success: true, payments }
  } catch (err: any) {
    // Silently fail — no payment history yet is normal
    return { success: true, payments: [] }
  }
}