import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

export interface IServiceRecord extends Document {
  orgId: mongoose.Types.ObjectId
  plate: string
  vehicleType?: 'scooter' | 'car' | 'e-bike'
  vehicleCategory?: 'rental' | 'personal'
  serviceType?: 'oil_change' | 'tyres' | 'brakes' | 'general' | 'other'
  description?: string
  cost?: number
  notes?: string
  items?: Array<{ name: string; price?: number }>
  kilometres?: string
  date: Date
  employeeName?: string
  customerName?: string
  customerPhone?: string
  status?: 'pending' | 'done'
  completedAt?: Date
}

const ServiceRecordSchema = new Schema<IServiceRecord>(
  {
    orgId:           { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    plate:           { type: String, required: true, uppercase: true, trim: true },
    vehicleType:     { type: String, enum: ['scooter', 'car', 'e-bike'] },
    vehicleCategory: { type: String, enum: ['rental', 'personal'], default: 'rental' },
    serviceType:     { type: String, enum: ['oil_change', 'tyres', 'brakes', 'general', 'other'], default: 'general' },
    description:     { type: String, default: '' },
    cost:            { type: Number },
    notes:           { type: String },
    items:           [{ _id: false, name: { type: String, required: true }, price: { type: Number } }],
    kilometres:      { type: String },
    date:            { type: Date, default: Date.now },
    employeeName:    { type: String },
    customerName:    { type: String },
    customerPhone:   { type: String },
    status:          { type: String, enum: ['pending', 'done'], default: 'pending' },
    completedAt:     { type: Date },
  },
  { timestamps: true }
)

ServiceRecordSchema.plugin(tenantScope)

export default mongoose.model<IServiceRecord>('ServiceRecord', ServiceRecordSchema)
