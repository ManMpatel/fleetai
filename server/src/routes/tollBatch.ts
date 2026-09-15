import { Router, Request, Response } from 'express'
import multer from 'multer'
import TollBatch from '../models/TollBatch'
import TollFolder from '../models/TollFolder'
import Vehicle from '../models/Vehicle'
import Renter from '../models/Renter'
import Organization from '../models/Organization'
import { rasterizePdf, mergeImagesToPdf } from '../services/tollPdf'
import { sendTollEmail } from '../services/tollEmail'

// TollBatch — an owner scans ~200-300 printed toll notices into one PDF, uploads it
// here, and the pages get sorted into one folder per number plate. Mounted behind
// requireAuth + requireTenant.
//
// Processing runs as a background job (fired from the POST handler, not awaited) because
// a 300-page batch takes ~20 minutes at Gemini's free-tier pace (4.1s between calls).
// The frontend polls GET /:batchId every 30s for progress, matching the pattern already
// used for owner-approval and tablet polling elsewhere in this app.
const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // scanner batches run large; resizing is our job, not the owner's
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true)
    cb(new Error('Only PDF files are accepted'))
  },
})

const GEMINI_DELAY_MS = 4100 // free-tier cap is 15 req/min — same pacing as read-rego-bulk

interface PlateReadResult {
  plate: string | null
}

/**
 * Reads the licence plate off one toll-notice page. Returns null (never a guess) when
 * Gemini is not confident — those pages route to the batch's "Unrecognized" folder for a
 * person to sort, rather than risk filing a toll under the wrong plate.
 */
async function readPlateFromPage(imageBase64: string, mimeType: string): Promise<PlateReadResult> {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const prompt = `You are reading an Australian toll notice (e.g. WestConnex, Linkt). Find the vehicle
number plate the toll was charged against — it is usually printed clearly near the top or
in a "Registration" / "Plate" field.

Return ONLY a valid JSON object, no markdown, no explanation:
{
  "plate": "the plate in uppercase with no spaces, e.g. ABC123 — or null if you cannot read it with confidence"
}

Only return a plate you can actually read. If the text is blurry, cut off, or you are not
sure, return null for plate — do not guess.`

    const result = await model.generateContent([
      { inlineData: { data: imageBase64, mimeType } },
      prompt,
    ])

    const clean = result.response.text().trim().replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    const plate = typeof parsed.plate === 'string' ? parsed.plate.toUpperCase().replace(/\s+/g, '') : null
    if (!plate || plate === 'NULL' || plate.length < 3 || plate.length > 10) return { plate: null }
    return { plate }
  } catch (err: any) {
    console.error('TollBatch plate read error:', err.message)
    return { plate: null }
  }
}

/**
 * The background job: rasterize every page, read its plate, upsert it into that batch's
 * per-plate folder (or the Unrecognized bucket), then merge each folder once all pages
 * are placed. Never awaited by the request handler — errors are captured onto the batch
 * document itself so polling clients see a real failure reason instead of hanging forever.
 */
async function processBatch(batchId: string, orgId: string, pdfBuffer: Buffer): Promise<void> {
  try {
    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, { $set: { currentStep: 'Reading scanned pages' } })

    const pages = await rasterizePdf(pdfBuffer)
    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, { $set: { totalPages: pages.length } })

    for (const page of pages) {
      const { plate } = await readPlateFromPage(page.imageBase64, page.mimeType)
      Organization.findByIdAndUpdate(orgId, { $inc: { geminiCalls: 1 } }).catch(() => {})

      const step = plate
        ? `Page ${page.pageNumber} of ${pages.length} — sorted to ${plate}`
        : `Page ${page.pageNumber} of ${pages.length} — sent to Unrecognized`

      // One folder per plate per batch — never per plate alone, so a repeat plate next
      // week starts a fresh folder rather than appending to this one.
      await TollFolder.findOneAndUpdate(
        { orgId, batchId, plate: plate ?? null },
        {
          $push: { pages: { pageNumber: page.pageNumber, imageBase64: page.imageBase64 } },
          $setOnInsert: { orgId, batchId, plate: plate ?? null },
        },
        { upsert: true, new: true }
      )

      await TollBatch.findOneAndUpdate(
        { _id: batchId, orgId },
        { $inc: { processedPages: 1 }, $set: { currentStep: step } }
      )

      // Gemini free-tier pacing — same 4.1s delay as the existing read-rego-bulk endpoint.
      await new Promise(r => setTimeout(r, GEMINI_DELAY_MS))
    }

    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, { $set: { currentStep: 'Merging folders into PDFs' } })

    const folders = await TollFolder.find({ orgId, batchId })
    for (const folder of folders) {
      const sortedPages = [...folder.pages].sort((a, b) => a.pageNumber - b.pageNumber)
      const mergedPdf = await mergeImagesToPdf(sortedPages.map(p => p.imageBase64))
      folder.mergedPdfBase64 = mergedPdf.toString('base64')
      folder.merged = true
      await folder.save()
    }

    await TollBatch.findOneAndUpdate(
      { _id: batchId, orgId },
      { $set: { status: 'done', currentStep: `Done — ${folders.length} folder${folders.length !== 1 ? 's' : ''}`, completedAt: new Date() } }
    )
  } catch (err: any) {
    console.error('TollBatch processing error:', err.message)
    await TollBatch.findOneAndUpdate(
      { _id: batchId, orgId },
      { $set: { status: 'failed', error: err.message || 'Processing failed' } }
    )
  }
}

