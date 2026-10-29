import RentEntry from '../models/RentEntry'
import RentRow from '../models/RentRow'
import Vehicle from '../models/Vehicle'
import { stampLegacyBinRows } from './rentBin'

// A one-time job that runs the first time a Rent Tracker route is used after the server starts.
// It is safe to run again and again (the second run finds nothing to do).
//
// Money used to be one amount per car and week. It is now one amount per car, week AND renter,
// so that a new renter starts with an empty row while the first renter's money stays in History.
//   1. Make sure the new unique index exists, then drop the old one (Mongoose never drops an
//      index by itself, and the old one would refuse two renters' money in the same week).
//   2. Money typed before this change stays with whoever has the car now (nobody = no renter).
//   3. Every car that already has money in the tracker stays on the table. From now on a car is
//      on the table only when the owner has added its number plate.
//   4. A row that was taken off the table before the Recycle bin existed has no removal date. It
//      gets today's date, so its 30 days in the Recycle bin start now (see rentBin.ts).
const OLD_INDEX = 'orgId_1_vehicleId_1_weekStart_1'

let started: Promise<void> | null = null

// Never rejects: a problem is written to the log, the page carries on, and the next request
// tries again.
export function rentTrackerReady(): Promise<void> {
  if (!started) {
    started = prepare().catch(err => {
      started = null
      console.error('Rent Tracker start-up step failed:', err?.message || err)
    })
  }
  return started
}

async function prepare(): Promise<void> {
  await RentEntry.createIndexes()
  try {
    await RentEntry.collection.dropIndex(OLD_INDEX)
  } catch (err: any) {
    if (!/not found|no such index/i.test(String(err?.message))) throw err
  }

  const old: any[] = await RentEntry.collection
    .aggregate([{ $match: { renterId: { $exists: false } } }, { $group: { _id: { orgId: '$orgId', vehicleId: '$vehicleId' } } }])
    .toArray()
  for (const { _id: key } of old) {
    const car: any = await Vehicle.collection.findOne({ _id: key.vehicleId }, { projection: { currentRenter: 1 } })
    await RentEntry.collection.updateMany(
      { orgId: key.orgId, vehicleId: key.vehicleId, renterId: { $exists: false } },
      { $set: { renterId: car?.currentRenter ?? null } }
    )
    if (car) {
      await RentRow.updateOne({ orgId: key.orgId, vehicleId: key.vehicleId }, { $setOnInsert: { weeklyRent: 0, removed: false } }, { upsert: true })
    }
  }

  const stamped = await stampLegacyBinRows()
  if (stamped > 0) console.log(`Rent Tracker: ${stamped} row(s) taken off the table earlier are now in the Recycle bin (30 days from today)`)
}
