import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import TollBatch from '../models/TollBatch'
import TollFolder from '../models/TollFolder'
import Vehicle from '../models/Vehicle'
import Renter from '../models/Renter'
import Organization from '../models/Organization'
import { rasterizePdfBatch, getPdfPageCount, mergeImagesToPdf, extractPageTexts, extractPagesFromPdf } from '../services/tollPdf'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
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

/** Returns the merged PDF for a folder, computing and caching it in GridFS on first call. */
async function getMergedPdfBuffer(folder: any): Promise<Buffer> {
  if (folder.mergedPdfFileId) return readMergedPdf(folder.mergedPdfFileId)
  if (folder.mergedPdfBase64) return Buffer.from(folder.mergedPdfBase64, 'base64')

  // Preferred path: extract the relevant pages from the original uploaded PDF.
  // This is far more memory-efficient than loading hundreds of rasterized JPEG images
  // from MongoDB — the original PDF is one 35 MB read vs. potentially 150 MB of images.
  const batch = await TollBatch.findOne({ _id: folder.batchId, orgId: folder.orgId }).select('originalPdfFileId').lean()
  if (batch?.originalPdfFileId) {
    const legacyNums = (folder.pages ?? []).map((p: any) => p.pageNumber as number)
    const newNums = await TollPage.find({ folderId: folder._id, orgId: folder.orgId })
      .select('pageNumber').sort({ pageNumber: 1 }).lean()
      .then(docs => docs.map(d => d.pageNumber))
    const pageNums = [...new Set([...legacyNums, ...newNums])].sort((a, b) => a - b)
    if (pageNums.length > 0) {
      const origBuf = await readOriginalPdf(batch.originalPdfFileId)
      const buf = await extractPagesFromPdf(origBuf, pageNums)
      const mergedPdfFileId = await saveMergedPdf(buf, `${folder._id}.pdf`)
      await TollFolder.updateOne({ _id: folder._id, orgId: folder.orgId }, { $set: { merged: true, mergedPdfFileId } })
      return buf
    }
  }

  // Fallback for legacy batches that predate originalPdfFileId storage: re-merge the
  // rasterized JPEG images from MongoDB. Works fine for small folders; may be slow or
  // memory-intensive for very large ones if the original PDF was never saved.
  const legacyPages = folder.pages ?? []
  const newPages = await TollPage.find({ folderId: folder._id, orgId: folder.orgId }).sort({ pageNumber: 1 }).allowDiskUse(true).lean()
  const allPages = [...legacyPages, ...newPages].sort((a: any, b: any) => a.pageNumber - b.pageNumber)
  if (allPages.length === 0) throw new Error('No pages found for this folder')
  const buf = await mergeImagesToPdf(allPages.map((p: any) => p.imageBase64))
  if (folder.mergedPdfFileId) await deleteMergedPdf(folder.mergedPdfFileId).catch(() => {})
  const mergedPdfFileId = await saveMergedPdf(buf, `${folder._id}.pdf`)
  await TollFolder.updateOne({ _id: folder._id, orgId: folder.orgId }, { $set: { merged: true, mergedPdfFileId } })
  return buf
}

interface PlateReadResult {
  plates: string[]
}

/**
 * Regex-extracts plates from the text layer of a digital PDF page. Covers the
 * "Licence plate number: ABC123 (NSW)" pattern used by WestConnex, Linkt, and
 * Transport for NSW notices. Returns [] when the page has no matching text so the
 * caller can fall through to Gemini vision.
 */
function platesFromText(text: string): string[] {
  const upper = text.toUpperCase()
  const plates: string[] = []
  const re = /LICEN[SC]E\s+PLATE\s+NUMBER[:\s]+([A-Z0-9]{3,8})/g
  let match
  while ((match = re.exec(upper)) !== null) {
    const p = match[1].trim()
    if (!plates.includes(p)) plates.push(p)
  }
  return plates
}

/**
 * Reads ALL licence plates off one toll-notice page. Australian toll notice PDFs
 * (WestConnex, Linkt) commonly print two separate demands on a single page, each for
 * a different vehicle. Returns an empty array (never a guess) when Gemini is not
 * confident — those pages route to Unrecognized for manual review.
 */
