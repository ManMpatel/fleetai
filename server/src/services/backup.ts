import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
import mongoose from 'mongoose'
import fs from 'fs'
import os from 'os'
import path from 'path'

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

// Backups contain every tenant's data, including encrypted bank details, so they are
// kept out of the bucket that serves tenant uploads. Set AWS_BACKUP_BUCKET to a private
// bucket; falling back to the uploads bucket is a deployment smell worth fixing.
const BUCKET = process.env.AWS_BACKUP_BUCKET || process.env.AWS_BUCKET_NAME || 'fleetai-uploads'

// The weekly file is written to disk one document at a time, so memory stays small however big the
// database is. If the file would pass this size the backup stops and uploads nothing (an error is logged).
// Set BACKUP_MAX_MB in .env to allow a bigger file.
const MAX_BYTES = (Number(process.env.BACKUP_MAX_MB) > 0 ? Number(process.env.BACKUP_MAX_MB) : 250) * 1024 * 1024

// Not in the weekly file: the Toll Batch PDFs kept in MongoDB (GridFS: the *.files and *.chunks collections).
// They are big (about 1 GB in October), they only live a few weeks, and the original PDF of a newer batch is
// also in S3. Atlas takes its own snapshots of everything.
function isNotSaved(name: string): boolean {
  return name.startsWith('system.') || name.endsWith('.files') || name.endsWith('.chunks')
}

// Saved without the page pictures. The page rows (plate reads and so on) are small; the base64 pictures are not.
const WITHOUT_FIELDS: Record<string, Record<string, 0>> = {
  tollpages: { imageBase64: 0 },
}

export async function runMongoBackup() {
  let file = ''
  try {
    if (!process.env.AWS_BACKUP_BUCKET) {
      console.warn('WARNING: AWS_BACKUP_BUCKET is not set - writing the multi-tenant backup into the uploads bucket')
    }
    console.log('Starting MongoDB backup...')

    // Get all collections
    const db = mongoose.connection.db
    if (!db) throw new Error('Database not connected')
    const names = (await db.listCollections().toArray()).map(c => c.name).sort()

    const date = new Date().toISOString().split('T')[0] // e.g. 2026-04-01
    const key = `backups/fleetai-backup-${date}.json`
    file = path.join(os.tmpdir(), `fleetai-backup-${date}-${process.pid}.json`)

    const { bytes, saved, skipped } = await writeBackupFile(db, names, file)

    // Upload to S3. The file is never bigger than MAX_BYTES, so it can be held in memory once here.
    const body = await fs.promises.readFile(file)
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }))

    console.log(`Backup saved to S3: ${key} (${(bytes / 1048576).toFixed(1)} MB, ${saved.length} collections)`)
    if (skipped.length > 0) console.log(`   Not in the file: ${skipped.join(', ')}`)

    // Delete backups older than 30 days
    await deleteOldBackups()

  } catch (err) {
    console.error('Backup failed:', err)
  } finally {
    if (file) await fs.promises.rm(file, { force: true }).catch(() => {})
  }
}

// Writes { "collection": [ {doc}, {doc} ], ... } to a file on disk, one document at a time.
async function writeBackupFile(db: mongoose.mongo.Db, names: string[], file: string) {
  const saved: string[] = []
  const skipped: string[] = []
  let bytes = 0
  let pending = ''

  const handle = await fs.promises.open(file, 'w')
  const add = async (text: string) => {
    bytes += Buffer.byteLength(text)
    if (bytes > MAX_BYTES) {
      throw new Error(`the backup file passed ${MAX_BYTES / 1048576} MB, so it was stopped and nothing was uploaded (BACKUP_MAX_MB in .env allows more)`)
    }
    pending += text
    if (pending.length >= 1048576) {
      await handle.write(pending)
      pending = ''
    }
  }

  try {
    await add('{')
    let firstCollection = true
    for (const name of names) {
      if (isNotSaved(name)) {
        skipped.push(name)
        continue
      }
      await add(`${firstCollection ? '\n' : ',\n'}${JSON.stringify(name)}: [`)
      firstCollection = false

      const fields = WITHOUT_FIELDS[name]
      const cursor = db.collection(name).find({}, fields ? { projection: fields } : {})
      let count = 0
      for await (const doc of cursor) {
        await add(`${count === 0 ? '\n' : ',\n'}${JSON.stringify(doc)}`)
        count++
      }
      await add(count === 0 ? ']' : '\n]')
      saved.push(`${name} (${count})`)
    }
    await add('\n}\n')
    if (pending) await handle.write(pending)
  } finally {
    await handle.close()
  }

  return { bytes, saved, skipped }
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
      console.log(`Deleted old backup: ${obj.Key}`)
    }
  }
}
