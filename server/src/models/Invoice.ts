import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

const LineItemSchema = new mongoose.Schema({
  description: String,
  days:        Number,
  unitPrice:   Number,
  amount:      Number,
})

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
}, { timestamps: true })

InvoiceSchema.plugin(tenantScope)

export default mongoose.model('Invoice', InvoiceSchema)