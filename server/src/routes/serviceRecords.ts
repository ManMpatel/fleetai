import { Router, Request, Response } from 'express'
import ServiceRecord from '../models/ServiceRecord'

const router = Router()

// GET /api/service-records?plate=ABC123
router.get('/', async (req: Request, res: Response) => {
  try {
    const filter: any = { orgId: req.orgId }
    if (req.query.plate) filter.plate = (req.query.plate as string).toUpperCase()
    if (req.query.phone) filter.customerPhone = req.query.phone

    const records = await ServiceRecord.find(filter).sort({ date: -1 }).limit(100)
    res.json(records)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch service records' })
  }
})

// POST /api/service-records
router.post('/', async (req: Request, res: Response) => {
  try {
    const record = new ServiceRecord({ ...req.body, orgId: req.orgId })
    await record.save()
    res.status(201).json(record)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// PUT /api/service-records/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const record = await ServiceRecord.findOneAndUpdate(
      { _id: req.params.id, orgId: req.orgId },
      { $set: req.body },
      { new: true }
    )
    if (!record) return res.status(404).json({ error: 'Record not found' })
    res.json(record)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// DELETE /api/service-records/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await ServiceRecord.findOneAndDelete({ _id: req.params.id, orgId: req.orgId })
    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' })
  }
})

export default router