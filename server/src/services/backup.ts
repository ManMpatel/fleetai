import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
import mongoose from 'mongoose'

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = process.env.AWS_BUCKET_NAME || 'fleetai-uploads'

export async function runMongoBackup() {
  try {
    console.log('🗄️ Starting MongoDB backup...')

    // Get all collections
    const db = mongoose.connection.db
    if (!db) throw new Error('Database not connected')
    const collections = await db.listCollections().toArray()

    const backup: Record<string, any[]> = {}

    for (const col of collections) {
      const docs = await db.collection(col.name).find({}).toArray()
      backup[col.name] = docs
    }

    const json = JSON.stringify(backup, null, 2)
    const date = new Date().toISOString().split('T')[0] // e.g. 2026-04-01
    const key = `backups/fleetai-backup-${date}.json`

    // Upload to S3
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: json,
      ContentType: 'application/json',
    }))

    console.log(`✅ Backup saved to S3: ${key}`)

    // Delete backups older than 30 days
    await deleteOldBackups()

  } catch (err) {
    console.error('❌ Backup failed:', err)
  }
}

async function deleteOldBackups() {
  const list = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: 'backups/',
  }))

  if (!list.Contents) return

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  for (const obj of list.Contents) {
    if (obj.LastModified && obj.LastModified < cutoff) {
      await s3.send(new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: obj.Key!,
      }))
      console.log(`🗑️ Deleted old backup: ${obj.Key}`)
    }
  }
}