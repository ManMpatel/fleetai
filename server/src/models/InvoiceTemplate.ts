import mongoose from 'mongoose'

const InvoiceTemplateSchema = new mongoose.Schema({
  ownerId:      { type: String, required: true },
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

export default mongoose.model('InvoiceTemplate', InvoiceTemplateSchema)