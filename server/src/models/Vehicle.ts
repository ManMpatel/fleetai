import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

export type VehicleType = 'scooter' | 'car'
export type VehicleStatus = 'available' | 'rented' | 'service'

// Note: 'model' field in DB — we can't extend mongoose.Document directly
// because Document.model is a reserved method. We use a plain interface here.
export interface IVehicle {
  _id: mongoose.Types.ObjectId
  orgId: mongoose.Types.ObjectId
  plate: string
  model: string
  year: number
  type: VehicleType
  status: VehicleStatus
  currentRenter?: mongoose.Types.ObjectId
  rentStartDate?: Date
  regoExpiry?: Date
  pinkSlip?: Date
  greenSlip?: Date
  lastService?: Date
  fines: mongoose.Types.ObjectId[]
  tolls: mongoose.Types.ObjectId[]
  notes?: string
}

// Using Schema without generic to avoid 'model' field clash with Document.model
const VehicleSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    // Uniqueness is per-tenant (see compound index below), not global — two operators
    // may legitimately hold the same plate.
    plate: { type: String, required: true, uppercase: true, trim: true },
    model: { type: String, required: true },
    year: { type: Number, required: true },
    type: { type: String, enum: ['scooter', 'car'], required: true },
    status: { type: String, enum: ['available', 'rented', 'service'], default: 'available' },
    currentRenter: { type: Schema.Types.ObjectId, ref: 'Renter', default: null },
    rentStartDate: { type: Date },
    regoExpiry: { type: Date },
    pinkSlip: { type: Date },
    greenSlip: { type: Date },
    lastService: { type: Date },
    fines: [{ type: Schema.Types.ObjectId, ref: 'Fine' }],
    tolls: [{ type: Schema.Types.ObjectId, ref: 'Fine' }],
    notes: { type: String },
    regoStatus: { type: String, enum: ['in_stock', 'stolen', 'sold'], default: 'in_stock' },
    regoPhotoBase64: { type: String },
    regoPhotos: [{ base64: { type: String }, uploadedAt: { type: Date, default: Date.now } }],
  },
  { timestamps: true }
)

VehicleSchema.index({ orgId: 1, plate: 1 }, { unique: true })

VehicleSchema.plugin(tenantScope)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default mongoose.model<IVehicle & mongoose.Document<any>>('Vehicle', VehicleSchema)
