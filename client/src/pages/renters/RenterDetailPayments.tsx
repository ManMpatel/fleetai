import axios from 'axios'
import type { Renter } from '../../types'

interface Props {
  renter: Renter
  paywayStatus: 'active' | 'paused' | 'cancelled' | 'not_setup'
  payments: any[]
  paymentsLoading: boolean
  weeklyAmount: string
  setWeeklyAmount: (v: string) => void
  editingSchedule: boolean
  setEditingSchedule: (v: boolean) => void
  linkMode: boolean
  setLinkMode: (v: boolean) => void
  linkCustomerId: string
  setLinkCustomerId: (v: string) => void
  showChargeExtra: boolean
  setShowChargeExtra: (v: boolean) => void
  extraAmount: string
  setExtraAmount: (v: string) => void
  extraNote: string
  setExtraNote: (v: string) => void
  showUpdateBank: boolean
  setShowUpdateBank: (v: boolean) => void
  newBsb: string; setNewBsb: (v: string) => void
  newAccount: string; setNewAccount: (v: string) => void
  newHolder: string; setNewHolder: (v: string) => void
  actionLoading: boolean
  confirm: { show: boolean; action: string | null }
  setConfirm: (v: { show: boolean; action: string | null }) => void
  handleActivate: () => void
  handlePause: () => void
  handleResume: () => void
  handleUpdate: () => void
  handleLink: () => void
  fetchedAmount: number | null
  fetchLoading: boolean
  onFetchSchedule: (customerId: string) => void
  handleChargeExtra: () => void
  handleUpdateBank: () => void
  onToast: (msg: string, type: 'success' | 'warning') => void
  onRefresh: () => void
}

