/**
 * Migrates the single-tenant schema to per-tenant ObjectId keys.
 *
 *   1. Backfills orgId on every tenant-scoped collection from the old ownerId email.
 *   2. Backfills Fine.orgId by joining through the fine's vehicle.
 *   3. Hashes plaintext employee PINs.
 *   4. Moves the old per-owner PayWay/SMS/business-name fields onto the new Organization
 *      shape, so an operator who configured them in the old dashboard keeps working.
 *   5. With --assign-orphans-to, claims documents that never carried a tenant key at all.
 *   6. Verifies every document carries an orgId, and STOPS before changing any index if
 *      that is not true.
 *   7. Drops the global unique indexes on renters.phone, vehicles.plate and
 *      transactions.transactionId, which are what prevent a second tenant from holding
 *      the same plate, renter phone or PayWay transaction id.
 *   8. Only with --drop-owner-id does it remove the legacy field.
 *
 * Idempotent and re-runnable. Run against a restored copy of production first.
 *
 *   npx ts-node src/scripts/migrateToOrgId.ts            # backfill + verify
 *   npx ts-node src/scripts/migrateToOrgId.ts --assign-orphans-to=owner@example.com
 *   npx ts-node src/scripts/migrateToOrgId.ts --drop-owner-id
 *
 * ── Why --assign-orphans-to exists ──────────────────────────────────────────────
 * Notification and ServiceRecord had an OPTIONAL ownerId, and the single-tenant code
 * created notifications with no ownerId at all from every system path — fine and toll
 * ingestion, inbound WhatsApp, manual fine upload. Fine never had a tenant field, so any
 * fine whose vehicle has since been deleted cannot be resolved by join either.
 *
 * Those documents cannot be backfilled from a field they never had. Refusing to guess is
 * right once a second tenant exists, but on a database that holds exactly one operator
 * there is nothing to guess: every record belongs to them. The flag makes that assignment
 * explicit and auditable rather than implicit, and demands --force before doing it on a
 * database where more than one organisation exists.
 */

import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

import Organization from '../models/Organization'
import { decrypt, encrypt, hash } from '../services/encryption'

// Imported for their side effect: registering the models so syncIndexes() below can
// build the new compound indexes each schema declares.
import '../models/Renter'
import '../models/Vehicle'
import '../models/ServiceRecord'
import '../models/Notification'
import '../models/Employee'
import '../models/ClockRecord'
import '../models/Fine'
import '../models/Invoice'
import '../models/InvoiceTemplate'
import '../models/Transaction'

const DROP_OWNER_ID = process.argv.includes('--drop-owner-id')
const FORCE = process.argv.includes('--force')

/** `--assign-orphans-to=someone@example.com`, or null when the flag is absent. */
const ASSIGN_ORPHANS_TO = (() => {
  const arg = process.argv.find(a => a.startsWith('--assign-orphans-to'))
  if (!arg) return null
  const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : process.argv[process.argv.indexOf(arg) + 1]
  const email = (value || '').trim().toLowerCase()
  if (!email || email.startsWith('--')) {
    throw new Error('--assign-orphans-to needs an email, e.g. --assign-orphans-to=owner@example.com')
  }
  return email
})()

// Collections that carried ownerId (the owner's email) as their tenant key.
const OWNER_ID_COLLECTIONS = [
  'renters',
  'vehicles',
  'servicerecords',
  'notifications',
  'employees',
  'clockrecords',
  // These three also keyed on ownerId. Leaving them out silently empties the Invoices
  // page and the stored transaction history for the existing operator, because every
  // query on them now filters by orgId.
  'invoices',
  'invoicetemplates',
  'transactions',
]

// Every collection that must carry an orgId once the migration is done. `fines` never had
// a tenant key of its own, so it is verified here but backfilled by join.
const TENANT_COLLECTIONS = [...OWNER_ID_COLLECTIONS, 'fines']

/** The old data stored login emails exactly as the client sent them — never normalised. */
function emailMatcher(email: string): RegExp {
  return new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
}

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

