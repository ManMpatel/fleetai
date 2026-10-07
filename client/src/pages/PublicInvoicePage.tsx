import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { buildInvoicePDF, safeInvoiceColor, fmtAmt } from './InvoicePage'
import type { Template, LineItem } from './InvoicePage'

// PUBLIC page — opened by a customer from the link in an emailed invoice. No login.
// Styled with plain colours (not the dashboard theme) so it always looks the same.

type GstMode = 'none' | 'included' | 'added'

interface PublicInvoice {
  number: number
  billToName: string
  billToAddress: string
  customerId: string
  terms: string
  invoiceDate: string
  serviceDate: string
  kilometres: string
  rego: string
  lineItems: { description: string; days: number; unitPrice: number; amount: number }[]
  subtotal: number
  gst: number
  total: number
  gstMode: GstMode
  balancePaid: boolean
  source: string
}

interface PublicTemplate {
  businessName: string
  address: string
  phone: string
  email: string
  abn: string
  bankName: string
  bsb: string
  account: string
  color: string
  logoBase64: string
}

const GRAY = '#6b7280'

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: GRAY, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function TotalRow({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '5px 0', fontSize: strong ? 17 : 14, fontWeight: strong ? 700 : 400, color: strong ? color : '#374151' }}>
      <span>{label}</span><span>{value}</span>
    </div>
  )
}

