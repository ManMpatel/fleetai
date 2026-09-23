import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// One TollBatch = one scanned PDF the owner uploaded. It tracks the background
// rasterize-then-read job across the whole upload; individual plates live on
// TollFolder documents that reference this batch's _id.

export type TollBatchStatus = 'processing' | 'done' | 'failed'

export interface ITollBatch extends Document {
  orgId: mongoose.Types.ObjectId
  originalFilename: string
  status: TollBatchStatus
  totalPages: number
  processedPages: number
  currentStep?: string
  error?: string
  createdAt: Date
  completedAt?: Date
  originalPdfBase64?: string
  lastProgressAt?: Date
}

const TollBatchSchema = new Schema<ITollBatch>(
  {
    orgId:            { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    originalFilename: { type: String, required: true },
    status:           { type: String, enum: ['processing', 'done', 'failed'], default: 'processing', index: true },
    totalPages:       { type: Number, required: true },
    processedPages:   { type: Number, default: 0 },
    currentStep:      { type: String },
    error:            { type: String },
    completedAt:      { type: Date },
    // The raw uploaded PDF, kept so a failed/stuck batch can resume without asking the
    // owner to find and re-upload the same scan. select:false — never pulled by an
    // ordinary find(), only by /retry which asks for it explicitly.
    originalPdfBase64: { type: String, select: false },
    // Touched on every page processed — tells "still working" apart from "the process
    // died and nobody's touched this row since."
    lastProgressAt:    { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

TollBatchSchema.plugin(tenantScope)

export default mongoose.model<ITollBatch>('TollBatch', TollBatchSchema)
