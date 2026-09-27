import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import type { Renter } from '../../types'
import axios from 'axios'
import RenterDetail from './RenterDetail'
import PendingModal from './PendingModal'
import { SkeletonListRow } from '../../components/Skeleton'
import StatCard from '../../components/StatCard'

function Toast({ message, type }: { message: string; type: 'success' | 'warning' }) {
  return (
    <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-lg text-sm font-medium ${type === 'success' ? 'bg-green text-white' : 'bg-amber text-white'}`}>
      {message}
    </div>
  )
}

const EMPTY_MANUAL = {
  name: '', phone: '', email: '', dateOfBirth: '', licenceNumber: '', licenceExpiry: '',
  address: '', vehicleType: '' as '' | 'scooter' | 'car' | 'e-bike',
  emergencyContactName: '', emergencyContactPhone: '',
}

function ManualAddModal({ onClose, onSaved }: { onClose: () => void; onSaved: (renter: any) => void }) {
  const [form, setForm] = useState(EMPTY_MANUAL)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(field: keyof typeof EMPTY_MANUAL, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
  }

  async function handleSubmit() {
    setSaving(true)
    setError('')
    try {
      const body: Record<string, string> = {}
      for (const [k, v] of Object.entries(form)) {
        if (v.trim()) body[k] = v.trim()
      }
      const { data } = await axios.post('/api/renters', { ...body, status: 'active' })
      onSaved(data)
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setError('That phone number is already registered.')
      } else {
        setError(err?.response?.data?.error || 'Failed to save renter.')
      }
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent placeholder-text-muted'
  const labelCls = 'block text-xs font-medium text-text-secondary mb-1'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-text-primary">Add Renter Manually</h2>
            <p className="text-xs text-text-muted mt-0.5">All fields are optional — fill in what you have</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full Name</label>
              <input className={inputCls} placeholder="e.g. John Smith" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input className={inputCls} type="tel" placeholder="04XX XXX XXX" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input className={inputCls} type="email" placeholder="email@example.com" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Date of Birth</label>
              <input className={inputCls} type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Licence Number</label>
              <input className={inputCls} placeholder="e.g. 12345678" value={form.licenceNumber} onChange={e => set('licenceNumber', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Licence Expiry</label>
              <input className={inputCls} type="date" value={form.licenceExpiry} onChange={e => set('licenceExpiry', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Vehicle Type</label>
              <select className={inputCls} value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}>
                <option value="">— Select —</option>
                <option value="scooter">Scooter</option>
                <option value="car">Car</option>
                <option value="e-bike">E-Bike</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Address</label>
            <input className={inputCls} placeholder="e.g. 12 Smith St, Sydney NSW 2000" value={form.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Emergency Contact Name</label>
              <input className={inputCls} placeholder="e.g. Jane Smith" value={form.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Emergency Contact Phone</label>
              <input className={inputCls} type="tel" placeholder="04XX XXX XXX" value={form.emergencyContactPhone} onChange={e => set('emergencyContactPhone', e.target.value)} />
            </div>
          </div>
          {error && <p className="text-red text-xs bg-red-bg border border-red/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary border border-border rounded-lg hover:bg-surface2">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="flex-1 bg-accent text-white text-sm font-medium py-2 rounded-lg hover:bg-accent/90 disabled:opacity-50">
            {saving ? 'Saving...' : 'Add Renter'}
          </button>
        </div>
      </div>
    </div>
  )
}

const statusColors = {
  active: 'bg-green-bg text-green', paused: 'bg-amber-bg text-amber',
  cancelled: 'bg-red-bg text-red', not_setup: 'bg-surface2 text-text-muted',
}
const statusLabels = {
  active: 'Active', paused: 'Paused', cancelled: 'Cancelled', not_setup: 'Not Setup',
}

export default function RentersPage() {
  const { renters, rentersLoading, fetchRenters, session } = useStore()
  const [selected, setSelected] = useState<Renter | null>(null)
  const [search, setSearch] = useState('')
  const [sendingLink, setSendingLink] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [showNewRenter, setShowNewRenter] = useState(false)
  const [showManualAdd, setShowManualAdd] = useState(false)
  const [showPending, setShowPending] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null)
  const [pendingModal, setPendingModal] = useState<Renter | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [sort, setSort] = useState<'recent' | 'az'>('recent')

  useEffect(() => { fetchRenters() }, [fetchRenters])

  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }
  }, [toast])

  useEffect(() => {
    if (selected) {
      const updated = renters.find(r => r._id === selected._id)
      if (updated) setSelected(updated)
    }
  }, [renters])

  const activeRenters = renters.filter(r => (r as any).status !== 'pending')
  const pendingRenters = renters.filter(r => (r as any).status === 'pending')
  const filtered = activeRenters
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.phone.includes(search))
    .sort((a, b) => sort === 'az'
      ? a.name.localeCompare(b.name)
      : new Date((b as any).updatedAt || 0).getTime() - new Date((a as any).updatedAt || 0).getTime()
    )

  function onToast(msg: string, type: 'success' | 'warning') { setToast({ message: msg, type }) }

  async function handleSendLink() {
    if (!newPhone.trim()) return
    setSendingLink(true)
    try {
      await axios.post('/api/renters/send-onboarding', { phone: newPhone.trim() })
      setToast({ message: `✅ WhatsApp sent to ${newPhone.trim()}`, type: 'success' })
    } catch {
      const link = `${window.location.origin}/onboard/${encodeURIComponent(session?.org?.slug || '')}`
      await navigator.clipboard.writeText(link).catch(() => {})
      setToast({ message: '📋 Link copied to clipboard', type: 'success' })
    } finally { setSendingLink(false); setNewPhone(''); setShowNewRenter(false) }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {lightbox && (
        <div className="fixed inset-0 bg-black/90 z-[99999] flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} className="max-w-full max-h-full rounded-xl object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl">✕</button>
        </div>
      )}

      {showManualAdd && (
        <ManualAddModal
          onClose={() => setShowManualAdd(false)}
          onSaved={renter => {
            fetchRenters()
            setSelected(renter)
            setShowManualAdd(false)
            setShowNewRenter(false)
            setToast({ message: `✅ ${renter.name || 'Renter'} added`, type: 'success' })
          }}
        />
      )}

      {pendingModal && (
        <PendingModal
          renter={pendingModal}
          onClose={() => setPendingModal(null)}
          onToast={onToast}
          onRefresh={fetchRenters}
          setLightbox={setLightbox}
        />
      )}

      {/* Pending drawer */}
      {showPending && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowPending(false)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-surface border-l border-border z-50 flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-text-primary">Pending Approvals ({pendingRenters.length})</h2>
              <button onClick={() => setShowPending(false)} className="text-text-muted hover:text-text-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {pendingRenters.map(renter => (
                <div key={renter._id}
                  onClick={() => { setPendingModal(renter); setShowPending(false) }}
                  className="bg-surface2 border border-border rounded-xl p-4 cursor-pointer hover:border-accent transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-semibold text-text-primary text-sm">{renter.name}</p>
                      <p className="text-text-muted text-xs">{renter.phone}</p>
                    </div>
                    <span className="text-[10px] bg-amber-bg text-amber px-2 py-0.5 rounded-full font-medium">Pending</span>
                  </div>
                  <p className="text-xs text-accent">Click to review →</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="px-6 py-3 border-b border-border bg-surface">
        <StatCard label="Total Renters" value={renters.length} color="accent" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>} />
      </div>
      <div className="flex-1 flex overflow-hidden">
      {/* Left panel — list */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border bg-surface overflow-hidden">
        <div className="px-4 py-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-text-primary">Renters</h1>
              <p className="text-text-muted text-xs">{activeRenters.length} active</p>
            </div>
            <div className="flex items-center gap-2">
              {pendingRenters.length > 0 && (
                <button onClick={() => setShowPending(true)} className="relative bg-amber-bg text-amber text-xs font-medium px-2.5 py-1.5 rounded-lg border border-amber/20">
                  ⏳ {pendingRenters.length}
                </button>
              )}
              <button onClick={() => setShowNewRenter(!showNewRenter)} className="w-8 h-8 bg-accent text-white rounded-lg flex items-center justify-center hover:bg-accent/90">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          {showNewRenter && (
            <div className="bg-accent-bg border border-accent/20 rounded-xl p-3 space-y-3">
              <div>
                <p className="text-xs font-medium text-text-secondary mb-2">Send onboarding link</p>
                <input type="tel" placeholder="04XX XXX XXX" value={newPhone} onChange={e => setNewPhone(e.target.value)}
                  className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent mb-2" />
                <button onClick={handleSendLink} disabled={sendingLink || !newPhone.trim()} className="w-full bg-accent text-white text-xs font-medium py-2 rounded-lg disabled:opacity-50">
                  {sendingLink ? 'Sending...' : '💬 Send via WhatsApp'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-text-muted">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div>
                <button
                  onClick={() => { setShowManualAdd(true); setShowNewRenter(false) }}
                  className="w-full flex items-center justify-center gap-2 border border-border text-text-primary text-xs font-medium py-2 rounded-lg hover:bg-surface2 transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
                  </svg>
                  Add manually
                </button>
              </div>
              <button onClick={() => setShowNewRenter(false)} className="w-full text-xs text-text-muted text-center hover:text-text-secondary">Cancel</button>
            </div>
          )}

          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-surface2 border border-border text-text-primary placeholder-text-muted text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
          <div className="flex items-center gap-1 bg-surface2 border border-border rounded-lg p-0.5 self-start">
            <button onClick={() => setSort('recent')} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${sort === 'recent' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}>Recent</button>
            <button onClick={() => setSort('az')} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${sort === 'az' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}>A–Z</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {rentersLoading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonListRow key={i} />)
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-sm">No renters found</div>
          ) : filtered.map(renter => (
            <div key={renter._id} onClick={() => setSelected(renter)}
              className={`px-4 py-3.5 cursor-pointer hover:bg-surface2 transition-colors ${selected?._id === renter._id ? 'bg-accent-bg border-l-2 border-accent' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary text-sm truncate">{renter.name}</p>
                  <p className="text-text-muted text-xs mt-0.5">{renter.phone}</p>
                  {(renter as any).approvedAt && (renter as any).status === 'active' && (
                    <p className="text-text-muted text-xs">Approved {new Date((renter as any).approvedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColors[renter.payway?.status || 'not_setup']}`}>
                    {statusLabels[renter.payway?.status || 'not_setup']}
                  </span>
                  {renter.payway?.lastPaymentStatus === 'failed' && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-bg text-red">Payment failed</span>
                  )}
                  {renter.payway?.lastPaymentStatus === 'dishonoured' && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-bg text-red">Dishonoured ⚠️</span>
                  )}
                  {renter.payway?.weeklyAmount && <span className="text-[10px] text-text-muted">${renter.payway.weeklyAmount}/wk</span>}
                </div>
              </div>
              {((renter as any).currentVehicles?.filter((v: any) => typeof v === 'object' && v?.plate) || (renter.currentVehicle && typeof renter.currentVehicle === 'object' ? [renter.currentVehicle] : [])).map((v: any, i: number) => (
                <span key={i} className="text-[10px] font-mono text-accent mt-0.5 block">{v.plate}</span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — detail */}
      {selected ? (
        <RenterDetail key={selected._id} renter={selected} onToast={onToast} onRefresh={fetchRenters} />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-30">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
            <p className="text-sm text-text-muted">Select a renter to view details</p>
            {pendingRenters.length > 0 && (
              <button onClick={() => setShowPending(true)} className="mt-4 text-xs bg-amber-bg text-amber px-4 py-2 rounded-lg border border-amber/20 font-medium">
                {pendingRenters.length} pending approval{pendingRenters.length > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}