import crypto from 'crypto'
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3'

// Toll Batch files (the scanned PDF, the PDF for each plate, the pictures of pages that need a
// look) can live in an S3 bucket instead of MongoDB. MongoDB is billed by the size of its
// cluster, S3 by the gigabyte, so keeping the files here keeps the database small.
//
// It is switched on by one setting, AWS_TOLL_BUCKET. With no bucket set nothing here is used
// and the files stay in MongoDB (GridFS) exactly as they do today.
//
// Settings (all in the server's .env):
//   AWS_TOLL_BUCKET             bucket name - turns this on
//   AWS_TOLL_REGION             optional, default AWS_REGION, then ap-southeast-2
//   AWS_TOLL_ENDPOINT           optional, only for an S3-compatible service that is not AWS (for example Cloudflare R2)
//   AWS_TOLL_ACCESS_KEY_ID /    optional, default AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
//   AWS_TOLL_SECRET_ACCESS_KEY
//   TOLL_STORAGE=gridfs         optional kill switch: new files go back to MongoDB (files already in S3 still open)
//   TOLL_LINKS=off              optional: the browser downloads through the server instead of straight from S3

export interface TollS3Config {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
}

/** The S3 settings, or null when no toll bucket (or no keys) are set. */
export function tollS3Config(): TollS3Config | null {
  const bucket = (process.env.AWS_TOLL_BUCKET || '').trim()
  const accessKeyId = (process.env.AWS_TOLL_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = (process.env.AWS_TOLL_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '').trim()
  if (!bucket || !accessKeyId || !secretAccessKey) return null
  const region = (process.env.AWS_TOLL_REGION || process.env.AWS_REGION || 'ap-southeast-2').trim()
  const endpoint = (process.env.AWS_TOLL_ENDPOINT || '').trim().replace(/\/+$/, '') || undefined
  return { bucket, region, endpoint, accessKeyId, secretAccessKey }
}

function configOrThrow(): TollS3Config {
  const cfg = tollS3Config()
  if (!cfg) throw new Error('Toll storage (S3) is not configured')
  return cfg
}

// One client is kept for as long as the settings stay the same (they only change when the server
// is restarted with a new .env, or in tests).
let client: S3Client | null = null
let clientFor = ''
function s3(): { c: S3Client; cfg: TollS3Config } {
  const cfg = configOrThrow()
  const id = [cfg.bucket, cfg.region, cfg.endpoint ?? '', cfg.accessKeyId, cfg.secretAccessKey].join('|')
  if (!client || clientFor !== id) {
    client = new S3Client({
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // A stuck connection must not hang an upload for ever: give up connecting after 10 s and
      // after 2 minutes of silence on an open connection.
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
      ...(cfg.endpoint
        ? {
            endpoint: cfg.endpoint,
            forcePathStyle: true,
            // Services other than AWS often reject the extra checksum headers newer SDKs add.
            requestChecksumCalculation: 'WHEN_REQUIRED' as const,
            responseChecksumValidation: 'WHEN_REQUIRED' as const,
          }
        : {}),
    })
    clientFor = id
  }
  return { c: client, cfg }
}

// -- Object keys -------------------------------------------------------------
// Everything of one batch sits under toll/<business>/<batch>/, so one business's files can be
// counted or removed on their own and one business can never reach another's.
export const tollKeys = {
  batchPrefix: (orgId: string, batchId: string) => `toll/${orgId}/${batchId}/`,
  original: (orgId: string, batchId: string) => `toll/${orgId}/${batchId}/original.pdf`,
  // The page list the PDF was cut from is part of the name, so a PDF can never be mistaken for a newer one.
  folderPdf: (orgId: string, batchId: string, folderId: string, sig: string) => `toll/${orgId}/${batchId}/folders/${folderId}-${sig}.pdf`,
  pageImage: (orgId: string, batchId: string, pageNumber: number) => `toll/${orgId}/${batchId}/pages/${pageNumber}.jpg`,
}

// -- Plain file operations ---------------------------------------------------
export async function tollS3Put(key: string, body: Buffer, contentType: string): Promise<void> {
  const { c, cfg } = s3()
  await c.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }))
}

