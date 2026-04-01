import { Router, Request, Response } from 'express'
import multer from 'multer'
import multerS3 from 'multer-s3'
import { S3Client } from '@aws-sdk/client-s3'
import path from 'path'
import Fine from '../models/Fine'
import Notification from '../models/Notification'

const router = Router()

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET_NAME || 'fleetai-uploads',
    key: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
      cb(null, `uploads/${unique}${path.extname(file.originalname)}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF, JPG, JPEG, PNG files allowed'))
    }
  },
})

// POST /api/upload/fine
router.post('/fine', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const { vehicleId, amount, description, date, type } = req.body
    const pdfUrl = (req.file as any).location

    const fine = new Fine({
      vehicle: vehicleId,
      type: type || 'fine',
      amount: parseFloat(amount) || 0,
      description: description || 'Uploaded fine',
      date: date ? new Date(date) : new Date(),
      paid: false,
      pdfUrl,
    })
    await fine.save()

    await Notification.create({
      type: type === 'toll' ? 'toll' : 'fine',
      title: `New ${type || 'fine'} uploaded`,
      description: description || `$${amount} ${type || 'fine'}`,
      actionRequired: true,
    })

    res.status(201).json({ fine, pdfUrl })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/upload/document
router.post('/document', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const fileUrl = (req.file as any).location
    res.status(201).json({ url: fileUrl, filename: req.file.originalname })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

export default router