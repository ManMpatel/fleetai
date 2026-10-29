import { useEffect, useRef } from 'react'

interface Props {
  plate: string
  renterName: string | null
  // How many days a deleted row waits in the Recycle bin. null = the server has no Recycle bin yet
  // (an older server): the row only comes off the table, and the text says so.
  days: number | null
  onCancel: () => void
  onConfirm: () => void
}

// "Are you sure?" before a row is deleted. Cancel has the focus, so Enter or a stray click never
// deletes by accident; Escape or a click outside closes it. Tab stays between the two buttons.
export default function DeleteRowDialog({ plate, renterName, days, onCancel, onConfirm }: Props) {
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

  const who = renterName ? ` (${renterName})` : ''

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-20 px-4" onClick={onCancel}>
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rt-del-title"
        aria-describedby="rt-del-text"
        className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md p-5"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="rt-del-title" className="text-[17px] font-bold text-text-primary">{days === null ? 'Take this row off the table?' : 'Delete this row?'}</h2>
        <div id="rt-del-text" className="mt-2 space-y-2 text-[13.5px] leading-[1.55] text-text-secondary">
          {days === null ? (
            <>
              <p><b className="text-text-primary">{plate}</b>{who} will come off the Rent Tracker.</p>
              <p>The car stays in Fleet and Rego Import. <span className="font-semibold text-green">The money you typed stays saved</span> and comes back if you add the plate again.</p>
            </>
          ) : (
            <>
              <p>
                <b className="text-text-primary">{plate}</b>{who} will go to the <b className="text-text-primary">Recycle bin</b> for {days} days. You can bring it back from there.
              </p>
              <p>The car stays in Fleet and Rego Import. <span className="font-semibold text-green">The money you typed stays saved.</span></p>
              <p>After {days} days the row is deleted for good.</p>
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2.5">
          <button ref={cancelRef} onClick={onCancel} className="h-[38px] rounded-[9px] border border-border bg-surface px-[18px] text-sm font-semibold text-text-secondary hover:bg-surface2">
            Cancel
          </button>
          <button onClick={onConfirm} className="h-[38px] rounded-[9px] border border-red bg-red px-[18px] text-sm font-semibold text-white hover:opacity-90">
            {days === null ? 'Take off' : 'Delete row'}
          </button>
        </div>
      </div>
    </div>
  )
}
