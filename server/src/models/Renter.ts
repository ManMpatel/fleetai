import mongoose, { Schema, Document } from 'mongoose'

export interface IRenter extends Document {
  name: string
  phone: string
  email: string
  dateOfBirth?: string
  licenceNumber: string
  licenceNumberHash?: string
  passportNumberHash?: string
  licencePhotoUrl?: string
  selfieUrl?: string
  passportPhotoUrl?: string
  passportNumber?: string
  docRef?:               string
  licencePhotoBase64?:   string
  selfieBase64?:         string
  passportPhotoBase64?:  string
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
    accountToken?: string
    status: 'active' | 'paused' | 'cancelled' | 'not_setup'
    weeklyAmount?: number
    pendingExtraAmount?: number
    extraCharges?: Array<{ amount: number; note?: string; date: Date }>
    startDate?: Date
    nextDebitDate?: Date
    activity?: Array<{
      type: 'info' | 'error' | 'success' | 'warning'
      message: string
      detail?: string
      expiresAt?: Date
      createdAt: Date
    }>
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

  changeHistory?: Array<{
    field: string
    oldValue: string
    newValue: string
    changedAt: Date
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
    licenceNumber:      { type: String },
    licenceNumberHash:  { type: String },
    passportNumber:     { type: String },
    passportNumberHash: { type: String },
    licencePhotoUrl: { type: String },
    selfieUrl:            { type: String },
    passportPhotoUrl:     { type: String },
    docRef:               { type: String, index: true },
    licencePhotoBase64:   { type: String },
    selfieBase64:         { type: String },
    passportPhotoBase64:  { type: String },
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
      customerId:   { type: String },
      accountToken: { type: String },
      status: {
        type: String,
        enum: ['active', 'paused', 'cancelled', 'not_setup'],
        default: 'not_setup',
      },
      weeklyAmount:       { type: Number },
      pendingExtraAmount: { type: Number },
      extraCharges: [{ amount: { type: Number }, note: { type: String }, date: { type: Date } }],
      startDate:    { type: Date },
      nextDebitDate:{ type: Date },
      activity: [{
        type:      { type: String, enum: ['info','error','success','warning'] },
        message:   { type: String },
        detail:    { type: String },
        expiresAt: { type: Date },
        createdAt: { type: Date, default: Date.now },
      }],
    },

    rentalHistory: [RentalRecordSchema],

    changeHistory: [{
      field:     { type: String },
      oldValue:  { type: String },
      newValue:  { type: String },
      changedAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true }
)

export default mongoose.model<IRenter>('Renter', RenterSchema)