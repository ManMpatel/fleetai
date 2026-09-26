import { GoogleGenerativeAI } from '@google/generative-ai'

// Central place for the Gemini model name — a future deprecation only needs this one
// line changed instead of every call site.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'

const MAX_RETRIES = 2
const RETRY_BACKOFF_MS = 3000   // wait before retrying after a rate-limit/transient error
const PACING_DELAY_MS = 300     // small gap between calls in a bulk loop, paid-tier pacing

function isRetryableError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase()
  return err?.status === 429 || msg.includes('429') || msg.includes('rate limit') ||
         msg.includes('quota') || msg.includes('unavailable') || msg.includes('timeout')
}

/**
 * Wraps model.generateContent with retry on rate-limit/transient errors ONLY. A genuine
 * "can't read this" result from Gemini (a successful call, just with plate: null in the
 * JSON) is not an error and is never retried here — only failed calls retry, so a busy
 * moment on Google's side never gets mis-filed as "unrecognized."
 */
export async function generateWithRetry(model: any, parts: any[]): Promise<any> {
  let lastErr: any
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await model.generateContent(parts)
    } catch (err: any) {
      lastErr = err
      if (!isRetryableError(err) || attempt === MAX_RETRIES) throw err
      console.warn(`Gemini call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${RETRY_BACKOFF_MS}ms:`, err.message)
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS))
    }
  }
  throw lastErr
}

export async function geminiPacingDelay(): Promise<void> {
  await new Promise(r => setTimeout(r, PACING_DELAY_MS))
}

// Suppress unused-import warning — exported for call sites that construct their own model
export { GoogleGenerativeAI }
