import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import path from 'path'
import cron from 'node-cron'
import { pauseDebit } from './services/payway'
import Owner from './models/Owner'
import { decrypt } from './services/encryption'

import fleetRoutes from './routes/fleet'
import notificationRoutes from './routes/notifications'
import chatRoutes from './routes/chat'
import uploadRoutes from './routes/upload'
import whatsappRouter from './services/whatsapp'
import renterRoutes from './routes/renters'
import { checkExpiringDates, checkPaymentStatus } from './services/rag'
import { runMongoBackup } from './services/backup'
import { requireAuth, requireAdmin } from './middleware/auth'
import { checkGmailForFines } from './services/gmail'
import adminRoutes from './routes/admin'
import searchRoutes from './routes/search'
import serviceRecordRoutes from './routes/serviceRecords'
import employeeRoutes from './routes/employees'
import ClockRecord from './models/ClockRecord'
import Renter from './models/Renter'
import Notification from './models/Notification'
import axios from 'axios'
import { registerOwner, getOwnerStatus, getOwnerSlug, setOwnerSlug, resolveSlug, getBusinessName, setBusinessName, getPayWaySettings, setPayWaySettings } from './middleware/ownerAuth'
import rateLimit from 'express-rate-limit'


dotenv.config()

const app = express();
app.set('trust proxy', 1);

// ── Rate limiting ───────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later' }
})

const onboardLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many submissions, please try again later' }
})

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many messages, please slow down' }
})

// Only limit the public-facing routes — owner dashboard routes are protected by JWT anyway
app.post('/api/renters', onboardLimiter)
app.use('/api/chat', chatLimiter)
const PORT = process.env.PORT || 5000
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fleetai'

// ── Middleware ──────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://fleetai-tau.vercel.app',
    'https://fleetai-git-main-manmpatels-projects.vercel.app',
    'https://fleetai.co.in',
    'https://www.fleetai.co.in'
  ],
  credentials: true
}))
// Raw body needed for Twilio signature validation
app.use('/api/whatsapp', express.raw({ type: 'application/x-www-form-urlencoded' }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.body = Object.fromEntries(new URLSearchParams(req.body.toString()))
  }
  next()
})
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// ── Routes ──────────────────────────────────────────────────
app.use('/api/fleet', requireAuth, fleetRoutes)
app.use('/api/notifications', requireAuth, notificationRoutes)
app.use('/api/chat', requireAuth, chatRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/whatsapp', whatsappRouter)
app.post('/api/renters', renterRoutes)
app.use('/api/renters', renterRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/search', requireAuth, searchRoutes)
app.use('/api/service-records', requireAuth, serviceRecordRoutes)
app.use('/api/employees', employeeRoutes)
app.post('/api/auth/register', registerOwner)
app.get('/api/auth/status', getOwnerStatus)
app.get('/api/auth/slug', getOwnerSlug)
app.post('/api/auth/slug', setOwnerSlug)
app.get('/api/auth/resolve/:slug', resolveSlug)
app.get('/api/auth/business-name', getBusinessName)
app.post('/api/auth/business-name', setBusinessName)
app.get('/api/auth/payway-settings', getPayWaySettings)
app.post('/api/auth/payway-settings', setPayWaySettings)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
        gemini: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_key_here',
        gmail: !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN),
        whatsapp: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
      },
  })
})

// ── MongoDB + server start ──────────────────────────────────
mongoose
  .connect(MONGO_URI, { dbName: 'fleetai' })
  .then(() => {
    console.log('✅ MongoDB connected')

    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`🚀 FleetAI server running on http://localhost:${PORT}`)
      console.log(`   Gemini:  ${process.env.GEMINI_API_KEY !== 'your_key_here' ? '✅' : '❌ not configured'}`)
      console.log(`   Gmail:   ${process.env.GMAIL_CLIENT_ID ? '✅' : '❌ not configured'}`)
    })

    // ── Cron jobs ─────────────────────────────────────────

    // Re-pause all paused renters monthly (prevents PayWay 364-day auto-resume)
