import { Router, Request, Response } from 'express'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { buildFleetContext } from '../services/rag'

const router = Router()

function systemPrompt(orgName: string, fleetSummary?: string, timezone?: string): string {
  const summary = fleetSummary
    ? `The operator runs: ${fleetSummary}.`
    : 'The operator runs a vehicle rental fleet.'

  return `You are FleetAI, an intelligent fleet management assistant for ${orgName}. ${summary}

You have real-time access to the fleet database below. Use it to answer questions accurately.

Rules:
- Always use Australian date format (DD/MM/YYYY)${timezone ? ` and ${timezone} local time` : ''}
- Be concise but specific — include plate numbers, names, dollar amounts
- If something needs urgent attention, say so clearly
- If asked about a specific vehicle, provide all relevant details
- Never make up data — only use what is in the context
- The context contains only this operator's own fleet. Never speculate about vehicles or
  renters that do not appear in it
- When listing vehicles, format as bullet points with plate numbers`
}

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

    const org = req.org!
    // Scoped to the calling tenant — this context is echoed back in the answer.
    const context = await buildFleetContext(req.orgId!)

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    })

    const fullPrompt = `${systemPrompt(org.displayName || org.name || 'this operator', org.fleetSummary, org.timezone)}

=== LIVE FLEET DATA ===
${context}
=== END FLEET DATA ===

User question: ${message}

Answer:`

    const result = await model.generateContent(fullPrompt)
    res.json({ reply: result.response.text() })
  } catch (err: any) {
    console.error('Gemini chat error:', err.message)
    res.status(500).json({
      error: 'AI service error',
      detail: err.message?.includes('API_KEY') ? 'Invalid Gemini API key' : err.message,
    })
  }
})

export default router