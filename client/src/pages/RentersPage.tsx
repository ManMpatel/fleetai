import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Renter } from '../types'
import axios from 'axios'

const statusColors = {
  active: 'bg-green-bg text-green',
  paused: 'bg-amber-bg text-amber',
  cancelled: 'bg-red-bg text-red',
  not_setup: 'bg-surface2 text-text-muted',
}

const statusLabels = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  not_setup: 'Not Setup',
}

// ── Toast notification ─────────────────────────────────────
function Toast({ message, type }: { message: string; type: 'success' | 'warning' }) {
  return (
    <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
      type === 'success' ? 'bg-green text-white' : 'bg-amber text-white'
    }`}>
      {message}
    </div>
  )
}

// ── Confirmation modal ─────────────────────────────────────
function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  confirmColor: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center px-4">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-base font-bold text-text-primary mb-2">{title}</h3>
        <p className="text-sm text-text-secondary mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className={`flex-1 text-white text-sm font-medium py-2.5 rounded-lg transition-colors ${confirmColor}`}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-surface2 text-text-secondary text-sm font-medium py-2.5 rounded-lg border border-border hover:bg-surface transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RentersPage() {
  const { renters, rentersLoading, fetchRenters } = useStore()
  const [selected, setSelected] = useState<Renter | null>(null)
  const [activateAmount, setActivateAmount] = useState('')
  const [search, setSearch] = useState('')
  const [sendingLink, setSendingLink] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [showNewRenter, setShowNewRenter] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Confirmation modal state
  const [confirm, setConfirm] = useState<{
    show: boolean
    action: 'pause' | 'resume' | 'activate' | null
  }>({ show: false, action: null })

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null)

  useEffect(() => { fetchRenters() }, [fetchRenters])

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(t)
    }
  }, [toast])

  // Keep selected in sync with renters list
  useEffect(() => {
    if (selected) {
      const updated = renters.find(r => r._id === selected._id)
      if (updated) setSelected(updated)
    }
  }, [renters])

  const filtered = renters.filter(r =>
    !search ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.phone.includes(search)
  )

  async function handleSendOnboardingLink() {
    if (!newPhone.trim()) return
    setSendingLink(true)
    try {
      const res = await axios.post('/api/renters/send-onboarding', { phone: newPhone.trim() })
      if (res.data.success) {
        setToast({ message: `✅ Link sent to ${newPhone.trim()} via WhatsApp!`, type: 'success' })
      } else {
        setToast({ message: `❌ Could not send: ${res.data.error}`, type: 'warning' })
      }
      setNewPhone('')
      setShowNewRenter(false)
    } catch {
      setToast({ message: '❌ Failed to send link. Check Twilio config.', type: 'warning' })
    } finally {
      setSendingLink(false)
    }
  }

  async function executeAction() {
    if (!selected || !confirm.action) return
    setActionLoading(true)
    setConfirm({ show: false, action: null })

    try {
      if (confirm.action === 'pause') {
        await axios.post(`/api/renters/${encodeURIComponent(selected.phone)}/pause`)
        // Update selected immediately without waiting for fetchRenters
        setSelected(prev => prev ? {
          ...prev,
          payway: { ...prev.payway!, status: 'paused' }
        } : null)
        setToast({ message: `⏸️ Auto-debit paused for ${selected.name}`, type: 'warning' })
      }

      if (confirm.action === 'resume') {
        await axios.post(`/api/renters/${encodeURIComponent(selected.phone)}/resume`)
        setSelected(prev => prev ? {
          ...prev,
          payway: { ...prev.payway!, status: 'active' }
        } : null)
        setToast({ message: `▶️ Auto-debit resumed for ${selected.name}`, type: 'success' })
      }

      if (confirm.action === 'activate') {
        if (!activateAmount) return
        await axios.post(`/api/renters/${encodeURIComponent(selected.phone)}/activate`, {
          weeklyAmount: parseFloat(activateAmount)
        })
        setSelected(prev => prev ? {
          ...prev,
          payway: {
            status: 'active',
            weeklyAmount: parseFloat(activateAmount),
            startDate: new Date().toISOString(),
          }
        } : null)
        setToast({ message: `✅ Auto-debit activated for ${selected.name}`, type: 'success' })
        setActivateAmount('')
      }

      // Refresh list in background
      fetchRenters()
    } catch {
      setToast({ message: '❌ Action failed. Please try again.', type: 'warning' })
    } finally {
      setActionLoading(false)
    }
  }

  const paywayStatus = selected?.payway?.status || 'not_setup'

  return (
    <div className="flex-1 flex min-h-screen bg-bg">
      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Confirmation Modal */}
      {confirm.show && selected && (
        <ConfirmModal
          title={
            confirm.action === 'pause' ? `Pause auto-debit?` :
            confirm.action === 'resume' ? `Resume auto-debit?` :
            `Activate auto-debit?`
          }
          message={
            confirm.action === 'pause'
              ? `This will stop weekly payments from ${selected.name}'s account. You can resume anytime.`
              : confirm.action === 'resume'
              ? `This will restart weekly $${selected.payway?.weeklyAmount} payments from ${selected.name}'s account.`
              : `This will start weekly $${activateAmount} payments from ${selected.name}'s account.`
          }
          confirmLabel={
            confirm.action === 'pause' ? 'Yes, Pause' :
            confirm.action === 'resume' ? 'Yes, Resume' :
            'Yes, Activate'
          }
          confirmColor={
            confirm.action === 'pause' ? 'bg-amber hover:bg-amber/90' :
            'bg-green hover:bg-green/90'
          }
          onConfirm={executeAction}
          onCancel={() => setConfirm({ show: false, action: null })}
        />
      )}

      {/* Left — Renter List */}
      <div className="flex flex-col w-full max-w-xl border-r border-border bg-surface">
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-text-primary">Renters</h1>
              <p className="text-text-muted text-sm mt-0.5">{renters.length} registered</p>
            </div>
            <button
              onClick={() => setShowNewRenter(true)}
              className="flex items-center gap-2 bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Renter
            </button>
          </div>
          <input
            type="text"
            placeholder="Search name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-surface2 border border-border text-text-primary placeholder-text-muted text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-accent"
          />
        </div>

        {showNewRenter && (
          <div className="mx-4 my-3 p-4 bg-accent-bg border border-accent/20 rounded-xl">
            <p className="text-sm font-medium text-text-primary mb-1">Send onboarding link</p>
            <p className="text-xs text-text-muted mb-3">Renter gets a WhatsApp link to fill their details.</p>
            <input
              type="tel"
              placeholder="04XX XXX XXX"
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSendOnboardingLink}
                disabled={sendingLink || !newPhone.trim()}
                className="flex-1 bg-accent text-white text-sm font-medium py-2 rounded-lg hover:bg-accent/90 disabled:opacity-50"
              >
                {sendingLink ? 'Sending...' : 'Send via WhatsApp'}
              </button>
              <button
                onClick={() => setShowNewRenter(false)}
                className="px-4 py-2 text-sm text-text-secondary border border-border rounded-lg hover:bg-surface2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {rentersLoading ? (
            <div className="p-8 text-center text-text-muted text-sm">Loading renters...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-text-muted text-sm">No renters found</div>
          ) : (
            filtered.map(renter => (
              <div
                key={renter._id}
                onClick={() => setSelected(renter)}
                className={`px-6 py-4 cursor-pointer hover:bg-surface2 transition-colors ${
                  selected?._id === renter._id ? 'bg-accent-bg border-l-2 border-accent' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-text-primary text-sm">{renter.name}</p>
                    <p className="text-text-muted text-xs mt-0.5">{renter.phone}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColors[renter.payway?.status || 'not_setup']}`}>
                      {statusLabels[renter.payway?.status || 'not_setup']}
                    </span>
                    {renter.currentVehicle && typeof renter.currentVehicle === 'object' && (
                      <span className="text-[10px] font-mono text-accent">{(renter.currentVehicle as any).plate}</span>
                    )}
                  </div>
                </div>
                {renter.payway?.weeklyAmount && (
                  <p className="text-xs text-text-muted mt-1">${renter.payway.weeklyAmount}/week</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right — Renter Detail */}
      {selected ? (
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-text-primary">{selected.name}</h2>
              <p className="text-text-muted text-sm mt-1">{selected.phone} · {selected.email}</p>
            </div>
            <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${statusColors[paywayStatus]}`}>
              Auto-debit: {statusLabels[paywayStatus]}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {/* Personal Details */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Personal Details</h3>
              <div className="space-y-2.5 text-sm">
                {[
                  ['Date of Birth', selected.dateOfBirth || '—'],
                  ['Licence No.', selected.licenceNumber || '—'],
                  ['Vehicle Type', selected.vehicleType || '—'],
                  ['Emergency Contact', selected.emergencyContactName || '—'],
                  ['Emergency Phone', selected.emergencyContactPhone || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-text-muted">{label}</span>
                    <span className="text-text-primary font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Address */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Address</h3>
              <div className="space-y-2.5 text-sm">
                {[
                  ['Street', selected.address?.street || '—'],
                  ['City', selected.address?.city || '—'],
                  ['State', selected.address?.state || '—'],
                  ['Postcode', selected.address?.postcode || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-text-muted">{label}</span>
                    <span className="text-text-primary font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bank Details */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Bank Details</h3>
              <div className="space-y-2.5 text-sm">
                {[
                  ['Bank', selected.bankName || '—'],
                  ['Account Name', selected.accountHolderName || '—'],
                  ['BSB', selected.bsbNumber || '—'],
                  ['Account No.', selected.accountNumber ? `****${selected.accountNumber.slice(-3)}` : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-text-muted">{label}</span>
                    <span className="text-text-primary font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Auto-debit Control */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Auto-Debit Control</h3>

              {paywayStatus === 'not_setup' && (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">Set weekly amount to activate auto-debit</p>
                  <input
                    type="number"
                    placeholder="Weekly amount e.g. 150"
                    value={activateAmount}
                    onChange={e => setActivateAmount(e.target.value)}
                    className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => setConfirm({ show: true, action: 'activate' })}
                    disabled={!activateAmount || actionLoading}
                    className="w-full bg-green text-white text-sm font-medium py-2.5 rounded-lg hover:bg-green/90 disabled:opacity-50 transition-colors"
                  >
                    Activate Auto-Debit
                  </button>
                </div>
              )}

              {paywayStatus === 'active' && (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Weekly Amount</span>
                    <span className="text-green font-bold">${selected.payway?.weeklyAmount}/week</span>
                  </div>
                  {selected.payway?.nextDebitDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">Next Debit</span>
                      <span className="text-text-primary">
                        {new Date(selected.payway.nextDebitDate).toLocaleDateString('en-AU')}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => setConfirm({ show: true, action: 'pause' })}
                    disabled={actionLoading}
                    className="w-full bg-amber-bg text-amber border border-amber/20 text-sm font-medium py-2.5 rounded-lg hover:bg-amber/10 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading ? 'Processing...' : 'Pause Auto-Debit'}
                  </button>
                </div>
              )}

              {paywayStatus === 'paused' && (
                <div className="space-y-3">
                  <p className="text-xs text-amber font-medium">⏸️ Auto-debit is currently paused</p>
                  {selected.payway?.weeklyAmount && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">Amount when resumed</span>
                      <span className="text-text-primary font-medium">${selected.payway.weeklyAmount}/week</span>
                    </div>
                  )}
                  <button
                    onClick={() => setConfirm({ show: true, action: 'resume' })}
                    disabled={actionLoading}
                    className="w-full bg-green text-white text-sm font-medium py-2.5 rounded-lg hover:bg-green/90 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading ? 'Processing...' : 'Resume Auto-Debit'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Licence Photo */}
          {selected.licencePhotoUrl && (
            <div className="mt-5 bg-surface border border-border rounded-xl p-5">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Licence Photo</h3>
              <img
                src={selected.licencePhotoUrl}
                alt="Licence"
                className="max-h-48 rounded-lg border border-border object-contain"
              />
            </div>
          )}

          {/* Rental History */}
          {selected.rentalHistory?.length > 0 && (
            <div className="mt-5 bg-surface border border-border rounded-xl p-5">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Rental History</h3>
              <div className="space-y-3">
                {selected.rentalHistory.map((record, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0 text-sm">
                    <div>
                      <span className="font-mono font-semibold text-text-primary">{record.plate}</span>
                      <span className="text-text-muted ml-2">
                        {new Date(record.startDate).toLocaleDateString('en-AU')} →{' '}
                        {record.endDate ? new Date(record.endDate).toLocaleDateString('en-AU') : 'Present'}
                      </span>
                    </div>
                    {record.totalAmount && (
                      <span className="text-text-secondary font-medium">${record.totalAmount}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-muted">
          <div className="text-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-12 h-12 mx-auto mb-3 opacity-30">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
            <p className="text-sm">Select a renter to view details</p>
          </div>
        </div>
      )}
    </div>
  )
}
