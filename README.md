# FleetAI

FleetAI is a full‑stack fleet and renter management platform designed for vehicle rental businesses. It allows operators to manage renters, vehicles, payments, service history, and onboarding workflows from a single dashboard.

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
    models/             # MongoDB models
    routes/             # API routes
    services/           # External service integrations
    middleware/         # Auth and request middleware

```

---

# Environment Variables

Create a `.env` file in the server directory.

Example configuration:

```
MONGO_URI=
GEMINI_API_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_BUCKET_NAME=
PAYWAY_SECRET_KEY=
PAYWAY_PUBLISHABLE_KEY=
PAYWAY_MERCHANT_ID=
AUTH0_DOMAIN=
AUTH0_AUDIENCE=
APP_URL=
```

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

is encrypted using **AES‑256 encryption** before being stored in MongoDB.

The values are decrypted only when required for external services such as PayWay.

---

# API Overview

Example endpoints:

```
POST /api/renters
POST /api/renters/:phone/activate
POST /api/renters/:phone/pause
POST /api/renters/:phone/resume
GET  /api/renters/:phone/payments

POST /api/upload/fine
POST /api/upload/document
POST /api/upload/read-licence
POST /api/upload/read-rego-bulk
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
