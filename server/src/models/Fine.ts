import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

export type FineType = 'fine' | 'toll'

export interface IFine extends Document {
  orgId: mongoose.Types.ObjectId
  vehicle: mongoose.Types.ObjectId
  renter?: mongoose.Types.ObjectId
  type: FineType
  amount: number
  description: string
  date: Date
  paid: boolean
  pdfUrl?: string
}

const FineSchema = new Schema<IFine>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    renter: { type: Schema.Types.ObjectId, ref: 'Renter', default: null },
    type: { type: String, enum: ['fine', 'toll'], required: true },
    amount: { type: Number, required: true },
    description: { type: String },
    date: { type: Date, required: true },
    paid: { type: Boolean, default: false },
    pdfUrl: { type: String },
  },
  { timestamps: true }
)

FineSchema.plugin(tenantScope)

export default mongoose.model<IFine>('Fine', FineSchema)
