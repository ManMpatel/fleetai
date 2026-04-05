import { useEffect, useState, useMemo, useRef } from 'react'
import { useStore } from '../store/useStore'
import { useAuth0 } from '@auth0/auth0-react'
import axios from 'axios'
import StatCard from '../components/StatCard'
import FilterBar from '../components/FilterBar'
import FleetTable from '../components/FleetTable'
import SlidePanel from '../components/SlidePanel'
import type { VehicleStatus, VehicleType } from '../types'

function ShareLinks() {
  const { user } = useAuth0()
  const [open, setOpen] = useState(false)
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'
  const BASE = 'https://fleetai.co.in'

  useEffect(() => {
    if (!user?.email) return
    axios.get(`${API}/api/auth/slug`, { headers: { 'x-owner-email': user.email } })
      .then(r => { if (r.data.slug) setSlug(r.data.slug) })
      .catch(() => {})
  }, [user?.email])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function saveSlug() {
    if (!slug.trim() || !user?.email) return
    setSaving(true)
    try {
      await axios.post(`${API}/api/auth/slug`, { slug }, { headers: { 'x-owner-email': user.email } })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch {}
    setSaving(false)
  }

  function copyLink(type: string) {
    const url = type === 'onboard'
      ? `${BASE}/onboard/${slug}`
      : type === 'tablet'
      ? `${BASE}/tablet?owner=${encodeURIComponent(user?.email || '')}`
      : BASE
    navigator.clipboard.writeText(url).then(() => {
      setCopied(type); setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-secondary hover:text-text-primary hover:border-accent transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        Share Links
      </button>

      {open && (
      <div className="absolute right-0 top-11 w-72 bg-surface border border-border rounded-xl shadow-xl z-50 p-4 space-y-3">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Your links</p>
        {[
          { type: 'tablet',  label: 'Tablet page',  sub: 'Open on employee tablet', icon: '📱', url: 'https://fleetai.co.in/tablet' },
          { type: 'onboard', label: 'Onboard form', sub: 'Send link to new renters', icon: '👤', url: `https://fleetai.co.in/onboard/${slug}` },
        ].map(link => (
          <div key={link.type} className="flex items-center justify-between p-3 bg-surface2 border border-border rounded-lg">
            <div className="flex items-center gap-2.5 min-w-0">
              <span>{link.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{link.label}</p>
                <p className="text-xs text-text-muted truncate">{link.sub}</p>
              </div>
            </div>
            <button
              onClick={() => copyLink(link.type)}
              className="ml-3 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-secondary hover:border-accent hover:text-accent transition-colors shrink-0"
            >
              {copied === link.type ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>
    )}
          {!slug && (
            <p className="text-xs text-amber text-center">Set your short name above to enable copy</p>
          )}
        </div>
      )}
   
    

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
      <div className="px-6 py-5 border-b border-border bg-surface flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Fleet Overview</h1>
          <p className="text-text-muted text-sm mt-0.5">Sydney scooters and cars</p>
        </div>
        <ShareLinks />
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
