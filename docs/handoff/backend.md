# Backend Agent Handoff

**Date:** 2026-06-17
**Branch:** feat/connex-3d
**Agent:** Backend (Wave 1)

---

## Files Created / Changed

| File | Status | Notes |
|------|--------|-------|
| `profiles.py` | NEW | Load/save/list/upsert Profile JSON under `data/profiles/` |
| `connex_store.py` | NEW | CRUD for Connex JSON under `data/connexes/`; seal validation (Contract B) |
| `sitrep.py` | NEW | Build SITREP JSON (Contract C) from connexes; BOM enrichment helper |
| `app.py` | APPENDED | New routes added in a clearly marked section at the bottom; no existing routes touched |
| `test_profiles.py` | NEW | 11 tests — profile CRUD, upsert, persistence, timestamps |
| `test_connex.py` | NEW | 33 tests — CRUD, patch, box completeness, all 5 seal error codes, seal lifecycle |
| `test_sitrep.py` | NEW | 15 tests — SITREP shape, counts, flags, BOM enrichment |
| `data/profiles/.gitkeep` | NEW | Dir marker |
| `data/connexes/.gitkeep` | NEW | Dir marker |
| `data/profiles/seed_2_55_ada_b.json` | NEW | Example profile (gitignored; for dev onboarding) |

---

## Routes Implemented (Contract A)

### Profiles

```
GET  /api/profiles
  -> { "profiles": [Profile, ...] }

POST /api/profiles
  body: { "brigade": "108th ADA Brigade", "battalion": "2-55 ADA", "battery": "B",
          "uic": "WH1ZB0", "default_packed_by": "1LT RABATIN", "stamp_text": "2-55 ADA" }
  -> { "profile": Profile }

GET  /api/profiles/<profile_id>
  -> { "profile": Profile }
```

**Profile shape:**
```json
{
  "profile_id": "hex32",
  "brigade": "108th ADA Brigade",
  "battalion": "2-55 ADA",
  "battery": "B",
  "uic": "WH1ZB0",
  "default_packed_by": "1LT RABATIN, JAIDEN",
  "default_shrh_poc": "",
  "stamp_text": "2-55 ADA",
  "created": "2026-06-17T00:00:00Z",
  "last_used": "2026-06-17T00:00:00Z"
}
```

### Connex Lifecycle

```
POST /api/connex
  body: { "profile_id": "hex32", "box_count": 5, "connex_no": "CONEX-01" }
  -> { "connex": Connex }   # status="building"

GET  /api/connex/<connex_id>
  -> { "connex": Connex }

PUT  /api/connex/<connex_id>
  body (any subset): {
    "sun": "SUN-001", "connex_no": "CONEX-01", "seal_no": "S-12345",
    "packed_by": "1LT RABATIN", "signed_by": "CPT HOLLAND", "date": "17 JUN 2026",
    "boxes": [{ "box_num": 1, "sloc": "BLDG-100", "shrh_poc": "CPT JONES",
                "individual_items": [{"description":"Widget","sn":"","nsn":"","lin":""}] }]
  }
  -> { "connex": Connex }

POST /api/connex/<connex_id>/attach
  body: { "ingest_job_id": "hex32" }
  -> { "connex": Connex }

POST /api/connex/<connex_id>/assign
  body: { "moves": [
    { "bom_id": "hex32", "box_num": 2 },          // move BOM to box
    { "bom_id": "hex32", "separate": true },       // pull into own box (next free #)
    { "bom_id": "hex32", "exclude": true }         // drop from packing list
  ]}
  -> { "connex": Connex }

POST /api/connex/<connex_id>/seal
  -> { "ok": true|false, "errors": ["EMPTY_BOX: Box 1 is empty..."], "connex": Connex }
  # Always HTTP 200 — errors are field-level guidance, not HTTP failures

POST /api/connex/<connex_id>/generate
  -> binary ZIP (one DD1750 PDF per occupied box)
  # Currently uses existing render_core.generate_dd1750_from_items (no battalion stamp)
  # See DD1750 agent TODO below
```

