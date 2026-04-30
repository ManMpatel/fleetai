import mongoose from 'mongoose'

const ownerSchema = new mongoose.Schema({
  email:      { type: String, required: true, unique: true },
  name:       { type: String },
  picture:    { type: String },
  auth0Id:    { type: String },
  slug:         { type: String, unique: true, sparse: true },
  businessName:  { type: String },
  mmApiUsername: { type: String },
  mmApiPassword: { type: String },
  status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedAt: { type: Date },
  createdAt:  { type: Date, default: Date.now },
  paywaySecretKey:      { type: String },
  paywayPublishableKey: { type: String },
  paywayMerchantId:     { type: String },
  paywayBankAccountId:  { type: String },
})

export default mongoose.model('Owner', ownerSchema)