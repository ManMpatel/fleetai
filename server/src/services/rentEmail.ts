import { emailFrame, escapeHtml } from './emailFrame'

// The overdue-rent email: what a renter reads when the owner sends a reminder from the Rent Tracker.
// It is built from the same numbers as the Owing column (rentGrid.ts), so the email and the table
// always agree. No bank details go in it.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

// $1,031.43 - whole cents, written by hand so every machine shows the same.
export function dollars(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100)
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${amount < 0 ? '-' : ''}$${whole}.${String(cents % 100).padStart(2, '0')}`
}

function dateParts(ymd: string): { year: number; month: number; day: number } {
  const k = YMD.exec(ymd)
  if (!k) throw new Error(`Not a date: ${ymd}`)
  return { year: Number(k[1]), month: Number(k[2]) - 1, day: Number(k[3]) }
}

// The end of the week is always a Sunday: 'Sunday 1 November 2026' and 'Sunday 1 Nov'.
export function sundayLong(ymd: string): string {
  const p = dateParts(ymd)
  return `Sunday ${p.day} ${MONTHS[p.month]} ${p.year}`
}
export function sundayShort(ymd: string): string {
  const p = dateParts(ymd)
  return `Sunday ${p.day} ${MONTHS[p.month].slice(0, 3)}`
}

// 19 days = '2 weeks + 5 days', 7 = '1 week', 4 = '4 days'.
export function lengthText(days: number): string {
  const weeks = Math.floor(days / 7)
  const rest = days % 7
  const parts: string[] = []
  if (weeks > 0) parts.push(`${weeks} week${weeks === 1 ? '' : 's'}`)
  if (rest > 0) parts.push(`${rest} day${rest === 1 ? '' : 's'}`)
  return parts.join(' + ')
}

// The name the renter knows the business by: the display name from Settings.
export function businessName(org: { displayName?: string; name?: string; email: string }): string {
  return (org.displayName || '').trim() || (org.name || '').trim() || org.email
}

export interface OverdueEmailInput {
  business: string      // the business name
  loginEmail: string    // the owner's login email (replies come here)
  phone: string         // the business phone; '' = none saved
  renterName: string
  plate: string
  weeklyRent: number    // dollars
  dueDays: number       // days of rent counted in "due" (see rentGrid.ts)
  due: number           // rent due up to the end of this week
  paid: number          // all the money received from this renter
  owing: number         // due - paid
  sunday: string        // 'YYYY-MM-DD', the Sunday that ends this week
  test?: boolean        // the "Send me a test" copy for the owner
}

export interface BuiltEmail { subject: string; html: string; text: string }

export function buildOverdueEmail(i: OverdueEmailInput): BuiltEmail {
  const e = escapeHtml
  const who = i.renterName.trim() || 'Hello'
  const length = lengthText(i.dueDays)
  const subject = `${i.test ? '[TEST] ' : ''}URGENT: RENT OVERDUE - ${i.business}`
  const contactHtml = e(i.loginEmail) + (i.phone ? ` &nbsp;&middot;&nbsp; <span style="white-space:nowrap;">${e(i.phone)}</span>` : '')
  const paidHtml = i.paid > 0 ? `&minus; ${dollars(i.paid)}` : dollars(i.paid)
  const cell = 'padding:11px 14px;'
  const line = 'border-top:1px solid #EEF0F4;'

  const testRow = i.test
    ? `<tr><td align="center" style="background-color:#FEF3C7;border-bottom:1px solid #FDE68A;padding:9px 20px;font-size:12.5px;font-weight:700;color:#92400E;">TEST EMAIL &middot; only you got this. ${e(who)} was not emailed.</td></tr>\n`
    : ''
  const receiptHtml = i.phone
    ? `<p style="margin:0 0 22px;">If you have already made the payment, send the receipt on <strong style="white-space:nowrap;">${e(i.phone)}</strong> straight away.</p>\n`
    : ''

  const bodyHtml = `${testRow}<tr><td align="center" style="padding:28px 28px 4px;">
