import { Router, Request, Response } from 'express'
import multer from 'multer'
import TollBatch from '../models/TollBatch'
import TollFolder from '../models/TollFolder'
import Vehicle from '../models/Vehicle'
import Renter from '../models/Renter'
import Organization from '../models/Organization'
import { rasterizePdf, mergeImagesToPdf } from '../services/tollPdf'
import { sendTollEmail } from '../services/tollEmail'
import { GEMINI_MODEL, generateWithRetry, geminiPacingDelay, isRetryableError } from '../config/gemini'
import TollPage from '../models/TollPage'
import { saveMergedPdf, readMergedPdf, deleteMergedPdf, saveOriginalPdf, readOriginalPdf, deleteOriginalPdf } from '../services/tollStorage'

// TollBatch — an owner scans ~200-300 printed toll notices into one PDF, uploads it
// here, and the pages get sorted into one folder per number plate. Mounted behind
// requireAuth + requireTenant.
//
// Processing runs as a background job (fired from the POST handler, not awaited) because
// a large batch can take several minutes. The frontend polls GET /:batchId every 30s for
// progress, matching the pattern already used for owner-approval and tablet polling
// elsewhere in this app.
const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // scanner batches run large; resizing is our job, not the owner's
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true)
    cb(new Error('Only PDF files are accepted'))
  },
})

type MatchType = 'sorted' | 'stolen' | 'sold' | 'unregistered' | 'unrecognized'

function matchTypeFor(plate: string | null, statusByPlate: Map<string, string>): MatchType {
  if (!plate) return 'unrecognized'
  const status = statusByPlate.get(plate)
  if (status === 'stolen') return 'stolen'
  if (status === 'sold') return 'sold'
  if (status) return 'sorted'
  return 'unregistered'
}

interface PlateReadResult {
  plate: string | null
}

/**
 * Reads the licence plate off one toll-notice page. Returns null (never a guess) when
 * Gemini is not confident — those pages route to the batch's "Unrecognized" folder for a
 * person to sort, rather than risk filing a toll under the wrong plate.
 */