export default function RenterDetailPayments({
  renter, paywayStatus, payments, paymentsLoading,
  weeklyAmount, setWeeklyAmount, editingSchedule, setEditingSchedule,
  linkMode, setLinkMode, linkCustomerId, setLinkCustomerId,
  showChargeExtra, setShowChargeExtra, extraAmount, setExtraAmount, extraNote, setExtraNote,
  showUpdateBank, setShowUpdateBank, newBsb, setNewBsb, newAccount, setNewAccount, newHolder, setNewHolder,
  actionLoading, setConfirm,
  handleActivate, handlePause, handleResume, handleUpdate, handleLink, handleChargeExtra, handleUpdateBank,
  fetchedAmount, fetchLoading, onFetchSchedule,
  onToast, onRefresh
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">

        {/* Auto-debit control */}
        <div className="bg-surface border border-border rounded-xl p-5">
          {renter.payway?.lastPaymentStatus === 'failed' && (
            <div className="mb-4 bg-red-bg border border-red/30 rounded-xl p-4 flex gap-3">
              <div className="w-2 h-2 rounded-full bg-red mt-1.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red mb-1">Last payment failed</p>
                <p className="text-xs text-red/80">
                  ${renter.payway.lastPaymentAmount?.toFixed(2)} on {renter.payway.lastPaymentDate ? new Date(renter.payway.lastPaymentDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} — {renter.payway.lastPaymentDescription}. Westpac will auto-retry.
                </p>
              </div>
            </div>
          )}
          {renter.payway?.lastPaymentStatus === 'dishonoured' && (
            <div className="mb-4 bg-red-bg border border-red/30 rounded-xl p-4 flex gap-3">
              <div className="w-2 h-2 rounded-full bg-red mt-1.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red mb-1">Payment dishonoured — recover vehicle</p>
                <p className="text-xs text-red/80">
                  ${renter.payway.lastPaymentAmount?.toFixed(2)} on {renter.payway.lastPaymentDate ? new Date(renter.payway.lastPaymentDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} — {renter.payway.lastPaymentDescription}. Contact the renter immediately.
                </p>
              </div>
            </div>
          )}
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Auto-Debit Control</h3>

          {paywayStatus === 'not_setup' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button onClick={() => setLinkMode(false)} className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${!linkMode ? 'bg-accent text-white border-accent' : 'bg-surface2 text-text-secondary border-border'}`}>New Customer</button>
                <button onClick={() => setLinkMode(true)} className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${linkMode ? 'bg-accent text-white border-accent' : 'bg-surface2 text-text-secondary border-border'}`}>Link Existing</button>
              </div>
              {!linkMode ? (
                <>
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">Amount per charge ($)</label>
                    <input type="number" placeholder="e.g. 150" value={weeklyAmount} onChange={e => setWeeklyAmount(e.target.value)}
                      className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent" />
                  </div>
                  {weeklyAmount && (
                    <div className="bg-accent-bg border border-accent/20 rounded-lg p-3 text-xs text-accent">
                      Will charge <strong>${weeklyAmount}</strong> every <strong>week</strong>
                    </div>
                  )}
                  <button onClick={() => setConfirm({ show: true, action: 'activate' })} disabled={!weeklyAmount || actionLoading}
                    className="w-full bg-green text-white text-sm font-medium py-3 rounded-lg disabled:opacity-50">
                    Activate Auto-Debit
                  </button>
                </>
              ) : (
                   <>
                      <div className="bg-amber-bg border border-amber/20 rounded-lg p-3 text-xs text-amber">
                        Paste the PayWay customer number — we'll fetch the amount automatically.
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1.5">PayWay Customer Number</label>
                        <input
                          type="text"
                          placeholder="e.g. 481864194"
                          value={linkCustomerId}
                          onChange={e => { setLinkCustomerId(e.target.value) }}
                          onBlur={e => onFetchSchedule(e.target.value)}
                          className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent"
                        />
                      </div>
                      {fetchLoading && (
                        <p className="text-xs text-text-muted text-center py-1">Fetching from PayWay...</p>
                      )}
                      {fetchedAmount && !fetchLoading && (
                        <div className="bg-green-bg border border-green/30 rounded-lg p-3 flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green flex-shrink-0" />
                          <p className="text-sm font-semibold text-green">${fetchedAmount}/week confirmed from PayWay</p>
                        </div>
                      )}
                      <button
                        onClick={handleLink}
                        disabled={!linkCustomerId || !fetchedAmount || actionLoading}
                        className="w-full bg-accent text-white text-sm font-medium py-3 rounded-lg disabled:opacity-50">
                        {actionLoading ? 'Linking...' : 'Link PayWay Customer'}
                      </button>
                    </>
              )}
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
                        {(renter.payway as any)?.pendingExtraAmount && (
                          <p className="text-xs text-amber font-medium mt-1">
                            ⚠️ Next: ${((renter.payway?.weeklyAmount || 0) + (renter.payway as any).pendingExtraAmount).toFixed(2)}
                          </p>
                        )}
                      </div>
                      <button onClick={() => { setWeeklyAmount(renter.payway?.weeklyAmount?.toString() || ''); setEditingSchedule(true) }}
                        className="text-xs text-green font-medium border border-green/30 px-3 py-1.5 rounded-lg hover:bg-green/10">Edit</button>
                    </div>
                  </div>
                  <button onClick={() => setConfirm({ show: true, action: 'pause' })} disabled={actionLoading}
                    className="w-full bg-amber-bg text-amber border border-amber/20 text-sm font-medium py-2.5 rounded-lg disabled:opacity-50">
                    {actionLoading ? 'Processing...' : 'Pause Auto-Debit'}
                  </button>
                  {!showUpdateBank ? (
                    <button onClick={() => setShowUpdateBank(true)}
                      className="w-full border border-border text-text-muted text-xs font-medium py-2 rounded-lg hover:border-accent hover:text-accent transition-colors">
                      Update bank account
                    </button>
                  ) : (
                    <div className="border border-border rounded-lg p-3 space-y-2.5">
                      <p className="text-xs font-semibold text-text-primary">New bank details</p>
                      <input placeholder="BSB (e.g. 062-000)" value={newBsb} onChange={e => setNewBsb(e.target.value)}
                        className="w-full bg-surface2 border border-border text-text-primary text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
                      <input placeholder="Account number" value={newAccount} onChange={e => setNewAccount(e.target.value)}
                        className="w-full bg-surface2 border border-border text-text-primary text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
                      <input placeholder="Account holder name" value={newHolder} onChange={e => setNewHolder(e.target.value)}
                        className="w-full bg-surface2 border border-border text-text-primary text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
                      <div className="flex gap-2">
                        <button onClick={handleUpdateBank} disabled={!newBsb || !newAccount || !newHolder || actionLoading}
                          className="flex-1 bg-accent text-white text-xs font-medium py-2 rounded-lg disabled:opacity-50">
                          {actionLoading ? 'Updating...' : 'Update in PayWay'}
                        </button>
                        <button onClick={() => setShowUpdateBank(false)} className="px-3 py-2 text-xs text-text-secondary border border-border rounded-lg">Cancel</button>
                      </div>
                    </div>
                  )}
                  {!showChargeExtra ? (
                    <button onClick={() => setShowChargeExtra(true)}
                      className="w-full border border-dashed border-border text-text-muted text-sm py-2.5 rounded-lg hover:border-accent hover:text-accent transition-colors">
                      + Charge extra on next debit
                    </button>
                  ) : (
                    <div className="border border-amber/30 rounded-lg p-3 space-y-3">
                      <div className="bg-amber-bg border border-amber/20 rounded-md p-2.5">
                        <p className="text-xs text-amber font-semibold">⚠️ 2-day notice required by law</p>
                        <p className="text-xs text-amber/80 mt-1">Notify the renter at least 2 business days before debiting a higher amount.</p>
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1.5">Extra amount ($)</label>
                        <input type="number" placeholder="e.g. 50" value={extraAmount} onChange={e => setExtraAmount(e.target.value)}
                          className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent" />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1.5">Reason (optional)</label>
                        <input type="text" placeholder="e.g. Damage repair" value={extraNote} onChange={e => setExtraNote(e.target.value)}
                          className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent" />
                      </div>
                      {extraAmount && parseFloat(extraAmount) > 0 && (
                        <div className="bg-accent-bg border border-accent/20 rounded-md p-2.5 text-xs text-accent">
                          Next debit: <strong>${((renter.payway?.weeklyAmount || 0) + parseFloat(extraAmount)).toFixed(2)}</strong>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={handleChargeExtra} disabled={!extraAmount || parseFloat(extraAmount) <= 0 || actionLoading}
                          className="flex-1 bg-accent text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50">
                          {actionLoading ? 'Setting...' : 'Confirm Extra Charge'}
                        </button>
                        <button onClick={() => { setShowChargeExtra(false); setExtraAmount(''); setExtraNote('') }}
                          className="px-4 py-2.5 text-sm text-text-secondary border border-border rounded-lg hover:bg-surface2">Cancel</button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-text-primary">Update Schedule</p>
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">New amount per charge ($)</label>
                    <input type="number" value={weeklyAmount} onChange={e => setWeeklyAmount(e.target.value)}
                      className="w-full bg-surface2 border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirm({ show: true, action: 'update' })} disabled={!weeklyAmount || actionLoading}
                      className="flex-1 bg-accent text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50">Update Schedule</button>
                    <button onClick={() => setEditingSchedule(false)} className="px-4 py-2.5 text-sm text-text-secondary border border-border rounded-lg hover:bg-surface2">Cancel</button>
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

        {/* PayWay Activity Log */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">PayWay Activity</h3>
          {(() => {
            const acts = ((renter.payway as any)?.activity || [])
              .filter((a: any) => !a.expiresAt || new Date(a.expiresAt) > new Date())
              .slice().reverse()
            if (acts.length === 0) return <p className="text-xs text-text-muted text-center py-6">No activity yet</p>
            return (
              <div className="divide-y divide-border">
                {acts.map((a: any, i: number) => (
                  <div key={i} className="py-2.5 flex items-start gap-2.5">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.type === 'success' ? 'bg-green' : a.type === 'error' ? 'bg-red' : a.type === 'warning' ? 'bg-amber' : 'bg-accent'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-text-primary">{a.message}</p>
                      {a.detail && <p className="text-xs text-text-muted mt-0.5">{a.detail}</p>}
                      <p className="text-[10px] text-text-muted mt-0.5">
                        {new Date(a.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-surface border border-border rounded-xl p-5">
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
              const code = String(p.responseCode || '')
              const ok = p.status === 'approved' || code === '08' || code === '00'
              const isTerminal = code === '2' || code === '3'
              const statusClass = ok ? 'bg-green-bg text-green' : isTerminal ? 'bg-red-bg text-red font-semibold' : 'bg-amber-bg text-amber'
              const detail = isTerminal ? (code === '2' ? 'Renter stopped debits — recover vehicle' : 'Account closed — recover vehicle') : ''
              return (
                <div key={i} className="py-2.5 border-b border-border last:border-0">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusClass}`}>{ok ? 'Approved' : isTerminal ? 'Terminal' : 'Declined'}</span>
                        <span className="text-text-muted text-xs">{p.date ? new Date(p.date).toLocaleDateString('en-AU') : '—'}</span>
                      </div>
                      {detail && <p className="text-[10px] mt-0.5 text-red font-medium">{detail}</p>}
                      {p.transactionId && (
                        <div className="flex gap-2 mt-1.5">
                          {p.isVoidable && (
                            <button onClick={async () => {
                              try {
                                await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/void-transaction`, { transactionId: p.transactionId })
                                onToast('✅ Transaction voided', 'success'); onRefresh()
                              } catch { onToast('❌ Void failed', 'warning') }
                            }} className="text-[10px] px-2 py-1 rounded border border-red/30 text-red bg-red-bg">Void</button>
                          )}
                          {p.isRefundable && (
                            <button onClick={async () => {
                              const amt = window.prompt(`Refund amount (max $${p.amount}):`, String(p.amount))
                              if (!amt) return
                              try {
                                await axios.post(`/api/renters/${encodeURIComponent(renter.phone)}/refund-transaction`, { transactionId: p.transactionId, amount: parseFloat(amt) })
                                onToast(`✅ $${amt} refunded`, 'success'); onRefresh()
                              } catch { onToast('❌ Refund failed', 'warning') }
                            }} className="text-[10px] px-2 py-1 rounded border border-accent/30 text-accent bg-accent-bg">Refund</button>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={`text-sm font-semibold ${ok ? 'text-text-primary' : 'text-red'}`}>${Number(p.amount || 0).toFixed(2)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Rental History */}
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
  )
}