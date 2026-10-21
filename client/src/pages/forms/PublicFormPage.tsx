import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import type { Answers, FieldDef, SectionDef } from './types'
import FieldInput, { spanClass } from './FieldInput'
import { isEmpty, isPictureType, isVisible, todayIso, validateValue } from './fieldLogic'

// PUBLIC page: a renter opens the link he was sent (/form/<code>), fills in his sections on his phone,
// attaches his licence and photos, signs, and sends it. No login. It shows only what the server sends
// for the link: the form's name, the business name and the renter's own boxes.

interface PublicForm {
  name: string
  intro: string
  business: string
  logoUrl: string | null
  askWho: boolean
  sections: SectionDef[]
}

type Phase = 'loading' | 'ready' | 'missing' | 'error' | 'sent'
interface Who { name: string; phone: string; email: string }

// The server refuses 12,000,000 characters of pictures in one form; stop a little before that.
const MAX_PICTURE_CHARS = 11_500_000

// Browser autofill, only for the renter's own details (never the other driver's boxes).
const AUTOFILL: Record<string, string> = {
  firstName: 'given-name', surname: 'family-name', address: 'street-address', suburb: 'address-level2',
  state: 'address-level1', postcode: 'postal-code', mobile: 'tel', email: 'email',
}

const WHO_FIELDS: FieldDef[] = [
  { id: 'name', label: 'Your name', type: 'text', required: true, maxLen: 80 },
  { id: 'phone', label: 'Your mobile number', type: 'tel', required: true },
  { id: 'email', label: 'Your email (optional)', type: 'email' },
]

const draftKey = (code: string) => `fleetai-form-draft:${code}`