/**
 * The single-tenant Owner document stored credentials as flat fields. The new
 * Organization shape nests them, so without this an operator who entered PayWay keys or
 * SMS credentials in the old dashboard silently drops to the mock payment path.
 *
 * The PayWay values were already encrypted with the same ENCRYPTION_KEY and move across
 * untouched. mmApiPassword was stored in plaintext and is encrypted on the way. Values
 * already present in the new shape are never overwritten.
 */
async function migrateOwnerCredentials(db: mongoose.mongo.Db): Promise<void> {
  const owners = db.collection('owners')
  const legacy = await owners.find({
    $or: [
      { paywaySecretKey: { $exists: true } },
      { mmApiUsername: { $exists: true } },
      { businessName: { $exists: true } },
    ],
  }).toArray()

  if (legacy.length === 0) {
    console.log('\nowners: no legacy credential fields to move')
    return
  }

  for (const owner of legacy) {
    const set: Record<string, unknown> = {}

    if (owner.paywaySecretKey && !owner.payway?.secretKeyEnc) {
      set['payway.secretKeyEnc'] = owner.paywaySecretKey
    }
    if (owner.paywayPublishableKey && !owner.payway?.publishableKeyEnc) {
      set['payway.publishableKeyEnc'] = owner.paywayPublishableKey
    }
    // merchantId and bankAccountId are plain identifiers in the new shape but were
    // encrypted in the old one, so they are decrypted rather than copied.
    if (owner.paywayMerchantId && !owner.payway?.merchantId) {
      set['payway.merchantId'] = safeDecrypt(owner.paywayMerchantId)
    }
    if (owner.paywayBankAccountId && !owner.payway?.bankAccountId) {
      set['payway.bankAccountId'] = safeDecrypt(owner.paywayBankAccountId)
    }

    if (owner.mmApiUsername && !owner.sms?.username) {
      set['sms.username'] = owner.mmApiUsername
      set['sms.enabled'] = true
    }
    if (owner.mmApiPassword && !owner.sms?.passwordEnc) {
      set['sms.passwordEnc'] = encrypt(String(owner.mmApiPassword))
    }

    if (owner.businessName && !owner.displayName) {
      set.displayName = owner.businessName
    }

    if (Object.keys(set).length === 0) continue
    await owners.updateOne({ _id: owner._id }, { $set: set })
    console.log(`   ${owner.email}: moved ${Object.keys(set).join(', ')}`)
  }
}

/** Old ciphertext round-trips; anything already plaintext is returned unchanged. */
function safeDecrypt(value: string): string {
  try {
    return decrypt(String(value))
  } catch {
    return String(value)
  }
}

/**
 * Claims documents that carry no tenant key at all and cannot be derived from one.
 *
 * Deliberately opt-in and deliberately noisy: it prints the target organisation, how many
 * organisations exist, and a per-collection count before writing anything. On a database
 * with more than one organisation this stops being a migration and starts being a guess,
 * so it refuses without --force.
 */
async function assignOrphans(db: mongoose.mongo.Db, email: string): Promise<void> {
  const org = await Organization.findOne({ email: emailMatcher(email) })
  if (!org) {
    throw new Error(
      `--assign-orphans-to=${email} matched no organisation. ` +
      `Check the stored value with: db.owners.find({}, { email: 1 })`
    )
  }

  const orgCount = await Organization.countDocuments()
  console.log(`\n── Assigning orphans to ${org.email} (${org._id}) ──`)
  console.log(`   ${orgCount} organisation(s) in this database`)

  if (orgCount > 1 && !FORCE) {
    throw new Error(
      `Refusing to claim orphans: ${orgCount} organisations exist, so an untagged document ` +
      `could belong to any of them. Inspect them first, then re-run with --force if you are ` +
      `certain they all belong to ${org.email}.`
    )
  }

  let claimed = 0
  for (const name of TENANT_COLLECTIONS) {
    const result = await db.collection(name).updateMany(
      { orgId: { $exists: false } },
      { $set: { orgId: org._id } }
    )
    if (result.modifiedCount > 0) {
      console.log(`   ${name}: ${result.modifiedCount} document(s) claimed`)
      claimed += result.modifiedCount
    }
  }
  console.log(claimed === 0 ? '   Nothing left unassigned' : `   ${claimed} document(s) total`)
}

