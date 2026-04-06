import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Renter } from '../types'
import axios from 'axios'
import { useAuth0 } from '@auth0/auth0-react'

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

const SCHEDULE_OPTIONS = [
  { label: 'Every day', days: 1 },
  { label: 'Every 3 days', days: 3 },
  { label: 'Every 5 days', days: 5 },
  { label: 'Every week', days: 7 },
  { label: 'Every 2 weeks', days: 14 },
  { label: 'Every 4 weeks', days: 28 },
  { label: 'Custom', days: 0 },
]

function Toast({ message, type }: { message: string; type: 'success' | 'warning' }) {
  return (
    <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-lg text-sm font-medium ${
      type === 'success' ? 'bg-green text-white' : 'bg-amber text-white'
    }`}>{message}</div>
  )
}

function ConfirmModal({ title, message, confirmLabel, confirmColor, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string
  confirmColor: string; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center px-4">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-base font-bold text-text-primary mb-2">{title}</h3>
        <p className="text-sm text-text-secondary mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} className={`flex-1 text-white text-sm font-medium py-2.5 rounded-lg ${confirmColor}`}>{confirmLabel}</button>
          <button onClick={onCancel} className="flex-1 bg-surface2 text-text-secondary text-sm font-medium py-2.5 rounded-lg border border-border">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function EditField({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-xs text-text-muted mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
    </div>
  )
}

function InfoRow({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-border last:border-0 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className={`font-medium text-right ${highlight ? 'text-green' : 'text-text-primary'}`}>{value || '—'}</span>
    </div>
  )
}

// ── Right panel detail view ─────────────────────────────────
function RenterDetail({ renter, onToast, onRefresh }: {
  renter: Renter
  onToast: (msg: string, type: 'success' | 'warning') => void
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'details' | 'payments' | 'vehicle'>('details')
  const [editing, setEditing] = useState(false)
  const [editingBank, setEditingBank] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [payments, setPayments] = useState<any[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [serviceRecords, setServiceRecords] = useState<any[]>([])
  const [serviceLoading, setServiceLoading] = useState(false)
  const [showAddService, setShowAddService] = useState(false)
  const [serviceForm, setServiceForm] = useState({ serviceType: 'general', description: '', cost: '', notes: '' })
  const [confirm, setConfirm] = useState<{ show: boolean; action: string | null }>({ show: false, action: null })
  const [weeklyAmount, setWeeklyAmount] = useState(renter.payway?.weeklyAmount?.toString() || '')
  const [selectedSchedule, setSelectedSchedule] = useState(7)
  const [customDays, setCustomDays] = useState('')
  const [editingSchedule, setEditingSchedule] = useState(false)
  const [fleetVehicles, setFleetVehicles] = useState<any[]>([])
  const [fleetLoading, setFleetLoading] = useState(false)
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [vehicleServiceRecords, setVehicleServiceRecords] = useState<any[]>([])
  const [vehicleSvcLoading, setVehicleSvcLoading] = useState(false)

  const [personalForm, setPersonalForm] = useState({
    name: renter.name || '', email: renter.email || '',
    dateOfBirth: renter.dateOfBirth || '', licenceNumber: renter.licenceNumber || '',
    vehicleType: renter.vehicleType || 'scooter',
    emergencyContactName: renter.emergencyContactName || '',
    emergencyContactPhone: renter.emergencyContactPhone || '',
  })
  const [addressForm, setAddressForm] = useState({
    street: renter.address?.street || '', city: renter.address?.city || '',
    state: renter.address?.state || 'NSW', postcode: renter.address?.postcode || '',
  })
  const [bankForm, setBankForm] = useState({
    bankName: renter.bankName || '', accountHolderName: renter.accountHolderName || '',
    bsbNumber: renter.bsbNumber || '', accountNumber: renter.accountNumber || '',
  })

  // Reset forms when renter changes
  useEffect(() => {
    setTab('details')
    setEditing(false)
    setEditingBank(false)
    setWeeklyAmount(renter.payway?.weeklyAmount?.toString() || '')
    setPersonalForm({
      name: renter.name || '', email: renter.email || '',
      dateOfBirth: renter.dateOfBirth || '', licenceNumber: renter.licenceNumber || '',
      vehicleType: renter.vehicleType || 'scooter',
      emergencyContactName: renter.emergencyContactName || '',
      emergencyContactPhone: renter.emergencyContactPhone || '',
    })
    setAddressForm({
      street: renter.address?.street || '', city: renter.address?.city || '',
      state: renter.address?.state || 'NSW', postcode: renter.address?.postcode || '',
    })
    setBankForm({
      bankName: renter.bankName || '', accountHolderName: renter.accountHolderName || '',
      bsbNumber: renter.bsbNumber || '', accountNumber: renter.accountNumber || '',
    })
  }, [renter._id])

  useEffect(() => {
    if (tab === 'vehicle') {
      setFleetLoading(true)
      axios.get('/api/fleet').then(r => setFleetVehicles(r.data || [])).finally(() => setFleetLoading(false))
      const plate = (renter.currentVehicle as any)?.plate
      if (plate) {
        setVehicleSvcLoading(true)
        axios.get(`/api/service-records?plate=${plate}`)
          .then(r => setVehicleServiceRecords(r.data || []))
          .finally(() => setVehicleSvcLoading(false))
      }
    }
    if (tab === 'payments') {
      if (renter.payway?.customerId && renter.payway?.status === 'active') {
        setPaymentsLoading(true)
        axios.get(`/api/renters/${encodeURIComponent(renter.phone)}/payments`)
          .then(res => setPayments(res.data.payments || []))
          .catch(() => setPayments([]))
          .finally(() => setPaymentsLoading(false))
      }
      // Fetch service records for current vehicle
      if ((renter.currentVehicle as any)?.plate) {
        setServiceLoading(true)
        axios.get(`/api/service-records?plate=${(renter.currentVehicle as any).plate}`)
          .then(res => setServiceRecords(res.data || []))
          .catch(() => setServiceRecords([]))
          .finally(() => setServiceLoading(false))
      }
    }
  }, [tab])

  async function handleAddService() {
    if (!serviceForm.description || !(renter.currentVehicle as any)?.plate) return
    try {
      await axios.post('/api/service-records', {
        plate: (renter.currentVehicle as any).plate,
        vehicleType: renter.vehicleType,
        vehicleCategory: 'rental',
        serviceType: serviceForm.serviceType,
        description: serviceForm.description,
        cost: serviceForm.cost ? parseFloat(serviceForm.cost) : undefined,
        notes: serviceForm.notes,
        customerName: renter.name,
        customerPhone: renter.phone,
      })
      setServiceForm({ serviceType: 'general', description: '', cost: '', notes: '' })
      setShowAddService(false)
      // Refresh
      const res = await axios.get(`/api/service-records?plate=${(renter.currentVehicle as any).plate}`)
      setServiceRecords(res.data || [])
      onToast('✅ Service record added', 'success')
    } catch {
      onToast('Failed to add service record', 'warning')
    }
  }

  const paywayStatus = renter.payway?.status || 'not_setup'
  const days = selectedSchedule === 0 ? parseInt(customDays) || 7 : selectedSchedule

  async function savePersonal() {
    setSaving(true)
    try {
      await axios.put(`/api/renters/${encodeURIComponent(renter.phone)}`, { ...personalForm, address: addressForm })
      onToast('✅ Details updated', 'success')
      setEditing(false)
      onRefresh()
    } catch { onToast('❌ Failed to save', 'warning') }
    finally { setSaving(false) }
  }

  async function saveBank() {
    setSaving(true)
    try {
      await axios.put(`/api/renters/${encodeURIComponent(renter.phone)}`, bankForm)
      onToast('✅ Bank details updated', 'success')
      setEditingBank(false)
      onRefresh()
    } catch { onToast('❌ Failed to save', 'warning') }
    finally { setSaving(false) }
  }

  async function handleActivate() {
    setActionLoading(true)
    try {
      await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/activate`, {
        weeklyAmount: parseFloat(weeklyAmount), intervalDays: days,
      })
      onToast(`✅ Auto-debit activated — $${weeklyAmount} every ${days} days`, 'success')
      onRefresh()
    } catch { onToast('❌ Failed to activate', 'warning') }
    finally { setActionLoading(false); setConfirm({ show: false, action: null }) }
  }

  async function handlePause() {
    setActionLoading(true)
    try {
      await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/pause`)
      onToast(`⏸️ Auto-debit paused`, 'warning')
      onRefresh()
    } catch { onToast('❌ Failed to pause', 'warning') }
    finally { setActionLoading(false); setConfirm({ show: false, action: null }) }
  }

  async function handleResume() {
    setActionLoading(true)
    try {
      await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/resume`)
      onToast(`▶️ Auto-debit resumed`, 'success')
      onRefresh()
    } catch { onToast('❌ Failed to resume', 'warning') }
    finally { setActionLoading(false); setConfirm({ show: false, action: null }) }
  }

  async function handleUpdate() {
    setActionLoading(true)
    try {
      await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/activate`, {
        weeklyAmount: parseFloat(weeklyAmount),
        intervalDays: days,
      })
      onToast(`✅ Schedule updated — $${weeklyAmount} every ${days} days`, 'success')
      setEditingSchedule(false)
      onRefresh()
    } catch { 
      onToast('❌ Failed to update schedule', 'warning') 
    } finally { 
      setActionLoading(false)
      setConfirm({ show: false, action: null }) 
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {confirm.show && (
        <ConfirmModal
          title={
            confirm.action === 'activate' ? 'Activate auto-debit?' :
            confirm.action === 'pause' ? 'Pause auto-debit?' :
            confirm.action === 'update' ? 'Update schedule?' :
            'Resume auto-debit?'
          }
          message={
            confirm.action === 'activate' ? `Charge ${renter.name} $${weeklyAmount} every ${days} day${days !== 1 ? 's' : ''}?` :
            confirm.action === 'pause' ? `Stop payments from ${renter.name}'s account?` :
            confirm.action === 'update' ? `Change to $${weeklyAmount} every ${days} day${days !== 1 ? 's' : ''} for ${renter.name}?` :
            `Restart payments from ${renter.name}'s account?`
          }
          confirmLabel={
            confirm.action === 'activate' ? 'Yes, Activate' :
            confirm.action === 'pause' ? 'Yes, Pause' :
            confirm.action === 'update' ? 'Yes, Update' :
            'Yes, Resume'
          }
          confirmColor={confirm.action === 'pause' ? 'bg-amber hover:bg-amber/90' : 'bg-green hover:bg-green/90'}
          onConfirm={
            confirm.action === 'activate' ? handleActivate :
            confirm.action === 'pause' ? handlePause :
            confirm.action === 'update' ? handleUpdate :
            handleResume
          }
          onCancel={() => setConfirm({ show: false, action: null })}
        />)}

      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-surface flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-text-primary">{renter.name}</h2>
          <p className="text-text-muted text-xs mt-0.5">{renter.phone} · {renter.email}</p>
        </div>
        <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${statusColors[paywayStatus]}`}>
          Debit: {statusLabels[paywayStatus]}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-surface shrink-0 px-6">
        {(['details', 'payments', 'vehicle'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
            }`}>
            {t === 'details' ? 'Personal Details' : t === 'payments' ? 'Auto-Debit & Payments' : 'Vehicle & History'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ── Details tab ── */}
        {tab === 'details' && (
          <div className="space-y-4">
            {/* Personal + Address */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface border border-border rounded-xl p-4">
                <div className="flex justify-between mb-3">
                  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Personal</h3>
                  {!editing && <button onClick={() => setEditing(true)} className="text-xs text-accent font-medium">Edit</button>}
                </div>
                {editing ? (
                  <div className="space-y-2">
                    <EditField label="Full Name" value={personalForm.name} onChange={v => setPersonalForm(p => ({ ...p, name: v }))} />
                    <EditField label="Email" value={personalForm.email} onChange={v => setPersonalForm(p => ({ ...p, email: v }))} />
                    <EditField label="Date of Birth" value={personalForm.dateOfBirth} onChange={v => setPersonalForm(p => ({ ...p, dateOfBirth: v }))} />
                    <EditField label="Licence No." value={personalForm.licenceNumber} onChange={v => setPersonalForm(p => ({ ...p, licenceNumber: v }))} />
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Vehicle Type</label>
                      <select value={personalForm.vehicleType} onChange={e => setPersonalForm(p => ({ ...p, vehicleType: e.target.value as any }))}
                        className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent">
                        <option value="scooter">Scooter</option>
                        <option value="car">Car</option>
                      </select>
                    </div>
                    <EditField label="Emergency Contact" value={personalForm.emergencyContactName} onChange={v => setPersonalForm(p => ({ ...p, emergencyContactName: v }))} />
                    <EditField label="Emergency Phone" value={personalForm.emergencyContactPhone} onChange={v => setPersonalForm(p => ({ ...p, emergencyContactPhone: v }))} />
                    <div className="flex gap-2 pt-1">
                      <button onClick={savePersonal} disabled={saving} className="flex-1 bg-accent text-white text-xs font-medium py-2 rounded-lg disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                      <button onClick={() => setEditing(false)} className="flex-1 bg-surface2 text-text-secondary text-xs py-2 rounded-lg border border-border">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <InfoRow label="Name" value={renter.name} />
                    <InfoRow label="Phone" value={renter.phone} />
                    <InfoRow label="Email" value={renter.email} />
                    <InfoRow label="DOB" value={renter.dateOfBirth} />
                    <InfoRow label="Licence" value={renter.licenceNumber} />
                    <InfoRow label="Vehicle" value={renter.vehicleType} />
                    <InfoRow label="Emergency" value={renter.emergencyContactName} />
                    <InfoRow label="Emg. Phone" value={renter.emergencyContactPhone} />
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {/* Address */}
                <div className="bg-surface border border-border rounded-xl p-4">
                  <div className="flex justify-between mb-3">
                    <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Address</h3>
                    {!editing && <button onClick={() => setEditing(true)} className="text-xs text-accent font-medium">Edit</button>}
                  </div>
                  {editing ? (
                    <div className="space-y-2">
                      <EditField label="Street" value={addressForm.street} onChange={v => setAddressForm(p => ({ ...p, street: v }))} />
                      <EditField label="City" value={addressForm.city} onChange={v => setAddressForm(p => ({ ...p, city: v }))} />
                      <div>
                        <label className="block text-xs text-text-muted mb-1">State</label>
                        <select value={addressForm.state} onChange={e => setAddressForm(p => ({ ...p, state: e.target.value }))}
                          className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent">
                          {['NSW','VIC','QLD','WA','SA','TAS','ACT','NT'].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <EditField label="Postcode" value={addressForm.postcode} onChange={v => setAddressForm(p => ({ ...p, postcode: v }))} />
                    </div>
                  ) : (
                    <div>
                      <InfoRow label="Street" value={renter.address?.street} />
                      <InfoRow label="City" value={renter.address?.city} />
                      <InfoRow label="State" value={renter.address?.state} />
                      <InfoRow label="Postcode" value={renter.address?.postcode} />
                    </div>
                  )}
                </div>

                {/* Bank */}
                <div className="bg-surface border border-border rounded-xl p-4">
                  <div className="flex justify-between mb-3">
                    <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Bank Details</h3>
                    {!editingBank && <button onClick={() => setEditingBank(true)} className="text-xs text-accent font-medium">Edit</button>}
                  </div>
                  {editingBank ? (
                    <div className="space-y-2">
                      <EditField label="Bank Name" value={bankForm.bankName} onChange={v => setBankForm(p => ({ ...p, bankName: v }))} />
                      <EditField label="Account Holder" value={bankForm.accountHolderName} onChange={v => setBankForm(p => ({ ...p, accountHolderName: v }))} />
                      <EditField label="BSB (000-000)" value={bankForm.bsbNumber} onChange={v => setBankForm(p => ({ ...p, bsbNumber: v }))} />
                      <EditField label="Account Number" value={bankForm.accountNumber} onChange={v => setBankForm(p => ({ ...p, accountNumber: v }))} />
                      <div className="flex gap-2 pt-1">
                        <button onClick={saveBank} disabled={saving} className="flex-1 bg-accent text-white text-xs font-medium py-2 rounded-lg disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                        <button onClick={() => setEditingBank(false)} className="flex-1 bg-surface2 text-text-secondary text-xs py-2 rounded-lg border border-border">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <InfoRow label="Bank" value={renter.bankName} />
                      <InfoRow label="Holder" value={renter.accountHolderName} />
                      <InfoRow label="BSB" value={renter.bsbNumber} />
                      <InfoRow label="Account" value={renter.accountNumber ? `****${renter.accountNumber.slice(-3)}` : undefined} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Photos */}
            {(renter.licencePhotoUrl || (renter as any).selfieUrl) && (
              <div className="bg-surface border border-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Identity Documents</h3>
                <div className="flex gap-4">
                  {renter.licencePhotoUrl && (
                    <div className="flex-1">
                      <p className="text-xs text-text-muted mb-2">Driver's Licence</p>
                      <img src={`${import.meta.env.VITE_API_URL}${renter.licencePhotoUrl}`} alt="Licence"
                        onClick={() => window.open(`${import.meta.env.VITE_API_URL}${renter.licencePhotoUrl}`, '_blank')}
                        className="w-full max-h-40 object-contain rounded-lg border border-border cursor-pointer hover:opacity-80" />
                    </div>
                  )}
                  {(renter as any).selfieUrl && (
                    <div className="flex-1">
                      <p className="text-xs text-text-muted mb-2">Selfie with Licence</p>
                      <img src={`${import.meta.env.VITE_API_URL}${(renter as any).selfieUrl}`} alt="Selfie"
                        onClick={() => window.open(`${import.meta.env.VITE_API_URL}${(renter as any).selfieUrl}`, '_blank')}
                        className="w-full max-h-40 object-contain rounded-lg border border-border cursor-pointer hover:opacity-80" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Vehicle & History tab ── */}
        {tab === 'vehicle' && (
          <div className="space-y-4">
            {/* Current vehicle */}
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Current Vehicle</h3>
                {(renter.currentVehicle as any)?._id && (
                  <button
                    disabled={assignLoading}
                    onClick={async () => {
                      const plate = (renter.currentVehicle as any)?.plate
                      if (!plate) return
                      setAssignLoading(true)
                      try {
                        await axios.post(`/api/fleet/${plate}/unassign`)
                        onToast('✅ Vehicle unassigned', 'success')
                        onRefresh()
                        axios.get('/api/fleet').then(r => setFleetVehicles(r.data || []))
                      } catch (err: any) {
                        onToast('❌ ' + (err.response?.data?.error || 'Failed'), 'warning')
                      } finally { setAssignLoading(false) }
                    }}
                    className="text-xs text-red-400 border border-red-200 dark:border-red-900 rounded-lg px-3 py-1.5 hover:text-red-500 disabled:opacity-40"
                  >Unassign</button>
                )}
              </div>
              {(renter.currentVehicle as any)?._id ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-xl">
                    {(renter.currentVehicle as any)?.type === 'car' ? '🚗' : '🛵'}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold font-mono text-text-primary">{(renter.currentVehicle as any)?.plate}</p>
                    <p className="text-xs text-text-muted">{(renter.currentVehicle as any)?.model} · {(renter.currentVehicle as any)?.type}</p>
                    {(renter as any).rentStartDate && (
                      <p className="text-xs text-text-muted">Since {new Date((renter as any).rentStartDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    )}
                  </div>
                  <span className="text-xs bg-green-bg text-green px-2.5 py-1 rounded-full font-medium">Active</span>
                </div>
              ) : (
                <p className="text-sm text-text-muted">No vehicle currently assigned</p>
              )}
            </div>

            {/* Assign panel */}
            <div className="bg-accent-bg border border-accent/20 rounded-xl p-4">
              <p className="text-xs font-semibold text-accent mb-3">
                {(renter.currentVehicle as any)?._id ? 'Reassign vehicle' : 'Assign a vehicle'}
              </p>
              <input
                type="text"
                placeholder="Search by plate or model..."
                value={vehicleSearch}
                onChange={e => setVehicleSearch(e.target.value)}
                className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-accent"
              />
              <div className="max-h-52 overflow-y-auto rounded-lg border border-border bg-surface divide-y divide-border">
                {fleetLoading ? (
                  <p className="text-xs text-text-muted p-3">Loading fleet...</p>
                ) : fleetVehicles.filter(v =>
                    v.plate.toLowerCase().includes(vehicleSearch.toLowerCase()) ||
                    (v.model || '').toLowerCase().includes(vehicleSearch.toLowerCase())
                  ).length === 0 ? (
                  <p className="text-xs text-text-muted p-3">No vehicles found</p>
                ) : fleetVehicles
                    .filter(v =>
                      v.plate.toLowerCase().includes(vehicleSearch.toLowerCase()) ||
                      (v.model || '').toLowerCase().includes(vehicleSearch.toLowerCase())
                    )
                    .map((v: any) => {
                      const assignedElsewhere = v.currentRenter && v.currentRenter._id !== renter._id
                      const isCurrent = (renter.currentVehicle as any)?._id === v._id
                      return (
                        <button key={v._id}
                          onClick={() => !assignedElsewhere && setSelectedVehicleId(selectedVehicleId === v._id ? '' : v._id)}
                          disabled={assignedElsewhere}
                          className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${
                            assignedElsewhere ? 'opacity-40 cursor-not-allowed' :
                            selectedVehicleId === v._id ? 'bg-accent/10' : 'hover:bg-surface2'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span>{v.type === 'car' ? '🚗' : '🛵'}</span>
                            <div>
                              <p className="text-sm font-mono font-medium text-text-primary">{v.plate}</p>
                              <p className="text-xs text-text-muted">{v.model}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            {isCurrent ? (
                              <span className="text-xs bg-green-bg text-green px-2 py-0.5 rounded-full">Current</span>
                            ) : assignedElsewhere ? (
                              <div>
                                <span className="text-xs bg-amber-bg text-amber px-2 py-0.5 rounded-full">Assigned</span>
                                <p className="text-xs text-text-muted mt-0.5">{v.currentRenter?.name}</p>
                              </div>
                            ) : (
                              <span className="text-xs bg-green-bg text-green px-2 py-0.5 rounded-full">Available</span>
                            )}
                          </div>
                        </button>
                      )
                    })}
              </div>
              {selectedVehicleId && (
                <button
                  disabled={assignLoading}
                  onClick={async () => {
                    const v = fleetVehicles.find(v => v._id === selectedVehicleId)
                    if (!v) return
                    setAssignLoading(true)
                    try {
                      await axios.post(`/api/fleet/${v.plate}/assign`, { renterId: renter._id })
                      onToast(`✅ ${v.plate} assigned to ${renter.name}`, 'success')
                      setSelectedVehicleId(''); setVehicleSearch('')
                      onRefresh()
                      axios.get('/api/fleet').then(r => setFleetVehicles(r.data || []))
                    } catch (err: any) {
                      onToast('❌ ' + (err.response?.data?.error || 'Failed'), 'warning')
                    } finally { setAssignLoading(false) }
                  }}
                  className="w-full mt-2 bg-accent text-white text-sm font-medium py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {assignLoading ? 'Assigning...' : `Assign ${fleetVehicles.find(v => v._id === selectedVehicleId)?.plate} to ${renter.name}`}
                </button>
              )}
            </div>

            {/* Vehicle history */}
            {(renter.rentalHistory || []).length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Vehicle History</h3>
                <div className="divide-y divide-border">
                  {[...(renter.rentalHistory || [])].reverse().map((h: any, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${!h.endDate ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <div className="flex-1">
                        <p className="text-sm font-mono font-medium text-text-primary">{h.plate}</p>
                        <p className="text-xs text-text-muted">
                          {new Date(h.startDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {h.endDate ? ` → ${new Date(h.endDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : ' → now'}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${!h.endDate ? 'bg-green-bg text-green' : 'bg-surface2 text-text-muted'}`}>
                        {!h.endDate ? 'Active' : 'Ended'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Service history for current plate */}
            <div className="bg-surface border border-border rounded-xl p-4">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                Service History {vehicleServiceRecords.length > 0 ? `(${vehicleServiceRecords.length})` : ''}
              </h3>
              {vehicleSvcLoading ? (
                <p className="text-xs text-text-muted">Loading...</p>
              ) : vehicleServiceRecords.length === 0 ? (
                <p className="text-xs text-text-muted">{(renter.currentVehicle as any)?._id ? 'No service records for current vehicle' : 'Assign a vehicle to see service history'}</p>
              ) : (
                <div className="divide-y divide-border">
                  {vehicleServiceRecords.map((r: any) => (
                    <div key={r._id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary capitalize">{r.serviceType?.replace('_', ' ')}</p>
                        <p className="text-xs text-text-muted truncate">{r.description}</p>
                        <p className="text-xs text-text-muted">{r.employeeName} · {new Date(r.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      </div>
                      {r.cost ? <p className="text-sm font-semibold text-text-primary flex-shrink-0">${r.cost}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Payments tab ── */}
        {tab === 'payments' && (
          <div className="grid grid-cols-2 gap-4">
            {/* Auto-debit control */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Auto-Debit Control</h3>

              {paywayStatus === 'not_setup' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">Amount per charge ($)</label>
                    <input type="number" placeholder="e.g. 150" value={weeklyAmount} onChange={e => setWeeklyAmount(e.target.value)}
                      className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-2">Charge every</label>
                    <div className="grid grid-cols-2 gap-2">
                      {SCHEDULE_OPTIONS.map(opt => (
                        <button key={opt.days} onClick={() => setSelectedSchedule(opt.days)}
                          className={`text-xs py-2 px-3 rounded-lg border transition-colors text-left ${
                            selectedSchedule === opt.days ? 'bg-accent text-white border-accent' : 'bg-surface2 text-text-secondary border-border hover:border-accent/40'
                          }`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {selectedSchedule === 0 && (
                    <div>
                      <label className="block text-xs text-text-muted mb-1.5">Every how many days?</label>
                      <input type="number" placeholder="e.g. 10" value={customDays} onChange={e => setCustomDays(e.target.value)}
                        className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent" />
                    </div>
                  )}
                  {weeklyAmount && (
                    <div className="bg-accent-bg border border-accent/20 rounded-lg p-3 text-xs text-accent">
                      Will charge <strong>${weeklyAmount}</strong> every <strong>{days} day{days !== 1 ? 's' : ''}</strong>
                    </div>
                  )}
                  <button onClick={() => setConfirm({ show: true, action: 'activate' })}
                    disabled={!weeklyAmount || actionLoading || (selectedSchedule === 0 && !customDays)}
                    className="w-full bg-green text-white text-sm font-medium py-3 rounded-lg disabled:opacity-50">
                    Activate Auto-Debit
                  </button>
                </div>
              )}

              {paywayStatus === 'active' && (
                <div className="space-y-3">
                  {!editingSchedule ? (
                    <>
                      <div className="bg-green-bg border border-green/20 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-green font-semibold mb-1">● Active</p>
                            <p className="text-lg font-bold text-text-primary">${renter.payway?.weeklyAmount}/charge</p>
                            {renter.payway?.nextDebitDate && (
                              <p className="text-xs text-text-muted mt-1">
                                Next: {new Date(renter.payway.nextDebitDate).toLocaleDateString('en-AU')}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setWeeklyAmount(renter.payway?.weeklyAmount?.toString() || '')
                              setEditingSchedule(true)
                            }}
                            className="text-xs text-green font-medium border border-green/30 px-3 py-1.5 rounded-lg hover:bg-green/10"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                      <button onClick={() => setConfirm({ show: true, action: 'pause' })} disabled={actionLoading}
                        className="w-full bg-amber-bg text-amber border border-amber/20 text-sm font-medium py-2.5 rounded-lg disabled:opacity-50">
                        {actionLoading ? 'Processing...' : 'Pause Auto-Debit'}
                      </button>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-text-primary">Update Schedule</p>
                      <div>
                        <label className="block text-xs text-text-muted mb-1.5">New amount per charge ($)</label>
                        <input type="number" value={weeklyAmount} onChange={e => setWeeklyAmount(e.target.value)}
                          className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent" />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-2">Charge every</label>
                        <div className="grid grid-cols-2 gap-2">
                          {SCHEDULE_OPTIONS.map(opt => (
                            <button key={opt.days} onClick={() => setSelectedSchedule(opt.days)}
                              className={`text-xs py-2 px-3 rounded-lg border transition-colors text-left ${
                                selectedSchedule === opt.days ? 'bg-accent text-white border-accent' : 'bg-surface2 text-text-secondary border-border hover:border-accent/40'
                              }`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {selectedSchedule === 0 && (
                        <div>
                          <label className="block text-xs text-text-muted mb-1.5">Every how many days?</label>
                          <input type="number" placeholder="e.g. 10" value={customDays} onChange={e => setCustomDays(e.target.value)}
                            className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent" />
                        </div>
                      )}
                      {weeklyAmount && (
                        <div className="bg-accent-bg border border-accent/20 rounded-lg p-3 text-xs text-accent">
                          Will change to <strong>${weeklyAmount}</strong> every <strong>{days} day{days !== 1 ? 's' : ''}</strong>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirm({ show: true, action: 'update' })}
                          disabled={!weeklyAmount || actionLoading || (selectedSchedule === 0 && !customDays)}
                          className="flex-1 bg-accent text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
                        >
                          Update Schedule
                        </button>
                        <button onClick={() => setEditingSchedule(false)}
                          className="px-4 py-2.5 text-sm text-text-secondary border border-border rounded-lg hover:bg-surface2">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {paywayStatus === 'paused' && (
                <div className="space-y-3">
                  <div className="bg-amber-bg border border-amber/20 rounded-lg p-3">
                    <p className="text-xs text-amber font-semibold mb-1">⏸️ Paused</p>
                    {renter.payway?.weeklyAmount && <p className="text-sm text-text-primary">Resumes at ${renter.payway.weeklyAmount}/charge</p>}
                  </div>
                  <button onClick={() => setConfirm({ show: true, action: 'resume' })} disabled={actionLoading}
                    className="w-full bg-green text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50">
                    {actionLoading ? 'Processing...' : 'Resume Auto-Debit'}
                  </button>
                </div>
              )}
            </div>

            {/* History */}
            <div className="space-y-4">
              <div className="bg-surface border border-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Payment History</h3>
                {paymentsLoading ? (
                  <p className="text-sm text-text-muted text-center py-4">Loading...</p>
                ) : payments.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-4">No payments yet</p>
                ) : (
                  <div>
                    <div className="flex justify-between text-xs text-text-muted mb-2">
                      <span>{payments.length} payments</span>
                      <span className="font-medium text-text-primary">Total: ${payments.reduce((s, p) => s + (p.amount || 0), 0).toFixed(2)}</span>
                    </div>
                    {payments.map((p, i) => {
                      const ok = p.status === 'approved' || p.status === '0'
                      return (
                        <div key={i} className="flex justify-between py-1.5 border-b border-border last:border-0 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ok ? 'bg-green-bg text-green' : 'bg-red-bg text-red'}`}>{ok ? '✓' : '✗'}</span>
                            <span className="text-text-muted text-xs">{p.date ? new Date(p.date).toLocaleDateString('en-AU') : '—'}</span>
                          </div>
                          <span className={`font-semibold ${ok ? 'text-text-primary' : 'text-red'}`}>${Number(p.amount || 0).toFixed(2)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Service History */}
              {(renter.currentVehicle as any)?.plate && (
                <div className="bg-surface border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                      Service History — <span className="text-accent font-mono">{(renter.currentVehicle as any).plate}</span>
                    </h3>
                    <button onClick={() => setShowAddService(!showAddService)} className="text-xs text-accent hover:underline">+ Add</button>
                  </div>

                  {showAddService && (
                    <div className="bg-surface2 border border-border rounded-lg p-3 mb-3 space-y-2">
                      <select value={serviceForm.serviceType} onChange={e => setServiceForm(f => ({ ...f, serviceType: e.target.value }))}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary">
                        <option value="oil_change">Oil Change</option>
                        <option value="tyres">Tyres</option>
                        <option value="brakes">Brakes</option>
                        <option value="general">General</option>
                        <option value="other">Other</option>
                      </select>
                      <input placeholder="Description *" value={serviceForm.description} onChange={e => setServiceForm(f => ({ ...f, description: e.target.value }))}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted" />
                      <input placeholder="Cost ($)" type="number" value={serviceForm.cost} onChange={e => setServiceForm(f => ({ ...f, cost: e.target.value }))}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted" />
                      <input placeholder="Notes (optional)" value={serviceForm.notes} onChange={e => setServiceForm(f => ({ ...f, notes: e.target.value }))}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted" />
                      <div className="flex gap-2">
                        <button onClick={handleAddService} className="flex-1 py-2 bg-accent text-white rounded-lg text-xs font-medium">Save</button>
                        <button onClick={() => setShowAddService(false)} className="flex-1 py-2 bg-surface border border-border rounded-lg text-xs text-text-muted">Cancel</button>
                      </div>
                    </div>
                  )}

                  {serviceLoading ? (
                    <p className="text-sm text-text-muted text-center py-3">Loading...</p>
                  ) : serviceRecords.length === 0 ? (
                    <p className="text-sm text-text-muted text-center py-3">No service records yet</p>
                  ) : (
                    <div className="space-y-2">
                      {serviceRecords.map((s, i) => (
                        <div key={i} className="border border-border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-text-primary capitalize">{s.serviceType.replace('_', ' ')}</span>
                            <div className="flex items-center gap-2">
                              {s.cost && <span className="text-xs font-semibold text-green">${s.cost}</span>}
                              <span className="text-xs text-text-muted">{new Date(s.date).toLocaleDateString('en-AU')}</span>
                            </div>
                          </div>
                          <p className="text-xs text-text-secondary">{s.description}</p>
                          {s.notes && <p className="text-xs text-text-muted mt-1">{s.notes}</p>}
                          {s.employeeName && <p className="text-xs text-text-muted mt-1">By: {s.employeeName}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(renter.rentalHistory?.length ?? 0) > 0 && (
                <div className="bg-surface border border-border rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Rental History</h3>
                  {(renter.rentalHistory ?? []).map((r, i) => (
                    <div key={i} className="flex justify-between py-1.5 border-b border-border last:border-0 text-sm">
                      <div>
                        <span className="font-mono font-semibold text-accent">{r.plate}</span>
                        <span className="text-text-muted text-xs ml-2">
                          {new Date(r.startDate).toLocaleDateString('en-AU')} → {r.endDate ? new Date(r.endDate).toLocaleDateString('en-AU') : 'Present'}
                        </span>
                      </div>
                      {r.totalAmount && <span className="text-text-secondary">${r.totalAmount}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────
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
  const [verifyData, setVerifyData] = useState<Record<string, any>>({})
  const [verifyLoading, setVerifyLoading] = useState<Record<string, boolean>>({})
  const [pendingModal, setPendingModal] = useState<Renter | null>(null)
  const [modalForm, setModalForm] = useState<Record<string, any>>({})
  const [modalSaving, setModalSaving] = useState(false)
  const [aiVerifyResults, setAiVerifyResults] = useState<any>(null)
  const [aiVerifyLoading, setAiVerifyLoading] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  function openPendingModal(renter: Renter) {
    setPendingModal(renter)
    setModalForm({
      name: renter.name || '',
      email: renter.email || '',
      dateOfBirth: renter.dateOfBirth || '',
      licenceNumber: renter.licenceNumber || '',
      passportNumber: (renter as any).passportNumber || '',
      emergencyContactName: renter.emergencyContactName || '',
      emergencyContactPhone: renter.emergencyContactPhone || '',
      addressStreet: renter.address?.street || '',
      addressCity: renter.address?.city || '',
      addressState: renter.address?.state || 'NSW',
      addressPostcode: renter.address?.postcode || '',
      bankName: renter.bankName || '',
      accountHolderName: renter.accountHolderName || '',
      bsbNumber: renter.bsbNumber || '',
      accountNumber: renter.accountNumber || '',
    })
    setAiVerifyResults(null)
  }

  async function loadVerification(phone: string) {
    setVerifyLoading(p => ({ ...p, [phone]: true }))
    try {
      const { data } = await axios.get(`/api/renters/${encodeURIComponent(phone)}/verify`)
      setVerifyData(p => ({ ...p, [phone]: data }))
    } catch {
      setVerifyData(p => ({ ...p, [phone]: { error: true } }))
    } finally {
      setVerifyLoading(p => ({ ...p, [phone]: false }))
    }
  }

  useEffect(() => { fetchRenters() }, [fetchRenters])

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(t)
    }
  }, [toast])

  // Keep selected in sync after refresh
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

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} className="max-w-full max-h-full rounded-xl object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl">✕</button>
        </div>
      )}

      {/* Pending renter modal */}
      {pendingModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[9999]" onClick={() => setPendingModal(null)} />
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-surface border border-border rounded-2xl w-full max-w-3xl my-auto shadow-2xl">

              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-amber-bg flex items-center justify-center shrink-0">
                    <span className="text-amber font-semibold text-sm">{pendingModal.name?.charAt(0)}</span>
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-text-primary">{pendingModal.name}</h2>
                    <p className="text-xs text-text-muted">{pendingModal.phone} · {pendingModal.email}</p>
                  </div>
                  <span className="text-[10px] bg-amber-bg text-amber px-2 py-0.5 rounded-full font-medium">Pending</span>
                </div>
                <div className="flex items-center gap-2">
                  <button disabled={modalSaving}
                    onClick={async () => {
                      setModalSaving(true)
                      try {
                        await axios.put(`/api/renters/${encodeURIComponent(pendingModal.phone)}`, {
                          name: modalForm.name, email: modalForm.email,
                          dateOfBirth: modalForm.dateOfBirth, licenceNumber: modalForm.licenceNumber,
                          passportNumber: modalForm.passportNumber,
                          emergencyContactName: modalForm.emergencyContactName,
                          emergencyContactPhone: modalForm.emergencyContactPhone,
                          bankName: modalForm.bankName,
                          accountHolderName: modalForm.accountHolderName,
                          bsbNumber: modalForm.bsbNumber,
                          accountNumber: modalForm.accountNumber,
                          address: { street: modalForm.addressStreet, city: modalForm.addressCity, state: modalForm.addressState, postcode: modalForm.addressPostcode },
                        })
                        setToast({ message: '✅ Details saved', type: 'success' })
                        fetchRenters()
                      } catch { setToast({ message: '❌ Failed to save', type: 'warning' }) }
                      finally { setModalSaving(false) }
                    }}
                    className="px-3 py-1.5 text-xs border border-border rounded-lg text-text-secondary hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
                  >{modalSaving ? 'Saving...' : 'Save changes'}</button>
                  <button onClick={() => setPendingModal(null)}
                    className="w-7 h-7 rounded-full bg-surface2 flex items-center justify-center text-text-muted hover:text-text-primary text-sm">✕</button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="p-6 grid grid-cols-2 gap-6 max-h-[70vh] overflow-y-auto">

                {/* Left — editable fields */}
                <div className="space-y-2.5">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Personal details</p>
                  {[
                    { label: 'Full name', key: 'name' },
                    { label: 'Date of birth', key: 'dateOfBirth', type: 'date' },
                    { label: 'Email', key: 'email', type: 'email' },
                    { label: 'Licence number', key: 'licenceNumber' },
                    { label: 'Passport number (optional)', key: 'passportNumber' },
                    { label: 'Emergency contact', key: 'emergencyContactName' },
                    { label: 'Emergency phone', key: 'emergencyContactPhone' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-text-muted mb-1">{f.label}</label>
                      <input type={f.type || 'text'} value={modalForm[f.key] || ''}
                        onChange={e => setModalForm((p: any) => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
                    </div>
                  ))}
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide pt-1 mb-1">Bank details</p>
                  {[
                    { label: 'Bank name', key: 'bankName' },
                    { label: 'Account holder name', key: 'accountHolderName' },
                    { label: 'BSB (e.g. 062-000)', key: 'bsbNumber' },
                    { label: 'Account number', key: 'accountNumber' },
                  ].map(bk => (
                    <div key={bk.key}>
                      <label className="block text-xs text-text-muted mb-1">{bk.label}</label>
                      <input value={modalForm[bk.key] || ''}
                        onChange={e => setModalForm((p: any) => ({ ...p, [bk.key]: e.target.value }))}
                        className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
                    </div>
                  ))}
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide pt-1 mb-1">Address</p>
                  {[
                    { label: 'Street', key: 'addressStreet' },
                    { label: 'City', key: 'addressCity' },
                    { label: 'Postcode', key: 'addressPostcode' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-text-muted mb-1">{f.label}</label>
                      <input value={modalForm[f.key] || ''}
                        onChange={e => setModalForm((p: any) => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs text-text-muted mb-1">State</label>
                    <select value={modalForm.addressState || 'NSW'} onChange={e => setModalForm((p: any) => ({ ...p, addressState: e.target.value }))}
                      className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent">
                      {['NSW','VIC','QLD','WA','SA','TAS','ACT','NT'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                {/* Right — photos + verification */}
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                      Identity photos <span className="normal-case font-normal text-text-tertiary">(tap to enlarge)</span>
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {(() => {
                        const toUrl = (u?: string) => !u ? null : u.startsWith('http') ? u : `${import.meta.env.VITE_API_URL}${u}`
                        return [
                          { label: 'Licence', url: toUrl(pendingModal.licencePhotoUrl) },
                          { label: 'Selfie', url: toUrl((pendingModal as any).selfieUrl) },
                          { label: 'Passport', url: toUrl((pendingModal as any).passportPhotoUrl) },
                        ]
                      })().map(ph => (
                        <div key={ph.label}>
                          <p className="text-xs text-text-muted mb-1">{ph.label}</p>
                          {ph.url ? (
                            <img src={ph.url} alt={ph.label} onClick={() => setLightbox(ph.url!)}
                              className="w-full h-20 object-cover rounded-lg border border-border cursor-pointer hover:opacity-80 transition-opacity" />
                          ) : (
                            <div className="w-full h-20 rounded-lg border border-border bg-surface2 flex items-center justify-center">
                              <span className="text-xs text-text-muted">Not uploaded</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Manual format checks */}
                  {verifyData[pendingModal.phone] && !verifyData[pendingModal.phone].error && (
                    <div>
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Format checks</p>
                      <div className="bg-surface2 rounded-xl px-3 py-1">
                        {verifyData[pendingModal.phone].checks?.map((c: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-border last:border-0">
                            <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${c.status === 'pass' ? 'bg-green-bg text-green' : c.status === 'fail' ? 'bg-red-bg text-red' : 'bg-amber-bg text-amber'}`}>
                              {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '!'}
                            </span>
                            <span className="text-text-secondary flex-1">{c.label}</span>
                            <span className="text-text-muted text-right text-[11px]">{c.detail}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI verification results */}
                  {aiVerifyResults && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">AI document check</p>
                        <span className="text-xs bg-accent-bg text-accent px-2 py-0.5 rounded-full">Gemini</span>
                      </div>
                      <div className="bg-surface2 rounded-xl px-3 py-1">
                        {[
                          { key: 'name', label: 'Full name' },
                          { key: 'dob', label: 'Date of birth' },
                          { key: 'address', label: 'Address' },
                          { key: 'licenceNumber', label: 'Licence number' },
                          { key: 'passportNumber', label: 'Passport number' },
                        ].map(f => {
                          const r = aiVerifyResults[f.key]
                          if (!r) return null
                          return (
                            <div key={f.key} className="flex items-center gap-2 text-xs py-1.5 border-b border-border last:border-0">
                              <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${r.status === 'pass' ? 'bg-green-bg text-green' : r.status === 'fail' ? 'bg-red-bg text-red' : 'bg-amber-bg text-amber'}`}>
                                {r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '!'}
                              </span>
                              <span className="text-text-secondary flex-1">{f.label}</span>
                              <span className="text-text-muted text-right text-[11px]">{r.detail}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {aiVerifyLoading && (
                    <div className="text-xs text-text-muted text-center py-3">Running AI document check...</div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-border flex items-center justify-between">
                <button
                  disabled={aiVerifyLoading}
                  onClick={async () => {
                    if (!verifyData[pendingModal.phone]) await loadVerification(pendingModal.phone)
                    setAiVerifyLoading(true)
                    setAiVerifyResults(null)
                    try {
                      const { data } = await axios.post(`/api/renters/${encodeURIComponent(pendingModal.phone)}/ai-verify`)
                      setAiVerifyResults(data.results)
                    } catch (err: any) {
                      setToast({ message: '❌ AI check failed: ' + (err.response?.data?.error || 'error'), type: 'warning' })
                    } finally { setAiVerifyLoading(false) }
                  }}
                  className="px-4 py-2.5 border border-border rounded-xl text-sm text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-40 transition-colors"
                >
                  {aiVerifyLoading ? 'Running checks...' : 'Run verification checks'}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Reject ${pendingModal.name}?`)) return
                      await axios.delete(`/api/renters/${encodeURIComponent(pendingModal.phone)}/reject`)
                      setToast({ message: `${pendingModal.name} rejected`, type: 'warning' })
                      setPendingModal(null); fetchRenters()
                    }}
                    className="px-4 py-2.5 bg-red-bg text-red text-sm font-medium rounded-xl border border-red/20"
                  >✕ Reject</button>
                  <button
                    onClick={async () => {
                      await axios.post(`/api/renters/${encodeURIComponent(pendingModal.phone)}/approve`)
                      setToast({ message: `✅ ${pendingModal.name} approved!`, type: 'success' })
                      setPendingModal(null); fetchRenters()
                    }}
                    className="px-4 py-2.5 bg-green text-white text-sm font-medium rounded-xl"
                  >✓ Approve</button>
                </div>
              </div>
            </div>
          </div>
        </>
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
                  onClick={() => openPendingModal(renter)}
                  className="bg-surface2 border border-border rounded-xl p-4 cursor-pointer hover:border-accent transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-semibold text-text-primary text-sm">{renter.name}</p>
                      <p className="text-text-muted text-xs">{renter.phone}</p>
                    </div>
                    <span className="text-[10px] bg-amber-bg text-amber px-2 py-0.5 rounded-full font-medium">Pending</span>
                  </div>
                  <div className="flex gap-2 mb-2">
                    {renter.licencePhotoUrl && (
                      <img src={`${import.meta.env.VITE_API_URL}${renter.licencePhotoUrl}`} alt="Licence"
                        className="w-14 h-10 object-cover rounded-md border border-border" />
                    )}
                    {(renter as any).selfieUrl && (
                      <img src={`${import.meta.env.VITE_API_URL}${(renter as any).selfieUrl}`} alt="Selfie"
                        className="w-14 h-10 object-cover rounded-md border border-border" />
                    )}
                  </div>
                  <p className="text-xs text-accent">Click to review →</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Left panel — list ── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border bg-surface overflow-hidden">
        {/* Header */}
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

        {/* List */}
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

      {/* ── Right panel — detail ── */}
      {selected ? (
        <RenterDetail
          key={selected._id}
          renter={selected}
          onToast={(msg, type) => setToast({ message: msg, type })}
          onRefresh={fetchRenters}
        />
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
