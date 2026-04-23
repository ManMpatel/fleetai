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
  const [editingStartDate, setEditingStartDate] = useState(false)
  const [startDateInput, setStartDateInput] = useState('')
  const [savingDate, setSavingDate] = useState(false)

  function toDatetimeLocal(d: string | Date) {
    const dt = new Date(d)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  }

  async function saveStartDate() {
    const plate = (renter.currentVehicle as any)?.plate
    if (!plate || !startDateInput) return
    setSavingDate(true)
    try {
      await axios.post(`/api/fleet/${plate}/update-start-date`, {
        startDate: new Date(startDateInput).toISOString(),
        renterId: renter._id,
      })
      onToast('✅ Start date updated', 'success')
      setEditingStartDate(false)
      onRefresh()
    } catch (err: any) {
      onToast('❌ ' + (err.response?.data?.error || 'Failed'), 'warning')
    } finally {
      setSavingDate(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Current vehicle */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Current Vehicle</h3>
          {(renter.currentVehicle as any)?._id && (
            <button disabled={assignLoading}
              onClick={async () => {
                const plate = (renter.currentVehicle as any)?.plate
                if (!plate) return
                setAssignLoading(true)
                try {
                  await axios.post(`/api/fleet/${plate}/unassign`)
                  onToast('✅ Vehicle unassigned', 'success')
                  onRefresh()
                  axios.get('/api/fleet').then(r => setFleetVehicles(r.data || []))
                } catch (err: any) { onToast('❌ ' + (err.response?.data?.error || 'Failed'), 'warning') }
                finally { setAssignLoading(false) }
              }}
              className="text-xs text-red-400 border border-red-200 dark:border-red-900 rounded-lg px-3 py-1.5 hover:text-red-500 disabled:opacity-40">
              Unassign
            </button>
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
                <div className="flex items-center gap-1.5 mt-0.5">
                  {editingStartDate ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input
                        type="datetime-local"
                        value={startDateInput}
                        onChange={e => setStartDateInput(e.target.value)}
                        className="text-xs bg-surface border border-border text-text-primary rounded px-2 py-1 focus:outline-none focus:border-accent"
                      />
                      <button onClick={saveStartDate} disabled={savingDate}
                        className="text-xs bg-accent text-white px-2 py-1 rounded hover:bg-accent/90 disabled:opacity-50">
                        {savingDate ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingStartDate(false)}
                        className="text-xs text-text-muted hover:text-text-primary px-1">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-text-muted">Since {new Date((renter as any).rentStartDate).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      <button onClick={() => { setEditingStartDate(true); setStartDateInput(toDatetimeLocal((renter as any).rentStartDate)) }}
                        className="text-text-muted hover:text-accent transition-colors" title="Edit start date">
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                    </>
                  )}
                </div>
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
                const assignedElsewhere = v.currentRenter && v.currentRenter._id !== renter._id
                const isCurrent = (renter.currentVehicle as any)?._id === v._id
                return (
                  <button key={v._id}
                    onClick={() => !assignedElsewhere && setSelectedVehicleId(selectedVehicleId === v._id ? '' : v._id)}
                    disabled={assignedElsewhere}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${assignedElsewhere ? 'opacity-40 cursor-not-allowed' : selectedVehicleId === v._id ? 'bg-accent/10' : 'hover:bg-surface2'}`}>
                    <div className="flex items-center gap-2">
                      <span>{v.type === 'car' ? '🚗' : '🛵'}</span>
                      <div>
                        <p className="text-sm font-mono font-medium text-text-primary">{v.plate}</p>
                        <p className="text-xs text-text-muted">{v.model}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      {isCurrent ? <span className="text-xs bg-green-bg text-green px-2 py-0.5 rounded-full">Current</span>
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
                    {new Date(h.startDate).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {h.endDate ? ` → ${new Date(h.endDate).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ' → now'}
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

      {/* Service history */}
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
  )
}