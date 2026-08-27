import { useState } from 'react'
import axios from 'axios'
import type { CredentialOwner } from './OrgCredentialsModal'

/**
 * Creates a client's login. One submit makes two records: the Auth0 user they sign in
 * with, and the organisation every tenant-scoped query keys on.
 *
 * The password is shown in the clear on purpose — the operator has to hand it to the
 * client, and it is a first-login credential the client replaces. Auth0 enforces the
 * connection's password policy, so a rejection here comes back in its own words.
 */

const label = 'block text-[11px] font-medium text-text-muted mb-1'
const input =
  'w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary ' +
  'placeholder:text-text-muted focus:outline-none focus:border-accent'

const GROUPS = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*']

function pick(set: string) {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return set[buf[0] % set.length]
}

/** 14 chars drawn from all four groups — clears Auth0's strictest stock policy. */
function generatePassword() {
  const chars = GROUPS.map(pick)
  const all = GROUPS.join('')
  while (chars.length < 14) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const j = buf[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export default function CreateUserModal({
  onClose, onCreated,
}: {
  onClose: () => void
  onCreated: (owner: CredentialOwner) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const canSubmit = email.includes('@') && password.length >= 8 && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true); setError('')
    try {
      const { data } = await axios.post('/api/admin/users', { email, name, password })
      onCreated(data.owner)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not create the user')
    } finally {
      setSaving(false)
    }
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the field is readable either way */ }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">New client</h2>
            <p className="text-xs text-text-muted mt-0.5">Creates their login and their organisation</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={label}>Email</label>
            <input className={input} type="email" value={email} autoComplete="off"
                   onChange={e => setEmail(e.target.value)} placeholder="owner@client.com.au" />
          </div>

          <div>
            <label className={label}>Business name</label>
            <input className={input} value={name} onChange={e => setName(e.target.value)}
                   placeholder="Client Rentals Pty Ltd" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={label + ' mb-0'}>Temporary password</label>
              <div className="flex gap-2">
                <button onClick={() => setPassword(generatePassword())}
                        className="text-[11px] text-accent hover:underline">
                  Generate
                </button>
                {password && (
                  <button onClick={copyPassword} className="text-[11px] text-accent hover:underline">
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
            </div>
            <input className={input} value={password} autoComplete="new-password"
                   onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
            <p className="text-[11px] text-text-muted mt-1.5">
              Your Auth0 connection's password policy applies. Hand this to the client — they
              change it on first sign-in.
            </p>
          </div>

          <p className="text-[11px] text-text-muted border-t border-border pt-3">
            The credentials form opens next. A client cannot take a payment or send a message
            until their PayWay and messaging keys are entered there.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <span className="text-xs text-red">{error}</span>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm">
              Cancel
            </button>
            <button onClick={submit} disabled={!canSubmit}
                    className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50">
              {saving ? 'Creating...' : 'Create & add credentials'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