cron.schedule('0 3 1 * *', async () => {
  console.log('🔄 Re-pausing all paused renters...')
  const paused = await Renter.find({ 'payway.status': 'paused', 'payway.customerId': { $exists: true } })
  for (const renter of paused) {
    const owner = await Owner.findOne({ email: renter.ownerId })
    const keys = (owner as any)?.paywaySecretKey ? {
      secretKey:      decrypt((owner as any).paywaySecretKey),
      publishableKey: decrypt((owner as any).paywayPublishableKey),
      merchantId:     decrypt((owner as any).paywayMerchantId),
      bankAccountId:  decrypt((owner as any).paywayBankAccountId),
    } : undefined
    await pauseDebit(renter.payway!.customerId!, renter.payway!.weeklyAmount || 10, keys)
    console.log(`✅ Re-paused: ${renter.name}`)
  }
  console.log(`✅ Done — ${paused.length} renters re-paused`)
})

    // Gmail not configured — skipping cron
// cron.schedule('0 * * * *', async () => {
//   await checkGmailForFines()
// })

    // Rego/Pink slip expiry check — daily at 8am Sydney time
    cron.schedule('0 8 * * *', () => {
    console.log('⏰ Running daily expiry check...')
    checkExpiringDates()
  })

  // Delete employee selfie photos older than 10 days — daily at 3am
  cron.schedule('0 3 * * *', async () => {
    try {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 10)
      const result = await ClockRecord.updateMany(
        { createdAt: { $lt: cutoff }, selfieBase64: { $exists: true } },
        { $unset: { selfieBase64: '' } }
      )
      console.log(`🗑️ Cleared ${result.modifiedCount} old employee selfies`)
    } catch (err) { console.error('Selfie cleanup error:', err) }
  })

  // Weekly backup — every Sunday at 2am Sydney time
  cron.schedule('0 2 * * 0', () => {
    console.log('🗄️ Running weekly MongoDB backup...')
    runMongoBackup()
  })

  // Payment status check — daily at 9am Sydney time
  cron.schedule('0 23 * * *', () => {
    console.log('💳 Running daily payment status check...')
    checkPaymentStatus()
  })


  // Daily PayWay schedule sync — 9am Sydney time (UTC 23:00)
  cron.schedule('0 23 * * *', async () => {
    console.log('📅 Running daily PayWay schedule sync...')
    try {
      const { getCustomerSchedule } = await import('./services/payway')
      const activeRenters = await Renter.find({
        'payway.status': 'active',
        'payway.customerId': { $exists: true, $ne: '' }
      })

      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      const fmt = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

      let synced = 0, conflicts = 0, errors = 0

      for (const renter of activeRenters) {
        try {
          await new Promise(r => setTimeout(r, 300))
          const result = await getCustomerSchedule(renter.payway!.customerId!)

          if (!result.success || !result.nextPaymentDate) {
            console.log(`⚠️  ${renter.name} (${renter.payway!.customerId}) — PayWay returned no schedule`)
            errors++
            continue
          }

          const paywayDate = new Date(result.nextPaymentDate)
          paywayDate.setHours(0, 0, 0, 0)

          const dbDate = renter.payway!.nextDebitDate ? new Date(renter.payway!.nextDebitDate) : null
          if (dbDate) dbDate.setHours(0, 0, 0, 0)

          const dbStr = dbDate ? fmt(dbDate) : 'none'
          const paywayStr = fmt(paywayDate)

          if (!dbDate || dbDate.getTime() !== paywayDate.getTime()) {
            renter.payway!.nextDebitDate = paywayDate
            await renter.save()
            console.log(`🔄 CONFLICT — ${renter.name}: DB had ${dbStr}, PayWay says ${paywayStr} → updated`)
            conflicts++
          } else {
            console.log(`✅ IN SYNC — ${renter.name}: ${paywayStr}`)
            synced++
          }
        } catch (err: any) {
          console.error(`❌ Schedule sync failed for ${renter.name}:`, err.message)
          errors++
        }
      }

      console.log(`📅 PayWay schedule sync complete — ✅ ${synced} in sync, 🔄 ${conflicts} updated, ❌ ${errors} errors`)
    } catch (err: any) {
      console.error('❌ PayWay schedule sync cron error:', err.message)
    }
  })

    // Run expiry check once on startup too
    checkExpiringDates().catch(console.error)
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err)
    process.exit(1)
  })

