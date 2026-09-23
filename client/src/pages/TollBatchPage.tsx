import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { AnimatePresence, motion } from 'framer-motion'
import StatCard from '../components/StatCard'

// TollBatch — scan a week's printed toll notices into one PDF, upload it here, and the
// pages get sorted into one folder per number plate. Processing runs as a background job
// server-side; this page polls every 30s while a batch is in progress, matching the same
// self-terminating poll shape App.tsx uses for owner-approval.

type BatchStatus = 'processing' | 'done' | 'failed'

interface TollBatch {
  _id: string
  originalFilename: string
  status: BatchStatus
  totalPages: number
  processedPages: number
  currentStep?: string
  error?: string
  createdAt: string
  completedAt?: string
}

interface TollFolderSummary {
  _id: string
  plate: string | null
  matchType: 'sorted' | 'stolen' | 'sold' | 'unregistered' | 'unrecognized'
  pageCount: number
  hasMergedPdf: boolean
  sentStatus: 'unsent' | 'sent'
  sentTo?: string
  sentAt?: string
}

const matchTypeConfig: Record<TollFolderSummary['matchType'], { label: string | null; box: string; badge: string }> = {
  sorted:       { label: null,                box: 'border-border',                     badge: '' },
  stolen:       { label: 'Stolen vehicle',    box: 'border-red/40 bg-red-bg/40',        badge: 'bg-red-bg text-red' },
  sold:         { label: 'Sold vehicle',      box: 'border-border bg-surface2',         badge: 'bg-surface2 text-text-muted' },
  unregistered: { label: 'Not in your fleet', box: 'border-purple/40 bg-purple-bg/40',  badge: 'bg-purple-bg text-purple' },
  unrecognized: { label: 'Needs review',      box: 'border-amber/40 bg-amber-bg/40',    badge: 'bg-amber-bg text-amber' },
}

interface RenterMatch {
  _id: string
  name: string
  email: string | null
  phone: string
}

const API_BASE = '/api/toll-batch'

