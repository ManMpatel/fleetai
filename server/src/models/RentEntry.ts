import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// One cell of the Rent Tracker table: the money received for one car in one week.
// weekStart is the Monday of the week as a plain date, 'YYYY-MM-DD'.
//   no document        = not paid yet
//   amount 0           = "no reminder this week"
//   amount > 0         = money received
//   amount null, nd    = "ND", no rent due that week
const RentEntrySchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    weekStart: { type: String, required: true },
    amount: { type: Number, default: null, min: 0 },
    nd: { type: Boolean, default: false },
  },
  { timestamps: true }
)

RentEntrySchema.index({ orgId: 1, vehicleId: 1, weekStart: 1 }, { unique: true })

RentEntrySchema.plugin(tenantScope)

export default mongoose.model('RentEntry', RentEntrySchema)
