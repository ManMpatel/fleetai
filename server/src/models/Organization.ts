import mongoose, { Schema, Document, Types } from 'mongoose'

// The Organization document *is* the tenant record. One login per tenant for now —
// the Auth0 identity (auth0Id / email) lives here alongside the tenant's config.
// Collection name is pinned to 'owners' so no data move is needed.

export interface IOrganization extends Document {
  _id: Types.ObjectId

  // ── Login identity ──
  email: string
  name?: string
  picture?: string
  auth0Id?: string
  slug?: string
  status: 'pending' | 'approved' | 'rejected'
  approvedAt?: Date
  createdAt: Date

  // ── Branding / locale ──
  displayName?: string
  logoUrl?: string
  timezone: string
  currency: string
  fleetSummary?: string

  // ── Per-tenant external credentials (secrets stored encrypted) ──
  payway?: {
    merchantId?: string
    secretKeyEnc?: string
    publishableKeyEnc?: string
    bankAccountId?: string
  }
  whatsapp?: {
    phoneId?: string
    tokenEnc?: string
    enabled?: boolean
  }
  gmail?: {
    address?: string
    refreshTokenEnc?: string
    enabled?: boolean
  }

  // ── Workshop tablet device token (hash only — raw token shown once) ──
  tabletTokenHash?: string
}

const organizationSchema = new Schema<IOrganization>({
  email:      { type: String, required: true, unique: true },
  name:       { type: String },
  picture:    { type: String },
  auth0Id:    { type: String, index: true },
  slug:       { type: String, unique: true, sparse: true },
  status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedAt: { type: Date },
  createdAt:  { type: Date, default: Date.now },

  displayName:  { type: String },
  logoUrl:      { type: String },
  timezone:     { type: String, default: 'Australia/Sydney' },
  currency:     { type: String, default: 'AUD' },
  // Free-text description of the fleet, injected into the AI chat system prompt.
  fleetSummary: { type: String },

  payway: {
    merchantId:         { type: String },
    secretKeyEnc:       { type: String },
    publishableKeyEnc:  { type: String },
    bankAccountId:      { type: String, default: '0000000A' },
  },

  whatsapp: {
    phoneId:  { type: String, index: true, sparse: true },
    tokenEnc: { type: String },
    enabled:  { type: Boolean, default: false },
  },

  gmail: {
    address:         { type: String },
    refreshTokenEnc: { type: String },
    enabled:         { type: Boolean, default: false },
  },

  tabletTokenHash: { type: String, index: true, sparse: true },
})

export default mongoose.model<IOrganization>('Organization', organizationSchema, 'owners')
