# QA Report — CONNEX 1750 MVP

**Date:** 2026-06-17
**Branch:** feat/connex-3d
**QA Agent:** Wave 3 QA
**Server tested:** Flask dev server, port 8000
**Real BOM PDFs used:** arms room BOMs/ (M4A1 Carbines, M249 LMGs, M39331 Caliber MGs)

---

## 1. Existing Regression Suite

All pre-existing tests run as scripts (not pytest) per project convention.

| File | Tests | Result |
|------|-------|--------|
| `test_packing.py` | 73 | PASS |
| `test_grouping.py` | 5 | PASS |
| `test_reconcile.py` | integration | PASS |
| `test_zero_on_hand.py` | 4 | PASS |
| `test_bom_ingest.py` | spot check | PASS |
| `test_shr_ingest.py` | spot check | PASS |
| `test_profiles.py` | 14 | PASS |
| `test_connex.py` | 38 | PASS |
| `test_sitrep.py` | 20 | PASS |
| `test_e2e.py` | E2E | PASS (ALL PASS) |

**No regressions introduced.**

---

## 2. New Test File

`test_acceptance.py` — 121 tests covering:
- §8 acceptance walkthrough (steps 1–8)
- Contract B seal validation matrix (all 5 codes + sunny-day + multi-error)
- Adversarial checks (9 scenarios)
- Frontend static wiring (headless)

Run: `python3 test_acceptance.py` (server must be running on :8000)

Result: **121/121 PASS**

---

## 3. §8 Acceptance Walkthrough

Executed against real BOM PDFs from `arms room BOMs/` directory.

| Step | Description | Result |
|------|-------------|--------|
| 1 | Pick/save brigade+battalion profile (with brigade_image) | PASS |
| 2 | Open connex, spawn 3 boxes; status=building | PASS |
| 3 | Ingest 3 real BOM PDFs, attach job, assign to boxes, set SLOC/SHRH; all boxes go complete | PASS |
| 4 | Blocked from sealing without signer (NO_SIGNER); seal ok=True after providing signer | PASS |
| 5 | Add optional individual item to box; description stored | PASS |
| 6 | Download ZIP with 3 per-box DD1750 PDFs (valid %PDF, >10KB each) | PASS |
| 7 | Start 2nd connex under same profile; 1st connex still accessible and sealed | PASS |
| 8 | SITREP JSON across both connexes (connex_count=2, bom_count>=4); SITREP PDF is valid | PASS |
| 8b | SITREP by profile_id returns same connexes | PASS |

---

## 4. Contract B Seal Validation Matrix

| Code | Trigger | ok= | Result |
|------|---------|-----|--------|
| `EMPTY_BOX` | Box has no BOMs and no individual items | False | PASS |
| `MISSING_SLOC` | Populated box with blank sloc | False | PASS |
| `MISSING_SHRH` | Populated box with blank shrh_poc | False | PASS |
| `NO_SIGNER` | signed_by blank | False | PASS |
| `SIGNER_EQ_PACKER` | signed_by == packed_by | False | PASS |
| Sunny-day | All fields valid, SUN/CONNEX/SEAL blank | True | PASS (blank → allowed) |
| Multi-error | Multiple violations simultaneously | — | PASS (all returned at once) |

---

## 5. Adversarial Checks

| Check | Result | Notes |
|-------|--------|-------|
| ADV1: Seal with mixed empty/populated boxes | PASS | EMPTY_BOX blocks seal |
| ADV2: Blank all optional fields → PDF no crash | PASS | seal ok=True; valid PDF generated |
| ADV3: 0 boxes | PASS | 400 + INVALID_BOX_COUNT (clean rejection) |
| ADV4: 24 boxes | PASS | Exactly 24 boxes spawned |
| ADV5: Re-ingest same BOM twice | PASS | Two distinct bom_ids; no hidden dedup |
| ADV6: Generate then start 2nd connex | PASS | First connex JSON intact on disk |
| ADV7: Individual-items-only box (no BOMs) | PASS | Seals + generates 1-PDF ZIP |
| ADV8: Missing SLOC/SHRH per box | PASS | MISSING_SLOC + MISSING_SHRH both fire |
| ADV9: Signer == packer | PASS | SIGNER_EQ_PACKER blocks seal |

