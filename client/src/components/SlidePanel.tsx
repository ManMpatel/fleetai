import { useEffect, useState } from 'react'
import type { Vehicle } from '../types'
import { useStore } from '../store/useStore'

function formatDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function isOverdue(d?: string) {
  if (!d) return false
  return new Date(d) < new Date()
}

const statusColors = {
  available: 'bg-green-bg text-green border-green/20',
  rented: 'bg-accent-bg text-accent border-accent/20',
  service: 'bg-amber-bg text-amber border-amber/20',
}

interface InfoRowProps {
  label: string
  value: string
  alert?: boolean
}

function InfoRow({ label, value, alert }: InfoRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-text-muted text-sm">{label}</span>
      <span className={`text-sm font-medium ${alert ? 'text-red' : 'text-text-primary'}`}>{value}</span>
    </div>
  )
}

export default function SlidePanel() {
  const { selectedVehicle, selectVehicle, updateVehicle } = useStore()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Partial<Vehicle>>({})
  const [saving, setSaving] = useState(false)

  const vehicle = selectedVehicle

  useEffect(() => {
    if (vehicle) {
      setForm({
        status: vehicle.status,
        regoExpiry: vehicle.regoExpiry?.slice(0, 10),
        pinkSlip: vehicle.pinkSlip?.slice(0, 10),
        greenSlip: vehicle.greenSlip?.slice(0, 10),
        lastService: vehicle.lastService?.slice(0, 10),
        notes: vehicle.notes,
      })
      setEditing(false)
    }
  }, [vehicle])

  if (!vehicle) return null

  const unpaidFines = vehicle.fines.filter((f) => !f.paid)

  async function handleSave() {
    if (!vehicle) return
    setSaving(true)
    await updateVehicle(vehicle.plate, form)
    setSaving(false)
    setEditing(false)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40 transition-opacity"
        onClick={() => selectVehicle(null)}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[480px] bg-surface z-50 shadow-2xl flex flex-col overflow-hidden border-l border-border">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-border bg-surface2">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-text-primary font-mono">{vehicle.plate}</h2>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${statusColors[vehicle.status]}`}>
                {vehicle.status.charAt(0).toUpperCase() + vehicle.status.slice(1)}
              </span>
            </div>
            <p className="text-text-secondary text-sm">
              {vehicle.model} · {vehicle.year} · {vehicle.type.charAt(0).toUpperCase() + vehicle.type.slice(1)}
            </p>
          </div>
          <button
            onClick={() => selectVehicle(null)}
            className="p-2 rounded-lg hover:bg-surface transition-colors text-text-muted hover:text-text-primary"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Renter info */}
          {vehicle.currentRenter && typeof vehicle.currentRenter === 'object' && (
            <section>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Current Renter</h3>
              <div className="bg-accent-bg border border-accent/20 rounded-lg p-4 space-y-1.5">
                <p className="font-semibold text-text-primary">{vehicle.currentRenter.name}</p>
                <p className="text-sm text-text-secondary">{vehicle.currentRenter.phone}</p>
                <p className="text-sm text-text-secondary">{vehicle.currentRenter.email}</p>
                {vehicle.rentStartDate && (
                  <p className="text-xs text-text-muted mt-2">Renting since {formatDate(vehicle.rentStartDate)}</p>
                )}
              </div>
            </section>
          )}

          {/* Compliance dates */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Compliance</h3>
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs text-accent hover:text-accent/80 font-medium transition-colors"
                >
                  Edit
                </button>
              )}
            </div>

            {editing ? (
              <div className="bg-surface2 rounded-lg border border-border p-4 space-y-3">
                {[
                  { key: 'status', label: 'Status', type: 'select', options: ['available', 'rented', 'service'] },
                  { key: 'regoExpiry', label: 'Rego Expiry', type: 'date' },
                  { key: 'pinkSlip', label: 'Pink Slip', type: 'date' },
                  { key: 'greenSlip', label: 'Green Slip', type: 'date' },
                  { key: 'lastService', label: 'Last Service', type: 'date' },
                ].map(({ key, label, type, options }) => (
                  <div key={key}>
                    <label className="block text-xs text-text-muted mb-1">{label}</label>
                    {type === 'select' ? (
                      <select
                        value={(form as Record<string, string>)[key] || ''}
                        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                        className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
                      >
                        {options!.map((o) => (
                          <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="date"
                        value={(form as Record<string, string>)[key] || ''}
                        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                        className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
                      />
                    )}
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-text-muted mb-1">Notes</label>
                  <textarea
                    rows={3}
                    value={form.notes || ''}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent resize-none"
                    placeholder="Add notes..."
                  />
                </div>
              </div>
            ) : (
              <div className="bg-surface2 rounded-lg border border-border px-4">
                <InfoRow label="Rego Expiry" value={formatDate(vehicle.regoExpiry)} alert={isOverdue(vehicle.regoExpiry)} />
                <InfoRow label="Pink Slip" value={formatDate(vehicle.pinkSlip)} alert={isOverdue(vehicle.pinkSlip)} />
                <InfoRow label="Green Slip" value={formatDate(vehicle.greenSlip)} alert={isOverdue(vehicle.greenSlip)} />
                <InfoRow label="Last Service" value={formatDate(vehicle.lastService)} />
              </div>
            )}
          </section>

          {/* Fines */}
          {vehicle.fines.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                Fines & Tolls ({vehicle.fines.length})
              </h3>
              <div className="space-y-2">
                {vehicle.fines.map((fine) => (
                  <div
                    key={fine._id}
                    className={`flex items-center justify-between p-3 rounded-lg border text-sm ${
                      fine.paid ? 'bg-surface2 border-border opacity-60' : 'bg-red-bg border-red/20'
                    }`}
                  >
                    <div>
                      <p className={`font-medium ${fine.paid ? 'text-text-secondary' : 'text-red'}`}>
                        ${fine.amount.toFixed(2)}
                      </p>
                      <p className="text-text-muted text-xs mt-0.5">{fine.description}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${fine.paid ? 'bg-green-bg text-green' : 'bg-red-bg text-red'}`}>
                      {fine.paid ? 'Paid' : 'Unpaid'}
                    </span>
                  </div>
                ))}
              </div>
              {unpaidFines.length > 0 && (
                <p className="mt-2 text-sm font-semibold text-red">
                  Total outstanding: ${unpaidFines.reduce((a, f) => a + f.amount, 0).toFixed(2)}
                </p>
              )}
            </section>
          )}

          {/* Notes */}
          {!editing && vehicle.notes && (
            <section>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Notes</h3>
              <p className="text-text-secondary text-sm bg-surface2 rounded-lg border border-border p-4">{vehicle.notes}</p>
            </section>
          )}
        </div>

        {/* Footer actions */}
        {editing && (
          <div className="px-6 py-4 border-t border-border bg-surface2 flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-accent text-white text-sm font-medium py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-4 py-2.5 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-surface transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </>
  )
}
