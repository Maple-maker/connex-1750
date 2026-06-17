# QA Agent Handoff

**Date:** 2026-06-17
**Branch:** feat/connex-3d
**Agent:** QA (Wave 3)

---

## Files Created

| File | Notes |
|------|-------|
| `test_acceptance.py` | 121-test acceptance + adversarial suite; run as `python3 test_acceptance.py` |
| `docs/QA_REPORT.md` | Full acceptance record, Contract B matrix, defect log |
| `docs/handoff/qa.md` | This file |

**Files NOT touched:** all existing test_*.py (backend owns those), app.py, all Python modules, static/ files, templates/.

---

## Test Inventory

### test_acceptance.py (NEW — 121 tests)
- `test_health()` — server pre-flight
- `test_acceptance_walkthrough()` — §8 steps 1–8 against real BOM PDFs
- `test_seal_validation_matrix()` — all 5 Contract B codes + sunny-day + multi-error
- `test_adversarial()` — 9 adversarial scenarios (empty boxes, blank fields, 0/24 box counts, re-ingest, generate-then-second-connex, items-only path, missing SLOC/SHRH, signer==packer)
- `test_frontend_wiring()` — headless static file checks (tokens.css, style.css, app.js, glossary.js, connex3d.js, formations manifest)

Run: `python3 test_acceptance.py` (Flask must be running on :8000)

### Existing suites (all still passing)
| File | Tests | Status |
|------|-------|--------|
| test_packing.py | 73 | PASS |
| test_grouping.py | 5 | PASS |
| test_reconcile.py | integration | PASS |
| test_zero_on_hand.py | 4 | PASS |
| test_profiles.py | 14 | PASS |
| test_connex.py | 38 | PASS |
| test_sitrep.py | 20 | PASS |
| test_e2e.py | E2E | PASS |

---

## Acceptance Results

**test_acceptance.py: 121/121 PASS**

§8 walkthrough: all 9 steps PASS against real M4A1 Carbine, M249 LMG, and M39331 MG BOMs.

Contract B matrix: all 5 codes fire correctly; blank SUN/CONNEX/SEAL allowed; multiple errors returned in one call.

---

## Defects Filed

### DEFECT-1 — LOW — Silent no-op for unknown bom_id in /assign
**Owner:** Backend agent
**Repro:** Assign a bom_id from a non-attached job → 200 response, box stays empty, no warning
**Impact:** UX gap only; seal's EMPTY_BOX check blocks downstream consequence; no data corruption
**Fix recommendation:** Return `{ warnings: ["bom_id <id> not found in attached job"] }` in the response body

---

## Manual Browser Checks (QA cannot verify headless)

- [ ] 3D render: connex + boxes visible, no WebGL errors in console
- [ ] Drag-drop: BOM card onto canvas fires onBoxDrop; box recolors
- [ ] Box state colors: empty=gray, warn=amber, complete=green
- [ ] openConnex / closeConnex animations
- [ ] applyStamp stencil on closed doors
- [ ] WebGL fallback: table-view loads without error when WebGL disabled
- [ ] Formations gallery: SVG images load in profile step

---

## How to Verify

```bash
# Regression
python3 test_packing.py && python3 test_grouping.py && python3 test_connex.py && python3 test_sitrep.py

# Acceptance + adversarial
python3 app.py &
python3 test_acceptance.py
kill %1  # free :8000
```

---

## Known Gaps / Accepted Limitations

- SITREP BOM nomenclature shows raw bom_ids after process restart (single-worker in-memory job store — by design).
- No content-hash dedup on BOM ingest (same file = two distinct bom_ids — by design).
- 3D render, drag-drop, animations, WebGL fallback require manual browser verification.
