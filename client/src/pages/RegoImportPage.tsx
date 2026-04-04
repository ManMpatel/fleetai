import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { useAuth0 } from '@auth0/auth0-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

type RegoStatus = 'in_stock' | 'stolen' | 'sold'

interface RegoVehicle {
  _id: string
  plate: string
  year: number
  regoExpiry: string
  notes?: string
  regoStatus: RegoStatus
  regoPhotoBase64?: string
}

interface ConfirmData {
  plate: string
  year: string
  regoExpiry: string
  notes: string
  photoBase64: string
}

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function formatExpiry(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()].slice(0,3)} ${d.getFullYear()}`
}

function expiryColor(dateStr: string) {
  const days = daysUntil(dateStr)
  if (days < 0)   return { dot: '#EF4444', text: '#B91C1C', label: `Expired ${Math.abs(days)}d ago` }
  if (days <= 7)  return { dot: '#F59E0B', text: '#B45309', label: `${days}d left` }
  if (days <= 14) return { dot: '#F59E0B', text: '#B45309', label: formatExpiry(dateStr) }
  return { dot: '#22C55E', text: '#15803D', label: formatExpiry(dateStr) }
}

// ── Compress image using canvas ─────────────────────────────
async function compressImage(file: File, maxWidth = 800, quality = 0.6): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1]
      URL.revokeObjectURL(url)
      resolve(base64)
    }
    img.src = url
  })
}

export default function RegoImportPage() {
  const { user } = useAuth0()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [vehicles, setVehicles] = useState<RegoVehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<RegoStatus>('in_stock')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [confirm, setConfirm] = useState<ConfirmData | null>(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [editVehicle, setEditVehicle] = useState<RegoVehicle | null>(null)
  const [editYear, setEditYear] = useState('')
  const [photoModal, setPhotoModal] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(''), 3000)
  }

  async function fetchVehicles() {
    try {
      const { data } = await axios.get(`${API}/api/fleet`, {
        headers: { 'x-owner-email': user?.email || '' }
      })
      setVehicles(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchVehicles() }, [user?.email])

  function groupByMonth(list: RegoVehicle[]) {
    const groups: Record<string, RegoVehicle[]> = {}
    list
      .filter(v => v.regoExpiry)
      .sort((a, b) => new Date(a.regoExpiry).getTime() - new Date(b.regoExpiry).getTime())
      .forEach(v => {
        const d = new Date(v.regoExpiry)
        const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`
        if (!groups[key]) groups[key] = []
        groups[key].push(v)
      })
    return groups
  }

  function toggleCollapse(key: string) {
    setCollapsed(p => ({ ...p, [key]: !p[key] }))
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true)

    try {
      // Compress first
      const compressed = await compressImage(file)

      // Send compressed to Gemini
      const { data } = await axios.post(`${API}/api/upload/read-rego-bulk`, {
        files: [{ name: file.name, base64: compressed, mimeType: 'image/jpeg' }]
      })

      const result = data.results?.[0]
      if (result?.data?.plate) {
        setConfirm({
          plate: result.data.plate || '',
          year:  result.data.year  || '',
          regoExpiry: result.data.regoExpiry || '',
          notes: '',
          photoBase64: compressed,
        })
      } else {
        showToast('❌ Could not read rego — try a clearer photo')
      }
    } catch {
      showToast('❌ Failed to scan photo')
    }

    setScanning(false)
    e.target.value = ''
  }

  async function confirmSave() {
    if (!confirm?.plate || !confirm?.regoExpiry) {
      showToast('❌ Plate and expiry are required'); return
    }
    setSaving(true)
    try {
      await axios.post(`${API}/api/fleet`, {
        plate: confirm.plate.toUpperCase(),
        model: 'Unknown',
        year: parseInt(confirm.year) || new Date().getFullYear(),
        type: 'scooter',
        regoExpiry: confirm.regoExpiry,
        notes: confirm.notes,
        regoStatus: 'in_stock',
        regoPhotoBase64: confirm.photoBase64,
      }, { headers: { 'x-owner-email': user?.email || '' } })

      showToast(`✅ ${confirm.plate.toUpperCase()} saved`)
      setConfirm(null)
      fetchVehicles()
    } catch (err: any) {
      showToast(`❌ ${err.response?.data?.error || 'Failed to save'}`)
    }
    setSaving(false)
  }

  async function updateStatus(vehicle: RegoVehicle, status: RegoStatus) {
    try {
      await axios.put(`${API}/api/fleet/${vehicle.plate}`,
        { regoStatus: status },
        { headers: { 'x-owner-email': user?.email || '' } }
      )
      setVehicles(prev => prev.map(v => v._id === vehicle._id ? { ...v, regoStatus: status } : v))
    } catch { showToast('❌ Failed to update status') }
  }

  async function saveEdit() {
    if (!editVehicle || !editYear) return
    setSaving(true)
    try {
      const current = new Date(editVehicle.regoExpiry)
      current.setFullYear(parseInt(editYear))
      const newExpiry = current.toISOString().split('T')[0]
      await axios.put(`${API}/api/fleet/${editVehicle.plate}`,
        { regoExpiry: newExpiry },
        { headers: { 'x-owner-email': user?.email || '' } }
      )
      setVehicles(prev => prev.map(v => v._id === editVehicle._id ? { ...v, regoExpiry: newExpiry } : v))
      showToast(`✅ ${editVehicle.plate} updated`)
      setEditVehicle(null)
    } catch { showToast('❌ Failed to update') }
    setSaving(false)
  }

  const tabList: { key: RegoStatus; label: string }[] = [
    { key: 'in_stock', label: 'In stock' },
    { key: 'stolen',   label: 'Stolen' },
    { key: 'sold',     label: 'Sold' },
  ]

  const filtered  = vehicles.filter(v => (v.regoStatus || 'in_stock') === activeTab)
  const grouped   = groupByMonth(filtered)

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text-primary shadow-lg">{toast}</div>
      )}

      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-surface flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Rego management</h1>
          <p className="text-text-muted text-sm mt-0.5">Scan a rego photo — Gemini extracts details, photo stored in database</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          {scanning ? 'Scanning...' : 'Scan rego photo'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b border-border flex px-6">
        {tabList.map(t => {
          const count = vehicles.filter(v => (v.regoStatus || 'in_stock') === t.key).length
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === t.key ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              {t.label}
              <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === t.key ? 'bg-accent-bg text-accent' : 'bg-surface2 text-text-muted'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-6 space-y-4">
        {loading ? (
          <p className="text-text-muted text-sm text-center py-12">Loading...</p>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-20 text-text-muted text-sm">No vehicles in this category yet</div>
        ) : (
          Object.entries(grouped).map(([key, list]) => {
            const [yr, mo] = key.split('-')
            const monthLabel = `${MONTHS[parseInt(mo)]} ${yr}`
            const isCollapsed = collapsed[key]
            return (
              <div key={key} className="bg-surface border border-border rounded-xl overflow-hidden">
                <button onClick={() => toggleCollapse(key)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-surface2 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-text-primary">{monthLabel}</span>
                    <span className="text-xs bg-surface2 text-text-muted px-2.5 py-0.5 rounded-full">
                      {list.length} vehicle{list.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                    className={`w-4 h-4 text-text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>

                {!isCollapsed && (
                  <table className="w-full text-sm border-t border-border">
                    <thead>
                      <tr className="bg-surface2 border-b border-border">
                        {['Plate','Year','Rego expiry','Rego photo','Notes','Status',''].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-medium uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {list.map(v => {
                        const col = expiryColor(v.regoExpiry)
                        return (
                          <tr key={v._id} className="hover:bg-surface2 transition-colors">
                            <td className="px-4 py-3">
                              <span className="font-mono text-xs bg-surface2 border border-border px-2 py-1 rounded font-medium text-text-primary">{v.plate}</span>
                            </td>
                            <td className="px-4 py-3 text-text-secondary">{v.year || '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col.dot }} />
                                <span className="text-xs font-medium" style={{ color: col.text }}>{col.label}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {v.regoPhotoBase64 ? (
                                <button
                                  onClick={() => setPhotoModal(v.regoPhotoBase64!)}
                                  className="text-xs text-accent underline hover:no-underline"
                                >
                                  View photo
                                </button>
                              ) : (
                                <span className="text-xs text-text-muted italic">Not scanned</span>
                              )}
                            </td>
                            <td className="px-4 py-3 max-w-[140px]">
                              <span className="text-xs text-text-muted truncate block">{v.notes || '—'}</span>
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={v.regoStatus || 'in_stock'}
                                onChange={e => updateStatus(v, e.target.value as RegoStatus)}
                                className="text-xs bg-surface border border-border rounded-lg px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent"
                              >
                                <option value="in_stock">In stock</option>
                                <option value="stolen">Stolen</option>
                                <option value="sold">Sold</option>
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => { setEditVehicle(v); setEditYear(String(new Date(v.regoExpiry).getFullYear())) }}
                                className="text-xs text-text-muted hover:text-text-primary border border-border rounded-lg px-3 py-1.5 hover:border-accent transition-colors"
                              >Edit</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Photo viewer modal */}
      {photoModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4"
          onClick={() => setPhotoModal(null)}>
          <div className="max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <img src={`data:image/jpeg;base64,${photoModal}`} className="w-full rounded-2xl" />
            <button onClick={() => setPhotoModal(null)}
              className="mt-3 w-full py-2.5 bg-white/10 text-white rounded-xl text-sm hover:bg-white/20">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Gemini Confirm Popup */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-base font-semibold text-text-primary">Confirm rego details</h2>
              <span className="text-xs bg-accent-bg text-accent px-2 py-0.5 rounded-full">Gemini read</span>
            </div>
            <p className="text-text-muted text-xs mb-5">Check the details — edit anything wrong before saving.</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-muted mb-1 uppercase tracking-wide">Plate number</label>
                <input value={confirm.plate}
                  onChange={e => setConfirm(p => p ? { ...p, plate: e.target.value.toUpperCase() } : p)}
                  className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1 uppercase tracking-wide">Year</label>
                  <input value={confirm.year}
                    onChange={e => setConfirm(p => p ? { ...p, year: e.target.value } : p)}
                    className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1 uppercase tracking-wide">Rego expiry</label>
                  <input type="date" value={confirm.regoExpiry}
                    onChange={e => setConfirm(p => p ? { ...p, regoExpiry: e.target.value } : p)}
                    className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1 uppercase tracking-wide">Notes (optional)</label>
                <input value={confirm.notes}
                  onChange={e => setConfirm(p => p ? { ...p, notes: e.target.value } : p)}
                  placeholder="Add a note..."
                  className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
              </div>
              {confirm.photoBase64 && (
                <img src={`data:image/jpeg;base64,${confirm.photoBase64}`}
                  className="w-full rounded-lg object-cover max-h-32" />
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setConfirm(null)}
                className="flex-1 py-2.5 border border-border rounded-xl text-sm text-text-muted hover:text-text-primary transition-colors">
                Cancel
              </button>
              <button onClick={confirmSave} disabled={saving}
                className="flex-1 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : 'Save to dashboard'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Year Popup */}
      {editVehicle && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-xs p-6">
            <h2 className="text-base font-semibold text-text-primary mb-1">Edit rego expiry</h2>
            <p className="text-text-muted text-xs mb-5">
              Plate <span className="font-mono font-medium text-text-primary">{editVehicle.plate}</span> — update year after renewal.
            </p>
            <div>
              <label className="block text-xs text-text-muted mb-1 uppercase tracking-wide">New expiry year</label>
              <input type="number" value={editYear}
                onChange={e => setEditYear(e.target.value)}
                min="2024" max="2035"
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent"
              />
              <p className="text-xs text-text-muted mt-1.5">Day and month stay the same — only year changes.</p>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditVehicle(null)}
                className="flex-1 py-2.5 border border-border rounded-xl text-sm text-text-muted hover:text-text-primary transition-colors">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}