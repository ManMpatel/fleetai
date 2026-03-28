import type { Vehicle } from '../types'
import { useStore } from '../store/useStore'

interface FleetTableProps {
  vehicles: Vehicle[]
  loading: boolean
}

const statusColors = {
  available: 'bg-green-bg text-green',
  rented: 'bg-accent-bg text-accent',
  service: 'bg-amber-bg text-amber',
}

const statusDot = {
  available: 'bg-green',
  rented: 'bg-accent',
  service: 'bg-amber',
}

function formatDate(d?: string) {
  if (!d) return '—'
  const date = new Date(d)
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function isOverdue(d?: string) {
  if (!d) return false
  return new Date(d) < new Date()
}

function isDueSoon(d?: string, days = 30) {
  if (!d) return false
  const diff = new Date(d).getTime() - Date.now()
  return diff > 0 && diff < days * 86400000
}

export default function FleetTable({ vehicles, loading }: FleetTableProps) {
  const { selectVehicle } = useStore()

  if (loading) {
    return (
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="p-8 text-center text-text-muted text-sm">Loading fleet data...</div>
      </div>
    )
  }

  if (vehicles.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="p-12 text-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 text-text-muted mx-auto mb-3">
            <rect x="1" y="3" width="15" height="13" rx="2" />
            <path d="M16 8h4l3 3v5h-7V8z" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          <p className="text-text-muted text-sm">No vehicles match your filters</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface2">
              <th className="text-left px-4 py-3 text-text-muted font-medium text-xs uppercase tracking-wide">Plate</th>
              <th className="text-left px-4 py-3 text-text-muted font-medium text-xs uppercase tracking-wide">Model</th>
              <th className="text-left px-4 py-3 text-text-muted font-medium text-xs uppercase tracking-wide">Type</th>
              <th className="text-left px-4 py-3 text-text-muted font-medium text-xs uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 text-text-muted font-medium text-xs uppercase tracking-wide">Renter</th>
              <th className="text-left px-4 py-3 text-text-muted font-medium text-xs uppercase tracking-wide">Rego Expiry</th>
              <th className="text-left px-4 py-3 text-text-muted font-medium text-xs uppercase tracking-wide">Pink Slip</th>
              <th className="text-left px-4 py-3 text-text-muted font-medium text-xs uppercase tracking-wide">Fines</th>
              <th className="w-10 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {vehicles.map((vehicle) => {
              const regoOverdue = isOverdue(vehicle.regoExpiry)
              const regoDue = !regoOverdue && isDueSoon(vehicle.regoExpiry)
              const pinkOverdue = isOverdue(vehicle.pinkSlip)
              const unpaidFines = vehicle.fines.filter((f) => !f.paid).length

              return (
                <tr
                  key={vehicle._id}
                  onClick={() => selectVehicle(vehicle)}
                  className="hover:bg-surface2 cursor-pointer transition-colors group"
                >
                  <td className="px-4 py-3.5">
                    <span className="font-mono font-semibold text-text-primary tracking-wide">{vehicle.plate}</span>
                  </td>
                  <td className="px-4 py-3.5 text-text-secondary">
                    {vehicle.model} <span className="text-text-muted">'{String(vehicle.year).slice(-2)}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-text-muted capitalize">{vehicle.type}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[vehicle.status]}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusDot[vehicle.status]}`} />
                      {vehicle.status.charAt(0).toUpperCase() + vehicle.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-text-secondary">
                    {vehicle.currentRenter
                      ? typeof vehicle.currentRenter === 'object'
                        ? vehicle.currentRenter.name
                        : '—'
                      : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={regoOverdue ? 'text-red font-medium' : regoDue ? 'text-amber' : 'text-text-secondary'}>
                      {formatDate(vehicle.regoExpiry)}
                      {regoOverdue && <span className="ml-1 text-[10px] bg-red-bg text-red px-1.5 py-0.5 rounded">EXPIRED</span>}
                      {regoDue && <span className="ml-1 text-[10px] bg-amber-bg text-amber px-1.5 py-0.5 rounded">DUE</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={pinkOverdue ? 'text-red font-medium' : 'text-text-secondary'}>
                      {formatDate(vehicle.pinkSlip)}
                      {pinkOverdue && <span className="ml-1 text-[10px] bg-red-bg text-red px-1.5 py-0.5 rounded">EXPIRED</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    {unpaidFines > 0 ? (
                      <span className="inline-flex items-center gap-1 text-red font-semibold">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        {unpaidFines}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 border-t border-border bg-surface2 text-xs text-text-muted">
        {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} shown
      </div>
    </div>
  )
}
