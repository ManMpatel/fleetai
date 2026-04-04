import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

export default function OnboardPage() {
  
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [licenceFile, setLicenceFile] = useState<File | null>(null)
  const [licencePreview, setLicencePreview] = useState('')
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [selfiePreview, setSelfiePreview] = useState('')
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
    mobileNumber: decodeURIComponent(phone || ''),
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
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
  }

  function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'licence' | 'selfie'
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      if (type === 'licence') {
        setLicenceFile(file)
        setLicencePreview(ev.target?.result as string)
      } else {
        setSelfieFile(file)
        setSelfiePreview(ev.target?.result as string)
      }
    }
    reader.readAsDataURL(file)
  }

  async function uploadFile(file: File): Promise<string> {
    const formData = new FormData()
    formData.append('file', file)
    const res = await axios.post('/api/upload/document', formData)
    return res.data.url
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!licenceFile) { setError('Please upload your licence photo'); return }
    if (!selfieFile) { setError('Please upload a selfie photo'); return }
    setSubmitting(true)
    setError('')

    try {
      const [licencePhotoUrl, selfieUrl] = await Promise.all([
        uploadFile(licenceFile),
        uploadFile(selfieFile),
      ])

      await axios.post('/api/renters', {
        name: `${form.firstName} ${form.lastName}`,
        phone: phone ? decodeURIComponent(phone) : form.mobileNumber,
        ownerId: ownerEmail,
        email: form.email,
        dateOfBirth: form.dateOfBirth,
        licenceNumber: form.licenceNumber,
        licencePhotoUrl,
        selfieUrl,
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
      })

      setSubmitted(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.')
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
            <Field label="Mobile Number *" name="mobileNumber" value={form.mobileNumber} onChange={handleChange} required={!phone} disabled={!!phone} />
            <Field label="Email ID *" name="email" type="email" value={form.email} onChange={handleChange} required />
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Vehicle Type *</label>
              <select name="vehicleType" value={form.vehicleType} onChange={handleChange}
                className="w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-400">
                <option value="scooter">Scooter</option>
                <option value="car">Car</option>
              </select>
            </div>
            <Field label="Licence Number *" name="licenceNumber" value={form.licenceNumber} onChange={handleChange} required />
          </Section>

          {/* Licence Photo */}
          <Section title="Licence Photo *">
            <p className="text-xs text-gray-400 mb-3">Take a clear photo of your driver's licence (front side)</p>
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
            <Field label="BSB No. *" name="bsbNumber" placeholder="000-000" value={form.bsbNumber} onChange={handleChange} required />
            <Field label="Account Number *" name="accountNumber" value={form.accountNumber} onChange={handleChange} required />
          </Section>

          {/* Emergency Contact */}
          <Section title="Emergency Contact">
            <Field label="Contact Name *" name="emergencyContactName" value={form.emergencyContactName} onChange={handleChange} required />
            <Field label="Contact Phone *" name="emergencyContactPhone" type="tel" value={form.emergencyContactPhone} onChange={handleChange} required />
          </Section>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
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
        accept="image/*,application/pdf"
        capture={capture || 'environment'}
        onChange={onChange}
        className="hidden"
      />
    </div>
  )
}