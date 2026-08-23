import { Router, Request, Response } from 'express'
import multer from 'multer'
import multerS3 from 'multer-s3'
import { S3Client } from '@aws-sdk/client-s3'
import path from 'path'
import Fine from '../models/Fine'
import Vehicle from '../models/Vehicle'
import Notification from '../models/Notification'

// Mounted behind requireAuth + requireTenant. These endpoints were previously open:
// anyone could create fine records, and the Gemini extraction routes were billable
// calls available without a login.
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
    key: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
      // Objects are namespaced per tenant so one operator's files are separable from
      // another's for access control, auditing and deletion.
      cb(null, `orgs/${(req as Request).orgId}/uploads/${unique}${path.extname(file.originalname)}`)
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
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId is required' })

    // The vehicle must belong to the calling tenant — otherwise a fine could be attached
    // to another operator's vehicle.
    const vehicle = await Vehicle.findOne({ _id: vehicleId, orgId: req.orgId })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })

    const pdfUrl = (req.file as any).location
    const fineType = type === 'toll' ? 'toll' : 'fine'

    const fine = new Fine({
      orgId: req.orgId,
      vehicle: vehicle._id,
      type: fineType,
      amount: parseFloat(amount) || 0,
      description: description || 'Uploaded fine',
      date: date ? new Date(date) : new Date(),
      paid: false,
      pdfUrl,
    })
    await fine.save()

    if (fineType === 'toll') {
      vehicle.tolls.push(fine._id as any)
    } else {
      vehicle.fines.push(fine._id as any)
    }
    await vehicle.save()

    await Notification.create({
      orgId: req.orgId,
      type: fineType,
      title: `New ${fineType} uploaded — ${vehicle.plate}`,
      description: description || `$${amount} ${fineType}`,
      plate: vehicle.plate,
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
    res.status(201).json({ url: (req.file as any).location, filename: req.file.originalname })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/upload/read-licence — extract data from a licence photo using Gemini
router.post('/read-licence', async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType } = req.body
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' })

    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

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
      prompt,
    ])

    const clean = result.response.text().trim().replace(/```json|```/g, '').trim()
    res.json(JSON.parse(clean))
  } catch (err: any) {
    console.error('Licence read error:', err)
    res.status(500).json({ error: 'Could not read licence' })
  }
})

// POST /api/upload/read-rego-bulk — process multiple rego documents
router.post('/read-rego-bulk', async (req: Request, res: Response) => {
  try {
    const { files } = req.body as { files: { name: string; base64: string; mimeType: string }[] }
    if (!files?.length) return res.status(400).json({ error: 'No files provided' })

    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const prompt = `You are reading a vehicle registration document from an image or PDF.

Extract the following details from the registration document:

- plate number
- vehicle model name (for example: Honda Click, Yamaha NMAX)
- manufacture year
- rego expiry date

Return ONLY valid JSON in this exact format:

{
  "plate": "",
  "model": "",
  "year": "",
  "regoExpiry": ""
}

Rules:
- Do NOT include explanations
- Do NOT include markdown
- Only return the JSON object
- If a value cannot be found, return an empty string
`

    const results = []
    for (const file of files) {
      try {
        const result = await model.generateContent([
          { inlineData: { data: file.base64, mimeType: file.mimeType || 'image/jpeg' } },
          prompt,
        ])
        const clean = result.response.text().trim().replace(/```json|```/g, '').trim()
        results.push({ filename: file.name, status: 'ok', data: JSON.parse(clean) })
      } catch (err: any) {
        console.error('Gemini rego error:', err.message)
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
