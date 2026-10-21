import { useRef, useState } from 'react'
import type { FieldDef } from './types'
import SignaturePad from './SignaturePad'
import { photoToDataUrl } from './image'
import { todayIso } from './fieldLogic'

// One box of the form. The same component draws the renter's page (tone "public": plain light
// colours, big touch targets) and the owner's panel (tone "app": the dashboard's own theme).

export type Tone = 'public' | 'app'

// Tailwind only keeps class names it can read in full, so every one is written out here. The red and
// green of the public look are fixed hex values: this project's Tailwind config replaces the red / green
// colour scales with one theme colour each, so classes like red-600 print nothing.
const SPAN: Record<number, string> = {
  1: 'sm:col-span-1', 2: 'sm:col-span-2', 3: 'sm:col-span-3', 4: 'sm:col-span-4', 5: 'sm:col-span-5', 6: 'sm:col-span-6',
  7: 'sm:col-span-7', 8: 'sm:col-span-8', 9: 'sm:col-span-9', 10: 'sm:col-span-10', 11: 'sm:col-span-11', 12: 'sm:col-span-12',
}

/** Grid classes for a box: full width on a phone, its share of 12 columns from a tablet up. */
export function spanClass(span: number | undefined): string {
  return `col-span-12 ${SPAN[span && span >= 1 && span <= 12 ? span : 12]}`
}

const TONES = {
  public: {
    label: 'block text-sm font-medium text-gray-800',
    hint: 'text-xs text-gray-500 mt-0.5',
    error: 'text-xs text-[#dc2626] mt-1',
    input: 'w-full bg-white border text-gray-900 text-base sm:text-sm rounded-lg px-3 py-2.5 min-h-[44px] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200',
    ok: 'border-gray-300 focus:border-indigo-500',
    bad: 'border-[#ef4444] focus:border-[#ef4444]',
    pill: 'min-h-[44px] px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
    off: 'border-gray-300 bg-white text-gray-700 hover:border-indigo-400',
    on: 'border-indigo-600 bg-indigo-600 text-white',
    drop: 'min-h-[44px] px-4 py-2 rounded-lg border-2 border-dashed text-sm font-medium border-gray-300 bg-gray-50 text-gray-700 hover:border-indigo-400 disabled:opacity-50',
    dropBad: 'min-h-[44px] px-4 py-2 rounded-lg border-2 border-dashed text-sm font-medium border-[#ef4444] bg-[#fef2f2] text-[#b91c1c] disabled:opacity-50',
    thumb: 'border border-gray-200 bg-white',
    remove: 'text-xs text-[#dc2626] hover:underline',
    muted: 'text-xs text-gray-500',
    unit: 'text-sm text-gray-500 shrink-0',
    count: 'text-[11px] text-gray-400',
  },
  app: {
    label: 'block text-xs font-medium text-text-secondary',
    hint: 'text-[11px] text-text-muted mt-0.5',
    error: 'text-xs text-red mt-1',
    input: 'w-full bg-surface2 border text-text-primary text-sm rounded-lg px-3 py-2 placeholder:text-text-muted focus:outline-none',
    ok: 'border-border focus:border-accent',
    bad: 'border-red focus:border-red',
    pill: 'px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
    off: 'border-border bg-surface text-text-secondary hover:border-accent',
    on: 'border-accent bg-accent-bg text-accent',
    drop: 'px-3 py-1.5 rounded-lg border border-dashed text-xs font-medium border-border text-text-secondary hover:border-accent disabled:opacity-50',
    dropBad: 'px-3 py-1.5 rounded-lg border border-dashed text-xs font-medium border-red text-red disabled:opacity-50',
    thumb: 'border border-border bg-surface',
    remove: 'text-xs text-red hover:underline',
    muted: 'text-xs text-text-muted',
    unit: 'text-xs text-text-muted shrink-0',
    count: 'text-[11px] text-text-muted',
  },
} as const

// Boxes that hold codes read better in capitals.
const CAPITALS = new Set(['registration', 'licenceNumber', 'postcode', 'qpNumber', 'claimNumber', 'memberNumber'])

interface Props {
  field: FieldDef
  sectionId: string
  /** The answer in this box (a string, or a list of strings for ticks). */
  value: unknown
  onChange: (value: unknown) => void
  /** Picture boxes (photo, photos, signature): the data URLs held now, and how to change them. */
  pictures?: string[]
  onPictures?: (list: string[]) => void
  error?: string
  tone?: Tone
  /** A DOM id that is unique on the page. */
  inputId: string
  /** Browser autofill hint ("off" by default, so the other driver's boxes never get the renter's own details). */
  autoComplete?: string
}

