import TollBatch from '../models/TollBatch'
import TollFolder from '../models/TollFolder'
import TollPage from '../models/TollPage'
import { TOLL_LEGACY_RETENTION_DAYS, TOLL_RETENTION_DAYS, DAY_MS } from '../config/toll'
import { deleteBatchFiles } from './tollFiles'
import { deleteMergedPdf } from './tollStorage'
import { tollKeys, tollS3Configured, tollS3DeletePrefix } from './tollS3'

// The nightly clean-up of Toll Batch data (runs from index.ts, 3:30am).
//
// A batch is deleted when its own date (expiresAt) has passed. A new batch gets
// "upload + 21 days" when it is uploaded; a batch from before that change has no date and keeps
// the rule it always had, upload + 45 days. Deleting a batch removes everything it owns: the
// original scan, the PDF of each plate, the page pictures (S3 files and/or MongoDB records).

export interface TollPurgeResult {
  /** Batches whose time was up and that were removed. */
  batches: number
  /** Folders left behind by a batch that no longer exists, removed. */
  orphanFolders: number
}

export async function purgeExpiredTollBatches(now: Date = new Date()): Promise<TollPurgeResult> {
  const result: TollPurgeResult = { batches: 0, orphanFolders: 0 }

  // -- 1. Batches whose time is up -------------------------------------------
  const legacyCutoff = new Date(now.getTime() - TOLL_LEGACY_RETENTION_DAYS * DAY_MS)
  const expired = await TollBatch.find({
    $or: [
      { expiresAt: { $lte: now } },
      { expiresAt: null, createdAt: { $lt: legacyCutoff } },   // no date of its own: the old 45-day rule
    ],
  }).select('_id orgId originalPdfFileId originalKey').setOptions({ allowCrossTenant: true })

  for (const batch of expired) {
    try {
      const folders = await TollFolder.find({ batchId: batch._id })
        .select('_id mergedPdfFileId pdfKey').setOptions({ allowCrossTenant: true })
      const filesGone = await deleteBatchFiles(String(batch.orgId), batch, folders)
      if (!filesGone) {
        // The S3 files could not be removed (S3 is unreachable?). Keep the records so tonight's
        // run - or the next one - tries again, instead of forgetting files we still pay for.
        console.error(`[tollPurge] batch ${batch._id}: its S3 files could not be removed - will try again at the next clean-up`)
        continue
      }
      await TollPage.deleteMany({ batchId: batch._id }).setOptions({ allowCrossTenant: true })
      await TollFolder.deleteMany({ batchId: batch._id }).setOptions({ allowCrossTenant: true })
      await TollBatch.deleteOne({ _id: batch._id }).setOptions({ allowCrossTenant: true })
      result.batches++
    } catch (err: any) {
      console.error(`[tollPurge] batch ${batch._id} could not be removed: ${err.message}`)
    }
  }
  if (result.batches > 0) {
    console.log(`TollBatch purge - hard-deleted ${result.batches} batch(es) and all associated data (new batches: 21 days, older ones: 45 days)`)
  }

  // -- 2. Orphan folder sweep ------------------------------------------------
  // Folders whose batch no longer exists (the batch was deleted while it was still being
  // processed, or a crash left ghost data). A folder only counts once it is older than the
  // shortest retention, so a batch that is being created right now is never touched.
  const orphanCutoff = new Date(now.getTime() - TOLL_RETENTION_DAYS * DAY_MS)
  const staleFolders = await TollFolder.find({ createdAt: { $lt: orphanCutoff } })
    .select('_id orgId batchId mergedPdfFileId pdfKey').setOptions({ allowCrossTenant: true })
  if (staleFolders.length > 0) {
    const staleBatchIds = [...new Set(staleFolders.map(f => String(f.batchId)).filter(Boolean))]
    const liveBatches = await TollBatch.find({ _id: { $in: staleBatchIds } })
      .select('_id').setOptions({ allowCrossTenant: true })
    const live = new Set(liveBatches.map(b => String(b._id)))
    const orphans = staleFolders.filter(f => !live.has(String(f.batchId)))

    if (orphans.length > 0) {
      for (const f of orphans) {
        if (f.mergedPdfFileId) await deleteMergedPdf(f.mergedPdfFileId as any).catch(() => {})
      }
      // Whatever the orphans left in S3 sits under their batch's folder there.
      if (tollS3Configured()) {
        const pairs = new Map<string, { orgId: string; batchId: string }>()
        for (const f of orphans) pairs.set(`${f.orgId}:${f.batchId}`, { orgId: String(f.orgId), batchId: String(f.batchId) })
        for (const { orgId, batchId } of pairs.values()) {
          await tollS3DeletePrefix(tollKeys.batchPrefix(orgId, batchId))
            .catch(err => console.error(`[tollPurge] could not clear the S3 files of ghost batch ${batchId}: ${err.message}`))
        }
      }
      const orphanFolderIds = orphans.map(f => f._id)
      const orphanBatchIds = [...new Set(orphans.map(f => String(f.batchId)))]
      await TollPage.deleteMany({ $or: [{ folderId: { $in: orphanFolderIds } }, { batchId: { $in: orphanBatchIds } }] }).setOptions({ allowCrossTenant: true })
      await TollFolder.deleteMany({ _id: { $in: orphanFolderIds } }).setOptions({ allowCrossTenant: true })
      result.orphanFolders = orphans.length
      console.log(`Orphan folder sweep - hard-deleted ${orphans.length} ghost folder(s) with no parent batch`)
    }
  }

  return result
}
