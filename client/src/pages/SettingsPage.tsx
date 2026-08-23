import { useEffect, useState } from 'react'
import axios from 'axios'
import { useStore } from '../store/useStore'

interface Settings {
  displayName: string
  logoUrl: string | null
  slug: string | null
  timezone: string
  currency: string
  fleetSummary: string
  payway: { configured: boolean; merchantId: string | null; bankAccountId: string | null }
  whatsapp: { configured: boolean; phoneId: string | null; enabled: boolean }
  gmail: { configured: boolean; address: string | null; enabled: boolean }
  tabletLinked: boolean
}

const card = 'bg-surface border border-border rounded-xl p-5 mb-4'
const label = 'block text-xs font-medium text-text-secondary mb-1.5'
const input = 'w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent'
const btn = 'px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50'
const btnGhost = 'px-4 py-2 bg-surface2 border border-border text-text-secondary rounded-lg text-sm font-medium disabled:opacity-50'

function Status({ ok, okText, offText }: { ok: boolean; okText: string; offText: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${ok ? 'bg-green/10 text-green' : 'bg-surface2 text-text-secondary'}`}>
      {ok ? okText : offText}
    </span>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [tabletToken, setTabletToken] = useState<string | null>(null)
  const setSession = useStore(s => s.setSession)
  const session = useStore(s => s.session)

  // Branding
  const [displayName, setDisplayName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [fleetSummary, setFleetSummary] = useState('')

  // Credentials — always blank on load; the server never returns stored secrets.
  const [pwMerchantId, setPwMerchantId] = useState('')
  const [pwSecretKey, setPwSecretKey] = useState('')
  const [pwPublishableKey, setPwPublishableKey] = useState('')
  const [waPhoneId, setWaPhoneId] = useState('')
  const [waToken, setWaToken] = useState('')
  const [gmailAddress, setGmailAddress] = useState('')
  const [gmailRefreshToken, setGmailRefreshToken] = useState('')

  useEffect(() => {
    axios.get<Settings>('/api/settings')
      .then(({ data }) => {
        applySettings(data)
        setDisplayName(data.displayName || '')
        setLogoUrl(data.logoUrl || '')
        setFleetSummary(data.fleetSummary || '')
        setPwMerchantId(data.payway.merchantId || '')
        setWaPhoneId(data.whatsapp.phoneId || '')
        setGmailAddress(data.gmail.address || '')
      })
      .catch(() => setMessage({ kind: 'err', text: 'Could not load settings' }))
      .finally(() => setLoading(false))
  }, [])

  function applySettings(data: Settings) {
    setSettings(data)
    // Keep the sidebar branding in step with what was just saved.
    setSession({
      email: session?.email ?? null,
      isSuperAdmin: session?.isSuperAdmin ?? false,
      org: {
        displayName: data.displayName,
        logoUrl: data.logoUrl,
        slug: data.slug,
        timezone: data.timezone,
        currency: data.currency,
        paywayConfigured: data.payway.configured,
        whatsappConfigured: data.whatsapp.configured,
        gmailConfigured: data.gmail.configured,
        tabletLinked: data.tabletLinked,
      },
    })
  }

  async function save(section: string, url: string, body: Record<string, unknown>, onDone?: () => void) {
    setSaving(section); setMessage(null)
    try {
      const { data } = await axios.put<Settings>(url, body)
      applySettings(data)
      onDone?.()
      setMessage({ kind: 'ok', text: 'Saved' })
    } catch (err: any) {
      setMessage({ kind: 'err', text: err.response?.data?.error || 'Failed to save' })
    } finally {
      setSaving(null)
    }
  }

  async function issueTabletToken() {
    if (settings?.tabletLinked && !confirm('This replaces the existing tablet link. The current tablet will stop working until you re-link it. Continue?')) return
    setSaving('tablet'); setMessage(null)
    try {
      const { data } = await axios.post<{ token: string }>('/api/settings/tablet-token')
      setTabletToken(data.token)
      setSettings(s => s ? { ...s, tabletLinked: true } : s)
    } catch {
      setMessage({ kind: 'err', text: 'Failed to create tablet link' })
    } finally {
      setSaving(null)
    }
  }

  async function revokeTabletToken() {
    if (!confirm('Revoke the tablet link? The workshop tablet will immediately stop working.')) return
    setSaving('tablet')
    try {
      await axios.delete('/api/settings/tablet-token')
      setTabletToken(null)
      setSettings(s => s ? { ...s, tabletLinked: false } : s)
      setMessage({ kind: 'ok', text: 'Tablet link revoked' })
    } catch {
      setMessage({ kind: 'err', text: 'Failed to revoke' })
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <div className="p-8 text-text-secondary text-sm">Loading settings...</div>
  if (!settings) return <div className="p-8 text-red text-sm">Could not load settings.</div>

  const tabletUrl = `${window.location.origin}/tablet`

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-text-primary mb-1">Settings</h1>
      <p className="text-sm text-text-secondary mb-6">
        These settings apply to your organisation only. Credentials are stored encrypted and
        are never shown again after saving.
      </p>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${message.kind === 'ok' ? 'bg-green/10 text-green' : 'bg-red/10 text-red'}`}>
          {message.text}
        </div>
      )}

      {/* ── Branding ── */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-text-primary mb-4">Organisation</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={label}>Display name</label>
            <input className={input} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Sydney Scooter Rentals" />
          </div>
          <div>
            <label className={label}>Logo URL</label>
            <input className={input} value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." />
          </div>
        </div>
        <div className="mb-4">
          <label className={label}>Fleet description</label>
          <input className={input} value={fleetSummary} onChange={e => setFleetSummary(e.target.value)}
                 placeholder="e.g. 100 Honda Duo scooters and 5 cars in Sydney" />
          <p className="text-xs text-text-secondary mt-1.5">Used by the AI assistant to describe your fleet.</p>
        </div>
        <button className={btn} disabled={saving === 'org'}
                onClick={() => save('org', '/api/settings', { displayName, logoUrl, fleetSummary })}>
          {saving === 'org' ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* ── PayWay ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-text-primary">PayWay</h2>
          <Status ok={settings.payway.configured} okText="Connected" offText="Not connected" />
        </div>
        <p className="text-xs text-text-secondary mb-4">
          Your own Westpac PayWay merchant account. Direct debits settle into the bank account
          these keys belong to, so they must be yours.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={label}>Merchant ID</label>
            <input className={input} value={pwMerchantId} onChange={e => setPwMerchantId(e.target.value)} />
          </div>
          <div>
            <label className={label}>Bank account ID</label>
            <input className={input} defaultValue={settings.payway.bankAccountId || '0000000A'} disabled />
          </div>
          <div>
            <label className={label}>Secret key {settings.payway.configured && <span className="text-text-secondary">(leave blank to keep)</span>}</label>
            <input className={input} type="password" value={pwSecretKey} onChange={e => setPwSecretKey(e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label className={label}>Publishable key {settings.payway.configured && <span className="text-text-secondary">(leave blank to keep)</span>}</label>
            <input className={input} type="password" value={pwPublishableKey} onChange={e => setPwPublishableKey(e.target.value)} placeholder="••••••••" />
          </div>
        </div>
        <button className={btn} disabled={saving === 'payway'}
                onClick={() => save('payway', '/api/settings/payway',
                  { merchantId: pwMerchantId, secretKey: pwSecretKey || undefined, publishableKey: pwPublishableKey || undefined },
                  () => { setPwSecretKey(''); setPwPublishableKey('') })}>
          {saving === 'payway' ? 'Saving...' : 'Save PayWay'}
        </button>
      </div>

      {/* ── WhatsApp ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-text-primary">WhatsApp</h2>
          <Status ok={settings.whatsapp.configured && settings.whatsapp.enabled} okText="Active" offText="Not active" />
        </div>
        <p className="text-xs text-text-secondary mb-4">
          Your own WhatsApp Business number. Messages sent to it are routed to your fleet only.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={label}>Phone number ID</label>
            <input className={input} value={waPhoneId} onChange={e => setWaPhoneId(e.target.value)} />
          </div>
          <div>
            <label className={label}>Access token {settings.whatsapp.configured && <span className="text-text-secondary">(leave blank to keep)</span>}</label>
            <input className={input} type="password" value={waToken} onChange={e => setWaToken(e.target.value)} placeholder="••••••••" />
          </div>
        </div>
        <div className="flex gap-2">
          <button className={btn} disabled={saving === 'whatsapp'}
                  onClick={() => save('whatsapp', '/api/settings/whatsapp',
                    { phoneId: waPhoneId, token: waToken || undefined, enabled: true },
                    () => setWaToken(''))}>
            {saving === 'whatsapp' ? 'Saving...' : 'Save & enable'}
          </button>
          {settings.whatsapp.enabled && (
            <button className={btnGhost} disabled={saving === 'whatsapp'}
                    onClick={() => save('whatsapp', '/api/settings/whatsapp', { enabled: false })}>
              Disable
            </button>
          )}
        </div>
      </div>

      {/* ── Gmail ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-text-primary">Fine & toll email ingestion</h2>
          <Status ok={settings.gmail.configured && settings.gmail.enabled} okText="Active" offText="Not active" />
        </div>
        <p className="text-xs text-text-secondary mb-4">
          Connect your own mailbox. Fines found there are matched against your vehicles only.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={label}>Mailbox address</label>
            <input className={input} value={gmailAddress} onChange={e => setGmailAddress(e.target.value)} placeholder="fines@yourcompany.com.au" />
          </div>
          <div>
            <label className={label}>Refresh token {settings.gmail.configured && <span className="text-text-secondary">(leave blank to keep)</span>}</label>
            <input className={input} type="password" value={gmailRefreshToken} onChange={e => setGmailRefreshToken(e.target.value)} placeholder="••••••••" />
          </div>
        </div>
        <div className="flex gap-2">
          <button className={btn} disabled={saving === 'gmail'}
                  onClick={() => save('gmail', '/api/settings/gmail',
                    { address: gmailAddress, refreshToken: gmailRefreshToken || undefined, enabled: true },
                    () => setGmailRefreshToken(''))}>
            {saving === 'gmail' ? 'Saving...' : 'Save & enable'}
          </button>
          {settings.gmail.enabled && (
            <button className={btnGhost} disabled={saving === 'gmail'}
                    onClick={() => save('gmail', '/api/settings/gmail', { enabled: false })}>
              Disable
            </button>
          )}
        </div>
      </div>

      {/* ── Tablet ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-text-primary">Workshop tablet</h2>
          <Status ok={settings.tabletLinked} okText="Linked" offText="Not linked" />
        </div>
        <p className="text-xs text-text-secondary mb-4">
          Generates a device code for the workshop tablet. Open <span className="text-text-primary">{tabletUrl}</span> on
          the tablet and enter the code once — it stays signed in until you revoke it.
        </p>

        {tabletToken && (
          <div className="mb-4 p-3 bg-surface2 border border-border rounded-lg">
            <p className="text-xs text-text-secondary mb-1.5">Copy this now — it is not shown again.</p>
            <code className="block text-xs text-text-primary break-all mb-2">{tabletToken}</code>
            <button className={btnGhost} onClick={() => navigator.clipboard.writeText(tabletToken)}>Copy code</button>
          </div>
        )}

        <div className="flex gap-2">
          <button className={btn} disabled={saving === 'tablet'} onClick={issueTabletToken}>
            {settings.tabletLinked ? 'Re-link tablet' : 'Link tablet'}
          </button>
          {settings.tabletLinked && (
            <button className={btnGhost} disabled={saving === 'tablet'} onClick={revokeTabletToken}>
              Revoke
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
