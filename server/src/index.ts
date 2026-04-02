import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import path from 'path'
import cron from 'node-cron'

import fleetRoutes from './routes/fleet'
import notificationRoutes from './routes/notifications'
import chatRoutes from './routes/chat'
import uploadRoutes from './routes/upload'
import whatsappRouter from './services/whatsapp'
import renterRoutes from './routes/renters'
import { checkExpiringDates } from './services/rag'
import { runMongoBackup } from './services/backup'
import { requireAuth, requireAdmin } from './middleware/auth'
import { checkGmailForFines } from './services/gmail'
import adminRoutes from './routes/admin'
import searchRoutes from './routes/search'
import serviceRecordRoutes from './routes/serviceRecords'
import { registerOwner, getOwnerStatus } from './middleware/ownerAuth'
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

app.use('/api/', generalLimiter)
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
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// ── Routes ──────────────────────────────────────────────────
app.use('/api/fleet', requireAuth, fleetRoutes)
app.use('/api/notifications', requireAuth, notificationRoutes)
app.use('/api/chat', requireAuth, chatRoutes)
app.use('/api/upload/fine', requireAuth, uploadRoutes)
app.use('/api/upload/document', uploadRoutes)
app.use('/api/whatsapp', whatsappRouter)
app.use('/api/renters', requireAuth, renterRoutes)
app.use('/api/admin', requireAuth, requireAdmin, adminRoutes)
app.use('/api/search', requireAuth, searchRoutes)
app.use('/api/service-records', requireAuth, serviceRecordRoutes)
app.post('/api/auth/register', registerOwner)
app.get('/api/auth/status', getOwnerStatus)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      gemini: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_key_here',
      gmail: !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN),
      twilio: !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN),
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
      console.log(`   Twilio:  ${process.env.TWILIO_SID ? '✅' : '❌ not configured'}`)
    })

    // ── Cron jobs ─────────────────────────────────────────
    // Gmail check — every 2 minutes
    cron.schedule('0 * * * *', async () => {
      await checkGmailForFines()
    })

    // Rego/Pink slip expiry check — daily at 8am Sydney time
    cron.schedule('0 8 * * *', () => {
    console.log('⏰ Running daily expiry check...')
    checkExpiringDates()
  })

  // Daily backup at 2am Sydney time
  cron.schedule('0 2 * * *', () => {
    console.log('🗄️ Running daily MongoDB backup...')
    runMongoBackup()
  })

    // Run expiry check once on startup too
    checkExpiringDates().catch(console.error)
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err)
    process.exit(1)
  })




  

  // hii