import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Vehicle from './models/Vehicle'
import Renter from './models/Renter'
import Fine from './models/Fine'
import Notification from './models/Notification'

dotenv.config()

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fleetai'

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 86400000)
}

async function seed() {
  await mongoose.connect(MONGO_URI)
  console.log('✅ Connected to MongoDB')

  // Clear existing data
  await Promise.all([
    Vehicle.deleteMany({}),
    Renter.deleteMany({}),
    Fine.deleteMany({}),
    Notification.deleteMany({}),
  ])
  console.log('🗑️  Cleared existing data')

  // ── Renters ──────────────────────────────────────────────
  const renters = await Renter.insertMany([
  {
    name: 'Liam Chen',
    phone: '0412345678',
    email: 'liam.chen@gmail.com',
    licenceNumber: 'NSW123456',
    vehicleType: 'scooter',
    weeklyRate: 150,
    address: { street: '12 George St', city: 'Sydney', state: 'NSW', postcode: '2000', country: 'Australia' },
    bankName: 'CommBank',
    accountHolderName: 'Liam Chen',
    bsbNumber: '062000',
    accountNumber: '12345678',
    emergencyContactName: 'Wei Chen',
    emergencyContactPhone: '0411111111',
    payway: { status: 'active', weeklyAmount: 150, startDate: daysFromNow(-45) },
  },
  {
    name: 'Priya Sharma',
    phone: '0423456789',
    email: 'priya.s@hotmail.com',
    licenceNumber: 'NSW234567',
    vehicleType: 'scooter',
    weeklyRate: 150,
    address: { street: '8 Pitt St', city: 'Parramatta', state: 'NSW', postcode: '2150', country: 'Australia' },
    bankName: 'ANZ',
    accountHolderName: 'Priya Sharma',
    bsbNumber: '012003',
    accountNumber: '87654321',
    emergencyContactName: 'Raj Sharma',
    emergencyContactPhone: '0422222222',
    payway: { status: 'active', weeklyAmount: 150, startDate: daysFromNow(-15) },
  },
  {
    name: 'Jake Morrison',
    phone: '0434567890',
    email: 'jake.morrison@outlook.com',
    licenceNumber: 'NSW345678',
    vehicleType: 'scooter',
    weeklyRate: 150,
    address: { street: '5 Harris St', city: 'Ultimo', state: 'NSW', postcode: '2007', country: 'Australia' },
    bankName: 'Westpac',
    accountHolderName: 'Jake Morrison',
    bsbNumber: '032000',
    accountNumber: '11223344',
    emergencyContactName: 'Sarah Morrison',
    emergencyContactPhone: '0433333333',
    payway: { status: 'active', weeklyAmount: 150, startDate: daysFromNow(-21) },
  },
  {
    name: 'Sofia Nguyen',
    phone: '0445678901',
    email: 'sofia.nguyen@gmail.com',
    licenceNumber: 'NSW456789',
    vehicleType: 'scooter',
    weeklyRate: 150,
    address: { street: '22 Crown St', city: 'Surry Hills', state: 'NSW', postcode: '2010', country: 'Australia' },
    bankName: 'NAB',
    accountHolderName: 'Sofia Nguyen',
    bsbNumber: '082001',
    accountNumber: '55667788',
    emergencyContactName: 'Minh Nguyen',
    emergencyContactPhone: '0444444444',
    payway: { status: 'active', weeklyAmount: 150, startDate: daysFromNow(-26) },
  },
  {
    name: 'Marcus Webb',
    phone: '0456789012',
    email: 'marcus.webb@gmail.com',
    licenceNumber: 'NSW567890',
    vehicleType: 'scooter',
    weeklyRate: 150,
    address: { street: '3 Church St', city: 'Newtown', state: 'NSW', postcode: '2042', country: 'Australia' },
    bankName: 'CommBank',
    accountHolderName: 'Marcus Webb',
    bsbNumber: '062000',
    accountNumber: '99887766',
    emergencyContactName: 'Kate Webb',
    emergencyContactPhone: '0455555555',
    payway: { status: 'active', weeklyAmount: 150, startDate: daysFromNow(-55) },
  },
  {
    name: 'Aisha Patel',
    phone: '0467890123',
    email: 'aisha.patel@yahoo.com',
    licenceNumber: 'NSW678901',
    vehicleType: 'scooter',
    weeklyRate: 150,
    address: { street: '15 Victoria Rd', city: 'Marrickville', state: 'NSW', postcode: '2204', country: 'Australia' },
    bankName: 'ANZ',
    accountHolderName: 'Aisha Patel',
    bsbNumber: '012003',
    accountNumber: '44556677',
    emergencyContactName: 'Dev Patel',
    emergencyContactPhone: '0466666666',
    payway: { status: 'active', weeklyAmount: 150, startDate: daysFromNow(-15) },
  },
  {
    name: 'Tom O\'Brien',
    phone: '0478901234',
    email: 'tom.obrien@gmail.com',
    licenceNumber: 'NSW789012',
    vehicleType: 'car',
    weeklyRate: 350,
    address: { street: '7 Miller St', city: 'North Sydney', state: 'NSW', postcode: '2060', country: 'Australia' },
    bankName: 'Westpac',
    accountHolderName: 'Tom O\'Brien',
    bsbNumber: '032000',
    accountNumber: '33221100',
    emergencyContactName: 'Claire O\'Brien',
    emergencyContactPhone: '0477777777',
    payway: { status: 'active', weeklyAmount: 350, startDate: daysFromNow(-30) },
  },
])
  console.log(`👥 Created ${renters.length} renters`)

  // ── Scooters (12 Honda Duo) ──────────────────────────────
  const scooterData = [
    {
      plate: 'EN23AB',
      model: 'Honda Duo',
      year: 2021,
      type: 'scooter' as const,
      status: 'rented' as const,
      renterIdx: 0,
      regoExpiry: daysFromNow(45),
      pinkSlip: daysFromNow(200),
      greenSlip: daysFromNow(45),
      lastService: daysFromNow(-60),
    },
    {
      plate: 'FP24CD',
      model: 'Honda Duo',
      year: 2022,
      type: 'scooter' as const,
      status: 'rented' as const,
      renterIdx: 1,
      regoExpiry: daysFromNow(15), // due soon!
      pinkSlip: daysFromNow(15),   // due soon!
      greenSlip: daysFromNow(15),
      lastService: daysFromNow(-90),
    },
    {
      plate: 'GT25EF',
      model: 'Honda Duo',
      year: 2021,
      type: 'scooter' as const,
      status: 'available' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(180),
      pinkSlip: daysFromNow(180),
      greenSlip: daysFromNow(180),
      lastService: daysFromNow(-30),
    },
    {
      plate: 'HK26GH',
      model: 'Honda Duo',
      year: 2023,
      type: 'scooter' as const,
      status: 'rented' as const,
      renterIdx: 2,
      regoExpiry: daysFromNow(-5), // EXPIRED!
      pinkSlip: daysFromNow(90),
      greenSlip: daysFromNow(-5), // EXPIRED!
      lastService: daysFromNow(-120),
      fineData: [
        { type: 'fine' as const, amount: 344, description: 'Speed camera — M2 Motorway', paid: false },
        { type: 'toll' as const, amount: 18.50, description: 'M7 Toll — unpaid', paid: false },
      ],
    },
    {
      plate: 'JL27IJ',
      model: 'Honda Duo',
      year: 2022,
      type: 'scooter' as const,
      status: 'service' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(90),
      pinkSlip: daysFromNow(-20), // EXPIRED!
      greenSlip: daysFromNow(90),
      lastService: daysFromNow(-180),
      notes: 'Engine overhaul — Mike\'s Garage, Parramatta',
    },
    {
      plate: 'KM28KL',
      model: 'Honda Duo',
      year: 2020,
      type: 'scooter' as const,
      status: 'available' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(270),
      pinkSlip: daysFromNow(270),
      greenSlip: daysFromNow(270),
      lastService: daysFromNow(-45),
    },
    {
      plate: 'LN29MN',
      model: 'Honda Duo',
      year: 2023,
      type: 'scooter' as const,
      status: 'rented' as const,
      renterIdx: 3,
      regoExpiry: daysFromNow(120),
      pinkSlip: daysFromNow(120),
      greenSlip: daysFromNow(120),
      lastService: daysFromNow(-15),
    },
    {
      plate: 'MP30OP',
      model: 'Honda Duo',
      year: 2021,
      type: 'scooter' as const,
      status: 'available' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(25), // due soon!
      pinkSlip: daysFromNow(200),
      greenSlip: daysFromNow(25),
      lastService: daysFromNow(-75),
      fineData: [
        { type: 'fine' as const, amount: 186, description: 'Parking infringement — City of Sydney', paid: true },
      ],
    },
    {
      plate: 'NQ31QR',
      model: 'Honda Duo',
      year: 2022,
      type: 'scooter' as const,
      status: 'rented' as const,
      renterIdx: 4,
      regoExpiry: daysFromNow(60),
      pinkSlip: daysFromNow(60),
      greenSlip: daysFromNow(60),
      lastService: daysFromNow(-55),
    },
    {
      plate: 'OR32ST',
      model: 'Honda Duo',
      year: 2020,
      type: 'scooter' as const,
      status: 'service' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(30),
      pinkSlip: daysFromNow(-10), // EXPIRED!
      greenSlip: daysFromNow(30),
      lastService: daysFromNow(-200),
      notes: 'Tyre replacement + brake pads',
    },
    {
      plate: 'PS33UV',
      model: 'Honda Duo',
      year: 2023,
      type: 'scooter' as const,
      status: 'available' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(365),
      pinkSlip: daysFromNow(365),
      greenSlip: daysFromNow(365),
      lastService: daysFromNow(-5),
    },
    {
      plate: 'QT34WX',
      model: 'Honda Duo',
      year: 2021,
      type: 'scooter' as const,
      status: 'rented' as const,
      renterIdx: 5,
      regoExpiry: daysFromNow(-15), // EXPIRED!
      pinkSlip: daysFromNow(150),
      greenSlip: daysFromNow(-15), // EXPIRED!
      lastService: daysFromNow(-100),
      fineData: [
        { type: 'toll' as const, amount: 9.80, description: 'Sydney Harbour Bridge — unpaid E-tag', paid: false },
        { type: 'toll' as const, amount: 9.80, description: 'Sydney Harbour Bridge — unpaid E-tag', paid: false },
        { type: 'fine' as const, amount: 247, description: 'Red light camera — Parramatta Rd', paid: false },
      ],
    },
  ]

  // ── Cars (5 vehicles) ────────────────────────────────────
  const carData = [
    {
      plate: 'BCJ22AA',
      model: 'Toyota Corolla',
      year: 2022,
      type: 'car' as const,
      status: 'rented' as const,
      renterIdx: 6,
      regoExpiry: daysFromNow(200),
      pinkSlip: daysFromNow(200),
      greenSlip: daysFromNow(200),
      lastService: daysFromNow(-30),
    },
    {
      plate: 'DCK23BB',
      model: 'Hyundai i30',
      year: 2021,
      type: 'car' as const,
      status: 'available' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(10), // due soon!
      pinkSlip: daysFromNow(10),
      greenSlip: daysFromNow(10),
      lastService: daysFromNow(-60),
      fineData: [
        { type: 'fine' as const, amount: 469, description: 'Speed camera — Pacific Hwy 20km/h over', paid: false },
      ],
    },
    {
      plate: 'EFL24CC',
      model: 'Mazda 3',
      year: 2023,
      type: 'car' as const,
      status: 'available' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(300),
      pinkSlip: daysFromNow(300),
      greenSlip: daysFromNow(300),
      lastService: daysFromNow(-10),
    },
    {
      plate: 'FGM25DD',
      model: 'Kia Cerato',
      year: 2022,
      type: 'car' as const,
      status: 'service' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(150),
      pinkSlip: daysFromNow(150),
      greenSlip: daysFromNow(150),
      lastService: daysFromNow(-365),
      notes: '40,000km service overdue — Harry\'s Auto, Blacktown',
    },
    {
      plate: 'GHN26EE',
      model: 'Nissan Pulsar',
      year: 2020,
      type: 'car' as const,
      status: 'available' as const,
      renterIdx: null,
      regoExpiry: daysFromNow(-30), // EXPIRED!
      pinkSlip: daysFromNow(-30),   // EXPIRED!
      greenSlip: daysFromNow(-30),  // EXPIRED!
      lastService: daysFromNow(-250),
      fineData: [
        { type: 'fine' as const, amount: 344, description: 'Speed camera — M4 Motorway', paid: false },
        { type: 'fine' as const, amount: 186, description: 'Parking — Surry Hills Council', paid: true },
      ],
    },
  ]

  const allVehicleData = [...scooterData, ...carData]

  for (const vd of allVehicleData) {
    const { renterIdx, fineData, ...vehicleFields } = vd as any

    const vehicle = new Vehicle(vehicleFields)

    // Assign renter
    if (renterIdx !== null && renters[renterIdx]) {
    vehicle.currentRenter = renters[renterIdx]._id as any
    vehicle.rentStartDate = daysFromNow(-renterIdx * 7 - 5)
    // Link renter back to vehicle
    renters[renterIdx].currentVehicle = vehicle._id as any
    renters[renterIdx].rentStartDate = daysFromNow(-renterIdx * 7 - 5)
    await renters[renterIdx].save()
  }

    // Create fines
    if (fineData && fineData.length > 0) {
      const createdFines = await Fine.insertMany(
        fineData.map((f: any) => ({
          ...f,
          vehicle: vehicle._id,
          date: daysFromNow(-Math.floor(Math.random() * 60) - 5),
        }))
      )
      vehicle.fines = createdFines
        .filter((f) => f.type === 'fine')
        .map((f) => f._id) as any
      vehicle.tolls = createdFines
        .filter((f) => f.type === 'toll')
        .map((f) => f._id) as any
    }

    await vehicle.save()
  }

  console.log(`🚗 Created ${carData.length} cars`)
  console.log(`🛵 Created ${scooterData.length} scooters`)

  // ── Notifications ────────────────────────────────────────
  await Notification.insertMany([
    {
      type: 'rego',
      title: 'Rego EXPIRED — HK26GH',
      description: 'Registration for HK26GH (Honda Duo) expired 5 days ago. Do not rent until renewed.',
      plate: 'HK26GH',
      read: false,
      actionRequired: true,
    },
    {
      type: 'rego',
      title: 'Rego EXPIRED — QT34WX',
      description: 'Registration for QT34WX (Honda Duo) expired 15 days ago. Currently rented by Aisha Patel.',
      plate: 'QT34WX',
      read: false,
      actionRequired: true,
    },
    {
      type: 'rego',
      title: 'Rego EXPIRED — GHN26EE',
      description: 'Registration for GHN26EE (Nissan Pulsar) expired 30 days ago. Vehicle not roadworthy.',
      plate: 'GHN26EE',
      read: false,
      actionRequired: true,
    },
    {
      type: 'rego',
      title: 'Rego expiring soon — FP24CD',
      description: 'Registration for FP24CD (Honda Duo) expires in 15 days. Book renewal now.',
      plate: 'FP24CD',
      read: false,
      actionRequired: true,
    },
    {
      type: 'rego',
      title: 'Rego expiring soon — DCK23BB',
      description: 'Registration for DCK23BB (Hyundai i30) expires in 10 days.',
      plate: 'DCK23BB',
      read: false,
      actionRequired: true,
    },
    {
      type: 'fine',
      title: 'New fine — QT34WX',
      description: 'Red light camera fine of $247 on Parramatta Rd. Renter: Aisha Patel.',
      plate: 'QT34WX',
      read: false,
      actionRequired: true,
    },
    {
      type: 'fine',
      title: 'Speed camera fine — HK26GH',
      description: '$344 fine from M2 Motorway speed camera. Renter: Jake Morrison.',
      plate: 'HK26GH',
      read: false,
      actionRequired: false,
    },
    {
      type: 'toll',
      title: 'Unpaid tolls — QT34WX',
      description: '2x Sydney Harbour Bridge E-tag tolls unpaid ($19.60 total). Renter: Aisha Patel.',
      plate: 'QT34WX',
      read: true,
      actionRequired: false,
    },
    {
      type: 'info',
      title: 'Pink slip EXPIRED — JL27IJ',
      description: 'Pink slip for JL27IJ expired 20 days ago. Vehicle currently in service.',
      plate: 'JL27IJ',
      read: false,
      actionRequired: true,
    },
    {
      type: 'info',
      title: 'Vehicle sent to service — JL27IJ',
      description: 'Honda Duo JL27IJ sent to Mike\'s Garage, Parramatta for engine overhaul.',
      plate: 'JL27IJ',
      read: true,
      actionRequired: false,
    },
    {
      type: 'whatsapp',
      title: 'WhatsApp — Liam Chen',
      description: '"Hi, can I extend my rental for another week? The scooter is running great."',
      read: false,
      actionRequired: false,
    },
    {
      type: 'whatsapp',
      title: 'WhatsApp — Jake Morrison',
      description: '"Just letting you know the scooter got a little scratch on the left mirror. Should I pay for it?"',
      plate: 'HK26GH',
      read: false,
      actionRequired: true,
    },
  ])
  console.log('🔔 Created 12 notifications')

  console.log('\n✅ Seed complete! Run the server and open the app to see your fleet.')
  await mongoose.disconnect()
}

seed().catch((err) => {
  console.error('Seed error:', err)
  process.exit(1)
})