// POST /api/toll-batch — upload a scanned PDF and start processing in the background
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' })

    const batch = await TollBatch.create({
      orgId: req.orgId,
      originalFilename: req.file.originalname,
      status: 'processing',
      totalPages: 0,
      processedPages: 0,
      currentStep: 'Starting…',
    })

    // Fire and forget — the client polls GET /:batchId for progress instead of holding
    // this request open for up to ~20 minutes.
    void processBatch(batch._id.toString(), req.orgId!.toString(), req.file.buffer)

    res.status(202).json({ batchId: batch._id })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// GET /api/toll-batch — list batches, newest first
router.get('/', async (req: Request, res: Response) => {
  try {
    const batches = await TollBatch.find({ orgId: req.orgId }).sort({ createdAt: -1 }).limit(50)
    res.json(batches)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/toll-batch/:batchId — one batch's progress + its folders (no page images —
// the frontend only needs plate, page count and send status for the grid; images are
// fetched per-folder on demand).
router.get('/:batchId', async (req: Request, res: Response) => {
  try {
    const batch = await TollBatch.findOne({ _id: req.params.batchId, orgId: req.orgId })
    if (!batch) return res.status(404).json({ error: 'Batch not found' })

    // Neither page images nor the merged PDF blob are fetched here — this is what the
    // 30s poll hits, so it stays cheap regardless of batch size. `merged` is a plain
    // boolean set alongside mergedPdfBase64 in the background job for exactly this.
    const folders = await TollFolder.find({ orgId: req.orgId, batchId: batch._id })
      .select('-pages.imageBase64 -mergedPdfBase64')
      .sort({ plate: 1 })

    res.json({
      batch,
      folders: folders.map(f => ({
        _id: f._id,
        plate: f.plate,
        pageCount: f.pages.length,
        hasMergedPdf: f.merged,
        sentStatus: f.sentStatus,
        sentTo: f.sentTo,
        sentAt: f.sentAt,
      })),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/toll-batch/:batchId/folders/:folderId/renters?q=search
// Renter search for the send picker, plus the suggested renter currently assigned to
// this folder's plate. The suggestion is a hint only — never auto-sent.
router.get('/:batchId/folders/:folderId/renters', async (req: Request, res: Response) => {
  try {
    const folder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId })
    if (!folder) return res.status(404).json({ error: 'Folder not found' })

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const filter: Record<string, unknown> = { orgId: req.orgId }
    if (q) filter.name = { $regex: q, $options: 'i' }

    const matches = await Renter.find(filter).select('name email phone').sort({ name: 1 }).limit(20)

    let suggested = null
    if (folder.plate) {
      const vehicle = await Vehicle.findOne({ orgId: req.orgId, plate: folder.plate }).select('currentRenter')
      if (vehicle?.currentRenter) {
        const renter = await Renter.findOne({ _id: vehicle.currentRenter, orgId: req.orgId }).select('name email phone')
        if (renter) suggested = { _id: renter._id, name: renter.name, email: renter.email || null, phone: renter.phone }
      }
    }

    res.json({
      suggested,
      matches: matches.map(r => ({ _id: r._id, name: r.name, email: r.email || null, phone: r.phone })),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/toll-batch/:batchId/folders/:folderId/download — the merged PDF, for the
// guaranteed Download button and for the best-effort WhatsApp drag target.
router.get('/:batchId/folders/:folderId/download', async (req: Request, res: Response) => {
  try {
    const folder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId })
    if (!folder) return res.status(404).json({ error: 'Folder not found' })
    if (!folder.mergedPdfBase64) return res.status(409).json({ error: 'This folder is still processing' })

    const label = folder.plate || 'Unrecognized'
    const buffer = Buffer.from(folder.mergedPdfBase64, 'base64')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${label}.pdf"`)
    res.send(buffer)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/toll-batch/:batchId/folders/:folderId/send
// The real, automated email send. Requires an explicit recipient — either a registered
// renter's id or a raw typed address — the frontend never sends the suggested renter
// without the owner pressing Send. Only a successful send may flip sentStatus.
router.post('/:batchId/folders/:folderId/send', async (req: Request, res: Response) => {
  try {
    const folder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId })
    if (!folder) return res.status(404).json({ error: 'Folder not found' })
    if (!folder.mergedPdfBase64) return res.status(409).json({ error: 'This folder is still processing' })

    const { renterId, email } = req.body as { renterId?: string; email?: string }

    let toAddress: string | null = null
    let sentRenterId: string | null = null

    if (renterId) {
      const renter = await Renter.findOne({ _id: renterId, orgId: req.orgId })
      if (!renter) return res.status(404).json({ error: 'Renter not found' })
      if (!renter.email) {
        return res.status(400).json({ error: `${renter.name} has no email on file — type an address instead` })
      }
      toAddress = renter.email
      sentRenterId = renter._id.toString()
    } else if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toAddress = email.trim()
    } else {
      return res.status(400).json({ error: 'Provide a registered renter or a valid email address' })
    }

    // requireTenant already resolved and attached the calling org to every request —
    // no need to re-fetch it here.
    const org = req.org!

    const label = folder.plate || 'Unrecognized'
    const pdfBuffer = Buffer.from(folder.mergedPdfBase64, 'base64')

    // sendTollEmail throws with the real failure reason (bad address, SMTP auth
    // rejected, not connected) — that reaches the owner as-is, never a false "sent".
    await sendTollEmail(org, toAddress, `Toll notices — ${label}`, pdfBuffer, `${label}.pdf`)

    folder.sentStatus = 'sent'
    folder.sentTo = toAddress
    folder.sentAt = new Date()
    folder.sentRenter = sentRenterId as any
    await folder.save()

    res.json({ success: true, sentTo: toAddress, sentAt: folder.sentAt })
  } catch (err: any) {
    // Never reported as a partial success — the folder's sentStatus was not touched above.
    res.status(400).json({ error: err.message || 'Send failed' })
  }
})

export default router
