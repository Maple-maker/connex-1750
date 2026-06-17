# CONNEX 1750 — 3D Packing List Generator

Turn a stack of BOM PDFs into a set of sealed, stamped DD Form 1750s with a commander-ready SITREP. The operator builds a shipping container (connex) visually in 3D, drags Bills of Material into boxes, fills accountability fields, seals the connex, and downloads per-box DD1750 PDFs plus a PDF SITREP.

The legacy 2D flat-file workflow (batch child-1750 → master 1750) is preserved and accessible from the collapsible "Legacy" section on the main page.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Flask 3.0, Python 3.11, gunicorn |
| Persistence | JSON files on disk (`data/profiles/`, `data/connexes/`) |
| PDF render | reportlab, pypdf, pdfplumber |
| Frontend | Vanilla JS ES modules, no framework, no build step |
| 3D scene | three.js r160+ via CDN importmap (no node/webpack) |
| Deploy | Railway (Procfile + railway.json + runtime.txt) |

---

## Quickstart

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Open **http://localhost:8000**.

`PORT` env var overrides the port (e.g. `PORT=9000 python3 app.py`).

---

## Architecture map

```
app.py                  Flask entrypoint — all routes (legacy + new /api/* layer)
  │
  ├── profiles.py         Load/save/list/upsert Profile JSON (data/profiles/)
  ├── connex_store.py     CRUD + seal validation for Connex JSON (data/connexes/)
  ├── sitrep.py           Build SITREP JSON model (Contract C)
  │
  ├── render_core.py      DD1750 PDF renderer — header, pagination, battalion stamp
  ├── sitrep_render.py    Commander SITREP PDF (ReportLab)
  ├── master_core.py      Filename parser, aggregator, BOM → row conversion
  ├── bom_ingest.py       Multi-format BOM PDF extraction
  ├── packing.py          Box-assignment engine, zero-on-hand handling
  ├── reconcile.py        SHR reconciliation
  │
  ├── templates/
  │   └── index.html      Single-page app shell — three.js importmap, .cx-layout
  │
  └── static/
      ├── app.js          8-step workflow state machine (ES module)
      ├── glossary.js     GLOSSARY object + buildHelpPopover() helper
      ├── tokens.css      Design system CSS custom properties (Contract E)
      ├── style.css       Component library — glassmorphism, badges, stepper
      ├── _styleguide.html  Visual QA harness (open in browser, no server needed)
      ├── connex3d.js     three.js connex scene module (Contract D)
      ├── connex3d/
      │   └── _harness.html   Isolated 3D dev/QA harness
      └── formations/
          ├── manifest.json   97-entry brigade insignia index
          └── *.svg/*.jpg     Brigade insignia assets (~30 MB)

data/
  ├── profiles/           Profile JSON files (gitignored at runtime; .gitkeep committed)
  └── connexes/           Connex JSON files (gitignored at runtime; .gitkeep committed)
```

---

## API routes

All new routes are under `/api/`. Existing legacy routes (`/ingest`, `/assign`, `/regroup`, `/generate-master`, `/generate-individuals`, `/reconcile`, `/audit`, `/api/health`) are unchanged.

See `docs/DEPLOYMENT.md` for the full route table and `docs/handoff/backend.md` for request/response shapes.

---

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PORT` | no | `8000` | HTTP listen port |
| `OPENROUTER_API_KEY` | no | — | Fast-follow AI item helper (owl-alpha); not wired in MVP |

---

## Tests

```bash
# Full test suite (existing + new)
python3 -m pytest test_packing.py test_grouping.py test_reconcile.py \
                  test_zero_on_hand.py test_bom_ingest.py test_shr_ingest.py \
                  test_profiles.py test_connex.py test_sitrep.py -v
```

All 73 legacy packing tests plus the 59 new profile/connex/sitrep tests must pass.

---

## Key design decisions

- **No build step.** three.js loads from CDN via ES-module importmap in `index.html`. No webpack, vite, or node required.
- **Single gunicorn worker.** In-memory `JOBS` dict holds BOM ingest state. If the process restarts, BOM ingest must be re-run. This is intentional for a single-user tool.
- **JSON persistence.** Human-readable, no migrations, fits the Railway deploy model. `data/` is gitignored at the file level; only `.gitkeep` markers are committed.
- **AI helper deferred.** The owl-alpha NSN/LIN suggestion helper is planned as a fast-follow. A stub route exists (`/api/ai/suggest-item`) and a hook div lives in the INDIVIDUAL step. It is not wired in the current MVP.
