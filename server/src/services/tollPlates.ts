// Pure helpers for deciding which plate folder a toll-notice page belongs in.
// No database, no Gemini, no I/O — so every rule here can be tested on its own.
//
// Why this exists: a toll notice prints the same plate several times (the top-right box,
// the "Your vehicle ABC123 was detected" sentence, the payment slip). We ask Gemini to
// copy every one of them exactly as printed, then decide HERE, in code. If the copies
// agree, the plate is trusted. If one disagrees, the page is flagged instead of being
// filed silently. The fleet list is never shown to the model — it is only used here,
// afterwards, under strict rules, so a plate one letter off (EHF76K vs EHF76J) is never
// "corrected" into a different vehicle.

export type ReadStatus = 'verified' | 'single' | 'conflict'

export interface PlateDecision {
  /** Plates this page should be filed under. Empty = nothing readable → Unrecognized. */
  plates: string[]
  /** none = nothing was read. verified = 2+ copies agree. single = only one copy was
   *  printed/read, so there is nothing to cross-check. conflict = copies disagree. */
  status: ReadStatus | 'none'
  /** Every plate read off the page, cleaned but NOT de-duplicated, in reading order. */
  copies: string[]
  /** Plates that were read but not filed under (logging only — not stored). */
  alternatives: string[]
}

/** Upper-cases, strips spaces and a state suffix like "(NSW)". Returns '' if unusable. */
export function cleanPlate(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const p = raw
    .toUpperCase()
    .replace(/\s+/g, '')               // remove all whitespace
    .replace(/\([A-Z]{2,3}\).*$/, '')  // strip state suffix: "(NSW)", "(VIC)", etc.
  return p.length >= 3 && p.length <= 10 && p !== 'NULL' ? p : ''
}

/**
 * Parses Gemini's reply: { "notices": 1, "plates": ["ABC123", "ABC123", ...] }.
 * `plates` keeps duplicates on purpose — the number of agreeing copies is the evidence.
 * Throws on invalid JSON; the caller treats that the same as "could not read".
 */
export function parsePlateRead(text: string): { copies: string[]; notices: number } {
  const clean = text.trim().replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(clean)
  const raw: unknown[] = Array.isArray(parsed?.plates) ? parsed.plates : []
  const copies = raw.map(cleanPlate).filter(Boolean)
  const n = Number(parsed?.notices)
  const notices = Number.isInteger(n) && n >= 1 ? Math.min(n, 2) : 1
  return { copies, notices }
}

/**
 * Decides which plate folder(s) a page goes in, from every copy of the plate printed on it.
 *
 *  - One distinct plate: filed there. verified if 2+ copies agree, single if only one copy.
 *  - A one-notice page where copies disagree: filed under the most-printed plate and marked
 *    conflict. If they are tied there is no safe winner, so it goes under each tied plate
 *    (still marked conflict) rather than being guessed.
 *  - A two-notice page: the two most-printed plates are both kept. A plate seen once next to
 *    one seen 2+ times looks like a stray misread, so that page is marked conflict too.
 *
 * `notices` is how many separate toll demands Gemini says are on the page (1 or 2).
 */
export function decidePlates(copies: string[], notices = 1): PlateDecision {
  const counts = new Map<string, number>()
  for (const c of copies) counts.set(c, (counts.get(c) ?? 0) + 1)
  // Most-printed first; equal counts keep the order they were read in (Array.sort is stable).
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])

  if (ranked.length === 0) return { plates: [], status: 'none', copies, alternatives: [] }

  if (ranked.length === 1) {
    const [plate, n] = ranked[0]
    return { plates: [plate], status: n >= 2 ? 'verified' : 'single', copies, alternatives: [] }
  }

  if (notices < 2) {
    const topCount = ranked[0][1]
    const winners = ranked.filter(([, n]) => n === topCount).map(([p]) => p)
    const alternatives = ranked.filter(([, n]) => n !== topCount).map(([p]) => p)
    return { plates: winners, status: 'conflict', copies, alternatives }
  }

  const keep = ranked.slice(0, 2)
  const rest = ranked.slice(2).map(([p]) => p)
  const counted = keep.map(([, n]) => n)
  const minKeep = Math.min(...counted)
  const maxKeep = Math.max(...counted)
  let status: ReadStatus
  if (rest.length > 0) status = 'conflict'      // a third plate on a two-notice page: something misread
  else if (minKeep >= 2) status = 'verified'    // both notices confirmed by 2+ copies each
  else if (maxKeep >= 2) status = 'conflict'    // one plate seen once beside one seen 2+ times
  else status = 'single'                        // each plate seen once — nothing to cross-check
  return { plates: keep.map(([p]) => p), status, copies, alternatives: rest }
}

// The four classic scanner/OCR slips. Only these are ever auto-corrected to a fleet plate.
// K vs J, M vs N and every other pair are deliberately NOT here: those are different vehicles.
const SLIPS: Record<string, string> = { O: '0', I: '1', B: '8', S: '5' }

/** Treats the four slips as the same character, so EHF76O and EHF760 compare equal. */
export function foldSlips(plate: string): string {
  return plate.replace(/[OIBS]/g, c => SLIPS[c])
}

/** Letters and digits only, so a fleet plate typed "ABC-123" or "ABC 123" compares equal to the printed ABC123. */
function alnum(plate: string): string {
  return plate.replace(/[^A-Z0-9]/g, '')
}

/** True when two plates are the same apart from spaces, hyphens and the four slips. */
export function samePlate(a: string, b: string): boolean {
  return foldSlips(alnum(a)) === foldSlips(alnum(b))
}

/**
 * Matches a printed plate to this business's fleet, strictly:
 *  - exact match → unchanged
 *  - same letters and digits as exactly ONE fleet plate, only a space or hyphen differs
 *    ("ABC-123" on file, "ABC123" printed) → that fleet plate. Nothing was misread.
 *  - differs from exactly ONE fleet plate only by the slips above → that fleet plate
 *    (correctedFrom keeps what was printed)
 *  - anything else → unchanged. A plate that is merely close is never swapped.
 */
export function fitToFleet(printed: string, fleet: string[]): { plate: string; correctedFrom?: string } {
  if (fleet.includes(printed)) return { plate: printed }

  const sameChars = [...new Set(fleet.filter(f => alnum(f) === alnum(printed)))]
  if (sameChars.length === 1) return { plate: sameChars[0] }

  const matches = [...new Set(fleet.filter(f => samePlate(f, printed)))]
  if (matches.length === 1) return { plate: matches[0], correctedFrom: printed }
  return { plate: printed }
}

/** True when a and b differ by exactly one inserted, deleted or changed character. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    let diff = 0
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++diff > 1) return false
    }
    return diff === 1
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  let i = 0
  while (i < short.length && short[i] === long[i]) i++
  return short.slice(i) === long.slice(i + 1)
}

/** Fleet plates one character away from `plate` — shown as "close to …" on a folder that is not in the fleet. */
export function nearFleetPlates(plate: string, fleet: string[]): string[] {
  return [...new Set(fleet.filter(f => oneEditApart(plate, f)))].sort()
}
