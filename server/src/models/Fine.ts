import mongoose, { Schema, Document } from 'mongoose'

export type FineType = 'fine' | 'toll'

export interface IFine extends Document {
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

export default mongoose.model<IFine>('Fine', FineSchema)
