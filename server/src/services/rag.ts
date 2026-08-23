import { Types } from 'mongoose'
import Vehicle from '../models/Vehicle'
import Notification from '../models/Notification'
import Renter from '../models/Renter'
import { scopedPopulate } from '../models/plugins/tenantScope'

// ─────────────────────────────────────────────────────────
// buildFleetContext — assembles a text snapshot of ONE tenant's fleet for injection
// into Gemini prompts (RAG pipeline).
//
// Every query here must be scoped to orgId. This context is interpolated verbatim into
// a prompt and returned to the caller, so an unscoped query hands one operator the
// renter names, phone numbers and rates of every other operator on the platform.
// ─────────────────────────────────────────────────────────
export async function buildFleetContext(orgId: Types.ObjectId): Promise<string> {
  const now = new Date()
  const in30 = new Date(now.getTime() + 30 * 86400000)

  const vehicles = await Vehicle.find({ orgId })
    .populate(scopedPopulate('currentRenter', 'name phone email'))
    .populate(scopedPopulate('fines'))
    .populate(scopedPopulate('tolls'))

  const renters = await Renter.find({ orgId })
    .populate(scopedPopulate('currentVehicle', 'plate'))

  const notifications = await Notification.find({ orgId, read: false })
    .sort({ date: -1 })
    .limit(30)

  const renterLines = renters.map((r) => {
    let line = `RENTER|${r.phone}|${r.name}|${r.email || ''}`
    if (r.currentVehicle) line += `|vehicle:${(r.currentVehicle as any).plate}`
    if (r.rentStartDate) line += `|since:${r.rentStartDate.toLocaleDateString('en-AU')}`
    if (r.weeklyRate) line += `|rate:$${r.weeklyRate}/wk`
    if (r.payway?.status) line += `|debit:${r.payway.status}`
    return line
  })

  const vehicleLines = vehicles.map((v) => {
    const renter = v.currentRenter as any
    const fineList = (v.fines as any[]) || []
    const tollList = (v.tolls as any[]) || []
    const unpaidFines = fineList.filter((f) => !f.paid)
    const unpaidTolls = tollList.filter((f) => !f.paid)

    const regoExpired = v.regoExpiry && v.regoExpiry < now
    const regoDueSoon = v.regoExpiry && v.regoExpiry >= now && v.regoExpiry <= in30
    const pinkExpired = v.pinkSlip && v.pinkSlip < now
    const pinkDueSoon = v.pinkSlip && v.pinkSlip >= now && v.pinkSlip <= in30

    let line = `VEHICLE|${v.plate}|${(v as any).model ?? ''}|${v.year}|${v.type}|${v.status}`
    if (renter?.name) line += `|renter:${renter.name}(${renter.phone || ''})`
    if (v.rentStartDate) line += `|since:${v.rentStartDate.toLocaleDateString('en-AU')}`
    if (v.regoExpiry)
      line += `|rego:${v.regoExpiry.toLocaleDateString('en-AU')}${regoExpired ? '[EXPIRED]' : regoDueSoon ? '[DUE<30d]' : ''}`
    if (v.pinkSlip)
      line += `|pink:${v.pinkSlip.toLocaleDateString('en-AU')}${pinkExpired ? '[EXPIRED]' : pinkDueSoon ? '[DUE<30d]' : ''}`
    if (v.greenSlip) line += `|green:${v.greenSlip.toLocaleDateString('en-AU')}`
    if (v.lastService) line += `|lastService:${v.lastService.toLocaleDateString('en-AU')}`
    if (unpaidFines.length)
      line += `|unpaidFines:${unpaidFines.length}($${unpaidFines.reduce((a: number, f: any) => a + f.amount, 0).toFixed(2)})`
    if (unpaidTolls.length)
      line += `|unpaidTolls:${unpaidTolls.length}($${unpaidTolls.reduce((a: number, f: any) => a + f.amount, 0).toFixed(2)})`
    if (v.notes) line += `|notes:${v.notes}`
    return line
  })

  const alertLines = notifications.map(
    (n) =>
      `ALERT|${n.type}|${n.plate || ''}|${n.title}|${n.description}${n.actionRequired ? '|ACTION_REQUIRED' : ''}`
  )

  const stats = {
    total: vehicles.length,
    available: vehicles.filter((v) => v.status === 'available').length,
    rented: vehicles.filter((v) => v.status === 'rented').length,
    service: vehicles.filter((v) => v.status === 'service').length,
    scooters: vehicles.filter((v) => v.type === 'scooter').length,
    cars: vehicles.filter((v) => v.type === 'car').length,
    expiredRego: vehicles.filter((v) => v.regoExpiry && v.regoExpiry < now).length,
    dueSoonRego: vehicles.filter((v) => v.regoExpiry && v.regoExpiry >= now && v.regoExpiry <= in30).length,
    unpaidFines: vehicles.reduce((acc, v) => acc + ((v.fines as any[]) || []).filter((f: any) => !f.paid).length, 0),
    unpaidTolls: vehicles.reduce((acc, v) => acc + ((v.tolls as any[]) || []).filter((f: any) => !f.paid).length, 0),
  }

  return `=== FLEETAI DATABASE SNAPSHOT — ${now.toLocaleDateString('en-AU')} ===
STATS|total:${stats.total}|available:${stats.available}|rented:${stats.rented}|service:${stats.service}|scooters:${stats.scooters}|cars:${stats.cars}|expiredRego:${stats.expiredRego}|regoDueSoon:${stats.dueSoonRego}|unpaidFines:${stats.unpaidFines}|unpaidTolls:${stats.unpaidTolls}
${vehicleLines.join('\n')}
${renterLines.join('\n')}
${alertLines.length > 0 ? alertLines.join('\n') : 'ALERTS|none'}`
}

