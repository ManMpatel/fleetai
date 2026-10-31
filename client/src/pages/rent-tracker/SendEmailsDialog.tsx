import { useEffect, useRef } from 'react'
import { money } from './format'

export interface SendItem {
  vehicleId: string
  plate: string
  name: string
  owing: number
  emailedToday: boolean
}

interface Props {
  items: SendItem[]
  business: string   // the name the emails go out under
  replyTo: string    // where replies come to
  onCancel: () => void
  onConfirm: () => void
}

// "Send these emails?" before anything goes out. Cancel has the focus, so Enter or a stray click never
// sends by accident; Escape or a click outside closes it. Tab stays between the two buttons.
export default function SendEmailsDialog({ items, business, replyTo, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const close = useRef(onCancel)
  close.current = onCancel

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return }
      if (e.key !== 'Tab' || !boxRef.current) return
      const buttons = Array.from(boxRef.current.querySelectorAll<HTMLButtonElement>('button'))
      if (buttons.length === 0) return
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // back to the button that opened this window (when it is still on the page)
      if (before && document.contains(before)) before.focus()
    }
  }, [])

  const n = items.length
  const again = items.filter(i => i.emailedToday).length
  const total = items.reduce((sum, i) => sum + Math.round(i.owing * 100), 0) / 100

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-20 px-4" onClick={onCancel}>
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rt-mail-title"
        aria-describedby="rt-mail-text"
        className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md p-5"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="rt-mail-title" className="text-[17px] font-bold text-text-primary">Send {n} overdue-rent email{n === 1 ? '' : 's'}?</h2>
        <div id="rt-mail-text" className="mt-2 space-y-2 text-[13.5px] leading-[1.55] text-text-secondary">
          <p>
            Each renter gets one email about their own overdue rent, sent as <b className="text-text-primary">{business}</b>.
            Replies come to <b className="text-text-primary">{replyTo}</b>.
          </p>
          <ul className="max-h-52 overflow-auto rounded-lg border border-border divide-y divide-border">
            {items.map(i => (
              <li key={i.vehicleId} className="flex items-baseline gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono font-semibold text-text-primary">{i.plate}</span> {i.name}
                  {i.emailedToday && <span className="ml-1.5 text-[11px] font-semibold text-amber">emailed today</span>}
                </span>
                <span className="font-semibold tabular-nums text-red">{money(i.owing)}</span>
              </li>
            ))}
          </ul>
          <p>Total overdue: <b className="text-text-primary">{money(total)}</b></p>
          {again > 0 && (
            <p className="font-semibold text-amber">
              {again === n ? (n === 1 ? 'This renter' : 'All of them') : `${again} of them`} already got an email today. They will get another one.
            </p>
          )}
          <p>The amounts are worked out again when each email is sent. Please stay on this page until it finishes.</p>
        </div>
        <div className="mt-4 flex justify-end gap-2.5">
          <button ref={cancelRef} onClick={onCancel} className="h-[38px] rounded-[9px] border border-border bg-surface px-[18px] text-sm font-semibold text-text-secondary hover:bg-surface2">
            Cancel
          </button>
          <button onClick={onConfirm} className="h-[38px] rounded-[9px] border border-accent bg-accent px-[18px] text-sm font-semibold text-white hover:opacity-90">
            Send {n} email{n === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
