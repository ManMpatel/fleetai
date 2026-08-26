import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

export interface IClockRecord extends Document {
  orgId: mongoose.Types.ObjectId
  employeeId: mongoose.Types.ObjectId
  employeeName: string
  type: 'in' | 'out'
  time: Date
  selfieUrl?: string
  selfieBase64?: string
}

const clockRecordSchema = new Schema<IClockRecord>({
  orgId:        { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  employeeId:   { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName: { type: String, required: true },
  type:         { type: String, enum: ['in', 'out'], required: true },
  time:         { type: Date, default: Date.now },
  selfieUrl:    { type: String },
  selfieBase64: { type: String },
}, { timestamps: true })

clockRecordSchema.plugin(tenantScope)

export default mongoose.model<IClockRecord>('ClockRecord', clockRecordSchema)
