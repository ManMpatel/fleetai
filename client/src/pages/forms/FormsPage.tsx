import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useStore } from '../../store/useStore'
import type { EntryStatus, FormEntryRow, FormTemplate, SectionDef } from './types'
import { copyText, formatWhen, formLink } from './util'
import TemplateModal from './TemplateModal'
import SendFormModal from './SendFormModal'
import EntryPanel from './EntryPanel'
import { downloadEntryPdf } from './entryPdf'
import { Spinner } from '../../components/BusyBar'

type Tab = 'templates' | 'history'
type Filter = 'all' | EntryStatus

const VIA: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', copy: 'Link copied', link: 'Came in through the link' }
const STATUS: Record<EntryStatus, { label: string; cls: string }> = {
  sent: { label: 'Sent', cls: 'bg-amber-bg text-amber' },
  submitted: { label: 'Submitted', cls: 'bg-accent-bg text-accent' },
  completed: { label: 'Completed', cls: 'bg-green-bg text-green' },
}

const smallBtn = 'px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-text-secondary hover:border-accent hover:text-text-primary'

export default function FormsPage() {
  const allowed = useStore(s => !!s.session?.features?.forms)
  const businessName = useStore(s => s.session?.org?.displayName) || 'your rental provider'
  const [tab, setTab] = useState<Tab>('templates')
  const [sections, setSections] = useState<SectionDef[]>([])
  const [templates, setTemplates] = useState<FormTemplate[]>([])
  const [entries, setEntries] = useState<FormEntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState<{ template?: FormTemplate } | null>(null)
  const [sending, setSending] = useState<{ template: FormTemplate; entry?: FormEntryRow } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)   // the form open in the side panel
  const [pdfBusy, setPdfBusy] = useState<string | null>(null) // the row whose PDF is being made

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const [lib, tpl, ent] = await Promise.all([
        axios.get<{ sections: SectionDef[] }>('/api/forms/library'),
        axios.get<{ templates: FormTemplate[] }>('/api/forms/templates'),
        axios.get<{ entries: FormEntryRow[] }>('/api/forms/entries'),
      ])
      setSections(lib.data.sections)
      setTemplates(tpl.data.templates)
      setEntries(ent.data.entries)
      setError('')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load Forms')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const titleOf = useMemo(() => new Map(sections.map(s => [s.id, s.title])), [sections])
  const templateById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return entries.filter(e => {
      if (filter !== 'all' && e.status !== filter) return false
      if (!q) return true
      return e.renterName.toLowerCase().includes(q) || e.templateName.toLowerCase().includes(q) ||
        e.renterEmail.toLowerCase().includes(q) || (digits.length >= 3 && e.renterPhone.replace(/\D/g, '').includes(digits))
    })
  }, [entries, filter, query])

  if (!allowed) {
    return <div className="flex-1 flex items-center justify-center p-8 text-sm text-text-muted">Forms are not available for this account.</div>
  }

  async function copyTemplateLink(t: FormTemplate) {
    setNotice((await copyText(formLink(t.code))) ? `Link copied for "${t.name}". Use Send to keep a record of who gets it.` : 'Could not copy. Select the link and copy it by hand.')
  }

  async function removeTemplate(t: FormTemplate) {
    if (!window.confirm(`Delete "${t.name}"? Its link stops working. Forms already sent stay in History.`)) return
    try {
      await axios.delete(`/api/forms/templates/${t.id}`)
      setNotice(`"${t.name}" deleted.`)
      load(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not delete the template')
    }
  }

  async function removeEntry(e: FormEntryRow) {
    if (!window.confirm(`Delete this form for ${e.renterName || 'this renter'}? Anything the renter sent back is deleted with it.`)) return
    try {
      await axios.delete(`/api/forms/entries/${e.id}`)
      setNotice('Deleted.')
      load(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not delete this form')
    }
  }

  async function copyEntryLink(e: FormEntryRow) {
    const t = templateById.get(e.templateId)
    if (!t) { setError('This template was deleted, so its link no longer works.'); return }
    setNotice((await copyText(formLink(t.code))) ? 'Link copied.' : 'Could not copy. Open the Templates tab and copy it from there.')
  }

  async function downloadPdf(e: FormEntryRow) {
    setPdfBusy(e.id)
    try {
      await downloadEntryPdf(e.id)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not make the PDF. Try again.')
    } finally {
      setPdfBusy(null)
    }
  }

  function sendAgain(e: FormEntryRow) {
    const t = templateById.get(e.templateId)
    if (!t) { setError('This template was deleted, so its link no longer works.'); return }
    setSending({ template: t, entry: e })
  }

  const counts = {
    all: entries.length,
    sent: entries.filter(e => e.status === 'sent').length,
    submitted: entries.filter(e => e.status === 'submitted').length,
    completed: entries.filter(e => e.status === 'completed').length,
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      <div className="px-6 py-5 border-b border-border bg-surface flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Forms</h1>
          <p className="text-text-muted text-sm mt-0.5">Build a form from the claim form, send its link to a renter, and keep every form in one place.</p>
        </div>
        <button onClick={() => setEditor({})} className="px-3 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90">+ New template</button>
      </div>

      <div className="px-6 py-5 space-y-4">
        <div className="flex gap-2">
          {(['templates', 'history'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${tab === t ? 'border-accent text-accent bg-accent-bg' : 'border-border text-text-secondary bg-surface hover:border-accent'}`}>
              {t === 'templates' ? `Templates (${templates.length})` : `History (${entries.length})`}
            </button>
          ))}
        </div>

        {notice && <p role="status" className="text-sm text-green bg-green-bg rounded-lg px-3 py-2">{notice}</p>}
        {error && (
          <p role="alert" className="text-sm text-red">
            {error} <button onClick={() => { setError(''); load() }} className="underline">Try again</button>
          </p>
        )}
        {loading && <p className="text-sm text-text-muted">Loading...</p>}

        {!loading && tab === 'templates' && (
          templates.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-8 text-center">
              <p className="text-sm text-text-primary font-medium">No templates yet</p>
              <p className="text-sm text-text-muted mt-1">A template is the claim form with the sections you pick. It has one link you can send to any renter.</p>
              <button onClick={() => setEditor({})} className="mt-4 px-3 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90">Make your first template</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {templates.map(t => {
                const names = t.sectionIds.map(id => titleOf.get(id) || id)
                return (
                  <div key={t.id} className="bg-surface border border-border rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-text-primary truncate">{t.name}</h3>
                        <p className="text-xs text-text-muted mt-0.5">{t.sectionIds.length} sections - {t.sent} sent - {t.submitted} sent back</p>
                      </div>
                      <div className="flex gap-3 shrink-0 text-xs">
                        <button onClick={() => setEditor({ template: t })} className="text-accent hover:underline">Edit</button>
                        <button onClick={() => removeTemplate(t)} className="text-red hover:underline">Delete</button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {names.slice(0, 6).map(n => <span key={n} className="text-[11px] px-2 py-0.5 rounded-full bg-surface2 border border-border text-text-secondary">{n}</span>)}
                      {names.length > 6 && <span className="text-[11px] px-2 py-0.5 text-text-muted">+{names.length - 6} more</span>}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <input readOnly value={formLink(t.code)} onFocus={e => e.currentTarget.select()} aria-label="Template link"
                        className="flex-1 min-w-0 px-2.5 py-1.5 bg-surface2 border border-border rounded-lg text-xs text-text-secondary focus:outline-none" />
                      <button onClick={() => copyTemplateLink(t)} className={smallBtn}>Copy link</button>
                      <button onClick={() => setSending({ template: t })} className="px-3 py-1 rounded-lg text-xs font-semibold bg-accent text-white hover:opacity-90">Send</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {!loading && tab === 'history' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {([['all', 'All'], ['sent', 'Sent'], ['submitted', 'Submitted'], ['completed', 'Completed']] as [Filter, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === key ? 'border-accent text-accent bg-accent-bg' : 'border-border text-text-secondary bg-surface hover:border-accent'}`}>
                  {label} ({counts[key]})
                </button>
              ))}
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, mobile, email or form" aria-label="Search forms"
                className="ml-auto w-72 px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
            </div>

            {entries.length === 0 ? (
              <p className="text-sm text-text-muted">Nothing sent yet. Open the Templates tab and press Send on a template.</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-text-muted">No forms match.</p>
            ) : (
              <div className="bg-surface border border-border rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                      <th className="px-4 py-2.5 font-semibold">Renter</th>
                      <th className="px-4 py-2.5 font-semibold">Form</th>
                      <th className="px-4 py-2.5 font-semibold">Sent</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(e => (
                      <tr key={e.id} className="border-b border-border last:border-0 align-top">
                        <td className="px-4 py-3">
                          {e.status === 'sent' ? (
                            <p className="font-medium text-text-primary">{e.renterName || 'Unknown renter'}</p>
                          ) : (
                            <button onClick={() => setOpenId(e.id)} className="font-medium text-text-primary hover:text-accent hover:underline text-left">{e.renterName || 'Unknown renter'}</button>
                          )}
                          <p className="text-xs text-text-muted">{e.renterPhone || e.renterEmail}</p>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{e.templateName}</td>
                        <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                          <p>{formatWhen(e.sentAt || e.createdAt)}</p>
                          <p className="text-xs text-text-muted">{VIA[e.via] || e.via}{e.via === 'email' && e.sentTo ? `: ${e.sentTo}` : ''}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span>
                          {e.submittedAt && <p className="text-[11px] text-text-muted mt-1">Back {formatWhen(e.submittedAt)}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            {e.status !== 'sent' && <button onClick={() => setOpenId(e.id)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-accent text-white hover:opacity-90">{e.status === 'submitted' ? 'Open & finish' : 'Open'}</button>}
                            {e.status !== 'sent' && (
                              <button onClick={() => downloadPdf(e)} disabled={pdfBusy !== null} className={`${smallBtn} disabled:opacity-50`}>
                                {pdfBusy === e.id ? <span className="inline-flex items-center gap-1.5"><Spinner className="w-3 h-3" /> PDF...</span> : 'PDF'}
                              </button>
                            )}
                            {e.status === 'sent' && <button onClick={() => sendAgain(e)} className={smallBtn}>Send again</button>}
                            <button onClick={() => copyEntryLink(e)} className={smallBtn}>Copy link</button>
                            <button onClick={() => removeEntry(e)} className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-red hover:border-red">Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {editor && (
        <TemplateModal
          sections={sections}
          template={editor.template}
          onClose={() => setEditor(null)}
          onSaved={t => {
            setEditor(null)
            setNotice(editor.template ? `"${t.name}" saved.` : `"${t.name}" is ready. Press Send on it to send the link to a renter.`)
            load(true)
          }}
        />
      )}

      {openId && (
        <EntryPanel
          entryId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => load(true)}
          onNotice={setNotice}
        />
      )}

      {sending && (
        <SendFormModal
          template={sending.template}
          entry={sending.entry}
          businessName={businessName}
          onClose={() => setSending(null)}
          onDone={message => {
            setSending(null)
            setNotice(message)
            setTab('history')
            load(true)
          }}
        />
      )}
    </div>
  )
}
