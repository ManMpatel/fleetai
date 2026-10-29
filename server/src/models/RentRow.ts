import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// Settings the Rent Tracker keeps for one car (one document per car).
// A car is on the table when it has one of these documents and removed is not true: "Add number
// plate" creates it. "Delete row" sets removed and removedAt: the row waits in the Recycle bin for
// 30 days (Restore, or adding the plate again, brings it back) and is then deleted for good by the
// nightly clean-up (services/rentBin.ts). The money typed for the car is never deleted with it.
// startWeek is an optional "rent counts from this week" chosen in the tracker. It belongs to
// the rental it was set for: startRenterId and startAssignedAt remember which renter had the
// car and when it was given to them, and the setting is ignored once either one changes.
const RentRowSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    weeklyRent: { type: Number, default: 0, min: 0 },
    removed: { type: Boolean, default: false },
    removedAt: { type: Date, default: null },
    startWeek: { type: String, default: null },
    startRenterId: { type: Schema.Types.ObjectId, ref: 'Renter', default: null },
    startAssignedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

RentRowSchema.index({ orgId: 1, vehicleId: 1 }, { unique: true })

RentRowSchema.plugin(tenantScope)

export default mongoose.model('RentRow', RentRowSchema)
