import RentRow from '../models/RentRow'

// The Recycle bin of the Rent Tracker.
//
// "Delete row" does not delete anything at once: the row (its weekly rent and start week) is marked
// removed, with the time (removedAt), and waits in the Recycle bin for 30 days. In that time Restore
// (or adding the plate again) puts it back exactly as it was. After 30 days the nightly clean-up
// deletes the row itself. The money typed for the car (RentEntry) is never deleted with it: it stays
// saved, and it is back when the plate is added to the table again.

export const BIN_DAYS = 30
const DAY_MS = 86400000

// Whole days left before a row in the bin is deleted for good: rounded up, from 30 down to 0. A row
// with no date (see stampLegacyBinRows) counts as just deleted.
export function binDaysLeft(removedAt: Date | string | number | null | undefined, now: Date = new Date()): number {
  const t = removedAt == null ? NaN : new Date(removedAt).getTime()
  if (!Number.isFinite(t)) return BIN_DAYS
  return Math.max(0, Math.min(BIN_DAYS, Math.ceil((t + BIN_DAYS * DAY_MS - now.getTime()) / DAY_MS)))
}

// The nightly clean-up (runs from index.ts, 3:45am): deletes the rows that have been in the bin for
// 30 days. Only the row goes. A row with no removal date is never deleted here. Returns how many rows
// were deleted (it is safe to run again: the second run finds nothing).
export async function purgeRentBin(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - BIN_DAYS * DAY_MS)
  const done = await RentRow.deleteMany({ removed: true, removedAt: { $lte: cutoff } }).setOptions({ allowCrossTenant: true })
  return done.deletedCount ?? 0
}

// Rows that were taken off the table before the Recycle bin existed have no removal date: their 30
// days start now. Safe to run again and again (a row that has a date is not touched).
export async function stampLegacyBinRows(now: Date = new Date()): Promise<number> {
  const done = await RentRow.updateMany({ removed: true, removedAt: null }, { $set: { removedAt: now } }).setOptions({ allowCrossTenant: true })
  return done.modifiedCount ?? 0
}