export default function TollBatchPage() {
  const [batches, setBatches] = useState<TollBatch[]>([])
  const [tollStats, setTollStats] = useState<{ totalScanned: number; sorted: number; flagged: number; unrecognized: number } | null>(null)
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
  const [activeBatch, setActiveBatch] = useState<TollBatch | null>(null)
  const [folders, setFolders] = useState<TollFolderSummary[]>([])
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [sendTarget, setSendTarget] = useState<TollFolderSummary | null>(null)
  const [batchStale, setBatchStale] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(''), 3000)
  }

  const fetchBatchList = useCallback(async () => {
    try {
      const { data } = await axios.get(API_BASE)
      // Handle both the new { batches, stats } shape and the old bare-array shape so a
      // frontend/backend version skew during a rolling deploy doesn't crash the page.
      const list: TollBatch[] = Array.isArray(data) ? data : (data.batches ?? [])
      setBatches(list)
      if (!Array.isArray(data) && data.stats) setTollStats(data.stats)
    } catch {
      showToast('✗ Could not load past batches')
    } finally {
      setLoadingBatches(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchBatchList() }, [fetchBatchList])

  // Self-terminating 30s poll while a batch is active — same shape as App.tsx's
  // owner-approval poll: fetch once immediately, then every 30s until a terminal status,
  // clearing the interval from inside itself rather than leaving it running forever.
  const fetchBatchDetail = useCallback(async (batchId: string): Promise<BatchStatus | undefined> => {
    try {
      const { data } = await axios.get<{ batch: TollBatch; folders: TollFolderSummary[]; stale: boolean }>(`${API_BASE}/${batchId}`)
      setActiveBatch(data.batch)
      setFolders(data.folders)
      setBatchStale(data.stale)
      return data.batch.status
    } catch {
      showToast('✗ Lost connection to this batch')
      return undefined
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeBatchId) return
    let cancelled = false

    fetchBatchDetail(activeBatchId)
    const interval = setInterval(async () => {
      const status = await fetchBatchDetail(activeBatchId)
      if (cancelled) return
      if (status === 'done' || status === 'failed') {
        clearInterval(interval)
        fetchBatchList()
      }
    }, 30000)

    return () => { cancelled = true; clearInterval(interval) }
  }, [activeBatchId, fetchBatchDetail, fetchBatchList])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf') {
      showToast('✗ Please choose a PDF file')
      return
    }

    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await axios.post<{ batchId: string }>(API_BASE, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      showToast('✓ Upload started — sorting in progress')
      setActiveBatchId(data.batchId)
    } catch (err: any) {
      showToast(`✗ ${err.response?.data?.error || 'Upload failed'}`)
    } finally {
      setUploading(false)
    }
  }

  function openBatch(batchId: string) {
    setActiveBatchId(batchId)
  }

  function backToList() {
    setActiveBatchId(null)
    setActiveBatch(null)
    setFolders([])
    fetchBatchList()
  }

  async function retryBatch() {
    if (!activeBatchId) return
    setRetrying(true)
    try {
      await axios.post(`${API_BASE}/${activeBatchId}/retry`)
      showToast('✓ Resuming — sorting in progress')
      setBatchStale(false)
      fetchBatchDetail(activeBatchId)
    } catch (err: any) {
      showToast(`✗ ${err.response?.data?.error || 'Could not resume this batch'}`)
    } finally {
      setRetrying(false)
    }
  }

  function handleSent(folderId: string, sentTo: string, sentAt: string) {
    setFolders(prev => prev.map(f => f._id === folderId ? { ...f, sentStatus: 'sent', sentTo, sentAt } : f))
    setSendTarget(null)
    showToast(`✓ Sent to ${sentTo}`)
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text-primary shadow-lg">{toast}</div>
      )}

      <div className="px-6 py-5 border-b border-border bg-surface flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Toll Batch</h1>
          <p className="text-xs text-text-secondary mt-0.5">Scan a week's toll notices into one PDF — we sort it by plate</p>
        </div>
        {!activeBatchId && (
          <>
            <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleUpload} />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {uploading ? 'Uploading...' : 'Upload scanned PDF'}
            </button>
          </>
        )}
        {activeBatchId && (
          <button onClick={backToList} className="px-4 py-2 bg-surface2 border border-border text-text-secondary rounded-lg text-sm font-medium hover:border-accent transition-colors">
            ← Back to batches
          </button>
        )}
      </div>

      <div className="flex-1 px-6 py-6">
        {tollStats && !activeBatchId && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Scanned" value={tollStats.totalScanned} color="accent" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M4 4h16v13l-4-3-4 3-4-3-4 3V4z"/></svg>} />
            <StatCard label="Sorted" value={tollStats.sorted} color="green" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><polyline points="20 6 9 17 4 12"/></svg>} />
            <StatCard label="Flagged" value={tollStats.flagged} color="red" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>} />
            <StatCard label="Unrecognized" value={tollStats.unrecognized} color="amber" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>} />
          </div>
        )}
        {activeBatchId && activeBatch ? (
          activeBatch.status === 'processing' ? (
            batchStale ? (
              <FailedView
                batch={{ ...activeBatch, error: activeBatch.error || 'This batch stopped making progress and looks stuck.' }}
                onBack={backToList} onRetry={retryBatch} retrying={retrying}
              />
            ) : (
              <ProcessingView batch={activeBatch} folders={folders} />
            )
          ) : activeBatch.status === 'failed' ? (
            <FailedView batch={activeBatch} onBack={backToList} onRetry={retryBatch} retrying={retrying} />
          ) : (
            <FolderGrid folders={folders} batchId={activeBatchId} onSend={setSendTarget} onToast={showToast} onRefresh={() => fetchBatchDetail(activeBatchId)} />
          )
        ) : (
          <BatchList batches={batches} loading={loadingBatches} onOpen={openBatch} />
        )}
      </div>

      {sendTarget && activeBatchId && (
        <SendModal
          batchId={activeBatchId}
          folder={sendTarget}
          onClose={() => setSendTarget(null)}
          onSent={handleSent}
          onToast={showToast}
        />
      )}
    </div>
  )
}

