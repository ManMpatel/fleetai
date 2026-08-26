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

// ─────────────────────────────────────────────────────────
// checkPaymentStatus — daily cron: checks renters whose
// nextDebitDate is today or overdue, notifies if declined.
// Genuinely cross-tenant (scans every operator), but every PayWay call and every
// write is scoped to that renter's own org.
// ─────────────────────────────────────────────────────────
export async function checkPaymentStatus(): Promise<void> {
  const todayStr = new Date().toISOString().split('T')[0]

  try {
    const { paywayCredsFor, fetchAllTransactions, getCustomerSchedule } = await import('./payway')
    const { sendWhatsAppText } = await import('./whatsapp')
    const Organization = (await import('../models/Organization')).default
    const Transaction = (await import('../models/Transaction')).default

    const renters = await Renter.find({
      'payway.status': 'active',
      'payway.customerId': { $exists: true },
    }).setOptions({ allowCrossTenant: true })

    console.log(`💳 Payment check — ${renters.length} renter(s) due today or overdue`)

    const orgCache = new Map<string, any>()
    async function orgFor(orgId: Types.ObjectId) {
      const key = String(orgId)
      if (!orgCache.has(key)) orgCache.set(key, await Organization.findById(orgId))
      return orgCache.get(key)
    }

    for (const renter of renters) {
      const org = await orgFor(renter.orgId)
      if (!org) continue
      const creds = paywayCredsFor(org)
      const customerId = renter.payway!.customerId!
      const payments = await fetchAllTransactions(creds, customerId)

      if (!payments.length) {
        console.log(`⏳ No transactions yet for ${renter.name} — will retry tomorrow`)
        continue
      }

      const latest = payments[0]
      const latestDate = latest.date ? new Date(latest.date) : null

      // Only process if the latest transaction is on or after the due date
      if (!latestDate || latestDate < new Date(renter.payway!.nextDebitDate!)) {
        console.log(`⏳ Payment not processed yet for ${renter.name} — will retry tomorrow`)
        continue
      }

      if (latest.transactionId) {
        await Transaction.updateOne(
          { transactionId: latest.transactionId },
          { $setOnInsert: { ...latest, renterId: renter.phone, orgId: renter.orgId } },
          { upsert: true }
        )
      }

      // Dedup — skip if we already notified for this renter today
      const existing = await Notification.findOne({
        orgId: renter.orgId,
        title: { $regex: renter.name, $options: 'i' },
        type: 'info',
        createdAt: { $gte: new Date(todayStr) },
      })
      if (existing) continue

      if (latest.status === 'approved') {
        const schedule = await getCustomerSchedule(creds, customerId)
        renter.payway!.nextDebitDate = schedule.success && schedule.nextPaymentDate
          ? schedule.nextPaymentDate
          : new Date(latestDate.getTime() + 7 * 86400000)
        await renter.save()
        console.log(`✅ Payment confirmed for ${renter.name} — next debit: ${renter.payway!.nextDebitDate!.toISOString().split('T')[0]}`)
      } else {
        await Notification.create({
          orgId: renter.orgId,
          type: 'info',
          title: `Payment failed — ${renter.name}`,
          description: `Direct debit of $${latest.amount} failed for ${renter.name} (${renter.phone}). Reason: ${latest.description || 'Declined'}`,
          actionRequired: true,
        })
        console.log(`❌ Payment declined for ${renter.name} — notification created`)

        try {
          const firstName = renter.name.split(' ')[0]
          await sendWhatsAppText(
            org,
            renter.phone.replace(/^0/, '61'),
            `Hi ${firstName}, your weekly payment of $${latest.amount} has been declined. Please contact us ASAP.`
          )
        } catch (waErr: any) {
          console.error(`⚠️ WhatsApp decline notice failed for ${renter.name}:`, waErr.message)
        }
      }
    }
  } catch (err) {
    console.error('Payment check error:', err)
  }
}
