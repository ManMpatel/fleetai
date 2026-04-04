import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth0 } from '@auth0/auth0-react'

export default function QuickLinks() {
  const { user } = useAuth0()
  const [slug, setSlug] = useState('')
  const [input, setInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    axios.get('/api/auth/slug').then(res => {
      if (res.data.slug) {
        setSlug(res.data.slug)
        setInput(res.data.slug)
      } else {
        setEditing(true)
      }
    }).catch(() => {})
  }, [])

  async function saveSlug() {
    if (!input.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await axios.post('/api/auth/slug', { slug: input.trim() })
      setSlug(res.data.slug)
      setEditing(false)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  const base = 'https://fleetai.co.in'
  const links = [
    {
      key: 'dashboard',
      label: 'Dashboard',
      icon: '⊞',
      url: base,
      desc: 'Owner login'
    },
    {
      key: 'onboard',
      label: 'Onboard form',
      icon: '✎',
      url: slug ? `${base}/onboard/${slug}` : null,
      desc: 'Send to renters'
    },
    {
      key: 'tablet',
      label: 'Tablet',
      icon: '⬜',
      url: `${base}/tablet`,
      desc: 'Employee clock in/out'
    },
  ]

  return (
    <div className="bg-surface border border-border rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
          Quick links
        </h3>
        {slug && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-accent hover:underline"
          >
            Edit name
          </button>
        )}
      </div>

      {/* Slug setup */}
      {editing && (
        <div className="mb-4 p-3 bg-surface2 rounded-lg border border-border">
          <p className="text-xs text-text-muted mb-2">
            Set your short link name — used in the onboard form URL
          </p>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center bg-surface border border-border rounded-lg px-3 text-sm overflow-hidden">
              <span className="text-text-muted shrink-0">fleetai.co.in/onboard/</span>
              <input
                value={input}
                onChange={e => setInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="your-business"
                className="flex-1 bg-transparent text-text-primary focus:outline-none py-2 min-w-0"
                maxLength={30}
              />
            </div>
            <button
              onClick={saveSlug}
              disabled={saving || !input.trim()}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? '...' : 'Save'}
            </button>
          </div>
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
      )}

      {/* Links */}
      <div className="space-y-2">
        {links.map(link => (
          <div
            key={link.key}
            className="flex items-center justify-between p-2.5 bg-surface2 rounded-lg border border-border"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm">{link.icon}</span>
                <span className="text-sm font-medium text-text-primary">{link.label}</span>
                <span className="text-xs text-text-muted">— {link.desc}</span>
              </div>
              {link.url ? (
                <p className="text-xs text-text-muted mt-0.5 ml-6 truncate">{link.url}</p>
              ) : (
                <p className="text-xs text-amber-500 mt-0.5 ml-6">Set your link name first ↑</p>
              )}
            </div>
            {link.url && (
              <button
                onClick={() => copy(link.url!, link.key)}
                className="ml-3 shrink-0 px-3 py-1.5 text-xs border border-border rounded-lg text-text-secondary hover:bg-surface transition-colors"
              >
                {copied === link.key ? '✓ Copied' : 'Copy'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}