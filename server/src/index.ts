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
import { checkGmailForFines } from './services/gmail'
import adminRoutes from './routes/admin'


dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fleetai'

// ── Middleware ──────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://fleetai-tau.vercel.app',
    'https://fleetai-git-main-manmpatels-projects.vercel.app'
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
app.use('/api/fleet', fleetRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/whatsapp', whatsappRouter)
app.use('/api/renters', renterRoutes)
app.use('/api/admin', adminRoutes)

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
  .connect(MONGO_URI)
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
    cron.schedule('0 8 * * *', async () => {
      console.log('⏰ Running daily expiry check...')
      await checkExpiringDates()
    })

    // Run expiry check once on startup too
    checkExpiringDates().catch(console.error)
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err)
    process.exit(1)
  })
