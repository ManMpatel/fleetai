/**
 * The claim form, as data.
 *
 * "Motor Vehicle Accident Notification & Claim Form" is split into sections. An owner builds a
 * template by ticking the sections he wants; the renter fills in the renter sections on his phone
 * (public link) and the owner fills in the owner sections afterwards.
 *
 * This one list drives everything, so the pieces can never disagree:
 *   - the template builder (section names, who fills it in),
 *   - the renter's page and the owner's screen (which boxes to draw),
 *   - the server (which answers are accepted and which are required),
 *   - the PDF (the boxes printed on the page).
 *
 * Section order here is the order on the page and in the PDF. Field ids only need to be unique
 * inside their section: answers are stored as data[sectionId][fieldId].
 */

export type FieldType =
  | 'text' | 'textarea' | 'date' | 'time' | 'tel' | 'email' | 'number'
  | 'select' | 'radio' | 'checks' | 'yesno'
  | 'photo' | 'photos' | 'signature'

export interface FieldOption { value: string; label: string }

export interface FieldDef {
  id: string
  label: string
  type: FieldType
  /** Columns out of 12 on the form grid (default 12). A row's spans add up to 12. */
  span?: number
  /** Renter fields only: the renter cannot send the form without it (when the box is showing). */
  required?: boolean
  options?: FieldOption[]
  placeholder?: string
  hint?: string
  maxLen?: number
  /** photos: the most pictures allowed (photo is always 1). */
  max?: number
  /** textarea: how many lines tall. */
  rows?: number
  /** number: shown after the box, e.g. km/hr. */
  unit?: string
  /** Show this box only when another box of the same section has this answer. */
  showIf?: { field: string; equals: string }
}

export type Filler = 'renter' | 'owner'

export interface SectionDef {
  id: string
  title: string
  filler: Filler
  /** One line shown in the template builder. */
  blurb: string
  rows: FieldDef[][]
}

