// Shrinks a photo taken on a phone before it is sent, so a form with a dozen pictures still uploads
// quickly on mobile data. The longest side becomes at most 1600 px and the picture is saved as a
// JPEG; if that is still big, a smaller size / lower quality is tried.

const LADDER: Array<[number, number]> = [[1600, 0.8], [1400, 0.7], [1200, 0.6], [1000, 0.5], [800, 0.5]]
/** A picture this size or smaller stops the ladder (characters of the data URL, about 670 KB). */
const TARGET_CHARS = 900_000
/** The server refuses a picture over 3,000,000 characters. */
const HARD_LIMIT_CHARS = 2_900_000
const MAX_FILE_BYTES = 40 * 1024 * 1024

type Source = ImageBitmap | HTMLImageElement

async function decode(file: File): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    } catch { /* an older browser: use an <img> below */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('read'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function sizeOf(src: Source): { w: number; h: number } {
  return src instanceof HTMLImageElement ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height }
}

function draw(src: Source, side: number, quality: number): string {
  const { w, h } = sizeOf(src)
  const scale = Math.min(1, side / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('read')
  ctx.fillStyle = '#ffffff' // a see-through PNG would turn black as a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  const out = canvas.toDataURL('image/jpeg', quality)
  if (!out.startsWith('data:image/jpeg')) throw new Error('read')
  return out
}

/** The photo as a small JPEG data URL. Throws an Error whose message can be shown to the person. */
export async function photoToDataUrl(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error('That photo is too big. Please choose a smaller one.')
  if (file.type && !file.type.startsWith('image/')) throw new Error('Please choose a photo (a picture file).')
  let src: Source
  try {
    src = await decode(file)
  } catch {
    throw new Error('That photo could not be read. Try taking it again, or choose a different one.')
  }
  try {
    let best = ''
    for (const [side, quality] of LADDER) {
      best = draw(src, side, quality)
      if (best.length <= TARGET_CHARS) break
    }
    if (best.length > HARD_LIMIT_CHARS) throw new Error('That photo is too big to send. Try a smaller one.')
    return best
  } catch (err: any) {
    if (err && err.message && err.message !== 'read') throw err
    throw new Error('That photo could not be read. Try taking it again, or choose a different one.')
  } finally {
    if (typeof (src as ImageBitmap).close === 'function') (src as ImageBitmap).close()
  }
}