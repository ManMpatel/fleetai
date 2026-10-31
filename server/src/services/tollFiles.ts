import crypto from 'crypto'
import { ObjectId } from 'mongodb'
import TollBatch from '../models/TollBatch'
import TollFolder from '../models/TollFolder'
import TollPage from '../models/TollPage'
import {
  saveMergedPdf, readMergedPdf, deleteMergedPdf,
  saveOriginalPdf, readOriginalPdf, deleteOriginalPdf,
} from './tollStorage'
import {
  tollKeys, tollS3Put, tollS3Get, tollS3Exists, tollS3Delete, tollS3DeletePrefix, presignGetUrl,
  tollStorageMode, tollLinksEnabled, tollS3Configured, tollS3RetrySelfTestIfFailed,
} from './tollS3'
import { extractPagesFromPdf, cutPdfGroups, mergeImagesToPdf, rasterizeOnePage, PdfGroup } from './tollPdf'

// Where Toll Batch files live, in one place.
//
// ONE copy of every scan is kept: the original PDF the owner uploaded. Everything else is made
// from it when needed:
//   - the PDF for each plate is cut out of the original (pages are copied as they are, so it is
//     small) and kept so the next Download or Send is instant; it is cut again if the pages change;
//   - a picture of a page is kept only for pages somebody has to look at (Unrecognized, or
//     "Check plate") - never for the rest.
//
// New files go to S3 when it is set up (services/tollS3.ts) and to MongoDB (GridFS) otherwise.
// Reading follows whatever the record points at, so a batch always opens from where it was
// saved, whatever the setting is today.

type StoredOriginal = { originalKey?: string; originalPdfFileId?: ObjectId }
type OriginalRef = { originalKey?: string | null; originalPdfFileId?: unknown }
type FolderPdfRef = { pdfKey?: string | null; mergedPdfFileId?: unknown }

// -- The original scan -------------------------------------------------------
export async function storeOriginal(orgId: string, batchId: string, buffer: Buffer, filename: string): Promise<StoredOriginal> {
  await tollS3RetrySelfTestIfFailed()
  if (tollStorageMode() === 's3') {
    const key = tollKeys.original(orgId, batchId)
    try {
      await tollS3Put(key, buffer, 'application/pdf')
      return { originalKey: key }
    } catch (err: any) {
      console.error(`[tollFiles] could not save the original to S3 (${err.message}) - keeping it in MongoDB for this batch`)
    }
  }
  return { originalPdfFileId: await saveOriginalPdf(buffer, filename) }
}

export function hasOriginal(batch: OriginalRef): boolean {
  return Boolean(batch.originalKey || batch.originalPdfFileId)
}

/** Removes a scan that was saved but never got a batch (the upload failed half way). Never throws. */
export async function deleteOriginal(ref: OriginalRef): Promise<void> {
  if (ref.originalKey) await tollS3Delete(ref.originalKey).catch(() => {})
  if (ref.originalPdfFileId) await deleteOriginalPdf(ref.originalPdfFileId as ObjectId).catch(() => {})
}

/** The uploaded PDF, from wherever it was saved. null when this batch never kept one. */
export async function loadOriginal(batch: OriginalRef): Promise<Buffer | null> {
  if (batch.originalKey) return tollS3Get(batch.originalKey)
  if (batch.originalPdfFileId) return readOriginalPdf(batch.originalPdfFileId as ObjectId)
  return null
}

// -- The PDF of one plate folder ---------------------------------------------
/** Short fingerprint of a list of page numbers. */
export function pageSignature(pageNumbers: number[]): string {
  const nums = [...new Set(pageNumbers)].sort((a, b) => a - b)
  return crypto.createHash('sha1').update(nums.join(',')).digest('hex').slice(0, 12)
}

