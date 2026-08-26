import mongoose, { Schema } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

const TransactionSchema = new Schema({
  renterId:      { type: String, required: true, index: true },
  orgId:         { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  transactionId: { type: Number, required: true },
  date:          { type: String },
  amount:        { type: Number },
  status:        { type: String },
  description:   { type: String },
  isVoidable:    { type: Boolean, default: false },
  isRefundable:  { type: Boolean, default: false },
  responseCode:  { type: String },
}, { timestamps: true })

// PayWay numbers transactions sequentially per merchant account, so the same id will
// legitimately appear under two tenants. A global unique index would let whichever tenant
// syncs first permanently block the other's row from being inserted.
TransactionSchema.index({ orgId: 1, transactionId: 1 }, { unique: true })

TransactionSchema.plugin(tenantScope)

export default mongoose.model('Transaction', TransactionSchema)