export async function tollS3Get(key: string): Promise<Buffer> {
  const { c, cfg } = s3()
  const out = await c.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
  if (!out.Body) throw new Error(`S3 returned no data for ${key}`)
  return Buffer.from(await out.Body.transformToByteArray())
}

export async function tollS3Exists(key: string): Promise<boolean> {
  const { c, cfg } = s3()
  try {
    await c.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
    return true
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false
    throw err
  }
}

export async function tollS3Delete(key: string): Promise<void> {
  const { c, cfg } = s3()
  await c.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
}

// The only thing ever deleted in bulk is ONE batch's folder: toll/<business>/<batch>/. Anything
// shorter (all of toll/, one whole business) or odd-looking is refused, whoever asks.
const BATCH_PREFIX = /^toll\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\/$/

/** Deletes every file under one batch's prefix (toll/<business>/<batch>/). Returns how many were removed. */
export async function tollS3DeletePrefix(prefix: string): Promise<number> {
  if (!BATCH_PREFIX.test(prefix)) throw new Error(`Refusing to delete prefix "${prefix}"`)
  const { c, cfg } = s3()
  let removed = 0
  let token: string | undefined
  do {
    const page = await c.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }))
    const objects = (page.Contents ?? []).filter(o => o.Key).map(o => ({ Key: o.Key as string }))
    if (objects.length > 0) {
      const res = await c.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: objects, Quiet: true } }))
      if (res.Errors && res.Errors.length > 0) throw new Error(`Could not delete ${res.Errors.length} file(s) under ${prefix}: ${res.Errors[0].Message}`)
      removed += objects.length
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return removed
}

// -- Short-lived links the browser can open directly -------------------------
// A link is a normal S3 address plus a signature that only works for one file, for a few
// minutes, and only for reading. It is built here with Node's own crypto (AWS Signature V4,
// "query string" form) so nothing new has to be installed; tests compare it with the AWS SDK.

function encodeSegment(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}
function encodePath(key: string): string {
  return key.split('/').map(encodeSegment).join('/')
}
function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

export interface PresignOptions {
  /** Seconds the link works for (default 300, at most 7 days). */
  expiresIn?: number
  /** Makes the browser save the file under this name instead of showing it. */
  filename?: string
  contentType?: string
  /** Only for tests: the moment the link is signed. */
  now?: Date
}

export function presignGetUrl(key: string, opts: PresignOptions = {}): string {
  const cfg = configOrThrow()
  const now = opts.now ?? new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const expires = Math.min(Math.max(Math.floor(opts.expiresIn ?? 300), 1), 604800)

  let proto = 'https'
  let host: string
  let path: string
  if (cfg.endpoint) {
    const u = new URL(cfg.endpoint)
    proto = u.protocol.replace(':', '')
    host = u.host
    path = `${u.pathname.replace(/\/+$/, '')}/${encodeSegment(cfg.bucket)}/${encodePath(key)}`
  } else if (!cfg.bucket.includes('.')) {
    host = `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`
    path = `/${encodePath(key)}`
  } else {
    host = `s3.${cfg.region}.amazonaws.com`
    path = `/${encodeSegment(cfg.bucket)}/${encodePath(key)}`
  }

  const scope = `${day}/${cfg.region}/s3/aws4_request`
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
    'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
    'x-id': 'GetObject',
  }
  if (opts.contentType) params['response-content-type'] = opts.contentType
  if (opts.filename) {
    const safe = opts.filename.replace(/[^A-Za-z0-9._ -]/g, '_')
    params['response-content-disposition'] = `attachment; filename="${safe}"`
  }

  const query = Object.keys(params).sort().map(k => `${encodeSegment(k)}=${encodeSegment(params[k])}`).join('&')
  const canonicalRequest = ['GET', path, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')].join('\n')
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + cfg.secretAccessKey, day), cfg.region), 's3'), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
  return `${proto}://${host}${path}?${query}&X-Amz-Signature=${signature}`
}

// -- Is it working? ----------------------------------------------------------
interface Health {
  checkedAt: number | null
  /** null = not checked yet, true = can write and read, false = the last check failed */
  ok: boolean | null
  /** null = not checked yet, true = a signed link opened the file, false = it did not */
  links: boolean | null
  error?: string
}
let health: Health = { checkedAt: null, ok: null, links: null }

