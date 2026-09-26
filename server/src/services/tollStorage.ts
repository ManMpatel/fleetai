import mongoose from 'mongoose'
import { GridFSBucket, ObjectId } from 'mongodb'

function getBucket() {
  return new GridFSBucket(mongoose.connection.db as any, { bucketName: 'tollMergedPdfs' })
}

export async function saveMergedPdf(buffer: Buffer, filename: string): Promise<ObjectId> {
  const bucket = getBucket()
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, { contentType: 'application/pdf' })
    uploadStream.on('finish', () => resolve(uploadStream.id as ObjectId))
    uploadStream.on('error', reject)
    uploadStream.end(buffer)
  })
}

export async function readMergedPdf(fileId: ObjectId | string): Promise<Buffer> {
  const bucket = getBucket()
  const id = typeof fileId === 'string' ? new ObjectId(fileId) : fileId
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    bucket.openDownloadStream(id)
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject)
  })
}

export async function deleteMergedPdf(fileId: ObjectId | string): Promise<void> {
  const bucket = getBucket()
  const id = typeof fileId === 'string' ? new ObjectId(fileId) : fileId
  await bucket.delete(id)
}