/** Saves a folder's PDF; returns where it went. */
async function storeFolderPdf(orgId: string, batchId: string, folderId: string, buffer: Buffer, sig: string): Promise<{ pdfKey?: string; mergedPdfFileId?: ObjectId }> {
  if (tollStorageMode() === 's3') {
    const key = tollKeys.folderPdf(orgId, batchId, folderId, sig)
    try {
      await tollS3Put(key, buffer, 'application/pdf')
      return { pdfKey: key }
    } catch (err: any) {
      console.error(`[tollFiles] could not save a folder PDF to S3 (${err.message}) - keeping it in MongoDB`)
    }
  }
  return { mergedPdfFileId: await saveMergedPdf(buffer, `${folderId}.pdf`) }
}

/** Removes the stored file(s) a folder points at. Never throws. */
async function dropStoredFolderPdf(ref: FolderPdfRef): Promise<void> {
  if (ref.pdfKey) await tollS3Delete(ref.pdfKey).catch(() => {})
  if (ref.mergedPdfFileId) await deleteMergedPdf(ref.mergedPdfFileId as ObjectId).catch(() => {})
}

/** Writes down where a folder's new PDF is, and which pages it was cut from. */
async function recordFolderPdf(folderId: unknown, orgId: unknown, stored: { pdfKey?: string; mergedPdfFileId?: ObjectId }, sig: string): Promise<void> {
  await TollFolder.updateOne(
    { _id: folderId, orgId },
    {
      $set: {
        merged: true,
        pdfSig: sig,
        pdfKey: stored.pdfKey ?? null,
        mergedPdfFileId: stored.mergedPdfFileId ?? null,
      },
      $unset: { mergedPdfBase64: '' },
    }
  )
}

/**
 * Throws the stored PDF of a folder away because its pages changed (a page was moved in or
 * out). The next Download / Send cuts a fresh one from the original.
 */
export async function invalidateFolderPdf(folderId: unknown, orgId: unknown): Promise<void> {
  const folder = await TollFolder.findOne({ _id: folderId, orgId }).select('pdfKey mergedPdfFileId').lean()
  if (!folder) return
  await dropStoredFolderPdf(folder)
  await TollFolder.updateOne(
    { _id: folderId, orgId },
    { $set: { merged: false, mergedPdfFileId: null, pdfKey: null, pdfSig: null }, $unset: { mergedPdfBase64: '' } }
  )
}

async function folderPageNumbers(folder: { _id: unknown; orgId: unknown; pages?: { pageNumber: number }[] }): Promise<number[]> {
  const docs = await TollPage.find({ folderId: folder._id, orgId: folder.orgId }).select('pageNumber').lean()
  const all = [...(folder.pages ?? []).map(p => p.pageNumber), ...docs.map(d => d.pageNumber)]
  return [...new Set(all)].sort((a, b) => a - b)
}

export interface FolderPdf {
  /** The bytes, when they are already in memory (the PDF was just cut, or is an old copy kept inside the folder). */
  buffer: Buffer | null
  /** Where the PDF is when it is in S3. */
  key: string | null
  /** Where the PDF is when it is in MongoDB. */
  fileId: ObjectId | null
}

// Two people (or a hover and a click) asking for the same folder at once share one build.
const building = new Map<string, Promise<FolderPdf>>()

/** Makes sure a current PDF exists for this folder - cutting it from the original if it has to. */
export function ensureFolderPdf(folderId: string, orgId: string): Promise<FolderPdf> {
  const id = `${orgId}:${folderId}`
  const running = building.get(id)
  if (running) return running
  const job = findOrBuildFolderPdf(folderId, orgId).finally(() => building.delete(id))
  building.set(id, job)
  return job
}

