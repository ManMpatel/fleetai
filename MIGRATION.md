# Multi-Tenancy Migration

This release converts FleetAI from a single-operator application to a multi-tenant one.
Read this before deploying — several steps will break the existing client if skipped.

---

## What changed

**Tenant identity is now derived from the verified Auth0 token.** The `x-owner-email`
header is gone. Previously any caller could set that header to any email and read or write
that operator's data, or claim super admin.

**`ownerId` (an email string) became `orgId` (an ObjectId)** on every tenant-owned
collection, and `Fine` gained a tenant field it never had.

**The global unique indexes on `renters.phone` and `vehicles.plate` are replaced with
per-tenant compound indexes.** Two operators may now hold the same plate or rent to the
same phone number; duplicates within one operator are still rejected.

**Each tenant supplies its own PayWay, WhatsApp, Gmail and SMS credentials**, stored
encrypted on their organisation record. A tenant edits their own at **Settings**; the
platform admin enters them for a new client from **Admin → Owners → Credentials**, which
opens automatically the moment a client is approved.

The founding operator is the exception: their credentials stay in the environment and are
bound to their organisation alone via `LEGACY_ORG_EMAIL` (step 2a).

**The workshop tablet authenticates with a revocable device token.** It previously kept an
owner email in `localStorage` and sent it as `ownerId`; those endpoints accepted it with no
verification at all.

**Employee PINs are hashed.** They were stored in plaintext.

---

## ⚠️ Before you deploy

### 1. `ENCRYPTION_KEY` is now mandatory — and must match what production already used

The old code fell back to a key literal in the source when `ENCRYPTION_KEY` was unset:

```
FleetAI2026SydneyScooterSecret32
```

**If production has been running without `ENCRYPTION_KEY` set, every existing renter's
bank details, licence and passport numbers were encrypted with that literal.** Set
`ENCRYPTION_KEY` to exactly that value, or the existing client's data will not decrypt.

The server now refuses to start if the key is missing or under 32 bytes. Key derivation is
byte-identical to the old implementation, so correct data keeps working.

Rotating to a stronger key is worth doing, but it is a separate exercise: decrypt with the
old key and re-encrypt with the new one before switching, and note that
`licenceNumberHash` / `passportNumberHash` are derived from the key too.

### 2. Set the new environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | **yes** | See above. Server will not boot without it. |
| `LEGACY_ORG_EMAIL` | **yes, if you have an existing client** | See step 2a. Keeps the founding operator's env-var credentials working. |
| `SUPER_ADMIN_EMAIL` | yes | Replaces the hardcoded `manpatel1144@gmail.com`. Matched against the token's email claim. |
| `SUPER_ADMIN_AUTH0_ID` | fallback | Use when your Auth0 tokens carry no email claim — see step 3. |
| `AUTH0_AUDIENCE` | recommended | Was hardcoded to the Railway URL. |
| `CORS_ORIGINS` | recommended | Comma-separated. Falls back to the previous hardcoded list. |
| `APP_URL` | recommended | Base for renter onboarding links. |
| `AWS_BACKUP_BUCKET` | recommended | Backups contain every tenant's data — keep them out of the uploads bucket. |
| `VITE_PUBLIC_URL` (client) | optional | Base for share links. Defaults to the browser's origin. |

### 2a. `LEGACY_ORG_EMAIL` — keeping the founding operator working

Before multi-tenancy the operator's PayWay, WhatsApp, Gmail and SMS credentials were
environment variables. Credentials now live on the organisation record, so **without this
variable the existing client's PayWay silently drops to the mock path and charges nobody,
WhatsApp sends throw, and fine ingestion stops.**

Set it to that operator's **login email**, exactly as it appears on their `owners`
document:

```
LEGACY_ORG_EMAIL=founder@theirdomain.com.au
```

Keep these already-set variables in place; they now apply to that one organisation only:

```
PAYWAY_SECRET_KEY, PAYWAY_PUBLISHABLE_KEY, PAYWAY_MERCHANT_ID, PAYWAY_BANK_ACCOUNT_ID
WHATSAPP_PHONE_ID, WHATSAPP_TOKEN
GMAIL_REFRESH_TOKEN
SMS_API_USERNAME, SMS_API_PASSWORD    (previously stored on the Owner document)
```

Rules the code enforces:

* **Only** the organisation whose `email` matches `LEGACY_ORG_EMAIL` ever reads these. Any
  other tenant with no credentials of its own gets the mock PayWay path — it never charges
  into the founding operator's merchant account.
* Values saved through the dashboard or the admin credentials modal **override** the
  environment, field by field. Migrating off is just a matter of entering them once and
  unsetting `LEGACY_ORG_EMAIL`.
* Startup logs one line stating which organisation the fallback applies to and which of
  the four integrations resolved. Check it after deploying.

### 3. Confirm your Auth0 tokens carry an email claim

`requireAdmin` matches `SUPER_ADMIN_EMAIL` against the email claim inside the access token
(`https://<your-domain>/email` or `email`). Auth0 access tokens only include profile claims
if an Action adds them.

**Verify this before deploying**, or the platform admin will be locked out of `/admin`:
decode a real access token and check for the claim. If it is absent, either add an Auth0
Action that sets it, or set `SUPER_ADMIN_AUTH0_ID` to the operator's `sub`
(e.g. `google-oauth2|1234...`), which is always present.

The check fails closed — with neither variable set, nobody is a super admin.

### 4. Every organisation needs an `auth0Id`

Tenant resolution keys on the token's `sub`. Organisations created before `auth0Id` was
recorded resolve once by email claim and are backfilled automatically — but only if the
token carries an email claim. The migration warns about any organisation missing an
`auth0Id`; with only one or two records, setting it by hand is the safest fix.

