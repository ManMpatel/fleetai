import { useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

export default function OnboardPage() {
  const { phone } = useParams<{ phone: string }>()
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [licenceFile, setLicenceFile] = useState<File | null>(null)
  const [licencePreview, setLicencePreview] = useState<string>('')

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    email: '',
    vehicleType: 'scooter',
    street: '',
    city: '',
    state: 'NSW',
    postcode: '',
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLicenceFile(file)
    const reader = new FileReader()
    reader.onload = ev => setLicencePreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!licenceFile) { setError('Please upload your licence photo'); return }
    setSubmitting(true)
    setError('')

    try {
      // Upload licence photo first
      const formData = new FormData()
      formData.append('file', licenceFile)
      const uploadRes = await axios.post('/api/upload/document', formData)
      const licencePhotoUrl = uploadRes.data.url

      // Create renter
      await axios.post('/api/renters', {
        name: `${form.firstName} ${form.lastName}`,
        phone: decodeURIComponent(phone || ''),
        email: form.email,
        dateOfBirth: form.dateOfBirth,
        licenceNumber: form.licenceNumber,
        licencePhotoUrl,
        vehicleType: form.vehicleType,
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          postcode: form.postcode,
          country: 'Australia',
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
      <div className="min-h-screen bg-bg flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-green-bg flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-8 h-8 text-green">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">All done!</h2>
          <p className="text-text-muted text-sm">Your rental details have been submitted. The owner will review and activate your account shortly.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg pb-12">
      {/* Header */}
      <div className="bg-sidebar px-6 py-5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-logo-accent/20 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="var(--logo-accent)" />
          </svg>
        </div>
        <span className="text-white font-semibold text-[15px]">Fleet<span className="text-logo-accent">AI</span></span>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-text-primary mb-1">Register Your Details</h1>
        <p className="text-text-muted text-sm mb-8">Please fill in all fields accurately. Your information is securely stored.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Personal */}
          <Section title="Personal Information">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First Name *" name="firstName" value={form.firstName} onChange={handleChange} required />
              <Field label="Last Name *" name="lastName" value={form.lastName} onChange={handleChange} required />
            </div>
            <Field label="Date of Birth *" name="dateOfBirth" type="date" value={form.dateOfBirth} onChange={handleChange} required />
            <Field label="Email *" name="email" type="email" value={form.email} onChange={handleChange} required />
            <Field label="Licence Number *" name="licenceNumber" value={form.licenceNumber} onChange={handleChange} required />
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Vehicle Type *</label>
              <select
                name="vehicleType"
                value={form.vehicleType}
                onChange={handleChange}
                className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent"
              >
                <option value="scooter">Scooter</option>
                <option value="car">Car</option>
              </select>
            </div>
          </Section>

          {/* Licence Photo */}
          <Section title="Licence Photo *">
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-accent transition-colors"
              onClick={() => document.getElementById('licence-upload')?.click()}
            >
              {licencePreview ? (
                <img src={licencePreview} alt="Licence preview" className="max-h-40 mx-auto rounded-lg object-contain" />
              ) : (
                <div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 text-text-muted mx-auto mb-2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <p className="text-sm text-text-muted">Tap to take photo or upload from gallery</p>
                  <p className="text-xs text-text-muted mt-1">JPG, PNG or PDF</p>
                </div>
              )}
              <input
                id="licence-upload"
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </Section>

          {/* Address */}
          <Section title="Address">
            <Field label="Street Address *" name="street" value={form.street} onChange={handleChange} required />
            <div className="grid grid-cols-2 gap-3">
              <Field label="City *" name="city" value={form.city} onChange={handleChange} required />
              <div>
                <label className="block text-xs text-text-muted mb-1.5">State *</label>
                <select
                  name="state"
                  value={form.state}
                  onChange={handleChange}
                  className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent"
                >
                  {['NSW','VIC','QLD','WA','SA','TAS','ACT','NT'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <Field label="Postcode *" name="postcode" value={form.postcode} onChange={handleChange} required />
          </Section>

          {/* Bank */}
          <Section title="Bank Account (for direct debit)">
            <Field label="Bank Name *" name="bankName" value={form.bankName} onChange={handleChange} required />
            <Field label="Account Holder Name *" name="accountHolderName" value={form.accountHolderName} onChange={handleChange} required />
            <Field label="BSB Number *" name="bsbNumber" placeholder="000-000" value={form.bsbNumber} onChange={handleChange} required />
            <Field label="Account Number *" name="accountNumber" value={form.accountNumber} onChange={handleChange} required />
          </Section>

          {/* Emergency Contact */}
          <Section title="Emergency Contact">
            <Field label="Contact Name *" name="emergencyContactName" value={form.emergencyContactName} onChange={handleChange} required />
            <Field label="Contact Phone *" name="emergencyContactPhone" type="tel" value={form.emergencyContactPhone} onChange={handleChange} required />
          </Section>

          {error && (
            <div className="bg-red-bg border border-red/20 text-red text-sm rounded-lg px-4 py-3">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-accent text-white font-semibold py-4 rounded-xl hover:bg-accent/90 disabled:opacity-50 transition-colors text-base"
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
    <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-semibold text-text-primary border-b border-border pb-2">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, name, value, onChange, type = 'text', required, placeholder }: {
  label: string; name: string; value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string; required?: boolean; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-text-muted mb-1.5">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        className="w-full bg-surface2 border border-border text-text-primary placeholder-text-muted text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent transition-colors"
      />
    </div>
  )
}


