import { useEffect, useState, useRef  } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'


async function compressToBase64(file: File, maxWidth: number, quality: number): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1]
      URL.revokeObjectURL(url)
      resolve(base64)
    }
    img.src = url
  })
}

export default function OnboardPage() {
  
  const [submitted, setSubmitted] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signatureData, setSignatureData] = useState('')
  const [isSigning, setIsSigning] = useState(false)
  const signatureRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  const [licenceFile, setLicenceFile] = useState<File | null>(null)
  const [licencePreview, setLicencePreview] = useState('')
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [selfiePreview, setSelfiePreview] = useState('')
  const [passportFile, setPassportFile] = useState<File | null>(null)
  const [passportPreview, setPassportPreview] = useState('')
  const { phone } = useParams<{ phone: string }>()
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [slugError, setSlugError] = useState(false)
  

  useEffect(() => {
    // phone param might be a slug (no digits) or actual phone number
    const isSlug = phone && !/^\d+$/.test(decodeURIComponent(phone))
    if (isSlug) {
      // Resolve slug to owner email
      axios.get(`${import.meta.env.VITE_API_URL}/api/auth/resolve/${phone}`)
        .then(res => {
          setOwnerEmail(res.data.email)
          setOwnerName(res.data.name || '')
        })
        .catch(() => setSlugError(true))
    } else {
      // Old style — get owner from ?owner= query param
      const ownerParam = new URLSearchParams(window.location.search).get('owner') || ''
      setOwnerEmail(ownerParam)
    }
  }, [phone])

  const [form, setForm] = useState({
    mobileNumber: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    email: '',
    vehicleType: 'scooter',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: 'NSW',
    postcode: '',
    country: 'Australia',
    bankName: '',
    accountHolderName: '',
    bsbNumber: '',
    accountNumber: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    licenceNumber: '',
    passportNumber: '',
  })

  const [bankErrors, setBankErrors] = useState<{ bsb?: string; account?: string }>({})

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    if (name === 'bsbNumber') {
      // Strip non-digits, max 6, auto-insert dash after 3rd digit
      const digits = value.replace(/\D/g, '').slice(0, 6)
      const formatted = digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits
      setForm(p => ({ ...p, bsbNumber: formatted }))
      setBankErrors(p => ({ ...p, bsb: digits.length === 6 ? undefined : digits.length > 0 ? 'BSB must be 6 digits (e.g. 062-000)' : undefined }))
    } else if (name === 'accountNumber') {
      // Strip spaces and non-digits
      const digits = value.replace(/\D/g, '').slice(0, 9)
      setForm(p => ({ ...p, accountNumber: digits }))
      setBankErrors(p => ({ ...p, account: digits.length >= 6 ? undefined : digits.length > 0 ? 'Account number must be 6–9 digits' : undefined }))
    } else {
      setForm(p => ({ ...p, [name]: value }))
    }
  }

  function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'licence' | 'selfie' | 'passport'
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      if (type === 'licence') { setLicenceFile(file); setLicencePreview(ev.target?.result as string) }
      else if (type === 'selfie') { setSelfieFile(file); setSelfiePreview(ev.target?.result as string) }
      else { setPassportFile(file); setPassportPreview(ev.target?.result as string) }
    }
    reader.readAsDataURL(file)
  }

  function getPos(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect()
    return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) }
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    const canvas = signatureRef.current; if (!canvas) return
    setIsSigning(true)
    const ctx = canvas.getContext('2d')!
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const pos = getPos(canvas, clientX, clientY)
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isSigning) return
    const canvas = signatureRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const pos = getPos(canvas, clientX, clientY)
    ctx.lineTo(pos.x, pos.y); ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke()
  }

  function endDraw() {
    setIsSigning(false)
    const canvas = signatureRef.current; if (!canvas) return
    setSignatureData(canvas.toDataURL('image/png'))
  }

  function clearSignature() {
    const canvas = signatureRef.current; if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setSignatureData('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // If ownerEmail is empty, try to re-resolve slug before giving up
    if (!ownerEmail && phone) {
      try {
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/auth/resolve/${phone}`)
        setOwnerEmail(res.data.email)
      } catch {
        setError('This form link is invalid. Please ask the owner to resend the link.')
        return
      }
    }

    if (!ownerEmail) {
      setError('This form link is invalid. Please ask the owner to resend the link.')
      return
    }

    if (!licenceFile && form.vehicleType !== 'e-bike') { setError('Please upload your licence photo'); return }
    if (!selfieFile) { setError('Please upload a selfie photo'); return }
    if (!passportFile) { setError('Please upload your passport photo'); return }
    if (!form.passportNumber.trim()) { setError('Please enter your passport number'); return }
    if (!termsAccepted) {
      setError('Please accept the terms and conditions.')
      return
    }
    if (!signatureData) {
      setError('Please provide your signature before submitting.')
      return
    }
    const bsbDigits = form.bsbNumber.replace(/\D/g, '')
    if (bsbDigits.length !== 6) { setError('BSB must be exactly 6 digits (e.g. 062-000)'); return }
    if (form.accountNumber.length < 6 || form.accountNumber.length > 9) { setError('Account number must be 6–9 digits'); return }
    setSubmitting(true)
    setError('')

    try {
      // Compress all photos to base64 — no S3, stored directly in MongoDB
      const [licencePhotoBase64, selfieBase64, passportPhotoBase64] = await Promise.all([
        licenceFile ? compressToBase64(licenceFile, 1200, 0.8) : Promise.resolve(undefined),
        compressToBase64(selfieFile, 800, 0.7),
        ...(passportFile ? [compressToBase64(passportFile, 1200, 0.8)] : [Promise.resolve(undefined)]),
      ])

      await axios.post('/api/renters', {
        name: `${form.firstName} ${form.lastName}`,
        phone: form.mobileNumber,
        ownerId: ownerEmail,
        email: form.email,
        dateOfBirth: form.dateOfBirth,
        licenceNumber: form.licenceNumber || undefined,
        passportNumber: form.passportNumber || undefined,
        ...(licencePhotoBase64 ? { licencePhotoBase64 } : {}),
        selfieBase64,
        ...(passportPhotoBase64 ? { passportPhotoBase64 } : {}),
        vehicleType: form.vehicleType,
        status: 'pending',
        address: {
          street: `${form.addressLine1}${form.addressLine2 ? ', ' + form.addressLine2 : ''}`,
          city: form.city,
          state: form.state,
          postcode: form.postcode,
          country: form.country,
        },
        bankName: form.bankName,
        accountHolderName: form.accountHolderName,
        bsbNumber: form.bsbNumber,
        accountNumber: form.accountNumber,
        emergencyContactName: form.emergencyContactName,
        emergencyContactPhone: form.emergencyContactPhone,
        signatureBase64: signatureData,
      }, { headers: { 'x-owner-email': ownerEmail } })

      setSubmitted(true)
    } catch (err: any) {
      const msg = err.response?.data?.error || ''
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('dup key')) {
        setError('This phone number is already registered. Please check the number and try again.')
      } else {
        setError(msg || 'Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2.5} className="w-8 h-8">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Details Submitted!</h2>
          <p className="text-gray-500 text-sm">Your rental details have been submitted successfully. The owner will review and activate your account shortly.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <div className="bg-[#1E2530] px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#818CF8" />
          </svg>
        </div>
        <span className="text-white font-semibold text-[15px]">Fleet<span className="text-indigo-400">AI</span></span>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-6">
        {slugError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            This link is invalid. Please ask your owner to resend the correct link.
          </div>
        )}
        {ownerName && (
          <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-700 text-sm">
            This form was sent to you by <strong>{ownerName}</strong>. Please fill in your details below.
          </div>
        )}
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Register Your Details</h1>
        <p className="text-gray-500 text-sm mb-6">Please fill in all required fields (*) accurately.</p>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Personal Info */}
          <Section title="Personal Information">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First Name *" name="firstName" value={form.firstName} onChange={handleChange} required />
              <Field label="Last Name *" name="lastName" value={form.lastName} onChange={handleChange} required />
            </div>
            <Field label="Date of Birth *" name="dateOfBirth" type="date" value={form.dateOfBirth} onChange={handleChange} required />
            <Field label="Mobile Number *" name="mobileNumber" value={form.mobileNumber} onChange={handleChange} required={!phone} />
            <Field label="Email ID *" name="email" type="email" value={form.email} onChange={handleChange} required />
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Vehicle Type *</label>
              <select name="vehicleType" value={form.vehicleType} onChange={handleChange}
                className="w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-400">
                <option value="scooter">Scooter</option>
                <option value="car">Car</option>
                <option value="e-bike">E-Bike</option>
              </select>
            </div>
            <Field label={form.vehicleType === 'e-bike' ? 'Licence Number' : 'Licence Number *'} name="licenceNumber" value={form.licenceNumber} onChange={handleChange} required={form.vehicleType !== 'e-bike'} />
            <Field label="Passport Number *" name="passportNumber" value={form.passportNumber} onChange={handleChange} required />
          </Section>

          {/* Licence Photo */}
          <Section title={form.vehicleType === 'e-bike' ? 'Licence Photo (Optional)' : 'Licence Photo *'}>
            <p className="text-xs text-gray-400 mb-3">
              {form.vehicleType === 'e-bike'
                ? 'E-Bike riders do not require a licence — you may skip this'
                : "Take a clear photo of your driver's licence (front side)"}
            </p>
            <PhotoUpload
              preview={licencePreview}
              inputId="licence-upload"
              onChange={e => handleFileChange(e, 'licence')}
              label="Take photo or upload licence"
            />
          </Section>

          {/* Selfie */}
          <Section title="Selfie Photo *">
            <p className="text-xs text-gray-400 mb-3">Take a clear selfie photo of yourself holding your licence</p>
            <PhotoUpload
              preview={selfiePreview}
              inputId="selfie-upload"
              onChange={e => handleFileChange(e, 'selfie')}
              label="Take selfie with licence"
              capture="user"
            />
          </Section>

          {/* Passport Photo */}
          <Section title="Passport Photo *">
            <p className="text-xs text-gray-400 mb-3">Take a clear photo of your passport photo page</p>
            <PhotoUpload
              preview={passportPreview}
              inputId="passport-upload"
              onChange={e => handleFileChange(e, 'passport')}
              label="Upload passport photo page"
            />
          </Section>

          {/* Address */}
          <Section title="Address">
            <Field label="Address Line 1 *" name="addressLine1" value={form.addressLine1} onChange={handleChange} required />
            <Field label="Address Line 2" name="addressLine2" value={form.addressLine2} onChange={handleChange} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="City *" name="city" value={form.city} onChange={handleChange} required />
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">State *</label>
                <select name="state" value={form.state} onChange={handleChange}
                  className="w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-400">
                  {['NSW','VIC','QLD','WA','SA','TAS','ACT','NT'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <Field label="Postal Code *" name="postcode" value={form.postcode} onChange={handleChange} required />
            <Field label="Country *" name="country" value={form.country} onChange={handleChange} required />
          </Section>

          {/* Bank Details */}
          <Section title="Bank Account (for direct debit)">
            <Field label="Bank Name *" name="bankName" value={form.bankName} onChange={handleChange} required />
            <Field label="Name as per Bank *" name="accountHolderName" value={form.accountHolderName} onChange={handleChange} required />
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">BSB No. *</label>
              <input name="bsbNumber" value={form.bsbNumber} onChange={handleChange} placeholder="000-000" inputMode="numeric"
                className={`w-full bg-gray-50 border text-gray-900 text-sm rounded-lg px-3 py-2.5 focus:outline-none ${bankErrors.bsb ? 'border-red-400 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`} />
              {bankErrors.bsb && <p className="text-red-600 text-xs mt-1 font-medium">{bankErrors.bsb}</p>}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Account Number *</label>
              <input name="accountNumber" value={form.accountNumber} onChange={handleChange} placeholder="6–9 digits" inputMode="numeric"
                className={`w-full bg-gray-50 border text-gray-900 text-sm rounded-lg px-3 py-2.5 focus:outline-none ${bankErrors.account ? 'border-red-400 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`} />
              {bankErrors.account && <p className="text-red-600 text-xs mt-1 font-medium">{bankErrors.account}</p>}
            </div>
          </Section>

          {/* Emergency Contact */}
          <Section title="Emergency Contact">
            <Field label="Contact Name *" name="emergencyContactName" value={form.emergencyContactName} onChange={handleChange} required />
            <Field label="Contact Phone *" name="emergencyContactPhone" type="tel" value={form.emergencyContactPhone} onChange={handleChange} required />
          </Section>

          {/* Signature */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-2">Signature *</h3>
            <p className="text-xs text-gray-500">Please sign below using your finger or mouse.</p>
            <div className="relative border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-gray-50" style={{ touchAction: 'none' }}>
              <canvas
                ref={signatureRef}
                width={600}
                height={180}
                className="w-full"
                style={{ cursor: 'crosshair' }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={e => { e.preventDefault(); startDraw(e) }}
                onTouchMove={e => { e.preventDefault(); draw(e) }}
                onTouchEnd={endDraw}
              />
              {!signatureData && (
                <p className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm pointer-events-none">Sign here</p>
              )}
            </div>
            <button type="button" onClick={clearSignature}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors">
              ✕ Clear signature
            </button>
          </div>

          {/* Terms & Conditions */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-2">Privacy & Terms</h3>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">Privacy Policy</p>
              <p className="text-xs text-gray-500 leading-relaxed">
                Your driver's licence and passport photos are collected solely to verify your identity for rental purposes.
                Photos are stored securely and encrypted. They will be permanently deleted once your rental has ended and
                30 days have passed with no outstanding fines on your rental vehicle. Your personal details are retained
                for record-keeping as required by Australian law. You may request access to or deletion of your information at any time.
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1.5">Direct Debit Request (DDR) Authority</p>
              <p className="text-xs text-amber-700 leading-relaxed mb-2">
                By submitting this form, you authorise the rental business to debit your nominated bank account via
                the Bulk Electronic Clearing System (BECS) for the agreed rental amount on a recurring basis.
              </p>
              <ul className="space-y-1 text-xs text-amber-700">
                <li>• A <strong>$10 dishonour fee</strong> applies for each failed or returned payment</li>
                <li>• You will receive at least <strong>2 business days notice</strong> before any increase in debit amount</li>
                <li>• Debits continue until you notify the business in writing to cancel</li>
                <li>• Disputes must be lodged within <strong>120 days</strong> of the debit date</li>
              </ul>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={e => setTermsAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-gray-700">
                I have read and agree to the above privacy policy and direct debit authority, and consent to the
                collection and storage of my identity documents for rental verification purposes.
              </span>
            </label>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-400 text-red-700 text-sm rounded-lg px-4 py-3 font-medium">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting || !termsAccepted}
            className="w-full bg-indigo-600 text-white font-semibold py-4 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors text-base"
          >
            {submitting ? 'Submitting...' : 'Submit My Details'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-2">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, name, value, onChange, type = 'text', required, placeholder, disabled }: {
  label: string; name: string; value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string; required?: boolean; placeholder?: string; disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1.5">{label}</label>
      <input
        type={type} name={name} value={value} onChange={onChange}
        required={required} placeholder={placeholder} disabled={disabled}
        className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-400 disabled:opacity-60"
      />
    </div>
  )
}

function PhotoUpload({ preview, inputId, onChange, label, capture }: {
  preview: string; inputId: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  label: string; capture?: 'user' | 'environment'
}) {
  return (
    <div
      className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center cursor-pointer hover:border-indigo-400 transition-colors"
      onClick={() => document.getElementById(inputId)?.click()}
    >
      {preview ? (
        <img src={preview} alt="Preview" className="max-h-48 mx-auto rounded-lg object-contain" />
      ) : (
        <div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 text-gray-300 mx-auto mb-2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <p className="text-sm text-gray-400">{label}</p>
          <p className="text-xs text-gray-300 mt-1">JPG, PNG or PDF</p>
        </div>
      )}
      <input
        id={inputId} type="file"
        accept="image/*"
        {...(capture ? { capture } : {})}
        onChange={onChange}
        className="hidden"
      />
    </div>
  )
}