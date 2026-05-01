import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// ── Types ──────────────────────────────────────────────────────
interface Template {
  _id: string
  name: string
  logoBase64?: string
  businessName: string
  address: string
  phone: string
  email: string
  abn: string
  bankName: string
  bsb: string
  account: string
  usageCount: number
}

interface LineItem {
  description: string
  days: string
  unitPrice: string
  amount: number
}

interface SavedInvoice {
  _id: string
  number: number
  templateName: string
  billToName: string
  total: number
  createdAt: string
}

const EMPTY_LINE = (): LineItem => ({ description: '', days: '', unitPrice: '', amount: 0 })

function today() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}
function fmtAmt(n: number) {
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
    </div>
  )
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Compress logo before storing ───────────────────────────────
function compressLogo(base64: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 600
      const scale = Math.min(MAX / img.width, MAX / img.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png').split(',')[1])
    }
    img.src = `data:image/png;base64,${base64}`
  })
}

// ── Build full invoice PDF from scratch ────────────────────────
async function buildInvoicePDF(tmpl: Template, params: {
  number: number
  billToName: string
  billToAddress: string
  customerId?: string
  terms?: string
  invoiceDate: string
  hireFrom: string
  hireTo: string
  rego?: string
  lineItems: LineItem[]
  subtotal: number
  gst: number
  total: number
  balancePaid?: boolean
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const W = 595.28, H = 841.89
  const page = pdfDoc.addPage([W, H])

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const ORANGE = rgb(0.831, 0.329, 0.102)
  const BLACK  = rgb(0.173, 0.173, 0.173)
  const GRAY   = rgb(0.533, 0.533, 0.533)
  const WHITE  = rgb(1, 1, 1)
  const LGRAY  = rgb(0.965, 0.965, 0.965)
  const BDGRAY = rgb(0.867, 0.867, 0.867)

  // Fixed section heights
  const HDR_H  = 120
  const BILL_H = 100
  const DATE_H = 55
  const THDR_H = 28
  const TOT_H  = 90
  const BANK_H = 80
  const FOOT_H = 40
  const N_ROWS = 7

  // Row height fills remaining space exactly
  const ROW_H = Math.floor((H - HDR_H - BILL_H - DATE_H - THDR_H - TOT_H - BANK_H - FOOT_H) / N_ROWS)

  const DIV_X = W / 2 + 20
  const COL_W = W / 3

  // Y boundaries (from bottom)
  const hdr_bot  = H - HDR_H
  const bill_bot = hdr_bot - BILL_H
  const date_bot = bill_bot - DATE_H
  const thdr_bot = date_bot - THDR_H
  const rows_bot = thdr_bot - N_ROWS * ROW_H
  const tot_bot  = rows_bot - TOT_H
  const bank_bot = tot_bot  - BANK_H

  const fillRect = (x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y, width: w, height: h, color })

  const borderRect = (x: number, y: number, w: number, h: number) =>
    page.drawRectangle({ x, y, width: w, height: h, borderColor: BDGRAY, borderWidth: 0.5 })

  const ln = (x1: number, y1: number, x2: number, y2: number, color = BDGRAY, thickness = 0.5) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness })

  const txt = (s: string, x: number, y: number, size: number, f = font, color = BLACK) => {
    if (!s?.trim()) return
    page.drawText(s, { x, y, size, font: f, color })
  }
  const txtR = (s: string, rx: number, y: number, size: number, f = font, color = BLACK) => {
    if (!s?.trim()) return
    page.drawText(s, { x: rx - f.widthOfTextAtSize(s, size), y, size, font: f, color })
  }
  const txtC = (s: string, cx: number, y: number, size: number, f = font, color = BLACK) => {
    if (!s?.trim()) return
    page.drawText(s, { x: cx - f.widthOfTextAtSize(s, size) / 2, y, size, font: f, color })
  }

  // ── HEADER ──────────────────────────────────────────────────
  fillRect(0, hdr_bot, W, HDR_H, ORANGE)

  const LX = 14, LY = hdr_bot + 8, LW = 104, LH = 104
  fillRect(LX, LY, LW, LH, WHITE)
  if (tmpl.logoBase64) {
    try {
      const lb = Uint8Array.from(atob(tmpl.logoBase64), c => c.charCodeAt(0))
      const li = tmpl.logoBase64.startsWith('iVBOR')
        ? await pdfDoc.embedPng(lb)
        : await pdfDoc.embedJpg(lb)
      const d = li.scaleToFit(LW - 8, LH - 8)
      page.drawImage(li, {
        x: LX + 4 + (LW - 8 - d.width) / 2,
        y: LY + 4 + (LH - 8 - d.height) / 2,
        width: d.width, height: d.height,
      })
    } catch {}
  }

  const BX = LX + LW + 14
  txt(tmpl.businessName,                    BX, H - 36,  18, fontBold, WHITE)
  txt(tmpl.address,                         BX, H - 52,  9,  font,     WHITE)
  txt(`${tmpl.phone}  |  ${tmpl.email}`,   BX, H - 64,  9,  font,     WHITE)
  txtR('INVOICE',        W - 16, H - 44, 30, fontBold, WHITE)
  txtR(`# ${params.number}`, W - 16, H - 66, 13, fontBold, WHITE)

  // ── BILL TO ──────────────────────────────────────────────────
  fillRect(0, bill_bot, W, BILL_H, WHITE)
  borderRect(0, bill_bot, W, BILL_H)
  ln(DIV_X, hdr_bot - 8, DIV_X, bill_bot + 8)

  txt('BILL TO',            16,        hdr_bot - 18, 7.5,  fontBold, ORANGE)
  txt(params.billToName,    16,        hdr_bot - 34, 12,   fontBold, BLACK)
  txt(params.billToAddress, 16,        hdr_bot - 50, 10,   font,     BLACK)
  txt('CUSTOMER ID',                                    DIV_X + 16, hdr_bot - 18, 7.5, fontBold, ORANGE)
  txt(params.customerId?.trim() || '\u2014',            DIV_X + 16, hdr_bot - 33, 10,  font,     GRAY)
  txt('TERMS',                                          DIV_X + 16, hdr_bot - 53, 7.5, fontBold, ORANGE)
  txt(params.terms?.trim() || '\u2014',                 DIV_X + 16, hdr_bot - 68, 10,  font,     GRAY)

  // ── DATES ────────────────────────────────────────────────────
  fillRect(0, date_bot, W, DATE_H, WHITE)
  borderRect(0, date_bot, W, DATE_H)
  const COL_W4  = W / 4
  const dateVals = [params.invoiceDate, params.hireFrom, params.hireTo, params.rego || '\u2014']
  ;['INVOICE DATE', 'HIRE FROM', 'HIRE TO', 'REGO'].forEach((lbl, i) => {
    const x = i * COL_W4 + 16
    txt(lbl,         x, bill_bot - 17, 7.5, fontBold, ORANGE)
    txt(dateVals[i], x, bill_bot - 35, 11,  font,     BLACK)
    if (i < 3) ln((i + 1) * COL_W4, bill_bot - 4, (i + 1) * COL_W4, date_bot + 4)
  })

  // ── TABLE HEADER ─────────────────────────────────────────────
  fillRect(0, thdr_bot, W, THDR_H, ORANGE)
  txt('DESCRIPTION',   16,     thdr_bot + 9, 8.5, fontBold, WHITE)
  txtC('QUANTITY',     375,    thdr_bot + 9, 8.5, fontBold, WHITE)
  txtC('UNIT PRICE',   455,    thdr_bot + 9, 8.5, fontBold, WHITE)
  txtR('AMOUNT',       W - 16, thdr_bot + 9, 8.5, fontBold, WHITE)

  // ── ROWS — draw background first, then text ───────────────────
  for (let i = 0; i < N_ROWS; i++) {
    const ry = thdr_bot - (i + 1) * ROW_H
    fillRect(0, ry, W, ROW_H, i % 2 === 0 ? LGRAY : WHITE)
    ln(0, ry, W, ry, BDGRAY, 0.4)
  }
  // Table outer border
  borderRect(0, rows_bot, W, thdr_bot + THDR_H - rows_bot)

  // Draw text AFTER all backgrounds
  for (let i = 0; i < N_ROWS; i++) {
    const ry  = thdr_bot - (i + 1) * ROW_H
    const ty  = ry + ROW_H / 2 - 4   // vertically centred
    const li  = params.lineItems[i]
    if (li?.description?.trim()) {
      txt(li.description,        16,     ty, 10.5, font,     BLACK)
      txtC(String(li.days ?? ''), 375,    ty, 10.5, font,     BLACK)
      txtC(`$${li.unitPrice}`,   455,    ty, 10.5, font,     BLACK)
      txtR(fmtAmt(li.amount),    W - 16, ty, 10.5, fontBold, BLACK)
    }
  }

  // ── TOTALS ───────────────────────────────────────────────────
  fillRect(0, tot_bot, W, TOT_H, WHITE)
  borderRect(0, tot_bot, W, TOT_H)
  ln(DIV_X, rows_bot - 2, W - 16, rows_bot - 2, ORANGE, 1)
  txt('Subtotal',            DIV_X + 16, rows_bot - 24, 10,   font,     GRAY)
  txtR(fmtAmt(params.subtotal), W - 16, rows_bot - 24, 10,   font,     BLACK)
  txt('GST (10%)',           DIV_X + 16, rows_bot - 44, 10,   font,     GRAY)
  txtR(fmtAmt(params.gst),      W - 16, rows_bot - 44, 10,   font,     BLACK)
  ln(DIV_X + 16, rows_bot - 54, W - 16, rows_bot - 54, BDGRAY, 0.5)
  txt('TOTAL',               DIV_X + 16, rows_bot - 72, 13,   fontBold, ORANGE)
  txtR(fmtAmt(params.total),    W - 16, rows_bot - 72, 13,   fontBold, ORANGE)

  // ── BANK + BALANCE ───────────────────────────────────────────
  fillRect(0, bank_bot, W, BANK_H, WHITE)
  borderRect(0, bank_bot, W, BANK_H)
  ln(DIV_X, tot_bot - 6, DIV_X, bank_bot + 6)
  txt('BANK DETAILS',         16,        tot_bot - 16, 7.5,  fontBold, ORANGE)
  txt(tmpl.bankName,          16,        tot_bot - 30, 11,   fontBold, BLACK)
  txt(`BSB: ${tmpl.bsb}`,     16,        tot_bot - 46, 10,   font,     BLACK)
  txt(`Account: ${tmpl.account}`, 16,    tot_bot - 60, 10,   font,     BLACK)
  txt('BALANCE',          DIV_X + 16, tot_bot - 16, 7.5,  fontBold, ORANGE)
  txt(fmtAmt(params.total), DIV_X + 16, tot_bot - 40, 20,   fontBold, ORANGE)
  const balLabel = params.balancePaid === false ? 'Balance Pending' : 'Balance Paid'
  const balColor = params.balancePaid === false ? ORANGE : GRAY
  txt(balLabel,           DIV_X + 16, tot_bot - 62, 10,   font,     balColor)

  // ── FOOTER pinned to bottom ───────────────────────────────────
  fillRect(0, 0, W, FOOT_H, ORANGE)
  txt('Thank you for your business!', 16,     14, 12,  fontBold, WHITE)
  txtR(`ABN: ${tmpl.abn}`,            W - 16, 14, 10,  fontBold, WHITE)

  return pdfDoc.save()
}

