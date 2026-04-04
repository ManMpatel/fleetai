import { Router, Request, Response } from 'express'
import Employee from '../models/Employee'
import ClockRecord from '../models/ClockRecord'
import { requireOwner } from '../middleware/ownerAuth'
import multer from 'multer'
import multerS3 from 'multer-s3'
import { S3Client } from '@aws-sdk/client-s3'
import path from 'path'

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
      cb(null, `selfies/${unique}${path.extname(file.originalname)}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
})

// ── Owner-only routes ──────────────────────────────────────
// GET /api/employees
router.get('/', requireOwner, async (req: Request, res: Response) => {
  try {
    const employees = await Employee.find({ ownerId: req.ownerEmail }).sort({ name: 1 })
    res.json(employees)
  } catch { res.status(500).json({ error: 'Failed to fetch employees' }) }
})

// POST /api/employees
router.post('/', requireOwner, async (req: Request, res: Response) => {
  try {
    const { name, pin } = req.body
    if (!name || !pin || pin.length !== 4) return res.status(400).json({ error: 'Name and 4-digit PIN required' })
    const employee = new Employee({ ownerId: req.ownerEmail, name, pin })
    await employee.save()
    res.status(201).json(employee)
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// PUT /api/employees/:id
router.put('/:id', requireOwner, async (req: Request, res: Response) => {
  try {
    const employee = await Employee.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.ownerEmail },
      { $set: req.body },
      { new: true }
    )
    if (!employee) return res.status(404).json({ error: 'Employee not found' })
    res.json(employee)
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// DELETE /api/employees/:id
router.delete('/:id', requireOwner, async (req: Request, res: Response) => {
  try {
    await Employee.findOneAndDelete({ _id: req.params.id, ownerId: req.ownerEmail })
    res.json({ message: 'Deleted' })
  } catch { res.status(500).json({ error: 'Failed to delete' }) }
})

// GET /api/employees/clock-records — owner sees all clock records
router.get('/clock-records', requireOwner, async (req: Request, res: Response) => {
  try {
    const records = await ClockRecord.find({ ownerId: req.ownerEmail })
      .sort({ time: -1 }).limit(100)
    res.json(records)
  } catch { res.status(500).json({ error: 'Failed to fetch clock records' }) }
})

// ── Public tablet routes (PIN-based, no JWT) ───────────────
// POST /api/employees/verify-pin
router.post('/verify-pin', async (req: Request, res: Response) => {
  try {
    const { pin, ownerId } = req.body
    if (!pin || !ownerId) return res.status(400).json({ error: 'PIN and ownerId required' })
    const employee = await Employee.findOne({ pin, ownerId })
    if (!employee) return res.status(401).json({ error: 'Invalid PIN' })
    res.json({ employee })
  } catch { res.status(500).json({ error: 'Failed to verify PIN' }) }
})

// POST /api/employees/clock — clock in or out with selfie upload
router.post('/clock', upload.single('selfie'), async (req: Request, res: Response) => {
  try {
    const { employeeId, employeeName, type, ownerId } = req.body
    if (!employeeId || !type || !ownerId) return res.status(400).json({ error: 'Missing fields' })
    const selfieUrl = req.file ? (req.file as any).location : undefined
    const record = new ClockRecord({ ownerId, employeeId, employeeName, type, selfieUrl })
    await record.save()
    res.status(201).json(record)
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// POST /api/employees/log-service — tablet logs a service record (PIN-gated, no JWT)
router.post('/log-service', async (req: Request, res: Response) => {
  try {
    const {
      pin, ownerId, plate, vehicleCategory, vehicleType,
      customerName, customerPhone, serviceType, description, cost, notes
    } = req.body

    if (!pin || !ownerId) return res.status(400).json({ error: 'PIN and ownerId required' })

    const employee = await Employee.findOne({ pin, ownerId })
    if (!employee) return res.status(401).json({ error: 'Invalid PIN' })

    // Dynamically import ServiceRecord to avoid circular deps
    const ServiceRecord = (await import('../models/ServiceRecord')).default
    const record = new ServiceRecord({
      ownerId,
      plate,
      vehicleCategory,
      vehicleType,
      employeeName: employee.name,
      customerName,
      customerPhone,
      serviceType,
      description,
      cost: cost ? Number(cost) : undefined,
      notes,
      date: new Date(),
    })
    await record.save()
    res.status(201).json(record)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

export default router