function loadDraft(code: string): { answers?: Answers; who?: Who } {
  try {
    const raw = sessionStorage.getItem(draftKey(code))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
function saveDraft(code: string, answers: Answers, who: Who) {
  try { sessionStorage.setItem(draftKey(code), JSON.stringify({ answers, who })) } catch { /* private mode: no draft */ }
}
function clearDraft(code: string) {
  try { sessionStorage.removeItem(draftKey(code)) } catch { /* nothing to clear */ }
}

const fieldsOf = (s: SectionDef): FieldDef[] => s.rows.flat()
const blank = (v: unknown) => isEmpty(v) || (typeof v === 'string' && v.trim() === '')

export default function PublicFormPage() {
  const { code = '' } = useParams<{ code: string }>()
  const [phase, setPhase] = useState<Phase>('loading')
  const [form, setForm] = useState<PublicForm | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [pictures, setPictures] = useState<Record<string, string[]>>({}) // "section.field" -> data URLs
  const [who, setWho] = useState<Who>({ name: '', phone: '', email: '' })
  const [consent, setConsent] = useState(false)
  const [hp, setHp] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const restored = useRef(false)

  // A form somebody sent to a renter must never end up in a search engine.
  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.appendChild(robots)
    return () => { document.head.removeChild(robots) }
  }, [])

  useEffect(() => {
    if (!code) { setPhase('missing'); return }
    let cancelled = false
    setPhase('loading')
    axios.get<{ form: PublicForm }>(`/api/public/forms/${encodeURIComponent(code)}`)
      .then(res => {
        if (cancelled) return
        const f = res.data.form
        setForm(f)
        document.title = `${f.name} - ${f.business}`
        // Text answers typed before a reload (the phone gave the browser back its memory) come back.
        const draft = loadDraft(code)
        const next: Answers = { ...(draft.answers || {}) }
        // The signing date starts as today; the renter can change it.
        if (f.sections.some(s => s.id === 'declaration') && isEmpty(next.declaration?.date)) {
          next.declaration = { ...(next.declaration || {}), date: todayIso() }
        }
        setAnswers(next)
        if (draft.who) setWho({ name: draft.who.name || '', phone: draft.who.phone || '', email: draft.who.email || '' })
        restored.current = true
        setPhase('ready')
      })
      .catch(err => { if (!cancelled) setPhase(err?.response?.status === 404 ? 'missing' : 'error') })
    return () => { cancelled = true }
  }, [code, attempt])

  // Keep the typed answers for the length of this tab (not the photos or the signature).
  useEffect(() => {
    if (!restored.current || phase !== 'ready') return
    const timer = setTimeout(() => saveDraft(code, answers, who), 400)
    return () => clearTimeout(timer)
  }, [answers, who, code, phase])

  const business = form?.business || 'the business'
  const hasUploads = useMemo(() => !!form?.sections.some(s => s.id === 'uploads'), [form])

  function setAnswer(section: SectionDef, field: FieldDef, value: unknown) {
    setAnswers(prev => {
      const mine: Record<string, any> = { ...(prev[section.id] || {}), [field.id]: value }
      // A box that is no longer showing (the answer it depended on changed) is forgotten.
      for (const f of fieldsOf(section)) if (f.showIf && !isVisible(f, mine)) delete mine[f.id]
      return { ...prev, [section.id]: mine }
    })
    setErrors(prev => {
      if (!prev[`${section.id}.${field.id}`]) return prev
      const { [`${section.id}.${field.id}`]: _gone, ...rest } = prev
      return rest
    })
  }

  function setPicture(section: SectionDef, field: FieldDef, list: string[]) {
    setPictures(prev => ({ ...prev, [`${section.id}.${field.id}`]: list }))
    setErrors(prev => {
      if (!prev[`${section.id}.${field.id}`]) return prev
      const { [`${section.id}.${field.id}`]: _gone, ...rest } = prev
      return rest
    })
  }

  function setWhoField(id: string, value: string) {
    setWho(prev => ({ ...prev, [id]: value }))
    setErrors(prev => {
      if (!prev[`who.${id}`]) return prev
      const { [`who.${id}`]: _gone, ...rest } = prev
      return rest
    })
  }

  /** Every problem the renter can fix, in page order. The server checks it all again. */
  function findProblems(): Array<[string, string]> {
    if (!form) return []
    const problems: Array<[string, string]> = []
    if (form.askWho) {
      if (blank(who.name)) problems.push(['who.name', 'Type your name'])
      if (who.phone.replace(/\D/g, '').length < 9) problems.push(['who.phone', 'Type your full mobile number'])
      if (who.email.trim() && validateValue({ id: 'email', label: '', type: 'email' }, who.email.trim(), 'who')) problems.push(['who.email', 'That does not look like an email address'])
    }
    for (const s of form.sections) {
      const mine = answers[s.id] || {}
      for (const f of fieldsOf(s)) {
        if (!isVisible(f, mine)) continue
        const key = `${s.id}.${f.id}`
        if (isPictureType(f.type)) {
          if (f.required && !(pictures[key]?.length)) problems.push([key, f.type === 'signature' ? 'Please sign in the box' : 'Please add a photo'])
          continue
        }
        const v = mine[f.id]
        if (f.required && blank(v)) { problems.push([key, 'This is needed']); continue }
        const bad = validateValue(f, typeof v === 'string' ? v.trim() : v, s.id)
        if (bad) problems.push([key, bad])
      }
    }
    if (!consent) problems.push(['consent', 'Please tick the box to agree'])
    return problems
  }

  function goTo(key: string) {
    const cell = document.getElementById(`cell-${key.replace('.', '-')}`)
    if (!cell) return
    cell.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const target = cell.querySelector<HTMLElement>('input:not([type=file]), select, textarea, button')
    target?.focus({ preventScroll: true })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form || busy) return
    setSubmitError('')
    const problems = findProblems()
    setErrors(Object.fromEntries(problems))
    if (problems.length > 0) {
      setSubmitError(problems.length === 1 ? 'One box needs your attention. It is marked in red.' : `${problems.length} boxes need your attention. They are marked in red.`)
      goTo(problems[0][0])
      return
    }

    const files: Record<string, Record<string, string[]>> = {}
    const data: Answers = {}
    let pictureChars = 0
    for (const s of form.sections) {
      const mine = answers[s.id] || {}
      for (const f of fieldsOf(s)) {
        if (!isVisible(f, mine)) continue
        if (isPictureType(f.type)) {
          const list = pictures[`${s.id}.${f.id}`] || []
          if (list.length > 0) {
            files[s.id] = { ...(files[s.id] || {}), [f.id]: list }
            pictureChars += list.reduce((n, p) => n + p.length, 0)
          }
        } else if (!blank(mine[f.id])) {
          data[s.id] = { ...(data[s.id] || {}), [f.id]: typeof mine[f.id] === 'string' ? mine[f.id].trim() : mine[f.id] }
        }
      }
    }
    if (pictureChars > MAX_PICTURE_CHARS) {
      setSubmitError('The photos are too big to send together. Remove one or two and press Send again.')
      return
    }

    const body: Record<string, unknown> = { data, files, consent: true, hp }
    if (form.askWho) body.renter = { name: who.name.trim(), phone: who.phone.trim(), email: who.email.trim() }

    setBusy(true)
    setProgress(0)
    try {
      await axios.post(`/api/public/forms/${encodeURIComponent(code)}/submit`, body, {
        onUploadProgress: ev => setProgress(ev.total ? Math.round((ev.loaded / ev.total) * 100) : 0),
      })
      clearDraft(code)
      setPhase('sent')
      window.scrollTo({ top: 0 })
    } catch (err: any) {
      const status = err?.response?.status
      const message = err?.response?.data?.error
      if (status === 429) setSubmitError('Too many forms have been sent from this connection. Please wait a little while and try again.')
      else if (status === 413) setSubmitError('The photos are too big to send together. Remove one or two and press Send again.')
      else if (status === 404) setSubmitError('This form is not available any more. Please ask for a new link.')
      else if (status === 400 && message) setSubmitError(message)
      else setSubmitError('The form could not be sent. Check your internet and press Send again. Your answers are still here.')
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <header className="bg-[#1E2530] px-4 py-3.5 flex items-center gap-3">
      {form?.logoUrl ? (
        <img src={form.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
      ) : (
        <div aria-hidden="true" className="w-8 h-8 rounded-lg bg-indigo-500/25 flex items-center justify-center text-indigo-200 text-sm font-bold">{(form?.business || 'F').charAt(0).toUpperCase()}</div>
      )}
      <span className="text-white font-semibold text-[15px] truncate">{form?.business || 'Form'}</span>
    </header>
  )

  if (phase === 'loading') {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">Loading the form...</div>
  }

  if (phase === 'missing' || phase === 'error') {
    return (
      <div className="min-h-screen bg-gray-50">
        {header}
        <main className="max-w-md mx-auto px-4 pt-12 text-center">
          <h1 className="text-xl font-bold text-gray-900">{phase === 'missing' ? 'This form is not available' : 'The form could not be opened'}</h1>
          <p className="text-sm text-gray-600 mt-2">
            {phase === 'missing'
              ? 'The link may be wrong, or it may have been switched off. Please ask the person who sent it for a new link.'
              : 'Check your internet and try again.'}
          </p>
          {phase === 'error' && (
            <button onClick={() => setAttempt(n => n + 1)} className="mt-5 min-h-[44px] px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold">Try again</button>
          )}
        </main>
      </div>
    )
  }

  if (phase === 'sent') {
    const first = (answers.driver?.firstName as string) || who.name.split(' ')[0] || ''
    return (
      <div className="min-h-screen bg-gray-50">
        {header}
        <main className="max-w-md mx-auto px-4 pt-12 text-center">
          <div className="w-16 h-16 rounded-full bg-[#dcfce7] flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2.5} className="w-8 h-8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900" role="status">Thank you{first ? `, ${first}` : ''}</h1>
          <p className="text-sm text-gray-600 mt-2">{business} has received your form. You can close this page now.</p>
        </main>
      </div>
    )
  }

  if (!form) return null

  const card = 'bg-white border border-gray-200 rounded-xl p-4 shadow-sm'

  return (
    <div className="min-h-screen bg-gray-50 pb-16 text-gray-900">
      {header}
      <main className="max-w-xl mx-auto px-4 pt-5">
        <h1 className="text-2xl font-bold">{form.name}</h1>
        {form.intro && <p className="mt-2 text-sm text-gray-600 whitespace-pre-line">{form.intro}</p>}
        {hasUploads && (
          <p className="mt-2 text-sm text-gray-600">Have ready: your driver licence, and your photos of the accident and the damage.</p>
        )}

        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3.5 text-[13px] leading-relaxed text-indigo-900">
          <p className="font-semibold">Your privacy</p>
          <p className="mt-0.5">
            What you type here, including your licence and photos, is sent securely to {business}. They use it to deal with this
            accident and any claim that follows, which can include passing it to the repairer or insurer handling the claim.
            Ask {business} if you want to see, correct or delete your information.
          </p>
        </div>

        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          {form.askWho && (
            <section aria-labelledby="sec-who" className={card}>
              <h2 id="sec-who" className="text-base font-semibold">About you</h2>
              <div className="grid grid-cols-12 gap-x-3 gap-y-3.5 mt-3">
                {WHO_FIELDS.map(f => (
                  <div key={f.id} id={`cell-who-${f.id}`} className="col-span-12">
                    <FieldInput field={f} sectionId="who" inputId={`f-who-${f.id}`} value={who[f.id as keyof Who]} onChange={v => setWhoField(f.id, String(v))}
                      error={errors[`who.${f.id}`]} autoComplete={f.id === 'name' ? 'name' : f.id === 'phone' ? 'tel' : 'email'} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {form.sections.map((s, i) => {
            const mine = answers[s.id] || {}
            return (
              <section key={s.id} aria-labelledby={`sec-${s.id}`} className={card}>
                <h2 id={`sec-${s.id}`} className="text-base font-semibold">{i + 1}. {s.title}</h2>
                <div className="grid grid-cols-12 gap-x-3 gap-y-3.5 mt-3">
                  {s.rows.flat().filter(f => isVisible(f, mine)).map(f => {
                    const key = `${s.id}.${f.id}`
                    return (
                      <div key={f.id} id={`cell-${s.id}-${f.id}`} className={spanClass(f.span)}>
                        <FieldInput
                          field={f}
                          sectionId={s.id}
                          inputId={`f-${s.id}-${f.id}`}
                          value={mine[f.id]}
                          onChange={v => setAnswer(s, f, v)}
                          pictures={pictures[key]}
                          onPictures={list => setPicture(s, f, list)}
                          error={errors[key]}
                          autoComplete={s.id === 'driver' ? AUTOFILL[f.id] || 'off' : 'off'}
                        />
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}

          <section className={card} id="cell-consent">
            <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
              <input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); setErrors(prev => { const { consent: _c, ...rest } = prev; return rest }) }}
                aria-invalid={!!errors.consent} className="mt-0.5 h-6 w-6 shrink-0 accent-indigo-600" />
              <span className="text-sm text-gray-800">I have read the privacy note above. I agree to send my details and photos to {business}.</span>
            </label>
            {errors.consent && <p role="alert" className="text-xs text-[#dc2626] mt-1.5">{errors.consent}</p>}

            {/* Real people never see this box. Programs that fill in every box do, and are ignored. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
              <label>Leave this empty<input type="text" name="hp_check" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)} /></label>
            </div>

            {submitError && <p role="alert" className="mt-3 text-sm text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] rounded-lg px-3 py-2">{submitError}</p>}

            <button type="submit" disabled={busy} className="mt-4 w-full min-h-[48px] rounded-lg bg-indigo-600 text-white text-base font-semibold hover:bg-indigo-700 disabled:opacity-60">
              {busy ? (progress > 0 && progress < 100 ? `Sending... ${progress}%` : 'Sending...') : 'Send form'}
            </button>
            {busy && <p className="mt-2 text-xs text-gray-500 text-center">Please wait. Photos can take a minute. Do not close this page.</p>}
          </section>
        </form>
      </main>
    </div>
  )
}
