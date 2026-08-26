import { Router, Request, Response } from 'express'
import Employee from '../models/Employee'
import ClockRecord from '../models/ClockRecord'
import { hash } from '../services/encryption'

// Owner-facing employee management. Mounted behind requireAuth + requireTenant.
// The unattended tablet endpoints live in routes/tablet.ts with their own credential.
const router = Router()

// GET /api/employees
router.get('/', async (req: Request, res: Response) => {
  try {
    const employees = await Employee.find({ orgId: req.orgId }).sort({ name: 1 })
    // pinHash is never returned — the owner sets a PIN, they do not read it back.
    res.json(employees.map(e => ({ _id: e._id, name: e.name, createdAt: (e as any).createdAt })))
  } catch { res.status(500).json({ error: 'Failed to fetch employees' }) }
})

// GET /api/employees/clock-records
router.get('/clock-records', async (req: Request, res: Response) => {
  try {
    const records = await ClockRecord.find({ orgId: req.orgId })
      .sort({ time: -1 }).limit(100)
    res.json(records)
  } catch { res.status(500).json({ error: 'Failed to fetch clock records' }) }
})

// POST /api/employees
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, pin } = req.body as { name?: string; pin?: string }
    if (!name || !pin || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'Name and 4-digit PIN required' })
    }
    const employee = new Employee({ orgId: req.orgId, name, pinHash: hash(pin) })
    await employee.save()
    res.status(201).json({ _id: employee._id, name: employee.name })
  } catch (err: any) {
    if (err.code === 11000) return res.status(409).json({ error: 'Another employee already uses that PIN' })
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/employees/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, pin } = req.body as { name?: string; pin?: string }
    const updates: Record<string, unknown> = {}
    if (name) updates.name = name
    if (pin) {
      if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' })
      updates.pinHash = hash(pin)
    }

    const employee = await Employee.findOneAndUpdate(
      { _id: req.params.id, orgId: req.orgId },
      { $set: updates },
      { new: true }
    )
    if (!employee) return res.status(404).json({ error: 'Employee not found' })
    res.json({ _id: employee._id, name: employee.name })
  } catch (err: any) {
    if (err.code === 11000) return res.status(409).json({ error: 'Another employee already uses that PIN' })
    res.status(400).json({ error: err.message })
  }
})

// DELETE /api/employees/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await Employee.findOneAndDelete({ _id: req.params.id, orgId: req.orgId })
    if (!deleted) return res.status(404).json({ error: 'Employee not found' })
    res.json({ message: 'Deleted' })
  } catch { res.status(500).json({ error: 'Failed to delete' }) }
})

export default router
