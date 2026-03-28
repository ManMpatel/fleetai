import type { VehicleStatus, VehicleType } from '../types'

interface FilterBarProps {
  search: string
  onSearch: (v: string) => void
  statusFilter: VehicleStatus | 'all'
  onStatus: (v: VehicleStatus | 'all') => void
  typeFilter: VehicleType | 'all'
  onType: (v: VehicleType | 'all') => void
}

const statuses: Array<{ value: VehicleStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'rented', label: 'Rented' },
  { value: 'service', label: 'Service' },
]

const types: Array<{ value: VehicleType | 'all'; label: string }> = [
  { value: 'all', label: 'All Types' },
  { value: 'scooter', label: 'Scooters' },
  { value: 'car', label: 'Cars' },
]

export default function FilterBar({ search, onSearch, statusFilter, onStatus, typeFilter, onType }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search plate, model..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full bg-surface border border-border text-text-primary placeholder-text-muted text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
        {statuses.map((s) => (
          <button
            key={s.value}
            onClick={() => onStatus(s.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === s.value
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface2'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Type filter */}
      <select
        value={typeFilter}
        onChange={(e) => onType(e.target.value as VehicleType | 'all')}
        className="bg-surface border border-border text-text-secondary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent transition-colors cursor-pointer"
      >
        {types.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  )
}