---

## Running the migration

Take a backup first. `runMongoBackup()` in `server/src/services/backup.ts` produces a full
JSON dump, or use `mongodump`.

**Rehearse against a restored copy of production before touching the real database.**

```bash
cd server
npm install

# 1. Backfill orgId, hash PINs, drop the global unique indexes, verify
npx ts-node src/scripts/migrateToOrgId.ts

# 1b. Expect step 1 to stop on orphans the first time — see below. Then:
npx ts-node src/scripts/migrateToOrgId.ts --assign-orphans-to=<founding-operator-email>

# 2. Only after the app is confirmed working in production:
npx ts-node src/scripts/migrateToOrgId.ts --drop-owner-id
```

The script is idempotent and re-runnable, and it verifies the tenant keys **before** it
touches any index — so a run that stops leaves the database exactly as it was found.

### Expect the first run to stop

`Notification` and `ServiceRecord` had an *optional* `ownerId`, and the single-tenant code
created notifications with none at all from fine and toll ingestion, inbound WhatsApp, and
manual fine upload. `Fine` never had a tenant field, so a fine whose vehicle has since been
deleted cannot be resolved by join either.

Those documents cannot be backfilled from a field they never had, so the first run reports
them and exits non-zero without changing anything:

```
── Verification: tenant keys ─────────────────
   ✅ renters: 1/1 carry orgId
   ✅ invoices: 12/12 carry orgId
   ✅ transactions: 340/340 carry orgId
   ❌ notifications: 412/533 carry orgId
   ❌ fines: 18/23 carry orgId

❌ Migration stopped before any index was changed — the database is unchanged.
```

Inspect them first:

```js
db.notifications.find({ orgId: { $exists: false } })
```

On a database that holds one operator every one of them is theirs, and
`--assign-orphans-to=<their-login-email>` claims them explicitly. The flag matches the
email case-insensitively, prints a per-collection count before writing, and **refuses
without `--force` if more than one organisation exists** — at that point attribution is a
guess, and a notification filed under the wrong tenant is worse than a failed migration.

Once the tenant keys verify clean, the indexes are dropped and rebuilt, and the second
verification block confirms it:

```
── Verification: indexes ─────────────────────
   ✅ renters.phone_1 removed
   ✅ vehicles.plate_1 removed
   ✅ transactions.transactionId_1 removed
```

The script also covers two things beyond the `orgId` backfill:

* **`invoices`, `invoicetemplates` and `transactions`** keyed on `ownerId` too. Every query
  on them now filters by `orgId`, so skipping them empties the existing client's Invoices
  page and stored transaction history.
* **The old flat credential fields on `owners`** (`paywaySecretKey`, `paywayMerchantId`,
  `mmApiUsername`, `businessName`, …) are moved onto the new nested shape. `paywayMerchantId`
  and `paywayBankAccountId` were encrypted in the old schema and are plain identifiers in
  the new one, so they are decrypted in transit. Nothing already set in the new shape is
  overwritten, and the step is re-runnable.

> **Why the index drop matters:** Mongoose creates indexes but never drops them. Removing
> `unique: true` from a schema leaves the old index live in MongoDB, and the second tenant
> still hits duplicate-key errors with code that looks correct. The script drops
> `phone_1`, `plate_1` and `transactionId_1` explicitly and verifies they are gone.
> PayWay numbers transactions sequentially **per merchant account**, so two operators
> genuinely will produce the same id.

---

## After deploying

### Onboarding a new client

Approving a client in **Admin → Owners** now opens a **Client credentials** modal for that
organisation. Fill in whichever of PayWay, WhatsApp, fine/toll email and SMS they use; the
modal is reachable again any time from the **Credentials** button on their row, and the
**Setup** column shows at a glance what each client is still missing.

Secrets are write-only — the server reports whether each one is set, never its value, so a
blank field always means "keep what is stored". Auth0, Gemini and S3 are platform-level and
are deliberately absent from the modal.

### What the client still does themselves

For **each** operator, in their own dashboard under **Settings**:

1. **Organisation** — display name, logo, fleet description (the last feeds the AI assistant).
2. **PayWay** — their own merchant ID and keys. Until this is set their auto-debit runs in
   the mock path rather than charging anyone.
3. **WhatsApp** — their own Business phone number ID and token. The inbound webhook routes
   on the receiving number, so this must be set before their number is pointed at FleetAI.
4. **Fine/toll email** — their own mailbox refresh token.
5. **Workshop tablet** — press *Link tablet*, then enter the code once on the tablet. The
   old `?owner=` tablet URL no longer works; existing tablets must be re-linked.
6. **Share link name** (Fleet page → Share Links) — required before onboarding links can be
   sent, since the renter form resolves the operator from the slug.

---

## Known follow-ups

- **The WhatsApp webhook payload shape is unresolved.** The inbound handler historically
  parsed Twilio-shaped fields (`Body`, `From`, `NumMedia`) while the outbound path uses the
  Meta Graph API. `parseInbound()` in `server/src/services/whatsapp.ts` now handles both and
  identifies the tenant from the receiving number in either shape, but this needs verifying
  against a real inbound payload before the integration is relied on.
- **Backups are still one file containing every tenant.** Moving them to a private bucket
  via `AWS_BACKUP_BUCKET` is the short-term mitigation; per-tenant exports would be better.
- **Existing S3 uploads keep their old flat `uploads/` keys.** New uploads are written under
  `orgs/{orgId}/uploads/`. Old objects were not moved.
