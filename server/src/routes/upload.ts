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

// POST /api/upload/read-licence — extract data from licence photo using Gemini
router.post('/read-licence', async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType } = req.body
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' })

    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const prompt = `You are reading an Australian driver's licence. Extract the following fields and return ONLY a valid JSON object with no extra text or markdown:
{
  "firstName": "",
  "lastName": "",
  "dateOfBirth": "YYYY-MM-DD format",
  "licenceNumber": "",
  "addressLine1": "",
  "city": "",
  "state": "e.g. NSW",
  "postcode": ""
}
If a field is not visible or unclear, leave it as empty string.`

    const result = await model.generateContent([
      { inlineData: { data: imageBase64, mimeType: mimeType || 'image/jpeg' } },
      prompt
    ])

    const text = result.response.text().trim()
    const clean = text.replace(/```json|```/g, '').trim()
    const data = JSON.parse(clean)
    res.json(data)
  } catch (err: any) {
    console.error('Licence read error:', err)
    res.status(500).json({ error: 'Could not read licence' })
  }
})

// POST /api/upload/read-rego-bulk — process multiple rego PDFs
router.post('/read-rego-bulk', async (req: Request, res: Response) => {
  try {
    const { files } = req.body as { files: { name: string; base64: string; mimeType: string }[] }
    if (!files?.length) return res.status(400).json({ error: 'No files provided' })

    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const prompt = `You are reading an Australian vehicle registration certificate. Extract these fields and return ONLY a valid JSON object, no markdown:
{
  "plate": "plate number e.g. ABC123",
  "make": "vehicle make e.g. Toyota",
  "model": "vehicle model e.g. RAV4",
  "year": "4 digit year",
  "regoExpiry": "YYYY-MM-DD format",
  "vin": "VIN/chassis number",
  "confident": true or false
}`

    const results = []
    for (const file of files) {
      try {
        const result = await model.generateContent([
          { inlineData: { data: file.base64, mimeType: file.mimeType || 'application/pdf' } },
          prompt
        ])
        const text = result.response.text().trim()
        const clean = text.replace(/```json|```/g, '').trim()
        const data = JSON.parse(clean)
        results.push({ filename: file.name, status: data.confident === false ? 'unclear' : 'ok', data })
      } catch {
        results.push({ filename: file.name, status: 'error', data: null })
      }
      await new Promise(r => setTimeout(r, 4100))
    }

    res.json({ results })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router