// ── Past batches list ───────────────────────────────────────
function BatchList({ batches, loading, onOpen }: { batches: TollBatch[]; loading: boolean; onOpen: (id: string) => void }) {
  if (loading) return <p className="text-text-muted text-sm text-center py-12">Loading...</p>
  if (!batches || batches.length === 0) {
    return (
      <div className="text-center py-20 text-text-muted text-sm">
        No batches yet — upload a scanned PDF of this week's toll notices to get started.
      </div>
    )
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-2">
      {batches.map(b => (
        <button key={b._id} onClick={() => onOpen(b._id)}
          className="w-full flex items-center justify-between px-5 py-4 bg-surface border border-border rounded-xl hover:border-accent transition-colors text-left">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{b.originalFilename}</p>
            <p className="text-xs text-text-secondary mt-0.5">{fmt(b.createdAt)} · {b.totalPages || '?'} pages</p>
          </div>
          <StatusPill status={b.status} />
        </button>
      ))}
    </div>
  )
}

function StatusPill({ status }: { status: BatchStatus }) {
  const styles: Record<BatchStatus, string> = {
    processing: 'bg-amber-bg text-amber',
    done: 'bg-green/10 text-green',
    failed: 'bg-red/10 text-red',
  }
  const text: Record<BatchStatus, string> = { processing: 'Processing', done: 'Done', failed: 'Failed' }
  return <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${styles[status]}`}>{text[status]}</span>
}

// ── Animated processing view ────────────────────────────────
// A 30s poll only gives us a new snapshot every 30 seconds, but a scan-sweep and shimmer
// keep the screen visibly alive between snapshots — the sorting itself really is
// continuous server-side, this just stops it from reading as frozen while we wait.
function ProcessingView({ batch, folders }: { batch: TollBatch; folders: TollFolderSummary[] }) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(new Date(batch.createdAt).getTime())
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const pct = batch.totalPages > 0 ? Math.min(100, Math.round((batch.processedPages / batch.totalPages) * 100)) : 0
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const knownFolders = folders.filter(f => f.plate)
  const unrecognized = folders.find(f => !f.plate)

  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-base font-semibold text-text-primary mb-1">Sorting {batch.originalFilename}</h2>
        <p className="text-xs text-text-secondary font-mono">{mins}:{String(secs).padStart(2, '0')} elapsed</p>
      </div>

      {/* Scan sweep + shimmer progress */}
      <div className="relative h-3 bg-surface2 border border-border rounded-full overflow-hidden mb-3">
        <motion.div
          className="h-full bg-accent rounded-full relative overflow-hidden"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          {!prefersReducedMotion && (
            <motion.div
              className="absolute inset-y-0 w-1/3 bg-white/30"
              animate={{ x: ['-100%', '300%'] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
            />
          )}
        </motion.div>
        {!prefersReducedMotion && pct < 100 && (
          <motion.div
            className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-accent/40 to-transparent"
            animate={{ left: ['0%', '100%'] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-text-secondary mb-8">
        <span>{batch.processedPages} of {batch.totalPages || '?'} pages</span>
        <span className="font-medium text-accent">{pct}%</span>
      </div>

      {/* Real status line — sourced from the backend's actual per-page step, never filler */}
      <div className="bg-surface border border-border rounded-xl px-5 py-4 mb-8 text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={batch.currentStep}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="text-sm text-text-primary"
          >
            {batch.currentStep || 'Starting...'}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Folders glow into existence the moment a new plate is discovered */}
      {(knownFolders.length > 0 || unrecognized) && (
        <div>
          <p className="text-xs text-text-secondary mb-3">
            <span className="font-medium text-text-primary">{knownFolders.length}</span> plate{knownFolders.length !== 1 ? 's' : ''} found so far
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            <AnimatePresence>
              {knownFolders.map(f => (
                <motion.div
                  key={f._id}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="bg-surface border border-accent/40 rounded-xl p-3 text-center shadow-[0_0_0_1px_rgba(59,130,246,0.08)]"
                >
                  <p className="text-sm font-semibold text-text-primary truncate">{f.plate}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{f.pageCount} page{f.pageCount !== 1 ? 's' : ''}</p>
                </motion.div>
              ))}
            </AnimatePresence>
            {unrecognized && (
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-surface2 border border-dashed border-border rounded-xl p-3 text-center"
              >
                <p className="text-sm font-semibold text-text-muted truncate">Unrecognized</p>
                <p className="text-xs text-text-secondary mt-0.5">{unrecognized.pageCount} page{unrecognized.pageCount !== 1 ? 's' : ''}</p>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Renders instantly, no motion, when the OS/browser asks for reduced motion — same real data either way. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const listener = () => setReduced(mq.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])
  return reduced
}

function FailedView({ batch, onBack, onRetry, retrying }: { batch: TollBatch; onBack: () => void; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="text-center py-20 max-w-md mx-auto">
      <div className="w-14 h-14 rounded-full bg-red/10 flex items-center justify-center mx-auto mb-4">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6 text-red">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h2 className="text-sm font-semibold text-text-primary mb-1.5">Processing failed</h2>
      <p className="text-xs text-text-secondary mb-6">{batch.error || 'Something went wrong while sorting this batch.'}</p>
      <p className="text-xs text-text-muted mb-6">Resuming picks up from the last page it sorted — no re-scanning finished pages.</p>
      <div className="flex items-center justify-center gap-3">
        <button onClick={onBack} className="px-4 py-2 bg-surface2 border border-border text-text-secondary rounded-lg text-sm font-medium hover:border-accent transition-colors">
          Back to batches
        </button>
        <button onClick={onRetry} disabled={retrying} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
          {retrying ? 'Resuming…' : 'Resume'}
        </button>
      </div>
    </div>
  )
}

// ── Completed batch — folder grid ───────────────────────────
function FolderGrid({ folders, batchId, onSend, onToast, onRefresh }: {
  folders: TollFolderSummary[]
  batchId: string
  onSend: (folder: TollFolderSummary) => void
  onToast: (msg: string) => void
  onRefresh: () => void
}) {
  if (folders.length === 0) {
    return <div className="text-center py-20 text-text-muted text-sm">No pages were found in this batch.</div>
  }

  const known = folders.filter(f => f.plate)
  const unrecognized = folders.find(f => !f.plate)

  return (
    <div>
      <p className="text-xs text-text-secondary mb-4">
        <span className="font-medium text-text-primary">{known.length}</span> plate{known.length !== 1 ? 's' : ''} sorted
        {unrecognized && <> · <span className="font-medium text-text-primary">{unrecognized.pageCount}</span> page{unrecognized.pageCount !== 1 ? 's' : ''} unrecognized</>}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {[...known, ...(unrecognized ? [unrecognized] : [])].map(f => (
          <FolderCard key={f._id} folder={f} batchId={batchId} onSend={onSend} onToast={onToast} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  )
}

function FolderCard({ folder, batchId, onSend, onToast, onRefresh }: {
  folder: TollFolderSummary
  batchId: string
  onSend: (folder: TollFolderSummary) => void
  onToast: (msg: string) => void
  onRefresh: () => void
}) {
  const label = folder.plate || 'Unrecognized'
  const downloadUrl = `${API_BASE}/${batchId}/folders/${folder._id}/download`
  const sent = folder.sentStatus === 'sent'
  const cfg = matchTypeConfig[folder.matchType]
  const [reviewing, setReviewing] = useState(false)

  // Prefetched on hover rather than on mount — dragstart can't itself be async (browsers
  // only accept setData() synchronously within the drag gesture, so fetching the PDF ON
  // dragstart is too late and silently no-ops), but fetching every card's full PDF the
  // instant a completed batch's grid renders would fire dozens of blob requests nobody
  // asked for. A hover almost always precedes an actual drag attempt by enough time.
  const [dragUrl, setDragUrl] = useState<string | null>(null)
  const [prefetching, setPrefetching] = useState(false)
  const [sharing, setSharing] = useState(false)
  const canWebShare = typeof navigator !== 'undefined' && 'share' in navigator && 'canShare' in navigator

  // The prefetched blob URL is only released on unmount (not after a drag completes,
  // since the same card can be dragged more than once) — otherwise it leaks for as long
  // as this batch's grid stays mounted.
  useEffect(() => {
    return () => { if (dragUrl) window.URL.revokeObjectURL(dragUrl) }
  }, [dragUrl])

  function prefetchForDrag() {
    if (dragUrl || prefetching || !folder.hasMergedPdf) return
    setPrefetching(true)
    axios.get(downloadUrl, { responseType: 'blob' })
      .then(res => setDragUrl(window.URL.createObjectURL(res.data)))
      .catch(() => { /* drag just won't work for this card — Download below still will */ })
      .finally(() => setPrefetching(false))
  }

  async function shareFile() {
    if (!folder.hasMergedPdf || sharing) return
    setSharing(true)
    try {
      const res = await axios.get(downloadUrl, { responseType: 'blob' })
      const file = new File([res.data], `${label}.pdf`, { type: 'application/pdf' })
      if (!navigator.canShare({ files: [file] })) {
        onToast('✗ Sharing not supported — use Download instead')
        return
      }
      await navigator.share({ files: [file], title: `${label} toll notice` })
    } catch (err: any) {
      if (err?.name !== 'AbortError') onToast('✗ Share failed — use Download instead')
    } finally {
      setSharing(false)
    }
  }

  async function download() {
    try {
      const res = await axios.get(downloadUrl, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${label}.pdf`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      onToast('✗ Download failed')
    }
  }

  // Best-effort drag target for a manual handoff into WhatsApp — dragging a page-loaded
  // file onto a native desktop app window (WhatsApp Desktop) works reliably in Chromium
  // browsers via this DownloadURL trick; dragging into a different browser tab (WhatsApp
  // Web) has much narrower, less consistent support. This never touches the WhatsApp API
  // and is never tracked — Download above is the one path that's always guaranteed to work.
  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    // A fast drag with no real hover dwell time can outrun the prefetch — if dragUrl
    // isn't ready yet there's nothing synchronous to hand the browser, so the gesture
    // just does nothing (rather than a broken half-drag). Download is unaffected.
    if (!dragUrl) return
    e.dataTransfer.setData('DownloadURL', `application/pdf:${label}.pdf:${dragUrl}`)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <>
    <div
      draggable={!!folder.hasMergedPdf}
      onMouseEnter={prefetchForDrag}
      onDragStart={handleDragStart}
      className={`bg-surface border rounded-xl p-4 transition-colors ${
        sent ? `${cfg.box} bg-surface2/60` : `${cfg.box} hover:border-accent`
      } ${folder.hasMergedPdf ? 'cursor-grab active:cursor-grabbing' : ''}`}
      title={folder.hasMergedPdf ? 'Drag onto WhatsApp Desktop to send manually (or use Download for WhatsApp Web)' : undefined}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          {cfg.label && <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>}
          <p className={`text-sm font-semibold truncate ${folder.plate ? 'text-text-primary' : 'text-text-muted'}`}>{label}</p>
        </div>
        {sent && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green/10 text-green shrink-0">Sent</span>
        )}
      </div>
      <p className="text-xs text-text-secondary mb-3">{folder.pageCount} page{folder.pageCount !== 1 ? 's' : ''}</p>

      {sent && folder.sentTo && (
        <p className="text-xs text-text-secondary mb-3 truncate">to {folder.sentTo}</p>
      )}

      <div className="flex gap-1.5">
        <button onClick={download} disabled={!folder.hasMergedPdf}
          className="flex-1 px-2.5 py-1.5 bg-surface2 border border-border text-text-secondary rounded-lg text-xs font-medium hover:border-accent disabled:opacity-50 transition-colors">
          Download
        </button>
        {canWebShare && (
          <button onClick={shareFile} disabled={!folder.hasMergedPdf || sharing}
            title="Share directly to WhatsApp Desktop or other apps — no download needed"
            className="px-2.5 py-1.5 bg-surface2 border border-border text-text-secondary rounded-lg text-xs hover:border-accent disabled:opacity-50 transition-colors shrink-0">
            {sharing ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 animate-spin">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            )}
          </button>
        )}
        {folder.matchType === 'unrecognized' && (
          <button onClick={() => setReviewing(true)}
            className="flex-1 px-2.5 py-1.5 bg-amber-bg border border-amber/30 text-amber rounded-lg text-xs font-medium hover:border-amber transition-colors">
            Review
          </button>
        )}
        {folder.plate && (
          <button onClick={() => onSend(folder)} disabled={!folder.hasMergedPdf}
            className="flex-1 px-2.5 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
            {sent ? 'Resend' : 'Send'}
          </button>
        )}
      </div>
    </div>
    {reviewing && (
      <ReviewModal
        batchId={batchId}
        folder={folder}
        onClose={() => setReviewing(false)}
        onResolved={() => { setReviewing(false); onRefresh() }}
        onToast={onToast}
      />
    )}
    </>
  )
}

