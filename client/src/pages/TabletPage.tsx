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
  const [ownerEmail, setOwnerEmail] = useState(() => localStorage.getItem('fleetai_tablet_email') || '')
  const [emailInput, setEmailInput] = useState('')
  const [setupDone, setSetupDone] = useState(() => !!localStorage.getItem('fleetai_tablet_email'))
  const [ownerId, setOwnerId] = useState<string | null>(() => localStorage.getItem('fleetai_tablet_email'))
  const [ownerName, setOwnerName] = useState('')
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
  const [serviceForm, setServiceForm] = useState({
    vehicleCategory: 'Rental Fleet', vehicleType: 'Scooter', plate: '',
    customerName: '', customerPhone: '', serviceType: 'general',
    description: '', cost: '', notes: '',
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function saveSetup() {
    const clean = emailInput.trim().toLowerCase()
    if (!clean || !clean.includes('@')) return
    localStorage.setItem('fleetai_tablet_email', clean)
    setOwnerEmail(clean)
    setOwnerId(clean)
    setSetupDone(true)
  }

  function resetSetup() {
    localStorage.removeItem('fleetai_tablet_email')
    setOwnerEmail('')
    setSetupDone(false)
    setOwnerId(null)
  }

 // No slug resolve needed — ownerId is the email directly
  useEffect(() => {
    if (!ownerEmail) return
    setOwnerId(ownerEmail)
  }, [ownerEmail])

  // Grab owner email from URL ?owner= param on first open
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ownerFromUrl = params.get('owner')
    if (ownerFromUrl) {
      localStorage.setItem('fleetai_tablet_email', ownerFromUrl)
      setOwnerEmail(ownerFromUrl)
      setOwnerId(ownerFromUrl)
      window.history.replaceState({}, '', '/tablet')
    }
  }, [])

  // Load today's service records
  useEffect(() => {
    if (!ownerId || ownerId === 'invalid') return
    // We fetch via the public log-service list — not available yet, skip for now
    // Will show after each successful submission via local state
  }, [ownerId])

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

  function retakeSelfie() {
    setSelfieBlob(null); setSelfiePreview('')
  }

  function goHome() {
    setScreen('home'); setPin(''); setPinError(''); setEmployee(null)
    setSelfieBlob(null); setSelfiePreview(''); setSuccessMsg('')
    setServiceForm({
      vehicleCategory: 'Rental Fleet', vehicleType: 'Scooter', plate: '',
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
      if (action === 'service') { setScreen('service-form') }
      else { setScreen('selfie') }
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
      await axios.post(`${API}/api/employees/clock`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      showSuccess(action === 'in'
        ? `Welcome, ${employee.name}! Clocked in successfully.`
        : `See you, ${employee.name}! Clocked out successfully.`
      )
    } catch {
      setPinError('Failed to record. Please try again.')
      setScreen('selfie')
    } finally { setSubmitting(false) }
  }

  async function submitService() {
    if (!employee || !ownerId) return
    if (!serviceForm.plate || !serviceForm.description) {
      setPinError('Plate and description are required.'); return
    }
    setSubmitting(true)
    try {
      const { data } = await axios.post(`${API}/api/employees/log-service`, {
        pin, ownerId, ...serviceForm,
      })
      showSuccess(`Service logged by ${employee.name}.`, data)
    } catch {
      setPinError('Failed to save. Please try again.')
    } finally { setSubmitting(false) }
  }

  // ── Render ──────────────────────────────────────────────

  if (!ownerId) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center mb-6">
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#818CF8" />
        </svg>
      </div>
      <h1 className="text-white text-xl font-bold mb-2">Tablet not linked</h1>
      <p className="text-white/40 text-sm text-center">Open the tablet link from your FleetAI dashboard to activate this device.</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white select-none overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#818CF8" />
            </svg>
          </div>
          <span className="font-bold text-lg">Fleet<span className="text-indigo-400">AI</span></span>
        </div>
        <div className="text-right">
          <p className="text-white/60 text-sm">{ownerName || 'Employee Portal'}</p>
          <Clock />
        </div>
      </div>

      {/* Screens */}
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] px-6 py-8">

        {/* ── HOME ── */}
        {screen === 'home' && (
          <div className="w-full max-w-lg">
            <h1 className="text-2xl font-bold text-center mb-2">Employee Portal</h1>
            <p className="text-white/40 text-center text-sm mb-10">Select an action to get started</p>

            <div className="grid grid-cols-3 gap-4 mb-10">
              {[
                { label: 'Clock In',    action: 'in'      as Action, color: 'bg-green-500/10 border-green-500/30 hover:bg-green-500/20',  icon: '🟢', textColor: 'text-green-400' },
                { label: 'Clock Out',   action: 'out'     as Action, color: 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20',        icon: '🔴', textColor: 'text-red-400' },
                { label: 'Log Service', action: 'service' as Action, color: 'bg-indigo-500/10 border-indigo-500/30 hover:bg-indigo-500/20', icon: '🔧', textColor: 'text-indigo-400' },
              ].map(btn => (
                <button
                  key={btn.action}
                  onClick={() => { setAction(btn.action); setScreen('pin') }}
                  className={`border rounded-2xl p-6 flex flex-col items-center gap-3 transition-all active:scale-95 ${btn.color}`}
                >
                  <span className="text-4xl">{btn.icon}</span>
                  <span className={`font-semibold text-sm ${btn.textColor}`}>{btn.label}</span>
                </button>
              ))}
            </div>

            {/* Today's service records */}
            {todayRecords.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <p className="text-xs text-white/40 uppercase tracking-wide font-medium mb-3">Today's Services</p>
                <div className="space-y-2">
                  {todayRecords.map(r => (
                    <div key={r._id} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium">{r.plate}</span>
                        <span className="text-white/40 ml-2">{r.description}</span>
                      </div>
                      <span className="text-white/40 text-xs">{r.employeeName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PIN ENTRY ── */}
        {screen === 'pin' && (
          <div className="w-full max-w-xs">
            <button onClick={goHome} className="flex items-center gap-1 text-white/40 text-sm mb-8 hover:text-white/60">
              ← Back
            </button>
            <h2 className="text-xl font-bold text-center mb-1">
              {action === 'in' ? 'Clock In' : action === 'out' ? 'Clock Out' : 'Log Service'}
            </h2>
            <p className="text-white/40 text-center text-sm mb-8">Enter your 4-digit PIN</p>

            {/* PIN dots */}
            <div className="flex justify-center gap-4 mb-8">
              {[0,1,2,3].map(i => (
                <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${
                  pin.length > i ? 'bg-indigo-400 border-indigo-400' : 'border-white/30'
                }`} />
              ))}
            </div>

            {pinError && (
              <p className="text-red-400 text-center text-sm mb-4">{pinError}</p>
            )}

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-3">
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
                <button
                  key={i}
                  onClick={() => k === '⌫' ? handlePinDelete() : k !== '' ? handlePinKey(k) : undefined}
                  disabled={submitting}
                  className={`h-16 rounded-2xl text-xl font-semibold transition-all active:scale-95 ${
                    k === '' ? 'pointer-events-none' :
                    k === '⌫' ? 'bg-white/5 text-white/40 hover:bg-white/10' :
                    'bg-white/10 hover:bg-white/15'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>

            <button
              onClick={submitPin}
              disabled={pin.length !== 4 || submitting}
              className="w-full mt-6 py-4 bg-indigo-500 rounded-2xl font-semibold text-lg disabled:opacity-30 hover:bg-indigo-600 active:scale-95 transition-all"
            >
              {submitting ? 'Checking...' : 'Continue →'}
            </button>
          </div>
        )}

        {/* ── SELFIE ── */}
        {screen === 'selfie' && (
          <div className="w-full max-w-sm">
            <button onClick={goHome} className="flex items-center gap-1 text-white/40 text-sm mb-6 hover:text-white/60">
              ← Cancel
            </button>
            <h2 className="text-xl font-bold text-center mb-1">Take a Selfie</h2>
            <p className="text-white/40 text-center text-sm mb-6">
              Hi {employee?.name}! Look at the camera and tap the button.
            </p>

            {cameraError ? (
              <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center text-red-400 text-sm mb-6">
                {cameraError}
              </div>
            ) : selfiePreview ? (
              <div className="relative mb-6">
                <img src={selfiePreview} className="w-full rounded-2xl aspect-[4/3] object-cover" />
                <button
                  onClick={retakeSelfie}
                  className="absolute top-3 right-3 bg-black/60 text-white text-xs px-3 py-1.5 rounded-lg"
                >
                  Retake
                </button>
              </div>
            ) : (
              <div className="relative mb-6 rounded-2xl overflow-hidden bg-black aspect-[4/3]">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            )}

            {selfiePreview ? (
              <button
                onClick={submitClockAction}
                disabled={submitting}
                className="w-full py-4 bg-indigo-500 rounded-2xl font-semibold text-lg disabled:opacity-30 hover:bg-indigo-600 active:scale-95 transition-all"
              >
                {submitting ? 'Saving...' : action === 'in' ? 'Confirm Clock In ✓' : 'Confirm Clock Out ✓'}
              </button>
            ) : !cameraError ? (
              <button
                onClick={takeSelfie}
                className="w-full py-4 bg-white/10 border border-white/20 rounded-2xl font-semibold text-lg hover:bg-white/15 active:scale-95 transition-all"
              >
                📸 Take Photo
              </button>
            ) : null}
          </div>
        )}

        {/* ── SERVICE FORM ── */}
        {screen === 'service-form' && (
          <div className="w-full max-w-lg">
            <button onClick={goHome} className="flex items-center gap-1 text-white/40 text-sm mb-4 hover:text-white/60">
              ← Cancel
            </button>
            <h2 className="text-xl font-bold mb-1">Log Service</h2>
            <p className="text-white/40 text-sm mb-6">Logged by <span className="text-white/70">{employee?.name}</span></p>

            {pinError && <p className="text-red-400 text-sm mb-4">{pinError}</p>}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/40 mb-1.5">Vehicle Category</label>
                  <select
                    value={serviceForm.vehicleCategory}
                    onChange={e => setServiceForm(f => ({ ...f, vehicleCategory: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option>Rental Fleet</option>
                    <option>Personal/Customer Vehicle</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1.5">Vehicle Type</label>
                  <select
                    value={serviceForm.vehicleType}
                    onChange={e => setServiceForm(f => ({ ...f, vehicleType: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option>Scooter</option>
                    <option>Car</option>
                    <option>E-bike</option>
                  </select>
                </div>
              </div>

              <Field label="Plate Number *" value={serviceForm.plate}
                onChange={v => setServiceForm(f => ({ ...f, plate: v.toUpperCase() }))}
                placeholder="e.g. ABC123" />

              <div className="grid grid-cols-2 gap-3">
                <Field label="Customer Name" value={serviceForm.customerName}
                  onChange={v => setServiceForm(f => ({ ...f, customerName: v }))} />
                <Field label="Customer Phone" value={serviceForm.customerPhone}
                  onChange={v => setServiceForm(f => ({ ...f, customerPhone: v }))}
                  type="tel" />
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-1.5">Service Type</label>
                <select
                  value={serviceForm.serviceType}
                  onChange={e => setServiceForm(f => ({ ...f, serviceType: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  {SERVICE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-1.5">Description *</label>
                <textarea
                  value={serviceForm.description}
                  onChange={e => setServiceForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What was done?"
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Cost ($)" value={serviceForm.cost} type="number"
                  onChange={v => setServiceForm(f => ({ ...f, cost: v }))}
                  placeholder="0.00" />
                <Field label="Notes (optional)" value={serviceForm.notes}
                  onChange={v => setServiceForm(f => ({ ...f, notes: v }))} />
              </div>
            </div>

            <button
              onClick={submitService}
              disabled={submitting}
              className="w-full mt-6 py-4 bg-indigo-500 rounded-2xl font-semibold text-lg disabled:opacity-30 hover:bg-indigo-600 active:scale-95 transition-all"
            >
              {submitting ? 'Saving...' : 'Submit Service Record ✓'}
            </button>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {screen === 'success' && (
          <div className="text-center">
            <div className="text-7xl mb-6">✅</div>
            <h2 className="text-2xl font-bold mb-3">{successMsg}</h2>
            <p className="text-white/40 text-sm">Returning to home in 4 seconds...</p>
            <button onClick={goHome} className="mt-6 text-indigo-400 text-sm hover:text-indigo-300">
              Go now →
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <p className="text-white/80 text-sm font-mono">
      {time.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
    </p>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-white/40 mb-1.5">{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500"
      />
    </div>
  )
}