**Design note on ADV5 cross-job assignment:** A connex's `/assign` route only resolves BOMs from its attached job. Assigning a bom_id from a different job silently no-ops (the bom is unknown to the connex). This is by design — one connex, one ingest job. Operators who re-ingest the same file into a second job and try to assign its bom_id get a silent skip, not an error. Recommendation: the backend could return a warning for unknown bom_ids in the `moves` list; filed below as DEFECT-1 (LOW severity).

---

## 6. Frontend Wiring (Headless)

| Check | Result |
|-------|--------|
| index.html loads, references tokens.css/style.css/connex3d.js | PASS |
| importmap present, three.js CDN wired | PASS |
| tokens.css: all 5 CSS custom properties present | PASS |
| app.js: POSTs /api/profiles with brigade_image | PASS |
| app.js: fetches /static/formations/manifest.json | PASS |
| app.js: references /api/sitrep | PASS |
| glossary.js: SLOC, SHRH, SUN, NSN, LIN defined | PASS |
| connex3d.js: exports all Contract D surface (7 symbols) | PASS |
| formations manifest: 200, has formations list (97 entries) | PASS |

### Manual Browser Checks Required

The following require a real browser with WebGL — cannot be verified headless:

- [ ] **3D render:** `createConnexScene` mounts without error; connex geometry visible
- [ ] **Drag-drop:** BOM card drag onto canvas fires `onBoxDrop`; box recolors
- [ ] **Box state colors:** empty=gray, warn=amber, complete=green (reads `--connex-*` tokens)
- [ ] **openConnex / closeConnex animation:** doors swing open/shut smoothly
- [ ] **applyStamp:** battalion stamp stencil visible on closed doors
- [ ] **WebGL fallback:** disable WebGL; confirm table-view fallback loads without error
- [ ] **Gallery / formations gallery visual:** SVG formations load and display correctly in profile step

---

## 7. Defects

### DEFECT-1 — LOW — Silent no-op for unknown bom_id in /assign

**Severity:** LOW (UX gap, no data corruption)
**Owner:** Backend agent

**Repro:**
```bash
# 1. Ingest a BOM into job_A, get bom_id_A
# 2. Ingest same BOM into job_B, get bom_id_B
# 3. Create connex, attach job_A
# 4. POST /api/connex/<id>/assign with moves: [{bom_id: bom_id_B, box_num: 1}]
#    -> Returns 200 with {connex: ...} but box has 0 bom_ids — no error, no warning
```

**Expected:** `{ warnings: ["bom_id <id> not found in attached job"] }` in response

**Actual:** Silent no-op; box remains empty; operator has no indication the assign failed

**Impact:** Operator would see no BOM assigned, retry, potentially be confused. The seal's EMPTY_BOX check would catch it and block sealing. No data corruption occurs.

---

## 8. Known Limitations (Accepted)

- SITREP BOM nomenclature shows raw bom_ids when the in-memory ingest job has expired (process restart). This is documented in the backend handoff — single-worker constraint.
- `/api/sitrep/pdf` produces a correct PDF (~3KB) from the SITREP JSON. Per-connex DD1750-style detail is not embedded in the SITREP PDF — it covers the commander's overview only.
- 3D module `_geoCache` persists for the page lifetime (acceptable for single-page tool).
- No content-hash deduplication on BOM ingest — same file uploaded twice = two distinct BOMs (by design).

---

## 9. Definition of Done Assessment

| Criterion | Status |
|-----------|--------|
| `pytest` green (existing tests) | PASS — all existing test_*.py pass |
| New tests: `test_acceptance.py` 121/121 | PASS |
| Seal validation matrix all 5 codes covered | PASS |
| §8 acceptance walkthrough end-to-end | PASS |
| Every filed defect has repro + severity | PASS (1 LOW defect filed) |
| No regression in legacy 2D flow | PASS (test_e2e.py ALL PASS) |

**MVP is SHIPPABLE.** One LOW defect (silent no-op on unknown bom_id) does not block shipping — the seal validation catches the downstream consequence.