// ── Review modal — Unrecognized folder only: view each page's photo, type its plate,
// it moves out of Unrecognized immediately. No paper needed.
function ReviewModal({ batchId, folder, onClose, onResolved, onToast }: {
  batchId: string
  folder: TollFolderSummary
  onClose: () => void
  onResolved: () => void
  onToast: (msg: string) => void
}) {
  const [pages, setPages] = useState<{ pageNumber: number; imageBase64: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [plateInputs, setPlateInputs] = useState<Record<number, string>>({})
  const [savingPage, setSavingPage] = useState<number | null>(null)

  useEffect(() => {
    axios.get<{ pages: { pageNumber: number; imageBase64: string }[] }>(`${API_BASE}/${batchId}/folders/${folder._id}/pages`)
      .then(({ data }) => setPages(data.pages))
      .catch(() => onToast('✗ Could not load these pages'))
      .finally(() => setLoading(false))
  }, [batchId, folder._id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function savePage(pageNumber: number) {
    const plate = (plateInputs[pageNumber] || '').trim()
    if (!plate) return
    setSavingPage(pageNumber)
    try {
      await axios.post(`${API_BASE}/${batchId}/folders/${folder._id}/pages/${pageNumber}/reassign`, { plate })
      onToast(`✓ Page moved to ${plate.toUpperCase()}`)
      setPages(prev => prev.filter(p => p.pageNumber !== pageNumber))
      onResolved()
    } catch (err: any) {
      onToast(`✗ ${err.response?.data?.error || 'Could not move this page'}`)
    } finally {
      setSavingPage(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">Review unrecognized pages</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {loading ? (
          <p className="text-xs text-text-muted text-center py-8">Loading pages…</p>
        ) : pages.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-8">All done — nothing left to review here.</p>
        ) : (
          <div className="space-y-5">
            {pages.map(p => (
              <div key={p.pageNumber} className="border border-border rounded-xl overflow-hidden">
                <img src={`data:image/png;base64,${p.imageBase64}`} alt={`Page ${p.pageNumber}`} className="w-full max-h-64 object-contain bg-surface2" />
                <div className="p-3 flex items-center gap-2">
                  <span className="text-xs text-text-muted shrink-0">Page {p.pageNumber}</span>
                  <input
                    value={plateInputs[p.pageNumber] || ''}
                    onChange={e => setPlateInputs(prev => ({ ...prev, [p.pageNumber]: e.target.value.toUpperCase() }))}
                    placeholder="Type plate"
                    className="flex-1 px-2.5 py-1.5 bg-surface2 border border-border rounded-lg text-sm text-text-primary font-mono focus:outline-none focus:border-accent"
                  />
                  <button onClick={() => savePage(p.pageNumber)} disabled={savingPage === p.pageNumber || !plateInputs[p.pageNumber]?.trim()}
                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors shrink-0">
                    {savingPage === p.pageNumber ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Send modal — search renter, suggested renter shown but never auto-sent ──────────
function SendModal({ batchId, folder, onClose, onSent, onToast }: {
  batchId: string
  folder: TollFolderSummary
  onClose: () => void
  onSent: (folderId: string, sentTo: string, sentAt: string) => void
  onToast: (msg: string) => void
}) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<RenterMatch[]>([])
  const [suggested, setSuggested] = useState<RenterMatch | null>(null)
  const [selectedRenter, setSelectedRenter] = useState<RenterMatch | null>(null)
  const [rawEmail, setRawEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(true)

  const search = useCallback(async (q: string) => {
    try {
      const { data } = await axios.get<{ suggested: RenterMatch | null; matches: RenterMatch[] }>(
        `${API_BASE}/${batchId}/folders/${folder._id}/renters`,
        { params: q ? { q } : {} }
      )
      setMatches(data.matches)
      if (!q) setSuggested(data.suggested)
    } catch {
      onToast('✗ Could not load renters')
    } finally {
      setLoadingMatches(false)
    }
  }, [batchId, folder._id]) // eslint-disable-line react-hooks/exhaustive-deps

  // One debounced effect handles both the initial load (query starts '') and subsequent
  // typing — a separate immediate fetch on mount would just duplicate this one 250ms later.
  useEffect(() => {
    const t = setTimeout(() => search(query), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [query, search])

  async function send() {
    if (!selectedRenter && !rawEmail.trim()) return
    setSending(true)
    try {
      const body = selectedRenter ? { renterId: selectedRenter._id } : { email: rawEmail.trim() }
      const { data } = await axios.post<{ success: boolean; sentTo: string; sentAt: string }>(
        `${API_BASE}/${batchId}/folders/${folder._id}/send`, body
      )
      onSent(folder._id, data.sentTo, data.sentAt)
    } catch (err: any) {
      onToast(`✗ ${err.response?.data?.error || 'Send failed'}`)
    } finally {
      setSending(false)
    }
  }

  const canSend = (!!selectedRenter || !!rawEmail.trim()) && !sending

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-text-primary">Send {folder.plate}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-text-secondary mb-4">Emails the merged PDF for this plate. Pick a renter or type an address.</p>

        {suggested && !selectedRenter && !query && (
          <button
            onClick={() => { setSelectedRenter(suggested); setRawEmail('') }}
            className="w-full flex items-center justify-between px-3 py-2.5 mb-3 bg-accent-bg border border-accent/30 rounded-lg text-left hover:border-accent transition-colors"
          >
            <div className="min-w-0">
              <p className="text-xs text-accent font-medium">Currently assigned to this plate</p>
              <p className="text-sm text-text-primary truncate">{suggested.name}</p>
              <p className="text-xs text-text-secondary truncate">{suggested.email || 'No email on file'}</p>
            </div>
            <span className="text-xs text-accent font-medium shrink-0 ml-2">Select</span>
          </button>
        )}

        <div className="mb-3">
          <input
            className="w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
            placeholder="Search renters by name..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedRenter(null) }}
          />
        </div>

        {!selectedRenter && (
          <div className="max-h-40 overflow-y-auto mb-3 -mx-1 px-1">
            {loadingMatches ? (
              <p className="text-xs text-text-muted text-center py-3">Loading...</p>
            ) : matches.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-3">No matching renters</p>
            ) : (
              matches.map(r => (
                <button key={r._id} onClick={() => { setSelectedRenter(r); setRawEmail('') }}
                  className="w-full flex flex-col items-start px-3 py-2 rounded-lg hover:bg-surface2 transition-colors text-left">
                  <span className="text-sm text-text-primary">{r.name}</span>
                  <span className="text-xs text-text-secondary">{r.email || 'No email on file'}</span>
                </button>
              ))
            )}
          </div>
        )}

        {selectedRenter && (
          <div className="flex items-center justify-between px-3 py-2.5 mb-3 bg-surface2 border border-border rounded-lg">
            <div className="min-w-0">
              <p className="text-sm text-text-primary truncate">{selectedRenter.name}</p>
              <p className="text-xs text-text-secondary truncate">{selectedRenter.email || 'No email on file'}</p>
            </div>
            <button onClick={() => setSelectedRenter(null)} className="text-xs text-text-muted hover:text-text-primary shrink-0 ml-2">Change</button>
          </div>
        )}

        {!selectedRenter && (
          <div className="mb-4">
            <p className="text-xs text-text-secondary mb-1.5">Or type an email directly — for anyone off-system, or a renter with no email on file:</p>
            <input
              className="w-full px-3 py-2 bg-surface2 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
              placeholder="name@example.com"
              type="email"
              value={rawEmail}
              onChange={e => setRawEmail(e.target.value)}
            />
          </div>
        )}

        {selectedRenter && !selectedRenter.email && (
          <p className="text-xs text-red mb-4">{selectedRenter.name} has no email on file — clear the selection above and type an address instead.</p>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-surface2 border border-border text-text-secondary rounded-lg text-sm font-medium hover:border-accent transition-colors">
            Cancel
          </button>
          <button onClick={send} disabled={!canSend || (!!selectedRenter && !selectedRenter.email)}
            className="flex-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