// Mongoose creates indexes but never drops them, so removing `unique: true` from the
// schema is not enough — the old index stays live and still rejects a second tenant.
// PayWay numbers transactions per merchant account, so two tenants will collide there too.
const LEGACY_UNIQUE_INDEXES: Array<[string, string]> = [
  ['renters', 'phone_1'],
  ['vehicles', 'plate_1'],
  ['transactions', 'transactionId_1'],
]

async function dropGlobalUniqueIndexes(db: mongoose.mongo.Db): Promise<void> {
  console.log('\n── Dropping legacy unique indexes ────────────')
  for (const [collection, index] of LEGACY_UNIQUE_INDEXES) {
    try {
      await db.collection(collection).dropIndex(index)
      console.log(`   Dropped ${collection}.${index}`)
    } catch (err: any) {
      // 27 IndexNotFound, 26 NamespaceNotFound — both mean there is nothing to drop.
      if (err.codeName === 'IndexNotFound' || err.code === 27 || err.code === 26) {
        console.log(`   ${collection}.${index} already gone`)
      } else {
        throw err
      }
    }
  }
}

/**
 * Every tenant-scoped document must carry an orgId before anything else happens. This runs
 * BEFORE the index changes, so a database that fails it is left exactly as it was found.
 */
async function verifyOrgIds(db: mongoose.mongo.Db): Promise<boolean> {
  console.log('\n── Verification: tenant keys ─────────────────')
  let clean = true

  for (const name of TENANT_COLLECTIONS) {
    const total = await db.collection(name).countDocuments()
    const orphans = await db.collection(name).countDocuments({ orgId: { $exists: false } })
    const flag = orphans === 0 ? '✅' : '❌'
    console.log(`   ${flag} ${name}: ${total - orphans}/${total} carry orgId`)
    if (orphans > 0) clean = false
  }

  return clean
}

async function verifyIndexes(db: mongoose.mongo.Db): Promise<boolean> {
  console.log('\n── Verification: indexes ─────────────────────')
  let clean = true

  for (const [collection, index] of LEGACY_UNIQUE_INDEXES) {
    let stillThere = false
    try {
      const indexes = await db.collection(collection).indexes()
      stillThere = indexes.some((i: any) => i.name === index)
    } catch (err: any) {
      // The collection does not exist yet — there is no stale index to worry about.
      if (err.code !== 26 && err.codeName !== 'NamespaceNotFound') throw err
    }
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
  await migrateOwnerCredentials(db)
  if (ASSIGN_ORPHANS_TO) await assignOrphans(db, ASSIGN_ORPHANS_TO)

  // Ordering matters. The index changes below are the destructive half of this migration:
  // once the old unique indexes are gone and the new compound ones are not yet built, the
  // database is in a state neither the old nor the new code is correct against. So the
  // tenant keys are proved complete FIRST, and a failure here leaves the database
  // untouched and the run safely repeatable.
  if (!(await verifyOrgIds(db))) {
    console.error(
      '\n❌ Migration stopped before any index was changed — the database is unchanged.\n\n' +
      '   Some documents carry no orgId. Notification and ServiceRecord had an optional\n' +
      '   ownerId, and the single-tenant code created notifications with none at all from\n' +
      '   fine/toll ingestion, inbound WhatsApp and manual uploads. Fines whose vehicle was\n' +
      '   deleted cannot be resolved by join either.\n\n' +
      '   Inspect them:  db.<collection>.find({ orgId: { $exists: false } })\n' +
      '   If this database holds one operator, every one of them is theirs — claim them with:\n' +
      '     npx ts-node src/scripts/migrateToOrgId.ts --assign-orphans-to=<their-login-email>'
    )
    await mongoose.disconnect()
    process.exit(1)
  }

  await dropGlobalUniqueIndexes(db)

  // Rebuild the compound indexes the new schemas declare.
  console.log('\nSyncing indexes...')
  for (const model of Object.values(mongoose.models)) {
    await model.syncIndexes()
  }
  console.log('   Done')

  if (!(await verifyIndexes(db))) {
    console.error(
      '\n❌ A legacy unique index survived both the explicit drop and syncIndexes(). ' +
      'Drop it by hand before letting a second tenant onto this database.'
    )
    await mongoose.disconnect()
    process.exit(1)
  }

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
