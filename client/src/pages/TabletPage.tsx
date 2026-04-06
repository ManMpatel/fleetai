import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

type Screen = 'home' | 'pin' | 'selfie' | 'service-form' | 'success'
type Action = 'in' | 'out' | 'service'

interface Employee { _id: string; name: string }
interface ServiceRecord {
  _id: string; plate: string; serviceType: string
  description: string; cost?: number; employeeName: string; date: string
}

const SERVICE_TYPES = [
  { value: 'oil_change', label: 'Oil Change' },
  { value: 'tyres',      label: 'Tyres' },
  { value: 'brakes',     label: 'Brakes' },
  { value: 'general',    label: 'General Service' },
  { value: 'other',      label: 'Other' },
]

export default function TabletPage() {
  const [dark, setDark] = useState(() => localStorage.getItem('fleetai_tablet_theme') !== 'light')
  const [ownerId, setOwnerId] = useState<string | null>(() => localStorage.getItem('fleetai_tablet_email'))
  const [screen, setScreen] = useState<Screen>('home')
  const [action, setAction] = useState<Action>('in')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [todayRecords, setTodayRecords] = useState<ServiceRecord[]>([])
  const [successMsg, setSuccessMsg] = useState('')
  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null)
  const [selfiePreview, setSelfiePreview] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [serviceForm, setServiceForm] = useState({
    vehicleCategory: 'rental', vehicleType: 'scooter', plate: '',
    customerName: '', customerPhone: '', serviceType: 'general',
    description: '', cost: '', notes: '',
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Grab owner email from URL ?owner= param on first open
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ownerFromUrl = params.get('owner')
    if (ownerFromUrl) {
      localStorage.setItem('fleetai_tablet_email', ownerFromUrl)
      setOwnerId(ownerFromUrl)
      window.history.replaceState({}, '', '/tablet')
    }
  }, [])

  // Camera for selfie
  useEffect(() => {
    if (screen !== 'selfie') { stopCamera(); return }
    setSelfieBlob(null); setSelfiePreview(''); setCameraError('')
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => setCameraError('Camera access denied. Please allow camera and refresh.'))
    return () => stopCamera()
  }, [screen])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    localStorage.setItem('fleetai_tablet_theme', next ? 'dark' : 'light')
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function takeSelfie() {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      setSelfieBlob(blob)
      setSelfiePreview(URL.createObjectURL(blob))
    }, 'image/jpeg', 0.85)
  }

  function retakeSelfie() { setSelfieBlob(null); setSelfiePreview('') }

  function goHome() {
    setScreen('home'); setPin(''); setPinError(''); setEmployee(null)
    setSelfieBlob(null); setSelfiePreview(''); setSuccessMsg(''); setSubmitAttempted(false)
    setServiceForm({
      vehicleCategory: 'rental', vehicleType: 'scooter', plate: '',
      customerName: '', customerPhone: '', serviceType: 'general',
      description: '', cost: '', notes: '',
    })
    if (countdownRef.current) clearTimeout(countdownRef.current)
  }

  function showSuccess(msg: string, record?: ServiceRecord) {
    setSuccessMsg(msg)
    if (record) setTodayRecords(prev => [record, ...prev])
    setScreen('success')
    countdownRef.current = setTimeout(goHome, 4000)
  }

  function handlePinKey(digit: string) {
    if (pin.length >= 4) return
    setPin(p => p + digit); setPinError('')
  }

  function handlePinDelete() { setPin(p => p.slice(0, -1)) }

  async function submitPin() {
    if (pin.length !== 4) return
    setSubmitting(true); setPinError('')
    try {
      const { data } = await axios.post(`${API}/api/employees/verify-pin`, { pin, ownerId })
      setEmployee(data.employee)
      if (action === 'service') setScreen('service-form')
      else setScreen('selfie')
    } catch {
      setPinError('Wrong PIN. Try again.')
      setPin('')
    } finally { setSubmitting(false) }
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
    } catch {
      setPinError('Failed to record. Please try again.')
      setScreen('selfie')
    } finally { setSubmitting(false) }
  }

  async function submitService() {
    setSubmitAttempted(true)
    if (!employee || !ownerId) return
    if (!serviceForm.plate || !serviceForm.description) return
    setSubmitting(true)
    try {
      const { data } = await axios.post(`${API}/api/employees/log-service`, { pin, ownerId, ...serviceForm })
      showSuccess(`Service logged by ${employee.name}.`, data)
    } catch {
      setPinError('Failed to save. Please try again.')
    } finally { setSubmitting(false) }
  }

  // Theme object
  const d = dark
  const T = {
    bg:          d ? 'bg-gray-950'           : 'bg-gray-50',
    text:        d ? 'text-white'            : 'text-gray-900',
    muted:       d ? 'text-white/40'         : 'text-gray-400',
    subtext:     d ? 'text-white/70'         : 'text-gray-600',
    border:      d ? 'border-white/10'       : 'border-gray-200',
    card:        d ? 'bg-white/5 border border-white/10' : 'bg-white border border-gray-200',
    input:       d ? 'bg-white/5 border-white/10 text-white placeholder:text-white/20' : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400',
    select:      d ? 'bg-gray-900 border-white/10 text-white' : 'bg-white border-gray-300 text-gray-900',
    btnGhost:    d ? 'bg-white/10 border border-white/20 text-white hover:bg-white/15' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50',
    pinBtn:      d ? 'bg-white/10 text-white hover:bg-white/20 active:bg-white/30' : 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50 active:bg-gray-100',
    pinDot:      (filled: boolean) => filled ? 'bg-indigo-500' : (d ? 'bg-white/20' : 'bg-gray-300'),
    toggleBg:    d ? 'bg-white/10 text-yellow-300 hover:bg-white/20' : 'bg-gray-200 text-gray-500 hover:bg-gray-300',
  }

  if (!ownerId) return (
    <div className={`min-h-screen ${T.bg} flex flex-col items-center justify-center px-6`}>
      <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center mb-6">
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#818CF8" /></svg>
      </div>
      <h1 className={`${T.text} text-xl font-bold mb-2`}>Tablet not linked</h1>
      <p className={`${T.muted} text-sm text-center`}>Open the tablet link from your FleetAI dashboard to activate this device.</p>
    </div>
  )

  return (
    <div className={`min-h-screen ${T.bg} ${T.text} select-none`}>

      {/* Header */}
      <div className={`flex items-center justify-between px-6 py-4 border-b ${T.border}`}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#818CF8" /></svg>
          </div>
          <span className="font-bold text-lg">Fleet<span className="text-indigo-400">AI</span></span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={toggleTheme} className={`w-9 h-9 rounded-xl flex items-center justify-center text-base transition-colors ${T.toggleBg}`} title="Toggle theme">
            {dark ? '☀️' : '🌙'}
          </button>
          <div className="text-right">
            <p className={`${T.muted} text-sm`}>Employee Portal</p>
            <Clock dark={dark} />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] px-6 py-8">

        {/* HOME */}
        {screen === 'home' && (
          <div className="w-full max-w-sm space-y-4">
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
              <div className={`mt-6 rounded-2xl overflow-hidden ${T.card}`}>
                <div className={`px-4 py-3 border-b ${T.border}`}>
                  <p className="text-sm font-semibold">Services this session ({todayRecords.length})</p>
                </div>
                {todayRecords.slice(0, 5).map(r => (
                  <div key={r._id} className={`px-4 py-3 border-b ${T.border} last:border-0 flex items-center justify-between`}>
                    <div>
                      <p className="text-sm font-medium">{r.plate} · {SERVICE_TYPES.find(s => s.value === r.serviceType)?.label || r.serviceType}</p>
                      <p className={`text-xs ${T.muted}`}>{r.employeeName} · {new Date(r.date).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    {r.cost ? <p className="text-sm font-semibold text-indigo-400">${r.cost}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PIN */}
        {screen === 'pin' && (
          <div className="w-full max-w-xs text-center">
            <button onClick={goHome} className={`flex items-center gap-1 ${T.muted} text-sm mb-6 hover:opacity-70 mx-auto`}>← Back</button>
            <h2 className="text-xl font-bold mb-1">Enter PIN</h2>
            <p className={`${T.muted} text-sm mb-8`}>{action === 'in' ? 'Clock In' : action === 'out' ? 'Clock Out' : 'Log Service'}</p>
            <div className="flex justify-center gap-4 mb-8">
              {[0,1,2,3].map(i => (
                <div key={i} className={`w-4 h-4 rounded-full transition-all ${T.pinDot(pin.length > i)}`} />
              ))}
            </div>
            {pinError && <p className="text-red-400 text-sm mb-4">{pinError}</p>}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
                <button key={i}
                  onClick={() => k === '⌫' ? handlePinDelete() : k ? handlePinKey(k) : null}
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

        {/* SELFIE */}
        {screen === 'selfie' && (
          <div className="w-full max-w-sm text-center">
            <button onClick={goHome} className={`flex items-center gap-1 ${T.muted} text-sm mb-4 hover:opacity-70 mx-auto`}>← Cancel</button>
            <h2 className="text-xl font-bold mb-1">{action === 'in' ? 'Clock In' : 'Clock Out'}</h2>
            <p className={`${T.muted} text-sm mb-6`}>Take a selfie to confirm</p>
            {cameraError && <p className="text-red-400 text-sm mb-4">{cameraError}</p>}
            {selfiePreview ? (
              <div className="rounded-2xl overflow-hidden mb-4"><img src={selfiePreview} className="w-full" /></div>
            ) : (
              <div className="rounded-2xl overflow-hidden mb-4 bg-black aspect-[3/4]">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
            )}
            {pinError && <p className="text-red-400 text-sm mb-4">{pinError}</p>}
            {selfiePreview ? (
              <div className="grid grid-cols-2 gap-3">
                <button onClick={retakeSelfie} className={`py-4 rounded-2xl font-semibold ${T.btnGhost}`}>Retake</button>
                <button onClick={submitClockAction} disabled={submitting}
                  className="py-4 bg-indigo-500 text-white rounded-2xl font-semibold disabled:opacity-30 hover:bg-indigo-600 active:scale-95 transition-all">
                  {submitting ? 'Saving...' : action === 'in' ? 'Confirm In ✓' : 'Confirm Out ✓'}
                </button>
              </div>
            ) : !cameraError ? (
              <button onClick={takeSelfie} className={`w-full py-4 rounded-2xl font-semibold ${T.btnGhost}`}>📸 Take Photo</button>
            ) : null}
          </div>
        )}

        {/* SERVICE FORM */}
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
                  <select value={serviceForm.vehicleCategory}
                    onChange={e => setServiceForm(f => ({ ...f, vehicleCategory: e.target.value }))}
                    className={`w-full border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-indigo-500 ${T.select}`}>
                    <option value="rental">Rental Fleet</option>
                    <option value="personal">Personal</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-xs ${T.muted} mb-1.5`}>Vehicle Type</label>
                  <select value={serviceForm.vehicleType}
                    onChange={e => setServiceForm(f => ({ ...f, vehicleType: e.target.value }))}
                    className={`w-full border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-indigo-500 ${T.select}`}>
                    <option value="scooter">Scooter</option>
                    <option value="car">Car</option>
                    <option value="e-bike">E-Bike</option>
                  </select>
                </div>
              </div>

              <TField label="Plate Number *" value={serviceForm.plate} T={T}
                onChange={v => setServiceForm(f => ({ ...f, plate: v.toUpperCase() }))}
                placeholder="e.g. ABC123"
                error={submitAttempted && !serviceForm.plate} />

              <div className="grid grid-cols-2 gap-3">
                <TField label="Customer Name" value={serviceForm.customerName} T={T}
                  onChange={v => setServiceForm(f => ({ ...f, customerName: v }))} />
                <TField label="Customer Phone" value={serviceForm.customerPhone} T={T} type="tel"
                  onChange={v => setServiceForm(f => ({ ...f, customerPhone: v }))} />
              </div>

              <div>
                <label className={`block text-xs ${T.muted} mb-1.5`}>Service Type</label>
                <select value={serviceForm.serviceType}
                  onChange={e => setServiceForm(f => ({ ...f, serviceType: e.target.value }))}
                  className={`w-full border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-indigo-500 ${T.select}`}>
                  {SERVICE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>

              <div>
                <label className={`block text-xs ${T.muted} mb-1.5`}>Description *</label>
                <textarea value={serviceForm.description}
                  onChange={e => setServiceForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What was done?" rows={3}
                  className={`w-full border rounded-xl px-3 py-3 text-sm focus:outline-none resize-none focus:border-indigo-500 ${T.input} ${submitAttempted && !serviceForm.description ? 'border-red-500' : ''}`} />
                {submitAttempted && !serviceForm.description && (
                  <p className="text-red-400 text-xs mt-1">Description is required</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <TField label="Cost ($)" value={serviceForm.cost} T={T} type="number"
                  onChange={v => setServiceForm(f => ({ ...f, cost: v }))} placeholder="0.00" />
                <TField label="Notes (optional)" value={serviceForm.notes} T={T}
                  onChange={v => setServiceForm(f => ({ ...f, notes: v }))} />
              </div>
            </div>

            <button onClick={submitService} disabled={submitting}
              className="w-full mt-6 py-4 bg-indigo-500 text-white rounded-2xl font-semibold text-lg disabled:opacity-30 hover:bg-indigo-600 active:scale-95 transition-all">
              {submitting ? 'Saving...' : 'Submit Service Record ✓'}
            </button>
          </div>
        )}

        {/* SUCCESS */}
        {screen === 'success' && (
          <div className="text-center">
            <div className="text-7xl mb-6">✅</div>
            <h2 className="text-2xl font-bold mb-3">{successMsg}</h2>
            <p className={`${T.muted} text-sm`}>Returning to home in 4 seconds...</p>
            <button onClick={goHome} className="mt-6 text-indigo-400 text-sm hover:text-indigo-300">Go now →</button>
          </div>
        )}

      </div>
    </div>
  )
}

function Clock({ dark }: { dark: boolean }) {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <p className={`text-sm font-mono ${dark ? 'text-white/80' : 'text-gray-600'}`}>
      {time.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
    </p>
  )
}

function TField({ label, value, onChange, type = 'text', placeholder, error, T }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string; error?: boolean; T: Record<string, any>
}) {
  return (
    <div>
      <label className={`block text-xs ${T.muted} mb-1.5`}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-indigo-500 ${T.input} ${error ? 'border-red-500' : ''}`} />
      {error && <p className="text-red-400 text-xs mt-1">This field is required</p>}
    </div>
  )
}