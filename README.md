# CONNEX 1750 — Packing List Generator

Turn a stack of BOM PDFs into sealed, stamped DD Form 1750s with a commander-ready SITREP. The operator picks a unit profile, packs equipment into boxes on a 2D split-screen, reviews and seals the connex (a CSS animated seal sequence plays on stamp), and downloads a ZIP containing the master and per-box DD1750 PDFs plus a PDF SITREP.

The legacy 2D flat-file workflow (batch child-1750 → master 1750) is preserved and accessible from the collapsible "Legacy" section on the main page.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Flask 3.0, Python 3.11, gunicorn |
| Persistence | JSON files on disk (`data/profiles/`, `data/connexes/`) |
| PDF render | reportlab, pypdf, pdfplumber |
| Frontend | Vanilla JS ES modules, no framework, no build step |
| Seal animation | Pure CSS 3D transforms (`playSealAnimation()` in `app.js`, `.seal-*` rules in `style.css`) — no WebGL, no three.js |
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

## 6-step operator workflow

```
1. PROFILE        Pick brigade from the insignia gallery (97 formations, searchable;
                  lazy-loaded). Profile saves unit identity and pre-fills header fields.
2. CONNEX SETUP   Name the connex + set box count.
3. PACKING        2D split-screen:
                    Left  = BOM pool (ingest BOM PDFs) + Add Individual Item form
                    Right = box cards, each with inline SLOC + SHRH POC + status badge
                  Drag a BOM card onto a box OR click-select BOM then click a box.
                  Individual items are added directly to a box here (no separate step).
4. SEAL DATA      Enter SUN #, CONNEX #, SEAL # (all optional → [.. PENDING] placeholders),
                  packed-by, signed-by (must differ from packer).
5. REVIEW & SEAL  Per-box checklist of the connex contents. Confirm each box, then
                  "Apply Brigade Stamp & Seal" → a CSS seal animation plays (connex
                  doors swing closed, gold lock bar slides across, SEALED stamp lands)
                  → download ZIP:
                    Master_1750.pdf  (all boxes condensed)
                    Box_001.pdf ...  (one per occupied box)
6. NEXT / SITREP  Pack another connex under the same profile, or finish and generate
                  the commander's SITREP (JSON + PDF) across all connexes.
```

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
  │   └── index.html      Single-page app shell — .cx-layout, loads app.js (ES module)
  │
  └── static/
      ├── app.js          6-step workflow state machine (ES module)
      ├── glossary.js     GLOSSARY object + buildHelpPopover() helper
      ├── tokens.css      Design system CSS custom properties (Contract E)
      ├── style.css       Component library — glassmorphism, badges, stepper
      ├── _styleguide.html  Visual QA harness (open in browser, no server needed)
      └── formations/
          ├── manifest.json   97-entry brigade insignia index
          └── *.svg/*.jpg     Brigade insignia assets (downscaled for constrained
                              networks; lazy-loaded in gallery)

data/
  ├── profiles/           Profile JSON files (gitignored at runtime; .gitkeep committed)
  └── connexes/           Connex JSON files (gitignored at runtime; .gitkeep committed)
```

---

## API routes

All new routes are under `/api/`. Existing legacy routes (`/ingest`, `/assign`, `/regroup`, `/generate-master`, `/generate-individuals`, `/reconcile`, `/audit`, `/api/health`) are unchanged.

See `docs/DEPLOYMENT.md` for the full route table and `docs/handoff/backend.md` for request/response shapes.

---

## Review prompt playbook

Use `docs/CODE_REVIEW_AGENT_PROMPTS.md` for a tiered checklist of reusable review prompts across safety, maintainability, architecture, and language-specific quality checks.

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

- **No build step.** Vanilla ES modules load directly in `index.html`. No webpack, vite, or node required.
- **Seal animation is pure CSS.** The sealed-connex sequence at Step 5 is a hand-built CSS 3D-transform animation (`playSealAnimation()` + `.seal-*` rules) — no WebGL, no three.js, no canvas. A scoped `prefers-reduced-motion` fallback fades the overlay and stamp in without the door swing. See `docs/handoff/3d-connex.md`.
- **Single gunicorn worker.** In-memory `JOBS` dict holds BOM ingest state. If the process restarts, BOM ingest must be re-run. This is intentional for a single-user tool.
- **JSON persistence.** Human-readable, no migrations, fits the Railway deploy model. `data/` is gitignored at the file level; only `.gitkeep` markers are committed.
- **AI helper deferred.** The owl-alpha NSN/LIN suggestion helper is planned as a fast-follow. A stub route exists (`/api/ai/suggest-item`) and a hook is present in the PACKING step's individual item form. It is not wired in the current MVP.
