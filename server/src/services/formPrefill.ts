import mongoose from 'mongoose'
import Renter from '../models/Renter'
import Vehicle from '../models/Vehicle'
import InvoiceTemplate from '../models/InvoiceTemplate'
import { normalizePhone, type SectionDef } from '../config/claimForm'
import { ageOn, pictureCount, validDate, type Answers, type PictureCounts } from '../config/claimFormData'

/**
 * Finds the renter of this business whose mobile matches (typed any way: 0412 345 678, +61 412 ...).
 * Renter phones are stored as typed, so the match is made on the normalised number.
 */
export async function findRenterByPhone(orgId: mongoose.Types.ObjectId, phone: string) {
  const wanted = normalizePhone(phone)
  if (!wanted) return null
  const renters = await Renter.find({ orgId }).select('phone currentVehicle currentVehicles').lean()
  return renters.find(r => normalizePhone(r.phone) === wanted) || null
}

/** "Toyota Camry Hybrid" -> make Toyota, model "Camry Hybrid". One word is taken as the model. */
function splitModel(full: string | undefined): { make: string; model: string } {
  const words = (full || '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return { make: words[0], model: words.slice(1).join(' ') }
  return { make: '', model: words[0] || '' }
}

function put(target: Record<string, any>, key: string, value: unknown) {
  if (typeof value === 'string' && value.trim()) target[key] = value.trim()
}

interface EntryForPrefill {
  renterRef?: mongoose.Types.ObjectId | null
  renterPhone?: string
  renterData?: Record<string, any>
  fileCounts?: PictureCounts
}

/**
 * What the owner's part of the form can fill in for him: the vehicle (from the car the renter has
 * now) and the business details (from his invoice template), and the claim checklist ticks that
 * follow from what the renter sent. Everything here is only a suggestion: the owner sees it in the
 * boxes, can change it, and what he saves wins.
 */
export async function ownerDefaults(orgId: mongoose.Types.ObjectId, entry: EntryForPrefill, sections: SectionDef[]): Promise<Answers> {
  const out: Answers = {}

  if (sections.some(s => s.id === 'claim')) {
    let renter: any = null
    if (entry.renterRef) renter = await Renter.findOne({ _id: entry.renterRef, orgId }).select('phone currentVehicle currentVehicles').lean()
    if (!renter && entry.renterPhone) renter = await findRenterByPhone(orgId, entry.renterPhone)

    const claim: Record<string, any> = {}
    const vehicleId = renter?.currentVehicle || renter?.currentVehicles?.[0]
    const vehicle: any = vehicleId ? await Vehicle.findOne({ _id: vehicleId, orgId }).select('plate model year').lean() : null
    if (vehicle) {
      const { make, model } = splitModel(vehicle.model)
      put(claim, 'registration', vehicle.plate)
      put(claim, 'make', make)
      put(claim, 'model', model)
      put(claim, 'monthYear', vehicle.year ? String(vehicle.year) : '')
    }

    // The invoice template marked as default (or the oldest) holds the business name, phone, address, email.
    const biz: any = await InvoiceTemplate.findOne({ orgId }).sort({ isDefault: -1, createdAt: 1 }).lean()
    if (biz) {
      put(claim, 'ownerName', biz.businessName)
      put(claim, 'ownerMobile', biz.phone)
      put(claim, 'ownerAddress', biz.address)
      put(claim, 'ownerEmail', biz.email)
    }
    if (Object.keys(claim).length > 0) out.claim = claim
  }

  if (sections.some(s => s.id === 'checklist')) {
    const data = entry.renterData || {}
    const counts = entry.fileCounts
    const incidentDate = data.incident?.date
    const day = typeof incidentDate === 'string' && validDate(incidentDate) ? new Date(`${incidentDate}T00:00:00Z`) : new Date()
    const age = ageOn(data.driver?.dob, day)

    const items: string[] = []
    if (age !== null && age >= 21) items.push('over21')
    if (pictureCount(counts, 'declaration', 'signature') > 0 && data.declaration?.date) items.push('signed')
    if (pictureCount(counts, 'uploads', 'licenceFront') > 0 && pictureCount(counts, 'uploads', 'licenceBack') > 0) items.push('licence')
    if (items.length > 0) out.checklist = { items }
  }

  return out
}