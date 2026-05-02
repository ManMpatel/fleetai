import { useState } from 'react'
import axios from 'axios'
import type { Renter } from '../../types'

interface Props {
  renter: Renter
  fleetVehicles: any[]
  fleetLoading: boolean
  vehicleSearch: string
  setVehicleSearch: (v: string) => void
  selectedVehicleId: string
  setSelectedVehicleId: (v: string) => void
  assignLoading: boolean
  setAssignLoading: (v: boolean) => void
  vehicleServiceRecords: any[]
  vehicleSvcLoading: boolean
  setFleetVehicles: (v: any[]) => void
  onToast: (msg: string, type: 'success' | 'warning') => void
  onRefresh: () => void
}

export default function RenterDetailVehicle({
  renter, fleetVehicles, fleetLoading, vehicleSearch, setVehicleSearch,
  selectedVehicleId, setSelectedVehicleId, assignLoading, setAssignLoading,
  vehicleServiceRecords, vehicleSvcLoading, setFleetVehicles, onToast, onRefresh
}: Props) {
  const [editingPlate, setEditingPlate] = useState<string | null>(null)
  const [startDateInput, setStartDateInput] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [historyView, setHistoryView] = useState<'date' | 'vehicle'>('date')

  const currentVehicles: any[] = (renter as any).currentVehicles?.filter((v: any) => typeof v === 'object' && v?._id).length > 0
    ? (renter as any).currentVehicles.filter((v: any) => typeof v === 'object' && v?._id)
    : (renter.currentVehicle && typeof renter.currentVehicle === 'object' ? [renter.currentVehicle] : [])

  const slotsRemaining = 3 - currentVehicles.length

  function toDatetimeLocal(d: string | Date) {
    const dt = new Date(d)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  }

  function getStartDate(plate: string): string | null {
    const entry = (renter.rentalHistory || []).find((h: any) => h.plate === plate && !h.endDate)
    return (entry as any)?.startDate || null
  }

  async function saveStartDate(plate: string) {
    if (!startDateInput) return
    setSavingDate(true)
    try {
      await axios.post(`/api/fleet/${plate}/update-start-date`, {
        startDate: new Date(startDateInput).toISOString(),
        renterId: renter._id,
      })
      onToast('✅ Start date updated', 'success')
      setEditingPlate(null)
      onRefresh()
    } catch (err: any) {
      onToast('❌ ' + (err.response?.data?.error || 'Failed'), 'warning')
    } finally {
      setSavingDate(false)
    }
  }

  function fmt(d: string | Date) {
    return new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const allHistory = [...(renter.rentalHistory || [])] as any[]
  const historyByDate = [...allHistory].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())

  const plateGroups: Record<string, any[]> = {}
  allHistory.forEach(h => {
    if (!plateGroups[h.plate]) plateGroups[h.plate] = []
    plateGroups[h.plate].push(h)
  })
  Object.keys(plateGroups).forEach(plate => {
    plateGroups[plate].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
  })

  return (
    <div className="space-y-4">
      {/* Current vehicles */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Current Vehicles</h3>
          <span className="text-[10px] text-text-muted">{currentVehicles.length}/3 assigned</span>
        </div>

        {currentVehicles.length === 0 && (
          <p className="text-sm text-text-muted mb-3">No vehicle currently assigned</p>
        )}

        <div className="space-y-2 mb-3">
          {currentVehicles.map((v: any) => {
            const startDate = getStartDate(v.plate)
            const isEditing = editingPlate === v.plate
            return (
              <div key={v._id} className="flex items-center justify-between gap-2 bg-surface2 border border-border rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-lg">{v.type === 'car' ? '🚗' : '🛵'}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold font-mono text-text-primary">{v.plate}</p>
                    <p className="text-xs text-text-muted">{v.model} · {v.type}</p>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <input type="datetime-local" value={startDateInput}
                          onChange={e => setStartDateInput(e.target.value)}
                          className="text-xs bg-surface border border-border text-text-primary rounded px-2 py-1 focus:outline-none focus:border-accent" />
                        <button onClick={() => saveStartDate(v.plate)} disabled={savingDate}
                          className="text-xs bg-accent text-white px-2 py-1 rounded hover:bg-accent/90 disabled:opacity-50">
                          {savingDate ? 'Saving...' : 'Save'}
                        </button>
                        <button onClick={() => setEditingPlate(null)} className="text-xs text-text-muted hover:text-text-primary px-1">Cancel</button>
                      </div>
                    ) : startDate ? (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-xs text-text-muted">Since {fmt(startDate)}</p>
                        <button onClick={() => { setEditingPlate(v.plate); setStartDateInput(toDatetimeLocal(startDate)) }}
                          className="text-text-muted hover:text-accent transition-colors" title="Edit start date">
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs bg-green-bg text-green px-2.5 py-1 rounded-full font-medium">Active</span>
                  <button disabled={assignLoading}
                    onClick={async () => {
                      setAssignLoading(true)
                      try {
                        await axios.post(`/api/fleet/${v.plate}/unassign`)
                        onToast(`✅ ${v.plate} unassigned`, 'success')
                        onRefresh()
                        axios.get('/api/fleet').then(r => setFleetVehicles(r.data || []))
                      } catch (err: any) { onToast('❌ ' + (err.response?.data?.error || 'Failed'), 'warning') }
                      finally { setAssignLoading(false) }
                    }}
                    className="text-xs text-red-400 border border-red-200 dark:border-red-900 rounded-lg px-2.5 py-1 hover:text-red-500 disabled:opacity-40">
                    Unassign
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {slotsRemaining > 0 ? (
          <div className="bg-accent-bg border border-accent/20 rounded-xl p-4">
            <p className="text-xs font-semibold text-accent mb-3">
              Assign a vehicle ({slotsRemaining} slot{slotsRemaining !== 1 ? 's' : ''} remaining — max 3)
            </p>
            <input type="text" placeholder="Search by plate or model..." value={vehicleSearch}
              onChange={e => setVehicleSearch(e.target.value)}
              className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-accent" />
            <div className="max-h-52 overflow-y-auto rounded-lg border border-border bg-surface divide-y divide-border">
              {fleetLoading ? (
                <p className="text-xs text-text-muted p-3">Loading fleet...</p>
              ) : fleetVehicles.filter(v =>
                  v.plate.toLowerCase().includes(vehicleSearch.toLowerCase()) ||
                  (v.model || '').toLowerCase().includes(vehicleSearch.toLowerCase())
                ).length === 0 ? (
                <p className="text-xs text-text-muted p-3">No vehicles found</p>
              ) : fleetVehicles
                  .filter(v => v.plate.toLowerCase().includes(vehicleSearch.toLowerCase()) || (v.model || '').toLowerCase().includes(vehicleSearch.toLowerCase()))
                  .map((v: any) => {
                    const alreadyThisRenter = currentVehicles.some((cv: any) => cv._id === v._id || cv._id?.toString() === v._id)
                    const assignedElsewhere = v.currentRenter && !alreadyThisRenter
                    return (
                      <button key={v._id}
                        onClick={() => !assignedElsewhere && !alreadyThisRenter && setSelectedVehicleId(selectedVehicleId === v._id ? '' : v._id)}
                        disabled={assignedElsewhere || alreadyThisRenter}
                        className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${(assignedElsewhere || alreadyThisRenter) ? 'opacity-40 cursor-not-allowed' : selectedVehicleId === v._id ? 'bg-accent/10' : 'hover:bg-surface2'}`}>
                        <div className="flex items-center gap-2">
                          <span>{v.type === 'car' ? '🚗' : '🛵'}</span>
                          <div>
                            <p className="text-sm font-mono font-medium text-text-primary">{v.plate}</p>
                            <p className="text-xs text-text-muted">{v.model}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          {alreadyThisRenter ? <span className="text-xs bg-green-bg text-green px-2 py-0.5 rounded-full">Current</span>
                            : assignedElsewhere ? <div><span className="text-xs bg-amber-bg text-amber px-2 py-0.5 rounded-full">Assigned</span><p className="text-xs text-text-muted mt-0.5">{v.currentRenter?.name}</p></div>
                            : <span className="text-xs bg-green-bg text-green px-2 py-0.5 rounded-full">Available</span>}
                        </div>
                      </button>
                    )
                  })}
            </div>
            {selectedVehicleId && (
              <button disabled={assignLoading}
                onClick={async () => {
                  const v = fleetVehicles.find(v => v._id === selectedVehicleId)
                  if (!v) return
                  setAssignLoading(true)
                  try {
                    await axios.post(`/api/fleet/${v.plate}/assign`, { renterId: renter._id })
                    onToast(`✅ ${v.plate} assigned to ${renter.name}`, 'success')
                    setSelectedVehicleId('')
                    onRefresh()
                    axios.get('/api/fleet').then(r => setFleetVehicles(r.data || []))
                  } catch (err: any) { onToast('❌ ' + (err.response?.data?.error || 'Failed'), 'warning') }
                  finally { setAssignLoading(false) }
                }}
                className="w-full mt-2 bg-accent text-white text-sm font-medium py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {assignLoading ? 'Assigning...' : `Assign ${fleetVehicles.find(v => v._id === selectedVehicleId)?.plate} to ${renter.name}`}
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-amber text-center py-1">Maximum 3 vehicles reached. Unassign one to add another.</p>
        )}
      </div>

      {/* Vehicle history */}
      {allHistory.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Vehicle History</h3>
            <div className="flex bg-surface2 border border-border rounded-lg overflow-hidden text-[11px]">
              <button onClick={() => setHistoryView('date')}
                className={`px-3 py-1.5 transition-colors ${historyView === 'date' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}>
                By Date
              </button>
              <button onClick={() => setHistoryView('vehicle')}
                className={`px-3 py-1.5 transition-colors ${historyView === 'vehicle' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}>
                By Vehicle
              </button>
            </div>
          </div>

          {historyView === 'date' ? (
            <div className="divide-y divide-border">
              {historyByDate.map((h: any, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${!h.endDate ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-mono font-medium text-text-primary">{h.plate}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 border border-border text-text-muted">
                        {fleetVehicles.find(v => v.plate === h.plate)?.type || ''}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted">
                      {fmt(h.startDate)}{h.endDate ? ` → ${fmt(h.endDate)}` : ' → ongoing'}
                    </p>
                  </div>
                  <span className={`text-[11px] font-medium shrink-0 ${!h.endDate ? 'text-green' : 'text-text-muted'}`}>
                    {!h.endDate ? 'Active' : 'Ended'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(plateGroups).map(([plate, entries]) => (
                <div key={plate}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold font-mono bg-surface2 border border-border text-text-primary px-2.5 py-1 rounded-lg">{plate}</span>
                    <span className="text-xs text-text-muted">{fleetVehicles.find(v => v.plate === plate)?.model || ''}</span>
                  </div>
                  <div className="divide-y divide-border pl-3 border-l-2 border-border">
                    {entries.map((h: any, i) => (
                      <div key={i} className="flex items-center gap-3 py-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${!h.endDate ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                        <p className="text-xs text-text-muted flex-1">
                          {fmt(h.startDate)}{h.endDate ? ` → ${fmt(h.endDate)}` : ' → ongoing'}
                        </p>
                        <span className={`text-[11px] font-medium shrink-0 ${!h.endDate ? 'text-green' : 'text-text-muted'}`}>
                          {!h.endDate ? 'Active' : 'Ended'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Service history */}
      {vehicleServiceRecords.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Service History</h3>
          {vehicleSvcLoading ? <p className="text-xs text-text-muted">Loading...</p> : (
            <div className="divide-y divide-border">
              {vehicleServiceRecords.map((s: any, i) => (
                <div key={i} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-text-primary">{s.serviceType?.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-text-muted">{new Date(s.date).toLocaleDateString('en-AU')}</p>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">{s.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}