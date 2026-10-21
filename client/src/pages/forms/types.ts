// Shapes shared by the Forms screens. The section list (SectionDef) comes from the server
// (GET /api/forms/library, built from server/src/config/claimForm.ts), so the boxes on every
// screen and in the PDF always match what the server accepts.

export type FieldType =
  | 'text' | 'textarea' | 'date' | 'time' | 'tel' | 'email' | 'number'
  | 'select' | 'radio' | 'checks' | 'yesno'
  | 'photo' | 'photos' | 'signature'

export interface FieldOption { value: string; label: string }

export interface FieldDef {
  id: string
  label: string
  type: FieldType
  span?: number
  required?: boolean
  options?: FieldOption[]
  placeholder?: string
  hint?: string
  maxLen?: number
  max?: number
  rows?: number
  unit?: string
  showIf?: { field: string; equals: string }
}

export type Filler = 'renter' | 'owner'

export interface SectionDef {
  id: string
  title: string
  filler: Filler
  blurb: string
  rows: FieldDef[][]
}

export interface FormTemplate {
  id: string
  name: string
  intro: string
  sectionIds: string[]
  code: string
  createdAt: string
  updatedAt: string
  sent: number
  submitted: number
}

export type EntryStatus = 'sent' | 'submitted' | 'completed'
export type EntryVia = 'email' | 'whatsapp' | 'copy' | 'link'

export interface FormEntryRow {
  id: string
  templateId: string
  templateName: string
  renterName: string
  renterPhone: string
  renterEmail: string
  via: EntryVia
  sentTo: string
  sentAt: string | null
  status: EntryStatus
  submittedAt: string | null
  completedAt: string | null
  createdAt: string
}

/** answers[sectionId][fieldId] */
export type Answers = Record<string, Record<string, any>>
/** pictures[sectionId][fieldId] = data URLs */
export type Pictures = Record<string, Record<string, string[]>>
/** counts[sectionId][fieldId] = how many pictures */
export type PictureCounts = Record<string, Record<string, number>>

/** One form that came back: the row, what the renter answered, and what the owner has filled in so far. */
export interface FormEntryDetail extends FormEntryRow {
  renterData: Answers
  ownerData: Answers
  fileCounts: PictureCounts
}
