import { useState, useRef } from 'react'
import axios from 'axios'

interface RenterSummary {
  _id: string; name: string; phone: string; email?: string; status?: string
}
interface RentalRecord {
  plate: string; startDate: string; endDate?: string; weeklyRate?: number; totalAmount?: number
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      const { data } = await axios.get(`/api/search?q=${encodeURIComponent(query.trim())}`)
      setResult(data)
    } catch {
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  function StatusBadge({ status }: { status?: string }) {
    const colors: Record<string, string> = {
      active: 'bg-green-bg text-green',
      pending: 'bg-amber-bg text-amber',
      inactive: 'bg-red-bg text-red',
    }
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status || ''] || 'bg-surface2 text-text-muted'}`}>
        {status || 'unknown'}
      </span>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-surface">
        <h1 className="text-xl font-bold text-text-primary">History Search</h1>
        <p className="text-text-muted text-sm mt-0.5">Search by plate, name, or phone number</p>
      </div>

      <div className="px-6 py-6 max-w-4xl w-full mx-auto space-y-6">
        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Enter plate (e.g. ABC123), name, or phone..."
            className="flex-1 px-4 py-3 rounded-xl bg-surface border border-border text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        {/* No results */}
        {searched && !loading && result && result.type === 'plate' && !result.vehicle && (
          <div className="text-center py-12 text-text-muted text-sm">No vehicle found for plate <strong>{query.toUpperCase()}</strong></div>
        )}
        {searched && !loading && result && result.type === 'renter' && result.results?.length === 0 && (
          <div className="text-center py-12 text-text-muted text-sm">No renters found matching <strong>{query}</strong></div>
        )}

        {/* ── Plate results ── */}
        {result?.type === 'plate' && result.vehicle && (
          <div className="space-y-4">
            {/* Vehicle card */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="font-mono font-bold text-accent text-xl">{result.vehicle.plate}</span>
                  <span className="ml-3 text-text-secondary text-sm">{result.vehicle.model} · {result.vehicle.year}</span>
                </div>
                <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                  result.vehicle.status === 'available' ? 'bg-green-bg text-green' :
                  result.vehicle.status === 'rented' ? 'bg-accent-bg text-accent' : 'bg-amber-bg text-amber'
                }`}>{result.vehicle.status}</span>
              </div>

              {/* Current renter */}
              {result.vehicle.currentRenter && (
                <div className="bg-accent/10 border border-accent/20 rounded-lg p-3 mb-2">
                  <p className="text-xs text-accent font-semibold uppercase tracking-wide mb-1">Current Renter</p>
                  <p className="text-text-primary font-medium">{result.vehicle.currentRenter.name}</p>
                  <p className="text-text-muted text-xs">{result.vehicle.currentRenter.phone} · {result.vehicle.currentRenter.email}</p>
                </div>
              )}
            </div>

            {/* Rental history for this plate */}
            {result.history?.length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-4">Previous Renters</h3>
                <div className="space-y-3">
                  {result.history.map((h: any, i: number) => (
                    <div key={i} className="border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-medium text-text-primary">{h.renter.name}</span>
                          <span className="text-text-muted text-xs ml-2">{h.renter.phone}</span>
                        </div>
                        <StatusBadge status={h.renter.status} />
                      </div>
                      {h.rentals.map((r: RentalRecord, j: number) => (
                        <div key={j} className="text-xs text-text-muted flex gap-4 mt-1">
                          <span>{new Date(r.startDate).toLocaleDateString('en-AU')} → {r.endDate ? new Date(r.endDate).toLocaleDateString('en-AU') : 'Present'}</span>
                          {r.weeklyRate && <span>${r.weeklyRate}/wk</span>}
                          {r.totalAmount && <span>Total: ${r.totalAmount}</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Renter results ── */}
        {result?.type === 'renter' && result.results?.length > 0 && (
          <div className="space-y-4">
            {result.results.map((item: { renter: RenterSummary & any, rentals: RentalRecord[] }, i: number) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="font-semibold text-text-primary">{item.renter.name}</span>
                    <span className="text-text-muted text-sm ml-2">{item.renter.phone}</span>
                    {item.renter.email && <span className="text-text-muted text-xs ml-2">{item.renter.email}</span>}
                  </div>
                  <StatusBadge status={item.renter.status} />
                </div>

                {/* Current vehicle */}
                {item.renter.currentVehicle && (
                  <div className="bg-accent/10 border border-accent/20 rounded-lg p-2 mb-3 text-xs">
                    <span className="text-accent font-semibold">Currently riding: </span>
                    <span className="font-mono font-bold text-text-primary">{(item.renter.currentVehicle as any).plate}</span>
                    <span className="text-text-muted ml-1">{(item.renter.currentVehicle as any).model}</span>
                  </div>
                )}

                {/* Rental history */}
                {item.rentals.length > 0 ? (
                  <div>
                    <p className="text-xs text-text-muted font-semibold uppercase tracking-wide mb-2">Rental History</p>
                    <div className="space-y-1.5">
                      {item.rentals.map((r, j) => (
                        <div key={j} className="flex items-center justify-between text-xs border-b border-border pb-1.5 last:border-0">
                          <div className="flex gap-3">
                            <span className="font-mono font-bold text-accent">{r.plate}</span>
                            <span className="text-text-muted">{new Date(r.startDate).toLocaleDateString('en-AU')} → {r.endDate ? new Date(r.endDate).toLocaleDateString('en-AU') : 'Present'}</span>
                          </div>
                          <div className="flex gap-3 text-text-muted">
                            {r.weeklyRate && <span>${r.weeklyRate}/wk</span>}
                            {r.totalAmount && <span className="text-text-secondary font-medium">${r.totalAmount} total</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">No rental history yet</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}