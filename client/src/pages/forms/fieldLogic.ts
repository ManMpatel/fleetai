// Small rules shared by the renter's page, the owner's panel and the PDF. They mirror what the
// server accepts (server/src/config/claimFormData.ts); the server still checks everything again.

import type { FieldDef, FieldType } from './types'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const NUMBER = /^\d{1,7}(\.\d{1,2})?$/

export function isPictureType(type: FieldType): boolean {
  return type === 'photo' || type === 'photos' || type === 'signature'
}

/** Today as yyyy-mm-dd in the phone's own time zone (the renter's "today"). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/** Is this box showing, given the answers in its section? */
export function isVisible(f: FieldDef, sectionAnswers: Record<string, any> | undefined): boolean {
  if (!f.showIf) return true
  return sectionAnswers?.[f.showIf.field] === f.showIf.equals
}

export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2100
}

/** "" when the value is fine (or empty), otherwise a short message for the person filling it in. */
export function validateValue(f: FieldDef, v: unknown, sectionId: string): string {
  if (isEmpty(v)) return ''
  const s = typeof v === 'string' ? v.trim() : ''
  switch (f.type) {
    case 'tel': {
      const digits = s.replace(/\D/g, '').length
      // The driver's own mobile is how the form is matched to the renter, so it has to be complete.
      if (sectionId === 'driver' && f.id === 'mobile') return digits >= 9 ? '' : 'Type your full mobile number'
      return digits >= 6 ? '' : 'That does not look like a phone number'
    }
    case 'email': return EMAIL.test(s) ? '' : 'That does not look like an email address'
    case 'number': return NUMBER.test(s) ? '' : 'Type a number (digits only)'
    case 'date': return isRealDate(s) ? '' : 'Choose a real date'
    case 'time': return TIME.test(s) ? '' : 'Choose a real time'
    default: return ''
  }
}

/** 2026-10-14 -> 14/10/2026 */
export function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** 14:05 -> 2:05 PM */
export function formatTime(t: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(t)
  if (!m) return t
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`
}

export function optionLabel(f: FieldDef, value: string): string {
  return f.options?.find(o => o.value === value)?.label ?? value
}

/** What an answer reads like on the owner's screen. */
export function displayValue(f: FieldDef, v: unknown): string {
  if (isEmpty(v)) return ''
  switch (f.type) {
    case 'yesno': return v === 'yes' ? 'Yes' : v === 'no' ? 'No' : String(v)
    case 'radio':
    case 'select': return optionLabel(f, String(v))
    case 'checks': return Array.isArray(v) ? v.map(x => optionLabel(f, String(x))).join(', ') : String(v)
    case 'date': return formatDate(String(v))
    case 'time': return formatTime(String(v))
    case 'number': return f.unit ? `${v} ${f.unit}` : String(v)
    default: return String(v)
  }
}

/** The merged answers: what the renter sent, with the owner's own answers on top of the same boxes. */
export function mergeAnswers(...layers: Array<Record<string, Record<string, any>> | undefined>): Record<string, Record<string, any>> {
  const out: Record<string, Record<string, any>> = {}
  for (const layer of layers) {
    if (!layer) continue
    for (const [sectionId, fields] of Object.entries(layer)) {
      out[sectionId] = { ...(out[sectionId] || {}), ...fields }
    }
  }
  return out
}