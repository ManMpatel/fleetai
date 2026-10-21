import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import type { Answers, FieldDef, FormEntryDetail, Pictures, SectionDef } from './types'
import FieldInput, { spanClass } from './FieldInput'
import { displayValue, isEmpty, isPictureType, isVisible, mergeAnswers, validateValue } from './fieldLogic'
import { buildEntryPdf, pdfFileName, saveBytes } from './entryPdf'
import { formatWhen } from './util'
import { Spinner } from '../../components/BusyBar'

// The panel that opens over the Forms page for a form the renter has sent back: what he answered
// (read only), his pictures, and the owner's own boxes to fill in, with Save, Mark completed and
// Download PDF. The pictures are fetched after the answers so the panel opens straight away.

type Detail = { entry: FormEntryDetail; sections: SectionDef[]; ownerDefaults: Answers }

const STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'bg-accent-bg text-accent' },
  completed: { label: 'Completed', cls: 'bg-green-bg text-green' },
}

const fieldsOf = (s: SectionDef): FieldDef[] => s.rows.flat()

function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={name} className="fixed inset-0 z-[70] bg-black/80 flex flex-col items-center justify-center p-4" onClick={onClose}>
      <img src={src} alt={name} className="max-h-[85vh] max-w-full object-contain rounded-lg bg-white" onClick={e => e.stopPropagation()} />
      <div className="mt-3 flex gap-3" onClick={e => e.stopPropagation()}>
        <a href={src} download={`${name}.${src.startsWith('data:image/png') ? 'png' : 'jpg'}`} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-gray-900">Download picture</a>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/20 text-white">Close</button>
      </div>
    </div>
  )
}

