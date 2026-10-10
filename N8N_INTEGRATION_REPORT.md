# EchoFloor n8n integration — final report

Branch: `n8n-integration`

## 1. Files added / changed

### Server
- `server/src/config/env.ts`, `env.test.ts` — n8n webhook URLs, key, callback secret, embedding dims/backfill
- `server/src/app.ts` — register n8n routes, indexes, schedulers (skipped in `test`)
- `server/src/db/indexes.ts` — unique `workflow_requests.requestId`, sparse unique `alerts.eventId`, **TTL** on `alerts.expiresAt` / `constraints.expiresAt`
- `server/src/db/workspace.ts` — strip `embedding` from workspace payloads
- `server/src/util/n8nIds.ts`, `audioUpload.ts`
- `server/src/middleware/requireN8nSecret.ts`, `requireLiveSession.ts`
- `server/src/services/n8nClient.ts`, `buildSearchableText.ts`, `alertEvents.ts`, `memoryEmbedding.ts`, `workflowRequests.ts`, `handoverData.ts`
- `server/src/routes/workflows.ts`, `voice.ts`, `reportsVoice.ts`, `handoverWorkflow.ts`, `n8nAlerts.ts`
- `server/src/jobs/schedulers.ts` — constraint expiring alerts, stale embeddings, stale requests, **expired hold → memory re-embed**
- `server/src/workflows/n8n.integration.test.ts`
- `server/scripts/backfill-embeddings.js`
- `server/ASSUMPTIONS.md`
- `server/package.json` — multer, node-cron, mongodb-memory-server

### Client
- `client/src/hooks/useSpeech.ts`
- `client/src/services/n8nApi.ts`
- `client/src/features/voice/liveVoiceRecording.ts`, `VoiceAssistant.tsx` (live conversation when `session.live`)
- `client/src/components/alerts/AlertBell.tsx` (+ Shells topbar)
- `client/src/components/markdown/SimpleMarkdown.tsx`
- `client/src/features/handovers/HandoverViews.tsx` — generate handover via n8n
- `client/src/features/machines/MachineViews.tsx` — voice report upload
- `client/src/features/memories/MemoryExplorer.tsx` — embedding status
- `client/src/types/domain.ts` — optional `embeddingStatus`, `contentVersion`

### Root
- `.env` (gitignored) — `N8N_WEBHOOK_KEY`, `N8N_CALLBACK_SECRET`, webhook URLs, Groq/Voyage keys for credential reference
- `.env.example` — placeholders only
- `README.md` — n8n flows / troubleshooting
- `N8N_INTEGRATION_REPORT.md` (this file)

## 2. Assumptions

- Memory collection stays **`memories`** (not renamed to `records`).
- `organisationId` / `machineId` remain **ObjectIds** in Mongo; dual-written **`organisationIdString` / `machineIdString`** for Atlas vector filters.
- Live session auth for n8n user routes uses headers `X-EchoFloor-User-Id` + `X-EchoFloor-Organisation-Id` (membership verified).
- Handover shift window uses `shifts.startAt`/`endAt`; otherwise last 12 hours.
- Groq / Voyage keys live in n8n credentials; also stored in local `.env` for reference only (API does not call them).
- Cron schedulers do not start when `NODE_ENV=test`.

## 3. Section 8 mismatches (change these in n8n / Atlas)

| Item | App reality | n8n prompt default |
|------|-------------|--------------------|
| Collection | **`memories`** | `records` |
| Filter fields | **`organisationIdString`**, **`machineIdString`** (strings) | `organisationId`, `machineId` (as strings in filter — ObjectIds will match nothing) |
| Index name | Create on `memories` (suggested: `echofloor_memories_vector_index`) | `echofloor_records_vector_index` |

Atlas Vector Search index JSON for **`memories`**:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "cosine" },
    { "type": "filter", "path": "organisationIdString" },
    { "type": "filter", "path": "machineIdString" }
  ]
}
```

Callback base URL (Render): `https://echofloor-9rpn.onrender.com/api/v1/workflows/...`

## 4. Suggested n8n workflow changes (not applied)

1. Workflow 1: point `$vectorSearch` at collection **`memories`** and filters **`organisationIdString` / `machineIdString`**.
2. Confirm callback URLs use `/api/v1/workflows/callbacks/*` and header `N8N_CALLBACK_SECRET`.
3. Confirm outbound webhooks expect header `X-EchoFloor-Key`.

## 5. TTL and expired operational data

- MongoDB TTL index on `alerts.expiresAt` and `constraints.expiresAt` (`expireAfterSeconds: 0`) deletes documents when the window ends.
- Every 5 minutes: mark expired open alerts `resolved`, constraints `expired`, and refresh linked memory `text` + re-queue embedding so AI retrieval no longer treats short holds as active.

## 6. Manual test checklist

Set `N8N_CALLBACK_SECRET` locally, then:

```bash
# Callback auth
curl -s -X POST "$API/workflows/callbacks/alerts" -H "Content-Type: application/json" -d "{}"
# expect 401

curl -s -X POST "$API/workflows/callbacks/alerts" \
  -H "Content-Type: application/json" \
  -H "N8N_CALLBACK_SECRET: <secret>" \
  -d '{"eventId":"evt-demo-1","organisationId":"<orgHex>","machineId":null,"severity":"info","title":"Test","message":"Hello"}'
# expect 200 {ok:true}

# Idempotent duplicate
# repeat same body → 200 {ok:true}, still one alert
```

End-to-end (live session + n8n online):

1. Voice: Start conversation on Voice Assistant → speak question → answer + evidence.
2. Worker report: machine page → record voice report → poll until extracted fields shown.
3. Embedding: new/edited memory → `embeddingStatus` pending → ready.
4. Handover: Shifts → Generate handover → markdown + Read aloud.
5. Alerts: bell unread count; constraint approaching expiry within 2h.

## 7. Tests run

- Server: 19 tests pass (env, google, app health, n8n callbacks). Typecheck clean.
- Client: 24 domain tests pass. Typecheck clean.

## 8. Open follow-ups

- Wire admin memory **edit** HTTP route to `memoryFieldsAfterContentEdit` / embed trigger (session edit still client-side today).
- Per-user rate limits on audio upload routes.
- Deploy Render env vars to match `.env` n8n keys (never commit secrets).
