import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// One TollFolder = one plate's pages within a single TollBatch. Scoped to
// { orgId, batchId, plate } rather than { orgId, plate } — a repeat plate next week
// gets a fresh folder in the new batch, never appended to last week's.
//
// plate is null for the single "Unrecognized" bucket a batch may have, for pages
// Gemini couldn't confidently read — those need a person to sort them, not a guess.

export interface ITollFolderPage {
  pageNumber: number
  imageBase64: string
}

export interface ITollFolder extends Document {
  orgId: mongoose.Types.ObjectId
  batchId: mongoose.Types.ObjectId
  plate: string | null
  pages: ITollFolderPage[]
  mergedPdfBase64?: string
  /** True once mergedPdfBase64 is set. A dedicated flag so the 30s poll can check
   *  readiness without fetching the multi-MB blob just to test its presence. */
  merged: boolean
  sentStatus: 'unsent' | 'sent'
  sentTo?: string
  sentAt?: Date
  sentRenter?: mongoose.Types.ObjectId
  createdAt: Date
}

const TollFolderSchema = new Schema<ITollFolder>(
  {
    orgId:   { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'TollBatch', required: true, index: true },
    // null = the batch's "Unrecognized" bucket, not a plate FleetAI could read.
    plate:   { type: String, uppercase: true, trim: true, default: null },
    pages: [
      {
        pageNumber:  { type: Number, required: true },
        imageBase64: { type: String, required: true },
      },
    ],
    // Built once all pages for this folder are in and the batch is otherwise done —
    // this is what actually gets emailed or downloaded, so a folder can be dragged into
    // WhatsApp as one file rather than a bundle a browser can't drag atomically.
    mergedPdfBase64: { type: String },
    merged:          { type: Boolean, default: false, index: true },
    // The ONLY thing that changes this is a successful send via the email path below —
    // WhatsApp's manual drag/download path is untracked by design and never touches this.
    sentStatus: { type: String, enum: ['unsent', 'sent'], default: 'unsent', index: true },
    sentTo:     { type: String },
    sentAt:     { type: Date },
    sentRenter: { type: Schema.Types.ObjectId, ref: 'Renter', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

// A given plate appears at most once per batch — pages for it always merge into the
// same folder while that batch is still being processed.
TollFolderSchema.index({ orgId: 1, batchId: 1, plate: 1 }, { unique: true, sparse: true })

TollFolderSchema.plugin(tenantScope)

export default mongoose.model<ITollFolder>('TollFolder', TollFolderSchema)