async function readPlatesFromPage(imageBase64: string, mimeType: string, knownPlates: string[] = []): Promise<PlateReadResult> {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })

    const prompt = `You are reading a page from an Australian toll payment demand PDF (WestConnex, Linkt, Transport for NSW, etc.).
Each page may contain one or two separate toll demand notices.

For each toll demand visible on this page, find the vehicle licence plate. In Australian toll
notices it is typically labelled one of:
  • "Licence plate number: ABC123 (NSW)"
  • "Registration: ABC123"
  • Embedded in the body: "Your vehicle ABC123 was detected travelling on..."

Collect EVERY distinct plate you can read from this page.

Return ONLY a valid JSON object — no markdown, no explanation:
{ "plates": ["ABC123", "XYZ456"] }

If you cannot confidently read any plate, return: { "plates": [] }

This business's registered plates: ${knownPlates.length ? knownPlates.join(', ') : '(none on file)'}.
If a plate you read closely matches one of these (common misreads: O↔0, I↔1, B↔8, S↔5),
use the exact string from this list instead.

Only include plates you can actually read. Never guess or invent a plate.`

    const result = await generateWithRetry(model, [
      { inlineData: { data: imageBase64, mimeType } },
      prompt,
    ])

    const clean = result.response.text().trim().replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    const raw: unknown[] = Array.isArray(parsed.plates) ? parsed.plates : []
    const plates = raw
      .map((p: unknown) => {
        if (typeof p !== 'string') return ''
        return p.toUpperCase()
          .replace(/\s+/g, '')          // remove all whitespace
          .replace(/\([A-Z]{2,3}\).*$/, '') // strip state suffix: "(NSW)", "(VIC)", etc.
      })
      .filter((p): p is string => p.length >= 3 && p.length <= 10 && p !== 'NULL')
    return { plates }
  } catch (err: any) {
    console.error('TollBatch plate read error:', err.message)
    // Quota/rate errors mean "try again later" — re-throw so processBatch fails the batch
    // rather than silently routing this page to Unrecognized. isRetryableError is the same
    // predicate generateWithRetry uses, so the two layers can never disagree.
    if (isRetryableError(err)) throw err
    return { plates: [] }
  }
}

/**
 * The background job: rasterize every page, read its plate, upsert it into that batch's
 * per-plate folder (or the Unrecognized bucket), then merge each folder once all pages
 * are placed. Never awaited by the request handler — errors are captured onto the batch
 * document itself so polling clients see a real failure reason instead of hanging forever.
 */
