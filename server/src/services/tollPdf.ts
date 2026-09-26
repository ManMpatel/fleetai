import { PDFDocument } from 'pdf-lib'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, writeFile, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const execFileAsync = promisify(execFile)

// PDF utilities for TollBatch — two directions:
//   rasterizePdf: the incoming scanner PDF — one PNG per page, for Gemini to read.
//   mergeImagesToPdf: one folder's page images — a single PDF, for email/download.
//
// Rasterization shells out to poppler-utils' pdftoppm (a system binary — see Dockerfile)
// instead of the old pdf.js-based pdf-to-img. pdf.js cannot decode JBig2-compressed
// images, a very common compression format for B&W pages from office scanners/
// photocopiers — it was silently rendering those pages blank, which Gemini then
// correctly reported as unreadable. Poppler uses the same rendering engine as most PDF
// viewers and handles JBig2/CCITT/JPEG2000 correctly. A native-canvas npm rasterizer was
// avoided earlier only because it failed to build in this environment — poppler sidesteps
// that entirely since it installs as a prebuilt system package, not an npm native module.

export interface RasterizedPage {
  pageNumber: number
  imageBase64: string
  mimeType: 'image/jpeg'
}

/** Rasterizes every page of a scanned PDF into a JPEG, 1-indexed to match how pages are numbered on screen. */
export async function rasterizePdf(pdfBuffer: Buffer): Promise<RasterizedPage[]> {
  const workDir = await mkdtemp(join(tmpdir(), 'tollbatch-'))
  const inputPath = join(workDir, 'input.pdf')
  const outPrefix = join(workDir, 'page')

  try {
    await writeFile(inputPath, pdfBuffer)

    // 150 DPI matches this app's previous effective resolution (the old scale:2 setting)
    // and is already above what Gemini's own vision tiling uses — higher just costs more
    // memory and upload size for zero OCR benefit on a printed toll notice.
    try {
      await execFileAsync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=80', '-r', '150', inputPath, outPrefix])
    } catch (err: any) {
      const detail = err.stderr?.toString().trim() || err.message
      throw new Error(`pdftoppm failed to rasterize this PDF: ${detail}`)
    }

    // pdftoppm zero-pads the page number in each filename to match the page count's digit
    // width (page-1.png / page-01.png / page-001.png…), so a plain alphabetical sort
    // already puts the files back in true page order.
    const files = (await readdir(workDir))
      .filter(f => f.startsWith('page') && f.endsWith('.jpg'))
      .sort()

    const pages: RasterizedPage[] = []
    for (let i = 0; i < files.length; i++) {
      const imageBuffer = await readFile(join(workDir, files[i]))
      pages.push({ pageNumber: i + 1, imageBase64: imageBuffer.toString('base64'), mimeType: 'image/jpeg' })
    }
    return pages
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/** Merges a folder's page images (in page order) into one PDF, ready to attach or download. */
export async function mergeImagesToPdf(pageImagesBase64: string[]): Promise<Buffer> {
  const out = await PDFDocument.create()

  for (const base64 of pageImagesBase64) {
    const bytes = Buffer.from(base64, 'base64')
    const image = await out.embedJpg(bytes)
    const page = out.addPage([image.width, image.height])
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }

  const bytes = await out.save()
  return Buffer.from(bytes)
}
