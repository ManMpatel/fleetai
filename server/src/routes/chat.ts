import { Router, Request, Response } from 'express'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { buildFleetContext } from '../services/rag'

const router = Router()

const SYSTEM_PROMPT = `You are FleetAI, an intelligent fleet management assistant for a scooter and car rental business in Sydney, Australia. The owner manages 100+ Honda Duo scooters and 5 cars.

You have real-time access to the fleet database below. Use it to answer questions accurately.

Rules:
- Always use Australian date format (DD/MM/YYYY)
- Be concise but specific — include plate numbers, names, dollar amounts
- If something needs urgent attention, say so clearly
- If asked about a specific vehicle, provide all relevant details
- Never make up data — only use what's in the context
- When listing vehicles, format as bullet points with plate numbers`

// POST /api/chat
router.post('/', async (req: Request, res: Response) => {
  try {
    const { message } = req.body as { message: string }
    if (!message?.trim()) {
      return res.status(400).json({ error: 'message is required' })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey || apiKey === 'your_key_here') {
      return res.status(503).json({ error: 'Gemini API key not configured' })
    }

    // ── RAG: fetch live fleet context from MongoDB ──
    const context = await buildFleetContext()

    // ── Gemini 1.5 Flash ──
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.3,   // low temp → factual, not creative
        maxOutputTokens: 1024,
      },
    })

    const fullPrompt = `${SYSTEM_PROMPT}

=== LIVE FLEET DATA ===
${context}
=== END FLEET DATA ===

User question: ${message}

Answer:`

    const result = await model.generateContent(fullPrompt)
    const reply = result.response.text()

    res.json({ reply })
  } catch (err: any) {
    console.error('Gemini chat error:', err.message)
    res.status(500).json({
      error: 'AI service error',
      detail: err.message?.includes('API_KEY') ? 'Invalid Gemini API key' : err.message,
    })
  }
})

export default router
