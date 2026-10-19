import { PDFDocument } from 'pdf-lib'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number }>
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

/**
 * Extracts the text layer from every page of a PDF — instant and exact for digital
 * PDFs (WestConnex, Linkt notices are computer-generated, not scanned). Returns an
 * empty map if the PDF has no text layer (scanned image PDFs), so callers can
 * fall back to Gemini vision without any extra error handling.
 */
export async function extractPageTexts(pdfBuffer: Buffer): Promise<Map<number, string>> {
  const pageTexts: string[] = []
  try {
    await pdfParse(pdfBuffer, {
      // Called once per page in document order; return value becomes the page's text.
      pagerender: async (pageData: any): Promise<string> => {
        try {
          const content = await pageData.getTextContent()
          const text = (content.items as any[]).map(item => (item.str as string) + ' ').join('')
          pageTexts.push(text)
          return text
        } catch {
          pageTexts.push('')
          return ''
        }
      },
    } as any)
  } catch {
    // Scanned PDF, encrypted, or malformed — return empty so caller falls back to Gemini.
  }
  const result = new Map<number, string>()
  pageTexts.forEach((text, idx) => { if (text.trim()) result.set(idx + 1, text) })
  return result
}

export interface RasterizedPage {
  pageNumber: number
  imageBase64: string
  mimeType: 'image/jpeg'
}

/** Returns the total page count without rasterizing — cheap even for large PDFs. */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer, { updateMetadata: false })
  return doc.getPageCount()
}

// Every page is rendered to this many pixels on its long side. 2339 px is an A4 page at
// 200 DPI, so ordinary scans come out exactly as they always did (at 150 DPI a 10pt font is
// only ~21px tall — borderline for OCR on the dense "Licence plate number:" field in
// WestConnex/Linkt notices; 200 DPI puts it at ~28px).
//
// Rendering at a fixed DPI made the image size depend on the PDF's page size in points. A PDF
// with 1654 x 2339 pt pages (our own downloaded folder PDFs are built that way)
// came out at 4595 x 6498 px (~30 megapixels), which Gemini rejects with
// "400 Bad Request: Unable to process input image" — so every page silently landed in
// Unrecognized. Capping the pixel size gives Gemini (and the stored copy) the same page
// whatever size the PDF declares.
const RASTER_LONG_SIDE_PX = 2339

/**
 * Rasterizes a range of pages from a PDF already written to disk.
 * Callers write the PDF once, call this in a loop with different ranges, and let each
 * batch's images be GC'd before the next call — peak memory stays bounded to one batch.
 */
export async function rasterizePdfBatch(inputPath: string, firstPage: number, lastPage: number): Promise<RasterizedPage[]> {
  const workDir = await mkdtemp(join(tmpdir(), 'tollbatch-'))
  const outPrefix = join(workDir, 'page')
  try {
    try {
      await execFileAsync('pdftoppm', [
        '-jpeg', '-jpegopt', 'quality=85', '-scale-to', String(RASTER_LONG_SIDE_PX),
        '-f', String(firstPage), '-l', String(lastPage),
        inputPath, outPrefix,
      ])
    } catch (err: any) {
      const detail = err.stderr?.toString().trim() || err.message
      throw new Error(`pdftoppm failed on pages ${firstPage}-${lastPage}: ${detail}`)
    }

    const files = (await readdir(workDir))
      .filter(f => f.startsWith('page') && f.endsWith('.jpg'))
      .sort()

    const pages: RasterizedPage[] = []
    for (let i = 0; i < files.length; i++) {
      const imageBuffer = await readFile(join(workDir, files[i]))
      pages.push({ pageNumber: firstPage + i, imageBase64: imageBuffer.toString('base64'), mimeType: 'image/jpeg' })
    }
    return pages
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/**
 * Copies specific pages (1-indexed) from a PDF buffer into a new PDF.
 * Used at download time as a memory-efficient alternative to merging hundreds of
 * rasterized JPEG images — the extracted PDF is smaller and preserves original quality.
 */
export async function extractPagesFromPdf(pdfBuffer: Buffer, pageNumbers: number[]): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { updateMetadata: false })
  const outDoc = await PDFDocument.create()
  const totalPages = srcDoc.getPageCount()
  const indices = pageNumbers
    .map(p => p - 1)
    .filter(i => i >= 0 && i < totalPages)
    .sort((a, b) => a - b)
  if (indices.length === 0) throw new Error('No valid pages to extract from PDF')
  const copied = await outDoc.copyPages(srcDoc, indices)
  copied.forEach(page => outDoc.addPage(page))
  return Buffer.from(await outDoc.save())
}

