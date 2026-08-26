import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import path from 'path'
import cron from 'node-cron'
import rateLimit from 'express-rate-limit'

import fleetRoutes from './routes/fleet'
import notificationRoutes from './routes/notifications'
import chatRoutes from './routes/chat'
import uploadRoutes from './routes/upload'
import whatsappRouter from './services/whatsapp'
import renterRoutes from './routes/renters'
import adminRoutes from './routes/admin'
import searchRoutes from './routes/search'
import serviceRecordRoutes from './routes/serviceRecords'
import employeeRoutes from './routes/employees'
import invoiceRoutes from './routes/invoices'
import tabletRoutes from './routes/tablet'
import settingsRoutes from './routes/settings'
import ClockRecord from './models/ClockRecord'
import Renter from './models/Renter'

import { checkExpiringDates, checkPaymentStatus } from './services/rag'
import { runMongoBackup } from './services/backup'
import { checkGmailForFines } from './services/gmail'
import { requireAuth, requireAdmin } from './middleware/auth'
import {
  requireTenant,
  registerOrganization,
  getOrganizationStatus,
  getOrganizationSlug,
  setOrganizationSlug,
  resolveSlug,
} from './middleware/tenant'


dotenv.config()

const app = express()
app.set('trust proxy', 1)

const PORT = process.env.PORT || 5000
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fleetai'

// ── CORS ────────────────────────────────────────────────────
// Tenants may be served from their own domains, so the allowlist is configuration.
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'https://fleetai-tau.vercel.app',
  'https://fleetai-git-main-manmpatels-projects.vercel.app',
  'https://fleetai.co.in',
  'https://www.fleetai.co.in',
]
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_ORIGINS,
  credentials: true,
}))

// ── Body parsing ────────────────────────────────────────────
// Raw body needed for WhatsApp webhook signature validation
app.use('/api/whatsapp', express.raw({ type: 'application/x-www-form-urlencoded' }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.body = Object.fromEntries(new URLSearchParams(req.body.toString()))
  }
  next()
})
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// ── Rate limiting ───────────────────────────────────────────
// Public surfaces get two buckets: one keyed on the tenant being targeted, so one
// tenant's traffic cannot rate-limit another off the platform, and one keyed on the
// caller by the library's default (IPv6-aware) generator.
const onboardPerTenantLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  keyGenerator: (req) => `slug:${req.body?.slug || 'unknown'}`,
  message: { error: 'Too many submissions, please try again later' },
})

const onboardPerCallerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many submissions, please try again later' },
})

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many messages, please slow down' },
})

const tabletLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => (req.headers.authorization as string) || 'unlinked',
  message: { error: 'Too many requests, please try again later' },
})

// A 4-digit PIN is 10k wide — without this it is brute-forceable in seconds.
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.headers.authorization as string) || 'unlinked',
  message: { error: 'Too many PIN attempts, please wait before trying again' },
})

// ── Public routes (no login) ────────────────────────────────
app.get('/api/auth/resolve/:slug', resolveSlug)
app.use('/api/whatsapp', whatsappRouter)
app.post('/api/tablet/verify-pin', pinLimiter)
app.use('/api/tablet', tabletLimiter, tabletRoutes)

// ── Authenticated routes ────────────────────────────────────
app.post('/api/auth/register', requireAuth, registerOrganization)
app.get('/api/auth/status', requireAuth, getOrganizationStatus)
app.get('/api/auth/slug', requireAuth, requireTenant, getOrganizationSlug)
app.post('/api/auth/slug', requireAuth, requireTenant, setOrganizationSlug)

app.use('/api/settings', requireAuth, requireTenant, settingsRoutes)
app.use('/api/fleet', requireAuth, requireTenant, fleetRoutes)
app.use('/api/notifications', requireAuth, requireTenant, notificationRoutes)
app.use('/api/chat', chatLimiter, requireAuth, requireTenant, chatRoutes)
app.use('/api/search', requireAuth, requireTenant, searchRoutes)
app.use('/api/service-records', requireAuth, requireTenant, serviceRecordRoutes)
app.use('/api/employees', requireAuth, requireTenant, employeeRoutes)
app.use('/api/upload', requireAuth, requireTenant, uploadRoutes)
app.use('/api/invoices', requireAuth, requireTenant, invoiceRoutes)

