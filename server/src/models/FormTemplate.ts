import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

// A form the owner built by ticking sections of the claim form. Its link (/form/<code>) is the
// same for every renter it is sent to. The code is long and random: it is the only thing a renter
// needs to open the form, so it is looked up by itself (the one deliberate cross-tenant read).
export interface IFormTemplate extends Document {
  orgId: mongoose.Types.ObjectId
  name: string
  intro: string
  sectionIds: string[]
  code: string
  createdAt: Date
  updatedAt: Date
}

const FormTemplateSchema = new Schema<IFormTemplate>(
  {
    orgId:      { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name:       { type: String, required: true, trim: true },
    intro:      { type: String, default: '' },
    sectionIds: { type: [String], default: [] },
    code:       { type: String, required: true, unique: true },
  },
  { timestamps: true }
)

FormTemplateSchema.plugin(tenantScope)

export default mongoose.model<IFormTemplate>('FormTemplate', FormTemplateSchema)
