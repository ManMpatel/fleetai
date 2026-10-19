import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import mongoose from 'mongoose'
import TollBatch from '../models/TollBatch'
import TollFolder from '../models/TollFolder'
import Vehicle from '../models/Vehicle'
import Renter from '../models/Renter'
import Organization from '../models/Organization'
import { rasterizePdfBatch, getPdfPageCount, extractPageTexts } from '../services/tollPdf'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { sendTollEmail } from '../services/tollEmail'
import { GEMINI_MODEL, generateWithRetry, geminiPacingDelay, isRetryableError } from '../config/gemini'
import TollPage from '../models/TollPage'
import {
  storeOriginal, loadOriginal, hasOriginal, deleteOriginal, getFolderPdfBuffer, getFolderPdfLink, invalidateFolderPdf,
  buildBatchFolderPdfs, storePageImage, loadPageImageBase64, pageImageLink, deleteBatchFiles,
} from '../services/tollFiles'
import { tollKeys, tollS3Configured, tollS3DeletePrefix } from '../services/tollS3'
import { tollExpiryFrom, tollExpiryOf, daysUntil, TOLL_LEGACY_RETENTION_DAYS, DAY_MS } from '../config/toll'
import { parsePlateRead, decidePlates, fitToFleet, samePlate, nearFleetPlates, PlateDecision } from '../services/tollPlates'

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

// Where the files of a batch are kept (S3 or MongoDB), how a plate's PDF is cut from the original
// scan, and how long files live: all in services/tollFiles.ts and config/toll.ts.

const GONE_MESSAGE = 'These toll notices were automatically deleted when their storage time ended'

interface PlateReadResult {
  /** Every plate printed on the page, in reading order, duplicates kept. */
  copies: string[]
  /** How many separate toll demands Gemini says are on the page (1 or 2). */
  notices: number
}

/**
 * Regex-extracts plates from the text layer of a digital PDF page. Covers the
 * "Licence plate number: ABC123 (NSW)" pattern used by WestConnex, Linkt, and
 * Transport for NSW notices. Duplicates are kept on purpose — how many copies agree is
 * the evidence decidePlates works from. Returns [] when the page has no matching text
 * so the caller can fall through to Gemini vision.
 */
function platesFromText(text: string): string[] {
  const upper = text.toUpperCase()
  const plates: string[] = []
  const re = /LICEN[SC]E\s+PLATE\s+NUMBER[:\s]+([A-Z0-9]{3,8})/g
  let match
  while ((match = re.exec(upper)) !== null) {
    plates.push(match[1].trim())
  }
  return plates
}

/**
 * Asks Gemini to copy the licence plate EXACTLY as printed, in every place it appears on
 * one toll-notice page (these notices print it several times), plus how many separate
 * demands are on the page. It decides nothing: decidePlates compares the copies.
 * The fleet list is deliberately NOT sent — shown a list of "known" plates, a model will
 * quietly swap a near-miss for one of them (EHF76K → EHF76J). Returns no copies (never a
 * guess) when Gemini is not confident.
 */
