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
}

const TollBatchSchema = new Schema<ITollBatch>(
  {
    orgId:            { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    originalFilename: { type: String, required: true },
    status:           { type: String, enum: ['processing', 'done', 'failed'], default: 'processing', index: true },
    totalPages:       { type: Number, required: true },
    processedPages:   { type: Number, default: 0 },
    // Short human-readable line the frontend polls and displays, e.g.
    // "Reading page 142 of 300" or "Merging DEF456 (6 pages)" — real progress, not filler.
    currentStep:      { type: String },
    error:            { type: String },
    completedAt:      { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

TollBatchSchema.plugin(tenantScope)

export default mongoose.model<ITollBatch>('TollBatch', TollBatchSchema)
