import { useState, useRef } from 'react'
import axios from 'axios'
import { useStore } from '../store/useStore'

interface RegoResult {
  filename: string
  status: 'ok' | 'unclear' | 'error'
  data: {
    plate: string
    make: string
    model: string
    year: string
    regoExpiry: string
    vin: string
    confident: boolean
  } | null
  edited?: boolean
  saved?: boolean
}

export default function RegoImportPage() {
  const { fetchVehicles } = useStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [results, setResults] = useState<RegoResult[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [savedCount, setSavedCount] = useState(0)
  const [toast, setToast] = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setProcessing(true)
    setProgress(0)
    setResults([])
    setSavedCount(0)

    // Process in batches of 10 to avoid request size limits
    const batchSize = 10
    const allResults: RegoResult[] = []

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)

      const encoded = await Promise.all(batch.map(async file => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = ev => {
            const result = ev.target?.result as string
            resolve(result.split(',')[1])
          }
          reader.readAsDataURL(file)
        })
        return { name: file.name, base64, mimeType: file.type || 'application/pdf' }
      }))

      try {
        const { data } = await axios.post('/api/upload/read-rego-bulk', { files: encoded })
        allResults.push(...data.results)
      } catch {
        batch.forEach(f => allResults.push({ filename: f.name, status: 'error', data: null }))
      }

      setProgress(Math.round(((i + batch.length) / files.length) * 100))
      setResults([...allResults])
    }

    setProcessing(false)
  }

  function updateResult(index: number, field: string, value: string) {
    setResults(prev => prev.map((r, i) => i === index ? {
      ...r,
      edited: true,
      data: r.data ? { ...r.data, [field]: value } : r.data
    } : r))
  }

  async function saveVehicle(index: number) {
    const r = results[index]
    if (!r.data?.plate || !r.data?.regoExpiry) {
      showToast('❌ Plate and rego expiry are required')
      return
    }
    setSaving(p => ({ ...p, [index]: true }))
    try {
      const res = await axios.post('/api/fleet', {
        plate: r.data.plate.toUpperCase(),
        model: `${r.data.make} ${r.data.model}`.trim() || 'Unknown',
        year: parseInt(r.data.year) || new Date().getFullYear(),
        type: 'car',
        status: 'available',
        regoExpiry: r.data.regoExpiry,
      })
      const wasUpdated = res.data._updated
      setResults(prev => prev.map((item, i) => i === index ? { ...item, saved: true, wasUpdated } : item))
      setSavedCount(p => p + 1)
      fetchVehicles()
      showToast(`${wasUpdated ? '🔄' : '✅'} ${r.data.plate} ${wasUpdated ? 'rego expiry updated' : 'added to fleet'}`)
    } catch (err: any) {
      showToast(`❌ ${err.response?.data?.error || 'Failed to save'}`)
    } finally {
      setSaving(p => ({ ...p, [index]: false }))
    }
  }

  async function saveAll() {
    const toSave = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === 'ok' && !r.saved && r.data?.plate && r.data?.regoExpiry)

    for (const { i } of toSave) {
      await saveVehicle(i)
      await new Promise(res => setTimeout(res, 300))
    }
  }

  const okCount = results.filter(r => r.status === 'ok').length
  const unclearCount = results.filter(r => r.status === 'unclear').length
  const errorCount = results.filter(r => r.status === 'error').length

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text-primary shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-surface">
        <h1 className="text-xl font-bold text-text-primary">Rego bulk import</h1>
        <p className="text-text-muted text-sm mt-0.5">Upload rego PDFs — Gemini reads each one automatically</p>
      </div>

      <div className="px-6 py-6 max-w-5xl w-full mx-auto space-y-6">

        {/* Upload zone */}
        {!processing && results.length === 0 && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer hover:border-accent transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-12 h-12 text-text-muted mx-auto mb-4">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p className="text-text-primary font-medium mb-1">Click to upload rego PDFs</p>
            <p className="text-text-muted text-sm">Select all 300 at once — processed automatically</p>
            <p className="text-text-muted text-xs mt-2">~4 seconds per file due to Gemini rate limits</p>
            <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple onChange={handleFiles} className="hidden" />
          </div>
        )}

        {/* Processing progress */}
        {processing && (
          <div className="bg-surface border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-text-primary">Reading rego papers with Gemini...</p>
              <span className="text-sm text-accent font-semibold">{progress}%</span>
            </div>
            <div className="w-full bg-surface2 rounded-full h-2 mb-3">
              <div className="bg-accent h-2 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-text-muted">{results.length} processed so far — please keep this page open</p>
          </div>
        )}

        {/* Summary bar */}
        {results.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex gap-3">
              <span className="text-xs bg-green-bg text-green px-3 py-1.5 rounded-full font-medium">{okCount} ready</span>
              {unclearCount > 0 && <span className="text-xs bg-amber-bg text-amber px-3 py-1.5 rounded-full font-medium">{unclearCount} unclear</span>}
              {errorCount > 0 && <span className="text-xs bg-red-bg text-red px-3 py-1.5 rounded-full font-medium">{errorCount} failed</span>}
              {savedCount > 0 && <span className="text-xs bg-accent-bg text-accent px-3 py-1.5 rounded-full font-medium">{savedCount} saved</span>}
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setResults([]); setSavedCount(0) }}
                className="px-4 py-2 text-xs border border-border rounded-lg text-text-muted hover:text-text-primary">
                Clear & start over
              </button>
              {okCount > 0 && (
                <button onClick={saveAll}
                  className="px-4 py-2 text-xs bg-accent text-white rounded-lg font-medium hover:bg-accent/90">
                  Save all {okCount} to fleet
                </button>
              )}
            </div>
          </div>
        )}

        {/* Results table */}
        {results.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface2 text-xs text-text-muted uppercase tracking-wide">
                    <th className="text-left px-4 py-3">File</th>
                    <th className="text-left px-4 py-3">Plate</th>
                    <th className="text-left px-4 py-3">Make & model</th>
                    <th className="text-left px-4 py-3">Year</th>
                    <th className="text-left px-4 py-3">Rego expiry</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.map((r, i) => (
                    <tr key={i} className={r.saved ? 'opacity-50' : ''}>
                      <td className="px-4 py-3 text-xs text-text-muted max-w-[120px] truncate">{r.filename}</td>

                      {r.status === 'error' || !r.data ? (
                        <td colSpan={4} className="px-4 py-3 text-xs text-red">
                          Could not read — upload manually
                        </td>
                      ) : (
                        <>
                          <td className="px-4 py-3">
                            <input value={r.data.plate} onChange={e => updateResult(i, 'plate', e.target.value)}
                              className="font-mono font-semibold text-accent bg-transparent border-b border-transparent hover:border-border focus:border-accent focus:outline-none w-24 uppercase" />
                          </td>
                          <td className="px-4 py-3">
                            <input value={`${r.data.make} ${r.data.model}`}
                              onChange={e => updateResult(i, 'make', e.target.value)}
                              className="text-text-secondary bg-transparent border-b border-transparent hover:border-border focus:border-accent focus:outline-none w-36" />
                          </td>
                          <td className="px-4 py-3">
                            <input value={r.data.year} onChange={e => updateResult(i, 'year', e.target.value)}
                              className="text-text-secondary bg-transparent border-b border-transparent hover:border-border focus:border-accent focus:outline-none w-16" />
                          </td>
                          <td className="px-4 py-3">
                            <input type="date" value={r.data.regoExpiry} onChange={e => updateResult(i, 'regoExpiry', e.target.value)}
                              className="text-text-secondary bg-transparent border-b border-transparent hover:border-border focus:border-accent focus:outline-none" />
                          </td>
                        </>
                      )}

                      <td className="px-4 py-3">
                        {r.saved ? (
                          <span className="text-xs text-green font-medium">{(r as any).wasUpdated ? '🔄 Updated' : '✓ Added'}</span>
                        ) : r.status === 'unclear' ? (
                          <span className="text-xs bg-amber-bg text-amber px-2 py-0.5 rounded-full">Check fields</span>
                        ) : r.status === 'error' ? (
                          <span className="text-xs bg-red-bg text-red px-2 py-0.5 rounded-full">Failed</span>
                        ) : (
                          <span className="text-xs bg-green-bg text-green px-2 py-0.5 rounded-full">Ready</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {!r.saved && r.data?.plate && (
                          <button onClick={() => saveVehicle(i)} disabled={saving[i]}
                            className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg disabled:opacity-50">
                            {saving[i] ? '...' : 'Save'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}