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
  createdAt: Date
}

const TollPageSchema = new Schema<ITollPage>(
  {
    orgId:       { type: Schema.Types.ObjectId, required: true, index: true },
    batchId:     { type: Schema.Types.ObjectId, required: true, index: true },
    folderId:    { type: Schema.Types.ObjectId, required: true, index: true },
    pageNumber:  { type: Number, required: true },
    imageBase64: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

TollPageSchema.plugin(tenantScope)

export default mongoose.model<ITollPage>('TollPage', TollPageSchema)