**Connex shape:**
```json
{
  "connex_id": "hex32",
  "profile_id": "hex32",
  "status": "building",
  "ingest_job_id": "hex32 | null",
  "box_count": 5,
  "boxes": [
    {
      "box_num": 1,
      "bom_ids": ["hex32"],
      "sloc": "BLDG-100",
      "shrh_poc": "CPT JONES",
      "individual_items": [{ "description": "", "sn": "", "nsn": "", "lin": "" }],
      "complete": false
    }
  ],
  "sun": "",
  "connex_no": "CONEX-01",
  "seal_no": "",
  "packed_by": "1LT RABATIN",
  "signed_by": "",
  "date": "17 JUN 2026",
  "created": "2026-06-17T00:00:00Z",
  "sealed": null
}
```

### SITREP

```
POST /api/sitrep
  body: { "connex_ids": ["hex32", "hex32"] }
    OR  { "profile_id": "hex32" }   // fetches all connexes for this profile
  -> { "sitrep": SitrepModel }   # Contract C shape

POST /api/sitrep/pdf
  body: same as /api/sitrep
  -> binary "PDF" (currently returns SITREP JSON as bytes — STUB pending DD1750 render)
```

---

## Contract B — Seal Error Codes

All five codes are implemented and tested:

| Code | Condition |
|------|-----------|
| `EMPTY_BOX` | box has no BOMs and no individual items |
| `MISSING_SLOC` | populated box has blank sloc |
| `MISSING_SHRH` | populated box has blank shrh_poc |
| `NO_SIGNER` | signed_by blank |
| `SIGNER_EQ_PACKER` | signed_by == packed_by |

Error strings are prefixed with the code (`"EMPTY_BOX: Box 1 is empty…"`) for machine parsing.
`sun`/`connex_no`/`seal_no` blank is **valid** at seal time.

---

## TODO for DD1750 Agent

The `/api/connex/<id>/generate` route has a clearly marked `# TODO(DD1750 agent)` block.

**Expected interface:**
```python
# sitrep_render.py  (owned by DD1750 agent)
def generate_stamped_box_pdf(
    bom_items: list,          # list of render_core.BomItem
    template_pdf: str,        # path to blank_1750.pdf
    out_path: str,            # output file path
    header: render_core.HeaderInfo,  # includes stamp_text, sloc, sun, connex_no, seal_no
) -> None:
    """Render one per-box DD1750 with battalion stamp applied."""
    ...

def render_sitrep_pdf(sitrep: dict) -> bytes:
    """Render a SITREP PDF from the Contract C dict. Returns raw PDF bytes."""
    ...
```

Until `sitrep_render` is available the routes fall back gracefully:
- `/generate` — uses existing `render_core.generate_dd1750_from_items` (no stamp)
- `/sitrep/pdf` — returns SITREP JSON as raw bytes (placeholder "PDF")

Both fallbacks are guarded with `# TODO(DD1750 agent)` comments at the exact substitution point.

---

## Seed Data

`data/profiles/seed_2_55_ada_b.json` — example profile for 2-55 ADA Bravo Battery.
Gitignored by `data/profiles/*` — for local dev onboarding only.

---

## Test Results

```
test_profiles.py : 11/11 passed
test_connex.py   : 33/33 passed
test_sitrep.py   : 15/15 passed

Pre-existing tests (no regressions):
  test_packing.py       : 73/73 passed
  test_grouping.py      :  5/5  passed
  test_reconcile.py     :  passed
  test_zero_on_hand.py  :  4/4  passed
```

---

## For Frontend Agent

- All new routes are under `/api/` prefix.
- Errors always return `{ "error": "human message", "code": "MACHINE_CODE" }` with appropriate HTTP status.
- Seal validation returns HTTP 200 with `{ "ok": false, "errors": [...] }` — not an HTTP error.
- `box.complete` is recomputed server-side on every write; Frontend can read it to recolor boxes.
- The `JOBS` dict (in-memory) holds BOM data keyed by `job_id`. It must survive as long as the gunicorn process lives (single-worker). If the process restarts, ingest must be re-run.
- SITREP BOM nomenclature is enriched from the in-memory job when available. Without a live job, boms show as raw bom_ids (placeholder).

---

## How to Verify

```bash
# Run all new tests
python3 test_profiles.py
python3 test_connex.py
python3 test_sitrep.py

# Smoke-test the routes (Flask must be running: python3 app.py)
curl -s -X POST http://localhost:8000/api/profiles \
  -H 'Content-Type: application/json' \
  -d '{"brigade":"108th ADA","battalion":"2-55 ADA","battery":"B","stamp_text":"2-55 ADA"}' | jq .

curl -s http://localhost:8000/api/profiles | jq .
```
