import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

type Screen = 'home' | 'pin' | 'selfie' | 'service-form' | 'success'
type Action = 'in' | 'out' | 'service'
type NavPage = 'home' | 'services' | 'history'

interface Employee { _id: string; name: string }
interface ServiceRecord {
  _id: string
  plate: string
  serviceType: string
  description: string
  cost?: number
  employeeName: string
  customerName?: string
  customerPhone?: string
  notes?: string
  vehicleCategory?: string
  vehicleType?: string
  date: string
  status: 'pending' | 'done'
  completedAt?: string
}

const SERVICE_TYPES = [
  { value: 'oil_change', label: 'Oil Change' },
  { value: 'tyres', label: 'Tyres' },
  { value: 'brakes', label: 'Brakes' },
  { value: 'general', label: 'General Service' },
  { value: 'other', label: 'Other' },
]

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}
function isToday(d: string) {
  const now = new Date(); const date = new Date(d)
  return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
}

export default function TabletPage() {
  const [dark, setDark] = useState(() => localStorage.getItem('fleetai_tablet_theme') !== 'light')
  const [ownerId, setOwnerId] = useState<string | null>(() => localStorage.getItem('fleetai_tablet_email'))
  const [navPage, setNavPage] = useState<NavPage>('home')
  const [screen, setScreen] = useState<Screen>('home')
  const [action, setAction] = useState<Action>('in')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [allRecords, setAllRecords] = useState<ServiceRecord[]>([])
  const [successMsg, setSuccessMsg] = useState('')
  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null)
  const [selfiePreview, setSelfiePreview] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [plateError, setPlateError] = useState('')

  // Services page state
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'week' | 'custom'>('today')
  const [customDate, setCustomDate] = useState('')
  const [search, setSearch] = useState('')
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null)

  const [serviceForm, setServiceForm] = useState({
    vehicleCategory: 'rental', vehicleType: 'scooter', plate: '',
    customerName: '', customerPhone: '', serviceType: 'general',
    description: '', kilometres: '',
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ownerFromUrl = params.get('owner')
    if (ownerFromUrl) {
      localStorage.setItem('fleetai_tablet_email', ownerFromUrl)
      setOwnerId(ownerFromUrl)
      window.history.replaceState({}, '', '/tablet')
    }
  }, [])

  const fetchRecords = useCallback(async (dateParams?: { date?: string; from?: string; to?: string }) => {
    if (!ownerId) return
    try {
      const params: any = { ownerId, ...dateParams }
      const { data } = await axios.get(`${API}/api/employees/service-records`, { params })
      setAllRecords(data || [])
    } catch { console.error('Failed to fetch records') }
  }, [ownerId])

  useEffect(() => {
    if (!ownerId) return
    fetchRecords()
    const interval = setInterval(() => fetchRecords(), 30000)
    return () => clearInterval(interval)
  }, [ownerId, fetchRecords])

  useEffect(() => {
    if (navPage !== 'services') return
    fetchRecords(getDateParams())
  }, [navPage, dateFilter, customDate])

  function getDateParams(): { date?: string; from?: string; to?: string } {
    const today = new Date().toISOString().split('T')[0]
    if (dateFilter === 'today') return { date: today }
    if (dateFilter === 'yesterday') {
      const y = new Date(); y.setDate(y.getDate() - 1)
      return { date: y.toISOString().split('T')[0] }
    }
    if (dateFilter === 'week') {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
      return { from: weekAgo.toISOString().split('T')[0], to: today }
    }
    if (dateFilter === 'custom' && customDate) return { date: customDate }
    return { date: today }
  }

  useEffect(() => {
    if (screen !== 'selfie') { stopCamera(); return }
    setSelfieBlob(null); setSelfiePreview(''); setCameraError('')
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => { streamRef.current = stream; if (videoRef.current) videoRef.current.srcObject = stream })
      .catch(() => setCameraError('Camera access denied. Please allow camera and refresh.'))
    return () => stopCamera()
  }, [screen])

  function toggleTheme() {
    const next = !dark; setDark(next)
    localStorage.setItem('fleetai_tablet_theme', next ? 'dark' : 'light')
  }
  function stopCamera() { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null }
  function takeSelfie() {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0)
    canvas.toBlob(blob => { if (!blob) return; setSelfieBlob(blob); setSelfiePreview(URL.createObjectURL(blob)) }, 'image/jpeg', 0.85)
  }
  function retakeSelfie() { setSelfieBlob(null); setSelfiePreview('') }
  function goHome() {
    setScreen('home'); setPin(''); setPinError(''); setEmployee(null)
    setSelfieBlob(null); setSelfiePreview(''); setSuccessMsg(''); setSubmitAttempted(false)
    setServiceForm({ vehicleCategory: 'rental', vehicleType: 'scooter', plate: '', customerName: '', customerPhone: '', serviceType: 'general', description: '', kilometres: '' })
    if (countdownRef.current) clearTimeout(countdownRef.current)
  }
  function showSuccess(msg: string, record?: ServiceRecord) {
    setSuccessMsg(msg)
    if (record) setAllRecords(prev => [record, ...prev])
    setScreen('success')
    countdownRef.current = setTimeout(goHome, 4000)
  }
  function handlePinKey(digit: string) { if (pin.length >= 4) return; setPin(p => p + digit); setPinError('') }
  function handlePinDelete() { setPin(p => p.slice(0, -1)) }

  async function submitPin() {
    if (pin.length !== 4) return
    setSubmitting(true); setPinError('')
    try {
      const { data } = await axios.post(`${API}/api/employees/verify-pin`, { pin, ownerId })
      setEmployee(data.employee)
      if (action === 'service') setScreen('service-form')
      else setScreen('selfie')
    } catch { setPinError('Wrong PIN. Try again.'); setPin('') }
    finally { setSubmitting(false) }
  }

  async function submitClockAction() {
    if (!employee || !selfieBlob || !ownerId) return
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('selfie', selfieBlob, 'selfie.jpg')
      fd.append('employeeId', employee._id)
      fd.append('employeeName', employee.name)
      fd.append('type', action)
      fd.append('ownerId', ownerId)
      await axios.post(`${API}/api/employees/clock`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      showSuccess(action === 'in' ? `Welcome, ${employee.name}! Clocked in.` : `See you, ${employee.name}! Clocked out.`)
    } catch { setPinError('Failed to record. Please try again.'); setScreen('selfie') }
    finally { setSubmitting(false) }
  }

  async function validatePlate(plate: string) {
    if (serviceForm.vehicleCategory !== 'personal' || !plate) { setPlateError(''); return }
    try {
      await axios.get(`${API}/api/fleet/${plate}`, { headers: { 'x-owner-email': ownerId } })
      setPlateError('')
    } catch {
      setPlateError('This vehicle is not registered in the system')
    }
  }

  async function submitService() {
    setSubmitAttempted(true)
    if (!employee || !ownerId) return
    if (!serviceForm.plate || !serviceForm.description) return
    if (plateError) return
    setSubmitting(true)
    try {
      const { data } = await axios.post(`${API}/api/employees/log-service`, { pin, ownerId, ...serviceForm })
      showSuccess(`Service logged by ${employee.name}.`, data)
      fetchRecords()
    } catch { setPinError('Failed to save. Please try again.') }
    finally { setSubmitting(false) }
  }


  const todayRecords = allRecords.filter(r => isToday(r.date))
  const filteredRecords = allRecords
    .filter(r => !search || r.plate.toLowerCase().includes(search.toLowerCase()) || (r.customerName || '').toLowerCase().includes(search.toLowerCase()))

  const d = dark
  const T = {
    bg: d ? 'bg-gray-950' : 'bg-gray-50',
    text: d ? 'text-white' : 'text-gray-900',
    muted: d ? 'text-white/40' : 'text-gray-400',
    subtext: d ? 'text-white/70' : 'text-gray-600',
    border: d ? 'border-white/10' : 'border-gray-200',
    card: d ? 'bg-white/5 border border-white/10' : 'bg-white border border-gray-200',
    input: d ? 'bg-white/5 border-white/10 text-white placeholder:text-white/20' : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400',
    select: d ? 'bg-gray-900 border-white/10 text-white' : 'bg-white border-gray-300 text-gray-900',
    btnGhost: d ? 'bg-white/10 border border-white/20 text-white hover:bg-white/15' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50',
    pinBtn: d ? 'bg-white/10 text-white hover:bg-white/20 active:bg-white/30' : 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50 active:bg-gray-100',
    pinDot: (filled: boolean) => filled ? 'bg-indigo-500' : (d ? 'bg-white/20' : 'bg-gray-300'),
    toggleBg: d ? 'bg-white/10 text-yellow-300 hover:bg-white/20' : 'bg-gray-200 text-gray-500 hover:bg-gray-300',
    sidebar: 'bg-[#1a1a2e]',
    sidebarIcon: 'rgba(255,255,255,0.45)',
    sidebarIconActive: '#a5b4fc',
    chip: (active: boolean) => active
      ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-500 dark:text-indigo-300'
      : (d ? 'bg-white/5 border-white/10 text-white/50' : 'bg-white border-gray-200 text-gray-500'),
  }

  if (!ownerId) return (
    <div className={`min-h-screen ${T.bg} flex flex-col items-center justify-center px-6`}>
      <h1 className={`${T.text} text-xl font-bold mb-2`}>Tablet not linked</h1>
      <p className={`${T.muted} text-sm text-center`}>Open the tablet link from your FleetAI dashboard.</p>
    </div>
  )

  return (
    <div className={`min-h-screen ${T.bg} ${T.text} flex`}>

      {/* Sidebar */}
      <div className={`${T.sidebar} w-16 flex flex-col items-center py-4 gap-1 flex-shrink-0 select-none`}>
        <div className="w-9 h-9 rounded-xl bg-indigo-500/20 flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#818CF8"/></svg>
        </div>

        {/* Home nav */}
        <button onClick={() => { setNavPage('home'); goHome() }}
          className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${navPage === 'home' ? 'bg-indigo-500/25' : 'hover:bg-white/8'}`}>
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke={navPage === 'home' ? T.sidebarIconActive : T.sidebarIcon} strokeWidth={2}>
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span style={{ fontSize: 9, color: navPage === 'home' ? T.sidebarIconActive : 'rgba(255,255,255,0.4)' }}>Home</span>
        </button>

        {/* Services nav */}
        <button onClick={() => setNavPage('services')}
          className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${navPage === 'services' ? 'bg-indigo-500/25' : 'hover:bg-white/8'}`}>
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke={navPage === 'services' ? T.sidebarIconActive : T.sidebarIcon} strokeWidth={2}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/>
          </svg>
          <span style={{ fontSize: 9, color: navPage === 'services' ? T.sidebarIconActive : 'rgba(255,255,255,0.4)' }}>Services</span>
        </button>
      {/* History nav */}
        <button onClick={() => setNavPage('history')}
          className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${navPage === 'history' ? 'bg-indigo-500/25' : 'hover:bg-white/8'}`}>
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke={navPage === 'history' ? T.sidebarIconActive : T.sidebarIcon} strokeWidth={2}>
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          <span style={{ fontSize: 9, color: navPage === 'history' ? T.sidebarIconActive : 'rgba(255,255,255,0.4)' }}>History</span>
        </button>
        </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className={`flex items-center justify-between px-5 py-3.5 border-b ${T.border} flex-shrink-0`}>
          <p className={`text-sm font-medium ${T.text}`}>{navPage === 'home' ? 'Employee Portal' : navPage === 'services' ? 'Service History' : 'Service Search'}</p>
          <div className="flex items-center gap-3">
            <button onClick={toggleTheme} className={`w-8 h-8 rounded-xl flex items-center justify-center text-base ${T.toggleBg}`}>
              {dark ? '☀️' : '🌙'}
            </button>
            <Clock dark={dark} />
          </div>
        </div>

        {/* ── HOME PAGE ── */}
        {navPage === 'home' && (
          <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-6 py-8">

            {screen === 'home' && (
              <div className="w-full max-w-sm space-y-3">
                <div className="text-center mb-6">
                  <h1 className="text-2xl font-bold">Welcome</h1>
                  <p className={`${T.muted} text-sm mt-1`}>What would you like to do?</p>
                </div>
                <button onClick={() => { setAction('in'); setScreen('pin') }}
                  className="w-full py-5 bg-indigo-500 text-white rounded-2xl font-semibold text-lg hover:bg-indigo-600 active:scale-95 transition-all">
                  🟢 Clock In
                </button>
                <button onClick={() => { setAction('out'); setScreen('pin') }}
                  className={`w-full py-5 rounded-2xl font-semibold text-lg active:scale-95 transition-all ${T.btnGhost}`}>
                  🔴 Clock Out
                </button>
                <button onClick={() => { setAction('service'); setScreen('pin') }}
                  className={`w-full py-5 rounded-2xl font-semibold text-lg active:scale-95 transition-all ${T.btnGhost}`}>
                  🔧 Log Service
                </button>

                {todayRecords.length > 0 && (
                  <div className={`mt-4 rounded-2xl overflow-hidden ${T.card}`}>
                    <div className={`px-4 py-2.5 border-b ${T.border}`}>
                      <p className="text-sm font-medium">Today's services ({todayRecords.length})</p>
                    </div>
                    {todayRecords.slice(0, 4).map(r => (
                      <div key={r._id} className={`px-4 py-2.5 border-b ${T.border} last:border-0 flex items-center gap-3`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{r.plate} · {SERVICE_TYPES.find(s => s.value === r.serviceType)?.label}</p>
                          <p className={`text-xs ${T.muted}`}>{fmtTime(r.date)}</p>
                        </div>
                        {r.cost ? <p className="text-sm font-medium text-indigo-400">${r.cost}</p> : null}
                      </div>
                    ))}
                    {todayRecords.length > 4 && (
                      <button onClick={() => setNavPage('services')} className={`w-full py-2 text-xs text-indigo-400 border-t ${T.border}`}>
                        View all {todayRecords.length} records →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {screen === 'pin' && (
              <div className="w-full max-w-xs text-center">
                <button onClick={goHome} className={`flex items-center gap-1 ${T.muted} text-sm mb-6 hover:opacity-70 mx-auto`}>← Back</button>
                <h2 className="text-xl font-bold mb-1">Enter PIN</h2>
                <p className={`${T.muted} text-sm mb-8`}>{action === 'in' ? 'Clock In' : action === 'out' ? 'Clock Out' : 'Log Service'}</p>
                <div className="flex justify-center gap-4 mb-8">
                  {[0,1,2,3].map(i => <div key={i} className={`w-4 h-4 rounded-full transition-all ${T.pinDot(pin.length > i)}`} />)}
                </div>
                {pinError && <p className="text-red-400 text-sm mb-4">{pinError}</p>}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
                    <button key={i} onClick={() => k === '⌫' ? handlePinDelete() : k ? handlePinKey(k) : null}
                      disabled={submitting || !k}
                      className={`h-16 rounded-2xl text-xl font-semibold transition-all active:scale-95 ${k ? T.pinBtn : 'opacity-0 pointer-events-none'}`}>
                      {k}
                    </button>
                  ))}
                </div>
                <button onClick={submitPin} disabled={pin.length !== 4 || submitting}
                  className="w-full py-4 bg-indigo-500 text-white rounded-2xl font-semibold disabled:opacity-30 hover:bg-indigo-600 active:scale-95 transition-all">
                  {submitting ? 'Checking...' : 'Continue →'}
                </button>
              </div>
            )}

            {screen === 'selfie' && (
              <div className="w-full max-w-sm text-center">
                <button onClick={goHome} className={`flex items-center gap-1 ${T.muted} text-sm mb-4 hover:opacity-70 mx-auto`}>← Cancel</button>
                <h2 className="text-xl font-bold mb-6">{action === 'in' ? 'Clock In' : 'Clock Out'}</h2>
                {cameraError && <p className="text-red-400 text-sm mb-4">{cameraError}</p>}
                {selfiePreview
                  ? <div className="rounded-2xl overflow-hidden mb-4"><img src={selfiePreview} className="w-full" /></div>
                  : <div className="rounded-2xl overflow-hidden mb-4 bg-black aspect-[3/4]"><video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" /></div>
                }
                {pinError && <p className="text-red-400 text-sm mb-4">{pinError}</p>}
                {selfiePreview ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={retakeSelfie} className={`py-4 rounded-2xl font-semibold ${T.btnGhost}`}>Retake</button>
                    <button onClick={submitClockAction} disabled={submitting}
                      className="py-4 bg-indigo-500 text-white rounded-2xl font-semibold disabled:opacity-30">
                      {submitting ? 'Saving...' : action === 'in' ? 'Confirm In ✓' : 'Confirm Out ✓'}
                    </button>
                  </div>
                ) : !cameraError ? (
                  <button onClick={takeSelfie} className={`w-full py-4 rounded-2xl font-semibold ${T.btnGhost}`}>📸 Take Photo</button>
                ) : null}
              </div>
            )}

            {screen === 'service-form' && (
              <div className="w-full max-w-lg">
                <button onClick={goHome} className={`flex items-center gap-1 ${T.muted} text-sm mb-4 hover:opacity-70`}>← Cancel</button>
                <h2 className="text-xl font-bold mb-1">Log Service</h2>
                <p className={`${T.muted} text-sm mb-6`}>Logged by <span className={T.subtext}>{employee?.name}</span></p>
                {pinError && <p className="text-red-400 text-sm mb-4">{pinError}</p>}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`block text-xs ${T.muted} mb-1.5`}>Vehicle Category</label>
                      <select value={serviceForm.vehicleCategory} onChange={e => setServiceForm(f => ({ ...f, vehicleCategory: e.target.value }))}
                        className={`w-full border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-indigo-500 ${T.select}`}>
                        <option value="rental">Rental Fleet</option>
                        <option value="personal">Personal</option>
                      </select>
                    </div>
                    <div>
                      <label className={`block text-xs ${T.muted} mb-1.5`}>Vehicle Type</label>
                      <select value={serviceForm.vehicleType} onChange={e => setServiceForm(f => ({ ...f, vehicleType: e.target.value }))}
                        className={`w-full border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-indigo-500 ${T.select}`}>
                        <option value="scooter">Scooter</option>
                        <option value="car">Car</option>
                        <option value="e-bike">E-Bike</option>
                      </select>
                    </div>
                  </div>
                  <TField label="Plate Number *" value={serviceForm.plate} T={T}
                    onChange={v => { setServiceForm(f => ({ ...f, plate: v.toUpperCase() })); setPlateError('') }}
                    onBlur={() => validatePlate(serviceForm.plate)}
                    placeholder="e.g. ABC123" error={submitAttempted && !serviceForm.plate} />
                  {plateError && <p className="text-red-400 text-xs -mt-2">{plateError}</p>}
                  <div className="grid grid-cols-2 gap-3">
                    <TField label="Customer Name" value={serviceForm.customerName} T={T} onChange={v => setServiceForm(f => ({ ...f, customerName: v }))} />
                    <TField label="Customer Phone" value={serviceForm.customerPhone} T={T} type="tel" onChange={v => setServiceForm(f => ({ ...f, customerPhone: v }))} />
                  </div>
                  
                  <div>
                    <label className={`block text-xs ${T.muted} mb-1.5`}>Description *</label>
                    <textarea value={serviceForm.description} onChange={e => setServiceForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="What was done?" rows={3}
                      className={`w-full border rounded-xl px-3 py-3 text-sm focus:outline-none resize-none focus:border-indigo-500 ${T.input} ${submitAttempted && !serviceForm.description ? 'border-red-500' : ''}`} />
                    {submitAttempted && !serviceForm.description && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>
                  <TField label="Kilometres (km)" value={serviceForm.kilometres} T={T} type="number" onChange={v => setServiceForm(f => ({ ...f, kilometres: v }))} placeholder="0" />
                </div>
                <button onClick={submitService} disabled={submitting}
                  className="w-full mt-6 py-4 bg-indigo-500 text-white rounded-2xl font-semibold text-lg disabled:opacity-30 hover:bg-indigo-600 active:scale-95 transition-all">
                  {submitting ? 'Saving...' : 'Submit Service Record ✓'}
                </button>
              </div>
            )}

            {screen === 'success' && (
              <div className="text-center">
                <div className="text-7xl mb-6">✅</div>
                <h2 className="text-2xl font-bold mb-3">{successMsg}</h2>
                <p className={`${T.muted} text-sm`}>Returning to home in 4 seconds...</p>
                <button onClick={goHome} className="mt-6 text-indigo-400 text-sm">Go now →</button>
              </div>
            )}
          </div>
        )}

        {/* ── SERVICES PAGE ── */}
        {navPage === 'services' && (
          <div className="flex-1 overflow-y-auto px-5 py-4">

            {/* Stats */}
            <div className="mb-4">
              <div className={`rounded-xl p-3 text-center ${T.card}`}>
                <p className="text-2xl font-bold">{todayRecords.length}</p>
                <p className={`text-xs ${T.muted} mt-1`}>Today total</p>
              </div>
            </div>

            {/* Date filter */}
            <div className="flex gap-2 mb-3 flex-wrap">
              {(['today', 'yesterday', 'week'] as const).map(f => (
                <button key={f} onClick={() => setDateFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    dateFilter === f
                      ? 'bg-indigo-500/20 border-indigo-400 text-indigo-400'
                      : `border ${T.border} ${T.muted}`
                  }`}>
                  {f === 'today' ? 'Today' : f === 'yesterday' ? 'Yesterday' : 'Last 7 days'}
                </button>
              ))}
              <input type="date" value={customDate}
                onChange={e => { setCustomDate(e.target.value); setDateFilter('custom') }}
                className={`text-xs px-3 py-1.5 rounded-full border focus:outline-none ${T.border} ${T.select} ${dateFilter === 'custom' ? 'border-indigo-400' : ''}`} />
            </div>

            {/* Search */}
            <div className="flex gap-2 mb-4">
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search plate or customer..."
                className={`flex-1 text-xs px-3 py-1.5 rounded-full border focus:outline-none ${T.input} ${T.border}`} />
            </div>

            {/* Records */}
            {filteredRecords.length === 0 ? (
              <p className={`text-center py-12 text-sm ${T.muted}`}>No service records found</p>
            ) : (
              <div className="space-y-2">
                {filteredRecords.map(r => (
                  <div key={r._id} className={`rounded-xl overflow-hidden ${T.card}`}>
                    <div className="px-4 py-3 cursor-pointer" onClick={() => setExpandedRecord(expandedRecord === r._id ? null : r._id)}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${T.card}`}>{r.plate}</span>
                            <span className="text-sm font-medium">{SERVICE_TYPES.find(s => s.value === r.serviceType)?.label || r.serviceType}</span>
                          </div>
                          <p className={`text-xs ${T.muted} mt-0.5`}>
                            {r.employeeName} · {r.customerName || '—'} · {fmtDate(r.date)} · {fmtTime(r.date)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {r.cost ? <p className="text-sm font-semibold text-indigo-400">${r.cost}</p> : null}
                          <span className={`text-xs ${T.muted}`}>{expandedRecord === r._id ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {expandedRecord === r._id && (
                        <div className={`mt-3 pt-3 border-t ${T.border} space-y-1.5`}>
                          {r.description && (
                            <div>
                              <p className={`text-xs font-medium ${T.muted} uppercase tracking-wide`}>Description</p>
                              <p className="text-sm mt-0.5">{r.description}</p>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3 mt-2">
                            {r.customerName && (
                              <div>
                                <p className={`text-xs font-medium ${T.muted} uppercase tracking-wide`}>Customer</p>
                                <p className="text-sm mt-0.5">{r.customerName}</p>
                                {r.customerPhone && <p className={`text-xs ${T.muted}`}>{r.customerPhone}</p>}
                              </div>
                            )}
                            {(r as any).kilometres && (
                              <div>
                                <p className={`text-xs font-medium ${T.muted} uppercase tracking-wide`}>Kilometres</p>
                                <p className="text-sm mt-0.5">{(r as any).kilometres} km</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            
          </div>
        )}

      {/* ── HISTORY PAGE ── */}
        {navPage === 'history' && (
          <HistorySearchPage ownerId={ownerId} T={T} />
        )}

      </div>
    </div>
  )
}

function HistorySearchPage({ ownerId, T }: { ownerId: string; T: Record<string, any> }) {
  const [plate, setPlate] = useState('')
  const [records, setRecords] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const SERVICE_LABELS: Record<string, string> = {
    oil_change: 'Oil Change', tyres: 'Tyres', brakes: 'Brakes', general: 'General Service', other: 'Other'
  }

  async function search() {
    if (!plate.trim()) return
    setLoading(true); setSearched(true)
    try {
      const { data } = await axios.get(`${API}/api/employees/service-records`, {
        params: { ownerId, plate: plate.trim().toUpperCase() }
      })
      setRecords(data || [])
    } catch { setRecords([]) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="flex gap-2 mb-4">
        <input
          value={plate}
          onChange={e => setPlate(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Enter plate e.g. ABC123..."
          className={`flex-1 border rounded-xl px-3 py-3 text-sm font-mono focus:outline-none focus:border-indigo-500 ${T.input}`}
        />
        <button onClick={search} disabled={loading}
          className="px-5 py-3 bg-indigo-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
          {loading ? '...' : 'Search'}
        </button>
      </div>

      {searched && !loading && records.length === 0 && (
        <div className={`rounded-xl p-8 text-center ${T.card}`}>
          <p className={`text-sm ${T.muted}`}>No service records for <span className="font-mono">{plate}</span></p>
        </div>
      )}

      {records.length > 0 && (
        <div className="space-y-2">
          <p className={`text-xs ${T.muted} mb-3`}>{records.length} records for <span className="font-mono">{plate}</span></p>
          {records.map(r => (
            <div key={r._id} className={`rounded-xl px-4 py-3 ${T.card}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">{SERVICE_LABELS[r.serviceType] || r.serviceType}</p>
                  <p className={`text-xs ${T.muted} mt-0.5`}>{r.description}</p>
                  <p className={`text-xs ${T.muted} mt-1`}>
                    {r.employeeName && `👤 ${r.employeeName}`}
                    {r.kilometres && ` · 📍 ${r.kilometres} km`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  {r.cost != null && <p className="text-sm font-semibold text-indigo-400">${r.cost}</p>}
                  <p className={`text-xs ${T.muted} mt-0.5`}>{new Date(r.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
function Clock({ dark }: { dark: boolean }) {
  const [time, setTime] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t) }, [])
  return <p className={`text-sm font-mono ${dark ? 'text-white/80' : 'text-gray-600'}`}>{time.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</p>
}

function TField({ label, value, onChange, onBlur, type = 'text', placeholder, error, T }: {
  label: string; value: string; onChange: (v: string) => void
  onBlur?: () => void; type?: string; placeholder?: string; error?: boolean; T: Record<string, any>
}) {
  return (
    <div>
      <label className={`block text-xs ${T.muted} mb-1.5`}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder}
        className={`w-full border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-indigo-500 ${T.input} ${error ? 'border-red-500' : ''}`} />
      {error && <p className="text-red-400 text-xs mt-1">Required</p>}
    </div>
  )
}
