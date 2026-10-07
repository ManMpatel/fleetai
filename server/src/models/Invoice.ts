import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

const LineItemSchema = new mongoose.Schema({
  description: String,
  days:        Number,
  unitPrice:   Number,
  amount:      Number,
})

// Business details as they were when an emailed invoice was created. Only used by the public
// invoice page if the template itself has since been deleted (the logo is not copied).
const TemplateSnapshotSchema = new mongoose.Schema({
  businessName: String,
  address:      String,
  phone:        String,
  email:        String,
  abn:          String,
  bankName:     String,
  bsb:          String,
  account:      String,
  color:        String,
}, { _id: false })

const InvoiceSchema = new mongoose.Schema({
  orgId:         { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  templateId:    { type: String, required: true },
  templateName:  { type: String },
  number:        { type: Number, required: true },
  billToName:    String,
  billToAddress: String,
  customerId:    String,
  terms:         String,
  invoiceDate:   String,
  hireFrom:      String,
  hireTo:        String,
  rego:          String,
  lineItems:     [LineItemSchema],
  subtotal:      Number,
  gst:           Number,
  total:         Number,
  balancePaid:   { type: Boolean, default: true },

  // 'added' = 10% GST on top (what every invoice before this option did), so old invoices
  // that have no value stored read back exactly as they always printed.
  gstMode:       { type: String, enum: ['none', 'included', 'added'], default: 'added' },

  // Invoices created by emailing a service record. These carry an unguessable public token,
  // are not counted towards the 20-invoice limit, and are kept when their template is deleted
  // so that links already sent to customers keep working.
  source:           { type: String, enum: ['manual', 'service-email'], default: 'manual' },
  serviceRecordId:  { type: String },
  serviceDate:      { type: String },
  kilometres:       { type: String },
  publicToken:      { type: String },
  templateSnapshot: { type: TemplateSnapshotSchema },
}, { timestamps: true })

InvoiceSchema.index({ publicToken: 1 }, { unique: true, partialFilterExpression: { publicToken: { $type: 'string' } } })
InvoiceSchema.index({ orgId: 1, serviceRecordId: 1 })

InvoiceSchema.plugin(tenantScope)

export default mongoose.model('Invoice', InvoiceSchema)