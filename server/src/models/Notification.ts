import mongoose, { Schema, Document } from 'mongoose'

export type NotificationType = 'fine' | 'toll' | 'rego' | 'whatsapp' | 'info'

export interface INotification extends Document {
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

export default mongoose.model<INotification>('Notification', NotificationSchema)
