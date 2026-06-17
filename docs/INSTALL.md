# INSTALL — Local Setup

Audience: developer or S6 admin setting up the tool on a local machine.

---

## Prerequisites

- Python 3.11 (matches `runtime.txt`; 3.10+ likely works, 3.11 is tested)
- pip
- A terminal with git access to the repo

No Node.js, no webpack, no build step. three.js loads from CDN at runtime and is used only for the read-only sealed-connex review at Step 5. The packing workflow (Step 3) is entirely 2D and requires no WebGL.

---

## 1. Clone the repo and enter the directory

```bash
git clone <repo-url>
cd master-1750-tool
git checkout feat/connex-3d
```

---

## 2. Create and activate a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate        # macOS / Linux
# venv\Scripts\activate.bat     # Windows
```

---

## 3. Install dependencies

```bash
pip install -r requirements.txt
```

Dependencies installed:

| Package | Purpose |
|---------|---------|
| flask 3.0.0 | Web framework |
| gunicorn 21.2.0 | WSGI server (production) |
| pypdf 3.17.1 | PDF read/merge |
| reportlab 4.0.7 | PDF rendering (DD1750 + SITREP) |
| pdfplumber 0.10.3 | PDF text extraction for BOM ingest |
| Werkzeug 3.0.1 | Flask dependency |
| pdf2image | Optional OCR fallback (guarded; requires poppler) |
| pytesseract | Optional OCR fallback (guarded; requires tesseract) |

The OCR packages are listed in `requirements.txt` but the code guards their import with `OCR_AVAILABLE` — the app runs without them.

---

## 4. Create the data directories

The `data/` directory must exist with `profiles/` and `connexes/` subdirectories. The `.gitkeep` files committed to the repo create them automatically after checkout. If they are missing:

```bash
mkdir -p data/profiles data/connexes
```

These directories are gitignored at the file level — JSON files written at runtime are never committed unless you explicitly add them.

---

## 5. Start the server

```bash
python3 app.py
```

The server starts on port **8000** by default. Open http://localhost:8000.

To use a different port:

```bash
PORT=9000 python3 app.py
```

---

## 6. Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | no | `8000` | HTTP listen port |
| `OPENROUTER_API_KEY` | no | — | Planned AI item helper (owl-alpha); not wired in MVP — safe to omit |

Variables can be set in a `.env` file (if you add python-dotenv) or exported in the shell before running.

---

## 7. Run the tests

```bash
python3 -m pytest test_packing.py test_grouping.py test_reconcile.py \
                  test_zero_on_hand.py test_bom_ingest.py test_shr_ingest.py \
                  test_profiles.py test_connex.py test_sitrep.py -v
```

All tests must pass (73 legacy + 59 new = 132+ total). If any test fails, do not deploy.

---

## 8. Verify the 3D review module

The three.js scene is used only at Step 5 (Review & Seal). Verify it with the isolated harness:

1. Start the server (`python3 app.py`).
2. Open http://localhost:8000/static/connex3d/_harness.html
3. Click "openConnex()" → doors swing open.
4. Click "setBoxCount(8)" → 8 boxes appear inside.

If the harness shows a WebGL error, the browser lacks WebGL support. Step 5 in the main app automatically falls back to the per-box checklist view — the workflow still completes without 3D.

**Note on insignia assets:** The brigade gallery (Step 1) contains 97 formation insignia. Assets are downscaled for fast loading on constrained networks and lazy-load in the gallery view. On a slow connection the gallery may take a few seconds to populate; the app is fully functional once the profile is saved.

---

## 9. Verify the style guide

```bash
open static/_styleguide.html
# or open http://localhost:8000/static/_styleguide.html with the server running
```

All component classes and box-state badges should render with the dark/gold command-center aesthetic. Clicking any `?` should open a popover.

---

## Troubleshooting

**Port 8000 already in use:** `PORT=8001 python3 app.py`

**`ModuleNotFoundError`:** Confirm the venv is activated (`which python3` should point inside `venv/`).

**PDF generation fails with reportlab error:** Confirm reportlab 4.0.7 is installed (`pip show reportlab`).

**3D review blank / no WebGL:** The Step 5 per-box checklist still works — confirm each box and click "Apply Brigade Stamp & Seal" to download the ZIP. The 3D view is visual-only.

**BOM ingest data lost after restart:** The in-memory `JOBS` dict does not survive a process restart. Re-upload BOM PDFs after any restart. Connex and profile JSON files are persisted to disk and survive restarts.

**Gallery images slow to load:** Insignia assets are downscaled and lazy-loaded. On very constrained networks, wait for the gallery to populate before selecting a formation. The profile can always be edited after initial save.