async function readPlatesFromPage(imageBase64: string, mimeType: string): Promise<PlateReadResult> {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })

    const prompt = `You are reading one page from an Australian toll payment demand PDF (WestConnex, Linkt, Transport for NSW, etc.).
A page usually holds one toll demand notice, and sometimes two.

Your job is to copy the vehicle licence plate EXACTLY as it is printed, in EVERY place it
appears on this page. These notices usually print the same plate several times, for example:
  • "Licence plate number: ABC123 (NSW)" in the box at the top
  • "Registration: ABC123"
  • in a sentence: "Your vehicle ABC123 was detected travelling on..."
  • again in the payment slip at the bottom of the page
List each place separately, even when the copies are identical. Do NOT merge or remove duplicates.

Rules:
- Copy each plate character by character, exactly as printed. Never correct it, guess it, or change it to look like another plate.
- Leave out any state suffix such as "(NSW)".
- Look closely at look-alike characters (J/K, 0/O, 1/I, 5/S, 8/B, M/N) and copy the one that is actually printed.
- If you cannot read a particular copy with confidence, leave that copy out.
- Also say how many separate toll demand notices are on this page (usually 1, sometimes 2).

Return ONLY a valid JSON object — no markdown, no explanation:
{ "notices": 1, "plates": ["ABC123", "ABC123", "ABC123"] }

If you cannot confidently read any plate, return: { "notices": 1, "plates": [] }`

    const result = await generateWithRetry(model, [
      { inlineData: { data: imageBase64, mimeType } },
      prompt,
    ])

    return parsePlateRead(result.response.text())
  } catch (err: any) {
    console.error('TollBatch plate read error:', err.message)
    // Quota/rate errors mean "try again later" — re-throw so processBatch fails the batch
    // rather than silently routing this page to Unrecognized. isRetryableError is the same
    // predicate generateWithRetry uses, so the two layers can never disagree.
    if (isRetryableError(err)) throw err
    return { copies: [], notices: 1 }
  }
}

interface PageDecision extends PlateDecision {
  source: 'text' | 'vision'
}

/**
 * The one place that works out which plate folder(s) a page belongs in — the main batch
 * run and the Re-scan Unrecognized job both go through it, so they can never disagree.
 *
 *  1. Text layer first (free). Trusted unless its own copies disagree.
 *  2. Otherwise Gemini vision, copying every printed plate exactly; one retry if it
 *     returns nothing. Pacing between Gemini calls is unchanged.
 *
 * Rate/quota errors still throw (processBatch fails the batch and Resume picks it up).
 */
async function decidePage(args: { imageBase64: string; mimeType: string; text: string; orgId: string }): Promise<PageDecision> {
  const fromText = platesFromText(args.text)
  if (fromText.length > 0) {
    // A digital page may genuinely hold two notices, so two plates are allowed here.
    const d = decidePlates(fromText, 2)
    if (d.status !== 'conflict') return { ...d, source: 'text' }
    // The text copies disagree — let vision look at the real page instead of trusting either.
  }

  let read = await readPlatesFromPage(args.imageBase64, args.mimeType)
  Organization.findByIdAndUpdate(args.orgId, { $inc: { geminiCalls: 1 } }).catch(() => {})

  if (read.copies.length === 0) {
    await geminiPacingDelay()
    read = await readPlatesFromPage(args.imageBase64, args.mimeType)
    Organization.findByIdAndUpdate(args.orgId, { $inc: { geminiCalls: 1 } }).catch(() => {})
  }
  // Pace before the next Gemini call (skipped entirely for text-extracted pages).
  await geminiPacingDelay()

  return { ...decidePlates(read.copies, read.notices), source: 'vision' }
}

/**
 * Strict fleet rule applied to each plate a page was read as: an exact fleet plate, or a
 * single unambiguous O/0-type slip, is fitted to the fleet plate. Everything else keeps the
 * plate as printed — a plate that is merely close is never swapped for another vehicle.
 */
function fitPlatesToFleet(plates: string[], knownPlates: string[]): { plates: string[]; correctedFrom?: string } {
  const out: string[] = []
  const printedAs: string[] = []
  for (const printed of plates) {
    const fit = fitToFleet(printed, knownPlates)
    if (fit.correctedFrom) printedAs.push(fit.correctedFrom)
    if (!out.includes(fit.plate)) out.push(fit.plate)
  }
  return { plates: out, correctedFrom: printedAs.length ? printedAs.join(', ') : undefined }
}

/** The fields stored on each TollPage so the plate read can be audited later. */
function pageReadFields(d: PageDecision, correctedFrom?: string) {
  return {
    readSource: d.source,
    readStatus: d.status === 'none' ? undefined : d.status,
    plateCopies: d.copies,
    correctedFrom,
  }
}

/**
 * Folders that hold at least one page whose printed plate copies disagreed (status
 * 'conflict'), mapped to the OTHER plates seen on those pages — shown as "Check plate".
 * One small query: matching pages are rare and their images are never loaded.
 * If it fails the lists still load — just without the flag — so this extra can never take
 * the Toll Batch page down.
 */
