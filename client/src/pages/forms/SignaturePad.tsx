import { useEffect, useRef } from 'react'

// A box to sign in with a finger or a mouse. The picture is a small PNG (see-through background) that
// is handed to onChange when a stroke ends; Clear hands back an empty string.

const W = 600
const H = 180

interface Props {
  id?: string
  /** The PNG data URL, or '' when nothing is drawn. Setting it to '' from outside wipes the box. */
  value: string
  onChange: (png: string) => void
  tone?: 'public' | 'app'
  invalid?: boolean
  describedBy?: string
}

export default function SignaturePad({ id, value, onChange, tone = 'public', invalid, describedBy }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!value) canvas.current?.getContext('2d')?.clearRect(0, 0, W, H)
  }, [value])

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvas.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height }
  }

  function style(ctx: CanvasRenderingContext2D) {
    ctx.lineWidth = 3.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    ctx.fillStyle = '#111827'
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = point(e)
    last.current = p
    style(ctx)
    ctx.beginPath()
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvas.current?.getContext('2d')
    if (!ctx || !last.current) return
    const p = point(e)
    style(ctx)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }

  function up() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    if (canvas.current) onChange(canvas.current.toDataURL('image/png'))
  }

  const frame = tone === 'public'
    ? `bg-gray-50 ${invalid ? 'border-[#ef4444]' : 'border-gray-300'} text-gray-400`
    : `bg-surface2 ${invalid ? 'border-red' : 'border-border'} text-text-muted`
  const clear = tone === 'public'
    ? 'min-h-[44px] px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:border-indigo-400'
    : 'px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-text-secondary hover:border-accent'

  return (
    <div>
      <div className={`relative border-2 border-dashed rounded-xl overflow-hidden ${frame}`}>
        <canvas
          id={id}
          ref={canvas}
          width={W}
          height={H}
          role="img"
          aria-label={value ? 'Your signature' : 'Signature box: draw your signature here'}
          aria-describedby={describedBy}
          className="block w-full h-auto"
          style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        {!value && <p className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none select-none">Sign here with your finger</p>}
      </div>
      <div className="mt-2">
        <button type="button" onClick={() => onChange('')} disabled={!value} className={`${clear} disabled:opacity-40`}>Clear signature</button>
      </div>
    </div>
  )
}
