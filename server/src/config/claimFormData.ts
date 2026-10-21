/**
 * What a filled-in claim form is allowed to contain, and what is missing from it.
 *
 * The renter's phone and the owner's screen both send answers here; nothing they send is stored
 * until it has been through these functions. Answers are checked against the section list in
 * claimForm.ts: unknown sections and boxes are dropped, every value is cut to a sane length and
 * checked for its type, boxes that are not showing (showIf) are dropped, and pictures must be real
 * JPEG / PNG / WebP data and within the size limits.
 */

import type { FieldDef, SectionDef } from './claimForm'

/** data[sectionId][fieldId] */
export type Answers = Record<string, Record<string, any>>
/** files[sectionId][fieldId] = data URLs */
export type Pictures = Record<string, Record<string, string[]>>
/** counts[sectionId][fieldId] = how many pictures were sent (nested like the answers: MongoDB keys cannot hold a dot) */
export type PictureCounts = Record<string, Record<string, number>>

export function pictureCount(counts: PictureCounts | undefined | null, sectionId: string, fieldId: string): number {
  const n = counts?.[sectionId]?.[fieldId]
  return typeof n === 'number' ? n : 0
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const NUMBER = /^\d{1,7}(\.\d{1,2})?$/
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/

// A real picture starts with these bytes (as base64). Cheap proof that the data is an image and not
// something dressed up as one.
const MAGIC: Record<string, string> = { jpeg: '/9j/', png: 'iVBORw0KGgo', webp: 'UklGR' }

export const MAX_IMAGE_CHARS = 3_000_000      // one picture, about 2.2 MB
export const MAX_SIGNATURE_CHARS = 600_000
export const MAX_TOTAL_IMAGE_CHARS = 12_000_000 // all pictures of one form; a MongoDB document holds 16 MB

export function isPictureField(f: FieldDef): boolean {
  return f.type === 'photo' || f.type === 'photos' || f.type === 'signature'
}

export function validDate(s: string): boolean {
  if (!DATE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2100
}

function text(x: unknown, max: number, multiline = false): string {
  if (typeof x !== 'string') return ''
  let s = x.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  if (!multiline) s = s.replace(/\n+/g, ' ')
  return s.trim().slice(0, max)
}

export function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/** Is this box showing, given the answers already given in its section? */
export function isVisible(f: FieldDef, sectionAnswers: Record<string, any> | undefined): boolean {
  if (!f.showIf) return true
  return sectionAnswers?.[f.showIf.field] === f.showIf.equals
}

/** A cleaned value, or { error } when what was typed is not usable. Empty is fine (undefined). */
function cleanValue(f: FieldDef, raw: unknown): { value?: string | string[]; error?: string } {
  switch (f.type) {
    case 'text': {
      const v = text(raw, f.maxLen ?? 200)
      return v ? { value: v } : {}
    }
    case 'textarea': {
      const v = text(raw, f.maxLen ?? 3000, true)
      return v ? { value: v } : {}
    }
    case 'tel': {
      const v = typeof raw === 'string' ? raw.replace(/[^\d+()\-\s]/g, '').trim().slice(0, 30) : ''
      if (!v) return {}
      return v.replace(/\D/g, '').length >= 6 ? { value: v } : { error: 'does not look like a phone number' }
    }
    case 'email': {
      const v = text(raw, 120).toLowerCase()
      if (!v) return {}
      return EMAIL.test(v) ? { value: v } : { error: 'does not look like an email address' }
    }
    case 'number': {
      const v = text(raw, 12)
      if (!v) return {}
      return NUMBER.test(v) ? { value: v } : { error: 'must be a number' }
    }
    case 'date': {
      const v = text(raw, 10)
      if (!v) return {}
      return validDate(v) ? { value: v } : { error: 'is not a real date' }
    }
    case 'time': {
      const v = text(raw, 5)
      if (!v) return {}
      return TIME.test(v) ? { value: v } : { error: 'is not a real time' }
    }
    case 'select':
    case 'radio': {
      if (typeof raw !== 'string' || raw === '') return {}
      return (f.options || []).some(o => o.value === raw) ? { value: raw } : { error: 'is not one of the choices' }
    }
    case 'yesno': {
      if (raw === 'yes' || raw === 'no') return { value: raw }
      return {}
    }
    case 'checks': {
      if (!Array.isArray(raw)) return {}
      const wanted = new Set(raw.filter((x): x is string => typeof x === 'string'))
      const picked = (f.options || []).map(o => o.value).filter(v => wanted.has(v))
      return picked.length ? { value: picked } : {}
    }
    default:
      return {}
  }
}

export interface CleanAnswers { data: Answers; errors: string[] }

/** Cleans the answers for the given sections (pictures are separate, see cleanPictures). */
export function cleanAnswers(sections: SectionDef[], raw: unknown): CleanAnswers {
  const data: Answers = {}
  const errors: string[] = []
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {}

  for (const section of sections) {
    const given = input[section.id] && typeof input[section.id] === 'object' && !Array.isArray(input[section.id]) ? input[section.id] : {}
    const out: Record<string, any> = {}
    // First pass: every box that is not a picture. Second pass drops boxes that are not showing.
    for (const f of section.rows.flat()) {
      if (isPictureField(f)) continue
      const { value, error } = cleanValue(f, given[f.id])
      if (error) errors.push(`${section.title}: "${f.label}" ${error}`)
      else if (value !== undefined) out[f.id] = value
    }
    for (const f of section.rows.flat()) {
      if (f.showIf && !isVisible(f, out)) delete out[f.id]
    }
    if (Object.keys(out).length > 0) data[section.id] = out
  }
  return { data, errors }
}

export interface CleanPictures { files: Pictures; counts: PictureCounts; errors: string[] }

/** Checks the pictures of the given sections. */
export function cleanPictures(sections: SectionDef[], raw: unknown): CleanPictures {
  const files: Pictures = {}
  const counts: PictureCounts = {}
  const errors: string[] = []
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {}
  let total = 0

  for (const section of sections) {
    const given = input[section.id] && typeof input[section.id] === 'object' ? input[section.id] : {}
    for (const f of section.rows.flat()) {
      if (!isPictureField(f)) continue
      let list: unknown[] = Array.isArray(given[f.id]) ? given[f.id] : typeof given[f.id] === 'string' ? [given[f.id]] : []
      const most = f.type === 'photos' ? (f.max ?? 6) : 1
      if (list.length > most) { errors.push(`${section.title}: "${f.label}" can have at most ${most} picture${most === 1 ? '' : 's'}`); list = list.slice(0, most) }

      const kept: string[] = []
      for (const item of list) {
        const limit = f.type === 'signature' ? MAX_SIGNATURE_CHARS : MAX_IMAGE_CHARS
        if (typeof item !== 'string' || item.length > limit) { errors.push(`${section.title}: a picture in "${f.label}" is too large`); continue }
        const m = DATA_URL.exec(item)
        if (!m || !m[2].startsWith(MAGIC[m[1]])) { errors.push(`${section.title}: a file in "${f.label}" is not a picture`); continue }
        if (f.type === 'signature' && m[1] !== 'png') { errors.push(`${section.title}: the signature is not valid`); continue }
        total += item.length
        kept.push(item)
      }
      if (kept.length > 0) {
        files[section.id] = files[section.id] || {}
        files[section.id][f.id] = kept
        counts[section.id] = counts[section.id] || {}
        counts[section.id][f.id] = kept.length
      }
    }
  }
  if (total > MAX_TOTAL_IMAGE_CHARS) errors.push('The pictures are too large together. Remove a few and send again.')
  return { files, counts, errors }
}

/** Labels of the required boxes that are showing and still empty. Pictures are checked by count. */
export function missingRequired(sections: SectionDef[], data: Answers, counts: PictureCounts): string[] {
  const missing: string[] = []
  for (const section of sections) {
    const answers = data[section.id]
    for (const f of section.rows.flat()) {
      if (!f.required || !isVisible(f, answers)) continue
      const empty = isPictureField(f) ? pictureCount(counts, section.id, f.id) === 0 : isEmpty(answers?.[f.id])
      if (empty) missing.push(`${section.title}: ${f.label}`)
    }
  }
  return missing
}

/** Age in whole years on a given day, or null when the date of birth is not a real date. */
export function ageOn(dob: unknown, onDay: Date = new Date()): number | null {
  if (typeof dob !== 'string' || !validDate(dob)) return null
  const [y, m, d] = dob.split('-').map(Number)
  let age = onDay.getUTCFullYear() - y
  const beforeBirthday = onDay.getUTCMonth() + 1 < m || (onDay.getUTCMonth() + 1 === m && onDay.getUTCDate() < d)
  if (beforeBirthday) age -= 1
  return age
}

export interface Identity { name: string; phone: string; email: string; errors: string[] }

/** Who is sending the form, when the template has no driver section to say so. */
export function cleanIdentity(raw: unknown): Identity {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {}
  const errors: string[] = []
  const name = text(input.name, 80)
  const phoneText = typeof input.phone === 'string' ? input.phone.replace(/[^\d+()\-\s]/g, '').trim().slice(0, 30) : ''
  const email = text(input.email, 120).toLowerCase()
  if (!name) errors.push('Please type your name')
  if (phoneText.replace(/\D/g, '').length < 9) errors.push('Please type your mobile number')
  if (email && !EMAIL.test(email)) errors.push('Your email address does not look right')
  return { name, phone: phoneText, email: EMAIL.test(email) ? email : '', errors }
}