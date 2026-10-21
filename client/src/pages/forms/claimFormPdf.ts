import { jsPDF } from 'jspdf'
import type { Answers, FieldDef, Pictures, SectionDef } from './types'
import { displayValue, isEmpty } from './fieldLogic'
import { CAR_PNG, CAR_SIZE, LOGO_PNG, LOGO_SIZE } from './claimFormAssets'

// The PDF of a claim form: laid out like the paper "Motor Vehicle Accident Notification & Claim Form"
// of All Sydney Smash & Mechanical Repairs (their logo and address block, boxed rows, dark section
// bars, tick boxes, the car diagram), but holding only the sections of the template that was sent.
// Pictures the renter attached (licence, photos, accident drawing) follow on their own pages. The
// ASSMR / STAFF column of the disclaimer is left empty for the shop to sign.
//
// It is built in the browser with jsPDF, the same way the DDR PDF is. Nothing is sent anywhere.

export interface PdfInput {
  /** The sections of the form (renter's and owner's), in form order. */
  sections: SectionDef[]
  /** What was answered: the renter's answers with the owner's on top. */
  values: Answers
  files: Pictures
  renterName?: string
}

// ── page geometry (millimetres) ──────────────────────────────────────────────
const X0 = 20
const W = 170.5
const X1 = X0 + W
const TOP_FIRST = 74
const TOP = 20
const BOTTOM = 280
const MINH = 6.8        // a one-line row
const PAD = 1.8
const LBL = 8           // label size (pt)
const VAL = 9           // answer size (pt)
const LH = 3.7          // line height for 8-9 pt text
const BOX = 3.2         // tick box
const BAR = 4.8         // section bar

// ── text that Helvetica can print ────────────────────────────────────────────
// The built-in PDF fonts hold Western European letters only. Anything else (other alphabets, emoji)
// would print as rubbish, so letters with marks fall back to the plain letter and the rest to "?".
const WIN1252_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178])

export function pdfText(input: string): string {
  let out = ''
  for (const ch of input.replace(/\r\n?/g, '\n')) {
    const c = ch.codePointAt(0) as number
    if (ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN1252_EXTRA.has(c)) { out += ch; continue }
    if (c === 0x09) { out += ' '; continue }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    out += /^[\x20-\x7e]+$/.test(base) ? base : '?'
  }
  return out
}

// Titles of the dark bars, as printed on the paper form.
const BAR_TITLE: Record<string, string> = {
  claim: 'MEMBER DETAILS',
  driver: 'TAXI/RIDESHARE DRIVER DETAILS',
  incident: 'INCIDENT DETAILS',
  description: 'ACCIDENT DESCRIPTION - Describe how the accident happened (if you need more space, attached a sheet of paper)',
  damage: 'MARK DAMAGE TO TAXI AND THIRD PARTY VEHICLE',
  other: 'OTHER VEHICLE DETAILS',
  passenger: 'PASSENGER & INJURIES',
  police: 'POLICE INFORMATION',
  witness: 'WITNESS DETAILS',
  uploads: 'LICENCE & PHOTOS',
  declaration: 'DISCLAIMER',
}

const isPicture = (f: FieldDef) => f.type === 'photo' || f.type === 'photos' || f.type === 'signature'

