// Rent Tracker is switched on for named accounts only (matched on the account's login email).
// The server refuses everyone else on every Rent Tracker route, and /api/auth/status tells the
// dashboard whether to show the menu, so the two always agree.
const RENT_TRACKER_EMAILS = ['kgncorp2014@gmail.com', 'manpatel1144@gmail.com']

// The Monday the tracker starts counting from (the week it went live). A car's rent is counted
// from this week or from the week the car was given to the renter, whichever is later.
export const TRACKER_START = '2026-10-12'

export function rentTrackerAllowed(email: string | null | undefined): boolean {
  return typeof email === 'string' && RENT_TRACKER_EMAILS.includes(email.trim().toLowerCase())
}