async function findOrBuildFolderPdf(folderId: string, orgId: string): Promise<FolderPdf> {
  const folder = await TollFolder.findOne({ _id: folderId, orgId }).select('-pages.imageBase64 -mergedPdfBase64').lean()
  if (!folder) throw new Error('Folder not found')

  const pageNums = await folderPageNumbers(folder)
  const sig = pageSignature(pageNums)

  // A stored PDF is good when it was cut from exactly these pages. One made before this
  // fingerprint existed has none, and is trusted the way it always was.
  const hasStored = Boolean(folder.pdfKey || folder.mergedPdfFileId)
  if (hasStored && (!folder.pdfSig || folder.pdfSig === sig)) {
    return { buffer: null, key: folder.pdfKey || null, fileId: folder.pdfKey ? null : (folder.mergedPdfFileId as ObjectId) }
  }

  // The oldest batches kept the PDF inside the folder document itself.
  if (!hasStored && folder.merged) {
    const old = await TollFolder.findOne({ _id: folderId, orgId }).select('mergedPdfBase64').lean()
    if (old?.mergedPdfBase64) return { buffer: Buffer.from(old.mergedPdfBase64, 'base64'), key: null, fileId: null }
  }

  if (pageNums.length === 0) throw new Error('No pages found for this folder')

  // Cut the pages out of the original scan - small, and the scan is not re-compressed.
  let buffer: Buffer | null = null
  const batch = await TollBatch.findOne({ _id: folder.batchId, orgId }).select('originalPdfFileId originalKey').lean()
  if (batch && hasOriginal(batch)) {
    try {
      const original = await loadOriginal(batch)
      if (original) buffer = await extractPagesFromPdf(original, pageNums)
    } catch (err: any) {
      console.error(`[tollFiles] could not cut folder ${folderId} from the original (${err.message})`)
    }
  }
  // Batches from before the original was kept: join the stored page pictures instead.
  if (!buffer) buffer = await mergeFolderFromPictures(folderId, orgId)

  const stored = await storeFolderPdf(String(orgId), String(folder.batchId), String(folder._id), buffer, sig)
  await recordFolderPdf(folder._id, orgId, stored, sig)
  if (hasStored) await dropStoredFolderPdf(folder)   // the one it replaces
  return { buffer, key: stored.pdfKey ?? null, fileId: stored.mergedPdfFileId ?? null }
}

async function mergeFolderFromPictures(folderId: string, orgId: string): Promise<Buffer> {
  const withPages = await TollFolder.findOne({ _id: folderId, orgId }).select('pages').lean()
  // No allowDiskUse here: the { folderId, pageNumber } index already returns the pages in order, and Atlas Flex does not allow it.
  const docs = await TollPage.find({ folderId, orgId }).sort({ pageNumber: 1 }).lean()
  const all = [...(withPages?.pages ?? []), ...docs].sort((a, b) => a.pageNumber - b.pageNumber)
  const images: string[] = []
  for (const p of all) {
    const image = await loadPageImageBase64({ ...p, orgId, batchId: (p as any).batchId })
    if (!image) throw new Error('The original scan for this batch is no longer available')
    images.push(image)
  }
  if (images.length === 0) throw new Error('No pages found for this folder')
  return mergeImagesToPdf(images)
}

async function readFolderPdf(h: FolderPdf): Promise<Buffer> {
  if (h.buffer) return h.buffer
  if (h.key) return tollS3Get(h.key)
  if (h.fileId) return readMergedPdf(h.fileId)
  throw new Error('No PDF is stored for this folder')
}

/** The PDF bytes for a folder, built first if needed. Used by Download (through the server), Send and Email. */
export async function getFolderPdfBuffer(folderId: string, orgId: string): Promise<Buffer> {
  const h = await ensureFolderPdf(folderId, orgId)
  try {
    return await readFolderPdf(h)
  } catch (err: any) {
    // The stored file has gone missing: cut a new one instead of failing.
    console.warn(`[tollFiles] the stored PDF of folder ${folderId} could not be read (${err.message}) - cutting it again`)
    await invalidateFolderPdf(folderId, orgId)
    return readFolderPdf(await ensureFolderPdf(folderId, orgId))
  }
}

