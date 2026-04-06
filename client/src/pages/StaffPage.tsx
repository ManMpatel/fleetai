import { useEffect, useState } from 'react'
import axios from 'axios'

interface Employee {
  _id: string
  name: string
  pin: string
}

interface ClockRecord {
  _id: string
  employeeName: string
  type: 'in' | 'out'
  selfieUrl?: string
  time: string
}

interface ServiceRecord {
  _id: string
  plate: string
  employeeName: string
  customerName?: string
  customerPhone?: string
  serviceType: string
  description?: string
  cost?: number
  date: string
}

function fmt(d: string) {
  return new Date(d).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}
function isToday(d: string) {
  const now = new Date()
  const date = new Date(d)
  return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
}

export default function StaffPage() {
  const [employees, setEmployees]       = useState<Employee[]>([])
  const [clockRecords, setClockRecords] = useState<ClockRecord[]>([])
  const [serviceRecords, setServiceRecords] = useState<ServiceRecord[]>([])
  const [loading, setLoading]           = useState(true)
  const [tab, setTab]                   = useState<'clock' | 'service'>('clock')

  // form
  const [showForm, setShowForm]   = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName]   = useState('')
  const [formPin, setFormPin]     = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving]       = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
const [refreshing, setRefreshing] = useState(false)

  async function fetchAll(showSpinner = false) {
    if (showSpinner) setRefreshing(true)
    try {
      const [e, c, s] = await Promise.all([
        axios.get('/api/employees'),
        axios.get('/api/employees/clock-records'),
        axios.get('/api/service-records'),
      ])
      setEmployees(e.data || [])
      setClockRecords(c.data || [])
      setServiceRecords(s.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  // stats
  const todayClocks    = clockRecords.filter(r => isToday(r.time))
  const clockInsToday  = todayClocks.filter(r => r.type === 'in').length
  const clockOutsToday = todayClocks.filter(r => r.type === 'out').length
  const onShiftNow     = Math.max(0, clockInsToday - clockOutsToday)
  const servicesToday  = serviceRecords.filter(r => isToday(r.date)).length

  function openAdd() {
    setEditingId(null); setFormName(''); setFormPin(''); setFormError(''); setShowForm(true)
  }
  function openEdit(emp: Employee) {
    setEditingId(emp._id); setFormName(emp.name); setFormPin(emp.pin); setFormError(''); setShowForm(true)
  }
  function closeForm() {
    setShowForm(false); setEditingId(null); setFormName(''); setFormPin(''); setFormError('')
  }

  async function saveEmployee() {
    if (!formName.trim()) return setFormError('Name is required')
    if (!/^\d{4}$/.test(formPin)) return setFormError('PIN must be exactly 4 digits')
    setSaving(true); setFormError('')
    try {
      if (editingId) {
        const { data } = await axios.put(`/api/employees/${editingId}`, { name: formName.trim(), pin: formPin })
        setEmployees(prev => prev.map(e => e._id === editingId ? data : e))
      } else {
        const { data } = await axios.post('/api/employees', { name: formName.trim(), pin: formPin })
        setEmployees(prev => [...prev, data])
      }
      closeForm()
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEmployee(id: string) {
    if (!confirm('Delete this employee? Their clock records will remain.')) return
    setDeletingId(id)
    try {
      await axios.delete(`/api/employees/${id}`)
      setEmployees(prev => prev.filter(e => e._id !== id))
    } catch {
      alert('Failed to delete employee')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Staff</h1>
          <p className="text-sm text-text-muted mt-0.5">Manage employees, clock records and service logs</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          <span className="text-base leading-none">+</span> Add Employee
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'On shift now',     value: onShiftNow,        color: 'text-green-500',     sub: 'clocked in today' },
          { label: 'Clock-ins today',  value: clockInsToday,     color: 'text-accent',         sub: 'total check-ins' },
          { label: 'Services today',   value: servicesToday,     color: 'text-amber-500',      sub: 'logged services' },
          { label: 'Total employees',  value: employees.length,  color: 'text-text-primary',   sub: 'active staff' },
        ].map(c => (
          <div key={c.label} className="bg-surface border border-border rounded-xl p-5">
            <p className="text-xs text-text-muted mb-1">{c.label}</p>
            <p className={`text-3xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-text-muted mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Employee list */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Employees</h2>
          <span className="text-xs text-text-muted">{employees.length} total</span>
        </div>
        {employees.length === 0 ? (
          <div className="py-12 text-center text-text-muted text-sm">No employees yet. Add your first employee above.</div>
        ) : (
          <div className="divide-y divide-border">
            {employees.map(emp => (
              <div key={emp._id} className="flex items-center justify-between px-5 py-3.5 hover:bg-surface2 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                    <span className="text-accent font-semibold text-sm">{emp.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-primary">{emp.name}</p>
                    <p className="text-xs text-text-muted">PIN: ••••</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEdit(emp)}
                    className="px-3 py-1.5 text-xs border border-border rounded-lg text-text-secondary hover:border-accent hover:text-accent transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteEmployee(emp._id)}
                    disabled={deletingId === emp._id}
                    className="px-3 py-1.5 text-xs border border-border rounded-lg text-red-400 hover:border-red-400 transition-colors disabled:opacity-40"
                  >
                    {deletingId === emp._id ? '...' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clock log + Service records tabs */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border">
          {(['clock', 'service'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3.5 text-sm font-medium transition-colors ${
                tab === t ? 'text-accent border-b-2 border-accent -mb-px' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t === 'clock' ? `Clock Log (${clockRecords.length})` : `Service Records (${serviceRecords.length})`}
            </button>
          ))}
          <div className="ml-auto flex items-center pr-3">
            <button
              onClick={() => fetchAll(true)}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs border border-border rounded-lg text-text-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              {refreshing ? '...' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* Clock tab */}
        {tab === 'clock' && (
          clockRecords.length === 0 ? (
            <div className="py-12 text-center text-text-muted text-sm">No clock records yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Employee', 'Type', 'Time', 'Date', 'Selfie'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs text-text-muted font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clockRecords.map(r => (
                    <tr key={r._id} className="border-b border-border last:border-0 hover:bg-surface2">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                            <span className="text-accent text-xs font-semibold">{r.employeeName.charAt(0).toUpperCase()}</span>
                          </div>
                          <span className="font-medium text-text-primary">{r.employeeName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.type === 'in' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-400'
                        }`}>
                          {r.type === 'in' ? '● Clock In' : '● Clock Out'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-text-primary font-medium">{fmt(r.time)}</td>
                      <td className="px-5 py-3 text-text-muted">{fmtDate(r.time)}</td>
                      <td className="px-5 py-3">
                        {r.selfieUrl ? (
                          <a href={r.selfieUrl} target="_blank" rel="noopener noreferrer" className="text-accent text-xs hover:underline">
                            View photo →
                          </a>
                        ) : (
                          <span className="text-text-muted text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Service tab */}
        {tab === 'service' && (
          serviceRecords.length === 0 ? (
            <div className="py-12 text-center text-text-muted text-sm">No service records yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Employee', 'Plate', 'Service', 'Customer', 'Cost', 'Date'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs text-text-muted font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {serviceRecords.map(r => (
                    <tr key={r._id} className="border-b border-border last:border-0 hover:bg-surface2">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                            <span className="text-accent text-xs font-semibold">{(r.employeeName || '?').charAt(0).toUpperCase()}</span>
                          </div>
                          <span className="text-text-primary font-medium">{r.employeeName || '—'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs bg-surface2 border border-border px-2 py-0.5 rounded text-text-primary">
                          {r.plate || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-text-primary capitalize">{r.serviceType}</p>
                        {r.description && <p className="text-xs text-text-muted truncate max-w-[180px]">{r.description}</p>}
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-text-primary">{r.customerName || '—'}</p>
                        {r.customerPhone && <p className="text-xs text-text-muted">{r.customerPhone}</p>}
                      </td>
                      <td className="px-5 py-3 text-text-primary font-medium">
                        {r.cost != null ? `$${r.cost.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-5 py-3 text-text-muted">{fmtDate(r.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Add/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeForm}>
          <div className="bg-surface border border-border rounded-2xl w-full max-w-sm p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-text-primary mb-5">
              {editingId ? 'Edit Employee' : 'Add Employee'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Full name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. John Smith"
                  autoFocus
                  className="w-full px-3 py-2.5 bg-surface2 border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">4-digit PIN</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={formPin}
                  onChange={e => setFormPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="e.g. 1234"
                  className="w-full px-3 py-2.5 bg-surface2 border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono tracking-widest"
                />
                <p className="text-xs text-text-muted mt-1">Employee uses this PIN on the tablet to clock in/out</p>
              </div>
              {formError && <p className="text-xs text-red-400">{formError}</p>}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={closeForm}
                className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm text-text-secondary hover:bg-surface2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEmployee}
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Add employee'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}