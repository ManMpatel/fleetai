import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

interface Template {
  _id: string
  name: string
  usageCount: number
  createdAt: string
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
  invoiceDate: string
  createdAt: string
}

const EMPTY_LINE = (): LineItem => ({ description: '', days: '', unitPrice: '', amount: 0 })

function today() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function fmtAmt(n: number) {
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── PDF generation ────────────────────────────────────────────────────────────
async function buildInvoicePDF(params: {
  templateBase64: string
  number: number
  billToName: string
  billToAddress: string
  invoiceDate: string
  hireFrom: string
  hireTo: string
  lineItems: LineItem[]
  subtotal: number
  gst: number
  total: number
}): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(params.templateBase64), c => c.charCodeAt(0))
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pages = pdfDoc.getPages()
  const page = pages[0]
  const { width, height } = page.getSize()

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const black = rgb(0, 0, 0)
  const white = rgb(1, 1, 1)
  const orange = rgb(0.91, 0.376, 0.11)

  const draw = (text: string, x: number, y: number, size = 10, bold = false, color = black) => {
    page.drawText(text, { x, y, size, font: bold ? fontBold : font, color })
  }

  // Invoice number — right aligned, white on orange header
  page.drawText(`# ${params.number}`, {
    x: width - 16 - font.widthOfTextAtSize(`# ${params.number}`, 12),
    y: 783.9, size: 12, font: fontBold, color: white,
  })

  // Bill To
  draw(params.billToName,    16, height - 689.9, 11, true)
  draw(params.billToAddress, 16, height - 674.9,  9)
  
  // Dates
  draw(params.invoiceDate,   16,        height - 589.9, 10)
  draw(params.hireFrom,      214,       height - 589.9, 10)
  draw(params.hireTo,        413,       height - 589.9, 10)

  // Line items
  const ROW_START_Y = 529.9
  const ROW_H       = 28
  params.lineItems
    .filter(li => li.description.trim())
    .forEach((li, i) => {
      const y = ROW_START_Y - i * ROW_H
      draw(li.description, 16,  height - y, 9)
      // Days — centred around x=375
      const daysW = font.widthOfTextAtSize(li.days, 9)
      page.drawText(li.days, { x: 375 - daysW / 2, y, size: 9, font, color: black })
      // Unit price — centred around x=445
      const upStr = `$${li.unitPrice}`
      const upW   = font.widthOfTextAtSize(upStr, 9)
      page.drawText(upStr, { x: 445 - upW / 2, y, size: 9, font, color: black })
      // Amount — right aligned
      const amtStr = fmtAmt(li.amount)
      const amtW   = fontBold.widthOfTextAtSize(amtStr, 9)
      page.drawText(amtStr, { x: width - 16 - amtW, y, size: 9, font: fontBold, color: black })
    })

  // Totals — right aligned
  const rAlign = (text: string, y: number, size = 9, bold = false, col = black) => {
    const f   = bold ? fontBold : font
    const tw  = f.widthOfTextAtSize(text, size)
    page.drawText(text, { x: width - 16 - tw, y, size, font: f, color: col })
  }
  rAlign(fmtAmt(params.subtotal), 415.9)
  rAlign(fmtAmt(params.gst),      397.9)
  rAlign(fmtAmt(params.total),    369.9, 12, true, orange)

  // Balance
  draw(fmtAmt(params.total), 334, height - 319.9, 18, true, orange)

  return pdfDoc.save()
}

// ─────────────────────────────────────────────────────────────────────────────

