import mongoose, { Schema, Document } from 'mongoose'

export interface IRenter extends Document {
  name: string
  phone: string
  email: string
  dateOfBirth?: string
  licenceNumber: string
  licencePhotoUrl?: string
  selfieUrl?: string
  passportPhotoUrl?: string
  passportNumber?: string
  vehicleType?: 'scooter' | 'car'
  status?: 'pending' | 'active' | 'inactive'
  ownerId?: string

  address?: {
    street?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
  }

  bankName?: string
  accountHolderName?: string
  bsbNumber?: string
  accountNumber?: string

  emergencyContactName?: string
  emergencyContactPhone?: string

  currentVehicle?: mongoose.Types.ObjectId
  rentStartDate?: Date
  weeklyRate?: number

  payway?: {
    customerId?: string
    status: 'active' | 'paused' | 'cancelled' | 'not_setup'
    weeklyAmount?: number
    startDate?: Date
    nextDebitDate?: Date
  }

  rentalHistory: Array<{
    vehicle: mongoose.Types.ObjectId
    plate: string
    startDate: Date
    endDate?: Date
    weeklyRate?: number
    totalWeeks?: number
    totalAmount?: number
  }>
}

const RentalRecordSchema = new Schema({
  vehicle:     { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  plate:       { type: String },
  startDate:   { type: Date },
  endDate:     { type: Date },
  weeklyRate:  { type: Number },
  totalWeeks:  { type: Number },
  totalAmount: { type: Number },
})

const RenterSchema = new Schema<IRenter>(
  {
    name:            { type: String, required: true },
    phone:           { type: String, required: true, unique: true, trim: true },
    email:           { type: String },
    dateOfBirth:     { type: String },
    licenceNumber:   { type: String },
    licencePhotoUrl:    { type: String },
    selfieUrl:          { type: String },
    passportPhotoUrl:   { type: String },
    passportNumber:     { type: String },
    vehicleType:     { type: String, enum: ['scooter', 'car'] },
    status:          { type: String, enum: ['pending', 'active', 'inactive'], default: 'pending' },
    ownerId:         { type: String, index: true },

    address: {
      street:   { type: String },
      city:     { type: String },
      state:    { type: String },
      postcode: { type: String },
      country:  { type: String, default: 'Australia' },
    },

    bankName:             { type: String },
    accountHolderName:    { type: String },
    bsbNumber:            { type: String },
    accountNumber:        { type: String },
    emergencyContactName: { type: String },
    emergencyContactPhone:{ type: String },

    currentVehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    rentStartDate:  { type: Date },
    weeklyRate:     { type: Number },

    payway: {
      customerId: { type: String },
      status: {
        type: String,
        enum: ['active', 'paused', 'cancelled', 'not_setup'],
        default: 'not_setup',
      },
      weeklyAmount:  { type: Number },
      startDate:     { type: Date },
      nextDebitDate: { type: Date },
    },

    rentalHistory: [RentalRecordSchema],
  },
  { timestamps: true }
)

export default mongoose.model<IRenter>('Renter', RenterSchema)