import { useState } from 'react'
import axios from 'axios'

/**
 * Per-tenant credentials, entered by the platform operator when a new client is onboarded.
 *
 * Everything here differs per client and cannot be shared: PayWay decides which merchant
 * account the direct debits settle into, and the WhatsApp number decides whose fleet an
 * inbound message is applied to. Auth0, Gemini and S3 stay platform-level and are not
 * shown — they are the same for every client.
 *
 * Secrets are write-only. The server reports whether each one is set, never its value, so
 * a blank field always means "leave the stored one alone".
 */

export interface OrgCredentials {
  payway: { configured: boolean; merchantId: string | null; bankAccountId: string | null }
  whatsapp: { configured: boolean; phoneId: string | null; enabled: boolean }
  gmail: { configured: boolean; address: string | null; enabled: boolean }
  sms: { configured: boolean; username: string | null; sender: string | null; enabled: boolean }
  tabletLinked: boolean
}

export interface CredentialOwner {
  _id: string
  email: string
  name?: string
  displayName?: string
  status: string
  credentials?: OrgCredentials
}

const label = 'block text-[11px] font-medium text-text-muted mb-1'
const input =
  'w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary ' +
  'placeholder:text-text-muted focus:outline-none focus:border-accent'

function Section({
  title, hint, configured, children,
}: {
  title: string
  hint: string
  configured: boolean
  children: React.ReactNode
}) {
  return (
    <div className="border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
          configured ? 'bg-green-bg text-green' : 'bg-surface2 text-text-muted'
        }`}>
          {configured ? 'set' : 'not set'}
        </span>
      </div>
      <p className="text-[11px] text-text-muted mb-3">{hint}</p>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  )
}

export default function OrgCredentialsModal({
  owner, onClose, onSaved,
}: {
  owner: CredentialOwner
  onClose: () => void
  onSaved: (updated: CredentialOwner) => void
}) {
  const creds = owner.credentials
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [pwMerchantId, setPwMerchantId] = useState(creds?.payway.merchantId || '')
  const [pwBankAccountId, setPwBankAccountId] = useState(creds?.payway.bankAccountId || '0000000A')
  const [pwSecretKey, setPwSecretKey] = useState('')
  const [pwPublishableKey, setPwPublishableKey] = useState('')

  const [waPhoneId, setWaPhoneId] = useState(creds?.whatsapp.phoneId || '')
  const [waToken, setWaToken] = useState('')

  const [gmailAddress, setGmailAddress] = useState(creds?.gmail.address || '')
  const [gmailRefreshToken, setGmailRefreshToken] = useState('')

  const [smsUsername, setSmsUsername] = useState(creds?.sms.username || '')
  const [smsSender, setSmsSender] = useState(creds?.sms.sender || '')
  const [smsPassword, setSmsPassword] = useState('')

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const { data } = await axios.put<CredentialOwner>(
        `/api/admin/owners/${encodeURIComponent(owner.email)}/credentials`,
        {
          payway: {
            merchantId: pwMerchantId,
            bankAccountId: pwBankAccountId,
            ...(pwSecretKey ? { secretKey: pwSecretKey } : {}),
            ...(pwPublishableKey ? { publishableKey: pwPublishableKey } : {}),
          },
          whatsapp: {
            phoneId: waPhoneId,
            ...(waToken ? { token: waToken } : {}),
            // Enabling before a token exists would only produce failed sends.
            enabled: !!(waToken || creds?.whatsapp.configured),
          },
          gmail: {
            address: gmailAddress,
            ...(gmailRefreshToken ? { refreshToken: gmailRefreshToken } : {}),
            enabled: !!(gmailRefreshToken || creds?.gmail.configured),
          },
          sms: {
            username: smsUsername,
            sender: smsSender,
            ...(smsPassword ? { password: smsPassword } : {}),
            enabled: !!(smsPassword || creds?.sms.configured),
          },
        }
      )
      setPwSecretKey(''); setPwPublishableKey(''); setWaToken('')
      setGmailRefreshToken(''); setSmsPassword('')
      setSaved(true)
      onSaved(data)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not save credentials')
    } finally {
      setSaving(false)
    }
  }

  const keepHint = (isSet?: boolean) =>
    isSet ? <span className="text-text-muted font-normal">(leave blank to keep)</span> : null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Client credentials</h2>
              <p className="text-xs text-text-muted mt-0.5">
                {owner.displayName || owner.name || owner.email} · {owner.email}
              </p>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">×</button>
          </div>
          <p className="text-[11px] text-text-muted mt-3">
            These belong to this client only. Auth0, Gemini and file storage are shared across
            the platform and are not set here.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <Section
            title="PayWay"
            configured={!!creds?.payway.configured}
            hint="Their own Westpac merchant account. Direct debits settle into the bank account these keys belong to — until they are set, auto-debit runs in the mock path and charges nobody."
          >
            <div>
              <label className={label}>Merchant ID</label>
              <input className={input} value={pwMerchantId} onChange={e => setPwMerchantId(e.target.value)} placeholder="e.g. T1234" />
            </div>
            <div>
              <label className={label}>Bank account ID</label>
              <input className={input} value={pwBankAccountId} onChange={e => setPwBankAccountId(e.target.value)} placeholder="0000000A" />
            </div>
            <div>
              <label className={label}>Secret key {keepHint(creds?.payway.configured)}</label>
              <input className={input} type="password" autoComplete="new-password"
                     value={pwSecretKey} onChange={e => setPwSecretKey(e.target.value)} placeholder="••••••••" />
            </div>
            <div>
              <label className={label}>Publishable key {keepHint(creds?.payway.configured)}</label>
              <input className={input} type="password" autoComplete="new-password"
                     value={pwPublishableKey} onChange={e => setPwPublishableKey(e.target.value)} placeholder="••••••••" />
            </div>
          </Section>

          <Section
            title="WhatsApp Business"
            configured={!!creds?.whatsapp.configured}
            hint="Inbound messages are routed to a tenant by the number that received them, so this must be set before their number is pointed at FleetAI."
          >
            <div>
              <label className={label}>Phone number ID</label>
              <input className={input} value={waPhoneId} onChange={e => setWaPhoneId(e.target.value)} placeholder="Meta phone_number_id" />
            </div>
            <div>
              <label className={label}>Access token {keepHint(creds?.whatsapp.configured)}</label>
              <input className={input} type="password" autoComplete="new-password"
                     value={waToken} onChange={e => setWaToken(e.target.value)} placeholder="••••••••" />
            </div>
          </Section>

          <Section
            title="Fine & toll email"
            configured={!!creds?.gmail.configured}
            hint="Their own mailbox. Fines found there are matched against their vehicles only."
          >
            <div>
              <label className={label}>Mailbox address</label>
              <input className={input} value={gmailAddress} onChange={e => setGmailAddress(e.target.value)} placeholder="fines@client.com.au" />
            </div>
            <div>
              <label className={label}>Refresh token {keepHint(creds?.gmail.configured)}</label>
              <input className={input} type="password" autoComplete="new-password"
                     value={gmailRefreshToken} onChange={e => setGmailRefreshToken(e.target.value)} placeholder="••••••••" />
            </div>
          </Section>

          <Section
            title="SMS (Mobile Message)"
            configured={!!creds?.sms.configured}
            hint="Carries onboarding links and payment-decline notices. Without it those fall back to WhatsApp."
          >
            <div>
              <label className={label}>API username</label>
              <input className={input} value={smsUsername} onChange={e => setSmsUsername(e.target.value)} />
            </div>
            <div>
              <label className={label}>API password {keepHint(creds?.sms.configured)}</label>
              <input className={input} type="password" autoComplete="new-password"
                     value={smsPassword} onChange={e => setSmsPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div>
              <label className={label}>Sender number (optional)</label>
              <input className={input} value={smsSender} onChange={e => setSmsSender(e.target.value)} placeholder="61485900155" />
            </div>
          </Section>

          <p className="text-[11px] text-text-muted">
            Two steps stay with the client: a share-link name on their Fleet page before
            onboarding links can be sent, and <span className="text-text-secondary">Link tablet</span> in
            their Settings if they use the workshop tablet.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3 sticky bottom-0 bg-surface">
          <div className="text-xs">
            {error && <span className="text-red">{error}</span>}
            {saved && !error && <span className="text-green">Saved</span>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm">
              Close
            </button>
            <button onClick={save} disabled={saving}
                    className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving...' : 'Save credentials'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
