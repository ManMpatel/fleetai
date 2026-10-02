import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

const InvoiceTemplateSchema = new mongoose.Schema({
  orgId:        { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name:         { type: String, required: true },
  logoBase64:   { type: String },
  businessName: { type: String, required: true },
  address:      { type: String },
  phone:        { type: String },
  email:        { type: String },
  abn:          { type: String },
  bankName:     { type: String },
  bsb:          { type: String },
  account:      { type: String },
  usageCount:   { type: Number, default: 0 },
}, { timestamps: true })

InvoiceTemplateSchema.plugin(tenantScope)

export default mongoose.model('InvoiceTemplate', InvoiceTemplateSchema)