import mongoose, { Document } from 'mongoose'

export interface IClockRecord extends Document {
  ownerId: string
  employeeId: mongoose.Types.ObjectId
  employeeName: string
  type: 'in' | 'out'
  time: Date
  selfieUrl?: string
}

const clockRecordSchema = new mongoose.Schema<IClockRecord>({
  ownerId:      { type: String, required: true },
  employeeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName: { type: String, required: true },
  type:         { type: String, enum: ['in', 'out'], required: true },
  time:         { type: Date, default: Date.now },
  selfieUrl:    { type: String },
}, { timestamps: true })

const ClockRecord = mongoose.model<IClockRecord>('ClockRecord', clockRecordSchema)

export default ClockRecord