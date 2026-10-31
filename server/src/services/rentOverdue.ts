import { Types } from 'mongoose'
import EmailLog from '../models/EmailLog'
import { buildGrid } from './rentGrid'
import { addDays, dateInTz } from './rentWeeks'

// Who can be sent an overdue-rent email from the Rent Tracker, and who was emailed already.
// Everything starts from buildGrid (rentGrid.ts), so the Owing in an email is the Owing in the table.

// ok            can be emailed
// no-renter     nobody has the car
// no-rent       the weekly rent is not set
// not-owing     owes less than $1
// no-reminder   a 0 was typed for this week ("no reminder this week")
// no-email      the renter has no email saved
// bad-email     the saved email does not look like an email
export type MailReason = 'ok' | 'no-renter' | 'no-rent' | 'not-owing' | 'no-reminder' | 'no-email' | 'bad-email'

export const MIN_OWING_CENTS = 100

export const REASON_TEXT: Record<MailReason, string> = {
  ok: '',
  'no-renter': 'Nobody has this car',
  'no-rent': 'The weekly rent is not set for this car',
  'not-owing': 'This renter does not owe $1 or more',
  'no-reminder': 'A 0 is typed for this week, which means no reminder',
  'no-email': 'This renter has no email saved',
  'bad-email': 'The email saved for this renter does not look right',
}

const EMAIL_SHAPE = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[A-Za-z]{2,}$/

// Why a row can or cannot be emailed. The first reason that applies wins.
export function mailReason(row: any, currentWeek: string): MailReason {
  if (!row.renter) return 'no-renter'
  if (!(row.weeklyRent > 0)) return 'no-rent'
  if (Math.round(row.owing * 100) < MIN_OWING_CENTS) return 'not-owing'
  if (row.entries?.[currentWeek]?.amount === 0) return 'no-reminder'
  const email = String(row.renter.email || '').trim()
  if (!email) return 'no-email'
  if (!EMAIL_SHAPE.test(email)) return 'bad-email'
  return 'ok'
}

// The Rent Tracker rows of this month's view with the reason each can or cannot be emailed.
// The Owing of a row does not depend on the month on screen, so this month's view is enough.
export async function overdueRows(orgId: Types.ObjectId, tz: string, now = new Date()) {
  const grid = await buildGrid(orgId, tz, undefined, 1, now)
  const sunday = addDays(grid.currentWeek, 6)
  const rows = grid.rows.map(row => ({ row, reason: mailReason(row, grid.currentWeek) }))
  return { grid, sunday, rows }
}

// When each renter was last emailed today, by 'vehicleId:renterId' (a new renter of the same car
// has not been emailed). Failed sends and test emails do not count.
export async function emailedToday(orgId: Types.ObjectId, vehicleIds: string[], today: string, tz: string, now = new Date()): Promise<Map<string, Date>> {
  const found = new Map<string, Date>()
  if (vehicleIds.length === 0) return found
  const since = new Date(now.getTime() - 36 * 3600 * 1000)
  const logs: any[] = await EmailLog.find({ orgId, kind: 'rent-overdue', ok: true, vehicleId: { $in: vehicleIds }, sentAt: { $gte: since } })
    .select('vehicleId renterId sentAt')
    .sort({ sentAt: -1 })
    .lean()
  for (const log of logs) {
    if (dateInTz(log.sentAt, tz) !== today) continue
    const key = `${log.vehicleId}:${log.renterId}`
    if (!found.has(key)) found.set(key, log.sentAt)
  }
  return found
}

// The same overdue email must not go to the same renter twice within this many minutes.
export const REPEAT_MINUTES = 2

export async function emailedJustNow(orgId: Types.ObjectId, vehicleId: string, renterId: string, now = new Date()): Promise<Date | null> {
  const log: any = await EmailLog.findOne({
    orgId, kind: 'rent-overdue', ok: true, vehicleId, renterId, sentAt: { $gte: new Date(now.getTime() - REPEAT_MINUTES * 60000) },
  }).select('sentAt').sort({ sentAt: -1 }).lean()
  return log ? log.sentAt : null
}

// Writes one line to the email log. A problem here never stops the answer: the email has gone.
export async function writeEmailLog(line: {
  orgId: Types.ObjectId; kind: 'rent-overdue' | 'test'; vehicleId: string; renterId: string
  to: string; subject: string; owingC: number; ok: boolean; error?: string
}): Promise<void> {
  try {
    await EmailLog.create({ ...line, error: line.error || '', sentAt: new Date() })
  } catch (err: any) {
    console.error('Email log failed:', err?.message || err)
  }
}