const STATES: FieldOption[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'].map(s => ({ value: s, label: s }))

const DAMAGE_AREAS: FieldOption[] = [
  ['front', 'Front'], ['frontLeft', 'Front left'], ['frontRight', 'Front right'],
  ['left', 'Left side'], ['right', 'Right side'],
  ['rearLeft', 'Rear left'], ['rearRight', 'Rear right'], ['rear', 'Rear'],
  ['bonnet', 'Bonnet'], ['roof', 'Roof'], ['boot', 'Boot'],
  ['windscreen', 'Windscreen'], ['rearWindow', 'Rear window'], ['mirrors', 'Mirrors'],
  ['wheels', 'Wheels / tyres'], ['underneath', 'Underneath'],
].map(([value, label]) => ({ value, label }))

export const FORM_SECTIONS: SectionDef[] = [
  {
    id: 'claim',
    title: 'Claim type & vehicle',
    filler: 'owner',
    blurb: 'Member number, claim or notification, and the vehicle details. You fill this in after the renter sends the form.',
    rows: [
      [
        { id: 'memberNumber', label: 'Member number', type: 'text', span: 7, maxLen: 40 },
        { id: 'claimType', label: 'Please tick one', type: 'radio', span: 5, options: [{ value: 'claim', label: 'Claim' }, { value: 'notification', label: 'Notification only' }] },
      ],
      [
        { id: 'fleet', label: 'Fleet', type: 'text', span: 4, maxLen: 60 },
        { id: 'registration', label: 'Registration', type: 'text', span: 4, maxLen: 20 },
        { id: 'kilometres', label: "Kilometre's", type: 'number', span: 4 },
      ],
      [
        { id: 'make', label: 'Make', type: 'text', span: 4, maxLen: 40 },
        { id: 'model', label: 'Model', type: 'text', span: 4, maxLen: 60 },
        { id: 'monthYear', label: 'Month & Year', type: 'text', span: 4, maxLen: 20 },
      ],
      [
        { id: 'ownerName', label: 'Registered owner name', type: 'text', span: 8, maxLen: 100 },
        { id: 'ownerMobile', label: 'Mobile', type: 'tel', span: 4 },
      ],
      [
        { id: 'ownerAddress', label: 'Address', type: 'text', span: 8, maxLen: 160 },
        { id: 'ownerSuburb', label: 'Suburb', type: 'text', span: 4, maxLen: 60 },
      ],
      [
        { id: 'ownerEmail', label: 'Email', type: 'email', span: 12 },
      ],
    ],
  },
  {
    id: 'driver',
    title: 'Driver details',
    filler: 'renter',
    blurb: 'Name, address, date of birth, mobile, licence number, and the alcohol and breath-test questions.',
    rows: [
      [
        { id: 'firstName', label: 'First name', type: 'text', span: 6, required: true, maxLen: 60 },
        { id: 'surname', label: 'Surname', type: 'text', span: 6, required: true, maxLen: 60 },
      ],
      [
        { id: 'address', label: 'Address', type: 'text', span: 8, maxLen: 160 },
        { id: 'suburb', label: 'Suburb', type: 'text', span: 4, maxLen: 60 },
      ],
      [
        { id: 'state', label: 'State', type: 'select', span: 4, options: STATES },
        { id: 'postcode', label: 'Postcode', type: 'text', span: 4, maxLen: 6 },
        { id: 'dob', label: 'Date of birth', type: 'date', span: 4, required: true },
      ],
      [
        { id: 'mobile', label: 'Mobile', type: 'tel', span: 6, required: true },
        { id: 'homeWork', label: 'Home / work phone', type: 'tel', span: 6 },
      ],
      [
        { id: 'email', label: 'Driver email', type: 'email', span: 12 },
      ],
      [
        { id: 'licenceNumber', label: 'Licence number', type: 'text', span: 4, required: true, maxLen: 30 },
        { id: 'licenceExpiry', label: 'Expiry date', type: 'date', span: 4 },
        { id: 'yearsHeld', label: 'Years held', type: 'number', span: 4 },
      ],
      [
        { id: 'alcohol', label: 'Did the driver consume any alcohol or take any drugs in the 24 hours before the accident?', type: 'yesno', required: true },
      ],
      [
        { id: 'alcoholDetails', label: 'If YES, please provide details', type: 'text', maxLen: 300, showIf: { field: 'alcohol', equals: 'yes' } },
      ],
      [
        { id: 'breathTest', label: 'Did the driver undergo a breath test, breath analysis or blood test?', type: 'yesno', required: true },
      ],
      [
        { id: 'breathReading', label: 'If YES, what was the reading?', type: 'text', maxLen: 120, showIf: { field: 'breathTest', equals: 'yes' } },
      ],
    ],
  },
  {
    id: 'incident',
    title: 'Incident details',
    filler: 'renter',
    blurb: 'Date, time, street, road surface, traffic controls and direction of travel.',
    rows: [
      [
        { id: 'date', label: 'Date of the accident', type: 'date', span: 6, required: true },
        { id: 'time', label: 'Time', type: 'time', span: 6, required: true },
      ],
      [
        { id: 'street', label: 'Street name', type: 'text', span: 8, required: true, maxLen: 120 },
        { id: 'suburb', label: 'Suburb', type: 'text', span: 4, maxLen: 60 },
      ],
      [
        { id: 'crossroad', label: 'Nearest crossroad', type: 'text', maxLen: 120 },
      ],
      [
        { id: 'road', label: 'Road surface', type: 'radio', span: 8, options: [{ value: 'dry', label: 'Dry' }, { value: 'wet', label: 'Wet' }, { value: 'loose', label: 'Loose' }, { value: 'storm', label: 'Storm / flood' }] },
        { id: 'vehicles', label: 'Number of vehicles', type: 'number', span: 4 },
      ],
      [
        { id: 'moving', label: 'At the time of the incident, your vehicle was', type: 'radio', options: [{ value: 'moving', label: 'Moving' }, { value: 'stationary', label: 'Stationary' }, { value: 'parked', label: 'Parked' }] },
      ],
      [
        { id: 'traffic', label: 'Traffic controls', type: 'radio', options: [{ value: 'none', label: 'None' }, { value: 'stop', label: 'Stop sign' }, { value: 'lights', label: 'Traffic lights' }, { value: 'roundabout', label: 'Roundabout' }, { value: 'giveway', label: 'Give way' }, { value: 'merge', label: 'Merge' }] },
      ],
      [
        { id: 'direction', label: 'Your direction of travel', type: 'radio', options: [{ value: 'north', label: 'North' }, { value: 'south', label: 'South' }, { value: 'east', label: 'East' }, { value: 'west', label: 'West' }] },
      ],
    ],
  },
  {
    id: 'drawing',
    title: 'Accident drawing',
    filler: 'renter',
    blurb: 'Pictures that show how it happened: a Google Maps screenshot, a drawing on paper, accident photos.',
    rows: [
      [
        {
          id: 'images', label: 'Accident drawing, map or photos', type: 'photos', max: 3,
          hint: 'Take a screenshot of the Google Map where it happened, or draw it on paper and photograph it. Show the street names, road markings, signs and which way each vehicle was going.',
        },
      ],
    ],
  },
  {
    id: 'description',
    title: 'Accident description',
    filler: 'renter',
    blurb: 'What happened, the speeds, and whether the vehicle was towed.',
    rows: [
      [
        { id: 'speedYours', label: 'Estimate the speed of your vehicle', type: 'number', span: 6, unit: 'km/hr' },
        { id: 'speedOther', label: 'Estimate the speed of the other vehicle', type: 'number', span: 6, unit: 'km/hr' },
      ],
      [
        { id: 'story', label: 'Describe how the accident happened', type: 'textarea', required: true, rows: 8, maxLen: 3000 },
      ],
      [
        { id: 'towed', label: 'Was your vehicle towed?', type: 'yesno', span: 6 },
        { id: 'towedBy', label: 'Towed by', type: 'text', span: 6, maxLen: 100, showIf: { field: 'towed', equals: 'yes' } },
      ],
      [
        { id: 'whereNow', label: 'Where is the vehicle now?', type: 'text', span: 6, maxLen: 160 },
        { id: 'towedTo', label: 'Towed to', type: 'text', span: 6, maxLen: 160, showIf: { field: 'towed', equals: 'yes' } },
      ],
    ],
  },
  {
    id: 'damage',
    title: 'Damage to the vehicles',
    filler: 'renter',
    blurb: "Tick the damaged parts of the renter's vehicle and of the other (third party) vehicle.",
    rows: [
      [
        { id: 'taxi', label: 'Your vehicle (the taxi / rental car): tick every damaged part', type: 'checks', options: DAMAGE_AREAS },
      ],
      [
        { id: 'third', label: 'Other (third party) vehicle: tick every damaged part', type: 'checks', options: DAMAGE_AREAS },
      ],
      [
        { id: 'notes', label: 'Anything else about the damage', type: 'text', maxLen: 400 },
      ],
    ],
  },
  {
    id: 'other',
    title: 'Other vehicle details',
    filler: 'renter',
    blurb: 'The other driver and vehicle, and their insurance company.',
    rows: [
      [
        { id: 'registration', label: 'Registration number', type: 'text', span: 5, maxLen: 20 },
        { id: 'makeModel', label: 'Make, model & colour', type: 'text', span: 7, maxLen: 100 },
      ],
      [
        { id: 'firstName', label: 'Driver first name', type: 'text', span: 6, maxLen: 60 },
        { id: 'surname', label: 'Driver surname', type: 'text', span: 6, maxLen: 60 },
      ],
      [
        { id: 'owner', label: 'Owner details', type: 'text', maxLen: 160 },
      ],
      [
        { id: 'address', label: 'Address', type: 'text', span: 8, maxLen: 160 },
        { id: 'suburb', label: 'Suburb', type: 'text', span: 4, maxLen: 60 },
      ],
      [
        { id: 'state', label: 'State', type: 'select', span: 4, options: STATES },
        { id: 'postcode', label: 'Postcode', type: 'text', span: 4, maxLen: 6 },
        { id: 'dob', label: 'Date of birth', type: 'date', span: 4 },
      ],
      [
        { id: 'mobile', label: 'Mobile', type: 'tel', span: 6 },
        { id: 'homeWork', label: 'Home / work phone', type: 'tel', span: 6 },
      ],
      [
        { id: 'email', label: 'Email', type: 'email' },
      ],
      [
        { id: 'insurer', label: 'Insurance company details', type: 'text', span: 8, maxLen: 160 },
        { id: 'claimNumber', label: 'Claim number', type: 'text', span: 4, maxLen: 40 },
      ],
    ],
  },
  {
    id: 'passenger',
    title: 'Passenger & injuries',
    filler: 'renter',
    blurb: 'Whether there was a passenger, and whether anyone was injured.',
    rows: [
      [
        { id: 'hasPassenger', label: 'Was there a passenger in the vehicle?', type: 'yesno', span: 6 },
        { id: 'passengerName', label: 'Passenger name', type: 'text', span: 6, maxLen: 100, showIf: { field: 'hasPassenger', equals: 'yes' } },
      ],
      [
        { id: 'passengerMobile', label: 'Passenger mobile', type: 'tel', span: 6, showIf: { field: 'hasPassenger', equals: 'yes' } },
        { id: 'passengerHomeWork', label: 'Passenger home / work phone', type: 'tel', span: 6, showIf: { field: 'hasPassenger', equals: 'yes' } },
      ],
      [
        { id: 'passengerEmail', label: 'Passenger email', type: 'email', showIf: { field: 'hasPassenger', equals: 'yes' } },
      ],
      [
        { id: 'injured', label: 'Was anyone injured?', type: 'yesno', span: 6 },
        { id: 'injuredDetails', label: 'If YES, provide details', type: 'text', span: 6, maxLen: 300, showIf: { field: 'injured', equals: 'yes' } },
      ],
    ],
  },
  {
    id: 'police',
    title: 'Police information',
    filler: 'renter',
    blurb: 'Whether police attended or were told, the officer and the event number.',
    rows: [
      [
        { id: 'attended', label: 'Did the police attend the accident?', type: 'yesno', span: 6 },
        { id: 'reported', label: 'Was the accident reported to the police?', type: 'yesno', span: 6 },
      ],
      [
        { id: 'officer', label: 'Officer name', type: 'text', maxLen: 100 },
      ],
      [
        { id: 'station', label: 'Station', type: 'text', span: 7, maxLen: 100 },
        { id: 'qpNumber', label: 'QP number', type: 'text', span: 5, maxLen: 40 },
      ],
    ],
  },
  {
    id: 'witness',
    title: 'Witness details',
    filler: 'renter',
    blurb: 'Name, address and phone number of a witness.',
    rows: [
      [
        { id: 'name', label: 'Witness name', type: 'text', maxLen: 100 },
      ],
      [
        { id: 'address', label: 'Address', type: 'text', maxLen: 160 },
      ],
      [
        { id: 'mobile', label: 'Mobile', type: 'tel', span: 6 },
        { id: 'homeWork', label: 'Home / work phone', type: 'tel', span: 6 },
      ],
    ],
  },
  {
    id: 'uploads',
    title: 'Licence & photos',
    filler: 'renter',
    blurb: 'The renter attaches the driver licence (front and back) and photos of the accident and damage.',
    rows: [
      [
        { id: 'licenceFront', label: 'Driver licence: front', type: 'photo', span: 6, required: true, hint: 'Lay the licence flat in good light so every word can be read.' },
        { id: 'licenceBack', label: 'Driver licence: back', type: 'photo', span: 6, required: true, hint: 'Now the back of the same licence.' },
      ],
      [
        {
          id: 'photos', label: 'Photos of the accident and the damage', type: 'photos', max: 6,
          hint: 'Your car, the other car, the number plates, the road. Up to 6 photos.',
        },
      ],
    ],
  },
  {
    id: 'declaration',
    title: 'Declaration & signature',
    filler: 'renter',
    blurb: 'The renter confirms the details are true, signs on the screen, prints his name and dates it.',
    rows: [
      [
        { id: 'truthful', label: 'Do you declare that the details you have provided to us are true and correct and not misrepresented in any way?', type: 'yesno', required: true },
      ],
      [
        { id: 'signature', label: 'Driver signature', type: 'signature', required: true },
      ],
      [
        { id: 'printName', label: 'Print name', type: 'text', span: 7, required: true, maxLen: 100 },
        { id: 'date', label: 'Date', type: 'date', span: 5, required: true },
      ],
    ],
  },
  {
    id: 'checklist',
    title: 'Claim checklist',
    filler: 'owner',
    blurb: 'Driver over 21, form signed and dated, licence attached. You tick these; they tick themselves when the details are there.',
    rows: [
      [
        {
          id: 'items', label: 'Tick each one that applies', type: 'checks',
          options: [
            { value: 'over21', label: 'Driver over the age of 21' },
            { value: 'signed', label: 'Claim form signed and dated by driver' },
            { value: 'licence', label: 'Copy of driver licence (front & back) attached' },
          ],
        },
      ],
    ],
  },
]

export const SECTION_IDS: string[] = FORM_SECTIONS.map(s => s.id)

export function sectionById(id: string): SectionDef | undefined {
  return FORM_SECTIONS.find(s => s.id === id)
}

/** The wanted section ids as library sections, in page order, ignoring unknown and repeated ids. */
export function sectionsFor(ids: readonly string[]): SectionDef[] {
  const wanted = new Set(ids)
  return FORM_SECTIONS.filter(s => wanted.has(s.id))
}

export function fieldCount(section: SectionDef): number {
  return section.rows.reduce((n, row) => n + row.length, 0)
}

/** An Australian mobile typed any way ("0412 345 678", "+61 412 345 678", "61412345678") becomes 0412345678. */
export function normalizePhone(input: unknown): string {
  if (typeof input !== 'string') return ''
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('0061')) digits = digits.slice(4)
  else if (digits.startsWith('61') && digits.length >= 11) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 0) return ''
  return `0${digits}`.slice(0, 15)
}
