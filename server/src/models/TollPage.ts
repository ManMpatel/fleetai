import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// One TollPage = one rasterized page image within a TollFolder. Separated from the
// folder document so many pages don't push a single folder past MongoDB's 16MB limit.

export interface ITollPage extends Document {
  orgId: mongoose.Types.ObjectId
  batchId: mongoose.Types.ObjectId
  folderId: mongoose.Types.ObjectId
  pageNumber: number
  imageBase64: string
  /** How the plate on this page was read — see services/tollPlates.ts. All four fields
   *  are absent on pages filed before the plate check existed, and on manually moved pages. */
  readSource?: 'text' | 'vision'
  /** verified = 2+ printed copies agreed. single = only one copy, nothing to cross-check.
   *  conflict = copies disagreed (folder shows "Check plate"). confirmed = owner cleared a conflict. */
  readStatus?: 'verified' | 'single' | 'conflict' | 'confirmed'
  /** Every plate read off the page, as printed, duplicates kept. */
  plateCopies?: string[]
  /** Set when the printed plate was fitted to a fleet plate (O/0-type slip only). */
  correctedFrom?: string
  createdAt: Date
}

const TollPageSchema = new Schema<ITollPage>(
  {
    orgId:       { type: Schema.Types.ObjectId, required: true, index: true },
    batchId:     { type: Schema.Types.ObjectId, required: true, index: true },
    folderId:    { type: Schema.Types.ObjectId, required: true, index: true },
    pageNumber:  { type: Number, required: true },
    imageBase64: { type: String, required: true },
    readSource:    { type: String, enum: ['text', 'vision'] },
    readStatus:    { type: String, enum: ['verified', 'single', 'conflict', 'confirmed'] },
    plateCopies:   { type: [String], default: undefined },
    correctedFrom: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

// Serves find({ folderId }).sort({ pageNumber }) — the only query pattern used across
// the merge step, pages route, and reassign route. folderId must be the leading field
// or MongoDB can't use this index for that filter (a prefix-only match).
TollPageSchema.index({ folderId: 1, pageNumber: 1 })

// Covers the alreadyDone resume query find({ orgId, batchId }) and any future
// queries filtering across a whole batch.
TollPageSchema.index({ orgId: 1, batchId: 1, folderId: 1, pageNumber: 1 })

// Serves the "Check plate" lookup — find({ orgId, readStatus: 'conflict' }) with or without
// a batchId. Without it every list refresh would load whole page documents (with images)
// just to test one small field.
TollPageSchema.index({ orgId: 1, readStatus: 1, batchId: 1 })

TollPageSchema.plugin(tenantScope)

export default mongoose.model<ITollPage>('TollPage', TollPageSchema)
