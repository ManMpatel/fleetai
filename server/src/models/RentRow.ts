import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// Settings the Rent Tracker keeps for one car (one document per car).
// startWeek is an optional "rent counts from this week" chosen in the tracker. It belongs to
// the rental it was set for: startRenterId and startAssignedAt remember which renter had the
// car and when it was given to them, and the setting is ignored once either one changes.
const RentRowSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    weeklyRent: { type: Number, default: 0, min: 0 },
    startWeek: { type: String, default: null },
    startRenterId: { type: Schema.Types.ObjectId, ref: 'Renter', default: null },
    startAssignedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

RentRowSchema.index({ orgId: 1, vehicleId: 1 }, { unique: true })

RentRowSchema.plugin(tenantScope)

export default mongoose.model('RentRow', RentRowSchema)
