import { GoogleGenerativeAI } from '@google/generative-ai'

// Central place for the Gemini model name — a future deprecation only needs this one
// line changed instead of every call site.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'

const MAX_RETRIES = 2
const RETRY_BACKOFF_MS = 3000   // wait before retrying after a rate-limit/transient error
const PACING_DELAY_MS = 4100    // ~14 req/min — matches Rego Import's bulk-scan pacing
const GEMINI_CALL_TIMEOUT_MS = 30000  // abort any single Gemini call that hangs beyond 30s

// Sentinel so isRetryableError can distinguish our own timeout from SDK errors.
class GeminiTimeoutError extends Error {
  readonly isGeminiTimeout = true
  constructor() { super('Gemini did not respond within 30s') }
}

export function isRetryableError(err: any): boolean {
  if ((err as any)?.isGeminiTimeout) return false  // don't retry our own timeout — it'll just hang again
  const msg = String(err?.message || '').toLowerCase()
  return err?.status === 429 || msg.includes('429') || msg.includes('rate limit') ||
         msg.includes('quota') || msg.includes('unavailable') || msg.includes('timeout')
}

/**
 * Wraps model.generateContent with:
 *   - A 30s hard timeout per attempt (GeminiTimeoutError) so a hung call never freezes the batch.
 *   - Retry on rate-limit/transient errors ONLY. A genuine "can't read this" result from
 *     Gemini (a successful call with plates:[]) is not an error and is never retried here.
 */
export async function generateWithRetry(model: any, parts: any[]): Promise<any> {
  let lastErr: any
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const callPromise = model.generateContent(parts)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new GeminiTimeoutError()), GEMINI_CALL_TIMEOUT_MS)
      )
      return await Promise.race([callPromise, timeoutPromise])
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
