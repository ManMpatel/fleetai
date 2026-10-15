import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import type { CarHit, CarSearch } from './types'

interface Props {
  onAdded: () => void
  onClose: () => void
}

const STATUS: Record<string, { label: string; cls: string }> = {
  rented: { label: 'Rented', cls: 'bg-amber-bg text-amber' },
  available: { label: 'Available', cls: 'bg-green-bg text-green' },
  service: { label: 'Service', cls: 'bg-surface2 text-text-muted' },
}

// Search window for choosing which cars are on the Rent Tracker: every car in stock (Rego Import),
// found by number plate or model. It stays open so many plates can be added, then Done.
export default function CarPicker({ onAdded, onClose }: Props) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<CarSearch | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState('')
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    let stale = false
    const timer = window.setTimeout(() => {
      axios.get<CarSearch>('/api/rent-tracker/cars', { params: q.trim() ? { q: q.trim() } : {} })
        .then(({ data }) => { if (!stale) { setFound(data); setError('') } })
        .catch(err => { if (!stale) setError(err.response?.data?.error || 'Could not search the cars') })
    }, q ? 250 : 0)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function add(car: CarHit) {
    setAdding(car._id)
    try {
      await axios.post('/api/rent-tracker/cars', { vehicleId: car._id })
      setAdded(s => new Set(s).add(car._id))
      setError('')
      onAdded()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not add the car - please try again')
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Add a number plate" className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-lg p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-text-primary">Add a number plate</h2>
          <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary text-lg leading-none">x</button>
        </div>
        <p className="text-xs text-text-muted mb-3">Search your cars by number plate or model, then click a car to put it on the Rent Tracker. Add as many as you like, then click Done.</p>
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search number plate or model"
          aria-label="Search number plate or model"
          className="w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
        />
        <div className="mt-3 max-h-80 overflow-y-auto">
          {error && <p role="alert" className="text-xs text-red px-1 py-2">{error}</p>}
          {!error && found === null && <p className="text-xs text-text-muted px-1 py-2">Searching...</p>}
          {!error && found !== null && found.cars.length === 0 && (
            <p className="text-xs text-text-muted px-1 py-2">
              {q.trim() ? `No car found for "${q.trim()}". ` : 'No cars yet. '}
              Add the plate in Rego Import first.
            </p>
          )}
          {!error && found?.cars.map(car => {
            const isIn = car.inTracker || added.has(car._id)
            const tag = STATUS[car.status] ?? STATUS.available
            return (
              <button
                key={car._id}
                disabled={isIn || adding === car._id}
                onClick={() => add(car)}
                aria-label={isIn ? `${car.plate} is on the Rent Tracker` : `Add ${car.plate}`}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface2 disabled:hover:bg-transparent flex items-center justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block font-mono font-semibold text-sm text-text-primary">{car.plate}</span>
                  <span className="block text-xs text-text-muted truncate">{car.model || 'No model'}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
                  {isIn
                    ? <span className="text-[11px] font-medium text-green">On the tracker</span>
                    : <span className="text-[11px] font-medium text-accent">{adding === car._id ? 'Adding...' : '+ Add'}</span>}
                </span>
              </button>
            )
          })}
        </div>
        {!error && found !== null && found.total > found.cars.length && (
          <p className="mt-2 text-[11px] text-text-muted px-1">Showing {found.cars.length} of {found.total} - type to narrow down</p>
        )}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-text-muted">{added.size > 0 ? `${added.size} added` : ''}</span>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90">Done</button>
        </div>
      </div>
    </div>
  )
}
