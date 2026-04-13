import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import type { Renter } from '../../types'
import axios from 'axios'
import { useAuth0 } from '@auth0/auth0-react'
import RenterDetail from './RenterDetail'
import PendingModal from './PendingModal'

function Toast({ message, type }: { message: string; type: 'success' | 'warning' }) {
  return (
    <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-lg text-sm font-medium ${type === 'success' ? 'bg-green text-white' : 'bg-amber text-white'}`}>
      {message}
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
  const { renters, rentersLoading, fetchRenters } = useStore()
  const { user } = useAuth0()
  const [selected, setSelected] = useState<Renter | null>(null)
  const [search, setSearch] = useState('')
  const [sendingLink, setSendingLink] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [showNewRenter, setShowNewRenter] = useState(false)
  const [showPending, setShowPending] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null)
  const [pendingModal, setPendingModal] = useState<Renter | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)

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
  const filtered = activeRenters.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.phone.includes(search)
  )

  function onToast(msg: string, type: 'success' | 'warning') { setToast({ message: msg, type }) }

  async function handleSendLink() {
    if (!newPhone.trim()) return
    setSendingLink(true)
    try {
      await axios.post('/api/renters/send-onboarding', { phone: newPhone.trim(), ownerEmail: user?.email || '' })
      setToast({ message: `✅ Link sent to ${newPhone.trim()}`, type: 'success' })
    } catch {
      const link = `${window.location.origin}/onboard/${encodeURIComponent(newPhone.trim())}?owner=${encodeURIComponent(user?.email || '')}`
      await navigator.clipboard.writeText(link).catch(() => {})
      setToast({ message: '📋 Link copied to clipboard', type: 'success' })
    } finally { setSendingLink(false); setNewPhone(''); setShowNewRenter(false) }
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {lightbox && (
        <div className="fixed inset-0 bg-black/90 z-[99999] flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} className="max-w-full max-h-full rounded-xl object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl">✕</button>
        </div>
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
            <div className="bg-accent-bg border border-accent/20 rounded-xl p-3">
              <p className="text-xs text-text-muted mb-2">Send onboarding link</p>
              <input type="tel" placeholder="04XX XXX XXX" value={newPhone} onChange={e => setNewPhone(e.target.value)}
                className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent mb-2" />
              <div className="flex gap-2">
                <button onClick={handleSendLink} disabled={sendingLink || !newPhone.trim()} className="flex-1 bg-accent text-white text-xs font-medium py-2 rounded-lg disabled:opacity-50">
                  {sendingLink ? 'Sending...' : '📲 Send'}
                </button>
                <button onClick={() => setShowNewRenter(false)} className="px-3 py-2 text-xs text-text-secondary border border-border rounded-lg">Cancel</button>
              </div>
            </div>
          )}

          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-surface2 border border-border text-text-primary placeholder-text-muted text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {rentersLoading ? (
            <div className="p-8 text-center text-text-muted text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-sm">No renters found</div>
          ) : filtered.map(renter => (
            <div key={renter._id} onClick={() => setSelected(renter)}
              className={`px-4 py-3.5 cursor-pointer hover:bg-surface2 transition-colors ${selected?._id === renter._id ? 'bg-accent-bg border-l-2 border-accent' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary text-sm truncate">{renter.name}</p>
                  <p className="text-text-muted text-xs mt-0.5">{renter.phone}</p>
                  {(renter as any).updatedAt && (renter as any).status === 'active' && (
                    <p className="text-text-muted text-xs">Approved {new Date((renter as any).updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColors[renter.payway?.status || 'not_setup']}`}>
                    {statusLabels[renter.payway?.status || 'not_setup']}
                  </span>
                  {renter.payway?.weeklyAmount && <span className="text-[10px] text-text-muted">${renter.payway.weeklyAmount}/wk</span>}
                </div>
              </div>
              {renter.currentVehicle && typeof renter.currentVehicle === 'object' && (
                <span className="text-[10px] font-mono text-accent mt-1 block">{(renter.currentVehicle as any).plate}</span>
              )}
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
  )
}