export interface PdfGroup {
  id: string
  /** 1-indexed page numbers of the big PDF that belong in this group's PDF. */
  pages: number[]
}

export interface CutPdf {
  id: string
  /** The cut PDF, or null when none of the group's pages exist in the big PDF. */
  buffer: Buffer | null
}

/**
 * Cuts one small PDF out of a big one for every group of pages (one group = one plate folder).
 * The big PDF is read ONCE, which is what makes a whole batch fast, and the small PDFs come out
 * one at a time so memory stays near the size of the big PDF however many groups there are.
 * Pages are copied as they are - the scanned picture is not re-compressed or redrawn.
 */
export async function* cutPdfGroups(pdfBuffer: Buffer, groups: PdfGroup[]): AsyncGenerator<CutPdf> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { updateMetadata: false })
  const totalPages = srcDoc.getPageCount()
  for (const group of groups) {
    const indices = [...new Set(group.pages)]
      .map(p => p - 1)
      .filter(i => i >= 0 && i < totalPages)
      .sort((a, b) => a - b)
    if (indices.length === 0) {
      yield { id: group.id, buffer: null }
      continue
    }
    const outDoc = await PDFDocument.create()
    const copied = await outDoc.copyPages(srcDoc, indices)
    copied.forEach(page => outDoc.addPage(page))
    yield { id: group.id, buffer: Buffer.from(await outDoc.save()) }
  }
}

/** Renders one page (1-indexed) of a PDF as a JPEG - used when the stored picture of a page is missing. */
export async function rasterizeOnePage(pdfBuffer: Buffer, pageNumber: number): Promise<RasterizedPage> {
  const workDir = await mkdtemp(join(tmpdir(), 'tollbatch-one-'))
  try {
    const inputPath = join(workDir, 'input.pdf')
    await writeFile(inputPath, pdfBuffer)
    const pages = await rasterizePdfBatch(inputPath, pageNumber, pageNumber)
    if (pages.length === 0) throw new Error(`Page ${pageNumber} could not be rendered`)
    return pages[0]
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/** Rasterizes every page of a scanned PDF into a JPEG, 1-indexed to match how pages are numbered on screen. */
export async function rasterizePdf(pdfBuffer: Buffer): Promise<RasterizedPage[]> {
  const workDir = await mkdtemp(join(tmpdir(), 'tollbatch-'))
  const inputPath = join(workDir, 'input.pdf')
  const outPrefix = join(workDir, 'page')

  try {
    await writeFile(inputPath, pdfBuffer)

    // Same pixel size as rasterizePdfBatch — see RASTER_LONG_SIDE_PX.
    try {
      await execFileAsync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=85', '-scale-to', String(RASTER_LONG_SIDE_PX), inputPath, outPrefix])
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

function isPngBuffer(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
}

/** Merges a folder's page images (in page order) into one PDF, ready to attach or download. */
export async function mergeImagesToPdf(pageImagesBase64: string[]): Promise<Buffer> {
  const out = await PDFDocument.create()

  for (const base64 of pageImagesBase64) {
    const bytes = Buffer.from(base64, 'base64')
    const image = isPngBuffer(bytes) ? await out.embedPng(bytes) : await out.embedJpg(bytes)
    const page = out.addPage([image.width, image.height])
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }

  const pdfBytes = await out.save()
  return Buffer.from(pdfBytes)
}