export default function InvoicePage() {
  const [tab, setTab]                 = useState<'new' | 'past'>('new')
  const [templates, setTemplates]     = useState<Template[]>([])
  const [selectedTmpl, setSelectedTmpl] = useState<string>('')
  const [tLoading, setTLoading]       = useState(true)
  const [invNumber, setInvNumber]     = useState(3001)
  const [pastInvoices, setPastInvoices] = useState<SavedInvoice[]>([])
  const [generating, setGenerating]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [previewBlob, setPreviewBlob] = useState<string | null>(null)
  const [pendingBytes, setPendingBytes] = useState<Uint8Array | null>(null)
  const [pendingForm, setPendingForm] = useState<any>(null)
  const [uploading, setUploading]     = useState(false)
  const [toast, setToast]             = useState('')
  const [deleting, setDeleting]       = useState<string | null>(null)

  // Form state
  const [billToName,    setBillToName]    = useState('')
  const [billToAddress, setBillToAddress] = useState('')
  const [invoiceDate,   setInvoiceDate]   = useState(today())
  const [hireFrom,      setHireFrom]      = useState('')
  const [hireTo,        setHireTo]        = useState('')
  const [lineItems, setLineItems]         = useState<LineItem[]>([EMPTY_LINE(), EMPTY_LINE()])

  const fileRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // ── Fetch ──────────────────────────────────────────────
  async function fetchAll() {
    try {
      setTLoading(true)
      const [tr, ir, nr] = await Promise.all([
        axios.get('/api/invoices/templates'),
        axios.get('/api/invoices'),
        axios.get('/api/invoices/next-number'),
      ])
      setTemplates(tr.data)
      setPastInvoices(ir.data)
      setInvNumber(nr.data.number)
      if (tr.data.length > 0 && !selectedTmpl) setSelectedTmpl(tr.data[0]._id)
    } catch {
      showToast('Failed to load data')
    } finally {
      setTLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  // ── Line item calc ─────────────────────────────────────
  function updateLineItem(i: number, field: keyof LineItem, val: string) {
    setLineItems(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: val }
      const days  = parseFloat(next[i].days) || 0
      const price = parseFloat(next[i].unitPrice) || 0
      next[i].amount = days * price
      return next
    })
  }

  function addRow()    { setLineItems(p => [...p, EMPTY_LINE()]) }
  function removeRow(i: number) { setLineItems(p => p.filter((_, idx) => idx !== i)) }

  const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
  const gst      = Math.round(subtotal * 0.1 * 100) / 100
  const total    = Math.round((subtotal + gst) * 100) / 100

  // ── Upload template ────────────────────────────────────
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') return showToast('Please upload a PDF file')

    const name = window.prompt('Template name (e.g. Desi Boys Rental):')
    if (!name?.trim()) return

    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1]
        const res = await axios.post('/api/invoices/templates', { name: name.trim(), pdfBase64: base64 })
        setTemplates(p => [res.data, ...p])
        setSelectedTmpl(res.data._id)
        showToast('Template uploaded')
        setUploading(false)
      }
      reader.readAsDataURL(file)
    } catch {
      showToast('Upload failed')
      setUploading(false)
    }

    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Delete template ────────────────────────────────────
  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template? All invoices using it will also be deleted.')) return
    setDeleting(id)
    try {
      await axios.delete(`/api/invoices/templates/${id}`)
      setTemplates(p => p.filter(t => t._id !== id))
      if (selectedTmpl === id) setSelectedTmpl(templates.find(t => t._id !== id)?._id || '')
      showToast('Template deleted')
    } catch {
      showToast('Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  // ── Generate preview ───────────────────────────────────
  async function handleGenerate() {
    if (!selectedTmpl) return showToast('Select a template first')
    if (!billToName.trim()) return showToast('Bill To name required')
    if (lineItems.every(li => !li.description.trim())) return showToast('Add at least one line item')

    setGenerating(true)
    try {
      const tmpl = templates.find(t => t._id === selectedTmpl)
      const { data } = await axios.get(`/api/invoices/templates/${selectedTmpl}/pdf`)

      const pdfBytes = await buildInvoicePDF({
        templateBase64: data.pdfBase64,
        number: invNumber,
        billToName, billToAddress,
        invoiceDate, hireFrom, hireTo,
        lineItems, subtotal, gst, total,
      })

      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      setPreviewBlob(url)
      setPendingBytes(pdfBytes)
      setPendingForm({
        templateId:   selectedTmpl,
        templateName: tmpl?.name,
        number: invNumber,
        billToName, billToAddress,
        invoiceDate, hireFrom, hireTo,
        lineItems: lineItems.filter(li => li.description.trim()),
        subtotal, gst, total,
      })
    } catch (err) {
      console.error(err)
      showToast('Failed to generate PDF')
    } finally {
      setGenerating(false)
    }
  }

  // ── Save + download ────────────────────────────────────
  async function handleDownload() {
    if (!pendingBytes || !pendingForm) return
    setSaving(true)
    try {
      await axios.post('/api/invoices', pendingForm)
      const blob = new Blob([pendingBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const a    = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      a.download = `Invoice-${pendingForm.number}-${pendingForm.billToName.replace(/\s+/g, '-')}.pdf`
      a.click()
      setInvNumber(n => n + 1)
      await fetchAll()
      showToast('Invoice saved & downloaded')
    } catch {
      showToast('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handlePrint() {
    if (!pendingBytes || !pendingForm) return
    setSaving(true)
    try {
      await axios.post('/api/invoices', pendingForm)
      setInvNumber(n => n + 1)
      await fetchAll()
      // Open in new tab to print
      const blob = new Blob([pendingBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      const win  = window.open(url)
      win?.addEventListener('load', () => win.print())
      showToast('Invoice saved')
    } catch {
      showToast('Save failed')
    } finally {
      setSaving(false)
    }
  }

  function closePreview() {
    if (previewBlob) URL.revokeObjectURL(previewBlob)
    setPreviewBlob(null)
    setPendingBytes(null)
    setPendingForm(null)
  }

  // ── Re-download past invoice ───────────────────────────
  async function reDownload(inv: SavedInvoice) {
    try {
      const full = await axios.get(`/api/invoices/${inv._id}`)
      const { data: tmplData } = await axios.get(`/api/invoices/templates/${full.data.templateId}/pdf`)
      const pdfBytes = await buildInvoicePDF({
        templateBase64: tmplData.pdfBase64,
        ...full.data,
      })
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const a    = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      a.download = `Invoice-${inv.number}-${inv.billToName?.replace(/\s+/g, '-') || 'invoice'}.pdf`
      a.click()
    } catch {
      showToast('Failed to re-download')
    }
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text-primary shadow-sm">
          {toast}
        </div>
      )}

      {/* Preview modal */}
      {previewBlob && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="flex items-center justify-between px-6 py-3 bg-surface border-b border-border shrink-0">
            <span className="font-semibold text-text-primary">Preview — Invoice #{pendingForm?.number}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={handlePrint}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm text-text-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print
              </button>
              <button
                onClick={handleDownload}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {saving ? 'Saving...' : 'Download PDF'}
              </button>
              <button onClick={closePreview} className="px-3 py-2 text-sm text-text-muted hover:text-text-primary transition-colors">✕ Close</button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe src={previewBlob} className="w-full h-full border-0" title="Invoice Preview" />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary">Invoices</h1>
        <p className="text-text-muted text-sm mt-0.5">Generate and manage business invoices</p>
      </div>

      <div className="flex gap-5">

        {/* ── Left: Template Library ─────────────────── */}
        <div className="w-[220px] shrink-0">
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-semibold text-text-primary">Templates</span>
            </div>

            <div className="p-3 space-y-2">
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleUpload} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-border rounded-lg text-xs text-text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {uploading ? 'Uploading...' : '+ Upload PDF'}
              </button>

              {tLoading ? (
                <div className="py-4 text-center text-xs text-text-muted">Loading...</div>
              ) : templates.length === 0 ? (
                <div className="py-4 text-center text-xs text-text-muted">No templates yet</div>
              ) : (
                templates.map(t => (
                  <div
                    key={t._id}
                    onClick={() => setSelectedTmpl(t._id)}
                    className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors border ${
                      selectedTmpl === t._id
                        ? 'border-accent bg-accent/5'
                        : 'border-transparent hover:bg-surface2'
                    }`}
                  >
                    <div className="w-8 h-10 rounded bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                      <svg viewBox="0 0 16 20" fill="none" className="w-4 h-5">
                        <rect x="2" y="1" width="12" height="18" rx="2" fill="#ef4444" opacity="0.2"/>
                        <rect x="4" y="5" width="8" height="1.5" rx="0.75" fill="#ef4444" opacity="0.6"/>
                        <rect x="4" y="8" width="6" height="1" rx="0.5" fill="#ef4444" opacity="0.4"/>
                        <rect x="4" y="11" width="7" height="1" rx="0.5" fill="#ef4444" opacity="0.4"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-text-primary truncate">{t.name}</p>
                      <p className="text-[11px] text-text-muted">Used {t.usageCount}×</p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteTemplate(t._id) }}
                      disabled={deleting === t._id}
                      className="text-text-muted hover:text-red-400 transition-colors text-sm leading-none shrink-0 disabled:opacity-30"
                    >✕</button>
                  </div>
                ))
              )}

              <p className="text-[10px] text-text-muted text-center pt-2 leading-relaxed">
                Saves last 20 invoices<br />per template
              </p>
            </div>
          </div>
        </div>

        {/* ── Right: Invoice Builder ─────────────────── */}
        <div className="flex-1 bg-surface border border-border rounded-xl overflow-hidden">

          {/* Tabs + action buttons */}
          <div className="flex items-center border-b border-border px-5">
            {(['new', 'past'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-3.5 px-4 text-sm font-medium border-b-2 transition-colors mr-1 ${
                  tab === t ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                {t === 'new' ? 'New Invoice' : `Past Invoices (${pastInvoices.length})`}
              </button>
            ))}
            {tab === 'new' && (
              <div className="ml-auto flex items-center gap-2 py-2">
                <div className="text-xs font-medium px-3 py-1.5 rounded-lg bg-accent/10 text-accent border border-accent/20">
                  # {invNumber}
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={generating || !selectedTmpl}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-40"
                >
                  {generating ? 'Generating...' : 'Generate →'}
                </button>
              </div>
            )}
          </div>

          {/* ── New Invoice Form ── */}
          {tab === 'new' && (
            <div className="p-5 overflow-y-auto">

              {!selectedTmpl && !tLoading && (
                <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                  Upload a PDF template on the left to get started.
                </div>
              )}

              {/* Bill To + Dates */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">Bill To — Name</label>
                  <input
                    value={billToName}
                    onChange={e => setBillToName(e.target.value)}
                    placeholder="e.g. Sydney Auto Warehouse"
                    className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">Bill To — Address</label>
                  <input
                    value={billToAddress}
                    onChange={e => setBillToAddress(e.target.value)}
                    placeholder="e.g. 12 Main St, Sydney NSW 2000"
                    className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-6">
                {[
                  { label: 'Invoice Date', val: invoiceDate, set: setInvoiceDate, ph: 'DD/MM/YYYY' },
                  { label: 'Hire From',    val: hireFrom,    set: setHireFrom,    ph: 'DD/MM/YYYY' },
                  { label: 'Hire To',      val: hireTo,      set: setHireTo,      ph: 'DD/MM/YYYY' },
                ].map(f => (
                  <div key={f.label}>
                    <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">{f.label}</label>
                    <input
                      value={f.val}
                      onChange={e => f.set(e.target.value)}
                      placeholder={f.ph}
                      className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                    />
                  </div>
                ))}
              </div>

              {/* Line items */}
              <div className="mb-1 text-xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-2">
                Line Items
              </div>
              <table className="w-full mb-3">
                <thead>
                  <tr>
                    {['Description', 'Days', 'Unit Price', 'Amount', ''].map(h => (
                      <th key={h} className="text-left text-xs text-text-muted font-medium py-2 px-2 first:pl-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-1.5 px-2 pl-0 w-[42%]">
                        <input
                          value={li.description}
                          onChange={e => updateLineItem(i, 'description', e.target.value)}
                          placeholder="Description..."
                          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                        />
                      </td>
                      <td className="py-1.5 px-2 w-[15%]">
                        <input
                          value={li.days}
                          onChange={e => updateLineItem(i, 'days', e.target.value)}
                          placeholder="0"
                          type="number"
                          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                        />
                      </td>
                      <td className="py-1.5 px-2 w-[18%]">
                        <input
                          value={li.unitPrice}
                          onChange={e => updateLineItem(i, 'unitPrice', e.target.value)}
                          placeholder="0.00"
                          type="number"
                          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                        />
                      </td>
                      <td className="py-1.5 px-2 w-[18%] text-sm font-medium text-text-primary">
                        {li.amount > 0 ? fmtAmt(li.amount) : '—'}
                      </td>
                      <td className="py-1.5 px-2 w-[7%] text-center">
                        <button onClick={() => removeRow(i)} className="text-text-muted hover:text-red-400 transition-colors text-sm">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={addRow} className="text-xs text-accent hover:text-accent/80 transition-colors mb-6">
                + Add line item
              </button>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-60 border border-border rounded-xl overflow-hidden">
                  <div className="flex justify-between px-4 py-2.5 text-sm border-b border-border">
                    <span className="text-text-muted">Subtotal</span>
                    <span className="text-text-primary">{fmtAmt(subtotal)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-2.5 text-sm border-b border-border">
                    <span className="text-text-muted">GST (10%)</span>
                    <span className="text-text-primary">{fmtAmt(gst)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 text-sm font-semibold bg-surface2">
                    <span className="text-accent">Total</span>
                    <span className="text-accent">{fmtAmt(total)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Past Invoices ── */}
          {tab === 'past' && (
            pastInvoices.length === 0 ? (
              <div className="py-16 text-center text-text-muted text-sm">No invoices generated yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {['#', 'Template', 'Bill To', 'Total', 'Date', ''].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs text-text-muted font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pastInvoices.map(inv => (
                      <tr key={inv._id} className="border-b border-border last:border-0 hover:bg-surface2">
                        <td className="px-5 py-3 font-medium text-text-primary">#{inv.number}</td>
                        <td className="px-5 py-3 text-text-muted">{inv.templateName || '—'}</td>
                        <td className="px-5 py-3 text-text-primary">{inv.billToName || '—'}</td>
                        <td className="px-5 py-3 font-medium text-accent">{fmtAmt(inv.total || 0)}</td>
                        <td className="px-5 py-3 text-text-muted">{fmtDate(inv.createdAt)}</td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => reDownload(inv)}
                            className="text-xs text-accent hover:underline"
                          >↓ Re-download</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}