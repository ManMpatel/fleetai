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

**Each tenant supplies its own PayWay, WhatsApp and Gmail credentials**, stored encrypted
on their organisation record and configurable at **Settings** in the dashboard.

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
| `SUPER_ADMIN_EMAIL` | yes | Replaces the hardcoded `manpatel1144@gmail.com`. Matched against the token's email claim. |
| `SUPER_ADMIN_AUTH0_ID` | fallback | Use when your Auth0 tokens carry no email claim — see step 3. |
| `AUTH0_AUDIENCE` | recommended | Was hardcoded to the Railway URL. |
| `CORS_ORIGINS` | recommended | Comma-separated. Falls back to the previous hardcoded list. |
| `APP_URL` | recommended | Base for renter onboarding links. |
| `AWS_BACKUP_BUCKET` | recommended | Backups contain every tenant's data — keep them out of the uploads bucket. |
| `VITE_PUBLIC_URL` (client) | optional | Base for share links. Defaults to the browser's origin. |

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

# 2. Only after the app is confirmed working in production:
npx ts-node src/scripts/migrateToOrgId.ts --drop-owner-id
```

The script is idempotent and re-runnable. It **aborts** rather than guessing if any
document is left without an `orgId` — an orphan assigned to the wrong tenant is worse than
a failed migration. Inspect them with:

```js
db.<collection>.find({ orgId: { $exists: false } })
```

It prints a verification block and exits non-zero on failure:

```
── Verification ──────────────────────────────
   ✅ renters: 1/1 carry orgId
   ...
   ✅ renters.phone_1 removed
   ✅ vehicles.plate_1 removed
```

> **Why the index drop matters:** Mongoose creates indexes but never drops them. Removing
> `unique: true` from a schema leaves the old index live in MongoDB, and the second tenant
> still hits duplicate-key errors with code that looks correct. The script drops
> `phone_1` and `plate_1` explicitly and verifies they are gone.

---

## After deploying

For **each** operator, in the dashboard under **Settings**:

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
