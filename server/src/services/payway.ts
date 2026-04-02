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
      bsb: bsb.replace(/[^0-9]/g, '').replace(/(\d{3})(\d{3})/, '$1-$2'),
      accountNumber,
      accountName,
    })

    const res = await axios.post(
      `${PAYWAY_BASE}/single-use-tokens`,
      params.toString(),
      { headers: getPublishableAuthHeader() }
    )

    console.log(`✅ PayWay token created: ${res.data.singleUseTokenId}`)
    return { success: true, token: res.data.singleUseTokenId }
  } catch (err: any) {
    console.error('❌ PayWay token error:', err.response?.data || err.message)
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
}): Promise<{ success: boolean; customerId?: string; error?: string }> {
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
    bankAccountId: '0000000A',
    customerName: renter.name,
    emailAddress: renter.email || '',
    sendEmailReceipts: 'false',
    phoneNumber: renter.phone,
  })

    const res = await axios.post(
      `${PAYWAY_BASE}/customers`,
      params.toString(),
      { headers: getSecretAuthHeader() }
    )

    const paywayCustomerId = res.data.customerNumber || customerId
    console.log(`✅ PayWay customer created: ${paywayCustomerId}`)
    return { success: true, customerId: paywayCustomerId }
  } catch (err: any) {
    console.error('❌ PayWay createCustomer error:', err.response?.data || err.message)
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

    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: nextDate.toISOString().slice(0, 10),
      regularPrincipalAmount: weeklyAmount.toFixed(2),
      nextPrincipalAmount: weeklyAmount.toFixed(2),
    })

    await axios.put(
      `${PAYWAY_BASE}/customers/${customerId}/schedule`,
      params.toString(),
      { headers: getSecretAuthHeader() }
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
  customerId: string,
  weeklyAmount: number = 10
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    console.log(`⚠️  PayWay not configured — mock pauseDebit for ${customerId}`)
    return { success: true }
  }

  try {
    // PayWay doesn't have a "pause" — we set next payment far in future
    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 1)
    farFuture.setDate(farFuture.getDate() - 1)
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const formattedDate = `${String(farFuture.getDate()).padStart(2,'0')} ${MONTHS[farFuture.getMonth()]} ${farFuture.getFullYear()}`

    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: formattedDate,
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
    const formattedDate = `${String(nextDate.getDate()).padStart(2,'0')} ${MONTHS[nextDate.getMonth()]} ${nextDate.getFullYear()}`

    const params = new URLSearchParams({
      frequency: 'weekly',
      nextPaymentDate: formattedDate,
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
    return { success: true, payments: res.data.data || [] }
  } catch (err: any) {
    // Silently fail — no payment history yet is normal
    return { success: true, payments: [] }
  }
}