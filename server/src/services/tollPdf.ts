import { PDFDocument } from 'pdf-lib'

// PDF utilities for TollBatch — two directions:
//   rasterizePdf: the incoming scanner PDF — one PNG per page, for Gemini to read.
//   mergeImagesToPdf: one folder's page images — a single PDF, for email/download.
//
// pdf-to-img (pdfjs-dist under the hood) is pure JS with no native canvas build step,
// which matters on Railway — an earlier native-canvas-based rasterizer failed to build
// in this same environment. It ships ESM-only, so it's loaded with a dynamic import()
// from this CommonJS file rather than a static import, same as this codebase already
// does for @google/generative-ai.

export interface RasterizedPage {
  pageNumber: number
  imageBase64: string
  mimeType: 'image/png'
}

/** Rasterizes every page of a scanned PDF into a PNG, 1-indexed to match how pages are numbered on screen. */
export async function rasterizePdf(pdfBuffer: Buffer): Promise<RasterizedPage[]> {
  const { pdf } = await import('pdf-to-img')
  const doc = await pdf(pdfBuffer, { format: 'png', scale: 2 })

  const pages: RasterizedPage[] = []
  let pageNumber = 1
  for await (const image of doc) {
    pages.push({ pageNumber, imageBase64: image.toString('base64'), mimeType: 'image/png' })
    pageNumber++
  }
  await doc.destroy()
  return pages
}

/** Merges a folder's page images (in page order) into one PDF, ready to attach or download. */
export async function mergeImagesToPdf(pageImagesBase64: string[]): Promise<Buffer> {
  const out = await PDFDocument.create()

  for (const base64 of pageImagesBase64) {
    const bytes = Buffer.from(base64, 'base64')
    const image = await out.embedPng(bytes)
    const page = out.addPage([image.width, image.height])
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }

  const bytes = await out.save()
  return Buffer.from(bytes)
}
