import mongoose, { Schema, Document } from 'mongoose'
import { tenantScope } from './plugins/tenantScope'

export type NotificationType = 'fine' | 'toll' | 'rego' | 'whatsapp' | 'info'

export interface INotification extends Document {
  orgId: mongoose.Types.ObjectId
  type: NotificationType
  title: string
  description: string
  plate?: string
  read: boolean
  date: Date
  actionRequired: boolean
}

const NotificationSchema = new Schema<INotification>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    type: { type: String, enum: ['fine', 'toll', 'rego', 'whatsapp', 'info'], required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    plate: { type: String },
    read: { type: Boolean, default: false },
    date: { type: Date, default: Date.now },
    actionRequired: { type: Boolean, default: false },
  },
  { timestamps: true }
)

NotificationSchema.plugin(tenantScope)

export default mongoose.model<INotification>('Notification', NotificationSchema)
