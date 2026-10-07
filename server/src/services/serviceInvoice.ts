import crypto from 'crypto'
import mongoose from 'mongoose'
import Invoice from '../models/Invoice'
import InvoiceTemplate from '../models/InvoiceTemplate'
import Renter from '../models/Renter'
import type { IOrganization } from '../models/Organization'
import type { IServiceRecord } from '../models/ServiceRecord'

// Creates the invoice that is attached (as a link) to an emailed service record, and builds the
// invoice box shown inside that email. Nothing here is used by the normal Invoices tab.

// ── GST ─────────────────────────────────────────────────────────
export type GstMode = 'none' | 'included' | 'added'
export const GST_MODES: GstMode[] = ['none', 'included', 'added']

// Same rounding the Invoices tab has always used, so the figures match everywhere.
const round2 = (n: number) => Math.round(n * 100) / 100

export function computeTotals(sum: number, mode: GstMode) {
  const base = round2(sum)
  if (mode === 'added') {
    const gst = round2(base * 0.1)
    return { subtotal: base, gst, total: round2(base + gst) }
  }
  if (mode === 'included') {
    const gst = round2(base / 11)
    return { subtotal: round2(base - gst), gst, total: base }
  }
  return { subtotal: base, gst: 0, total: base }
}

// ── Template colour (same rules as the invoice PDF) ─────────────
const DEFAULT_COLOR = '#d4541a'

