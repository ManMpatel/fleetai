import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// One cell of the Rent Tracker table: the money received for one car in one week from one renter.
// weekStart is the Monday of the week as a plain date, 'YYYY-MM-DD'.
// renterId is the renter who had the car when the money was typed (null = nobody had the car).
// The money belongs to that renter: when the car goes to someone else the new renter starts with
// an empty row, and the money of the first renter moves to History.
//   no document        = not paid yet
//   amount 0           = "no reminder this week"
//   amount > 0         = money received
//   amount null, nd    = "ND", no rent due that week
// days is the days of rent in that week, 1 to 7 (7 = the whole week, and what an older document
// without days means). A renter who takes the car on a Thursday has 4 days in the first week.
// A document with no money, no ND and under 7 days only remembers the days.
const RentEntrySchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    weekStart: { type: String, required: true },
    renterId: { type: Schema.Types.ObjectId, ref: 'Renter', default: null },
    amount: { type: Number, default: null, min: 0 },
    nd: { type: Boolean, default: false },
    days: { type: Number, default: 7, min: 1, max: 7 },
  },
  { timestamps: true }
)

RentEntrySchema.index({ orgId: 1, vehicleId: 1, weekStart: 1, renterId: 1 }, { unique: true })

RentEntrySchema.plugin(tenantScope)

export default mongoose.model('RentEntry', RentEntrySchema)
