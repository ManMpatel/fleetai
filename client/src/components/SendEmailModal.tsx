import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

interface Recipient {
  name?: string
  email: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  subject: string
  message: string
  attachmentType: 'toll-folder' | 'service-record'
  attachmentId: string
  attachmentLabel: string
  onSuccess?: (sentTo: string, sentAt?: string) => void
}

export default function SendEmailModal({
  isOpen, onClose, subject: initialSubject, message: initialMessage,
  attachmentType, attachmentId, attachmentLabel, onSuccess,
}: Props) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState(initialSubject)
  const [message, setMessage] = useState(initialMessage)
  const [renters, setRenters] = useState<Recipient[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const fetchRecipients = useCallback(async (q: string) => {
    try {
      const { data } = await axios.get<{ renters: Recipient[]; recent: string[] }>(
        '/api/email/recipients', { params: q ? { q } : {} }
      )
      setRenters(data.renters || [])
      setRecent(data.recent || [])
    } catch { /* ignore — user can still type */ }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setTo('')
    setSubject(initialSubject)
    setMessage(initialMessage)
    setError(null)
    setSuccess(false)
    fetchRecipients('')
  }, [isOpen, initialSubject, initialMessage, fetchRecipients])

  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => fetchRecipients(to), to ? 250 : 0)
    return () => clearTimeout(t)
  }, [to, isOpen, fetchRecipients])

  async function send() {
    if (!to.trim()) return setError('Enter a recipient email address')
    setSending(true); setError(null)
    try {
      const { data } = await axios.post<{ success: boolean; sentTo: string; sentAt?: string }>(
        '/api/email/send',
        { to: to.trim(), subject, message, attachmentType, attachmentId }
      )
      setSuccess(true)
      onSuccess?.(data.sentTo, data.sentAt)
      setTimeout(onClose, 1500)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send — check your Resend settings')
    } finally {
      setSending(false)
    }
  }

  const suggestions: Recipient[] = [
    ...renters.filter(r => r.email && !to.includes(r.email)),
    ...recent
      .filter(e => !renters.some(r => r.email === e) && !to.includes(e))
      .map(e => ({ email: e } as Recipient)),
  ].slice(0, 6)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">Send {attachmentLabel}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {success ? (
          <div className="py-6 text-center">
            <p className="text-sm text-green font-medium">Sent to {to}</p>
          </div>
        ) : (
          <>
            {/* To field with typeahead */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">To</label>
              <input
                className="w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
                type="email"
                placeholder="customer@email.com or search renter..."
                value={to}
                onChange={e => setTo(e.target.value)}
                autoFocus
              />
            </div>

            {/* Suggestions */}
            {suggestions.length > 0 && !to.includes('@') && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {suggestions.map(s => (
                  <button
                    key={s.email}
                    onClick={() => setTo(s.email)}
                    className="px-2.5 py-1 bg-surface2 border border-border rounded-full text-xs text-text-secondary hover:border-accent hover:text-text-primary transition-colors"
                  >
                    {s.name ? `${s.name} (${s.email})` : s.email}
                  </button>
                ))}
              </div>
            )}

            {/* Subject */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Subject</label>
              <input
                className="w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
                value={subject}
                onChange={e => setSubject(e.target.value)}
              />
            </div>

            {/* Message */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Message {attachmentType === 'toll-folder' ? '(PDF will be attached)' : '(record details added below)'}
              </label>
              <textarea
                className="w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent resize-none"
                rows={3}
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
            </div>

            {error && <p className="text-xs text-red mb-3">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={send}
                disabled={sending || !to.trim()}
                className="flex-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
              <button onClick={onClose}
                className="px-4 py-2 bg-surface2 border border-border text-text-secondary rounded-lg text-sm font-medium hover:border-accent transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
