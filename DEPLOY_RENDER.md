# Deploy EchoFloor on Render

EchoFloor deploys as **one** Render web service: Express serves `/api/v1/*` and the built React app from `client/dist`.

## Before you start

1. Push this repo to GitHub (or GitLab / Bitbucket) that Render can access.
2. Keep using your MongoDB Atlas cluster (`echofloor` database).
3. In Atlas → **Network Access**, allow `0.0.0.0/0` (or Render’s outbound IPs) so the Render service can connect.
4. Have these values ready:
   - `MONGODB_URI` (Atlas connection string)
   - `DEMO_SEED_PASSWORD` (optional; defaults to `AdminTest-1` for seed hash placeholders)
   - Google OAuth Web client ID/secret (optional; needed for Google sign-in on the live URL)

## Deploy with Blueprint (recommended)

1. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect the EchoFloor repository and select the branch you want (e.g. `main`).
3. Render reads `render.yaml` and creates the `echofloor` web service.
4. When prompted for `sync: false` variables, set at least:
   - **MONGODB_URI** — Atlas URI  
   - **VITE_GOOGLE_CLIENT_ID** / **GOOGLE_CLIENT_ID** — same Web client ID (if using Google)  
   - **GOOGLE_CLIENT_SECRET** — optional for the GIS ID-token flow  
   - **DEMO_SEED_PASSWORD** — if your seed credentials use a custom password  
5. Apply the Blueprint and wait for the first deploy to finish.
6. Open the service URL (e.g. `https://echofloor.onrender.com`).

`AUTH_SECRET` is generated automatically. `CLIENT_URL` / `SERVER_URL` default from Render’s `RENDER_EXTERNAL_URL`.

## Deploy manually (without Blueprint)

1. **New** → **Web Service** → connect the repo.
2. Settings:
   - **Runtime:** Node  
   - **Build command:** `npm install --include=dev && npm run build:render`  
   - **Start command:** `npm start`  
   - **Health check path:** `/api/v1/health`
3. Environment variables (same as in `render.yaml`), including:
   - `NODE_ENV=production`
   - `VITE_DATA_SOURCE=api`
   - `VITE_API_BASE_URL=/api/v1`
   - `MONGODB_URI`, `MONGODB_DATABASE=echofloor`
   - `AUTH_SECRET` (long random string)
   - Google vars if needed  
4. Deploy.

## After the first deploy

### Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → your OAuth Web client:

- **Authorized JavaScript origins:** add `https://YOUR-SERVICE.onrender.com`  
- Keep `http://localhost:5173` for local work  

Redeploy is not required after changing Google Console origins.

### Share with the team

Send them `https://YOUR-SERVICE.onrender.com`.

On the **free** plan the service sleeps when idle; the first visit after sleep can take ~30–60 seconds.

### Verify

- `https://YOUR-SERVICE.onrender.com/api/v1/health` → JSON with `mongodb` configured  
- Sign in / register in the UI and confirm machines load from Atlas  

## Local production smoke test (optional)

```bash
npm install
set VITE_DATA_SOURCE=api
set VITE_API_BASE_URL=/api/v1
npm run build:render
set NODE_ENV=production
set PORT=5000
set MONGODB_URI=your-atlas-uri
set MONGODB_DATABASE=echofloor
set AUTH_SECRET=local-smoke-secret
set CLIENT_URL=http://localhost:5000
npm start
```

Then open http://localhost:5000

## Updating the live demo

Push to the connected branch. Render rebuilds and redeploys automatically.

Rebuild is required when you change any `VITE_*` variable (those are baked into the client at build time).
