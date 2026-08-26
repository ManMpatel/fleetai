/**
 * Migrates the single-tenant schema to per-tenant ObjectId keys.
 *
 *   1. Backfills orgId on every tenant-scoped collection from the old ownerId email.
 *   2. Backfills Fine.orgId by joining through the fine's vehicle.
 *   3. Hashes plaintext employee PINs.
 *   4. Drops the global unique indexes on renters.phone and vehicles.plate, which are
 *      what prevent a second tenant from holding the same plate or renter phone.
 *   5. Reports orphans and refuses to finish if any remain.
 *   6. Only with --drop-owner-id does it remove the legacy field.
 *
 * Idempotent and re-runnable. Run against a restored copy of production first.
 *
 *   npx ts-node src/scripts/migrateToOrgId.ts            # backfill + verify
 *   npx ts-node src/scripts/migrateToOrgId.ts --drop-owner-id
 */

import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

import Organization from '../models/Organization'
import { hash } from '../services/encryption'

// Imported for their side effect: registering the models so syncIndexes() below can
// build the new compound indexes each schema declares.
import '../models/Renter'
import '../models/Vehicle'
import '../models/ServiceRecord'
import '../models/Notification'
import '../models/Employee'
import '../models/ClockRecord'
import '../models/Fine'

const DROP_OWNER_ID = process.argv.includes('--drop-owner-id')

// Collections that carried ownerId (the owner's email) as their tenant key.
const OWNER_ID_COLLECTIONS = [
  'renters',
  'vehicles',
  'servicerecords',
  'notifications',
  'employees',
  'clockrecords',
]

async function backfillFromOwnerId(db: mongoose.mongo.Db): Promise<void> {
  const orgs = await Organization.find()
  console.log(`\nFound ${orgs.length} organization(s)`)

  for (const org of orgs) {
    if (!org.auth0Id) {
      console.warn(`   ⚠️  ${org.email} has no auth0Id — that login cannot resolve a tenant until it is set`)
    }
    for (const name of OWNER_ID_COLLECTIONS) {
      const result = await db.collection(name).updateMany(
        { ownerId: org.email, orgId: { $exists: false } },
        { $set: { orgId: org._id } }
      )
      if (result.modifiedCount > 0) {
        console.log(`   ${org.email} → ${name}: ${result.modifiedCount} document(s)`)
      }
    }
  }
}

async function backfillFineOrgId(db: mongoose.mongo.Db): Promise<void> {
  // Fine never had a tenant field; it inherits from the vehicle it belongs to.
  const fines = db.collection('fines')
  const vehicles = db.collection('vehicles')

  const orphaned = await fines.find({ orgId: { $exists: false } }).toArray()
  if (orphaned.length === 0) {
    console.log('\nfines: nothing to backfill')
    return
  }

  let matched = 0
  for (const fine of orphaned) {
    if (!fine.vehicle) continue
    const vehicle = await vehicles.findOne({ _id: fine.vehicle })
    if (vehicle?.orgId) {
      await fines.updateOne({ _id: fine._id }, { $set: { orgId: vehicle.orgId } })
      matched++
    }
  }
  console.log(`\nfines: ${matched}/${orphaned.length} backfilled from their vehicle`)
}

async function hashEmployeePins(db: mongoose.mongo.Db): Promise<void> {
  const employees = db.collection('employees')
  const plaintext = await employees.find({ pin: { $exists: true } }).toArray()
  if (plaintext.length === 0) {
    console.log('\nemployees: no plaintext PINs to hash')
    return
  }

  for (const employee of plaintext) {
    await employees.updateOne(
      { _id: employee._id },
      { $set: { pinHash: hash(String(employee.pin)) }, $unset: { pin: 1 } }
    )
  }
  console.log(`\nemployees: hashed ${plaintext.length} plaintext PIN(s)`)
}

async function dropGlobalUniqueIndexes(db: mongoose.mongo.Db): Promise<void> {
  // Mongoose creates indexes but never drops them, so removing `unique: true` from the
  // schema is not enough — the old index stays live and still rejects a second tenant.
  const targets: Array<[string, string]> = [
    ['renters', 'phone_1'],
    ['vehicles', 'plate_1'],
  ]

  console.log('')
  for (const [collection, index] of targets) {
    try {
      await db.collection(collection).dropIndex(index)
      console.log(`   Dropped ${collection}.${index}`)
    } catch (err: any) {
      if (err.codeName === 'IndexNotFound' || err.code === 27) {
        console.log(`   ${collection}.${index} already gone`)
      } else {
        throw err
      }
    }
  }
}

async function verify(db: mongoose.mongo.Db): Promise<boolean> {
  console.log('\n── Verification ──────────────────────────────')
  let clean = true

  for (const name of [...OWNER_ID_COLLECTIONS, 'fines']) {
    const total = await db.collection(name).countDocuments()
    const orphans = await db.collection(name).countDocuments({ orgId: { $exists: false } })
    const flag = orphans === 0 ? '✅' : '❌'
    console.log(`   ${flag} ${name}: ${total - orphans}/${total} carry orgId`)
    if (orphans > 0) clean = false
  }

  for (const [collection, index] of [['renters', 'phone_1'], ['vehicles', 'plate_1']]) {
    const indexes = await db.collection(collection).indexes()
    const stillThere = indexes.some((i: any) => i.name === index)
    console.log(`   ${stillThere ? '❌' : '✅'} ${collection}.${index} ${stillThere ? 'STILL PRESENT' : 'removed'}`)
    if (stillThere) clean = false
  }

  return clean
}

async function migrate() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')

  await mongoose.connect(uri, { dbName: 'fleetai' })
  const db = mongoose.connection.db
  if (!db) throw new Error('Database not connected')
  console.log('Connected to MongoDB')

  await backfillFromOwnerId(db)
  await backfillFineOrgId(db)
  await hashEmployeePins(db)
  await dropGlobalUniqueIndexes(db)

  const clean = await verify(db)

  if (!clean) {
    console.error(
      '\n❌ Migration incomplete. Documents without an orgId must be assigned deliberately — ' +
      'guessing an owner would put one tenant\'s records in another tenant\'s account.\n' +
      '   Inspect them with: db.<collection>.find({ orgId: { $exists: false } })'
    )
    await mongoose.disconnect()
    process.exit(1)
  }

  // Rebuild the compound indexes the new schemas declare.
  console.log('\nSyncing indexes...')
  for (const model of Object.values(mongoose.models)) {
    await model.syncIndexes()
  }
  console.log('   Done')

  if (DROP_OWNER_ID) {
    console.log('\nRemoving legacy ownerId field...')
    for (const name of OWNER_ID_COLLECTIONS) {
      const result = await db.collection(name).updateMany({}, { $unset: { ownerId: 1 } })
      console.log(`   ${name}: ${result.modifiedCount} document(s)`)
    }
  } else {
    console.log('\nℹ️  Legacy ownerId left in place. Re-run with --drop-owner-id once verified in production.')
  }

  console.log('\n✅ Migration complete')
  await mongoose.disconnect()
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
