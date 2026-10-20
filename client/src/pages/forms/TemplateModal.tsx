import { useState } from 'react'
import axios from 'axios'
import type { FormTemplate, SectionDef } from './types'

const input = 'w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent'

// Make a template (or change one): give it a name and tick the sections of the claim form to use.
// The link of a template never changes when it is edited.
export default function TemplateModal({ sections, template, onClose, onSaved }: {
  sections: SectionDef[]
  template?: FormTemplate
  onClose: () => void
  onSaved: (template: FormTemplate) => void
}) {
  const [name, setName] = useState(template?.name ?? '')
  const [intro, setIntro] = useState(template?.intro ?? '')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(template ? template.sectionIds : sections.map(s => s.id)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const renterPicked = sections.filter(s => picked.has(s.id) && s.filler === 'renter').length

  function toggle(id: string) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    if (!name.trim()) { setError('Give the template a name'); return }
    if (renterPicked === 0) { setError('Tick at least one section for the renter to fill in'); return }
    setSaving(true)
    setError('')
    try {
      const body = { name: name.trim(), intro: intro.trim(), sectionIds: sections.filter(s => picked.has(s.id)).map(s => s.id) }
      const { data } = template
        ? await axios.put<{ template: FormTemplate }>(`/api/forms/templates/${template.id}`, body)
        : await axios.post<{ template: FormTemplate }>('/api/forms/templates', body)
      onSaved(data.template)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not save the template')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-text-primary">{template ? 'Edit template' : 'New template'}</h2>
          <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 pb-2 overflow-y-auto">
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Template name</label>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. Accident claim form" className={input} autoFocus />

          <label className="block text-xs font-medium text-text-secondary mt-4 mb-1.5">Message at the top of the form <span className="text-text-muted font-normal">(optional)</span></label>
          <textarea value={intro} onChange={e => setIntro(e.target.value)} maxLength={600} rows={2} placeholder="e.g. Please fill this in about the accident. It takes about 10 minutes." className={`${input} resize-none`} />

          <div className="flex items-end justify-between mt-5 mb-2">
            <div>
              <p className="text-xs font-medium text-text-secondary">Sections of the claim form</p>
              <p className="text-[11px] text-text-muted mt-0.5">Tick the ones this template should have. The renter fills in the "Renter" ones on his phone; you fill in the "You" ones after he sends it back.</p>
            </div>
            <div className="flex gap-3 text-xs shrink-0 ml-3">
              <button onClick={() => setPicked(new Set(sections.map(s => s.id)))} className="text-accent hover:underline">Tick all</button>
              <button onClick={() => setPicked(new Set())} className="text-text-muted hover:underline">Clear</button>
            </div>
          </div>

          <div className="space-y-2 pb-2">
            {sections.map(s => {
              const on = picked.has(s.id)
              return (
                <label key={s.id} className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors ${on ? 'border-accent bg-accent-bg' : 'border-border bg-surface2 hover:border-accent'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="mt-0.5 w-4 h-4 accent-[var(--accent)] shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text-primary">{s.title}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${s.filler === 'renter' ? 'bg-green-bg text-green' : 'bg-amber-bg text-amber'}`}>
                        {s.filler === 'renter' ? 'Renter fills in' : 'You fill in'}
                      </span>
                    </span>
                    <span className="block text-xs text-text-muted mt-0.5">{s.blurb}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border">
          {error && <p role="alert" className="text-xs text-red mb-3">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-text-secondary border border-border hover:border-accent">Cancel</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90 disabled:opacity-60">
              {saving ? 'Saving...' : template ? 'Save changes' : 'Create template'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