async function loadCheckFlags(orgId: unknown, plateByFolder: Map<string, string | null>, batchId?: unknown): Promise<Map<string, string[]>> {
  const flags = new Map<string, string[]>()
  try {
    const filter: Record<string, unknown> = { orgId, readStatus: 'conflict' }
    if (batchId) filter.batchId = batchId
    const pages = await TollPage.find(filter).select('folderId plateCopies').lean()
    for (const p of pages) {
      const key = String(p.folderId)
      const own = plateByFolder.get(key)
      const seen = flags.get(key) ?? []
      for (const c of p.plateCopies ?? []) {
        if (own && samePlate(c, own)) continue
        if (!seen.includes(c)) seen.push(c)
      }
      flags.set(key, seen)
    }
  } catch (err: any) {
    console.error('[tollBatch] could not load Check plate flags:', err.message)
  }
  return flags
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

    // Every plate this business has ever had on file (active, sold or stolen) — used AFTER
    // reading, under a strict rule, to fit a printed plate to the fleet. Never shown to Gemini.
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
            // Text layer first (exact, free), Gemini vision otherwise. Gemini copies every
            // printed plate exactly as it appears; decidePage compares the copies and decides
            // which folder the page goes in — see services/tollPlates.ts.
            const decision = await decidePage({
              imageBase64: page.imageBase64,
              mimeType: page.mimeType,
              text: pageTexts.get(page.pageNumber) ?? '',
              orgId,
            })

            // Strict fleet rule: an exact fleet plate, or one unambiguous O/0-type slip. A plate
            // that is merely close to a fleet plate (EHF76K vs EHF76J) keeps the plate as printed.
            const fitted = fitPlatesToFleet(decision.plates, knownPlates)
            const plates = fitted.plates
            const needsCheck = decision.status === 'conflict'

            // When a page has 2 toll notices for 2 different plates, the same page goes into
            // both plates' folders. When no plates were read, route the page to Unrecognized.
            const effectivePlates: (string | null)[] = plates.length > 0 ? plates : [null]

            // Only a page somebody has to look at keeps a picture (Unrecognized, or "Check plate").
            // The PDF of every other page is cut from the original scan, which is kept anyway.
            const picture = plates.length === 0 || needsCheck
              ? await storePageImage(orgId, batchId, page.pageNumber, page.imageBase64)
              : {}
            const step = plates.length > 0
              ? `Page ${page.pageNumber} of ${totalPages} — sorted to ${plates.join(', ')}${needsCheck ? ' (please check)' : ''}`
              : `Page ${page.pageNumber} of ${totalPages} — sent to Unrecognized`

            // The copies are logged so a wrong folder can be traced to exactly what was read.
            const readNote = `${decision.status}, ${decision.source}, copies: ${decision.copies.join(' ') || 'none'}${fitted.correctedFrom ? `, corrected from ${fitted.correctedFrom}` : ''}`
            console.log(`[processBatch] Page ${page.pageNumber}/${totalPages} → ${plates.join(', ') || 'Unrecognized'} (${readNote})`)
            if (needsCheck) console.warn(`[processBatch] Page ${page.pageNumber}/${totalPages} — plate copies disagree, flagged for a check`)

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
                pageNumber: page.pageNumber, ...picture,
                ...pageReadFields(decision, fitted.correctedFrom),
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
              const picture = await storePageImage(orgId, batchId, page.pageNumber, page.imageBase64)
              await TollPage.create({ orgId, batchId, folderId: unrecFolder._id, pageNumber: page.pageNumber, ...picture })
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

    if (gone) {
      // The batch was deleted while this job was running: clear anything it saved after that.
      if (tollS3Configured()) await tollS3DeletePrefix(tollKeys.batchPrefix(orgId, batchId)).catch(() => {})
      return
    }

    await TollBatch.findOneAndUpdate({ _id: batchId, orgId }, { $set: { currentStep: 'Making a PDF for each plate', lastProgressAt: new Date() } })

    // One small PDF per folder, cut out of the original scan in a single pass (the scan is read
    // once, the pages are copied as they are). This is quick, so folders of any size are done here
    // and Download / Send are instant. A folder that fails is only logged: it is cut when somebody
    // asks for it, so one bad folder can never fail the whole batch.
    try {
      const cut = await buildBatchFolderPdfs(batchId, orgId, pdfBuffer, async () => {
        await TollBatch.updateOne({ _id: batchId, orgId }, { $set: { lastProgressAt: new Date() } })
      })
      console.log(`[processBatch] PDFs cut: ${cut.built} ok, ${cut.failed} left for later`)
    } catch (cutErr: any) {
      console.error(`[processBatch] Could not cut the folder PDFs now (${cutErr.message}) - they are cut when asked for`)
    }

    const folderCount = await TollFolder.countDocuments({ orgId, batchId })

    if (cancelled) {
      await TollBatch.findOneAndUpdate(
        { _id: batchId, orgId },
        { $set: { currentStep: `Cancelled \u2014 ${folderCount} folder${folderCount !== 1 ? 's' : ''} sorted before stopping`, completedAt: new Date() } }
      )
    } else {
      await TollBatch.findOneAndUpdate(
        { _id: batchId, orgId },
        { $set: { status: 'done', currentStep: `Done \u2014 ${folderCount} folder${folderCount !== 1 ? 's' : ''}`, completedAt: new Date() } }
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
  let savedOriginal: Awaited<ReturnType<typeof storeOriginal>> | null = null
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' })

    const orgId = req.orgId!.toString()
    // The id is made first so the scan can be filed under the batch's own folder in S3.
    const batchId = new mongoose.Types.ObjectId()

    console.log('[TollBatch] Saving the original PDF...')
    savedOriginal = await storeOriginal(orgId, batchId.toString(), req.file.buffer, req.file.originalname)
    console.log('[TollBatch] Original saved:', savedOriginal.originalKey ? 'S3' : 'MongoDB')

    const batch = await TollBatch.create({
      _id: batchId,
      orgId: req.orgId,
      originalFilename: req.file.originalname,
      status: 'processing',
      totalPages: 0,
      processedPages: 0,
      currentStep: 'Starting…',
      ...savedOriginal,
      expiresAt: tollExpiryFrom(),
      lastProgressAt: new Date(),
    })
    console.log('[TollBatch] Batch created, id:', batch._id, '— firing background job')

    // Fire and forget — the client polls GET /:batchId for progress instead of holding
    // this request open for the duration of the batch.
    void processBatch(batch._id.toString(), orgId, req.file.buffer)

    res.status(202).json({ batchId: batch._id })
    console.log('[TollBatch] 202 sent to client')
  } catch (err: any) {
    console.error('[TollBatch] Upload handler error:', err.message, err.stack)
    // The scan was saved but the batch was not created: do not leave it behind with nothing pointing at it.
    if (savedOriginal) await deleteOriginal(savedOriginal).catch(() => {})
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
    if (!hasOriginal(batch)) {
      return res.status(410).json({ error: 'The original scan was not kept - please re-upload it as a new batch' })
    }

    // Read the scan first: if it cannot be read the batch stays as it was instead of saying "Resuming..." forever.
    const pdfBuffer = await loadOriginal(batch)
    if (!pdfBuffer) {
      return res.status(410).json({ error: 'The original scan was not kept - please re-upload it as a new batch' })
    }

    await TollBatch.findOneAndUpdate(
      { _id: batch._id, orgId: req.orgId },
      { $set: { status: 'processing', currentStep: 'Resuming…', lastProgressAt: new Date() }, $unset: { error: '' } }
    )

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
      const ghostFolders = await TollFolder.find({ batchId: req.params.batchId, orgId: req.orgId }).select('_id mergedPdfFileId pdfKey')
      if (!ghostFolders.length) return res.status(404).json({ error: 'Batch not found' })
      await deleteBatchFiles(String(req.orgId), { _id: req.params.batchId }, ghostFolders)
      const ghostFolderIds = ghostFolders.map(f => f._id)
      await TollPage.deleteMany({ folderId: { $in: ghostFolderIds }, orgId: req.orgId })
      await TollFolder.deleteMany({ _id: { $in: ghostFolderIds }, orgId: req.orgId })
      return res.json({ success: true, ghostsCleaned: ghostFolders.length })
    }
    if (batch.status === 'processing') return res.status(409).json({ error: 'Cancel the batch before deleting it' })

    const folders = await TollFolder.find({ batchId: batch._id, orgId: req.orgId }).select('_id mergedPdfFileId pdfKey')
    await deleteBatchFiles(String(req.orgId), batch, folders)
    await TollPage.deleteMany({ batchId: batch._id, orgId: req.orgId })
    await TollFolder.deleteMany({ batchId: batch._id, orgId: req.orgId })
    await TollBatch.deleteOne({ _id: batch._id, orgId: req.orgId })
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
    const batchById = new Map(batches.map(b => [b._id.toString(), b]))
    const plates = allFolders.map(f => f.plate).filter((p): p is string => !!p)
    const vehicles = await Vehicle.find({ orgId: req.orgId, plate: { $in: plates } }).select('plate regoStatus')
    const statusByPlate = new Map(vehicles.map(v => [v.plate, v.regoStatus || 'in_stock']))

    // Fleet plates (for the "close to …" hint) and the folders holding a page whose plate
    // copies disagreed (for the "Check plate" flag).
    const fleetPlates = (await Vehicle.find({ orgId: req.orgId }).select('plate').lean()).map(v => v.plate)
    const checkFlags = await loadCheckFlags(
      req.orgId,
      new Map<string, string | null>(allFolders.map(f => [String(f._id), f.plate] as [string, string | null]))
    )

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
        hasMergedPdf: Boolean(f.pdfKey || f.mergedPdfFileId || f.merged || (f.pages?.length ?? 0) + (f.pageCount ?? 0) > 0),
        imagesDeleted: f.imagesDeleted ?? false,
        needsCheck: checkFlags.has(String(f._id)),
        checkAlternatives: checkFlags.get(String(f._id)) ?? [],
        closeTo: mt === 'unregistered' && f.plate ? nearFleetPlates(f.plate, fleetPlates) : [],
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
        // Folders needing a plate check come before everything else in their batch.
        if (a.needsCheck !== b.needsCheck) return a.needsCheck ? -1 : 1
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

        // Days left = days until the soonest-expiring batch of that date is cleaned out. A batch
        // has its own date (upload + 21 days); an older one has none and keeps upload + 45 days.
        // When a batch is not among the 50 loaded, the upload date stands in for it, as before.
        const dayStartLegacyExpiry = new Date(dateObj.getTime() + TOLL_LEGACY_RETENTION_DAYS * DAY_MS)
        const expiries: Date[] = []
        const seen = new Set<string>()
        for (const f of group.folders) {
          const id = String(f.batchId)
          if (seen.has(id)) continue
          seen.add(id)
          const b = batchById.get(id)
          expiries.push(b ? tollExpiryOf(b) : dayStartLegacyExpiry)
        }
        for (const b of group.batches) {
          if (seen.has(b._id.toString())) continue
          seen.add(b._id.toString())
          expiries.push(tollExpiryOf(b))
        }
        const soonest = expiries.length > 0 ? new Date(Math.min(...expiries.map(e => e.getTime()))) : dayStartLegacyExpiry
        const daysRemaining = daysUntil(soonest, now)

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

    // Same plate-check extras as the list route, scoped to this batch.
    const fleetPlates = (await Vehicle.find({ orgId: req.orgId }).select('plate').lean()).map(v => v.plate)
    const checkFlags = await loadCheckFlags(
      req.orgId,
      new Map<string, string | null>(folders.map(f => [String(f._id), f.plate] as [string, string | null])),
      batch._id
    )

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
        hasMergedPdf: Boolean(f.pdfKey || f.mergedPdfFileId || f.merged || (f.pages?.length ?? 0) + (f.pageCount ?? 0) > 0),
        sentStatus: f.sentStatus,
        sentTo: f.sentTo,
        sentAt: f.sentAt,
        needsCheck: checkFlags.has(String(f._id)),
        checkAlternatives: checkFlags.get(String(f._id)) ?? [],
        closeTo: f.plate && matchTypeFor(f.plate, statusByPlate) === 'unregistered' ? nearFleetPlates(f.plate, fleetPlates) : [],
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
// guaranteed Download button and for the best-effort WhatsApp drag target. The file is sent
// through the server: this is the path that always works, and the fallback when a direct
// link (below) cannot be used.
router.get('/:batchId/folders/:folderId/download', async (req: Request, res: Response) => {
  try {
    const folder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId }).select('plate imagesDeleted')
    if (!folder) return res.status(404).json({ error: 'Folder not found' })
    if (folder.imagesDeleted) return res.status(410).json({ error: GONE_MESSAGE })

    const label = folder.plate || 'Unrecognized'
    const pdfBuffer = await getFolderPdfBuffer(String(folder._id), String(req.orgId))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${label}.pdf"`)
    res.send(pdfBuffer)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/toll-batch/:batchId/folders/:folderId/download-link - { url, filename }. When the
// files are in S3, url is a short-lived address (5 minutes, this one file, read only) the browser
// downloads straight from S3, so the PDF never passes through this server. The PDF is cut first
// if it is not ready yet. url is null when the file has to come through the server instead
// (S3 not in use, links switched off, or anything went wrong) - the page then uses /download.
router.get('/:batchId/folders/:folderId/download-link', async (req: Request, res: Response) => {
  try {
    const folder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId }).select('plate imagesDeleted')
    if (!folder) return res.status(404).json({ error: 'Folder not found' })
    if (folder.imagesDeleted) return res.status(410).json({ error: GONE_MESSAGE })

    const filename = `${folder.plate || 'Unrecognized'}.pdf`
    let url: string | null = null
    try {
      url = await getFolderPdfLink(String(folder._id), String(req.orgId), filename)
    } catch (linkErr: any) {
      console.error(`[tollBatch] download link for folder ${folder._id} not made (${linkErr.message}) - the page will download through the server`)
    }
    res.json({ url, filename })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/toll-batch/:batchId/folders/:folderId/pages - the page pictures of one folder, fetched
// on demand when the owner opens it to review. Never part of the cheap poll.
//   ?links=1       a picture kept in S3 comes back as imageUrl (a link valid for an hour) that the
//                  browser loads itself; other pictures come back as imageBase64. Without it every
//                  picture comes back as imageBase64, which is what older pages of the app expect.
//   ?only=conflict only the pages whose plate copies disagreed (the "Check plate" review).
// Only pages that needed a look have a stored picture; if one is missing it is drawn again from
// the original scan.
router.get('/:batchId/folders/:folderId/pages', async (req: Request, res: Response) => {
  try {
    const folder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId }).select('-mergedPdfBase64')
    if (!folder) return res.status(404).json({ error: 'Folder not found' })
    if (folder.imagesDeleted) return res.status(410).json({ error: GONE_MESSAGE })

    const wantLinks = req.query.links === '1'
    const onlyConflict = req.query.only === 'conflict'

    // Legacy embedded pages carry no plate-read info, so they can never be a conflict. They are copied
    // into plain objects: the folder came from Mongoose, and spreading one of its sub-documents loses the fields.
    const legacyPages = onlyConflict ? [] : (folder.pages ?? []).map(p => ({ pageNumber: p.pageNumber, imageBase64: p.imageBase64 }))
    const newPages = await TollPage.find({
      folderId: folder._id, orgId: req.orgId, ...(onlyConflict ? { readStatus: 'conflict' } : {}),
    }).sort({ pageNumber: 1 }).allowDiskUse(true).lean()

    type PageLike = { pageNumber: number; imageBase64?: string | null; imageKey?: string | null; readStatus?: string; plateCopies?: string[] }
    const all = ([...legacyPages, ...newPages] as PageLike[]).sort((a, b) => a.pageNumber - b.pageNumber)

    const pages: { pageNumber: number; imageBase64?: string; imageUrl?: string; readStatus?: string; plateCopies: string[] }[] = []
    for (const p of all) {
      const info = { pageNumber: p.pageNumber, readStatus: p.readStatus, plateCopies: p.plateCopies ?? [] }
      const link = wantLinks ? pageImageLink(p) : null
      if (link) { pages.push({ ...info, imageUrl: link }); continue }
      const imageBase64 = await loadPageImageBase64({ ...p, orgId: folder.orgId, batchId: folder.batchId })
      pages.push(imageBase64 ? { ...info, imageBase64 } : info)
    }

    res.json({ pages })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/toll-batch/:batchId/folders/:folderId/confirm — the owner looked at the flagged
// page(s) and the plate is right. Clears the "Check plate" flag; nothing is moved or re-read.
// Stored as 'confirmed' (not 'verified') so false alarms can be counted later.
router.post('/:batchId/folders/:folderId/confirm', async (req: Request, res: Response) => {
  try {
    const folder = await TollFolder.findOne({ _id: req.params.folderId, orgId: req.orgId, batchId: req.params.batchId }).select('_id')
    if (!folder) return res.status(404).json({ error: 'Folder not found' })

    const result = await TollPage.updateMany(
      { folderId: folder._id, orgId: req.orgId, readStatus: 'conflict' },
      { $set: { readStatus: 'confirmed' } }
    )
    res.json({ success: true, cleared: result.modifiedCount })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/toll-batch/:batchId/folders/:folderId/pages/:pageNumber/reassign
// Moves one page into the folder for the given plate (creating it if new). Both affected
// folders' PDFs are thrown away and cut again from the original scan the next time somebody
// downloads or sends them, so Download/Send are never stale and this request stays fast.
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
    // The picture goes with the page: where it is kept (S3 key, or the picture itself) is copied
    // to the new record, and the stored picture is never deleted here - the other plate on a
    // two-plate page may be using it. It is removed with the batch.
    const pageDoc = await TollPage.findOne({ folderId: sourceFolder._id, pageNumber, orgId: req.orgId })
    let picture: { imageKey?: string; imageBase64?: string } = {}

    if (pageDoc) {
      if (pageDoc.imageKey) picture = { imageKey: pageDoc.imageKey }
      else if (pageDoc.imageBase64) picture = { imageBase64: pageDoc.imageBase64 }
      await TollPage.deleteOne({ _id: pageDoc._id, orgId: req.orgId })
      await TollFolder.updateOne({ _id: sourceFolder._id, orgId: req.orgId }, { $inc: { pageCount: -1 } })
    } else {
      const legacyPage = sourceFolder.pages.find(p => p.pageNumber === pageNumber)
      if (!legacyPage) return res.status(404).json({ error: 'Page not found in this folder' })
      picture = { imageBase64: legacyPage.imageBase64 }
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
      pageNumber, ...picture,
    })
    await TollFolder.updateOne({ _id: destFolder._id, orgId: req.orgId }, { $inc: { pageCount: 1 } })

    for (const folderId of [sourceFolder._id, destFolder._id]) {
      const f = await TollFolder.findOne({ _id: folderId, orgId: req.orgId })
      if (!f) continue
      const remaining = (f.pages ?? []).length + await TollPage.countDocuments({ folderId: f._id, orgId: req.orgId })
      await invalidateFolderPdf(f._id, req.orgId)
      if (remaining === 0) await TollFolder.deleteOne({ _id: f._id, orgId: req.orgId })
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
    if (folder.imagesDeleted) return res.status(410).json({ error: GONE_MESSAGE })
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
    const pdfBuffer = await getFolderPdfBuffer(String(folder._id), String(req.orgId))

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
    // merged file is immediately stale. Download/Send cuts a new one on demand.
    await invalidateFolderPdf(unrecFolder._id, orgId)

    const fleetVehicles = await Vehicle.find({ orgId }).select('plate')
    const knownPlates = fleetVehicles.map(v => v.plate).filter(Boolean)

    // Try to extract a text layer from the original PDF — zero cost for scanned PDFs
    // (returns empty map), but avoids Gemini calls for any digital pages in the batch.
    let pageTexts = new Map<number, string>()
    let original: Buffer | null = null
    const batchDoc = await TollBatch.findOne({ _id: batchId, orgId }).select('originalPdfFileId originalKey').lean()
    if (batchDoc && hasOriginal(batchDoc)) {
      try {
        original = await loadOriginal(batchDoc)
        if (original) pageTexts = await extractPageTexts(original).catch(() => new Map<number, string>())
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
        // The picture comes from S3 or the page record; if it is missing it is drawn again from the original.
        const imageBase64 = await loadPageImageBase64({ ...page, orgId, batchId }, { original })
        if (!imageBase64) throw new Error('the picture of this page is not available')

        const decision = await decidePage({
          imageBase64,
          mimeType: 'image/jpeg',
          text: pageTexts.get(page.pageNumber) ?? '',
          orgId,
        })
        const fitted = fitPlatesToFleet(decision.plates, knownPlates)
        const plates = fitted.plates

        if (plates.length > 0) {
          // The picture goes with the page (see the reassign route): copy where it is kept.
          const picture: { imageKey?: string; imageBase64?: string } =
            page.imageKey ? { imageKey: page.imageKey } : page.imageBase64 ? { imageBase64: page.imageBase64 } : {}

          // Remove from Unrecognized
          await TollPage.deleteOne({ _id: page._id, orgId })
          await TollFolder.updateOne({ _id: unrecFolder._id, orgId }, { $inc: { pageCount: -1 } })

          for (const plate of plates) {
            const destFolder = await TollFolder.findOneAndUpdate(
              { orgId, batchId, plate },
              { $setOnInsert: { orgId, batchId, plate } },
              { upsert: true, new: true }
            )
            await TollPage.create({ orgId, batchId, folderId: destFolder._id, pageNumber: page.pageNumber, ...picture, ...pageReadFields(decision, fitted.correctedFrom) })
            await TollFolder.updateOne({ _id: destFolder._id, orgId }, { $inc: { pageCount: 1 } })

            // Invalidate destination's merged PDF once per folder touched this run.
            if (!invalidatedFolders.has(destFolder._id.toString())) {
              await invalidateFolderPdf(destFolder._id, orgId)
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

    const pageDoc = await TollPage.findOne({ folderId: folder._id, pageNumber, orgId: req.orgId }).lean()
    const legacyPage = folder.pages?.find(p => p.pageNumber === pageNumber)
    if (!pageDoc && !legacyPage) return res.status(404).json({ error: 'Page not found' })
    // From the page record or S3; drawn again from the original scan if no picture was kept.
    const imageBase64 = await loadPageImageBase64({
      ...(pageDoc ?? { pageNumber, imageBase64: legacyPage!.imageBase64 }),
      orgId: folder.orgId, batchId: folder.batchId,
    })
    if (!imageBase64) return res.status(404).json({ error: 'The picture of this page is not available' })

    const fleetVehicles = await Vehicle.find({ orgId: req.orgId }).select('plate')
    const knownPlates = fleetVehicles.map(v => v.plate).filter(Boolean)

    // Same rules as a batch run: copy the printed plate(s) exactly, decide in code, fit to the fleet strictly.
    const read = await readPlatesFromPage(imageBase64, 'image/jpeg')
    const decision = decidePlates(read.copies, read.notices)
    res.json({ plates: fitPlatesToFleet(decision.plates, knownPlates).plates, status: decision.status, copies: decision.copies })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