/**
 * A short-lived S3 address the browser can download this folder's PDF from, built first if
 * needed. null means "the server has to send it": direct links are off, or the PDF is in MongoDB.
 */
export async function getFolderPdfLink(folderId: string, orgId: string, filename: string): Promise<string | null> {
  if (!tollLinksEnabled()) return null
  let h = await ensureFolderPdf(folderId, orgId)
  if (h.key && !h.buffer && !(await tollS3Exists(h.key))) {
    await invalidateFolderPdf(folderId, orgId)
    h = await ensureFolderPdf(folderId, orgId)
  }
  if (!h.key) return null
  return presignGetUrl(h.key, { expiresIn: 300, filename, contentType: 'application/pdf' })
}

/**
 * At the end of a batch: cuts the PDF of every folder out of the original in one pass and
 * saves them, so the first Download is already instant. A folder that fails here is simply
 * cut later, when somebody asks for it. `onProgress` is called after each folder.
 */
export async function buildBatchFolderPdfs(
  batchId: string, orgId: string, original: Buffer, onProgress?: () => Promise<void>,
): Promise<{ built: number; failed: number }> {
  const folders = await TollFolder.find({ orgId, batchId }).select('_id pdfKey pdfSig mergedPdfFileId pages.pageNumber').lean()
  const pageDocs = await TollPage.find({ orgId, batchId }).select('folderId pageNumber').lean()
  const byFolder = new Map<string, number[]>()
  for (const p of pageDocs) {
    const k = String(p.folderId)
    if (!byFolder.has(k)) byFolder.set(k, [])
    byFolder.get(k)!.push(p.pageNumber)
  }

  const groups: PdfGroup[] = []
  const sigs = new Map<string, string>()
  const previous = new Map<string, FolderPdfRef>()
  for (const f of folders) {
    const nums = [...(f.pages ?? []).map(p => p.pageNumber), ...(byFolder.get(String(f._id)) ?? [])]
    if (nums.length === 0) continue
    const sig = pageSignature(nums)
    if ((f.pdfKey || f.mergedPdfFileId) && f.pdfSig === sig) continue   // a resumed batch: already cut from these pages
    groups.push({ id: String(f._id), pages: nums })
    sigs.set(String(f._id), sig)
    previous.set(String(f._id), f)
  }

  let built = 0
  let failed = 0
  if (groups.length === 0) return { built, failed }
  try {
    for await (const cut of cutPdfGroups(original, groups)) {
      try {
        if (!cut.buffer) throw new Error('none of its pages are in the original')
        const stored = await storeFolderPdf(orgId, batchId, cut.id, cut.buffer, sigs.get(cut.id)!)
        await recordFolderPdf(cut.id, orgId, stored, sigs.get(cut.id)!)
        const old = previous.get(cut.id)
        if (old && (old.pdfKey || old.mergedPdfFileId)) await dropStoredFolderPdf(old)
        built++
      } catch (err: any) {
        failed++
        console.error(`[tollFiles] folder ${cut.id}: PDF not cut now, it will be cut when asked for (${err.message})`)
      }
      if (onProgress) await onProgress().catch(() => {})
    }
  } catch (err: any) {
    // The original itself could not be read: every folder still to do is left for later.
    failed = groups.length - built
    console.error(`[tollFiles] could not cut PDFs for batch ${batchId} (${err.message}) - they will be cut when asked for`)
  }
  return { built, failed }
}

// -- Pictures of pages that need a look --------------------------------------
/** Keeps the picture of one page (S3 if it is set up, otherwise inside the page record). */
export async function storePageImage(orgId: string, batchId: string, pageNumber: number, imageBase64: string): Promise<{ imageKey?: string; imageBase64?: string }> {
  if (tollStorageMode() === 's3') {
    const key = tollKeys.pageImage(orgId, batchId, pageNumber)
    try {
      await tollS3Put(key, Buffer.from(imageBase64, 'base64'), 'image/jpeg')
      return { imageKey: key }
    } catch (err: any) {
      console.error(`[tollFiles] could not save a page picture to S3 (${err.message}) - keeping it in MongoDB`)
    }
  }
  return { imageBase64 }
}

