# EchoFloor n8n integration — server assumptions

- **Memory collection**: `memories` (not renamed to `records`). Atlas Vector Search in n8n must target this collection or be reconfigured.
- **Identifier types**: `organisationId` and `machineId` are stored as MongoDB `ObjectId` on documents. Outbound n8n payloads use hex strings via `toId()`. Memories also store `organisationIdString` and `machineIdString` for vector filter compatibility.
- **Shift window for handover-data**: Uses `shifts.startAt` / `shifts.endAt` when present; otherwise the last **12 hours** before `endAt` (or now).
- **Admin memory edit route**: Not present on the Express API yet; embedding reset + `buildSearchableText` hooks live in services for when that route is added.
- **n8n configured when**: `N8N_WEBHOOK_KEY`, `N8N_CALLBACK_SECRET`, and `N8N_VOICE_QUESTION_WEBHOOK_URL` are set (legacy `N8N_WEBHOOK_SECRET` / `N8N_BASE_URL` map forward when new vars are omitted).

## Atlas vector index

Default index name: **`echofloor_records_vector_index`** (`ATLAS_VECTOR_INDEX_NAME`).

Create it on the **`records`** collection. The API upserts embedded search docs there for
**memories, alerts, constraints, tasks, machines, and handovers**. Voice Mongo fallback
searches `records` first, then `memories`.

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "cosine" },
    { "type": "filter", "path": "organisationIdString" },
    { "type": "filter", "path": "machineIdString" }
  ]
}
```

Backfill: `node server/scripts/backfill-embeddings.js`
