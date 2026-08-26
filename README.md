# FleetAI

FleetAI is a full-stack, multi-tenant fleet and renter management platform designed for vehicle rental businesses. Each operator (organisation) manages its own renters, vehicles, payments, service history, and onboarding workflows from a single dashboard, with its own PayWay, WhatsApp, email and SMS credentials.

Data is isolated per organisation: every record carries an `orgId`, and every request derives its tenant from the verified Auth0 token. See [MIGRATION.md](MIGRATION.md) if you are upgrading from the single-tenant version.

The system integrates with:

* **PayWay** for automated bank debit payments
* **Gemini AI** for document and licence verification
* **AWS S3** for document storage
* **Auth0** for authentication
* **MongoDB** for data persistence

---

# Features

## Renter Management

* Create and manage renters
* Onboarding flow with licence and identity verification
* Bank detail storage with AES‑256 encryption
* Emergency contact and address tracking

## Vehicle Management

* Assign vehicles to renters
* Track vehicle history
* Maintain service records
* View active and past vehicle assignments

## Payments & Auto‑Debit

* Integration with PayWay direct debit
* Activate, pause, and resume renter payments
* View payment history
* Automated weekly billing schedules

## AI Verification

* Licence extraction using Gemini AI
* Identity verification checks
* Document validation for onboarding

## File Uploads

* Upload fines, documents, and service files
* Store files securely in AWS S3

## Notifications

* System notifications for owners
* Alerts for new fines or payment updates

---

# Tech Stack

## Frontend

* React
* TypeScript
* TailwindCSS
* Axios

## Backend

* Node.js
* Express
* TypeScript

## Database

* MongoDB
* Mongoose

## Infrastructure

* Railway (Backend hosting)
* Vercel (Frontend hosting)
* AWS S3 (File storage)

## External Services

* PayWay API (Payments)
* Gemini AI (Document analysis)
* Auth0 (Authentication)

---

# Project Structure

```
fleetai/

client/                 # React frontend

server/
  src/
    models/             # MongoDB models (every tenant-owned model carries orgId)
      plugins/          # tenantScope - guards against unscoped queries
    routes/             # API routes
    services/           # External service integrations
    middleware/
      auth.ts           # Auth0 JWT validation + platform admin check
      tenant.ts         # Resolves the tenant from the verified token
    scripts/            # One-off migrations

```

## Tenancy model

`Organization` is the tenant record (collection: `owners`). One Auth0 login maps to one
organisation.

Every request follows the same path:

```
Auth0 JWT -> requireAuth (verifies signature)
          -> requireTenant (maps token sub -> Organization)
          -> req.orgId   <- the only source of tenancy
```

`req.orgId` is never taken from a header, query string, or request body. Public surfaces
resolve their tenant server-side instead: the renter onboarding form from the operator's
slug, and the workshop tablet from a revocable device token.

Tenant-owned models load the `tenantScope` plugin, which throws in development when a
query on those collections has no `orgId` in its filter. Deliberately platform-wide
queries opt out explicitly:

```ts
Model.find({ ... }).setOptions({ allowCrossTenant: true })
```

Populate joins from an already-scoped parent use the `scopedPopulate` helper.

---

# Environment Variables

Create a `.env` file in the server directory.

Example configuration:

```
MONGODB_URI=

# Required. Server refuses to start without it - renter bank details and
# tenant API credentials are encrypted with this key. Must be 32+ bytes.
ENCRYPTION_KEY=

# Platform operator. Matched against the email claim in the verified JWT.
# Use SUPER_ADMIN_AUTH0_ID instead if your tokens carry no email claim.
SUPER_ADMIN_EMAIL=
SUPER_ADMIN_AUTH0_ID=

AUTH0_DOMAIN=
AUTH0_AUDIENCE=
AUTH0_MGMT_CLIENT_ID=
AUTH0_MGMT_CLIENT_SECRET=

GEMINI_API_KEY=

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_BUCKET_NAME=
AWS_BACKUP_BUCKET=      # keep multi-tenant backups out of the uploads bucket

# OAuth app for fine/toll email ingestion. Each tenant connects their own
# mailbox from Settings; only the app credentials are platform-level.
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=

APP_URL=                # base for renter onboarding links
CORS_ORIGINS=           # comma-separated allowlist

# Founding operator only. Binds the PayWay/WhatsApp/Gmail/SMS variables below to the ONE
# organisation with this login email. Every other tenant must supply its own credentials.
LEGACY_ORG_EMAIL=

PAYWAY_SECRET_KEY=
PAYWAY_PUBLISHABLE_KEY=
PAYWAY_MERCHANT_ID=
PAYWAY_BANK_ACCOUNT_ID=
WHATSAPP_PHONE_ID=
WHATSAPP_TOKEN=
GMAIL_REFRESH_TOKEN=
SMS_API_USERNAME=
SMS_API_PASSWORD=
```