async function processBatch(batchId: string, orgId: string, pdfBuffer: Buffer): Promise<void> {
  console.log('[processBatch] START batchId:', batchId, 'bufferSize:', pdfBuffer.length)
  try {
    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, { $set: { currentStep: 'Reading scanned pages' } })

    // Extract text layer first — fast even for very large PDFs, no rasterization.
    // Plates found here skip Gemini vision entirely, saving time and API cost.
    console.log('[processBatch] Extracting text layer…')
    const pageTexts = await extractPageTexts(pdfBuffer).catch(() => new Map<number, string>())
    console.log('[processBatch] Text layer done, pages with text:', pageTexts.size)

    console.log('[processBatch] Getting page count…')
    const totalPages = await getPdfPageCount(pdfBuffer)
    console.log('[processBatch] Total pages:', totalPages)
    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, { $set: { totalPages } })

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
    console.log('[processBatch] Already done pages:', alreadyDone.size)

    // Write PDF to a temp file once, then rasterize in batches of PAGE_BATCH pages.
    // A 400-page PDF at 200 DPI generates ~150 MB of JPEG data — enough to OOM a VPS
    // if loaded as one array. This keeps peak image memory to ~9 MB per batch.
    console.log('[processBatch] Writing PDF to temp file…')
    const tmpDir = await mkdtemp(join(tmpdir(), 'tollbatch-pdf-'))
    const tmpPdfPath = join(tmpDir, 'input.pdf')
    await writeFile(tmpPdfPath, pdfBuffer)
    console.log('[processBatch] Temp file written to', tmpPdfPath)

    let cancelled = false
    let gone = false
    try {
      const PAGE_BATCH = 30
      for (let batchFirst = 1; batchFirst <= totalPages; batchFirst += PAGE_BATCH) {
        const batchLast = Math.min(batchFirst + PAGE_BATCH - 1, totalPages)

        // Skip entire batch if all its pages were already processed in a prior run.
        const batchNums = Array.from({ length: batchLast - batchFirst + 1 }, (_, i) => batchFirst + i)
        if (batchNums.every(n => alreadyDone.has(n))) continue

        const current = await TollBatch.findOne({ _id: batchId, orgId }).select('status').lean()
        if (current?.status === 'cancelled') { cancelled = true; break }
        if (!current) {
          await new Promise(r => setTimeout(r, 1500))
          const recheck = await TollBatch.findOne({ _id: batchId, orgId }).select('status').lean()
          if (!recheck) {
            console.warn(`[processBatch] Batch ${batchId} no longer exists — stopping`)
            gone = true; break
          }
        }

        console.log(`[processBatch] Rasterizing pages ${batchFirst}-${batchLast}…`)
        const batchPages = await rasterizePdfBatch(tmpPdfPath, batchFirst, batchLast)
        console.log(`[processBatch] Rasterized ${batchPages.length} pages`)

        for (const page of batchPages) {
          if (alreadyDone.has(page.pageNumber)) continue

          console.log(`[processBatch] Page ${page.pageNumber}/${totalPages} — processing`)
          try {
            // Primary: text extraction — exact and instant for digital PDFs, no Gemini cost.
            // Fallback: Gemini vision for scanned/image-only pages where text layer is absent.
            let plates = platesFromText(pageTexts.get(page.pageNumber) ?? '')

            if (plates.length === 0) {
              // No text layer — use Gemini vision with one retry on empty result.
              plates = (await readPlatesFromPage(page.imageBase64, page.mimeType, knownPlates)).plates
              Organization.findByIdAndUpdate(orgId, { $inc: { geminiCalls: 1 } }).catch(() => {})

              if (plates.length === 0) {
                await geminiPacingDelay()
                const retry = await readPlatesFromPage(page.imageBase64, page.mimeType, knownPlates)
                Organization.findByIdAndUpdate(orgId, { $inc: { geminiCalls: 1 } }).catch(() => {})
                plates = retry.plates
              }
              // Pace before the next Gemini call (skipped entirely for text-extracted pages).
              await geminiPacingDelay()
            }

            // When a page has 2 toll notices for 2 different plates, the same image goes into
            // both plates' folders. When no plates were read, route the page to Unrecognized.
            const effectivePlates: (string | null)[] = plates.length > 0 ? plates : [null]
            const step = plates.length > 0
              ? `Page ${page.pageNumber} of ${totalPages} — sorted to ${plates.join(', ')}`
              : `Page ${page.pageNumber} of ${totalPages} — sent to Unrecognized`

            console.log(`[processBatch] Page ${page.pageNumber}/${totalPages} → ${plates.join(', ') || 'Unrecognized'}`)

            // One folder per plate per batch — never per plate alone, so a repeat plate next
            // week starts a fresh folder rather than appending to this one.
            for (const plate of effectivePlates) {
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
            }

            await TollBatch.findOneAndUpdate(
              { _id: batchId, orgId },
              { $inc: { processedPages: 1 }, $set: { currentStep: step, lastProgressAt: new Date() } }
            )
          } catch (pageErr: any) {
            // A single page failing (Gemini timeout, bad image, DB blip) must not stop the
            // whole batch. Route it to Unrecognized so the owner can review it manually.
            console.error(`[processBatch] Page ${page.pageNumber}/${totalPages} FAILED — ${pageErr.message} — routing to Unrecognized`)
            try {
              const unrecFolder = await TollFolder.findOneAndUpdate(
                { orgId, batchId, plate: null },
                { $setOnInsert: { orgId, batchId, plate: null } },
                { upsert: true, new: true }
              )
              await TollPage.create({ orgId, batchId, folderId: unrecFolder._id, pageNumber: page.pageNumber, imageBase64: page.imageBase64 })
              await TollFolder.updateOne({ _id: unrecFolder._id, orgId }, { $inc: { pageCount: 1 } })
            } catch (saveErr: any) {
              console.error(`[processBatch] Page ${page.pageNumber}/${totalPages} — fallback save also failed: ${saveErr.message}`)
            }
            await TollBatch.findOneAndUpdate(
              { _id: batchId, orgId },
              { $inc: { processedPages: 1 }, $set: { currentStep: `Page ${page.pageNumber} of ${totalPages} — error, sent to Unrecognized`, lastProgressAt: new Date() } }
            ).catch(() => {})
          }
        }
        // batchPages goes out of scope — GC can reclaim the ~9 MB before the next batch.
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }

    if (gone) return

    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, { $set: { currentStep: 'Merging folders into PDFs', lastProgressAt: new Date() } })

    // Merging all images into one PDF per folder is memory-intensive. Folders with many
    // pages (e.g. a large Unrecognized folder) can exhaust RAM on the VPS and block for
    // many minutes. Folders above this limit are skipped here and merged on-demand when
    // the user first clicks Download or Send — still cached in GridFS after that.
    const MERGE_UPFRONT_LIMIT = 20

    const folders = await TollFolder.find({ orgId, batchId })
    for (const folder of folders) {
      const legacyPages = folder.pages ?? []
      const estimatedTotal = legacyPages.length + (folder.pageCount ?? 0)
      if (estimatedTotal > MERGE_UPFRONT_LIMIT) continue  // merge on-demand at download time

      const newPages = await TollPage.find({ folderId: folder._id, orgId }).sort({ pageNumber: 1 }).allowDiskUse(true).lean()
      const allPages = [...legacyPages, ...newPages].sort((a, b) => a.pageNumber - b.pageNumber)
      if (allPages.length === 0) continue

      const mergedBuffer = await mergeImagesToPdf(allPages.map(p => p.imageBase64))
      if (folder.mergedPdfFileId) await deleteMergedPdf(folder.mergedPdfFileId as any).catch(() => {})
      const mergedPdfFileId = await saveMergedPdf(mergedBuffer, `${folder._id}.pdf`)
      await TollFolder.updateOne({ _id: folder._id, orgId }, { $set: { merged: true, mergedPdfFileId } })
      await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, { $set: { lastProgressAt: new Date() } })
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
    console.error('[processBatch] FAILED batchId:', batchId, '— error:', err.message, err.stack)
    await TollBatch.findOneAndUpdate(
      { _id: batchId, orgId },
      { $set: { status: 'failed', error: err.message || 'Processing failed' } }
    )
  }
}

