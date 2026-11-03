import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { useStore } from '../../store/useStore'
import CarPicker from './CarPicker'
import DeleteRowDialog from './DeleteRowDialog'
import RecycleBin from './RecycleBin'
import type { Bin, BinRow } from './RecycleBin'
import RentTable from './RentTable'
import RenterPicker from './RenterPicker'
import SendEmailsDialog from './SendEmailsDialog'
import { addMonths, money } from './format'
import type { CellValue, Grid, GridRow, Mail, MailRow, MoneyPair, RenterHit } from './types'

function withEntry(entries: Record<string, CellValue>, week: string, next: CellValue | null) {
  const copy = { ...entries }
  if (next) copy[week] = next
  else delete copy[week]
  return copy
}

// A cell with these days: money and ND stay as they are. A week with no money, no ND and 7 days has
// nothing to remember, so it has no cell value at all.
const withDays = (cur: CellValue | undefined, days: number): CellValue | null =>
  cur && (cur.amount != null || cur.nd) ? { ...cur, days } : days === 7 ? null : { amount: null, nd: false, days }

const patchRow = (id: string, patch: (r: GridRow) => GridRow) => (g: Grid): Grid => ({
  ...g,
  rows: g.rows.map(r => (r.vehicleId === id ? patch(r) : r)),
})

function Card({ title, main, sub, note }: { title: string; main: string; sub: string; note?: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3">
      <p className="text-xs font-medium text-text-muted">{title}</p>
      <p className="text-2xl font-bold text-text-primary mt-0.5">{main}</p>
      <p className="text-xs text-text-secondary mt-0.5">{sub}</p>
      {note && <p className="text-[11px] text-text-muted mt-0.5">{note}</p>}
    </div>
  )
}

const fromEarlier = (earlier: number) => (earlier > 0 ? `Includes ${money(earlier)} from earlier renters` : undefined)

const pill = 'px-3 py-2 rounded-lg text-sm font-medium border border-border bg-surface text-text-secondary hover:border-accent'
const barBtn = 'h-[34px] rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-surface px-3 text-[13px] font-semibold text-accent hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50'

// Emails go out one by one with a small pause (the email service allows only a few requests a second).
const MAIL_PAUSE_MS = 700

const binIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1" y="4" width="14" height="1.5" rx=".75" fill="currentColor" />
    <path d="M3.5 5.5l.75 8.25A1 1 0 005.25 15h5.5a1 1 0 001-.75L12.5 5.5H3.5z" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <path d="M6 5V3.5A.5.5 0 016.5 3h3a.5.5 0 01.5.5V5" stroke="currentColor" strokeWidth="1.3" />
    <line x1="6.5" y1="8" x2="6.5" y2="12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="9.5" y1="8" x2="9.5" y2="12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

