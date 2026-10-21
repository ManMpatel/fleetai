import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

export type FormEntryStatus = 'sent' | 'submitted' | 'completed'
export type FormEntryVia = 'email' | 'whatsapp' | 'copy' | 'link'

// One row of the Forms history: a form sent to a renter, and (once the renter sends it back) what
// the renter answered. The template link is shared, so there is no "opened" step: a row is
// Sent -> Submitted (the renter sent it back) -> Completed (the owner filled in his part).
//
// Answers are stored as data[sectionId][fieldId]. Pictures (licence, photos, signature) live in
// `files` as data URLs, kept apart so the list never has to load them; `fileCounts` says how many
// pictures each box has (fileCounts[sectionId][fieldId], nested like the answers because a MongoDB
// key cannot hold a dot) so the owner's screen knows without loading them.
export interface IFormEntry extends Document {
  orgId: mongoose.Types.ObjectId
  templateId: mongoose.Types.ObjectId
  templateName: string
  sectionIds: string[]
  renterName: string
  renterPhone: string
  renterEmail: string
  renterRef?: mongoose.Types.ObjectId
  via: FormEntryVia
  sentTo: string
  sentAt?: Date
  status: FormEntryStatus
  submittedAt?: Date
  completedAt?: Date
  renterData: Record<string, any>
  ownerData: Record<string, any>
  files: Record<string, any>
  fileCounts: Record<string, Record<string, number>>
  createdAt: Date
  updatedAt: Date
}

const FormEntrySchema = new Schema<IFormEntry>(
  {
    orgId:        { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    templateId:   { type: Schema.Types.ObjectId, ref: 'FormTemplate', required: true },
    templateName: { type: String, default: '' },
    sectionIds:   { type: [String], default: [] },
    renterName:   { type: String, default: '' },
    renterPhone:  { type: String, default: '' },
    renterEmail:  { type: String, default: '' },
    renterRef:    { type: Schema.Types.ObjectId, ref: 'Renter' },
    via:          { type: String, enum: ['email', 'whatsapp', 'copy', 'link'], default: 'copy' },
    sentTo:       { type: String, default: '' },
    sentAt:       { type: Date },
    status:       { type: String, enum: ['sent', 'submitted', 'completed'], default: 'sent' },
    submittedAt:  { type: Date },
    completedAt:  { type: Date },
    renterData:   { type: Schema.Types.Mixed, default: {} },
    ownerData:    { type: Schema.Types.Mixed, default: {} },
    files:        { type: Schema.Types.Mixed, default: {} },
    fileCounts:   { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
)

FormEntrySchema.index({ orgId: 1, createdAt: -1 })
FormEntrySchema.index({ orgId: 1, templateId: 1, renterPhone: 1, status: 1 })

FormEntrySchema.plugin(tenantScope)

export default mongoose.model<IFormEntry>('FormEntry', FormEntrySchema)
