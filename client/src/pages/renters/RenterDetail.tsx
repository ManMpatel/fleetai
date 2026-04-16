import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Renter } from '../../types'
import axios from 'axios'
import RenterDetailPayments from './RenterDetailPayments'
import RenterDetailVehicle from './RenterDetailVehicle'
import { jsPDF } from 'jspdf'

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

function generateDDR(renter: any) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, L = 20, R = 190, lineH = 7
  let y = 0

  const newPage = () => { doc.addPage(); y = 20 }
  const hline = () => { doc.setDrawColor(150); doc.line(L, y, R, y); y += 3 }
  const txt = (t: string, x = L, size = 10, style: 'normal'|'bold'|'italic' = 'normal') => {
    doc.setFontSize(size); doc.setFont('helvetica', style); doc.text(t, x, y); y += lineH
  }
  const field = (label: string, value: string) => {
    doc.setFontSize(10); doc.setFont('helvetica', 'normal')
    doc.text(label, L, y)
    doc.setDrawColor(150); doc.rect(65, y - 5, R - 65, 7)
    if (value) doc.text(value, 67, y)
    y += lineH
  }
  const para = (t: string, size = 9) => {
    doc.setFontSize(size); doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(t, R - L)
    doc.text(lines, L, y); y += lines.length * 5 + 2
  }
  const section = (title: string) => {
    y += 2; doc.setFillColor(240, 240, 240)
    doc.rect(L, y - 4, R - L, 8, 'F')
    doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text(title, L + 2, y + 1); y += 8
  }

  // ── PAGE 1 ──
  y = 25
  doc.setFontSize(14); doc.setFont('helvetica', 'bold')
  doc.text('Direct Debit Request (DDR)', W / 2, y, { align: 'center' }); y += 10
  para('You may contact us as follows:'); y -= 3
  txt('Mail:    Sydney, NSW', L + 10)
  para('All communication addressed to us should include your Customer Number.'); y += 4

  txt('PART A - Your Details', L, 12, 'bold'); hline(); y += 2
  field('Customer Name:', renter.name || '')
  field('Phone Number:', renter.phone || '')
  field('Email Address:', renter.email || '')
  field('Address:', renter.address?.street || '')
  field('', renter.address?.city || '')
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text('State:', L, y); doc.rect(65, y - 5, 35, 7); doc.text(renter.address?.state || '', 67, y)
  doc.text('Postcode:', 108, y); doc.rect(128, y - 5, 27, 7); doc.text(renter.address?.postcode || '', 130, y)
  y += lineH + 6

  txt('PART B - Schedule', L, 12, 'bold'); hline(); y += 2
  para('Payments will be debited on the due date.'); y += 6

  txt('PART C - Payment Amounts', L, 12, 'bold'); hline(); y += 2
  para('Payments amount will be debited in full.')

  // ── PAGE 2 ──
  newPage()
  txt('PART D - Cheque/Savings Account Authorisation', L, 12, 'bold'); hline(); y += 2
  para(`[ ] I/We request and authorise to arrange, through its own financial institution, a debit to your nominated account any amount deemed payable by you. This debit or charge will be made through the Bulk Electronic Clearing System (BECS) from your account held at the financial institution you have nominated below and will be subject to the terms and conditions of the Direct Debit Request Service Agreement.`)
  y += 4
  field('Financial Institution:', renter.bankName || '')
  field('Account Name:', renter.accountHolderName || '')
  field('BSB No.:', renter.bsbNumber || '')
  field('Account Number:', renter.accountNumber || '')
  y += 4
  para(`I/We request and authorise Acknowledgement. By signing and/or providing us with a valid instruction in respect to your Direct Debit Request, you have understood and agreed to the terms and conditions governing the debit arrangements as set out in this Request and in your Direct Debit Request Service Agreement.`)
  y += 4

  // First signature box
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text('Signature:', L, y)
  doc.rect(65, y - 5, 60, 14)
  const sig = (renter as any).signatureBase64
  if (sig) {
    try {
      const sigData = sig.startsWith('data:')
        ? sig
        : `data:image/png;base64,${sig}`
      doc.addImage(sigData, 'PNG', 66, y - 4, 58, 12)
    } catch {}
  }
  doc.text('Date:', 135, y)
  doc.rect(145, y - 5, 45, 7)
  const approvalDate = (renter as any).updatedAt
    ? new Date((renter as any).updatedAt).toLocaleDateString('en-AU')
    : new Date().toLocaleDateString('en-AU')
  doc.text(approvalDate, 147, y)
  y += 20

  // Second signature box
  doc.text('Signature:', L, y)
  doc.rect(65, y - 5, 60, 14)
  doc.text('Date:', 135, y)
  doc.rect(145, y - 5, 45, 7)
  y += 20

  para('If debiting from a joint bank account, both signatures are required.')
  y += 6

  // Credit card section
  para('[ ] I request to arrange for funds to be debited from my nominated credit card according to the schedule specified above and attached Direct Debit Service Agreement.')
  y += 5

  // Credit card number - individual boxes grouped by 4
  doc.text('Credit Card Number:', L, y)
  let cx = 65
  for (let i = 0; i < 16; i++) {
    doc.rect(cx, y - 5, 7, 7)
    cx += 7
    if ((i + 1) % 4 === 0 && i !== 15) cx += 4
  }
  y += lineH + 3

  doc.text('Expiry Date:', L, y)
  doc.rect(65, y - 5, 8, 7); doc.text('M', 66.5, y)
  doc.rect(73, y - 5, 8, 7); doc.text('M', 74.5, y)
  doc.text('/', 83, y)
  doc.rect(87, y - 5, 8, 7); doc.text('Y', 88.5, y)
  doc.rect(95, y - 5, 8, 7); doc.text('Y', 96.5, y)
  y += lineH + 3

  field('Cardholder Name:', '')
  y += 4

  doc.text('Signature:', L, y)
  doc.rect(65, y - 5, 60, 14)
  doc.text('Date:', 135, y)
  doc.rect(145, y - 5, 45, 7)
  y += 22

  txt('Completed Application', L, 11, 'bold'); hline(); y += 2
  para('Return your completed application by mail to:')
  para('    Mail: Sydney, NSW')

  // ── PAGE 3 ──
  newPage()
  txt('Customer Direct Debit Request (DDR) Service Agreement', L, 13, 'bold'); y += 4
  para(`This is your Direct Debit Service Agreement (the Debit User). It explains what your obligations are when undertaking a Direct Debit arrangement with us. It also details what our obligations are to you as your Direct Debit provider.`)
  para('Please keep this agreement for future reference. It forms part of the terms and conditions of your Direct Debit Request (DDR) and should be read in conjunction with your DDR authorisation.'); y += 4

  section('Definitions'); y += 2
  const defs = [
    ['account', 'means the account held at your financial institution from which we are authorised to arrange for funds to be debited.'],
    ['agreement', 'means this Direct Debit Request Service Agreement between you and us.'],
    ['banking day', 'means a day other than a Saturday or a Sunday or a public holiday listed throughout Australia.'],
    ['debit day', 'means the day that payment by you to us is due.'],
    ['debit payment', 'means a particular transaction where a debit is made.'],
    ['Direct Debit Request', 'means the written, verbal or online request between us and you to debit funds from your account.'],
    ['us or we', 'means the Debit User you have authorised by requesting a Direct Debit Request.'],
    ['you', 'means the customer who has authorised the Direct Debit Request.'],
    ['your financial institution', 'means the financial institution at which you hold the account you have authorised us to debit.'],
  ]
  defs.forEach(([term, def]) => {
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text(term, L, y)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(def, R - L - 35)
    doc.text(lines, L + 35, y); y += Math.max(lineH, lines.length * 4)
  })
  y += 4
  section('Debiting your account'); y += 2
  para('By submitting a Direct Debit Request, you have authorised us to arrange for funds to be debited from your account. The Direct Debit Request and this agreement set out the terms of the arrangement between us and you.')
  para('We will only arrange for funds to be debited from your account as authorised in the Direct Debit Request.')
  para('or')
  para('We will only arrange for funds to be debited from your account if we have sent to the email/address nominated by you in the Direct Debit Request, a billing advice which specifies the amount payable by you to us and when it is due.')
  para('If the debit day falls on a day that is not a banking day, we may direct your financial institution to debit your account on the following banking day. If you are unsure about which day your account has or will be debited you should ask your financial institution.')

  // ── PAGE 4 ──
  newPage()
  section('Amendments by us'); y += 2
  para('We may vary any details of this Agreement or a Direct Debit Request at any time by giving you at least thirty (30) days written notice sent to the preferred email or address you have given us in the Direct Debit Request.'); y += 4

  section('How to cancel or change direct debits'); y += 2
  para('You can:')
  para('(a) cancel or suspend the Direct Debit Request; or')
  para('(b) change, stop or defer an individual debit payment')
  para('at any time by giving at least 7 days notice.')
  para('To do so, contact us at: Sydney, NSW')
  para('or by telephoning us during business hours.')
  para('You can also contact your own financial institution, which must act promptly on your instructions.'); y += 4

  section('Your obligations'); y += 2
  para('It is your responsibility to ensure that there are sufficient clear funds available in your account to allow a debit payment to be made in accordance with the Direct Debit Request.')
  para('If there are insufficient clear funds in your account to meet a debit payment:')
  para('(a) you may be charged a fee and/or interest by your financial institution;')
  para('(b) we may charge you reasonable costs incurred by us on account of there being insufficient funds; and')
  para('(c) you must arrange for the debit payment to be made by another method or arrange for sufficient clear funds to be in your account by an agreed time so that we can process the debit payment.')
  para('You should check your account statement to verify that the amounts debited from your account are correct.')

  // ── PAGE 5 ──
  newPage()
  section('Dispute'); y += 2
  para('If you believe that there has been an error in debiting your account, you should notify us directly and confirm that notice in writing with us as soon as possible so that we can resolve your query more quickly. Alternatively you can contact your financial institution for assistance.')
  para('If we conclude as a result of our investigations that your account has been incorrectly debited we will respond to your query by arranging for your financial institution to adjust your account (including interest and charges) accordingly. We will also notify you in writing of the amount by which your account has been adjusted.')
  para('If we conclude as a result of our investigations that your account has not been incorrectly debited we will respond to your query by providing you with reasons and any evidence for this finding in writing.'); y += 4

  section('Accounts'); y += 2
  para('You should check:')
  para('(a) with your financial institution whether direct debiting is available from your account as direct debiting is not available on all accounts offered by financial institutions.')
  para('(b) your account details which you have provided to us are correct by checking them against a recent account statement; and')
  para('(c) with your financial institution before completing the Direct Debit Request if you have any queries about how to complete the Direct Debit Request.'); y += 4

  section('Confidentiality'); y += 2
  para('We will keep any information (including your account details) in your Direct Debit Request confidential. We will make reasonable efforts to keep any such information that we have about you secure and to ensure that any of our employees or agents who have access to information about you do not make any unauthorised use, modification, reproduction or disclosure of that information.')
  para('We will only disclose information that we have about you: to the extent specifically required by law; or for the purposes of this agreement (including disclosing information in connection with any query or claim).'); y += 4

  section('Contacting each other'); y += 2
  para('If you wish to notify us in writing about anything relating to this agreement, you should write to:')
  para(`Email: ${renter.email || ''}`)
  para('Mail: Sydney, NSW')
  para('You may telephone us during business hours.')
  para('All communication addressed to us should include your Customer Number.')
  para('We will notify you by sending a notice to the preferred address or email you have given us in the Direct Debit Request. Any notice will be deemed to have been received on the second banking day after sending.')

  doc.save(`DDR_${(renter.name || 'renter').replace(/\s+/g, '_')}_${renter.phone}.pdf`)
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
  const [fetchedAmount, setFetchedAmount] = useState<number | null>(null)
  const [fetchLoading, setFetchLoading] = useState(false)
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
  async function handleFetchSchedule(customerId: string) {
    if (!customerId.trim()) return
    setFetchLoading(true)
    setFetchedAmount(null)
    try {
      const res = await axios.get(`/api/renters/payway-schedule/${customerId.trim()}`)
      setFetchedAmount(res.data.weeklyAmount)
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Customer not found in PayWay'
      onToast(`❌ ${msg}`, 'warning')
    } finally { setFetchLoading(false) }
  }

  async function handleLink() {
    if (!fetchedAmount) return onToast('❌ Fetch the schedule first', 'warning')
    setActionLoading(true)
    try {
      await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/link-payway`, {
        paywayCustomerId: linkCustomerId,
        weeklyAmount: fetchedAmount,
      })
      onToast(`✅ PayWay customer linked — $${fetchedAmount}/wk`, 'success')
      onRefresh()
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
                  <div className="flex items-center gap-2">
                    <button onClick={() => generateDDR(renter)}
                      className="text-xs bg-accent text-white px-2.5 py-1 rounded-lg font-medium hover:bg-accent/90 transition-colors">
                      ↓ DDR
                    </button>
                    {!editing && <button onClick={() => setEditing(true)} className="text-xs text-accent font-medium">Edit</button>}
                  </div>
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
            fetchedAmount={fetchedAmount}
            fetchLoading={fetchLoading}
            onFetchSchedule={handleFetchSchedule}
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