<div style="font-size:30px;line-height:1.15;font-weight:800;color:#0F172A;letter-spacing:-0.4px;">${e(i.business)}</div>
<div style="font-size:13px;color:#64748B;margin-top:6px;">${contactHtml}</div>
</td></tr>
<tr><td align="center" style="padding:18px 28px 6px;">
<div style="display:inline-block;background-color:#FEE2E2;color:#B91C1C;font-size:13px;font-weight:800;letter-spacing:2px;padding:7px 16px;border-radius:999px;">URGENT &middot; RENT OVERDUE</div>
</td></tr>
<tr><td style="padding:20px 30px 6px 30px;font-size:15.5px;line-height:1.6;">
<p style="margin:0 0 14px;"><strong>${e(who)},</strong></p>
<p style="margin:0 0 20px;">Your rent for vehicle <strong>${e(i.plate)}</strong> up to <strong>${sundayLong(i.sunday)}</strong> has <strong>NOT</strong> been paid in full. This payment is <strong style="color:#DC2626;">OVERDUE</strong>.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E5E7EB;border-radius:8px;border-collapse:separate;border-spacing:0;font-size:14.5px;">
<tr><td style="${cell}color:#6B7280;">Weekly rent</td><td align="right" nowrap="nowrap" style="${cell}white-space:nowrap;font-weight:600;">${dollars(i.weeklyRent)}</td></tr>
<tr><td style="${cell}${line}color:#6B7280;">Rent due up to ${sundayShort(i.sunday)}${length ? `<br><span style="font-size:12px;color:#9CA3AF;">${length}</span>` : ''}</td><td align="right" nowrap="nowrap" style="${cell}white-space:nowrap;${line}font-weight:600;">${dollars(i.due)}</td></tr>
<tr><td style="${cell}${line}color:#6B7280;">Paid so far</td><td align="right" nowrap="nowrap" style="${cell}white-space:nowrap;${line}font-weight:600;">${paidHtml}</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;"><tr><td align="center" bgcolor="#DC2626" style="background-color:#DC2626;border-radius:10px;padding:22px 16px;color:#ffffff;">
<div style="font-size:13px;letter-spacing:2.5px;font-weight:800;">AMOUNT OVERDUE</div>
<div style="font-size:46px;font-weight:800;line-height:1.15;margin:6px 0 4px;">${dollars(i.owing)}</div>
<div style="font-size:17px;font-weight:800;letter-spacing:4px;">PAY TODAY</div>
</td></tr></table>
<p style="margin:0 0 14px;">You must pay the full amount today. If payment is not received, ${e(i.business)} may take further action as set out in your rental agreement, including ending your rental.</p>
${receiptHtml}<p style="margin:0 0 24px;font-weight:700;">${e(i.business)}</p>
</td></tr>`

  const html = emailFrame({
    title: subject,
    preheader: `Rent for ${i.plate} is overdue: ${dollars(i.owing)}. Please pay today.`,
    bodyHtml,
    footerHtml: `You get this email because you rent a vehicle from ${e(i.business)}.`,
  })

  const text = [
    ...(i.test ? [`TEST EMAIL - only you got this. ${who} was not emailed.`, ''] : []),
    'URGENT - RENT OVERDUE',
    '',
    i.business,
    [i.loginEmail, i.phone].filter(Boolean).join(' | '),
    '',
    `${who},`,
    '',
    `Your rent for vehicle ${i.plate} up to ${sundayLong(i.sunday)} has NOT been paid in full. This payment is OVERDUE.`,
    '',
    `Weekly rent: ${dollars(i.weeklyRent)}`,
    `Rent due up to ${sundayShort(i.sunday)}${length ? ` (${length})` : ''}: ${dollars(i.due)}`,
    `Paid so far: ${i.paid > 0 ? '- ' : ''}${dollars(i.paid)}`,
    '',
    `AMOUNT OVERDUE: ${dollars(i.owing)}`,
    'PAY TODAY',
    '',
    `You must pay the full amount today. If payment is not received, ${i.business} may take further action as set out in your rental agreement, including ending your rental.`,
    ...(i.phone ? ['', `If you have already made the payment, send the receipt on ${i.phone} straight away.`] : []),
    '',
    i.business,
    '',
    '--',
    'Sent with FleetAI - fleetai.co.in',
    `You get this email because you rent a vehicle from ${i.business}.`,
  ].join('\n')

  return { subject, html, text }
}
