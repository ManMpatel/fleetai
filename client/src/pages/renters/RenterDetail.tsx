import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Renter } from '../../types'
import axios from 'axios'
import RenterDetailPayments from './RenterDetailPayments'
import RenterDetailVehicle from './RenterDetailVehicle'

function ConfirmModal({ title, message, confirmLabel, confirmColor, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string
  confirmColor: string; onConfirm: () => void; onCancel: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center px-4">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-base font-bold text-text-primary mb-2">{title}</h3>
        <p className="text-sm text-text-secondary mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} className={`flex-1 text-white text-sm font-medium py-2.5 rounded-lg ${confirmColor}`}>{confirmLabel}</button>
          <button onClick={onCancel} className="flex-1 bg-surface2 text-text-secondary text-sm font-medium py-2.5 rounded-lg border border-border">Cancel</button>
        </div>
      </div>
    </div>,
    document.body
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

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-border last:border-0 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-right text-text-primary">{value || '—'}</span>
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

export default function RenterDetail({ renter, onToast, onRefresh }: {
  renter: Renter
  onToast: (msg: string, type: 'success' | 'warning') => void
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'details' | 'payments' | 'vehicle'>('details')

  // Separate edit states for each card
  const [editing, setEditing] = useState(false)
  const [editingAddress, setEditingAddress] = useState(false)
  const [editingBank, setEditingBank] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [showAddressHistory, setShowAddressHistory] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  // Payments state
  const [payments, setPayments] = useState<any[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [weeklyAmount, setWeeklyAmount] = useState(renter.payway?.weeklyAmount?.toString() || '')
  const [editingSchedule, setEditingSchedule] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [linkCustomerId, setLinkCustomerId] = useState('')
  const [showChargeExtra, setShowChargeExtra] = useState(false)
  const [extraAmount, setExtraAmount] = useState('')
  const [extraNote, setExtraNote] = useState('')
  const [showUpdateBank, setShowUpdateBank] = useState(false)
  const [newBsb, setNewBsb] = useState('')
  const [newAccount, setNewAccount] = useState('')
  const [newHolder, setNewHolder] = useState('')
  const [confirm, setConfirm] = useState<{ show: boolean; action: string | null }>({ show: false, action: null })

  // Vehicle state
  const [fleetVehicles, setFleetVehicles] = useState<any[]>([])
  const [fleetLoading, setFleetLoading] = useState(false)
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [vehicleServiceRecords, setVehicleServiceRecords] = useState<any[]>([])
  const [vehicleSvcLoading, setVehicleSvcLoading] = useState(false)

  // Forms
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

  // Reset on renter change
  useEffect(() => {
    setTab('details'); setEditing(false); setEditingAddress(false); setEditingBank(false)
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

  // Load tab data
  useEffect(() => {
    if (tab === 'vehicle') {
      setFleetLoading(true)
      axios.get('/api/fleet').then(r => setFleetVehicles(r.data || [])).finally(() => setFleetLoading(false))
      const plate = (renter.currentVehicle as any)?.plate
      if (plate) {
        setVehicleSvcLoading(true)
        axios.get(`/api/service-records?plate=${plate}`).then(r => setVehicleServiceRecords(r.data || [])).finally(() => setVehicleSvcLoading(false))
      }
    }
    if (tab === 'payments' && renter.payway?.customerId && renter.payway.status !== 'not_setup') {
      setPaymentsLoading(true)
      axios.get(`/api/renters/${encodeURIComponent(renter.phone)}/payments`)
        .then(res => setPayments(res.data.payments || [])).catch(() => setPayments([])).finally(() => setPaymentsLoading(false))
    }
  }, [tab])

  // Save functions — each saves ONLY its own fields
  async function savePersonal() {
    setSaving(true)
    try {
      await axios.put(`/api/renters/${encodeURIComponent(renter.phone)}`, { ...personalForm })
      onToast('✅ Details updated', 'success'); setEditing(false); await onRefresh()
    } catch { onToast('❌ Failed to save', 'warning') }
    finally { setSaving(false) }
  }

  async function saveAddress() {
    setSaving(true)
    try {
      await axios.put(`/api/renters/${encodeURIComponent(renter.phone)}`, {
        address: { street: addressForm.street, city: addressForm.city, state: addressForm.state, postcode: addressForm.postcode }
      })
      onToast('✅ Address updated', 'success'); setEditingAddress(false); await onRefresh()
    } catch { onToast('❌ Failed to save', 'warning') }
    finally { setSaving(false) }
  }

  async function saveBank() {
    setSaving(true)
    try {
      await axios.put(`/api/renters/${encodeURIComponent(renter.phone)}`, bankForm)
      onToast('✅ Bank details updated', 'success'); setEditingBank(false); await onRefresh()
    } catch { onToast('❌ Failed to save', 'warning') }
    finally { setSaving(false) }
  }

  // PayWay handlers
  async function handleActivate() {
    setActionLoading(true)
    try {
      await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/activate`, { weeklyAmount: parseFloat(weeklyAmount), intervalDays: 7 })
      onToast(`✅ Auto-debit activated — $${weeklyAmount}/week`, 'success'); onRefresh()
    } catch { onToast('❌ Failed to activate', 'warning') }
    finally { setActionLoading(false); setConfirm({ show: false, action: null }) }
  }
  async function handlePause() {
    setActionLoading(true)
    try { await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/pause`); onToast('⏸️ Auto-debit paused', 'warning'); onRefresh() }
    catch { onToast('❌ Failed to pause', 'warning') }
    finally { setActionLoading(false); setConfirm({ show: false, action: null }) }
  }
  async function handleResume() {
    setActionLoading(true)
    try { await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/resume`); onToast('▶️ Auto-debit resumed', 'success'); onRefresh() }
    catch { onToast('❌ Failed to resume', 'warning') }
    finally { setActionLoading(false); setConfirm({ show: false, action: null }) }
  }
  async function handleUpdate() {
    setActionLoading(true)
    try {
      await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/activate`, { weeklyAmount: parseFloat(weeklyAmount), intervalDays: 7 })
      onToast(`✅ Schedule updated — $${weeklyAmount}/week`, 'success'); setEditingSchedule(false); onRefresh()
    } catch { onToast('❌ Failed to update', 'warning') }
    finally { setActionLoading(false); setConfirm({ show: false, action: null }) }
  }
  async function handleLink() {
    setActionLoading(true)
    try {
      await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/link-payway`, { paywayCustomerId: linkCustomerId, weeklyAmount: parseFloat(weeklyAmount) })
      onToast(`✅ PayWay customer linked`, 'success'); onRefresh()
    } catch { onToast('❌ Failed to link', 'warning') }
    finally { setActionLoading(false) }
  }
  async function handleChargeExtra() {
    setActionLoading(true)
    try {
      const res = await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/charge-extra`, { extraAmount: parseFloat(extraAmount), note: extraNote })
      onToast(`✅ Next debit will be $${res.data.nextAmount}`, 'success')
      setShowChargeExtra(false); setExtraAmount(''); setExtraNote('')
    } catch { onToast('❌ Failed to schedule extra charge', 'warning') }
    finally { setActionLoading(false) }
  }
  async function handleUpdateBank() {
    setActionLoading(true)
    try {
      await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/update-bank`, { bsbNumber: newBsb, accountNumber: newAccount, accountHolderName: newHolder })
      onToast('✅ Bank account updated', 'success'); setShowUpdateBank(false); setNewBsb(''); setNewAccount(''); setNewHolder(''); onRefresh()
    } catch { onToast('❌ Failed to update bank', 'warning') }
    finally { setActionLoading(false) }
  }

  const paywayStatus = (renter.payway?.status || 'not_setup') as 'active' | 'paused' | 'cancelled' | 'not_setup'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {lightbox && (
        <div className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} className="max-w-full max-h-full rounded-xl object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl">✕</button>
        </div>
      )}

      {confirm.show && (
        <ConfirmModal
          title={confirm.action === 'activate' ? 'Activate auto-debit?' : confirm.action === 'pause' ? 'Pause auto-debit?' : confirm.action === 'update' ? 'Update schedule?' : 'Resume auto-debit?'}
          message={confirm.action === 'activate' ? `Charge ${renter.name} $${weeklyAmount} every week?` : confirm.action === 'pause' ? `Stop payments from ${renter.name}?` : confirm.action === 'update' ? `Change to $${weeklyAmount}/week?` : `Restart payments for ${renter.name}?`}
          confirmLabel={confirm.action === 'activate' ? 'Yes, Activate' : confirm.action === 'pause' ? 'Yes, Pause' : confirm.action === 'update' ? 'Yes, Update' : 'Yes, Resume'}
          confirmColor={confirm.action === 'pause' ? 'bg-amber hover:bg-amber/90' : 'bg-green hover:bg-green/90'}
          onConfirm={confirm.action === 'activate' ? handleActivate : confirm.action === 'pause' ? handlePause : confirm.action === 'update' ? handleUpdate : handleResume}
          onCancel={() => setConfirm({ show: false, action: null })}
        />
      )}

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
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}>
            {t === 'details' ? 'Personal Details' : t === 'payments' ? 'Auto-Debit & Payments' : 'Vehicle & History'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ── Details tab ── */}
        {tab === 'details' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">

              {/* PERSONAL card */}
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
                    {(renter as any).docRef && <InfoRow label="Doc Ref" value={(renter as any).docRef} />}
                    <InfoRow label="Vehicle" value={renter.vehicleType} />
                    <InfoRow label="Emergency" value={renter.emergencyContactName} />
                    <InfoRow label="Emg. Phone" value={renter.emergencyContactPhone} />
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {/* ADDRESS card */}
                <div className="bg-surface border border-border rounded-xl p-4">
                  <div className="flex justify-between mb-3">
                    <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Address</h3>
                    <div className="flex items-center gap-2">
                      {((renter as any).changeHistory?.length > 0) && (
                        <button onClick={() => setShowAddressHistory(true)}
                          className="text-xs font-semibold text-text-muted border border-border rounded px-1.5 py-0.5 hover:text-accent hover:border-accent transition-colors">
                          H
                        </button>
                      )}
                      {!editingAddress && (
                        <button onClick={() => setEditingAddress(true)} className="text-xs text-accent font-medium">Edit</button>
                      )}
                    </div>
                  </div>

                  {/* Address History Modal */}
                  {showAddressHistory && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddressHistory(false)}>
                      <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-bold text-text-primary">Address Change History</h3>
                          <button onClick={() => setShowAddressHistory(false)} className="text-text-muted hover:text-text-primary text-lg leading-none">✕</button>
                        </div>
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {[...(renter as any).changeHistory].reverse().map((h: any, i: number) => (
                            <div key={i} className="text-xs border-b border-border pb-2 last:border-0">
                              <div className="flex justify-between mb-0.5">
                                <span className="font-semibold text-text-primary">{h.field}</span>
                                <span className="text-text-muted">{new Date(h.changedAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <span className="text-text-muted">{h.oldValue}</span>
                              <span className="text-text-muted mx-1">→</span>
                              <span className="text-text-primary">{h.newValue}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {editingAddress ? (
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
                      <div className="flex gap-2 pt-1">
                        <button onClick={saveAddress} disabled={saving} className="flex-1 bg-accent text-white text-xs font-medium py-2 rounded-lg disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                        <button onClick={() => setEditingAddress(false)} className="flex-1 bg-surface2 text-text-secondary text-xs py-2 rounded-lg border border-border">Cancel</button>
                      </div>
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

                {/* BANK card */}
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
          </div>
        )}

        {tab === 'payments' && (
          <RenterDetailPayments
            renter={renter} paywayStatus={paywayStatus}
            payments={payments} paymentsLoading={paymentsLoading}
            weeklyAmount={weeklyAmount} setWeeklyAmount={setWeeklyAmount}
            editingSchedule={editingSchedule} setEditingSchedule={setEditingSchedule}
            linkMode={linkMode} setLinkMode={setLinkMode}
            linkCustomerId={linkCustomerId} setLinkCustomerId={setLinkCustomerId}
            showChargeExtra={showChargeExtra} setShowChargeExtra={setShowChargeExtra}
            extraAmount={extraAmount} setExtraAmount={setExtraAmount}
            extraNote={extraNote} setExtraNote={setExtraNote}
            showUpdateBank={showUpdateBank} setShowUpdateBank={setShowUpdateBank}
            newBsb={newBsb} setNewBsb={setNewBsb}
            newAccount={newAccount} setNewAccount={setNewAccount}
            newHolder={newHolder} setNewHolder={setNewHolder}
            actionLoading={actionLoading} confirm={confirm} setConfirm={setConfirm}
            handleActivate={handleActivate} handlePause={handlePause}
            handleResume={handleResume} handleUpdate={handleUpdate}
            handleLink={handleLink} handleChargeExtra={handleChargeExtra}
            handleUpdateBank={handleUpdateBank}
            onToast={onToast} onRefresh={onRefresh}
          />
        )}

        {tab === 'vehicle' && (
          <RenterDetailVehicle
            renter={renter} fleetVehicles={fleetVehicles} fleetLoading={fleetLoading}
            vehicleSearch={vehicleSearch} setVehicleSearch={setVehicleSearch}
            selectedVehicleId={selectedVehicleId} setSelectedVehicleId={setSelectedVehicleId}
            assignLoading={assignLoading} setAssignLoading={setAssignLoading}
            vehicleServiceRecords={vehicleServiceRecords} vehicleSvcLoading={vehicleSvcLoading}
            setFleetVehicles={setFleetVehicles}
            onToast={onToast} onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  )
}