PayWay, WhatsApp, fine/toll email and SMS credentials are **per tenant**, not environment
variables. Each operator enters their own under **Settings**, or the platform admin enters
them for a new client from **Admin → Owners → Credentials**.

The block above is the single exception, kept so the founding operator's live integrations
did not break when tenancy was introduced. It resolves for that one organisation only, and
anything saved through the UI overrides it field by field — see
[MIGRATION.md](MIGRATION.md) step 2a.

---

# Installation

Clone the repository:

```
git clone https://github.com/ManMpatel/fleetai.git
cd fleetai
```

Install backend dependencies:

```
npm install
```

Install frontend dependencies:

```
cd client
npm install
```

---

# Running the Project

Start the backend:

```
npm run dev
```

Start the frontend:

```
cd client
npm run dev
```

---

# Deployment

## Staging

Push to the `staging` branch to deploy to staging environments.

```
git push origin staging
```

Staging URLs:

Frontend:

```
fleetai-git-staging-manmpatels-projects.vercel.app
```

Backend:

```
fleetai-staging.up.railway.app
```

## Production

Production deploys only after a pull request is merged from `staging` into `main`.

---

# Security

Sensitive information such as:

* Bank account numbers
* BSB numbers
* Passport numbers
* Licence numbers

is encrypted using **AES‑256 encryption** before being stored in MongoDB, along with each tenant's PayWay, WhatsApp, Gmail and SMS credentials.

The values are decrypted only when required for external services such as PayWay.

Employee PINs and workshop tablet tokens are stored as HMAC hashes and cannot be read back.

`ENCRYPTION_KEY` must be set in the environment; the server will not start without it.

---

# API Overview

Example endpoints:

Authenticated (Auth0 JWT + approved organisation):

```
GET  /api/fleet
GET  /api/renters
POST /api/renters/:phone/activate
POST /api/renters/:phone/pause
POST /api/renters/:phone/resume
GET  /api/renters/:phone/payments
GET  /api/settings
PUT  /api/settings/payway
PUT  /api/settings/whatsapp
POST /api/settings/tablet-token

POST /api/upload/fine
POST /api/upload/document
POST /api/upload/read-licence
POST /api/upload/read-rego-bulk
```

Platform operator only (super admin):

```
GET  /api/admin/owners                     # tenants, with a per-integration setup summary
PATCH /api/admin/owners/:email/approve
PUT  /api/admin/owners/:email/credentials  # set a client's PayWay / WhatsApp / Gmail / SMS
GET  /api/admin/stats
```

Public (tenant resolved server-side, never from the caller):

```
GET  /api/auth/resolve/:slug        # share link -> operator display info
POST /api/renters/public/onboard    # tenant from the slug in the body
POST /api/whatsapp/incoming         # tenant from the receiving business number
```

Workshop tablet (device token in `Authorization: Bearer`):

```
GET   /api/tablet/session
POST  /api/tablet/verify-pin
POST  /api/tablet/clock
POST  /api/tablet/log-service
GET   /api/tablet/service-records
PATCH /api/tablet/service-records/:id
```

---

# Development Workflow

```
git checkout staging
git pull origin staging
```

Make changes and push:

```
git add .
git commit -m "description"
git push origin staging
```

Production updates only after a pull request from `staging` to `main`.

---

# Future Improvements

* Advanced analytics dashboard
* Automated fine detection
* Driver risk scoring
* Fleet maintenance predictions

---

# License

Private internal project.

All rights reserved.