export function buildClaimFormPdf(input: PdfInput): ArrayBuffer {
  const { sections, values, files } = input
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  doc.setProperties({ title: 'Motor Vehicle Accident Notification & Claim Form', subject: input.renterName || '', creator: 'FleetAI' })

  let y = TOP_FIRST
  let continued: string | null = null   // the bar title to repeat when a section runs onto a new page

  // ── small drawing helpers ──
  function font(size: number, bold = false) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
  }
  function width(text: string, size: number, bold = false): number {
    font(size, bold)
    return doc.getTextWidth(pdfText(text))
  }
  function put(text: string, x: number, baseline: number, o: { size?: number; bold?: boolean; gray?: number; white?: boolean; align?: 'left' | 'right' | 'center' } = {}) {
    font(o.size ?? LBL, o.bold)
    if (o.white) doc.setTextColor(255, 255, 255)
    else doc.setTextColor(o.gray ?? 0)
    doc.text(pdfText(text), x, baseline, { align: o.align ?? 'left' })
  }
  /** Lines of text no wider than maxW (long words are cut so they never run out of the box). */
  function wrap(text: string, maxW: number, size: number, bold = false): string[] {
    font(size, bold)
    const lines: string[] = []
    for (const paragraph of pdfText(text).split('\n')) {
      const parts: string[] = doc.splitTextToSize(paragraph === '' ? ' ' : paragraph, maxW)
      for (const part of parts) {
        if (doc.getTextWidth(part) <= maxW) { lines.push(part); continue }
        let chunk = ''
        for (const ch of part) {
          if (doc.getTextWidth(chunk + ch) > maxW && chunk) { lines.push(chunk); chunk = ch } else chunk += ch
        }
        if (chunk) lines.push(chunk)
      }
    }
    return lines
  }
  function stroke() { doc.setDrawColor(35, 35, 35); doc.setLineWidth(0.25) }
  function tick(x: number, top: number, on: boolean, size = BOX) {
    stroke()
    doc.rect(x, top, size, size)
    if (on) {
      doc.setLineWidth(0.6)
      doc.line(x + size * 0.18, y0(top, size, 0.55), x + size * 0.42, y0(top, size, 0.82))
      doc.line(x + size * 0.42, y0(top, size, 0.82), x + size * 0.88, y0(top, size, 0.14))
      doc.setLineWidth(0.25)
    }
  }
  const y0 = (top: number, size: number, f: number) => top + size * f

  function newPage() {
    doc.addPage()
    y = TOP
    // A section that runs onto a new page repeats its dark bar there, so the boxes are never orphaned.
    const title = continued
    if (title) {
      bar(`${title} (CONTINUED)`, { keep: true })
      continued = title
    }
  }
  function room(h: number) {
    if (y + h > BOTTOM) newPage()
  }

  function bar(title: string, o: { right?: string; keep?: boolean; width?: number } = {}) {
    if (!o.keep) {
      // A new bar means the section before it is finished, so a page break right here must not
      // repeat that section's bar.
      continued = null
      room(BAR + MINH)
    }
    const w = o.width ?? W
    doc.setFillColor(108, 108, 108)
    doc.rect(X0, y, w, BAR, 'F')
    put(title, X0 + 2, y + 3.4, { size: title.length > 60 ? 7.5 : 8.5, bold: true, white: true })
    if (o.right) put(o.right, X0 + W * 0.62, y + 3.4, { size: 8.5, bold: true, white: true, align: 'center' })
    y += BAR
    if (!o.keep) continued = title
  }
  /** Start of a section: whatever bar was repeating no longer applies. */
  const begin = () => { continued = null }

  // ── cells and rows ──
  interface Laid { h: number; paint: (x: number, top: number) => void }

  function layoutCell(f: FieldDef, raw: unknown, w: number): Laid {
    const inner = w - PAD * 2

    if (f.type === 'yesno') {
      const wy = width('YES', 8)
      const wn = width('NO', 8)
      const total = wy + 1.4 + BOX + 4 + wn + 1.4 + BOX
      const lines = wrap(f.label, inner - total - 2, LBL)
      return {
        h: Math.max(MINH, lines.length * LH + 3.2),
        paint: (x, top) => {
          lines.forEach((ln, i) => put(ln, x + PAD, top + 4.4 + i * LH))
          let cx = x + w - PAD - total
          put('YES', cx, top + 4.6); cx += wy + 1.4; tick(cx, top + 1.9, raw === 'yes'); cx += BOX + 4
          put('NO', cx, top + 4.6); cx += wn + 1.4; tick(cx, top + 1.9, raw === 'no')
        },
      }
    }

    if (f.type === 'radio') {
      const items = (f.options || []).map(o => ({ o, w: width(o.label, 8) + 1.4 + BOX }))
      const gap = 4
      const optsW = items.reduce((n, it) => n + it.w, 0) + gap * Math.max(0, items.length - 1)
      const labelW = width(f.label, LBL)
      const drawOpt = (it: { o: { value: string; label: string }; w: number }, cx: number, base: number) => {
        put(it.o.label, cx, base)
        tick(cx + it.w - BOX, base - 2.7, raw === it.o.value)
      }
      if (labelW + 3 + optsW <= inner) {
        return {
          h: MINH,
          paint: (x, top) => {
            put(f.label, x + PAD, top + 4.4)
            let cx = x + w - PAD - optsW
            for (const it of items) { drawOpt(it, cx, top + 4.6); cx += it.w + gap }
          },
        }
      }
      // Too wide for one line: the question first, the choices underneath.
      const labelLines = wrap(f.label, inner, LBL)
      const flow: Array<typeof items> = [[]]
      let used = 0
      for (const it of items) {
        if (used + it.w > inner && flow[flow.length - 1].length > 0) { flow.push([]); used = 0 }
        flow[flow.length - 1].push(it)
        used += it.w + gap
      }
      return {
        h: Math.max(MINH, (labelLines.length + flow.length) * LH + 3.6),
        paint: (x, top) => {
          labelLines.forEach((ln, i) => put(ln, x + PAD, top + 4.4 + i * LH))
          flow.forEach((line, i) => {
            let cx = x + PAD
            const base = top + 4.6 + (labelLines.length + i) * LH
            for (const it of line) { drawOpt(it, cx, base); cx += it.w + gap }
          })
        },
      }
    }

    if (f.type === 'time') {
      const m = /^(\d{2}):(\d{2})$/.exec(typeof raw === 'string' ? raw : '')
      const hours = m ? Number(m[1]) : null
      const text = m ? `${(hours as number) % 12 === 0 ? 12 : (hours as number) % 12}:${m[2]}` : ''
      const wa = width('AM', 8)
      const wp = width('PM', 8)
      const total = wa + 1.4 + BOX + 4 + wp + 1.4 + BOX
      const lw = width(f.label, LBL)
      return {
        h: MINH,
        paint: (x, top) => {
          put(f.label, x + PAD, top + 4.4)
          if (text) put(text, x + PAD + lw + 3, top + 4.5, { size: VAL, bold: true })
          let cx = x + w - PAD - total
          put('AM', cx, top + 4.6); cx += wa + 1.4; tick(cx, top + 1.9, hours !== null && hours < 12); cx += BOX + 4
          put('PM', cx, top + 4.6); cx += wp + 1.4; tick(cx, top + 1.9, hours !== null && hours >= 12)
        },
      }
    }

    // Everything else is a label with the answer written next to it (or under it when it will not fit).
    const value = isEmpty(raw) ? '' : displayValue(f, raw)
    const lw = width(f.label, LBL)
    const vw = value ? width(value, VAL, true) : 0
    if (!value || (!value.includes('\n') && lw + 3 + vw <= inner)) {
      return {
        h: MINH,
        paint: (x, top) => {
          put(f.label, x + PAD, top + 4.4)
          if (value) put(value, x + PAD + lw + 3, top + 4.5, { size: VAL, bold: true })
          else if (f.unit) put(`____ ${f.unit}`, x + PAD + lw + 3, top + 4.4)   // the paper form's "____ km/hr"
        },
      }
    }
    const labelLines = wrap(f.label, inner, LBL)
    const valueLines = wrap(value, inner, VAL, true)
    return {
      h: Math.max(MINH, labelLines.length * LH + valueLines.length * (LH + 0.5) + 3.2),
      paint: (x, top) => {
        labelLines.forEach((ln, i) => put(ln, x + PAD, top + 4.4 + i * LH))
        valueLines.forEach((ln, i) => put(ln, x + PAD, top + 4.6 + labelLines.length * LH + i * (LH + 0.5), { size: VAL, bold: true }))
      },
    }
  }

  function row(fields: FieldDef[], section: SectionDef) {
    const shown = fields.filter(f => !isPicture(f))
    if (shown.length === 0) return
    const spans = shown.map(f => f.span ?? 12)
    const total = spans.reduce((a, b) => a + b, 0)
    const widths = spans.map(s => (W * s) / total)
    const cells = shown.map((f, i) => layoutCell(f, values[section.id]?.[f.id], widths[i]))
    const h = Math.max(MINH, ...cells.map(c => c.h))
    room(h)
    stroke()
    doc.rect(X0, y, W, h)
    let cx = X0
    cells.forEach((c, i) => {
      if (i > 0) doc.line(cx, y, cx, y + h)
      c.paint(cx, y)
      cx += widths[i]
    })
    y += h
  }

  /** A textarea as lines to write on, with the answer on them. */
  function ruled(f: FieldDef, section: SectionDef) {
    const raw = values[section.id]?.[f.id]
    const lines = isEmpty(raw) ? [] : wrap(String(raw), W - PAD * 2, 9)
    const minLines = f.rows && f.rows >= 8 ? 10 : f.rows ?? 4
    const count = Math.max(minLines, lines.length)
    const step = 5.2
    if (f.label) {
      const head = layoutCell({ ...f, type: 'text' }, '', W)
      room(head.h + step)
      stroke(); doc.rect(X0, y, W, head.h); head.paint(X0, y); y += head.h
    }
    for (let i = 0; i < count; i++) {
      room(step)
      stroke()
      doc.line(X0, y, X0, y + step)
      doc.line(X1, y, X1, y + step)
      doc.line(X0, y + step, X1, y + step)
      if (lines[i]) put(lines[i], X0 + PAD, y + step - 1.3, { size: 9, gray: 20 })
      y += step
    }
  }

  // ── page 1 header ──
  function header() {
    const logoW = 64
    try {
      doc.addImage(LOGO_PNG, 'PNG', X0 - 3, 30, logoW, (logoW * LOGO_SIZE.h) / LOGO_SIZE.w)
    } catch {
      // The form is still worth printing if the logo picture cannot be read.
      put('ALL SYDNEY SMASH &', X0, 40, { size: 11, bold: true })
      put('MECHANICAL REPAIRS', X0, 45, { size: 11, bold: true })
    }
    const lines: Array<[string, number, boolean]> = [
      ['MOTOR VEHICLE ACCIDENT NOTIFICATION & CLAIM FORM', 10, true],
      ['ABN 68 601 544 503', 11.5, true],
      ['MVRL 58857', 11.5, true],
      ['2 TALBOT STREET,', 10.5, false],
      ['ST PETERS, NSW 2044', 10.5, false],
      ['Phone: (02) 8964 4618', 10.5, false],
      ['Email: allsydneysmash@gmail.com', 10.5, false],
    ]
    lines.forEach(([text, size, bold], i) => put(text, X1, 33 + i * 5, { size, bold, align: 'right', gray: 15 }))
  }

  // ── sections ──
  const answered = (s: SectionDef, id: string) => (values[s.id]?.[id] as unknown)
  const pictureCount = (sectionId: string, fieldId: string) => files[sectionId]?.[fieldId]?.length ?? 0

  function genericSection(s: SectionDef, previous: string | null) {
    const title = BAR_TITLE[s.id] || s.title.toUpperCase()
    // On the paper form the passenger boxes carry straight on from the other vehicle's box.
    const carryOn = s.id === 'passenger' && previous === 'other'
    if (!carryOn) { begin(); bar(title, s.id === 'witness' ? { right: 'WITNESS 1' } : {}) }
    for (const fields of s.rows) {
      const textarea = fields.length === 1 && fields[0].type === 'textarea' ? fields[0] : null
      if (textarea) ruled({ ...textarea, label: '' }, s)
      else row(fields, s)
    }
  }

  function claimSection(s: SectionDef) {
    // On the paper form the member number / claim line sits above the first bar.
    const [first, ...rest] = s.rows
    begin()
    room(MINH + BAR + MINH)
    row(first, s)
    bar(BAR_TITLE.claim)
    for (const fields of rest) row(fields, s)
  }

  function drawingSection(s: SectionDef) {
    const n = pictureCount(s.id, 'images')
    const h = 29
    begin()
    room(h + 2)
    y += 1
    stroke()
    doc.rect(X0, y, W, h)
    put('Accident drawing', X0 + 3, y + 7, { size: 12.5, gray: 10 })
    const para = wrap('Please include all street names, road markings, street signs, control signs and the direction each vehicle was travelling at the time of impact.', W - 8, 7.5)
    para.forEach((ln, i) => put(ln, X0 + 3, y + 12.5 + i * 3.4, { size: 7.5, gray: 40 }))
    put(n > 0 ? `${n} picture${n === 1 ? '' : 's'} attached: a map, drawing or photos (see the attachment pages)` : 'No picture was attached.', X0 + 3, y + h - 4, { size: 9, bold: true })
    y += h
  }

  function damageSection(s: SectionDef) {
    const half = W / 2
    const imgW = 60
    const imgH = (imgW * CAR_SIZE.h) / CAR_SIZE.w
    const sides: Array<[string, string]> = [['taxi', 'Taxi'], ['third', 'Third Party Vehicle']]
    const listLines = sides.map(([id]) => {
      const f = s.rows.flat().find(x => x.id === id)
      const raw = answered(s, id)
      const text = f && !isEmpty(raw) ? `Damaged: ${displayValue(f, raw)}` : 'Damaged: nothing ticked'
      return wrap(text, half - 8, 8.5, true)
    })
    const lines = Math.max(...listLines.map(l => l.length))
    const h = 6 + imgH + 3 + lines * 4 + 2
    begin()
    room(BAR + h)   // the bar and both car pictures stay together
    bar(BAR_TITLE.damage)
    stroke()
    doc.rect(X0, y, W, h)
    doc.line(X0 + half, y, X0 + half, y + h)
    sides.forEach(([, title], i) => {
      const cx = X0 + i * half
      put(title, cx + half / 2, y + 4.4, { size: 9, align: 'center' })
      try {
        doc.addImage(CAR_PNG, 'PNG', cx + (half - imgW) / 2, y + 6, imgW, imgH)
      } catch {
        // Without the picture the tick list below still says which parts are damaged.
      }
      listLines[i].forEach((ln, j) => put(ln, cx + 4, y + 6 + imgH + 4.5 + j * 4, { size: 8.5, bold: true }))
    })
    y += h
    const notes = s.rows.flat().find(f => f.id === 'notes')
    if (notes) row([notes], s)
  }

  function uploadsSection(s: SectionDef) {
    const licence = pictureCount(s.id, 'licenceFront') + pictureCount(s.id, 'licenceBack')
    const photos = pictureCount(s.id, 'photos')
    begin()
    bar(BAR_TITLE.uploads)
    const text = [
      `Driver licence: ${licence > 0 ? `${licence} side${licence === 1 ? '' : 's'} attached` : 'not attached'}`,
      `Photos of the accident and damage: ${photos > 0 ? `${photos} attached` : 'none attached'}`,
    ]
    room(MINH * 2)
    stroke()
    doc.rect(X0, y, W, MINH * 2)
    text.forEach((t, i) => put(t, X0 + PAD, y + 4.6 + i * MINH, { size: 8.5, bold: true }))
    y += MINH * 2
  }

  function declarationSection(s: SectionDef) {
    begin()
    room(BAR + 11 + BAR + 14 + MINH * 2)   // keep the whole signing block on one page
    bar(BAR_TITLE.declaration)
    const q = s.rows.flat().find(f => f.id === 'truthful')
    const labelW = W * 0.18
    const staffW = W * 0.41
    const driverX = X0 + labelW + staffW
    if (q) {
      const answer = answered(s, 'truthful')
      const lines = wrap(q.label.toUpperCase(), W - labelW - PAD * 2, 7.5)
      const h = Math.max(11, lines.length * 3.4 + 7.5)
      stroke()
      doc.rect(X0, y, W, h)
      doc.line(X0 + labelW, y, X0 + labelW, y + h)
      put('DISCLAIMER -', X0 + PAD, y + 4.6, { size: 8.5 })
      lines.forEach((ln, i) => put(ln, X0 + labelW + PAD, y + 3.8 + i * 3.4, { size: 7.5 }))
      let cx = X0 + labelW + PAD
      const base = y + 3.8 + lines.length * 3.4 + 0.6
      put('YES', cx, base, { size: 7.5 }); cx += width('YES', 7.5) + 1.4; tick(cx, base - 2.6, answer === 'yes', 2.9); cx += 2.9 + 4
      put('NO', cx, base, { size: 7.5 }); cx += width('NO', 7.5) + 1.4; tick(cx, base - 2.6, answer === 'no', 2.9)
      y += h
    }
    // Two dark halves: the shop's column (left empty) and the driver's column.
    doc.setFillColor(108, 108, 108)
    doc.rect(X0, y, W, BAR, 'F')
    put('ASSMR/ STAFF', X0 + labelW + staffW / 2, y + 3.4, { size: 8.5, bold: true, white: true, align: 'center' })
    put('DRIVER OF TAXI', driverX + (W - labelW - staffW) / 2, y + 3.4, { size: 8.5, bold: true, white: true, align: 'center' })
    y += BAR

    const rows: Array<[string, number]> = [['SIGNATURE', 16], ['PRINT NAME', MINH + 0.4], ['DATE', MINH + 0.4]]
    const sigSrc = files[s.id]?.signature?.[0]
    const printName = answered(s, 'printName')
    const date = s.rows.flat().find(f => f.id === 'date')
    rows.forEach(([label, h]) => {
      room(h)
      stroke()
      doc.rect(X0, y, W, h)
      doc.line(X0 + labelW, y, X0 + labelW, y + h)
      doc.line(driverX - 0.0, y, driverX, y + h)
      put(label, X0 + PAD, y + 4.5, { size: 7.5 })
      if (label === 'SIGNATURE' && sigSrc) {
        try {
          const p = doc.getImageProperties(sigSrc)
          const maxW = W - labelW - staffW - 6
          const maxH = h - 2.5
          const scale = Math.min(maxW / p.width, maxH / p.height)
          doc.addImage(sigSrc, 'PNG', driverX + 3, y + 1.2, p.width * scale, p.height * scale)
        } catch { put('(signature could not be added)', driverX + PAD, y + 5, { size: 7, gray: 90 }) }
      }
      if (label === 'PRINT NAME' && !isEmpty(printName)) put(String(printName), driverX + PAD, y + 4.7, { size: VAL, bold: true })
      if (label === 'DATE' && date && !isEmpty(answered(s, 'date'))) put(displayValue(date, answered(s, 'date')), driverX + PAD, y + 4.7, { size: VAL, bold: true })
      y += h
    })
  }

  function checklistSection(s: SectionDef) {
    const f = s.rows.flat()[0]
    const picked = Array.isArray(answered(s, f.id)) ? (answered(s, f.id) as string[]) : []
    const need = BAR + 3 + (f.options?.length ?? 0) * 5.4 + 2
    begin()
    room(need + 3)
    y += 4
    doc.setFillColor(108, 108, 108)
    doc.rect(X0, y, 36, BAR, 'F')
    put('CLAIM CHECKLIST', X0 + 18, y + 3.4, { size: 8.5, bold: true, white: true, align: 'center' })
    y += BAR + 4
    for (const o of f.options || []) {
      const label = o.label.toUpperCase()
      put(label, X0, y + 3, { size: 8.5 })
      tick(X0 + width(label, 8.5) + 1.6, y + 0.3, picked.includes(o.value), 3.4)
      y += 5.4
    }
  }

  // ── attachments ──
  function attachments() {
    const groups: Array<{ title: string; items: Array<{ src: string; caption: string }> }> = []
    const front = files.uploads?.licenceFront?.[0]
    const back = files.uploads?.licenceBack?.[0]
    if (front || back) {
      groups.push({ title: 'DRIVER LICENCE (FRONT AND BACK)', items: [front ? { src: front, caption: 'Front' } : null, back ? { src: back, caption: 'Back' } : null].filter((x): x is { src: string; caption: string } => !!x) })
    }
    const drawing = files.drawing?.images || []
    if (drawing.length > 0) groups.push({ title: 'ACCIDENT DRAWING, MAP OR PHOTOS', items: drawing.map((src, i) => ({ src, caption: `${i + 1} of ${drawing.length}` })) })
    const photos = files.uploads?.photos || []
    if (photos.length > 0) groups.push({ title: 'PHOTOS OF THE ACCIDENT AND DAMAGE', items: photos.map((src, i) => ({ src, caption: `${i + 1} of ${photos.length}` })) })

    // Two pictures to a page. Two landscape pictures sit one above the other; two tall phone photos
    // sit side by side, because that shows each of them bigger. Whichever shows more picture wins.
    interface Box { x: number; y: number; w: number; h: number }
    const CAP = 6
    const areaTop = TOP + 14
    const areaH = BOTTOM - areaTop - 2
    const slots = (count: number, mode: 'stack' | 'side'): Box[] => {
      if (count === 1) return [{ x: X0, y: areaTop, w: W, h: areaH - CAP }]
      if (mode === 'stack') {
        const slot = areaH / 2
        return [0, 1].map(i => ({ x: X0, y: areaTop + i * slot, w: W, h: slot - CAP - 3 }))
      }
      const gap = 4
      const w = (W - gap) / 2
      return [0, 1].map(i => ({ x: X0 + i * (w + gap), y: areaTop, w, h: areaH - CAP }))
    }
    const sizeOf = (src: string): { w: number; h: number } | null => {
      try {
        const p = doc.getImageProperties(src)
        return p.width > 0 && p.height > 0 ? { w: p.width, h: p.height } : null
      } catch { return null }
    }
    const fitScale = (b: Box, d: { w: number; h: number }) => Math.min((b.w - 6) / d.w, (b.h - 6) / d.h)

    for (const g of groups) {
      for (let at = 0; at < g.items.length; at += 2) {
        const pair = g.items.slice(at, at + 2)
        const dims = pair.map(it => sizeOf(it.src))
        doc.addPage()
        put(`ATTACHMENT: ${g.title}`, X0, TOP + 4, { size: 11, bold: true, gray: 15 })
        if (input.renterName) put(`Claim form for ${input.renterName}`, X0, TOP + 9.5, { size: 8, gray: 90 })

        let boxes = slots(pair.length, 'stack')
        if (pair.length === 2) {
          const shown = (bs: Box[]) => bs.reduce((n, b, i) => {
            const d = dims[i]
            if (!d) return n
            const k = fitScale(b, d)
            return n + d.w * k * d.h * k
          }, 0)
          const stack = slots(2, 'stack')
          const side = slots(2, 'side')
          boxes = shown(side) > shown(stack) * 1.05 ? side : stack
        }

        pair.forEach((item, i) => {
          const b = boxes[i]
          stroke()
          doc.rect(b.x, b.y, b.w, b.h)
          const d = dims[i]
          try {
            if (!d) throw new Error('unreadable picture')
            const k = fitScale(b, d)
            const w = d.w * k
            const h = d.h * k
            const fmt = item.src.startsWith('data:image/png') ? 'PNG' : item.src.startsWith('data:image/webp') ? 'WEBP' : 'JPEG'
            doc.addImage(item.src, fmt, b.x + (b.w - w) / 2, b.y + (b.h - h) / 2, w, h)
          } catch {
            put('(this picture could not be added)', b.x + b.w / 2, b.y + b.h / 2, { size: 9, gray: 90, align: 'center' })
          }
          put(item.caption, b.x, b.y + b.h + 4.2, { size: 8, gray: 70 })
        })
      }
    }
  }

  // ── build ──
  header()
  let previous: string | null = null
  for (const s of sections) {
    if (s.id === 'claim') claimSection(s)
    else if (s.id === 'drawing') drawingSection(s)
    else if (s.id === 'damage') damageSection(s)
    else if (s.id === 'uploads') uploadsSection(s)
    else if (s.id === 'declaration') declarationSection(s)
    else if (s.id === 'checklist') checklistSection(s)
    else genericSection(s, previous)
    previous = s.id
  }
  attachments()

  // Page numbers, bottom right, as on the paper form.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    put(String(i), X1, 289, { size: 10, align: 'right', gray: 60 })
  }
  return doc.output('arraybuffer')
}