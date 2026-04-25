import mongoose from 'mongoose'

const InvoiceTemplateSchema = new mongoose.Schema({
  ownerId:    { type: String, required: true },
  name:       { type: String, required: true },
  pdfBase64:  { type: String, required: true },
  usageCount: { type: Number, default: 0 },
}, { timestamps: true })

export default mongoose.model('InvoiceTemplate', InvoiceTemplateSchema)