import mongoose, { Schema, Document } from 'mongoose'

export interface IServiceRecord extends Document {
  plate: string
  vehicleType?: 'scooter' | 'car' | 'e-bike'
  vehicleCategory?: 'rental' | 'personal'
  serviceType: 'oil_change' | 'tyres' | 'brakes' | 'general' | 'other'
  description: string
  cost?: number
  notes?: string
  date: Date
  employeeName?: string
  customerName?: string
  customerPhone?: string
  ownerId?: string
}

const ServiceRecordSchema = new Schema<IServiceRecord>(
  {
    plate:           { type: String, required: true, uppercase: true, trim: true },
    vehicleType:     { type: String, enum: ['scooter', 'car', 'e-bike'] },
    vehicleCategory: { type: String, enum: ['rental', 'personal'], default: 'rental' },
    serviceType:     { type: String, enum: ['oil_change', 'tyres', 'brakes', 'general', 'other'], required: true },
    description:     { type: String, required: true },
    cost:            { type: Number },
    notes:           { type: String },
    date:            { type: Date, default: Date.now },
    employeeName:    { type: String },
    customerName:    { type: String },
    customerPhone:   { type: String },
    ownerId:         { type: String, index: true },
  },
  { timestamps: true }
)

export default mongoose.model<IServiceRecord>('ServiceRecord', ServiceRecordSchema)