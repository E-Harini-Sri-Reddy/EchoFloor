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
npm install --include=dev   # needed on Render when NODE_ENV=production
npm run build:render        # client + server
npm start                   # serves API and client/dist on PORT
```

## Live API and n8n workflows

With `VITE_DATA_SOURCE=api`, a valid `MONGODB_URI`, and n8n webhook URLs in `.env`, signed-in sessions load workspace data from MongoDB (`session.live === true`). The browser talks only to the EchoFloor API; n8n webhooks and keys stay on the server.

### Frontend routes (via `VITE_API_BASE_URL`, default `/api/v1`)

| Flow | Method | Path | Notes |
|------|--------|------|--------|
| Voice question | `POST` | `/voice/questions` | Multipart: `audioFile`, `machineId`; session via `X-EchoFloor-User-Id` + `X-EchoFloor-Organisation-Id` (or query/body `userId` / `organisationId`) |
| Voice question status | `GET` | `/voice/questions/:requestId` | `202` while pending |
| Worker voice report | `POST` | `/reports/voice` | Same multipart shape as voice questions |
| Report status | `GET` | `/reports/voice/:requestId` | Poll until `completed` or `failed` |
| Shift handover | `POST` | `/shifts/:shiftId/handover` | Returns `202` + `requestId` |
| Handover status | `GET` | `/handovers/:requestId` | **Not** `/handovers/requests/:requestId` |
| n8n alerts | `GET` | `/alerts` | Workflow alerts with `eventId` |
| Mark alert read | `PATCH` | `/alerts/:id/read` | |

Client helpers live in `client/src/services/n8nApi.ts`. Speech output uses `client/src/hooks/useSpeech.ts`.

### n8n environment variables (server only)

Configure in `.env` (see `.env.example`): `N8N_WEBHOOK_KEY`, `N8N_CALLBACK_SECRET`, `N8N_VOICE_QUESTION_WEBHOOK_URL`, `N8N_WORKER_REPORT_WEBHOOK_URL`, `N8N_SHIFT_HANDOVER_WEBHOOK_URL`, `N8N_MEMORY_EMBEDDING_WEBHOOK_URL`, `N8N_ALERT_WEBHOOK_URL`. Do **not** copy webhook URLs or keys into `VITE_` variables.

### Troubleshooting

- **503 Voice/handover/report unavailable** — MongoDB disconnected or the matching `N8N_*_WEBHOOK_URL` is empty. Check `/api/v1/health`.
- **401 on workflow routes** — Pass active membership `userId` and `organisationId` (headers or query).
- **Voice question 404 machine** — `machineId` must exist in the signed-in organisation.
- **Empty evidence cards** — Voice answers cite documents in the MongoDB **`memories`** collection. If n8n or callbacks write to a different collection (e.g. `records`), evidence hydration will be empty until IDs match `memories._id`.
- **“Updating search index…”** — `embeddingStatus: pending` on a memory row; the embedding callback (`/api/v1/workflows/callbacks/embeddings`) has not marked it `ready` yet.

## Optional integrations

AI provider, embeddings, and speech-to-text keys remain optional. Mock mode (`VITE_DATA_SOURCE=mock`) keeps browser-session fixtures with no n8n calls.
