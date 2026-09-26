import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// One TollBatch = one scanned PDF the owner uploaded. It tracks the background
// rasterize-then-read job across the whole upload; individual plates live on
// TollFolder documents that reference this batch's _id.

export type TollBatchStatus = 'processing' | 'done' | 'failed' | 'cancelled'

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
  originalPdfFileId?: mongoose.Types.ObjectId
  originalPdfBase64?: string
  lastProgressAt?: Date
}

const TollBatchSchema = new Schema<ITollBatch>(
  {
    orgId:            { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    originalFilename: { type: String, required: true },
    status:           { type: String, enum: ['processing', 'done', 'failed', 'cancelled'], default: 'processing', index: true },
    totalPages:       { type: Number, required: true },
    processedPages:   { type: Number, default: 0 },
    currentStep:      { type: String },
    error:            { type: String },
    completedAt:      { type: Date },
    // GridFS file ID for the raw uploaded PDF — stored outside the document so a
    // large scan can't push the TollBatch document past MongoDB's 16 MB limit.
    // Used by /retry to resume without asking the owner to re-upload.
    originalPdfFileId: { type: Schema.Types.ObjectId, default: null },
    // Legacy field kept in schema only so select:false suppresses it from all find()
    // calls — old documents in MongoDB still carry the raw base64 PDF, and without
    // this entry Mongoose omits the projection and returns MBs of data on every list.
    originalPdfBase64: { type: String, select: false },
    // Touched on every page processed — tells "still working" apart from "the process
    // died and nobody's touched this row since."
    lastProgressAt:    { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

TollBatchSchema.plugin(tenantScope)

export default mongoose.model<ITollBatch>('TollBatch', TollBatchSchema)