// ── Default template form state ────────────────────────────────
const emptyTmplForm = () => ({
  logoBase64: '', businessName: '', address: '', phone: '',
  email: '', abn: '', bankName: '', bsb: '', account: '',
})

// ── Page ───────────────────────────────────────────────────────
export default function InvoicePage() {
  const [tab, setTab]               = useState<'new'|'past'>('new')
  const [templates, setTemplates]   = useState<Template[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [tLoading, setTLoading]     = useState(true)
  const [invNumber, setInvNumber]   = useState(3001)
  const [pastInvoices, setPast]     = useState<SavedInvoice[]>([])
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [previewBlob, setPreview]   = useState<string|null>(null)
  const [pendingBytes, setPending]  = useState<Uint8Array|null>(null)
  const [pendingForm, setPendForm]  = useState<any>(null)
  const [toast, setToast]           = useState('')
  const [deleting, setDeleting]     = useState<string|null>(null)

  // Template form
  const [showTmplForm, setShowTmplForm] = useState(false)
  const [tmplForm, setTmplForm]     = useState(emptyTmplForm())
  const [tmplSaving, setTmplSaving] = useState(false)

  // Invoice form
  const [billToName,    setBillToName]    = useState('')
  const [billToAddress, setBillToAddress] = useState('')
  const [customerId,    setCustomerId]    = useState('')
  const [terms,         setTerms]         = useState('')
  const [invoiceDate,   setInvoiceDate]   = useState(today())
  const [hireFrom,      setHireFrom]      = useState('')
  const [hireTo,        setHireTo]        = useState('')
  const [rego,          setRego]          = useState('')
  const [balancePaid, setBalancePaid]     = useState(true)
  const [lineItems, setLineItems]         = useState<LineItem[]>([EMPTY_LINE(), EMPTY_LINE()])

  const logoRef = useRef<HTMLInputElement>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  const selectedTmpl = templates.find(t => t._id === selectedId) || null

  // ── Fetch ────────────────────────────────────────────────────
  async function fetchAll() {
    try {
      setTLoading(true)
      const [tr, ir, nr] = await Promise.all([
        axios.get('/api/invoices/templates'),
        axios.get('/api/invoices'),
        axios.get('/api/invoices/next-number'),
      ])
      setTemplates(tr.data)
      setPast(ir.data)
      setInvNumber(nr.data.number)
      if (tr.data.length > 0 && !selectedId) setSelectedId(tr.data[0]._id)
    } catch { showToast('Failed to load') }
    finally  { setTLoading(false) }
  }

  useEffect(() => { fetchAll() }, [])

  // ── Logo upload ──────────────────────────────────────────────
  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const raw = (reader.result as string).split(',')[1]
      const compressed = await compressLogo(raw)
      setTmplForm(p => ({ ...p, logoBase64: compressed }))
    }
    reader.readAsDataURL(file)
    if (logoRef.current) logoRef.current.value = ''
  }

  // ── Save template ────────────────────────────────────────────
  async function saveTemplate() {
    if (!tmplForm.businessName.trim()) return showToast('Business name required')
    setTmplSaving(true)
    try {
      const res = await axios.post('/api/invoices/templates', tmplForm)
      setTemplates(p => [res.data, ...p])
      setSelectedId(res.data._id)
      setShowTmplForm(false)
      setTmplForm(emptyTmplForm())
      showToast('Template saved')
    } catch { showToast('Failed to save template') }
    finally  { setTmplSaving(false) }
  }

  // ── Delete template ──────────────────────────────────────────
  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template?')) return
    setDeleting(id)
    try {
      await axios.delete(`/api/invoices/templates/${id}`)
      setTemplates(p => p.filter(t => t._id !== id))
      if (selectedId === id) setSelectedId(templates.find(t => t._id !== id)?._id || '')
      showToast('Deleted')
    } catch { showToast('Delete failed') }
    finally  { setDeleting(null) }
  }

  // ── Line items ───────────────────────────────────────────────
  function updateItem(i: number, field: keyof LineItem, val: string) {
    setLineItems(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: val }
      next[i].amount = (parseFloat(next[i].days) || 0) * (parseFloat(next[i].unitPrice) || 0)
      return next
    })
  }

  const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
  const gst      = Math.round(subtotal * 0.1 * 100) / 100
  const total    = Math.round((subtotal + gst) * 100) / 100

  // ── Generate ─────────────────────────────────────────────────
  async function handleGenerate() {
    if (!selectedTmpl)                              return showToast('Select a template first')
    if (!billToName.trim())                         return showToast('Bill To name required')
    if (lineItems.every(li => !li.description.trim())) return showToast('Add at least one line item')
    setGenerating(true)
    try {
      const form = {
        templateId:   selectedTmpl._id,
        templateName: selectedTmpl.businessName,
        number: invNumber,
        billToName, billToAddress, customerId, terms,
        invoiceDate, hireFrom, hireTo, rego,
        lineItems: lineItems.filter(li => li.description.trim()),
        subtotal, gst, total, balancePaid,
      }
      const bytes = await buildInvoicePDF(selectedTmpl, form)
      const blob  = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      setPreview(URL.createObjectURL(blob))
      setPending(bytes)
      setPendForm(form)
    } catch (err) {
      console.error(err)
      showToast('Failed to generate PDF')
    } finally { setGenerating(false) }
  }

  // ── Download ──────────────────────────────────────────────────
  async function handleDownload() {
    if (!pendingBytes || !pendingForm) return
    setSaving(true)
    try {
      await axios.post('/api/invoices', pendingForm)
      const blob = new Blob([pendingBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const a    = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      a.download = `Invoice-${pendingForm.number}-${pendingForm.billToName.replace(/\s+/g,'-')}.pdf`
      a.click()
      setInvNumber(n => n + 1)
      await fetchAll()
      showToast('Saved & downloaded')
    } catch { showToast('Save failed') }
    finally { setSaving(false) }
  }

  async function handlePrint() {
    if (!pendingBytes || !pendingForm) return
    setSaving(true)
    try {
      await axios.post('/api/invoices', pendingForm)
      const blob = new Blob([pendingBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const win  = window.open(URL.createObjectURL(blob))
      win?.addEventListener('load', () => win.print())
      setInvNumber(n => n + 1)
      await fetchAll()
      showToast('Saved')
    } catch { showToast('Save failed') }
    finally { setSaving(false) }
  }

  function closePreview() {
    if (previewBlob) URL.revokeObjectURL(previewBlob)
    setPreview(null); setPending(null); setPendForm(null)
  }

  // ── Re-download past invoice ───────────────────────────────────
  async function reDownload(inv: SavedInvoice) {
    try {
      const { data: full } = await axios.get(`/api/invoices/${inv._id}`)
      const tmpl = templates.find(t => t._id === full.templateId)
      if (!tmpl) return showToast('Template deleted — cannot regenerate')
      const bytes = await buildInvoicePDF(tmpl, full)
      const blob  = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const a     = document.createElement('a')
      a.href      = URL.createObjectURL(blob)
      a.download  = `Invoice-${inv.number}.pdf`
      a.click()
    } catch { showToast('Re-download failed') }
  }

  

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text-primary shadow-sm">{toast}</div>
      )}

      {/* Preview modal */}
      {previewBlob && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="flex items-center justify-between px-6 py-3 bg-surface border-b border-border shrink-0">
            <span className="font-semibold text-text-primary">Preview — Invoice #{pendingForm?.number}</span>
            <div className="flex items-center gap-3">
              <button onClick={handlePrint} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm text-text-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-40">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print
              </button>
              <button onClick={handleDownload} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-40">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {saving ? 'Saving...' : 'Download PDF'}
              </button>
              <button onClick={closePreview} className="px-3 py-2 text-sm text-text-muted hover:text-text-primary">✕ Close</button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe src={previewBlob} className="w-full h-full border-0" title="Invoice Preview" />
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary">Invoices</h1>
        <p className="text-text-muted text-sm mt-0.5">Generate professional invoices for your business</p>
      </div>

      <div className="flex gap-5">

        {/* ── Left: Templates ─────────────────────────────── */}
        <div className="w-[230px] shrink-0 space-y-3">
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold text-text-primary">Templates</span>
            </div>
            <div className="p-3 space-y-2">
              <button onClick={() => setShowTmplForm(true)}
                className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-border rounded-lg text-xs text-text-muted hover:border-accent hover:text-accent transition-colors">
                + New Template
              </button>

              {tLoading ? (
                <div className="py-4 text-center text-xs text-text-muted">Loading...</div>
              ) : templates.length === 0 ? (
                <div className="py-4 text-center text-xs text-text-muted">No templates yet</div>
              ) : templates.map(t => (
                <div key={t._id} onClick={() => setSelectedId(t._id)}
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg cursor-pointer transition-colors border ${
                    selectedId === t._id ? 'border-accent bg-accent/5' : 'border-transparent hover:bg-surface2'
                  }`}>
                  <div className="w-10 h-10 rounded-lg bg-surface2 border border-border shrink-0 overflow-hidden flex items-center justify-center">
                    {t.logoBase64
                      ? <img src={`data:image/png;base64,${t.logoBase64}`} className="w-full h-full object-contain" />
                      : <span className="text-xl">🏢</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{t.businessName}</p>
                    <p className="text-[11px] text-text-muted">Used {t.usageCount}×</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); deleteTemplate(t._id) }}
                    disabled={deleting === t._id}
                    className="text-text-muted hover:text-red-400 transition-colors shrink-0 disabled:opacity-30 text-sm">✕</button>
                </div>
              ))}

              <p className="text-[10px] text-text-muted text-center pt-1 leading-relaxed">
                Last 20 invoices saved per owner
              </p>
            </div>
          </div>
        </div>

        {/* ── Right ───────────────────────────────────────── */}
        <div className="flex-1">

          {/* Template form panel */}
          {showTmplForm && (
            <div className="bg-surface border border-border rounded-xl p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-text-primary">New Template</h2>
                <button onClick={() => { setShowTmplForm(false); setTmplForm(emptyTmplForm()) }}
                  className="text-text-muted hover:text-text-primary text-sm">✕ Cancel</button>
              </div>

              {/* Logo */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">Logo</label>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-xl bg-surface2 border border-border flex items-center justify-center overflow-hidden shrink-0">
                    {tmplForm.logoBase64
                      ? <img src={`data:image/png;base64,${tmplForm.logoBase64}`} className="w-full h-full object-contain" />
                      : <span className="text-2xl">🏢</span>}
                  </div>
                  <div>
                    <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    <button onClick={() => logoRef.current?.click()}
                      className="px-3 py-1.5 border border-border rounded-lg text-xs text-text-secondary hover:border-accent hover:text-accent transition-colors">
                      Upload Logo (PNG/JPG)
                    </button>
                    <p className="text-[11px] text-text-muted mt-1">Recommended: square image, white background</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label="Business Name *" value={tmplForm.businessName} onChange={(v: string) => setTmplForm(p => ({...p, businessName: v}))} placeholder="Desi Boys Rental" />
                <Field label="Address" value={tmplForm.address} onChange={(v: string) => setTmplForm(p => ({...p, address: v}))} placeholder="5/247-249 Rawson St, Auburn NSW 2144" />
                <Field label="Phone" value={tmplForm.phone} onChange={(v: string) => setTmplForm(p => ({...p, phone: v}))} placeholder="0439 233 004" />
                <Field label="Email" value={tmplForm.email} onChange={(v: string) => setTmplForm(p => ({...p, email: v}))} placeholder="info@desiboysrental.com" />
                <Field label="ABN" value={tmplForm.abn} onChange={(v: string) => setTmplForm(p => ({...p, abn: v}))} placeholder="91 639 442 541" />
                <Field label="Bank Name" value={tmplForm.bankName} onChange={(v: string) => setTmplForm(p => ({...p, bankName: v}))} placeholder="Desi Boys Rental" />
                <Field label="BSB" value={tmplForm.bsb} onChange={(v: string) => setTmplForm(p => ({...p, bsb: v}))} placeholder="032 065" />
                <Field label="Account Number" value={tmplForm.account} onChange={(v: string) => setTmplForm(p => ({...p, account: v}))} placeholder="352 812" />
              </div>

              <button onClick={saveTemplate} disabled={tmplSaving}
                className="w-full py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-40">
                {tmplSaving ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          )}

          {/* Invoice builder */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="flex items-center border-b border-border px-5">
              {(['new','past'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`py-3.5 px-4 text-sm font-medium border-b-2 transition-colors mr-1 ${
                    tab === t ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}>
                  {t === 'new' ? 'New Invoice' : `Past Invoices (${pastInvoices.length})`}
                </button>
              ))}
              {tab === 'new' && (
                <div className="ml-auto flex items-center gap-2 py-2">
                  <div className="text-xs font-medium px-3 py-1.5 rounded-lg bg-accent/10 text-accent border border-accent/20">
                    # {invNumber}
                  </div>
                  <button onClick={handleGenerate} disabled={generating || !selectedId}
                    className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors">
                    {generating ? 'Generating...' : 'Generate →'}
                  </button>
                </div>
              )}
            </div>

            {tab === 'new' && (
              <div className="p-5">
                {!selectedId && !tLoading && (
                  <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                    Create a template first using the "New Template" button on the left.
                  </div>
                )}

                {selectedTmpl && (
                  <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-surface2 rounded-lg border border-border w-fit">
                    {selectedTmpl.logoBase64 && (
                      <img src={`data:image/png;base64,${selectedTmpl.logoBase64}`} className="w-6 h-6 object-contain rounded" />
                    )}
                    <span className="text-xs font-medium text-text-primary">{selectedTmpl.businessName}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <Field label="Bill To — Name" value={billToName} onChange={setBillToName} placeholder="Sydney Auto Warehouse" />
                  <Field label="Bill To — Address" value={billToAddress} onChange={setBillToAddress} placeholder="12 Main St, Sydney NSW 2000" />
                  <Field label="Customer ID (optional)" value={customerId} onChange={setCustomerId} placeholder="e.g. CUST-001" />
                  <Field label="Terms (optional)" value={terms} onChange={setTerms} placeholder="e.g. Net 30" />
                </div>
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <Field label="Invoice Date" value={invoiceDate} onChange={setInvoiceDate} placeholder="DD/MM/YYYY" />
                  <Field label="Hire From" value={hireFrom} onChange={setHireFrom} placeholder="DD/MM/YYYY" />
                  <Field label="Hire To" value={hireTo} onChange={setHireTo} placeholder="DD/MM/YYYY" />
                  <Field label="Rego (optional)" value={rego} onChange={setRego} placeholder="e.g. ERG18P" />
                </div>

                <div className="mb-1 text-xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-2">Line Items</div>
                <table className="w-full mb-3">
                  <thead>
                    <tr>
                      {['Description','Quantity','Unit Price','Amount',''].map(h => (
                        <th key={h} className="text-left text-xs text-text-muted font-medium py-2 px-2 first:pl-0">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="py-1.5 px-2 pl-0 w-[42%]">
                          <input value={li.description} onChange={e => updateItem(i,'description',e.target.value)}
                            placeholder="Description..." className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none" />
                        </td>
                        <td className="py-1.5 px-2 w-[13%]">
                          <input value={li.days} onChange={e => updateItem(i,'days',e.target.value)}
                            type="number" placeholder="0" className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none" />
                        </td>
                        <td className="py-1.5 px-2 w-[16%]">
                          <input value={li.unitPrice} onChange={e => updateItem(i,'unitPrice',e.target.value)}
                            type="number" placeholder="0.00" className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none" />
                        </td>
                        <td className="py-1.5 px-2 w-[18%] text-sm font-medium text-text-primary">
                          {li.amount > 0 ? fmtAmt(li.amount) : '—'}
                        </td>
                        <td className="py-1.5 px-2 w-[7%] text-center">
                          <button onClick={() => setLineItems(p => p.filter((_,idx) => idx !== i))}
                            className="text-text-muted hover:text-red-400 transition-colors text-sm">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={() => setLineItems(p => [...p, EMPTY_LINE()])}
                  className="text-xs text-accent hover:text-accent/80 transition-colors mb-4">+ Add line item</button>

                <div className="flex items-center gap-2 mb-6">
                  <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Balance Status</span>
                  <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                    <button onClick={() => setBalancePaid(true)}
                      className={`px-3 py-1.5 transition-colors ${balancePaid ? 'bg-green text-white' : 'text-text-muted hover:text-text-primary'}`}>
                      ✓ Balance Paid
                    </button>
                    <button onClick={() => setBalancePaid(false)}
                      className={`px-3 py-1.5 border-l border-border transition-colors ${!balancePaid ? 'bg-amber text-white' : 'text-text-muted hover:text-text-primary'}`}>
                      ⏳ Balance Pending
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="w-60 border border-border rounded-xl overflow-hidden">
                    <div className="flex justify-between px-4 py-2.5 text-sm border-b border-border">
                      <span className="text-text-muted">Subtotal</span><span>{fmtAmt(subtotal)}</span>
                    </div>
                    <div className="flex justify-between px-4 py-2.5 text-sm border-b border-border">
                      <span className="text-text-muted">GST (10%)</span><span>{fmtAmt(gst)}</span>
                    </div>
                    <div className="flex justify-between px-4 py-3 text-sm font-semibold bg-surface2">
                      <span className="text-accent">Total</span><span className="text-accent">{fmtAmt(total)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'past' && (
              pastInvoices.length === 0
                ? <div className="py-16 text-center text-text-muted text-sm">No invoices yet.</div>
                : <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          {['#','Template','Bill To','Total','Date',''].map(h => (
                            <th key={h} className="px-5 py-3 text-left text-xs text-text-muted font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pastInvoices.map(inv => (
                          <tr key={inv._id} className="border-b border-border last:border-0 hover:bg-surface2">
                            <td className="px-5 py-3 font-medium">#{inv.number}</td>
                            <td className="px-5 py-3 text-text-muted">{inv.templateName || '—'}</td>
                            <td className="px-5 py-3">{inv.billToName || '—'}</td>
                            <td className="px-5 py-3 font-medium text-accent">{fmtAmt(inv.total || 0)}</td>
                            <td className="px-5 py-3 text-text-muted">{fmtDate(inv.createdAt)}</td>
                            <td className="px-5 py-3">
                              <button onClick={() => reDownload(inv)} className="text-xs text-accent hover:underline">↓ Re-download</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}