async function readPlateFromPage(imageBase64: string, mimeType: string, knownPlates: string[] = []): Promise<PlateReadResult> {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })

    const prompt = `You are reading an Australian toll notice (e.g. WestConnex, Linkt). Find the vehicle
number plate the toll was charged against — it is usually printed clearly near the top or
in a "Registration" / "Plate" field.

Return ONLY a valid JSON object, no markdown, no explanation:
{
  "plate": "the plate in uppercase with no spaces, e.g. ABC123 — or null if you cannot read it with confidence"
}

This business's actual registered plates are: ${knownPlates.length ? knownPlates.join(', ') : '(none on file)'}.
If the plate you're reading closely matches one of these (allowing for a likely misread
character, e.g. O/0, I/1, B/8, S/5), return that exact plate from the list.

Only return a plate you can actually read or confidently match to the list above. If the
text is blurry, cut off, or you are not sure, return null for plate — do not guess.`

    const result = await generateWithRetry(model, [
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
    // Quota/rate errors mean "try again later" — re-throw so processBatch fails the batch
    // rather than silently routing this page to Unrecognized. isRetryableError is the same
    // predicate generateWithRetry uses, so the two layers can never disagree.
    if (isRetryableError(err)) throw err
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

    // Every plate this business has ever had on file (active, sold or stolen) — passed to
    // Gemini so it matches against known plates instead of reading each one blind.
    const fleetVehicles = await Vehicle.find({ orgId }).select('plate')
    const knownPlates = fleetVehicles.map(v => v.plate).filter(Boolean)

    // Resume support: pages already recorded from an earlier attempt at this batch are
    // skipped — this is what makes Retry pick up where it left off instead of re-running
    // the whole thing and re-spending Gemini calls.
    const existingFolders = await TollFolder.find({ orgId, batchId }).select('pages.pageNumber')
    const existingPageDocs = await TollPage.find({ orgId, batchId }).select('pageNumber').lean()
    const alreadyDone = new Set([
      ...existingFolders.flatMap(f => f.pages.map(p => p.pageNumber)),
      ...existingPageDocs.map(p => p.pageNumber),
    ])

    let cancelled = false
    for (const page of pages) {
      if (alreadyDone.has(page.pageNumber)) continue

      const current = await TollBatch.findOne({ _id: batchId, orgId }).select('status').lean()
      if (current?.status === 'cancelled') {
        cancelled = true
        break
      }

      const { plate } = await readPlateFromPage(page.imageBase64, page.mimeType, knownPlates)
      Organization.findByIdAndUpdate(orgId, { $inc: { geminiCalls: 1 } }).catch(() => {})

      const step = plate
        ? `Page ${page.pageNumber} of ${pages.length} — sorted to ${plate}`
        : `Page ${page.pageNumber} of ${pages.length} — sent to Unrecognized`

      // One folder per plate per batch — never per plate alone, so a repeat plate next
      // week starts a fresh folder rather than appending to this one.
      const folder = await TollFolder.findOneAndUpdate(
        { orgId, batchId, plate: plate ?? null },
        { $setOnInsert: { orgId, batchId, plate: plate ?? null } },
        { upsert: true, new: true }
      )
      await TollPage.create({
        orgId, batchId, folderId: folder._id,
        pageNumber: page.pageNumber, imageBase64: page.imageBase64,
      })
      await TollFolder.updateOne({ _id: folder._id, orgId }, { $inc: { pageCount: 1 } })

      await TollBatch.findOneAndUpdate(
        { _id: batchId, orgId },
        { $inc: { processedPages: 1 }, $set: { currentStep: step, lastProgressAt: new Date() } }
      )

      await geminiPacingDelay()
    }

    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, { $set: { currentStep: 'Merging folders into PDFs' } })

    const folders = await TollFolder.find({ orgId, batchId })
    for (const folder of folders) {
      const legacyPages = folder.pages ?? []
      const newPages = await TollPage.find({ folderId: folder._id }).sort({ pageNumber: 1 }).allowDiskUse(true).lean()
      const allPages = [...legacyPages, ...newPages].sort((a, b) => a.pageNumber - b.pageNumber)

      const mergedBuffer = await mergeImagesToPdf(allPages.map(p => p.imageBase64))
      if (folder.mergedPdfFileId) await deleteMergedPdf(folder.mergedPdfFileId as any).catch(() => {})
      const mergedPdfFileId = await saveMergedPdf(mergedBuffer, `${folder._id}.pdf`)
      await TollFolder.updateOne({ _id: folder._id }, { $set: { merged: true, mergedPdfFileId } })
    }

    if (cancelled) {
      await TollBatch.findOneAndUpdate(
        { _id: batchId, orgId },
        { $set: { currentStep: `Cancelled — ${folders.length} folder${folders.length !== 1 ? 's' : ''} sorted before stopping`, completedAt: new Date() } }
      )
    } else {
      await TollBatch.findOneAndUpdate(
        { _id: batchId, orgId },
        { $set: { status: 'done', currentStep: `Done — ${folders.length} folder${folders.length !== 1 ? 's' : ''}`, completedAt: new Date() } }
      )
    }
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

    const originalPdfFileId = await saveOriginalPdf(req.file.buffer, req.file.originalname)
    const batch = await TollBatch.create({
      orgId: req.orgId,
      originalFilename: req.file.originalname,
      status: 'processing',
      totalPages: 0,
      processedPages: 0,
      currentStep: 'Starting…',
      originalPdfFileId,
      lastProgressAt: new Date(),
    })

    // Fire and forget — the client polls GET /:batchId for progress instead of holding
    // this request open for the duration of the batch.
    void processBatch(batch._id.toString(), req.orgId!.toString(), req.file.buffer)

    res.status(202).json({ batchId: batch._id })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/toll-batch/:batchId/cancel — stop a batch that's still processing. Pages
// already sorted before this point are kept (their folders still get merged normally);
// this only stops the loop from reading further pages, so it doesn't burn Gemini calls
// on a batch the owner no longer wants.
router.post('/:batchId/cancel', async (req: Request, res: Response) => {
  try {
    const batch = await TollBatch.findOneAndUpdate(
      { _id: req.params.batchId, orgId: req.orgId, status: { $in: ['processing', 'failed'] } },
      { $set: { status: 'cancelled', currentStep: 'Cancelled' } },
      { new: true }
    )
    if (!batch) return res.status(400).json({ error: 'This batch cannot be cancelled' })
    res.json({ success: true })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/toll-batch/:batchId/retry — resume a failed or stuck batch. Re-reads the
// original PDF stored at upload time and re-runs processBatch, which skips pages already
// recorded so this never re-spends Gemini calls on finished work.
router.post('/:batchId/retry', async (req: Request, res: Response) => {
  try {
    const batch = await TollBatch.findOne({ _id: req.params.batchId, orgId: req.orgId })
    if (!batch) return res.status(404).json({ error: 'Batch not found' })
    if (batch.status === 'done') return res.status(409).json({ error: 'This batch already finished' })
    if (!batch.originalPdfFileId) {
      return res.status(410).json({ error: 'The original scan was not kept — please re-upload it as a new batch' })
    }

    await TollBatch.findOneAndUpdate(
      { _id: batch._id, orgId: req.orgId },
      { $set: { status: 'processing', currentStep: 'Resuming…', lastProgressAt: new Date() }, $unset: { error: '' } }
    )

    const pdfBuffer = await readOriginalPdf(batch.originalPdfFileId as any)
    void processBatch(batch._id.toString(), req.orgId!.toString(), pdfBuffer)

    res.status(202).json({ batchId: batch._id })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/toll-batch — list batches, newest first, with lifetime stats and date-grouped folders
router.get('/', async (req: Request, res: Response) => {
  try {
    const batches = await TollBatch.find({ orgId: req.orgId }).sort({ createdAt: -1 }).limit(50)

    // Lifetime totals for the stat row — cheap since image data is excluded.
    const allFolders = await TollFolder.find({ orgId: req.orgId }).select('-pages.imageBase64 -mergedPdfBase64')
    const plates = allFolders.map(f => f.plate).filter((p): p is string => !!p)
    const vehicles = await Vehicle.find({ orgId: req.orgId, plate: { $in: plates } }).select('plate regoStatus')
    const statusByPlate = new Map(vehicles.map(v => [v.plate, v.regoStatus || 'in_stock']))

    let sorted = 0, flagged = 0, unrecognized = 0
    for (const f of allFolders) {
      const count = (f.pages?.length ?? 0) + (f.pageCount ?? 0)
      if (!f.plate) { unrecognized += count; continue }
      const status = statusByPlate.get(f.plate)
      if (status && status !== 'stolen' && status !== 'sold') sorted += count
      else flagged += count // stolen, sold, or never registered
    }

    // Date-grouped view — one entry per upload day (Sydney local date), newest first.
    // Stolen/sold folders surface first within each group for quick action, then alphabetical.
    const PRIORITY: Record<MatchType, number> = { stolen: 0, sold: 1, unrecognized: 2, unregistered: 3, sorted: 4 }
    const DAY_NAMES  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const MON_NAMES  = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    type DateGroup = { batches: typeof batches; folders: any[] }
    const groupMap = new Map<string, DateGroup>()

    for (const f of allFolders) {
      const dateKey = new Date(f.createdAt).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
      if (!groupMap.has(dateKey)) groupMap.set(dateKey, { batches: [], folders: [] })
      const mt = matchTypeFor(f.plate, statusByPlate)
      groupMap.get(dateKey)!.folders.push({
        _id: f._id,
        batchId: f.batchId,
        plate: f.plate,
        matchType: mt,
        pageCount: (f.pages?.length ?? 0) + (f.pageCount ?? 0),
        sentStatus: f.sentStatus,
        hasMergedPdf: Boolean(f.mergedPdfFileId || f.merged),
        imagesDeleted: f.imagesDeleted ?? false,
      })
    }

    // Include processing/failed batches so the date row shows their status inline.
    for (const b of batches) {
      if (b.status === 'done') continue
      const dateKey = new Date(b.createdAt).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
      if (!groupMap.has(dateKey)) groupMap.set(dateKey, { batches: [], folders: [] })
      groupMap.get(dateKey)!.batches.push(b)
    }

    for (const group of groupMap.values()) {
      group.folders.sort((a: any, b: any) => {
        const pa = PRIORITY[a.matchType as MatchType] ?? 4
        const pb = PRIORITY[b.matchType as MatchType] ?? 4
        if (pa !== pb) return pa - pb
        return (a.plate || '').localeCompare(b.plate || '')
      })
    }

    const now = Date.now()
    const dateGroups = [...groupMap.entries()]
      .sort(([a], [b]) => b.localeCompare(a)) // YYYY-MM-DD sorts lexicographically → newest first
      .map(([dateKey, group]) => {
        const [y, m, d] = dateKey.split('-').map(Number)
        const dateObj = new Date(Date.UTC(y, m - 1, d))
        const dateLabel = `${d} ${MON_NAMES[m - 1]} ${y}, ${DAY_NAMES[dateObj.getUTCDay()]}`
        const daysRemaining = Math.max(0, 90 - Math.floor((now - dateObj.getTime()) / 86400000))
        return { date: dateKey, dateLabel, daysRemaining, batches: group.batches, folders: group.folders }
      })

    res.json({
      batches,
      stats: { totalScanned: sorted + flagged + unrecognized, sorted, flagged, unrecognized },
      dateGroups,
    })
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

    const folders = await TollFolder.find({ orgId: req.orgId, batchId: batch._id })
      .select('-pages.imageBase64 -mergedPdfBase64')
      .sort({ plate: 1 })

    // Cross-check every plated folder against this business's actual fleet, so the grid
    // shows WHY a plate isn't a clean match — stolen, sold, or never registered at all —
    // instead of lumping every non-match together. Computed live (not stored) so a status
    // change in Rego after the batch ran shows up immediately.
    const plates = folders.map(f => f.plate).filter((p): p is string => !!p)
    const vehicles = await Vehicle.find({ orgId: req.orgId, plate: { $in: plates } }).select('plate regoStatus')
    const statusByPlate = new Map(vehicles.map(v => [v.plate, v.regoStatus || 'in_stock']))

    // A process crash mid-batch leaves status stuck at 'processing' forever with no
    // error — lastProgressAt not moving for 10+ minutes (generous next to the ~5s/page
    // pace) is the only signal that this job actually died.
    const stale = batch.status === 'processing' && batch.lastProgressAt
      ? Date.now() - new Date(batch.lastProgressAt).getTime() > 10 * 60 * 1000
      : false

    res.json({
      batch,
      stale,
      folders: folders.map(f => ({
        _id: f._id,
        plate: f.plate,
        matchType: matchTypeFor(f.plate, statusByPlate),
        pageCount: (f.pages?.length ?? 0) + (f.pageCount ?? 0),
        hasMergedPdf: Boolean(f.mergedPdfFileId || f.merged),
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
    if (folder.imagesDeleted) return res.status(410).json({ error: 'Images for this toll were automatically removed after 90 days' })
    if (!folder.mergedPdfFileId && !folder.mergedPdfBase64) return res.status(409).json({ error: 'This folder is still processing' })

    const label = folder.plate || 'Unrecognized'
    const pdfBuffer = folder.mergedPdfFileId
      ? await readMergedPdf(folder.mergedPdfFileId as any)
      : Buffer.from(folder.mergedPdfBase64!, 'base64')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${label}.pdf"`)
    res.send(pdfBuffer)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/toll-batch/:batchId/folders/:folderId/pages — full images for one folder,
// fetched on demand when the owner opens it to review. Never part of the cheap poll.
router.get('/:batchId/folders/:folderId/pages', async (req: Request, res: Response) => {
  try {
    const folder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId })
    if (!folder) return res.status(404).json({ error: 'Folder not found' })
    if (folder.imagesDeleted) return res.status(410).json({ error: 'Images for this toll were automatically removed after 90 days' })

    const legacyPages = folder.pages ?? []
    const newPages = await TollPage.find({ folderId: folder._id }).sort({ pageNumber: 1 }).allowDiskUse(true).lean()
    const pages = [...legacyPages, ...newPages]
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map(p => ({ pageNumber: p.pageNumber, imageBase64: p.imageBase64 }))

    res.json({ pages })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/toll-batch/:batchId/folders/:folderId/pages/:pageNumber/reassign
// Moves one page into the folder for the given plate (creating it if new) and rebuilds
// both affected folders' merged PDFs immediately, so Download/Send are never stale.
router.post('/:batchId/folders/:folderId/pages/:pageNumber/reassign', async (req: Request, res: Response) => {
  try {
    const { plate } = req.body as { plate?: string }
    const cleanPlate = (plate || '').toUpperCase().trim()
    if (!cleanPlate) return res.status(400).json({ error: 'Plate is required' })

    const pageNumber = parseInt(req.params.pageNumber, 10)
    const sourceFolder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId })
    if (!sourceFolder) return res.status(404).json({ error: 'Folder not found' })

    if (sourceFolder.plate === cleanPlate) return res.status(400).json({ error: 'Already in that folder' })

    // Look for the page in TollPage first, then fall back to legacy embedded pages.
    const pageDoc = await TollPage.findOne({ folderId: sourceFolder._id, pageNumber })
    let pageImageBase64: string

    if (pageDoc) {
      pageImageBase64 = pageDoc.imageBase64
      await TollPage.deleteOne({ _id: pageDoc._id })
      await TollFolder.updateOne({ _id: sourceFolder._id }, { $inc: { pageCount: -1 } })
    } else {
      const legacyPage = sourceFolder.pages.find(p => p.pageNumber === pageNumber)
      if (!legacyPage) return res.status(404).json({ error: 'Page not found in this folder' })
      pageImageBase64 = legacyPage.imageBase64
      sourceFolder.pages = sourceFolder.pages.filter(p => p.pageNumber !== pageNumber)
      await sourceFolder.save()
    }

    const destFolder = await TollFolder.findOneAndUpdate(
      { orgId: req.orgId, batchId: req.params.batchId, plate: cleanPlate },
      { $setOnInsert: { orgId: req.orgId, batchId: req.params.batchId, plate: cleanPlate } },
      { upsert: true, new: true }
    )
    await TollPage.create({
      orgId: req.orgId, batchId: req.params.batchId, folderId: destFolder._id,
      pageNumber, imageBase64: pageImageBase64,
    })
    await TollFolder.updateOne({ _id: destFolder._id }, { $inc: { pageCount: 1 } })

    for (const folderId of [sourceFolder._id, destFolder._id]) {
      const f = await TollFolder.findById(folderId)
      if (!f) continue
      const legacyPgs = f.pages ?? []
      const newPgs = await TollPage.find({ folderId: f._id }).sort({ pageNumber: 1 }).allowDiskUse(true).lean()
      const totalCount = legacyPgs.length + newPgs.length
      if (totalCount === 0) {
        if (f.mergedPdfFileId) await deleteMergedPdf(f.mergedPdfFileId as any).catch(() => {})
        await TollFolder.deleteOne({ _id: f._id })
        continue
      }
      const allPgs = [...legacyPgs, ...newPgs].sort((a, b) => a.pageNumber - b.pageNumber)
      const mergedBuffer = await mergeImagesToPdf(allPgs.map(p => p.imageBase64))
      if (f.mergedPdfFileId) await deleteMergedPdf(f.mergedPdfFileId as any).catch(() => {})
      const newMergedFileId = await saveMergedPdf(mergedBuffer, `${f._id}.pdf`)
      await TollFolder.updateOne({ _id: f._id }, { $set: { merged: true, mergedPdfFileId: newMergedFileId } })
    }

    res.json({ success: true, movedTo: cleanPlate })
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
    if (folder.imagesDeleted) return res.status(410).json({ error: 'Images for this toll were automatically removed after 90 days' })
    if (!folder.mergedPdfFileId && !folder.mergedPdfBase64) return res.status(409).json({ error: 'This folder is still processing' })

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
    const pdfBuffer = folder.mergedPdfFileId
      ? await readMergedPdf(folder.mergedPdfFileId as any)
      : Buffer.from(folder.mergedPdfBase64!, 'base64')

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
