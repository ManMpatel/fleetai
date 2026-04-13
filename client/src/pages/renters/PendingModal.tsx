import { useState } from 'react'
import axios from 'axios'
import type { Renter } from '../../types'

interface Props {
  renter: Renter
  onClose: () => void
  onToast: (msg: string, type: 'success' | 'warning') => void
  onRefresh: () => void
  setLightbox: (url: string | null) => void
}

export default function PendingModal({ renter, onClose, onToast, onRefresh, setLightbox }: Props) {
  const [modalForm, setModalForm] = useState<Record<string, any>>({
    name: renter.name || '', email: renter.email || '',
    dateOfBirth: renter.dateOfBirth || '', licenceNumber: renter.licenceNumber || '',
    passportNumber: (renter as any).passportNumber || '',
    emergencyContactName: renter.emergencyContactName || '',
    emergencyContactPhone: renter.emergencyContactPhone || '',
    addressStreet: renter.address?.street || '', addressCity: renter.address?.city || '',
    addressState: renter.address?.state || 'NSW', addressPostcode: renter.address?.postcode || '',
    bankName: renter.bankName || '', accountHolderName: renter.accountHolderName || '',
    bsbNumber: renter.bsbNumber || '', accountNumber: renter.accountNumber || '',
  })
  const [modalSaving, setModalSaving] = useState(false)
  const [verifyData, setVerifyData] = useState<any>(null)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [aiVerifyResults, setAiVerifyResults] = useState<any>(null)
  const [aiVerifyLoading, setAiVerifyLoading] = useState(false)

  async function loadVerification() {
    setVerifyLoading(true)
    try {
      const { data } = await axios.get(`/api/renters/${encodeURIComponent(renter.phone)}/verify`)
      setVerifyData(data)
    } catch { setVerifyData({ error: true }) }
    finally { setVerifyLoading(false) }
  }

  async function handleSave() {
    setModalSaving(true)
    try {
      await axios.put(`/api/renters/${encodeURIComponent(renter.phone)}`, {
        name: modalForm.name, email: modalForm.email,
        dateOfBirth: modalForm.dateOfBirth, licenceNumber: modalForm.licenceNumber,
        passportNumber: modalForm.passportNumber,
        emergencyContactName: modalForm.emergencyContactName,
        emergencyContactPhone: modalForm.emergencyContactPhone,
        bankName: modalForm.bankName, accountHolderName: modalForm.accountHolderName,
        bsbNumber: modalForm.bsbNumber, accountNumber: modalForm.accountNumber,
        address: { street: modalForm.addressStreet, city: modalForm.addressCity, state: modalForm.addressState, postcode: modalForm.addressPostcode },
      })
      onToast('✅ Details saved — running checks...', 'success')
      onRefresh()
      await loadVerification()
      setAiVerifyLoading(true)
      try {
        const { data } = await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/ai-verify`)
        setAiVerifyResults(data.results)
      } catch { } finally { setAiVerifyLoading(false) }
    } catch { onToast('❌ Failed to save', 'warning') }
    finally { setModalSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[9999]" onClick={onClose} />
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-3xl my-auto shadow-2xl">

          {/* Header */}
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-bg flex items-center justify-center shrink-0">
                <span className="text-amber font-semibold text-sm">{renter.name?.charAt(0)}</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-text-primary">{renter.name}</h2>
                <p className="text-xs text-text-muted">{renter.phone} · {renter.email}</p>
              </div>
              <span className="text-[10px] bg-amber-bg text-amber px-2 py-0.5 rounded-full font-medium">Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <button disabled={modalSaving} onClick={handleSave}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-text-secondary hover:border-accent hover:text-accent disabled:opacity-40 transition-colors">
                {modalSaving ? 'Saving...' : 'Save changes'}
              </button>
              <button onClick={onClose} className="w-7 h-7 rounded-full bg-surface2 flex items-center justify-center text-text-muted hover:text-text-primary text-sm">✕</button>
            </div>
          </div>

          {/* Body */}
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
                    onChange={e => setModalForm(p => ({ ...p, [f.key]: e.target.value }))}
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
                    onChange={e => setModalForm(p => ({ ...p, [bk.key]: e.target.value }))}
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
                    onChange={e => setModalForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
                </div>
              ))}
              <div>
                <label className="block text-xs text-text-muted mb-1">State</label>
                <select value={modalForm.addressState || 'NSW'} onChange={e => setModalForm(p => ({ ...p, addressState: e.target.value }))}
                  className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent">
                  {['NSW','VIC','QLD','WA','SA','TAS','ACT','NT'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Right — photos + verification */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Identity Photos</p>
                  {(renter as any).docRef && (
                    <span className="text-xs font-mono bg-surface2 border border-border px-2 py-0.5 rounded text-text-primary">
                      Ref: {(renter as any).docRef}
                    </span>
                  )}
                </div>
                {((renter as any).licencePhotoBase64 || (renter as any).passportPhotoBase64) && (
                  <button onClick={() => {
                    const ref = (renter as any).docRef || renter.phone
                    const safeName = renter.name.replace(/\s+/g, '-')
                    const downloads = []
                    if ((renter as any).licencePhotoBase64) downloads.push({ data: (renter as any).licencePhotoBase64, name: `${ref}-${safeName}-licence.jpg` })
                    if ((renter as any).selfieBase64) downloads.push({ data: (renter as any).selfieBase64, name: `${ref}-${safeName}-selfie.jpg` })
                    if ((renter as any).passportPhotoBase64) downloads.push({ data: (renter as any).passportPhotoBase64, name: `${ref}-${safeName}-passport.jpg` })
                    downloads.forEach((d, i) => setTimeout(() => {
                      const a = document.createElement('a'); a.href = `data:image/jpeg;base64,${d.data}`; a.download = d.name
                      document.body.appendChild(a); a.click(); document.body.removeChild(a)
                    }, i * 800))
                  }} className="w-full mb-3 py-2 border border-accent text-accent text-xs font-medium rounded-lg hover:bg-accent/10 transition-colors">
                    ⬇ Download Documents ({(renter as any).docRef || 'no ref'})
                  </button>
                )}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Licence', url: (renter as any).licencePhotoBase64 ? `data:image/jpeg;base64,${(renter as any).licencePhotoBase64}` : renter.licencePhotoUrl },
                    { label: 'Selfie', url: (renter as any).selfieBase64 ? `data:image/jpeg;base64,${(renter as any).selfieBase64}` : (renter as any).selfieUrl },
                    { label: 'Passport', url: (renter as any).passportPhotoBase64 ? `data:image/jpeg;base64,${(renter as any).passportPhotoBase64}` : (renter as any).passportPhotoUrl },
                  ].map(ph => (
                    <div key={ph.label}>
                      <p className="text-xs text-text-muted mb-1">{ph.label}</p>
                      {ph.url ? (
                        <img src={ph.url} alt={ph.label} onClick={() => setLightbox(ph.url!)}
                          className="w-full h-20 object-cover rounded-lg border border-border cursor-pointer hover:opacity-80" />
                      ) : (
                        <div className="w-full h-20 rounded-lg border border-border bg-surface2 flex items-center justify-center">
                          <span className="text-xs text-text-muted">Not uploaded</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {verifyData && !verifyData.error && (
                <div>
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Format checks</p>
                  <div className="bg-surface2 rounded-xl px-3 py-1">
                    {verifyData.checks?.map((c: any, i: number) => (
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

              {aiVerifyResults && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">AI document check</p>
                    <span className="text-xs bg-accent-bg text-accent px-2 py-0.5 rounded-full">Gemini</span>
                  </div>
                  <div className="bg-surface2 rounded-xl px-3 py-1">
                    {[
                      { key: 'name', label: 'Full name' }, { key: 'dob', label: 'Date of birth' },
                      { key: 'address', label: 'Address' }, { key: 'licenceNumber', label: 'Licence number' },
                      { key: 'passportNumber', label: 'Passport number' },
                    ].map(f => {
                      const r = aiVerifyResults[f.key]; if (!r) return null
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
              {aiVerifyLoading && <div className="text-xs text-text-muted text-center py-3">Running AI document check...</div>}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border flex items-center justify-between">
            <button disabled={aiVerifyLoading || verifyLoading}
              onClick={async () => {
                await loadVerification()
                setAiVerifyLoading(true); setAiVerifyResults(null)
                try {
                  const { data } = await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/ai-verify`)
                  setAiVerifyResults(data.results)
                } catch { } finally { setAiVerifyLoading(false) }
              }}
              className="px-4 py-2.5 border border-border rounded-xl text-sm text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-40 transition-colors">
              {aiVerifyLoading ? 'Running checks...' : 'Run verification checks'}
            </button>
            <div className="flex gap-2">
              <button onClick={async () => {
                if (!window.confirm(`Reject ${renter.name}?`)) return
                await axios.delete(`/api/renters/${encodeURIComponent(renter.phone)}/reject`)
                onToast(`${renter.name} rejected`, 'warning'); onClose(); onRefresh()
              }} className="px-4 py-2.5 bg-red-bg text-red text-sm font-medium rounded-xl border border-red/20">✕ Reject</button>
              <button onClick={async () => {
                await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/approve`)
                onToast(`✅ ${renter.name} approved!`, 'success'); onClose(); onRefresh()
              }} className="px-4 py-2.5 bg-green text-white text-sm font-medium rounded-xl">✓ Approve</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}