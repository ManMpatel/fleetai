import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// One line for every email FleetAI sent (or tried to send) for an account. The Rent Tracker uses it
// to show "Emailed today 9:05 am" on a row and to stop the same overdue email going out twice by
// mistake. Nothing is deleted from it.
//   rent-overdue  the overdue-rent email to a renter
//   test          the "Send me a test" email to the account's own login email
const EmailLogSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    kind: { type: String, enum: ['rent-overdue', 'test'], required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    renterId: { type: Schema.Types.ObjectId, ref: 'Renter', default: null },
    to: { type: String, required: true },
    subject: { type: String, default: '' },
    owingC: { type: Number, default: 0 },   // the overdue amount in the email, in cents
    ok: { type: Boolean, required: true },  // false = the email service refused it (error says why)
    error: { type: String, default: '' },
    sentAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
)

EmailLogSchema.index({ orgId: 1, kind: 1, vehicleId: 1, sentAt: -1 })

EmailLogSchema.plugin(tenantScope)

export default mongoose.model('EmailLog', EmailLogSchema)
