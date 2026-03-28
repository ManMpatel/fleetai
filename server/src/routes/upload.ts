import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import Fine from '../models/Fine'
import Notification from '../models/Notification'

const router = Router()

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '../../uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `${unique}${path.extname(file.originalname)}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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

// POST /api/upload/fine — upload fine document
router.post('/fine', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const { vehicleId, amount, description, date, type } = req.body
    const pdfUrl = `/uploads/${req.file.filename}`

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

    // Create notification
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

// POST /api/upload/document — general document upload
router.post('/document', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const fileUrl = `/uploads/${req.file.filename}`
    res.status(201).json({ url: fileUrl, filename: req.file.originalname })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

export default router