export default function EntryPanel({ entryId, onClose, onChanged, onNotice }: {
  entryId: string
  onClose: () => void
  /** The row changed (saved, completed): the history behind the panel should reload. */
  onChanged: () => void
  onNotice: (message: string) => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [files, setFiles] = useState<Pictures | null>(null)
  const [filesError, setFilesError] = useState(false)
  const [owner, setOwner] = useState<Answers>({})
  const [saved, setSaved] = useState('')            // JSON of the owner's part as last saved / loaded
  const [error, setError] = useState('')
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'' | 'save' | 'done' | 'pdf'>('')
  const [loadError, setLoadError] = useState('')
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null)
  const [flash, setFlash] = useState('')              // "Saved." for a few seconds, shown in the footer
  const closeRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const { data } = await axios.get<Detail>(`/api/forms/entries/${entryId}`)
      setDetail(data)
      const ownerIds = new Set(data.sections.filter(s => s.filler === 'owner').map(s => s.id))
      // The owner's boxes start as his saved answers on top of the suggestions from his records.
      const start: Answers = {}
      for (const [id, v] of Object.entries(mergeAnswers(data.ownerDefaults, data.entry.ownerData))) if (ownerIds.has(id)) start[id] = v
      setOwner(start)
      setSaved(JSON.stringify(start))
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Could not open this form')
    }
    try {
      const { data } = await axios.get<{ files: Pictures }>(`/api/forms/entries/${entryId}/files`)
      setFiles(data.files)
      setFilesError(false)
    } catch {
      setFilesError(true)
    }
  }, [entryId])

  useEffect(() => { load() }, [load])
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(''), 4000)
    return () => clearTimeout(timer)
  }, [flash])

  const dirty = detail !== null && JSON.stringify(owner) !== saved

  const close = useCallback(() => {
    if (dirty && !window.confirm('You have changes that are not saved. Close anyway?')) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lightbox) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, lightbox])

  const renterSections = useMemo(() => detail?.sections.filter(s => s.filler === 'renter') || [], [detail])
  const ownerSections = useMemo(() => detail?.sections.filter(s => s.filler === 'owner') || [], [detail])
  const suggested = useMemo(() => {
    // Boxes that hold a suggestion nobody has saved yet, so the owner knows to check them.
    if (!detail) return false
    return ownerSections.some(s => fieldsOf(s).some(f => !isEmpty(detail.ownerDefaults[s.id]?.[f.id]) && isEmpty(detail.entry.ownerData[s.id]?.[f.id])))
  }, [detail, ownerSections])

  function setOwnerValue(section: SectionDef, field: FieldDef, value: unknown) {
    setOwner(prev => {
      const mine: Record<string, any> = { ...(prev[section.id] || {}), [field.id]: value }
      for (const f of fieldsOf(section)) if (f.showIf && !isVisible(f, mine)) delete mine[f.id]
      return { ...prev, [section.id]: mine }
    })
    setProblems(prev => { const { [`${section.id}.${field.id}`]: _gone, ...rest } = prev; return rest })
  }

  function checkOwner(): Record<string, string> {
    const found: Record<string, string> = {}
    for (const s of ownerSections) {
      for (const f of fieldsOf(s)) {
        if (!isVisible(f, owner[s.id])) continue
        const bad = validateValue(f, typeof owner[s.id]?.[f.id] === 'string' ? (owner[s.id][f.id] as string).trim() : owner[s.id]?.[f.id], s.id)
        if (bad) found[`${s.id}.${f.id}`] = bad
      }
    }
    return found
  }

  async function save(status?: 'completed' | 'submitted') {
    if (!detail) return
    const found = checkOwner()
    setProblems(found)
    if (Object.keys(found).length > 0) { setError('Check the boxes marked in red.'); return }
    setError('')
    setBusy(status === 'completed' ? 'done' : 'save')
    try {
      // Only the boxes that are showing and have something in them are sent.
      const data: Answers = {}
      for (const s of ownerSections) {
        for (const f of fieldsOf(s)) {
          const v = owner[s.id]?.[f.id]
          if (!isVisible(f, owner[s.id]) || isEmpty(v) || (typeof v === 'string' && !v.trim())) continue
          data[s.id] = { ...(data[s.id] || {}), [f.id]: typeof v === 'string' ? v.trim() : v }
        }
      }
      const { data: res } = await axios.put<{ entry: FormEntryDetail }>(`/api/forms/entries/${entryId}/owner`, { data, ...(status ? { status } : {}) })
      setDetail(prev => prev ? { ...prev, entry: res.entry } : prev)
      setSaved(JSON.stringify(owner))
      onChanged()
      const message = status === 'completed' ? 'Marked as completed.' : status === 'submitted' ? 'Reopened.' : 'Saved.'
      setFlash(message)
      onNotice(message)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not save. Try again.')
    } finally {
      setBusy('')
    }
  }

  async function downloadPdf() {
    if (!detail) return
    setBusy('pdf')
    setError('')
    try {
      let pictures = files
      if (!pictures) pictures = (await axios.get<{ files: Pictures }>(`/api/forms/entries/${entryId}/files`)).data.files
      const bytes = await buildEntryPdf(detail.entry, detail.sections, owner, pictures)
      saveBytes(bytes, pdfFileName(detail.entry))
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not make the PDF. Try again.')
    } finally {
      setBusy('')
    }
  }

  const entry = detail?.entry
  const chip = entry ? STATUS[entry.status] : null
  const btn = 'px-3 py-2 rounded-lg text-sm font-medium border border-border text-text-secondary hover:border-accent hover:text-text-primary disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label="Form from renter" className="w-full max-w-2xl h-full bg-bg border-l border-border flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-surface border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text-primary truncate">{entry?.renterName || 'Form'}</h2>
            <p className="text-xs text-text-muted mt-0.5 truncate">
              {entry ? `${entry.templateName}${entry.renterPhone ? ` - ${entry.renterPhone}` : ''}${entry.submittedAt ? ` - sent back ${formatWhen(entry.submittedAt)}` : ''}` : 'Loading...'}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {chip && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${chip.cls}`}>{chip.label}</span>}
            <button ref={closeRef} onClick={close} aria-label="Close" className="text-text-muted hover:text-text-primary text-xl leading-none px-1">&times;</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loadError && (
            <p role="alert" className="text-sm text-red">{loadError} <button onClick={load} className="underline">Try again</button></p>
          )}
          {!detail && !loadError && <p className="text-sm text-text-muted">Loading...</p>}

          {detail && (
            <>
              <section aria-label="What the renter sent" className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">What the renter sent</h3>
                {renterSections.map(s => {
                  const answered = fieldsOf(s).filter(f => !isPictureType(f.type) && isVisible(f, detail.entry.renterData[s.id]) && !isEmpty(detail.entry.renterData[s.id]?.[f.id]))
                  const pictureBoxes = fieldsOf(s).filter(f => isPictureType(f.type) && (detail.entry.fileCounts[s.id]?.[f.id] || 0) > 0)
                  return (
                    <div key={s.id} className="bg-surface border border-border rounded-xl p-4">
                      <h4 className="text-sm font-semibold text-text-primary">{s.title}</h4>
                      {answered.length === 0 && pictureBoxes.length === 0 && <p className="text-xs text-text-muted mt-1">Nothing was filled in.</p>}
                      {answered.length > 0 && (
                        <dl className="mt-2 divide-y divide-border">
                          {answered.map(f => (
                            <div key={f.id} className="py-1.5 grid grid-cols-[40%_1fr] gap-3 text-sm">
                              <dt className="text-text-muted">{f.label}</dt>
                              <dd className="text-text-primary whitespace-pre-wrap break-words">{displayValue(f, detail.entry.renterData[s.id][f.id])}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {pictureBoxes.map(f => {
                        const list = files?.[s.id]?.[f.id] || []
                        const expected = detail.entry.fileCounts[s.id]?.[f.id] || 0
                        return (
                          <div key={f.id} className="mt-3">
                            <p className="text-xs text-text-muted mb-1.5">{f.label}</p>
                            <div className="flex flex-wrap gap-2">
                              {list.length > 0
                                ? list.map((src, i) => (
                                    <button key={i} type="button" onClick={() => setLightbox({ src, name: `${f.label}${list.length > 1 ? ` ${i + 1}` : ''}` })}
                                      className="rounded-lg border border-border bg-white p-0.5 hover:border-accent" aria-label={`Open ${f.label}${list.length > 1 ? ` ${i + 1}` : ''}`}>
                                      <img src={src} alt={f.label} className={f.type === 'signature' ? 'h-16 w-40 object-contain' : 'h-24 w-24 object-cover rounded-md'} />
                                    </button>
                                  ))
                                : Array.from({ length: expected }).map((_, i) => (
                                    <div key={i} className="h-24 w-24 rounded-lg bg-surface2 border border-border flex items-center justify-center text-[11px] text-text-muted">
                                      {filesError ? 'Not loaded' : 'Loading'}
                                    </div>
                                  ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
                {filesError && <p className="text-xs text-red">The pictures could not be loaded. <button onClick={load} className="underline">Try again</button></p>}
              </section>

              {ownerSections.length > 0 && (
                <section aria-label="Your part" className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Your part</h3>
                  {suggested && <p className="text-xs text-text-secondary bg-accent-bg rounded-lg px-3 py-2">Some boxes are filled in from your records (the renter's car and your business details). Check them, change what is wrong, then press Save.</p>}
                  {ownerSections.map(s => (
                    <div key={s.id} className="bg-surface border border-border rounded-xl p-4">
                      <h4 className="text-sm font-semibold text-text-primary">{s.title}</h4>
                      <div className="grid grid-cols-12 gap-x-3 gap-y-3 mt-3">
                        {fieldsOf(s).filter(f => isVisible(f, owner[s.id])).map(f => (
                          <div key={f.id} className={spanClass(f.span)}>
                            <FieldInput field={f} sectionId={s.id} inputId={`own-${s.id}-${f.id}`} tone="app" value={owner[s.id]?.[f.id]}
                              onChange={v => setOwnerValue(s, f, v)} error={problems[`${s.id}.${f.id}`]} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>

        {detail && entry && (
          <div className="px-5 py-3 bg-surface border-t border-border">
            {error && <p role="alert" className="text-xs text-red mb-2">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span role="status" className={`text-xs mr-auto ${flash && !dirty ? 'text-green font-medium' : 'text-text-muted'}`}>
                {dirty ? 'You have changes that are not saved.' : flash || (entry.status === 'completed' ? `Completed ${formatWhen(entry.completedAt)}` : 'Nothing to save.')}
              </span>
              <button onClick={downloadPdf} disabled={busy !== ''} className={btn}>
                {busy === 'pdf' ? <span className="inline-flex items-center gap-1.5"><Spinner /> Making PDF...</span> : 'Download PDF'}
              </button>
              {ownerSections.length > 0 && <button onClick={() => save()} disabled={busy !== '' || (!dirty && !suggested)} className={btn}>{busy === 'save' ? 'Saving...' : 'Save'}</button>}
              {entry.status === 'completed' ? (
                <button onClick={() => save('submitted')} disabled={busy !== ''} className={btn}>{busy === 'save' ? 'Working...' : 'Reopen'}</button>
              ) : (
                <button onClick={() => save('completed')} disabled={busy !== ''} className="px-3 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90 disabled:opacity-50">
                  {busy === 'done' ? 'Saving...' : 'Save & mark completed'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {lightbox && <Lightbox src={lightbox.src} name={lightbox.name} onClose={() => setLightbox(null)} />}
    </div>
  )
}