import mongoose, { Schema } from 'mongoose'

const TransactionSchema = new Schema({
  renterId:      { type: String, required: true, index: true },
  ownerId:       { type: String, required: true, index: true },
  transactionId: { type: Number, required: true, unique: true },
  date:          { type: String },
  amount:        { type: Number },
  status:        { type: String },
  description:   { type: String },
  isVoidable:    { type: Boolean, default: false },
  isRefundable:  { type: Boolean, default: false },
  responseCode:  { type: String },
}, { timestamps: true })

export default mongoose.model('Transaction', TransactionSchema)