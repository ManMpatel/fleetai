import { Router, Request, Response } from 'express'
import multer from 'multer'
import Employee from '../models/Employee'
import ClockRecord from '../models/ClockRecord'
import ServiceRecord from '../models/ServiceRecord'
import Vehicle from '../models/Vehicle'
import { hash } from '../services/encryption'
import { requireTabletToken } from '../middleware/tenant'

// Workshop tablet API. The tablet is an unattended shared device, so it authenticates
// with a revocable per-device token rather than a user login. Crucially the tenant comes
// from that token — previously these endpoints took an ownerId straight from the request
// body, which let any caller read and write any tenant's service records.
const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

router.use(requireTabletToken)

// GET /api/tablet/session — lets the tablet confirm its link and show the operator name
router.get('/session', async (req: Request, res: Response) => {
  const org = req.org!
  res.json({
    orgName: org.displayName || org.name || '',
    logoUrl: org.logoUrl || null,
  })
})

// GET /api/tablet/vehicle/:plate — plate check for the service form. Returns the bare
// minimum rather than the full vehicle record, since the tablet is a shared device.
router.get('/vehicle/:plate', async (req: Request, res: Response) => {
  try {
    const vehicle = await Vehicle.findOne({
      plate: req.params.plate.toUpperCase(),
      orgId: req.orgId,
    })
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' })
    res.json({ plate: vehicle.plate, model: (vehicle as any).model, type: vehicle.type })
  } catch {
    res.status(500).json({ error: 'Lookup failed' })
  }
})

// POST /api/tablet/verify-pin
router.post('/verify-pin', async (req: Request, res: Response) => {
  try {
    const { pin } = req.body as { pin?: string }
    if (!pin) return res.status(400).json({ error: 'PIN required' })

    const employee = await Employee.findOne({ pinHash: hash(pin), orgId: req.orgId })
    if (!employee) return res.status(401).json({ error: 'Invalid PIN' })

    res.json({ employee: { _id: employee._id, name: employee.name } })
  } catch { res.status(500).json({ error: 'Failed to verify PIN' }) }
})

// POST /api/tablet/clock — clock in or out with selfie upload
router.post('/clock', upload.single('selfie'), async (req: Request, res: Response) => {
  try {
    const { pin, type } = req.body as { pin?: string; type?: string }
    if (!pin || !type) return res.status(400).json({ error: 'Missing fields' })

    // Re-verify the PIN rather than trusting an employeeId sent by the client.
    const employee = await Employee.findOne({ pinHash: hash(pin), orgId: req.orgId })
    if (!employee) return res.status(401).json({ error: 'Invalid PIN' })

    const record = new ClockRecord({
      orgId: req.orgId,
      employeeId: employee._id,
      employeeName: employee.name,
      type,
      selfieBase64: req.file ? req.file.buffer.toString('base64') : undefined,
    })
    await record.save()
    res.status(201).json({ _id: record._id, type: record.type, time: record.time })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// POST /api/tablet/log-service
router.post('/log-service', async (req: Request, res: Response) => {
  try {
    const {
      pin, plate, vehicleCategory, vehicleType,
      customerName, customerPhone, serviceType, description, cost, notes,
    } = req.body

    if (!pin) return res.status(400).json({ error: 'PIN required' })

    const employee = await Employee.findOne({ pinHash: hash(pin), orgId: req.orgId })
    if (!employee) return res.status(401).json({ error: 'Invalid PIN' })

    const record = new ServiceRecord({
      orgId: req.orgId,
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

// GET /api/tablet/service-records?date=|from=&to=
router.get('/service-records', async (req: Request, res: Response) => {
  try {
    const { date, from, to, plate } = req.query
    const filter: any = { orgId: req.orgId }

    if (plate) {
      filter.plate = (plate as string).toUpperCase()
    } else if (from && to) {
      const start = new Date(from as string); start.setHours(0, 0, 0, 0)
      const end = new Date(to as string); end.setHours(23, 59, 59, 999)
      filter.date = { $gte: start, $lte: end }
    } else {
      const d = date ? new Date(date as string) : new Date()
      const start = new Date(d); start.setHours(0, 0, 0, 0)
      const end = new Date(d); end.setHours(23, 59, 59, 999)
      filter.date = { $gte: start, $lte: end }
    }

    const records = await ServiceRecord.find(filter).sort({ date: -1 })
    res.json(records)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/tablet/service-records/:id
router.patch('/service-records/:id', async (req: Request, res: Response) => {
  try {
    const updates = { ...req.body }
    delete updates.orgId
    delete updates.ownerId
    if (updates.status === 'done') updates.completedAt = new Date()

    const record = await ServiceRecord.findOneAndUpdate(
      { _id: req.params.id, orgId: req.orgId },
      { $set: updates },
      { new: true }
    )
    if (!record) return res.status(404).json({ error: 'Record not found' })
    res.json(record)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
