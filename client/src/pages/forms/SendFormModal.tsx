import { useState } from 'react'
import axios from 'axios'
import type { FormEntryRow, FormTemplate } from './types'
import { copyText, formLink, whatsappUrl } from './util'

const input = 'w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent'

type Via = 'copy' | 'whatsapp' | 'email'

// Send a template's link to one renter by Copy link, WhatsApp or Email. Every send is saved in the
// history (who, when, how), so this is also where "Resend" lands for a form that was not sent back.
export default function SendFormModal({ template, entry, businessName, onClose, onDone }: {
  template: FormTemplate
  entry?: FormEntryRow
  businessName: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [name, setName] = useState(entry?.renterName ?? '')
  const [phone, setPhone] = useState(entry?.renterPhone ?? '')
  const [email, setEmail] = useState(entry?.renterEmail ?? '')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<Via | ''>('')
  const [error, setError] = useState('')
  const [tapLink, setTapLink] = useState('')
  const link = formLink(template.code)

  function problem(via: Via): string {
    if (!name.trim()) return "Type the renter's name"
    if (via === 'whatsapp' && !phone.trim()) return "Type the renter's mobile number to send on WhatsApp"
    if (via === 'email' && !email.trim()) return "Type the renter's email address"
    return ''
  }

  // Saves the send in the history (and sends the email when via is email).
  async function log(via: Via): Promise<boolean> {
    const body = { via, renterName: name.trim(), phone: phone.trim(), email: email.trim(), message: message.trim() }
    try {
      if (entry) await axios.post(`/api/forms/entries/${entry.id}/resend`, body)
      else await axios.post(`/api/forms/templates/${template.id}/send`, body)
      return true
    } catch (err: any) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.')
      return false
    }
  }

  async function copy() {
    const p = problem('copy')
    if (p) { setError(p); return }
    setError('')
    setBusy('copy')
    // Copy first: browsers only allow it straight after the click, not after a server round trip.
    const copied = await copyText(link)
    if (await log('copy')) {
      onDone(copied ? `Link copied for ${name.trim()}. Paste it into any message.` : `Saved in History for ${name.trim()}. Copy the link from the template.`)
    }
    setBusy('')
  }

  async function whatsapp() {
    const p = problem('whatsapp')
    if (p) { setError(p); return }
    setError('')
    setBusy('whatsapp')
    // Open the tab now (the click), fill it in once the send is saved: pop-up blockers allow this.
    const tab = window.open('about:blank', '_blank')
    const first = name.trim().split(/\s+/)[0]
    const text = `Hi ${first}, please fill in this form for ${businessName}: ${link}${message.trim() ? `\n\n${message.trim()}` : ''}`
    if (await log('whatsapp')) {
      const url = whatsappUrl(phone, text)
      if (tab) {
        tab.location.href = url
        onDone(`WhatsApp opened for ${name.trim()}. Press send in WhatsApp.`)
      } else {
        setTapLink(url)
      }
    } else {
      tab?.close()
    }
    setBusy('')
  }

  async function sendEmail() {
    const p = problem('email')
    if (p) { setError(p); return }
    setError('')
    setBusy('email')
    if (await log('email')) onDone(`Email sent to ${email.trim()}.`)
    setBusy('')
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary">{entry ? 'Send again' : 'Send form'}</h2>
            <p className="text-xs text-text-muted mt-0.5 truncate">{template.name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary shrink-0 ml-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <label className="block text-xs font-medium text-text-secondary mb-1.5">Renter name</label>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Full name" className={input} autoFocus />

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Mobile</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" maxLength={30} placeholder="0412 345 678" className={input} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" maxLength={120} placeholder="name@email.com" className={input} />
          </div>
        </div>
        <p className="text-[11px] text-text-muted mt-1.5">The mobile number is how the form is matched to this row when the renter sends it back.</p>

        <label className="block text-xs font-medium text-text-secondary mt-3 mb-1.5">Message <span className="text-text-muted font-normal">(optional, for email and WhatsApp)</span></label>
        <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} rows={2} className={`${input} resize-none`} />

        <div className="mt-3 rounded-lg bg-surface2 border border-border px-3 py-2">
          <p className="text-[11px] text-text-muted">This template's link (the same for every renter)</p>
          <p className="text-xs text-text-primary break-all mt-0.5 select-all">{link}</p>
        </div>

        {error && <p role="alert" className="text-xs text-red mt-3">{error}</p>}
        {tapLink && (
          <p className="text-xs text-text-secondary mt-3">
            Your browser blocked the WhatsApp window. <a href={tapLink} target="_blank" rel="noreferrer" className="text-accent underline">Tap here to open WhatsApp</a>, then <button onClick={() => onDone(`Saved in History for ${name.trim()}.`)} className="text-accent underline">close this</button>.
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 mt-4">
          <button onClick={copy} disabled={busy !== ''} className="px-3 py-2.5 rounded-lg text-sm font-semibold border border-border text-text-primary hover:border-accent disabled:opacity-60">
            {busy === 'copy' ? 'Saving...' : 'Copy link'}
          </button>
          <button onClick={whatsapp} disabled={busy !== ''} className="px-3 py-2.5 rounded-lg text-sm font-semibold bg-green text-white hover:opacity-90 disabled:opacity-60">
            {busy === 'whatsapp' ? 'Opening...' : 'WhatsApp'}
          </button>
          <button onClick={sendEmail} disabled={busy !== ''} className="px-3 py-2.5 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90 disabled:opacity-60">
            {busy === 'email' ? 'Sending...' : 'Email'}
          </button>
        </div>
        <p className="text-[11px] text-text-muted mt-2">WhatsApp opens with the message ready; you press send there. Email goes straight from here. Each one is saved in History.</p>
      </div>
    </div>
  )
}