// Wraps multer so any parse/size/filter error is logged and returns JSON (not a silent 500).
function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[TollBatch] Multer error:', err.message, (err as any).code ?? '')
      return res.status(400).json({ error: `Upload error: ${err.message}` })
    }
    console.log('[TollBatch] Multer OK — file:', req.file?.originalname, 'size:', req.file?.size ?? 'NO FILE')
    next()
  })
}

// POST /api/toll-batch — upload a scanned PDF and start processing in the background
router.post('/', handleUpload, async (req: Request, res: Response) => {
  console.log('[TollBatch] POST / received — file:', req.file?.originalname, 'size:', req.file?.size ?? 'NO FILE')
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' })

    console.log('[TollBatch] Saving original PDF to GridFS…')
    const originalPdfFileId = await saveOriginalPdf(req.file.buffer, req.file.originalname)
    console.log('[TollBatch] GridFS save OK, fileId:', originalPdfFileId)

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
    console.log('[TollBatch] Batch created, id:', batch._id, '— firing background job')

    // Fire and forget — the client polls GET /:batchId for progress instead of holding
    // this request open for the duration of the batch.
    void processBatch(batch._id.toString(), req.orgId!.toString(), req.file.buffer)

    res.status(202).json({ batchId: batch._id })
    console.log('[TollBatch] 202 sent to client')
  } catch (err: any) {
    console.error('[TollBatch] Upload handler error:', err.message, err.stack)
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

// DELETE /api/toll-batch/:batchId — hard-delete a batch and all its associated data.
// Allowed for any terminal status (done, failed, cancelled) — not for still-processing batches.
router.delete('/:batchId', async (req: Request, res: Response) => {
  try {
    const batch = await TollBatch.findOne({ _id: req.params.batchId, orgId: req.orgId })
    if (!batch) {
      // Ghost-folder recovery: the batch record was deleted (e.g. crash during a prior delete)
      // but TollFolder/TollPage records may still exist for this batchId.
      const ghostFolders = await TollFolder.find({ batchId: req.params.batchId, orgId: req.orgId }).select('_id mergedPdfFileId')
      if (!ghostFolders.length) return res.status(404).json({ error: 'Batch not found' })
      for (const f of ghostFolders) {
        if (f.mergedPdfFileId) await deleteMergedPdf(f.mergedPdfFileId as any).catch(() => {})
      }
      const ghostFolderIds = ghostFolders.map(f => f._id)
      await TollPage.deleteMany({ folderId: { $in: ghostFolderIds } })
      await TollFolder.deleteMany({ _id: { $in: ghostFolderIds } })
      return res.json({ success: true, ghostsCleaned: ghostFolders.length })
    }
    if (batch.status === 'processing') return res.status(409).json({ error: 'Cancel the batch before deleting it' })

    if (batch.originalPdfFileId) await deleteOriginalPdf(batch.originalPdfFileId as any).catch(() => {})
    const folders = await TollFolder.find({ batchId: batch._id }).select('_id mergedPdfFileId')
    for (const f of folders) {
      if (f.mergedPdfFileId) await deleteMergedPdf(f.mergedPdfFileId as any).catch(() => {})
    }
    const folderIds = folders.map(f => f._id)
    await TollPage.deleteMany({ folderId: { $in: folderIds } })
    await TollFolder.deleteMany({ batchId: batch._id })
    await TollBatch.deleteOne({ _id: batch._id })
    res.json({ success: true })
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
    // Within each date: newest batch on top. Within each batch: stolen/sold first, then alphabetical.
    const PRIORITY: Record<MatchType, number> = { stolen: 0, sold: 1, unrecognized: 2, unregistered: 3, sorted: 4 }
    const DAY_NAMES  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const MON_NAMES  = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    // Lookup: batchId → upload timestamp, used to sort batches newest-first within a date.
    const batchTimeMap = new Map<string, number>(
      batches.map(b => [b._id.toString(), new Date(b.createdAt as any).getTime()])
    )

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
        hasMergedPdf: Boolean(f.mergedPdfFileId || f.merged || (f.pages?.length ?? 0) + (f.pageCount ?? 0) > 0),
        imagesDeleted: f.imagesDeleted ?? false,
      })
    }

    // Include processing/failed batches so the date row shows their status inline.
    for (const b of batches) {
      if (b.status === 'done') continue
      const dateKey = new Date(b.createdAt as any).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
      if (!groupMap.has(dateKey)) groupMap.set(dateKey, { batches: [], folders: [] })
      groupMap.get(dateKey)!.batches.push(b)
    }

    for (const group of groupMap.values()) {
      group.folders.sort((a: any, b: any) => {
        // Primary: newest batch first within the same day
        const tA = batchTimeMap.get(a.batchId?.toString()) ?? 0
        const tB = batchTimeMap.get(b.batchId?.toString()) ?? 0
        if (tA !== tB) return tB - tA
        // Secondary: stolen/sold surface first within each batch, then alphabetical
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
        const daysRemaining = Math.max(0, 45 - Math.floor((now - dateObj.getTime()) / 86400000))
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
        hasMergedPdf: Boolean(f.mergedPdfFileId || f.merged || (f.pages?.length ?? 0) + (f.pageCount ?? 0) > 0),
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
    if (folder.imagesDeleted) return res.status(410).json({ error: 'Images for this toll were automatically removed after 45 days' })

    const label = folder.plate || 'Unrecognized'
    const pdfBuffer = await getMergedPdfBuffer(folder)
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
    if (folder.imagesDeleted) return res.status(410).json({ error: 'Images for this toll were automatically removed after 45 days' })

    const legacyPages = folder.pages ?? []
    const newPages = await TollPage.find({ folderId: folder._id, orgId: req.orgId }).sort({ pageNumber: 1 }).allowDiskUse(true).lean()
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
    const pageDoc = await TollPage.findOne({ folderId: sourceFolder._id, pageNumber, orgId: req.orgId })
    let pageImageBase64: string

    if (pageDoc) {
      pageImageBase64 = pageDoc.imageBase64
      await TollPage.deleteOne({ _id: pageDoc._id })
      await TollFolder.updateOne({ _id: sourceFolder._id, orgId: req.orgId }, { $inc: { pageCount: -1 } })
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
    await TollFolder.updateOne({ _id: destFolder._id, orgId: req.orgId }, { $inc: { pageCount: 1 } })

    for (const folderId of [sourceFolder._id, destFolder._id]) {
      const f = await TollFolder.findOne({ _id: folderId, orgId: req.orgId })
      if (!f) continue
      const legacyPgs = f.pages ?? []
      const newPgs = await TollPage.find({ folderId: f._id, orgId: req.orgId }).sort({ pageNumber: 1 }).allowDiskUse(true).lean()
      const totalCount = legacyPgs.length + newPgs.length
      if (totalCount === 0) {
        if (f.mergedPdfFileId) await deleteMergedPdf(f.mergedPdfFileId as any).catch(() => {})
        await TollFolder.deleteOne({ _id: f._id })
        continue
      }
      // Large folders: skip eager re-merge here — getMergedPdfBuffer uses extractPagesFromPdf
      // from the original scan PDF (fast, one small read) when the user next downloads/sends.
      // Merging 20+ JPEG images in-request can exceed 20s for a large plate folder.
      if (totalCount > 20) {
        if (f.mergedPdfFileId) await deleteMergedPdf(f.mergedPdfFileId as any).catch(() => {})
        await TollFolder.updateOne({ _id: f._id }, { $set: { merged: false, mergedPdfFileId: null } })
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
    if (folder.imagesDeleted) return res.status(410).json({ error: 'Images for this toll were automatically removed after 45 days' })
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
    const pdfBuffer = await getMergedPdfBuffer(folder)

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

/**
 * Background job: re-runs Gemini on every page still in the Unrecognized folder and
 * moves identified pages to their plate folders. Leaves genuinely unreadable pages
 * in Unrecognized for manual review. Progress is written to batch.rescan so the
 * frontend can poll it without changing the batch's main status field.
 */
async function rescanUnrecognizedJob(batchId: string, orgId: string): Promise<void> {
  try {
    const unrecFolder = await TollFolder.findOne({ orgId, batchId, plate: null })
    if (!unrecFolder) {
      await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, {
        $set: { 'rescan.status': 'done', 'rescan.completedAt': new Date() },
      })
      return
    }

    // Invalidate merged PDF upfront — pages are about to move out, so the existing
    // merged file is immediately stale. Download/Send regenerates on-demand.
    if (unrecFolder.mergedPdfFileId) {
      await deleteMergedPdf(unrecFolder.mergedPdfFileId as any).catch(() => {})
      await TollFolder.updateOne({ _id: unrecFolder._id, orgId }, { $set: { mergedPdfFileId: null, merged: false } })
    }

    const fleetVehicles = await Vehicle.find({ orgId }).select('plate')
    const knownPlates = fleetVehicles.map(v => v.plate).filter(Boolean)

    // Try to extract a text layer from the original PDF — zero cost for scanned PDFs
    // (returns empty map), but avoids Gemini calls for any digital pages in the batch.
    let pageTexts = new Map<number, string>()
    const batchDoc = await TollBatch.findOne({ _id: batchId, orgId }).select('originalPdfFileId').lean()
    if (batchDoc?.originalPdfFileId) {
      try {
        const origBuf = await readOriginalPdf(batchDoc.originalPdfFileId as any)
        pageTexts = await extractPageTexts(origBuf).catch(() => new Map<number, string>())
      } catch { /* no original stored — vision only */ }
    }

    const pages = await TollPage.find({ folderId: unrecFolder._id, orgId }).sort({ pageNumber: 1 }).lean()
    const invalidatedFolders = new Set<string>()
    let processed = 0
    let moved = 0

    for (const page of pages) {
      const batchStillExists = await TollBatch.exists({ _id: batchId, orgId })
      if (!batchStillExists) {
        await new Promise(r => setTimeout(r, 1500))
        const recheckExists = await TollBatch.exists({ _id: batchId, orgId })
        if (!recheckExists) {
          console.warn(`[rescanUnrecognized] Batch ${batchId} no longer exists — stopping`)
          return
        }
      }

      try {
        let plates = platesFromText(pageTexts.get(page.pageNumber) ?? '')

        if (plates.length === 0) {
          plates = (await readPlatesFromPage(page.imageBase64, 'image/jpeg', knownPlates)).plates
          Organization.findByIdAndUpdate(orgId, { $inc: { geminiCalls: 1 } }).catch(() => {})

          if (plates.length === 0) {
            await geminiPacingDelay()
            const retry = await readPlatesFromPage(page.imageBase64, 'image/jpeg', knownPlates)
            Organization.findByIdAndUpdate(orgId, { $inc: { geminiCalls: 1 } }).catch(() => {})
            plates = retry.plates
          }
          await geminiPacingDelay()
        }

        if (plates.length > 0) {
          // Remove from Unrecognized
          await TollPage.deleteOne({ _id: page._id })
          await TollFolder.updateOne({ _id: unrecFolder._id, orgId }, { $inc: { pageCount: -1 } })

          for (const plate of plates) {
            const destFolder = await TollFolder.findOneAndUpdate(
              { orgId, batchId, plate },
              { $setOnInsert: { orgId, batchId, plate } },
              { upsert: true, new: true }
            )
            await TollPage.create({ orgId, batchId, folderId: destFolder._id, pageNumber: page.pageNumber, imageBase64: page.imageBase64 })
            await TollFolder.updateOne({ _id: destFolder._id, orgId }, { $inc: { pageCount: 1 } })

            // Invalidate destination's merged PDF once per folder touched this run.
            if (!invalidatedFolders.has(destFolder._id.toString()) && destFolder.mergedPdfFileId) {
              await deleteMergedPdf(destFolder.mergedPdfFileId as any).catch(() => {})
              await TollFolder.updateOne({ _id: destFolder._id, orgId }, { $set: { mergedPdfFileId: null, merged: false } })
              invalidatedFolders.add(destFolder._id.toString())
            }
          }
          moved++
        }
      } catch (pageErr: any) {
        console.error(`[rescanUnrecognized] Page ${page.pageNumber} failed: ${pageErr.message}`)
      }

      processed++
      await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, {
        $set: { 'rescan.processed': processed, 'rescan.moved': moved },
      })
    }

    // Delete the Unrecognized folder if all pages were identified.
    const remaining = await TollPage.countDocuments({ folderId: unrecFolder._id, orgId })
    const legacyRemaining = (unrecFolder.pages ?? []).length
    if (remaining === 0 && legacyRemaining === 0) {
      await TollFolder.deleteOne({ _id: unrecFolder._id })
    }

    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, {
      $set: { 'rescan.status': 'done', 'rescan.completedAt': new Date() },
    })
    console.log(`[rescanUnrecognized] Done — ${moved}/${processed} pages identified`)
  } catch (err: any) {
    console.error('[rescanUnrecognized] FAILED:', err.message)
    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, {
      $set: { 'rescan.status': 'failed' },
    }).catch(() => {})
  }
}

// POST /api/toll-batch/:batchId/rescan-unrecognized — re-run Gemini on every page
// currently in the Unrecognized folder and auto-move identified pages to their plate
// folders. Only available on completed batches; runs as a background job.
router.post('/:batchId/rescan-unrecognized', async (req: Request, res: Response) => {
  try {
    const batch = await TollBatch.findOne({ _id: req.params.batchId, orgId: req.orgId })
    if (!batch) return res.status(404).json({ error: 'Batch not found' })
    if (batch.status !== 'done') return res.status(409).json({ error: 'Batch is not yet complete' })
    if ((batch as any).rescan?.status === 'running') return res.status(409).json({ error: 'A rescan is already running' })

    const unrecFolder = await TollFolder.findOne({ orgId: req.orgId, batchId: batch._id, plate: null })
    const total = (unrecFolder?.pages?.length ?? 0) + (unrecFolder?.pageCount ?? 0)
    if (!unrecFolder || total === 0) return res.status(404).json({ error: 'No unrecognized pages to rescan' })

    await TollBatch.findOneAndUpdate({ _id: batch._id, orgId: req.orgId }, {
      $set: { rescan: { status: 'running', total, processed: 0, moved: 0, startedAt: new Date() } },
    })

    void rescanUnrecognizedJob(batch._id.toString(), req.orgId!.toString())
    res.status(202).json({ total })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/toll-batch/:batchId/folders/:folderId/pages/:pageNumber/rescan
// Re-runs Gemini on an existing stored page image — used by the Review modal's
// "Auto-detect" button to fix unrecognized pages without manual typing.
router.post('/:batchId/folders/:folderId/pages/:pageNumber/rescan', async (req: Request, res: Response) => {
  try {
    const pageNumber = parseInt(req.params.pageNumber, 10)
    const folder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId })
    if (!folder) return res.status(404).json({ error: 'Folder not found' })

    const pageDoc = await TollPage.findOne({ folderId: folder._id, pageNumber, orgId: req.orgId })
    const imageBase64 = pageDoc?.imageBase64 ?? folder.pages?.find(p => p.pageNumber === pageNumber)?.imageBase64
    if (!imageBase64) return res.status(404).json({ error: 'Page not found' })

    const fleetVehicles = await Vehicle.find({ orgId: req.orgId }).select('plate')
    const knownPlates = fleetVehicles.map(v => v.plate).filter(Boolean)

    const { plates } = await readPlatesFromPage(imageBase64, 'image/jpeg', knownPlates)
    res.json({ plates })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