export default function PublicInvoicePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<{ invoice: PublicInvoice; template: PublicTemplate } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // A customer's invoice must never end up in a search engine.
  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.appendChild(robots)
    return () => { document.head.removeChild(robots) }
  }, [])

  useEffect(() => {
    if (!token) { setState('missing'); return }
    let cancelled = false
    setState('loading')
    axios.get(`/api/public/invoice/${encodeURIComponent(token)}`)
      .then(res => {
        if (cancelled) return
        setData(res.data)
        setState('ready')
        document.title = `Invoice #${res.data.invoice.number} — ${res.data.template.businessName}`
      })
      .catch(err => {
        if (!cancelled) setState(err?.response?.status === 404 ? 'missing' : 'error')
      })
    return () => { cancelled = true }
  }, [token, attempt])

  async function downloadPdf() {
    if (!data) return
    setBusy(true)
    try {
      const { invoice: inv, template: t } = data
      const tmpl: Template = {
        _id: '', name: t.businessName, usageCount: 0,
        logoBase64: t.logoBase64 || undefined,
        businessName: t.businessName, address: t.address, phone: t.phone, email: t.email,
        abn: t.abn, bankName: t.bankName, bsb: t.bsb, account: t.account, color: t.color,
      }
      const lineItems: LineItem[] = inv.lineItems.map(l => ({
        description: l.description, days: String(l.days), unitPrice: l.unitPrice.toFixed(2), amount: l.amount,
      }))
      const bytes = await buildInvoicePDF(tmpl, {
        number: inv.number, billToName: inv.billToName, billToAddress: inv.billToAddress,
        customerId: inv.customerId, terms: inv.terms, invoiceDate: inv.invoiceDate,
        hireFrom: '', hireTo: '', rego: inv.rego, lineItems,
        subtotal: inv.subtotal, gst: inv.gst, total: inv.total,
        balancePaid: inv.balancePaid, gstMode: inv.gstMode,
        source: inv.source, serviceDate: inv.serviceDate, kilometres: inv.kilometres,
      })
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Invoice-${inv.number}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (err) {
      console.error(err)
      alert('Sorry, the PDF could not be created. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', padding: '24px 12px', fontFamily: 'Inter, system-ui, sans-serif', color: '#111827' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>{children}</div>
    </div>
  )

  if (state === 'loading') return shell(<p style={{ textAlign: 'center', color: GRAY, marginTop: 80 }}>Loading invoice…</p>)

  if (state === 'missing') return shell(
    <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center', marginTop: 60, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Invoice not found</h1>
      <p style={{ color: GRAY, margin: 0, lineHeight: 1.6 }}>
        This invoice link is not valid, or the invoice has been removed. Please contact the business that sent it to you.
      </p>
    </div>
  )

  if (state === 'error' || !data) return shell(
    <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center', marginTop: 60, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Something went wrong</h1>
      <p style={{ color: GRAY, margin: '0 0 16px' }}>The invoice could not be loaded. Please try again.</p>
      <button onClick={() => setAttempt(n => n + 1)}
        style={{ padding: '10px 20px', background: '#111827', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
        Try again
      </button>
    </div>
  )

  const { invoice: inv, template: t } = data
  const brand = safeInvoiceColor(t.color || '#d4541a')
  const isService = inv.source === 'service-email'
  const hasBank = !!(t.bankName || t.bsb || t.account)

  return shell(
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={downloadPdf} disabled={busy}
          style={{ padding: '10px 18px', background: brand, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Preparing PDF…' : '↓ Download PDF'}
        </button>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        {/* Header */}
        <div style={{ background: brand, color: '#fff', padding: '20px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            {t.logoBase64 && (
              <div style={{ width: 64, height: 64, background: '#fff', borderRadius: 8, padding: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={`data:image/png;base64,${t.logoBase64}`} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700, wordBreak: 'break-word' }}>{t.businessName}</div>
              {t.address && <div style={{ fontSize: 13, opacity: 0.92, marginTop: 2 }}>{t.address}</div>}
              {(t.phone || t.email) && <div style={{ fontSize: 13, opacity: 0.92 }}>{[t.phone, t.email].filter(Boolean).join('  |  ')}</div>}
            </div>
          </div>
          <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 1 }}>INVOICE</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}># {inv.number}</div>
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Bill to + details */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between' }}>
            <div style={{ minWidth: 180 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: brand, textTransform: 'uppercase' }}>Bill to</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{inv.billToName || '—'}</div>
              {inv.billToAddress && <div style={{ fontSize: 14, color: '#374151' }}>{inv.billToAddress}</div>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
              <Meta label="Invoice date" value={inv.invoiceDate} />
              {isService && <Meta label="Service date" value={inv.serviceDate} />}
              {isService && <Meta label="Kilometres" value={inv.kilometres} />}
              <Meta label="Rego" value={inv.rego} />
              <Meta label="Customer ID" value={inv.customerId} />
              <Meta label="Terms" value={inv.terms} />
            </div>
          </div>

          {/* Line items */}
          <div style={{ overflowX: 'auto', marginTop: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: brand, color: '#fff' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 12 }}>DESCRIPTION</th>
                  <th style={{ textAlign: 'center', padding: '8px 6px', fontSize: 12 }}>QTY</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 12 }}>UNIT PRICE</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 12 }}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {inv.lineItems.map((l, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff', borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '10px' }}>{l.description}</td>
                    <td style={{ padding: '10px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>{l.days}</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtAmt(l.unitPrice)}</td>
                    <td style={{ padding: '10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtAmt(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals + status */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 20 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: brand, textTransform: 'uppercase', marginBottom: 6 }}>Balance</div>
              <span style={{
                display: 'inline-block', padding: '4px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                background: inv.balancePaid ? '#dcfce7' : '#fef3c7', color: inv.balancePaid ? '#166534' : '#92400e',
              }}>
                {inv.balancePaid ? 'Paid' : 'Not paid'}
              </span>
            </div>
            <div style={{ width: '100%', maxWidth: 300 }}>
              {inv.gstMode === 'added' && (
                <>
                  <TotalRow label="Subtotal" value={fmtAmt(inv.subtotal)} />
                  <TotalRow label="GST (10%)" value={fmtAmt(inv.gst)} />
                </>
              )}
              {inv.gstMode === 'included' && <TotalRow label="GST included" value={fmtAmt(inv.gst)} />}
              <div style={{ borderTop: `2px solid ${brand}`, marginTop: 4, paddingTop: 4 }}>
                <TotalRow label={inv.gstMode === 'included' ? 'Total (incl. GST)' : 'Total'} value={fmtAmt(inv.total)} strong color={brand} />
              </div>
            </div>
          </div>

          {/* Bank details */}
          {hasBank && (
            <div style={{ marginTop: 24, padding: '14px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: brand, textTransform: 'uppercase', marginBottom: 6 }}>Bank details</div>
              {t.bankName && <div style={{ fontSize: 14, fontWeight: 600 }}>{t.bankName}</div>}
              {t.bsb && <div style={{ fontSize: 14 }}>BSB: {t.bsb}</div>}
              {t.account && <div style={{ fontSize: 14 }}>Account: {t.account}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ background: brand, color: '#fff', padding: '12px 24px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, fontSize: 14, fontWeight: 600 }}>
          <span>Thank you for your business!</span>
          {t.abn && <span>ABN: {t.abn}</span>}
        </div>
      </div>
    </>
  )
}
