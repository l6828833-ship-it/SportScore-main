# Deploy: backend on Cloud Run, frontend on Vercel

Two services, deployed in order. The frontend needs the backend's URL, so the
backend goes first.

```
 Browser ──▶ Vercel (jdwal, Next.js SSR + API routes)
                │  server-side fetch, SELFHOSTED_BASE_URL
                ▼
             Cloud Run (SportScore, Express)  ──▶ 365scores public API
```

Only the frontend is public. The backend has no auth (see its README), so it is
locked down with CORS to the frontend's origin and is only ever called
server-side from Next.js — the browser never talks to it directly.

---

## Part 1 — Backend → Google Cloud Run

You do **not** need Docker installed locally. `gcloud run deploy --source`
builds the image in the cloud from the `Dockerfile` in this repo.

### One-time setup

```bash
# Install the gcloud CLI if you don't have it: https://cloud.google.com/sdk/docs/install
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Enable the services Cloud Run's source build needs.
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

### Deploy

Run from this directory (`SportScore-main/`):

```bash
gcloud run deploy sportscore-backend \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars SOURCE=365scores,SCORES365_TV_COUNTRY_ID=122
```

- `--source .` uploads the repo, builds the container from the `Dockerfile`, and
  deploys it. Ignores what `.dockerignore` lists.
- `--allow-unauthenticated` lets Vercel reach it over HTTPS. CORS (below) is what
  actually restricts who may use it from a browser.
- `--region` — pick one near your users, e.g. `europe-west1`, `me-central1`
  (Doha), `us-central1`. Use the same region everywhere below.
- The container listens on `$PORT`, which Cloud Run injects. `index.js` already
  reads it — nothing to configure.

On success it prints a **Service URL** like:

```
https://sportscore-backend-xxxxxxxxxx-ew.a.run.app
```

Copy it. Verify:

```bash
curl -s https://sportscore-backend-xxxxxxxxxx-ew.a.run.app/health
# expect: {"ok":true,"source":"365scores","ready":true,...}
```

### Lock CORS to the frontend (after Part 2, once you know the Vercel URL)

```bash
gcloud run services update sportscore-backend \
  --region europe-west1 \
  --update-env-vars CORS_ORIGIN=https://your-app.vercel.app
```

### Optional: switch source to API-Football with a key

Only if you want match statistics, referee, player search or past seasons. Store
the key in Secret Manager rather than an env var:

```bash
echo -n "YOUR_API_FOOTBALL_KEY" | gcloud secrets create apifootball-key --data-file=-

gcloud run services update sportscore-backend \
  --region europe-west1 \
  --update-env-vars SOURCE=apifootball,API_PROVIDER=direct \
  --update-secrets key=apifootball-key:latest
```

Confirm with `/health` — `ready` must stay `true`.

---

## Part 2 — Frontend → Vercel

The frontend is a standard Next.js app, so Vercel needs no container and no
config beyond the `vercel.json` already in the repo (it raises the server
function timeout to 30s for the dynamic pages).

### Option A — Git (recommended)

1. Push the `jdwal` repo to GitHub/GitLab.
2. In Vercel: **Add New → Project**, import the repo. It auto-detects Next.js.
3. Before the first deploy, add **Environment Variables** (Production + Preview):

   | Name | Value |
   |---|---|
   | `SPORTS_PROVIDER` | `selfhosted` |
   | `SELFHOSTED_BASE_URL` | the Cloud Run URL from Part 1 |
   | `NEXT_PUBLIC_LIVE_POLL_SECONDS` | `30` |
   | `NEXT_PUBLIC_DISPLAY_TIMEZONE` | `Asia/Riyadh` |

4. Deploy.

`NEXT_PUBLIC_*` values are inlined at **build time**, so changing them later
requires a redeploy, not just a restart.

### Option B — CLI

From the `jdwal/` directory:

```bash
npm i -g vercel
vercel            # first run links the project and creates it
vercel env add SELFHOSTED_BASE_URL production        # paste the Cloud Run URL
vercel env add SPORTS_PROVIDER production             # selfhosted
vercel env add NEXT_PUBLIC_LIVE_POLL_SECONDS production   # 30
vercel env add NEXT_PUBLIC_DISPLAY_TIMEZONE production    # Asia/Riyadh
vercel --prod     # production deploy
```

### Then close the CORS loop

Go back to Part 1's "Lock CORS" step with the `*.vercel.app` URL Vercel gives
you (and your custom domain, comma-separated, once mapped).

---

## Part 3 — Custom domain

Point the domain at the **frontend** (Vercel), not the backend:

- Vercel: **Project → Settings → Domains → Add**, then set the DNS records it
  shows at your registrar.
- Add the domain to the backend's `CORS_ORIGIN` too:

  ```bash
  gcloud run services update sportscore-backend --region europe-west1 \
    --update-env-vars CORS_ORIGIN=https://your-app.vercel.app,https://yourdomain.com
  ```

The backend does not need a public domain; the Cloud Run URL is enough since
only Vercel calls it.

---

## Redeploying

- **Backend**: re-run the `gcloud run deploy --source .` command. With Git you
  can also connect the repo via Cloud Build triggers for auto-deploy.
- **Frontend**: push to the connected branch (Option A), or `vercel --prod`
  (Option B).

## Notes

- **Cold starts.** Cloud Run scales to zero, so the first request after idle
  waits a second or two while a container starts. To avoid it, set
  `--min-instances 1` on the deploy (this costs money — a container runs 24/7).
- **Cost.** On `365scores`/`scrape` there is no upstream quota. Cloud Run and
  Vercel both have free tiers that comfortably cover low traffic.
- **No database needed.** The backend caches in memory; a restart just re-fetches
  (free on `365scores`). MongoDB stays optional via its `DB` env var.
