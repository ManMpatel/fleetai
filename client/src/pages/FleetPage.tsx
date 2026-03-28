import { useEffect, useState, useMemo } from 'react'
import { useStore } from '../store/useStore'
import StatCard from '../components/StatCard'
import FilterBar from '../components/FilterBar'
import FleetTable from '../components/FleetTable'
import SlidePanel from '../components/SlidePanel'
import type { VehicleStatus, VehicleType } from '../types'

export default function FleetPage() {
  const { vehicles, fleetLoading, fetchVehicles, selectedVehicle, stats } = useStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<VehicleType | 'all'>('all')

  useEffect(() => {
    fetchVehicles()
  }, [fetchVehicles])

  const filtered = useMemo(() => {
    return vehicles.filter((v) => {
      const matchSearch =
        !search ||
        v.plate.toLowerCase().includes(search.toLowerCase()) ||
        v.model.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'all' || v.status === statusFilter
      const matchType = typeFilter === 'all' || v.type === typeFilter
      return matchSearch && matchStatus && matchType
    })
  }, [vehicles, search, statusFilter, typeFilter])

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      {/* Page header */}
      <div className="px-6 py-5 border-b border-border bg-surface">
        <h1 className="text-xl font-bold text-text-primary">Fleet Overview</h1>
        <p className="text-text-muted text-sm mt-0.5">Sydney scooters and cars</p>
      </div>

      <div className="flex-1 px-6 py-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Fleet"
            value={stats?.total ?? '—'}
            color="accent"
            sub={`${stats?.scooters ?? 0} scooters · ${stats?.cars ?? 0} cars`}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <rect x="1" y="3" width="15" height="13" rx="2" />
                <path d="M16 8h4l3 3v5h-7V8z" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            }
          />
          <StatCard
            label="Available"
            value={stats?.available ?? '—'}
            color="green"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            }
          />
          <StatCard
            label="Rented"
            value={stats?.rented ?? '—'}
            color="purple"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            }
          />
          <StatCard
            label="In Service"
            value={stats?.service ?? '—'}
            color="amber"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            }
          />
        </div>

        {/* Filters */}
        <FilterBar
          search={search}
          onSearch={setSearch}
          statusFilter={statusFilter}
          onStatus={setStatusFilter}
          typeFilter={typeFilter}
          onType={setTypeFilter}
        />

        {/* Table */}
        <FleetTable vehicles={filtered} loading={fleetLoading} />
      </div>

      {/* Slide-out panel */}
      {selectedVehicle && <SlidePanel />}
    </div>
  )
}
