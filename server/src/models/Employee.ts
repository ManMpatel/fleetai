import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

export interface IEmployee extends Document {
  orgId: mongoose.Types.ObjectId
  name: string
  pinHash: string
}

const employeeSchema = new Schema<IEmployee>({
  orgId:   { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name:    { type: String, required: true },
  // 4-digit PIN, stored as an HMAC — never in plaintext.
  pinHash: { type: String, required: true },
}, { timestamps: true })

// Two employees in the same org may not share a PIN, or verify-pin would be ambiguous.
employeeSchema.index({ orgId: 1, pinHash: 1 }, { unique: true })

employeeSchema.plugin(tenantScope)

export default mongoose.model<IEmployee>('Employee', employeeSchema)