export default function FieldInput({ field, sectionId, value, onChange, pictures, onPictures, error, tone = 'public', inputId, autoComplete = 'off' }: Props) {
  const t = TONES[tone]
  const errId = `${inputId}-err`
  const hintId = `${inputId}-hint`
  const describedBy = [field.hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined
  const text = typeof value === 'string' ? value : ''
  const inputClass = `${t.input} ${error ? t.bad : t.ok}`

  const labelText = (
    <>
      {field.label}
      {field.required && <span className={tone === 'public' ? 'text-[#dc2626]' : 'text-red'}> *</span>}
    </>
  )
  const hint = field.hint ? <p id={hintId} className={t.hint}>{field.hint}</p> : null
  const problem = error ? <p id={errId} role="alert" className={t.error}>{error}</p> : null

  // Boxes that are a set of buttons are a fieldset, so a screen reader reads the question once.
  if (field.type === 'yesno' || field.type === 'radio' || field.type === 'checks') {
    const options = field.type === 'yesno' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : field.options || []
    const picked: string[] = field.type === 'checks' ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === 'string' && value ? [value] : []
    const toggle = (v: string) => {
      if (field.type === 'checks') onChange(picked.includes(v) ? picked.filter(x => x !== v) : [...picked, v])
      else onChange(picked[0] === v ? '' : v) // pressing the chosen one again takes the answer back
    }
    return (
      <fieldset id={inputId} aria-describedby={describedBy} aria-invalid={!!error} className="min-w-0">
        <legend className={`${t.label} mb-1.5`}>{labelText}</legend>
        {hint}
        <div className="flex flex-wrap gap-2 mt-1.5" role={field.type === 'checks' ? 'group' : 'radiogroup'}>
          {options.map(o => {
            const on = picked.includes(o.value)
            return (
              <button key={o.value} type="button" onClick={() => toggle(o.value)}
                role={field.type === 'checks' ? undefined : 'radio'}
                aria-checked={field.type === 'checks' ? undefined : on}
                aria-pressed={field.type === 'checks' ? on : undefined}
                className={`${t.pill} ${on ? t.on : t.off}`}>
                {o.label}
              </button>
            )
          })}
        </div>
        {problem}
      </fieldset>
    )
  }

  if (field.type === 'signature') {
    return (
      <div>
        <label htmlFor={inputId} className={`${t.label} mb-1.5`}>{labelText}</label>
        {hint}
        <div className="mt-1.5">
          <SignaturePad id={inputId} value={pictures?.[0] || ''} onChange={png => onPictures?.(png ? [png] : [])} tone={tone} invalid={!!error} describedBy={describedBy} />
        </div>
        {problem}
      </div>
    )
  }

  if (field.type === 'photo' || field.type === 'photos') {
    return (
      <div>
        <p className={`${t.label} mb-1`}>{labelText}</p>
        {hint}
        <PicturePicker field={field} pictures={pictures || []} onPictures={list => onPictures?.(list)} tone={tone} inputId={inputId} invalid={!!error} describedBy={describedBy} />
        {problem}
      </div>
    )
  }

  let control: JSX.Element
  switch (field.type) {
    case 'textarea':
      control = (
        <>
          <textarea id={inputId} rows={field.rows ?? 4} maxLength={field.maxLen} value={text} autoComplete="off" autoCapitalize="sentences"
            onChange={e => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} placeholder={field.placeholder}
            className={`${inputClass} resize-y leading-relaxed`} />
          {field.maxLen && text.length > field.maxLen * 0.8 && <p className={`${t.count} text-right mt-0.5`}>{text.length} / {field.maxLen}</p>}
        </>
      )
      break
    case 'select':
      control = (
        <select id={inputId} value={text} onChange={e => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} autoComplete={autoComplete} className={inputClass}>
          <option value="">Select...</option>
          {(field.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
      break
    case 'number':
      control = (
        <div className="flex items-center gap-2">
          <input id={inputId} type="text" inputMode="decimal" value={text} maxLength={10} autoComplete="off" placeholder={field.placeholder}
            onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))} aria-invalid={!!error} aria-describedby={describedBy} className={inputClass} />
          {field.unit && <span className={t.unit}>{field.unit}</span>}
        </div>
      )
      break
    case 'date': {
      // Nobody was born, or had an accident, tomorrow.
      const max = field.id === 'dob' || (sectionId === 'incident' && field.id === 'date') ? todayIso() : undefined
      control = <input id={inputId} type="date" value={text} max={max} min="1900-01-01" autoComplete={autoComplete} onChange={e => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} className={inputClass} />
      break
    }
    case 'time':
      control = <input id={inputId} type="time" value={text} autoComplete="off" onChange={e => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} className={inputClass} />
      break
    case 'tel':
      control = <input id={inputId} type="tel" inputMode="tel" value={text} maxLength={30} autoComplete={autoComplete} placeholder={field.placeholder} onChange={e => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} className={inputClass} />
      break
    case 'email':
      control = <input id={inputId} type="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={text} maxLength={field.maxLen ?? 120} autoComplete={autoComplete} placeholder={field.placeholder} onChange={e => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} className={inputClass} />
      break
    default:
      control = (
        <input id={inputId} type="text" value={text} maxLength={field.maxLen ?? 200} autoComplete={autoComplete} placeholder={field.placeholder}
          autoCapitalize={CAPITALS.has(field.id) ? 'characters' : 'words'} spellCheck={CAPITALS.has(field.id) ? false : undefined}
          onChange={e => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} className={inputClass} />
      )
  }

  return (
    <div>
      <label htmlFor={inputId} className={`${t.label} mb-1`}>{labelText}</label>
      {hint}
      <div className={hint ? 'mt-1.5' : ''}>{control}</div>
      {problem}
    </div>
  )
}

interface PickerProps {
  field: FieldDef
  pictures: string[]
  onPictures: (list: string[]) => void
  tone: Tone
  inputId: string
  invalid: boolean
  describedBy?: string
}

function PicturePicker({ field, pictures, onPictures, tone, inputId, invalid, describedBy }: PickerProps) {
  const t = TONES[tone]
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState('')
  const most = field.type === 'photos' ? (field.max ?? 6) : 1
  const full = most > 1 && pictures.length >= most

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return
    setTrouble('')
    const room = most === 1 ? 1 : most - pictures.length
    const chosen = Array.from(files).slice(0, room)
    if (files.length > chosen.length) setTrouble(`You can add up to ${most} photos.`)
    setBusy(true)
    try {
      const made: string[] = []
      for (const file of chosen) {
        try {
          made.push(await photoToDataUrl(file))
        } catch (err: any) {
          setTrouble(err?.message || 'That photo could not be added.')
        }
      }
      if (made.length > 0) onPictures(most === 1 ? [made[0]] : [...pictures, ...made])
    } finally {
      setBusy(false)
      if (input.current) input.current.value = '' // so the same photo can be chosen again
    }
  }

  const buttonText = busy ? 'Preparing photo...' : field.type === 'photo' ? (pictures.length ? 'Replace photo' : 'Take or choose a photo') : pictures.length ? 'Add more photos' : 'Take or choose photos'

  return (
    <div>
      <input ref={input} id={inputId} type="file" accept="image/*" multiple={field.type === 'photos'} className="sr-only" tabIndex={-1}
        aria-describedby={describedBy} onChange={e => pick(e.target.files)} />
      {pictures.length > 0 && (
        <ul className="flex flex-wrap gap-2 mb-2">
          {pictures.map((src, i) => (
            <li key={i} className={`rounded-lg p-1 ${t.thumb}`}>
              <img src={src} alt={pictures.length > 1 ? `Photo ${i + 1}` : 'Your photo'} className="h-24 w-24 object-cover rounded-md" />
              <button type="button" onClick={() => onPictures(pictures.filter((_, j) => j !== i))} aria-label={pictures.length > 1 ? `Remove photo ${i + 1}` : 'Remove photo'} className={`${t.remove} block mx-auto mt-1 py-1`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => input.current?.click()} disabled={busy || full} className={invalid && pictures.length === 0 ? t.dropBad : t.drop}>
        {full ? `${most} photos added` : buttonText}
      </button>
      {most > 1 && pictures.length > 0 && <span className={`${t.count} ml-2`}>{pictures.length} of {most}</span>}
      {trouble && <p role="alert" className={`${t.error}`}>{trouble}</p>}
    </div>
  )
}
