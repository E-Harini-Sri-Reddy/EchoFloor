# EchoFloor

Mobile-first operational memory for the factory floor. This repository currently contains a navigable UI mockup and a configuration-checking API.

EchoFloor records and retrieves machine-specific operational knowledge. It does not control equipment, read live sensors, or manage payroll.

## What is implemented

- React, TypeScript, and Vite client with separate administrator and worker navigation.
- Browser-session fixtures for memories, alerts, shifts, and handovers. They are labeled as examples and are not a production database.
- Administrator memory edits that open a confirmation dialog and change the session record only after confirmation.
- A Node.js and Express API that validates environment variables and reports which integrations are configured. It does not serve organisation data yet.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- API health: http://localhost:5000/api/v1/health

Copy `.env.example` to `.env` if you do not already have one. Leave secrets blank until those services exist. The API stays up and reports them as unavailable.

### Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth 2.0 Client ID of type **Web application**.
2. Add Authorized JavaScript origin `http://localhost:5173` (and your production origin later).
3. Set the same client id in both `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`. Put `GOOGLE_CLIENT_SECRET` in `.env` only (never under `VITE_`).
4. Restart `npm run dev`. The entry page renders the official Google button; `POST /api/v1/auth/google` verifies the ID token, then the mock session is linked by verified email to the same user id as password login.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Deploy on Render

The app deploys as a single Render web service (API + built client). See **[DEPLOY_RENDER.md](./DEPLOY_RENDER.md)** for Atlas network access, Blueprint/`render.yaml` steps, env vars, and Google origin setup.

```bash
npm run build:render   # client + server
npm start              # serves API and client/dist on PORT
```

## Not connected yet

AI provider, embeddings, speech-to-text, and n8n remain optional integrations. With `VITE_DATA_SOURCE=api` and a connected MongoDB URI, organisation data (machines, memberships, etc.) is loaded from Atlas after sign-in.