function hexToRgb(hex: string | undefined): [number, number, number] {
  const h = /^#[0-9a-fA-F]{6}$/.test(hex || '') ? (hex as string).slice(1) : DEFAULT_COLOR.slice(1)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

// Very light colours are darkened until white text on top of them is readable.
export function safeInvoiceColor(hex: string | undefined): string {
  let c = hexToRgb(hex)
  for (let i = 0; i < 30 && luminance(c) > 0.30; i++) {
    c = [Math.round(c[0] * 0.9), Math.round(c[1] * 0.9), Math.round(c[2] * 0.9)]
  }
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}

// ── Small helpers ───────────────────────────────────────────────
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

const money = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatAuDate(d: Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }
  try {
    return new Intl.DateTimeFormat('en-AU', { ...opts, timeZone }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-AU', { ...opts, timeZone: 'Australia/Sydney' }).format(d)
  }
}

function formatKm(km?: string): string {
  const v = (km || '').trim()
  if (!v) return ''
  return /^\d[\d,]*$/.test(v) ? `${v} km` : v
}

const newToken = () => crypto.randomBytes(18).toString('base64url')

export function publicInvoiceUrl(token: string): string {
  const base = (process.env.APP_URL || 'https://fleetai.co.in').replace(/\/+$/, '')
  return `${base}/view-invoice/${token}`
}

// ── Lines ───────────────────────────────────────────────────────
export interface InvoiceLine { description: string; days: number; unitPrice: number; amount: number }

const MAX_INVOICE_LINES = 7 // the invoice PDF has room for 7 rows

const SERVICE_LABELS: Record<string, string> = {
  oil_change: 'Oil change',
  tyres: 'Tyres',
  brakes: 'Brakes',
  general: 'General service',
  other: 'Service',
}

export function buildServiceLines(
  record: Pick<IServiceRecord, 'items' | 'cost' | 'description' | 'serviceType'>,
): InvoiceLine[] {
  const items = (record.items || []).filter(i => i && String(i.name || '').trim())
  const itemSum = round2(items.reduce((s, i) => s + (Number(i.price) || 0), 0))
  let lines: InvoiceLine[] = []

  if (items.length > 0 && itemSum > 0) {
    lines = items.map(i => {
      const price = round2(Number(i.price) || 0)
      return { description: String(i.name).trim().slice(0, 56), days: 1, unitPrice: price, amount: price }
    })
  } else {
    const cost = round2(Number(record.cost) || 0)
    if (cost > 0) {
      const names = items.map(i => String(i.name).trim()).join(', ')
      const description = (
        names || (record.description || '').trim() || SERVICE_LABELS[record.serviceType || 'general'] || 'Service'
      ).slice(0, 56)
      lines = [{ description, days: 1, unitPrice: cost, amount: cost }]
    }
  }

  // The PDF only has room for 7 rows. Fold the overflow into the last row so what is printed
  // always adds up to the total.
  if (lines.length > MAX_INVOICE_LINES) {
    const rest = lines.slice(MAX_INVOICE_LINES - 1)
    const restSum = round2(rest.reduce((s, l) => s + l.amount, 0))
    lines = [
      ...lines.slice(0, MAX_INVOICE_LINES - 1),
      { description: `Other items (${rest.length})`, days: 1, unitPrice: restSum, amount: restSum },
    ]
  }
  return lines
}

async function resolveBillToName(
  orgId: mongoose.Types.ObjectId,
  record: IServiceRecord,
  toEmail: string,
): Promise<string> {
  const direct = (record.customerName || '').trim()
  if (direct) return direct.slice(0, 80)

  const email = (toEmail || '').trim()
  if (email) {
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const renter = await Renter.findOne({ orgId, email: { $regex: `^${escaped}$`, $options: 'i' } }).select('name')
    if (renter?.name) return String(renter.name).slice(0, 80)
  }
  return 'Customer'
}

// ── Create / refresh the invoice for a service record ───────────
export interface ServiceInvoiceOk {
  ok: true
  created: boolean
  invoiceId: any
  templateId: string
  number: number
  subtotal: number
  gst: number
  total: number
  gstMode: GstMode
  balancePaid: boolean
  businessName: string
  color: string // already made safe for white text
  url: string
}
export interface ServiceInvoiceFail { ok: false; status: number; error: string }

/**
 * One service record = one invoice. Sending the same record again refreshes that invoice
 * (same number, same link) instead of creating a second one.
 */
export async function upsertServiceInvoice(args: {
  org: IOrganization
  record: IServiceRecord
  toEmail: string
  templateId?: string
  gstMode: GstMode
  balancePaid: boolean
}): Promise<ServiceInvoiceOk | ServiceInvoiceFail> {
  const { org, record, toEmail, templateId, gstMode, balancePaid } = args
  const orgId = org._id

  // 1. Template — the one picked in the email window, otherwise the business's default.
  let template: any = null
  if (templateId) {
    if (!mongoose.isValidObjectId(templateId)) return { ok: false, status: 400, error: 'Invalid invoice template' }
    template = await InvoiceTemplate.findOne({ _id: templateId, orgId })
    if (!template) return { ok: false, status: 404, error: 'Invoice template not found' }
  } else {
    template =
      (await InvoiceTemplate.findOne({ orgId, isDefault: true })) ||
      (await InvoiceTemplate.findOne({ orgId }).sort({ createdAt: 1 }))
  }
  if (!template) {
    return { ok: false, status: 400, error: 'Create an invoice template first (Invoices page → New Template)' }
  }

  // 2. Lines and totals.
  const lines = buildServiceLines(record)
  const sum = round2(lines.reduce((s, l) => s + l.amount, 0))
  if (sum <= 0) {
    return {
      ok: false,
      status: 400,
      error: 'This service record has no prices, so there is nothing to invoice. Add prices (Edit) or send it without an invoice.',
    }
  }
  const { subtotal, gst, total } = computeTotals(sum, gstMode)

  // 3. Save.
  const tz = org.timezone || 'Australia/Sydney'
  const common = {
    templateId: String(template._id),
    templateName: template.businessName,
    templateSnapshot: {
      businessName: template.businessName,
      address: template.address,
      phone: template.phone,
      email: template.email,
      abn: template.abn,
      bankName: template.bankName,
      bsb: template.bsb,
      account: template.account,
      color: template.color,
    },
    billToName: await resolveBillToName(orgId, record, toEmail),
    rego: record.plate,
    serviceDate: formatAuDate(new Date(record.date), tz),
    kilometres: formatKm(record.kilometres),
    lineItems: lines,
    subtotal, gst, total, gstMode, balancePaid,
  }

  let invoice: any = await Invoice.findOne({ orgId, source: 'service-email', serviceRecordId: String(record._id) })
  let created = false
  if (invoice) {
    invoice.set(common)
    if (!invoice.publicToken) invoice.publicToken = newToken()
    await invoice.save()
  } else {
    const last = await Invoice.findOne({ orgId }).sort({ number: -1 }).select('number')
    invoice = await Invoice.create({
      orgId,
      ...common,
      number: last ? last.number + 1 : 3001,
      billToAddress: '',
      customerId: '',
      terms: '',
      invoiceDate: formatAuDate(new Date(), tz),
      source: 'service-email',
      serviceRecordId: String(record._id),
      publicToken: newToken(),
    })
    created = true
    await InvoiceTemplate.updateOne({ _id: template._id, orgId }, { $inc: { usageCount: 1 } })
  }

  return {
    ok: true,
    created,
    invoiceId: invoice._id,
    templateId: String(template._id),
    number: invoice.number,
    subtotal, gst, total, gstMode, balancePaid,
    businessName: template.businessName,
    color: safeInvoiceColor(template.color),
    url: publicInvoiceUrl(invoice.publicToken),
  }
}

/** Undo a brand-new invoice when the email carrying it could not be sent. */
export async function discardServiceInvoice(orgId: mongoose.Types.ObjectId, r: ServiceInvoiceOk): Promise<void> {
  await Invoice.deleteOne({ _id: r.invoiceId, orgId })
  await InvoiceTemplate.updateOne({ _id: r.templateId, orgId }, { $inc: { usageCount: -1 } })
}

// ── The invoice box inside the email ────────────────────────────
export function invoiceEmailBlock(r: ServiceInvoiceOk): string {
  const row = (label: string, value: string, strong = false) =>
    `<tr>` +
    `<td style="padding:4px 0;font-size:14px;color:${strong ? '#111827' : '#4b5563'};${strong ? 'font-weight:700;' : ''}">${label}</td>` +
    `<td style="padding:4px 0;font-size:14px;text-align:right;color:#111827;${strong ? 'font-weight:700;' : ''}">${value}</td>` +
    `</tr>`

  const rows =
    r.gstMode === 'added'
      ? row('Subtotal', money(r.subtotal)) + row('GST (10%)', money(r.gst)) + row('Total', money(r.total), true)
      : r.gstMode === 'included'
        ? row('GST included', money(r.gst)) + row('Total (incl. GST)', money(r.total), true)
        : row('Total', money(r.total), true)

  const status = r.balancePaid
    ? '<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600">Paid</span>'
    : '<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:600">Not paid</span>'

  return `
    <div style="margin:22px 0 4px;padding:16px 18px;border:1px solid #e5e7eb;border-top:4px solid ${r.color};border-radius:8px">
      <p style="margin:0 0 2px;font-size:16px;font-weight:700;color:#111827">Invoice #${r.number}</p>
      <p style="margin:0 0 12px;font-size:13px;color:#6b7280">${esc(r.businessName)} &nbsp;${status}</p>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <p style="margin:16px 0 0"><a href="${r.url}" style="display:inline-block;padding:10px 20px;background:${r.color};color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600">View invoice</a></p>
      <p style="margin:10px 0 0;font-size:12px;color:#6b7280">You can download a PDF copy from that page. If the button does not work, copy this link:<br/><a href="${r.url}" style="color:#6b7280;word-break:break-all">${r.url}</a></p>
    </div>`
}
