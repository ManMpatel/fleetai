import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import type { RenterHit } from './types'

interface Props {
  plate: string
  currentRenterId: string | null
  onPick: (hit: RenterHit) => void
  onClose: () => void
}

// Search window for choosing who has a car: active renters only, by name, mobile or email.
export default function RenterPicker({ plate, currentRenterId, onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<RenterHit[] | null>(null)
  const [error, setError] = useState('')
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    let stale = false
    const timer = window.setTimeout(() => {
      axios.get<RenterHit[]>('/api/rent-tracker/renters', { params: q.trim() ? { q: q.trim() } : {} })
        .then(({ data }) => { if (!stale) { setHits(data); setError('') } })
        .catch(err => { if (!stale) setError(err.response?.data?.error || 'Could not search the renters') })
    }, q ? 250 : 0)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-24 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Who has ${plate}`} className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary">Who has {plate}?</h2>
          <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary text-lg leading-none">x</button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search name, mobile or email"
          className="w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
        />
        <div className="mt-3 max-h-72 overflow-y-auto">
          {error && <p className="text-xs text-red px-1 py-2">{error}</p>}
          {!error && hits === null && <p className="text-xs text-text-muted px-1 py-2">Searching...</p>}
          {!error && hits !== null && hits.length === 0 && (
            <p className="text-xs text-text-muted px-1 py-2">
              {q.trim() ? `No renter found for "${q.trim()}". ` : 'No active renters yet. '}
              Add the renter in the Renters page first (or approve them if Pending).
            </p>
          )}
          {!error && hits?.map(h => {
            const isCurrent = h._id === currentRenterId
            const full = h.cars >= 3 && !isCurrent
            return (
              <button
                key={h._id}
                disabled={isCurrent || full}
                onClick={() => onPick(h)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface2 disabled:opacity-50 disabled:hover:bg-transparent flex items-start justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text-primary truncate">{h.name}</span>
                  <span className="block text-xs text-text-muted truncate">{[h.phone, h.email].filter(Boolean).join(' - ')}</span>
                </span>
                {isCurrent && <span className="text-[11px] text-text-muted shrink-0">has this car</span>}
                {full && <span className="text-[11px] text-amber shrink-0">already has 3 cars</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
