import axios from 'axios'
import type { Answers, FormEntryDetail, Pictures, SectionDef } from './types'
import { mergeAnswers } from './fieldLogic'

// Helpers to turn a form that came back into a downloaded PDF. The PDF is built in the browser
// (claimFormPdf.ts), the same way the DDR PDF is, so nothing about the renter is sent anywhere new.

/** "Accident claim - Ravi Kumar.pdf" (characters Windows does not allow in a file name are removed). */
export function pdfFileName(entry: Pick<FormEntryDetail, 'renterName' | 'templateName'>): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${clean(entry.templateName) || 'Claim form'} - ${clean(entry.renterName) || 'renter'}.pdf`
}

export function saveBytes(bytes: ArrayBuffer, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 15_000)
}

/** The PDF for one form. ownerValues is the owner's part (what he has typed, or the suggestions). */
export async function buildEntryPdf(entry: FormEntryDetail, sections: SectionDef[], ownerValues: Answers, files: Pictures): Promise<ArrayBuffer> {
  const { buildClaimFormPdf } = await import('./claimFormPdf')
  return buildClaimFormPdf({ sections, values: mergeAnswers(entry.renterData, ownerValues), files, renterName: entry.renterName })
}

/** Fetches a form and its pictures, builds the PDF and saves it. Used by the PDF button in History. */
export async function downloadEntryPdf(entryId: string): Promise<void> {
  const [detail, pictures] = await Promise.all([
    axios.get<{ entry: FormEntryDetail; sections: SectionDef[]; ownerDefaults: Answers }>(`/api/forms/entries/${entryId}`),
    axios.get<{ files: Pictures }>(`/api/forms/entries/${entryId}/files`),
  ])
  const { entry, sections, ownerDefaults } = detail.data
  const bytes = await buildEntryPdf(entry, sections, mergeAnswers(ownerDefaults, entry.ownerData), pictures.data.files)
  saveBytes(bytes, pdfFileName(entry))
}