// Renters router carves out its own public onboarding endpoint before applying auth.
app.post('/api/renters/public/onboard', onboardPerCallerLimiter, onboardPerTenantLimiter)
app.use('/api/renters', renterRoutes)

// Platform operator only.
app.use('/api/admin', requireAuth, requireAdmin, adminRoutes)

// ── Health check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      gemini: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_key_here',
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
      if (!process.env.SUPER_ADMIN_EMAIL) {
        console.warn('   ⚠️  SUPER_ADMIN_EMAIL not set — platform admin routes are closed to everyone')
      }
    })

    // ── Cron jobs ─────────────────────────────────────────
    // Each of these fans out per tenant internally.
    cron.schedule('0 * * * *', () => {
      checkGmailForFines().catch(console.error)
    })

    cron.schedule('0 8 * * *', () => {
      console.log('⏰ Running daily expiry check...')
      checkExpiringDates().catch(console.error)
    })

    // Re-pause all paused renters monthly (prevents PayWay 364-day auto-resume)
    cron.schedule('0 3 1 * *', async () => {
      console.log('🔄 Re-pausing all paused renters...')
      const { pauseDebit, paywayCredsFor } = await import('./services/payway')
      const Organization = (await import('./models/Organization')).default
      const paused = await Renter.find({ 'payway.status': 'paused', 'payway.customerId': { $exists: true } })
        .setOptions({ allowCrossTenant: true })
      for (const renter of paused) {
        const org = await Organization.findById(renter.orgId)
        if (!org) continue
        await pauseDebit(paywayCredsFor(org), renter.payway!.customerId!, renter.payway!.weeklyAmount || 10)
        console.log(`✅ Re-paused: ${renter.name}`)
      }
      console.log(`✅ Done — ${paused.length} renters re-paused`)
    })

    // Delete employee selfie photos older than 10 days — daily at 3am
    cron.schedule('0 3 * * *', async () => {
      try {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 10)
        const result = await ClockRecord.updateMany(
          { createdAt: { $lt: cutoff }, selfieBase64: { $exists: true } },
          { $unset: { selfieBase64: '' } }
        ).setOptions({ allowCrossTenant: true })
        console.log(`🗑️ Cleared ${result.modifiedCount} old employee selfies`)
      } catch (err) { console.error('Selfie cleanup error:', err) }
    })

    cron.schedule('0 2 * * 0', () => {
      console.log('🗄️ Running weekly MongoDB backup...')
      runMongoBackup()
    })

    // Payment status check — daily at 9am Sydney time (UTC 23:00)
    cron.schedule('0 23 * * *', () => {
      console.log('💳 Running daily payment status check...')
      checkPaymentStatus().catch(console.error)
    })

    // Daily PayWay schedule sync — 9am Sydney time (UTC 23:00), catches drift outside payment days
    cron.schedule('0 23 * * *', async () => {
      console.log('📅 Running daily PayWay schedule sync...')
      try {
        const { getCustomerSchedule, paywayCredsFor } = await import('./services/payway')
        const Organization = (await import('./models/Organization')).default
        const activeRenters = await Renter.find({
          'payway.status': 'active',
          'payway.customerId': { $exists: true, $ne: '' },
        }).setOptions({ allowCrossTenant: true })

        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        const fmt = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

        let synced = 0, conflicts = 0, errors = 0
        const orgCache = new Map<string, any>()

        for (const renter of activeRenters) {
          try {
            const key = String(renter.orgId)
            if (!orgCache.has(key)) orgCache.set(key, await Organization.findById(renter.orgId))
            const org = orgCache.get(key)
            if (!org) { errors++; continue }

            await new Promise(r => setTimeout(r, 300))
            const result = await getCustomerSchedule(paywayCredsFor(org), renter.payway!.customerId!)

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
