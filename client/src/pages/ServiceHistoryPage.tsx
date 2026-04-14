import { useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmt(d: string) {
  const dt = new Date(d)
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()} · ${dt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`
}

const SERVICE_LABELS: Record<string, string> = {
  oil_change: 'Oil Change', tyres: 'Tyres', brakes: 'Brakes', general: 'General Service', other: 'Other'
}

interface ServiceRecord {
  _id: string
  plate: string
  serviceType: string
  description: string
  cost?: number
  employeeName?: string
  customerName?: string
  customerPhone?: string
  kilometres?: string
  date: string
}

export default function ServiceHistoryPage() {
  const [query, setQuery] = useState('')
  const [records, setRecords] = useState<ServiceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      const ownerEmail = axios.defaults.headers.common['x-owner-email'] as string
      const { data } = await axios.get(`${API}/api/employees/service-records`, {
        params: { ownerId: ownerEmail, plate: query.trim().toUpperCase() }
      })
      setRecords(data || [])
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      <div className="px-6 py-5 border-b border-border bg-surface">
        <h1 className="text-xl font-bold text-text-primary">Service History</h1>
        <p className="text-text-muted text-sm mt-0.5">Search service records by plate number</p>
      </div>

      <div className="px-6 py-6 max-w-4xl w-full mx-auto space-y-6">
        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value.toUpperCase())}
            placeholder="Enter plate (e.g. ABC123)..."
            className="flex-1 px-4 py-3 rounded-xl bg-surface border border-border text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent font-mono"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        {searched && !loading && records.length === 0 && (
          <div className="bg-surface border border-border rounded-xl p-8 text-center">
            <p className="text-text-muted text-sm">No service records found for <span className="font-mono font-medium text-text-primary">{query}</span></p>
          </div>
        )}

        {records.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">
                Service records for <span className="font-mono text-accent">{query}</span>
              </h3>
              <span className="text-xs text-text-muted">{records.length} records</span>
            </div>
            <div className="divide-y divide-border">
              {records.map(r => (
                <div key={r._id} className="px-5 py-4 hover:bg-surface2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-text-primary">{SERVICE_LABELS[r.serviceType] || r.serviceType}</span>
                        {r.cost != null && (
                          <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium">${r.cost.toFixed(2)}</span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted mb-1">{r.description}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-muted">
                        {r.employeeName && <span>👤 {r.employeeName}</span>}
                        {r.customerName && <span>🔧 {r.customerName} {r.customerPhone && `· ${r.customerPhone}`}</span>}
                        {r.kilometres && <span>📍 {r.kilometres} km</span>}
                      </div>
                    </div>
                    <p className="text-xs text-text-muted whitespace-nowrap">{fmt(r.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

