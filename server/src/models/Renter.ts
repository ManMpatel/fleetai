import mongoose, { Schema, Document } from 'mongoose'

export interface IRenter extends Document {
  name: string
  phone: string
  email: string
  licenceNumber: string
  currentVehicle?: mongoose.Types.ObjectId
  rentalHistory: Array<{
    vehicle: mongoose.Types.ObjectId
    startDate: Date
    endDate?: Date
  }>
}

const RentalRecordSchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  startDate: { type: Date },
  endDate: { type: Date },
})

const RenterSchema = new Schema<IRenter>(
  {
    name: { type: String, required: true },
    phone: { type: String },
    email: { type: String },
    licenceNumber: { type: String },
    currentVehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    rentalHistory: [RentalRecordSchema],
  },
  { timestamps: true }
)

export default mongoose.model<IRenter>('Renter', RenterSchema)
