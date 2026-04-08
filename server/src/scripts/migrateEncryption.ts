import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

import { encrypt, hash, decrypt } from '../services/encryption'
import Renter from '../models/Renter'

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI || '', { dbName: 'fleetai' })
  console.log('Connected to MongoDB')

  const renters = await Renter.find({})
  console.log(`Found ${renters.length} renters`)

  let updated = 0

  for (const renter of renters) {
    const update: any = {}

    // Only encrypt fields that are NOT already encrypted (no ':' = plain text)
    if (renter.licenceNumber && !renter.licenceNumber.includes(':')) {
      update.licenceNumberHash = hash(renter.licenceNumber)
      update.licenceNumber = encrypt(renter.licenceNumber)
    }

    if ((renter as any).passportNumber && !(renter as any).passportNumber.includes(':')) {
      update.passportNumberHash = hash((renter as any).passportNumber)
      update.passportNumber = encrypt((renter as any).passportNumber)
    }

    if (renter.dateOfBirth && !renter.dateOfBirth.includes(':')) {
      update.dateOfBirth = encrypt(renter.dateOfBirth)
    }

    if (renter.bankName && !renter.bankName.includes(':')) {
      update.bankName = encrypt(renter.bankName)
    }

    if (renter.bsbNumber && !renter.bsbNumber.includes(':')) {
      update.bsbNumber = encrypt(renter.bsbNumber)
    }

    if (renter.accountNumber && !renter.accountNumber.includes(':')) {
      update.accountNumber = encrypt(renter.accountNumber)
    }

    if (renter.accountHolderName && !renter.accountHolderName.includes(':')) {
      update.accountHolderName = encrypt(renter.accountHolderName)
    }

    if (Object.keys(update).length > 0) {
      await Renter.updateOne({ _id: renter._id }, { $set: update })
      console.log(`✅ Encrypted: ${renter.name} (${renter.phone})`)
      updated++
    } else {
      console.log(`⏭️  Already encrypted: ${renter.name}`)
    }
  }

  console.log(`\nDone. ${updated}/${renters.length} renters updated.`)
  await mongoose.disconnect()
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})