/** True when a toll bucket is set (whether or not it is being written to right now). */
export function tollS3Configured(): boolean {
  return tollS3Config() !== null
}

/** Where NEW toll files are written: S3 when it is set up, switched on and passed its check, otherwise MongoDB. */
export function tollStorageMode(): 's3' | 'gridfs' {
  if (!tollS3Configured()) return 'gridfs'
  if ((process.env.TOLL_STORAGE || '').trim().toLowerCase() === 'gridfs') return 'gridfs'
  if (health.ok === false) return 'gridfs'
  return 's3'
}

/** True when the browser may be handed a direct S3 link. */
export function tollLinksEnabled(): boolean {
  if (!tollS3Configured()) return false
  if ((process.env.TOLL_LINKS || '').trim().toLowerCase() === 'off') return false
  return health.links !== false
}

export function tollStorageStatus() {
  return {
    mode: tollStorageMode(),
    configured: tollS3Configured(),
    links: tollLinksEnabled(),
    selfTest: health.ok === null ? 'not-run' : health.ok ? 'ok' : 'failed',
  }
}

/**
 * Proves the key can do everything the app needs: write a file, read it back, find it (and not
 * find a file that is not there), open it through a signed link, and delete it the way a whole
 * batch is deleted (list, then delete). The test file sits in its own batch-shaped folder, so
 * nothing is left behind. Never throws: a failure is remembered so new files go to MongoDB
 * instead of failing halfway through a batch, and the step that failed is logged.
 */
export async function tollS3SelfTest(): Promise<void> {
  if (!tollS3Configured()) {
    health = { checkedAt: Date.now(), ok: null, links: null }
    return
  }
  const prefix = `toll/_selftest/${crypto.randomBytes(8).toString('hex')}/`
  const key = `${prefix}probe.txt`
  const body = Buffer.from('fleetai-toll-selftest')
  let step = 'write a test file'
  let wrote = false
  try {
    await tollS3Put(key, body, 'text/plain')
    wrote = true
    step = 'read the test file back'
    const back = await tollS3Get(key)
    if (!back.equals(body)) throw new Error('the file read back was different from the file written')
    step = 'look for the test file'
    if (!(await tollS3Exists(key))) throw new Error('the test file was written but could not be found')
    if (await tollS3Exists(`${prefix}not-there.txt`)) throw new Error('a file that was never written was reported as found')
    let links = false
    let linkNote = ''
    try {
      const res = await fetch(presignGetUrl(key, { expiresIn: 60 }), { signal: AbortSignal.timeout(15_000) })
      links = res.ok && Buffer.from(await res.arrayBuffer()).equals(body)
      if (!links) linkNote = `a signed link was refused (HTTP ${res.status})`
    } catch (err: any) {
      linkNote = `a signed link could not be opened (${err?.message || err})`
    }
    step = 'delete the test files'
    await tollS3DeletePrefix(prefix)
    health = { checkedAt: Date.now(), ok: true, links }
    console.log(`Toll storage: S3 works${links ? ', direct links on' : `, direct links OFF - ${linkNote}`}${tollStorageMode() === 'gridfs' ? ' (but TOLL_STORAGE=gridfs keeps new files in MongoDB)' : ''}`)
  } catch (err: any) {
    const denied = err?.$metadata?.httpStatusCode === 403 ? ' - this key is not allowed to do that: check the IAM policy' : ''
    health = { checkedAt: Date.now(), ok: false, links: false, error: `could not ${step}: ${err?.message || err}${denied}` }
    console.error(`Toll storage: S3 check FAILED (${health.error}) - new toll files go to MongoDB until it passes`)
    if (wrote) await tollS3Delete(key).catch(() => {})
  }
}

/** Called before a new upload: if the last check failed, try once more (at most every 5 minutes). */
export async function tollS3RetrySelfTestIfFailed(): Promise<void> {
  if (health.ok !== false) return
  if (health.checkedAt && Date.now() - health.checkedAt < 5 * 60 * 1000) return
  await tollS3SelfTest()
}
