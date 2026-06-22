# DEPLOYMENT — Railway

Audience: admin deploying to Railway for the first time or troubleshooting a broken deploy.

---

## Overview

The tool ships as a Gunicorn-hosted Flask app with no separate frontend build or external database. Ingest jobs use a local SQLite database, while profiles and connexes use JSON files protected by cross-process locks. The `data/` directory is the only stateful artifact — it lives on the Railway volume if persistence is configured (see §4).

The brigade insignia gallery (~97 formation images) is bundled under `static/formations/`. Assets are downscaled for fast loading on constrained networks and lazy-load in the gallery view at Step 1.

---

## Files that control the deploy

| File | Purpose |
|------|---------|
| `Procfile` | Start command: `web: gunicorn app:app --bind 0.0.0.0:$PORT --timeout 300 --workers 2 --threads 4` |
| `railway.json` | Builder: NIXPACKS; start command; health check path `/api/health`; health check timeout 100s |
| `runtime.txt` | Python version pin: `python-3.11.10` |
| `requirements.txt` | All Python dependencies |

---

## Deploy steps

### 1. Connect the repo in Railway

1. Log in to Railway → New Project → Deploy from GitHub.
2. Select the `master-1750-tool` repo (or the monorepo root and set the root directory to `master-1750-tool/`).
3. Railway detects NIXPACKS and runs `pip install -r requirements.txt` automatically.

### 2. Set environment variables

In Railway → your service → Variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `PORT` | (leave unset — Railway sets this automatically) | Do not override; Railway injects $PORT |
| `OPENROUTER_API_KEY` | your OpenRouter key | Optional; only needed for the fast-follow AI item helper. Leave blank to omit. |

### 3. Deploy

Push to the branch connected to Railway (typically `main` or `feat/connex-3d`). Railway builds and starts the service automatically.

Health check: `GET /api/health` → `{"status":"ok"}`. Deploy is marked healthy when this returns 200.

---

## Multi-worker state safety

The checked-in two-worker, four-thread start command is supported. Ingest jobs are shared through SQLite. Connex updates use a per-record file lock, and profile upserts use a store-wide profile lock, so read-modify-write operations do not lose concurrent changes. Keep every worker on the same mounted `data/` directory.

---

## Where `data/` persists

By default, Railway's filesystem is ephemeral — files written to `data/` are lost on redeploy.

**To persist jobs, profiles, and connexes across deploys:**

1. In Railway → your service → Volumes → Add Volume.
2. Mount path: `/app/data` (adjust to your repo root).
3. Railway will write to and read from the persistent volume.

Without a volume, operators must re-create their profile and re-ingest BOMs after every deploy. The volume contains `jobs.db`, `profiles/`, and `connexes/`. For a one-time packing operation ephemeral storage is acceptable; for ongoing unit use, configure the volume.

---

## All API routes

### Legacy routes (unchanged)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Main UI |
| POST | `/ingest` | Upload BOM PDFs, return parsed rows |
| POST | `/assign` | Auto-assign rows to boxes |
| POST | `/regroup` | Regroup rows |
| POST | `/generate-master` | Render master DD1750 PDF |
| POST | `/generate-individuals` | Render per-item individual DD1750 PDFs |
| POST | `/reconcile` | SHR reconciliation |
| GET | `/api/health` | Railway health check |

### New routes (connex workflow)

#### Profiles

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/profiles` | — | `{profiles: [Profile, ...]}` |
| POST | `/api/profiles` | `{brigade, battalion, battery, uic, default_packed_by, stamp_text, brigade_image?}` | `{profile: Profile}` |
| GET | `/api/profiles/<profile_id>` | — | `{profile: Profile}` |

#### Connex lifecycle

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/connex` | `{profile_id, box_count, connex_no?}` | `{connex: Connex}` — status="building" |
| GET | `/api/connex/<connex_id>` | — | `{connex: Connex}` |
| PUT | `/api/connex/<connex_id>` | Partial Connex (any subset of fields) | `{connex: Connex}` |
| POST | `/api/connex/<connex_id>/attach` | `{ingest_job_id}` | `{connex: Connex}` |
| POST | `/api/connex/<connex_id>/assign` | `{moves: [{bom_id, box_num} OR {bom_id, separate} OR {bom_id, exclude}]}` | `{connex: Connex}` |
| POST | `/api/connex/<connex_id>/seal` | — | `{ok: bool, errors: [str], connex: Connex}` — always HTTP 200 |
| POST | `/api/connex/<connex_id>/generate` | — | Binary ZIP (Master_1750.pdf + one DD1750 PDF per occupied box) |

#### SITREP

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/sitrep` | `{connex_ids: [...]}` OR `{profile_id}` | `{sitrep: SitrepModel}` |
| POST | `/api/sitrep/pdf` | Same as `/api/sitrep` | Binary PDF |

### Error convention

Non-2xx responses return `{"error": "human message", "code": "MACHINE_CODE"}`.

Seal validation returns HTTP 200 with `{"ok": false, "errors": [...]}` — not an HTTP error — so the frontend can show field-level guidance.

---

## Rollback

Railway keeps prior deploys available. In Railway → Deployments → select a prior deploy → Redeploy.

---

## Logs

Railway → your service → Logs. Filter on `ERROR` or `WARNING` to surface application errors. The gunicorn access log shows every HTTP request with status code and response time.