export default function RentTrackerPage() {
  const allowed = useStore(s => !!s.session?.features?.rentTracker)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [end, setEnd] = useState<string | undefined>(undefined)
  const [months, setMonths] = useState<1 | 6>(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState<GridRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<GridRow | null>(null)
  const [binOpen, setBinOpen] = useState(false)
  const [bin, setBin] = useState<Bin | null>(null)
  // Overdue-rent emails: who can be emailed (from the server), the ticked rows, the rows that Select
  // overdue moved to the top, and the emails going out.
  const [mail, setMail] = useState<Mail | null>(null)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [pinned, setPinned] = useState<string[]>([])
  const [moves, setMoves] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [testing, setTesting] = useState(false)
  const [run, setRun] = useState<{ done: number; total: number; id: string | null } | null>(null)
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [mailMsg, setMailMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const view = useRef({ end, months })
  view.current = { end, months }
  const latest = useRef(0)
  const latestBin = useRef(0)
  const latestMail = useRef(0)
  const leaving = useRef(false)
  const busy = useRef(0)

  // An older server has no /overdue yet: then there are no tick boxes and the table looks as before.
  const loadMail = useCallback(async () => {
    const mine = ++latestMail.current
    try {
      const { data } = await axios.get<Mail>('/api/rent-tracker/overdue')
      if (mine === latestMail.current) setMail(data)
    } catch {
      if (mine === latestMail.current) setMail(null)
    }
  }, [])

  const load = useCallback(async (quiet = false) => {
    const mine = ++latest.current
    if (!quiet) setLoading(true)
    try {
      const { data } = await axios.get<Grid>('/api/rent-tracker/grid', { params: { month: view.current.end, months: view.current.months } })
      if (mine === latest.current) { setGrid(data); setError(''); loadMail() }
    } catch (err: any) {
      if (mine === latest.current) setError(err.response?.data?.error || 'Could not load the Rent Tracker')
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, [loadMail])

  const loadBin = useCallback(async () => {
    const mine = ++latestBin.current
    try {
      const { data } = await axios.get<Bin>('/api/rent-tracker/bin')
      if (mine === latestBin.current) setBin(data)
    } catch { /* bin is non-critical */ }
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, end, months, load])
  useEffect(() => { if (allowed) loadBin() }, [allowed, loadBin])

  // Leaving the page stops emails that have not gone out yet.
  useEffect(() => {
    leaving.current = false
    return () => { leaving.current = true }
  }, [])

  // A ticked row that can no longer be emailed (the renter paid, the email was removed ...) is unticked.
  useEffect(() => {
    if (!mail) return
    const ok = new Set(mail.rows.filter(r => r.canSend).map(r => r.vehicleId))
    setPicked(prev => {
      const keep = Array.from(prev).filter(id => ok.has(id))
      return keep.length === prev.size ? prev : new Set(keep)
    })
    setPinned(prev => {
      const keep = prev.filter(id => ok.has(id))
      return keep.length === prev.length ? prev : keep
    })
  }, [mail])

  // Every change is shown at once, sent to the server, and the table is reloaded when the last
  // pending save is done (so the totals always come from the server).
  async function save(request: () => Promise<unknown>, optimistic?: (g: Grid) => Grid) {
    busy.current++
    if (optimistic) setGrid(g => (g ? optimistic(g) : g))
    try {
      await request()
      setNotice('')
    } catch (err: any) {
      setNotice(err.response?.data?.error || 'Could not save - please try again')
    } finally {
      busy.current--
      if (busy.current === 0) load(true)
    }
  }

  // Sends only the amount/ND fields; the days field is preserved on the server.
  const onCell = (row: GridRow, week: string, next: CellValue | null) =>
    save(
      () => axios.put('/api/rent-tracker/entry', { vehicleId: row.vehicleId, weekStart: week, amount: next ? next.amount : null, nd: next?.nd ? true : undefined, renterId: row.renter?._id }),
      patchRow(row.vehicleId, r => ({ ...r, entries: withEntry(r.entries, week, next) })),
    )
  const onDays = (row: GridRow, week: string, days: number) =>
    save(
      () => axios.put('/api/rent-tracker/entry', { vehicleId: row.vehicleId, weekStart: week, days, renterId: row.renter?._id }),
      patchRow(row.vehicleId, r => ({ ...r, entries: withEntry(r.entries, week, withDays(r.entries[week], days)) })),
    )
  const onRent = (row: GridRow, value: number) =>
    save(() => axios.put(`/api/rent-tracker/row/${row.vehicleId}`, { weeklyRent: value }), patchRow(row.vehicleId, r => ({ ...r, weeklyRent: value })))
  const onStart = (row: GridRow, week: string) =>
    save(() => axios.put(`/api/rent-tracker/row/${row.vehicleId}`, { startWeek: week }), patchRow(row.vehicleId, r => ({ ...r, startWeek: week, startIsCustom: true })))

  // Giving a car to a renter, or taking it back, uses the same Fleet actions as the Renters page.
  async function assign(row: GridRow, hit: RenterHit) {
    setPicking(null)
    if (row.renter && !window.confirm(`Give ${row.plate} to ${hit.name}? ${row.renter.name} will no longer have this car, and the row starts empty for ${hit.name}. ${row.renter.name}'s money stays in History.`)) return
    await save(() => axios.post(`/api/fleet/${encodeURIComponent(row.plate)}/assign`, { renterId: hit._id }))
  }
  async function returned(row: GridRow) {
    if (!window.confirm(`Mark ${row.plate} as returned? The car becomes Available in Fleet and the Owing for ${row.renter?.name} stops counting. ${row.renter?.name}'s money stays in History.`)) return
    await save(() => axios.post(`/api/fleet/${encodeURIComponent(row.plate)}/unassign`))
  }
  // Taking a car off the table sends it to the Recycle bin (stays there 30 days).
  async function removeCar(row: GridRow) {
    setDeleting(null)
    await save(() => axios.delete(`/api/rent-tracker/cars/${row.vehicleId}`), g => ({ ...g, rows: g.rows.filter(r => r.vehicleId !== row.vehicleId) }))
    loadBin()
  }
  async function restoreRow(binRow: BinRow): Promise<string> {
    try {
      await axios.post(`/api/rent-tracker/bin/${binRow.vehicleId}/restore`)
      load(true)
      loadBin()
      return ''
    } catch (err: any) {
      return err.response?.data?.error || 'Could not restore - please try again'
    }
  }

  if (!allowed) {
    return <div className="flex-1 flex items-center justify-center p-8 text-sm text-text-muted">Rent Tracker is not available for this account.</div>
  }

  const q = query.trim().toLowerCase()
  const compact = q.replace(/[\s()-]/g, '')
  const rows = !grid ? [] : !q ? grid.rows : grid.rows.filter(r =>
    r.plate.toLowerCase().includes(q) || r.plate.toLowerCase().replace(/[\s-]/g, '').includes(compact) ||
    r.model.toLowerCase().includes(q) ||
    (!!r.renter && (r.renter.name.toLowerCase().includes(q) || r.renter.email.toLowerCase().includes(q) ||
      (compact !== '' && r.renter.phone.replace(/[\s()-]/g, '').includes(compact)))))

  // ---- overdue-rent emails ----
  // overdueIds = renters who can be emailed and were not emailed today (what Select overdue ticks).
  // The rows Select overdue moved to the top stay there until Clear or until their email is sent.
  const mailBy: Record<string, MailRow> = {}
  if (mail) for (const r of mail.rows) mailBy[r.vehicleId] = r
  const overdueIds = mail ? mail.rows.filter(r => r.canSend && !r.emailedAt).map(r => r.vehicleId) : []
  const pinSet = new Set(pinned)
  const pinFirst = (list: GridRow[]) => (pinSet.size === 0 ? list : [...list.filter(r => pinSet.has(r.vehicleId)), ...list.filter(r => !pinSet.has(r.vehicleId))])
  const shown = pinFirst(rows)
  const pickedRows = pinFirst(grid ? grid.rows : []).filter(r => picked.has(r.vehicleId))

  const toggleMail = (row: GridRow) => {
    setMailMsg(null)
    setPicked(prev => {
      const next = new Set(prev)
      if (!next.delete(row.vehicleId)) next.add(row.vehicleId)
      return next
    })
    setFailed(f => {
      if (!(row.vehicleId in f)) return f
      const rest = { ...f }
      delete rest[row.vehicleId]
      return rest
    })
  }
  function selectOverdue() {
    setMailMsg(null)
    setFailed({})
    setPicked(prev => new Set(Array.from(prev).concat(overdueIds)))
    setPinned(overdueIds)
    setMoves(n => n + 1)
  }
  function clearPicked() {
    setPicked(new Set())
    setPinned([])
    setFailed({})
    setMailMsg(null)
  }

  // One test email, for the first ticked row, to the owner's own login email. The renter is not emailed.
  async function sendTest() {
    const first = pickedRows[0]
    if (!first || testing || run) return
    setTesting(true)
    setMailMsg(null)
    try {
      const { data } = await axios.post<{ to: string }>('/api/rent-tracker/email/test', { vehicleId: first.vehicleId })
      setMailMsg({ kind: 'ok', text: `Test email for ${first.plate} sent to ${data.to}. Look in that inbox (and Spam).` })
    } catch (err: any) {
      setMailMsg({ kind: 'err', text: err.response?.data?.error || 'Could not send the test email' })
    } finally {
      setTesting(false)
    }
  }

  // The real emails: one request per renter, one after the other. A row that went out is unticked; a row that
  // did not stays ticked with the reason under the renter's name.
  async function sendAll() {
    setConfirming(false)
    const ids = pickedRows.map(r => r.vehicleId)
    if (ids.length === 0 || run) return
    setMailMsg(null)
    setFailed({})
    let sentCount = 0
    let failCount = 0
    for (let i = 0; i < ids.length; i++) {
      if (leaving.current) return
      const id = ids[i]
      setRun({ done: i, total: ids.length, id })
      try {
        const { data } = await axios.post<{ emailedAt: string }>('/api/rent-tracker/email/send', { vehicleId: id })
        sentCount++
        setMail(m => (m ? { ...m, rows: m.rows.map(r => (r.vehicleId === id ? { ...r, emailedAt: data.emailedAt } : r)) } : m))
        setPicked(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setPinned(prev => prev.filter(x => x !== id))
      } catch (err: any) {
        failCount++
        const why = err.response?.data?.error || 'Could not send - please try again'
        setFailed(f => ({ ...f, [id]: why }))
      }
      if (i + 1 < ids.length) await new Promise(resolve => setTimeout(resolve, MAIL_PAUSE_MS))
    }
    setRun(null)
    setMailMsg(failCount === 0
      ? { kind: 'ok', text: `Sent ${sentCount} email${sentCount === 1 ? '' : 's'}.` }
      : { kind: 'err', text: `Sent ${sentCount}, not sent ${failCount}. The rows that did not go out are still ticked and say why.` })
    loadMail()
  }

  // Arrows move from the month asked for last, so quick clicks add up while the table is still loading.
  const shownEnd = end ?? grid?.window.end
  const first = grid?.groups[0]
  const last = grid?.groups[grid.groups.length - 1]
  const onThisMonth = !!grid && grid.window.end === grid.today.slice(0, 7)
  const endPair: MoneyPair | undefined = grid && last ? grid.totals.months[last.month] : undefined

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      <div className="px-6 py-5 border-b border-border bg-surface">
        <h1 className="text-xl font-bold text-text-primary">Rent Tracker</h1>
        <p className="text-text-muted text-sm mt-0.5">Type the rent you receive each week. Empty = not paid, 0 = no reminder this week, ND = no rent due. Click the arrow to set days and see the running balance.</p>
      </div>

      <div className="px-6 py-5 space-y-4">
        {grid && endPair && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card title="This week" main={money(grid.totals.thisWeek.received)} sub={`Expected ${money(grid.totals.thisWeek.expected)}`} note={fromEarlier(grid.totals.thisWeek.earlier)} />
            <Card title={onThisMonth ? 'This month' : last!.label} main={money(endPair.received)} sub={`Expected ${money(endPair.expected)}`} note={fromEarlier(endPair.earlier)} />
            <Card title="Overall" main={money(grid.totals.overall.received)} sub={`Expected ${money(grid.totals.overall.expected)} - Owing ${money(grid.totals.overall.owing)}`} note={fromEarlier(grid.totals.overall.earlier)} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search plate, name, mobile or email"
            aria-label="Search cars"
            className="w-72 px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90">+ Add number plate</button>
          <button onClick={() => { setBinOpen(true); loadBin() }} className={`${pill} flex items-center gap-1.5`} aria-label="Open recycle bin">{binIcon} Recycle bin{bin && bin.rows.length > 0 ? ` (${bin.rows.length})` : ''}</button>
          {mail && (
            <button
              onClick={selectOverdue}
              disabled={overdueIds.length === 0 || !!run}
              title={overdueIds.length === 0 ? 'Nobody to email: no one is overdue with an email saved, or they were all emailed today' : 'Tick every overdue renter who has an email, and move them to the top'}
              className={`${pill} disabled:cursor-not-allowed disabled:opacity-50 ${overdueIds.length > 0 && !run ? '!border-accent !bg-accent-bg !font-semibold !text-accent' : ''}`}
            >
              Select overdue ({overdueIds.length})
            </button>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <button aria-label="Previous month" disabled={!shownEnd} onClick={() => shownEnd && setEnd(addMonths(shownEnd, -1))} className={pill}>&lt;</button>
            <span className="min-w-[230px] px-2 text-center text-sm font-semibold text-text-primary">
              {first && last ? (first === last ? first.label : `${first.label} - ${last.label}`) : '...'}
            </span>
            <button aria-label="Next month" disabled={!shownEnd} onClick={() => shownEnd && setEnd(addMonths(shownEnd, 1))} className={pill}>&gt;</button>
          </div>
          {grid && !onThisMonth && <button onClick={() => setEnd(undefined)} className={pill}>This month</button>}
          <button aria-pressed={months === 6} onClick={() => setMonths(months === 6 ? 1 : 6)} className={`${pill} ${months === 6 ? '!border-accent !text-accent' : ''}`}>
            {months === 6 ? 'Back to one month' : 'Last 6 months'}
          </button>
        </div>

        {notice && <p role="alert" className="text-sm text-red">{notice}</p>}
        {error && (
          <p role="alert" className="text-sm text-red">
            {error} <button onClick={() => load()} className="underline">Try again</button>
          </p>
        )}

        {mail && (picked.size > 0 || !!run || !!mailMsg) && (
          <div role="region" aria-label="Overdue-rent emails" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-accent-bg px-4 py-2.5">
            {run ? (
              <span role="status" className="text-sm font-semibold text-accent">Sending email {Math.min(run.done + 1, run.total)} of {run.total}... Please stay on this page.</span>
            ) : picked.size > 0 ? (
              <span className="text-sm font-semibold text-accent">
                {picked.size} selected{pinned.length > 0 && <span className="ml-1.5 font-normal text-text-secondary">(the overdue renters are at the top)</span>}
              </span>
            ) : null}
            {mailMsg && <span role="status" className={`text-sm ${mailMsg.kind === 'ok' ? 'text-green' : 'text-red'}`}>{mailMsg.text}</span>}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button onClick={clearPicked} disabled={!!run} className={barBtn}>Clear</button>
              <button
                onClick={sendTest}
                disabled={!!run || testing || picked.size === 0}
                title={`Sends one test email for the first ticked row to ${mail.replyTo}. The renter is not emailed.`}
                className={barBtn}
              >
                {testing ? 'Sending test...' : 'Send me a test'}
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={!!run || testing || picked.size === 0}
                className="h-[34px] rounded-lg border border-accent bg-accent px-3.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send emails ({picked.size})
              </button>
            </div>
          </div>
        )}

        {!grid && loading && <p className="text-sm text-text-muted">Loading...</p>}
        {grid && grid.rows.length === 0 && <p className="text-sm text-text-muted">No cars yet. Click Add number plate to choose the cars you want to track.</p>}
        {grid && grid.rows.length > 0 && rows.length === 0 && (
          <p className="text-sm text-text-muted">No car in the tracker matches "{query.trim()}". Click Add number plate.</p>
        )}
        {grid && rows.length > 0 && (
          <div className={loading ? 'opacity-60' : ''}>
            <RentTable
              grid={grid}
              rows={shown}
              onCell={onCell}
              onRent={onRent}
              onStart={onStart}
              onPickRenter={setPicking}
              onReturned={returned}
              onRemove={setDeleting}
              onDays={onDays}
              mail={mail ? { info: mailBy, selected: picked, sendingId: run?.id ?? null, busy: !!run || testing, failed, tz: grid.tz, scrollTop: moves, onToggle: toggleMail } : undefined}
            />
          </div>
        )}
      </div>

      {adding && <CarPicker onAdded={() => load(true)} onClose={() => { setAdding(false); load(true) }} />}

      {picking && (
        <RenterPicker
          plate={picking.plate}
          currentRenterId={picking.renter?._id ?? null}
          onPick={hit => assign(picking, hit)}
          onClose={() => setPicking(null)}
        />
      )}

      {deleting && (
        <DeleteRowDialog
          plate={deleting.plate}
          renterName={deleting.renter?.name ?? null}
          days={bin ? bin.days : null}
          onCancel={() => setDeleting(null)}
          onConfirm={() => removeCar(deleting)}
        />
      )}

      {confirming && mail && (
        <SendEmailsDialog
          items={pickedRows.map(r => ({ vehicleId: r.vehicleId, plate: r.plate, name: r.renter?.name ?? '', owing: mailBy[r.vehicleId]?.owing ?? r.owing, emailedToday: !!mailBy[r.vehicleId]?.emailedAt }))}
          business={mail.business}
          replyTo={mail.replyTo}
          onCancel={() => setConfirming(false)}
          onConfirm={sendAll}
        />
      )}

      {binOpen && bin && (
        <RecycleBin
          bin={bin}
          onRestore={restoreRow}
          onClose={() => setBinOpen(false)}
        />
      )}
    </div>
  )
}