type PageRef = { imageBase64?: string | null; imageKey?: string | null; pageNumber: number; batchId?: unknown; orgId?: unknown }

/**
 * The picture of a page as base64: from the page record, from S3, or - if neither has it - drawn
 * again from the original. Pass `original` when the scan is already in memory, so a loop over
 * many pages does not read it again for every page.
 */
export async function loadPageImageBase64(page: PageRef, opts: { original?: Buffer | null } = {}): Promise<string | null> {
  if (page.imageBase64) return page.imageBase64
  if (page.imageKey) {
    try {
      return (await tollS3Get(page.imageKey)).toString('base64')
    } catch (err: any) {
      console.error(`[tollFiles] could not read ${page.imageKey} (${err.message}) - drawing the page again`)
    }
  }
  try {
    let original = opts.original ?? null
    if (!original) {
      if (!page.batchId || !page.orgId) return null
      const batch = await TollBatch.findOne({ _id: page.batchId, orgId: page.orgId }).select('originalPdfFileId originalKey').lean()
      original = batch ? await loadOriginal(batch) : null
    }
    if (!original) return null
    return (await rasterizeOnePage(original, page.pageNumber)).imageBase64
  } catch (err: any) {
    console.error(`[tollFiles] could not draw page ${page.pageNumber} again (${err.message})`)
    return null
  }
}

/** A link the browser can load the page picture from, or null when the picture is not in S3 (or links are off). */
export function pageImageLink(page: { imageKey?: string | null }): string | null {
  if (!page.imageKey || !tollLinksEnabled()) return null
  return presignGetUrl(page.imageKey, { expiresIn: 3600, contentType: 'image/jpeg' })
}

// -- Deleting a batch --------------------------------------------------------
/**
 * Removes every stored file of a batch: the original, the PDFs of its folders, and anything under
 * its S3 prefix. Never throws. Returns false when S3 files of this batch are known to exist and
 * could not be removed (the caller may then keep the records and try again later); files in
 * MongoDB are removed on a best-effort basis.
 *
 * A batch that has nothing in S3 (every older batch) never waits for S3: if S3 cannot be
 * reached, the clean-up of such a batch still goes through. Anything stray under its S3 prefix
 * is removed by the bucket's own expiry rule.
 */
export async function deleteBatchFiles(
  orgId: string, batch: OriginalRef & { _id: unknown }, folders: FolderPdfRef[],
): Promise<boolean> {
  if (batch.originalPdfFileId) await deleteOriginalPdf(batch.originalPdfFileId as ObjectId).catch(() => {})
  for (const f of folders) {
    if (f.mergedPdfFileId) await deleteMergedPdf(f.mergedPdfFileId as ObjectId).catch(() => {})
  }
  if (!tollS3Configured()) return true
  try {
    await tollS3DeletePrefix(tollKeys.batchPrefix(orgId, String(batch._id)))
    return true
  } catch (err: any) {
    // Does anything this batch owns point into S3? If a check itself fails, assume it does.
    const pointsToS3 = Boolean(batch.originalKey) || folders.some(f => f.pdfKey) ||
      Boolean(await TollPage.exists({ orgId, batchId: batch._id, imageKey: { $type: 'string' } }).catch(() => true))
    if (!pointsToS3) {
      console.warn(`[tollFiles] S3 could not be reached to clear batch ${batch._id} (${err.message}), but nothing of it is stored there`)
      return true
    }
    console.error(`[tollFiles] could not clear the S3 files of batch ${batch._id}: ${err.message}`)
    return false
  }
}