// ─────────────────────────────────────────────────────────
// checkExpiringDates — daily cron: creates notifications for rego/pink slip expiring
// within 30 days or overdue. Each vehicle already carries its tenant, so the created
// notification and the dedupe lookup are both stamped from the vehicle itself.
// ─────────────────────────────────────────────────────────
export async function checkExpiringDates(): Promise<void> {
  const now = new Date()
  const in30 = new Date(now.getTime() + 30 * 86400000)

  try {
    // Deliberately platform-wide: the per-vehicle work below re-scopes to the owning org.
    const vehicles = await Vehicle.find({
      $or: [{ regoExpiry: { $lte: in30 } }, { pinkSlip: { $lte: in30 } }, { greenSlip: { $lte: in30 } }],
    }).setOptions({ allowCrossTenant: true })

    for (const vehicle of vehicles) {
      await checkDate(vehicle, 'regoExpiry', 'rego', now)
      await checkDate(vehicle, 'pinkSlip', 'pinkSlip', now)
    }

    console.log(`✅ Expiry check complete — checked ${vehicles.length} vehicles`)
  } catch (err) {
    console.error('Expiry check error:', err)
  }
}

async function checkDate(
  vehicle: any,
  field: 'regoExpiry' | 'pinkSlip',
  label: string,
  now: Date
) {
  const date: Date | undefined = vehicle[field]
  if (!date) return

  const daysLeft = Math.ceil((date.getTime() - now.getTime()) / 86400000)
  if (daysLeft > 30) return

  // Deduplicate within the owning tenant — two operators may hold the same plate, and
  // one must not suppress the other's alert.
  const existing = await Notification.findOne({
    orgId: vehicle.orgId,
    plate: vehicle.plate,
    type: field === 'regoExpiry' ? 'rego' : 'info',
    title: { $regex: label, $options: 'i' },
    createdAt: { $gte: new Date(now.getTime() - 23 * 3600000) },
  })
  if (existing) return

  const isRego = field === 'regoExpiry'
  const expired = daysLeft <= 0
  const abs = Math.abs(daysLeft)

  await Notification.create({
    orgId: vehicle.orgId,
    type: isRego ? 'rego' : 'info',
    title: expired
      ? `${label} EXPIRED — ${vehicle.plate}`
      : `${label} expiring soon — ${vehicle.plate}`,
    description: expired
      ? `${label} for ${vehicle.plate} (${vehicle.model ?? ''}) expired ${abs} day${abs !== 1 ? 's' : ''} ago`
      : `${label} for ${vehicle.plate} (${vehicle.model ?? ''}) expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
    plate: vehicle.plate,
    actionRequired: true,
  })
}
