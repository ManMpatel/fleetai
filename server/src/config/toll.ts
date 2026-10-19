// How long Toll Batch files are kept. One place, so the nightly clean-up, the "days left"
// number on the page and the download messages can never disagree.
//
// A batch uploaded after the one-copy change stores its own delete date (TollBatch.expiresAt).
// Batches uploaded before it have no such date, so they keep the old 45-day rule.

export const TOLL_RETENTION_DAYS = 21
export const TOLL_LEGACY_RETENTION_DAYS = 45
export const DAY_MS = 24 * 60 * 60 * 1000

/** The delete date for a batch uploaded at `createdAt` (default: now). */
export function tollExpiryFrom(createdAt: Date = new Date()): Date {
  return new Date(createdAt.getTime() + TOLL_RETENTION_DAYS * DAY_MS)
}

/** When a batch is deleted: its own date, or createdAt + 45 days for a batch that has none. */
export function tollExpiryOf(batch: { expiresAt?: Date | string | null; createdAt: Date | string }): Date {
  if (batch.expiresAt) return new Date(batch.expiresAt)
  return new Date(new Date(batch.createdAt).getTime() + TOLL_LEGACY_RETENTION_DAYS * DAY_MS)
}

/** Whole days left until `expiry` (never below 0). Rounds up, so the upload day shows the full number. */
export function daysUntil(expiry: Date, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((expiry.getTime() - now) / DAY_MS))
}
