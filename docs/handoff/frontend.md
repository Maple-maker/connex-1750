# Frontend Agent Handoff

**Date:** 2026-06-17
**Branch:** feat/connex-3d
**Agent:** Frontend (Wave 2)
**Commit:** 7900e2b

---

## Files Created / Changed

| File | Status | Notes |
|------|--------|-------|
| `templates/index.html` | REPLACED | 3-column .cx-layout shell; three.js importmap; legacy 2D flow preserved in `<details>` |
| `static/app.js` | REPLACED | Full 8-step ES-module state machine; all Contract A calls; Contract D wiring |
| `static/glossary.js` | NEW | Canonical GLOSSARY (13 terms) + `buildHelpPopover()` helper |
| `docs/handoff/frontend.md` | NEW | This file |

**Files NOT changed (owned by other agents):**
`static/style.css`, `static/tokens.css`, `static/connex3d.js`, `app.py`, all Python modules.

---

## State Machine Map

```
STATE.step ──────────────────────── Guard (cannot advance until…)
┌──────────────────────────────────────────────────────────────────┐
│ PROFILE         renderProfileStep()     no guard (entry point)  │
│   ↓ goTo()      POST /api/profiles                              │
│ CONNEX_SETUP    renderConnexSetupStep() STATE.profile set        │
│   ↓             POST /api/connex                                │
│ PACKING         renderPackingStep()     STATE.connex set         │
│   ↓             POST /ingest (attach)                           │
│                 POST /api/connex/<id>/assign                    │
│                 PUT  /api/connex/<id>  (SLOC/SHRH per box)     │
│ SEAL_DATA       renderSealDataStep()   allBoxesComplete()        │
│   ↓             PUT  /api/connex/<id>  (SUN/CONNEX/signed_by)  │
│                 POST /api/connex/<id>/seal → Contract B errors  │
│ INDIVIDUAL      renderIndividualStep() seal returned ok:true     │
│   ↓             PUT  /api/connex/<id>  (individual_items)      │
│ CLOSE_STAMP     renderCloseStampStep() connex.status==="sealed"  │
│   ↓             POST /api/connex/<id>/generate → ZIP download  │
│ NEXT?           renderNextStep()       connex sealed             │
│   ↓ "another"   → reset connex/boms, loop to CONNEX_SETUP      │
│   ↓ "finish"    → goTo("SITREP")                               │
│ SITREP          renderSitrepStep()     sessionConnexIds.length>0 │
│                 POST /api/sitrep                                 │
│                 POST /api/sitrep/pdf → PDF download             │
└──────────────────────────────────────────────────────────────────┘
```

**Back-navigation:** clicking a completed stepper dot (index ≤ current) always succeeds with no guard check. Forward-jump of >1 step via stepper is blocked.

---

## AI Helper Hook Location

File: `static/app.js`, function `renderIndividualStep()`, right-rail panel.

```js
// ============================================================
// AI HELPER HOOK — DEFERRED (fast-follow / owl-alpha)
// When the AI assistant agent is ready, wire it here:
//   - Attach to the input fields below (description, NSN, LIN)
//   - Call POST /api/ai/suggest-item with {description, box_num, connex_id}
//   - Populate suggested NSN/LIN into the form fields
// Contract: /api/ai/suggest-item is a stub defined in ai_assist.py.
// Do NOT connect this in the MVP critical path.
// ============================================================
<div id="ai-helper-hook" style="display:none;" data-ai-endpoint="/api/ai/suggest-item">
  <!-- AI helper mounts here in fast-follow wave -->
</div>
```

The `#ai-helper-hook` div is in the right rail of step 5 (INDIVIDUAL). The `data-ai-endpoint` attribute names the route. Wiring: listen for `input` events on `idesc-${boxNum}-${idx}` fields, debounce 600ms, POST to `/api/ai/suggest-item`, populate `insn-` and `ilin-` inputs with the response.

---

## Contract A Routes Called Per Step

| Step | Routes Called |
|------|--------------|
| PROFILE | `GET /api/profiles`, `POST /api/profiles`, `GET /api/profiles/<id>` |
| CONNEX_SETUP | `POST /api/connex` |
| PACKING | `POST /ingest` (existing), `POST /api/connex/<id>/attach`, `POST /api/connex/<id>/assign`, `PUT /api/connex/<id>` |
| SEAL_DATA | `PUT /api/connex/<id>` (draft save), `POST /api/connex/<id>/seal` |
| INDIVIDUAL | `PUT /api/connex/<id>` (per-box individual_items) |
| CLOSE_STAMP | `POST /api/connex/<id>/generate` (binary ZIP) |
| NEXT? | — (state reset only) |
| SITREP | `POST /api/sitrep`, `POST /api/sitrep/pdf` |

---

## Drag-Drop → /assign Mapping

1. BOM card sets `draggable="true"` and fires `handleBomDragStart(event, bomId)` on `dragstart`, which writes `bomId` into `event.dataTransfer` under key `application/bom-id`.
2. `STATE._pendingDragBomId` is set on `dragenter` on the canvas.
3. The 3D module raycasts (Contract D) and fires `onBoxDrop(boxNum, payload)`. Frontend's `handleBoxDrop(boxNum)` reads `STATE._pendingDragBomId` and POSTs to `POST /api/connex/<id>/assign`.
4. On success, `syncBoxStateTo3D()` calls `scene.setBoxState(boxNum, {complete, bomCount, hasItems})` to recolor the box.

The table-view fallback (no WebGL) uses the click-to-assign panel (`openBomAssignPanel`) instead of drag-drop. Both paths call the same `/assign` endpoint.

---

## 3D Module Integration

Wiring is against Contract D (`/static/connex3d.js`). The `initScene()` function does a dynamic `import("/static/connex3d.js")` — if it throws (module absent, WebGL unavailable, or any error), the canvas is hidden and all UI falls back to the list-table view. No hard crash.

Callbacks wired:
- `scene.onBoxDrop(cb)` → `handleBoxDrop(boxNum, payload)`
- `scene.onBoxSelect(cb)` → `openBoxDetailPanel(boxNum)`

3D calls made per step:
- CONNEX_SETUP: `scene.openConnex(true)`, `scene.setBoxCount(n)`
- PACKING: `scene.highlightBox(boxNum, on)`, `scene.setBoxState(boxNum, {...})`
- SEAL_DATA: `scene.closeConnex(true)` (called on advance from PACKING)
- CLOSE_STAMP: `scene.applyStamp(profile.stamp_text)`
- NEXT? → new connex: `scene.dispose()` + `initScene()` re-mounts

**Integration gap:** `connex3d.js` was not delivered at time of this commit. Frontend is wired against Contract D and the fallback is verified. QA should verify 3D integration once `connex3d.js` is committed.

---

## Glossary Coverage

All required jargon terms have `?` popovers via `buildHelpPopover()` from `glossary.js`:

| Term | Where |
|------|-------|
| SLOC | Box detail panel (PACKING step) — labeled "Required" |
| SHRH POC | Box detail panel (PACKING step) — labeled "Required" |
| SUN # | SEAL_DATA step |
| CONNEX # | CONNEX_SETUP + SEAL_DATA |
| SEAL # | SEAL_DATA step |
| NSN | INDIVIDUAL step (per-item form) |
| LIN | INDIVIDUAL step (per-item form) |
| CONNEX | CONNEX_SETUP step title |

---

## Seal Error Inline Display

`renderSealErrors(errors)` in `seal-data` step:
- Renders the `errors` array from `POST /api/connex/<id>/seal` response (`{ok:false, errors:[...]}`)  into `.cx-error-list` block.
- Maps `NO_SIGNER` and `SIGNER_EQ_PACKER` error codes to add `.cx-field--error` class to `#sd_signed_by` input.
- `MISSING_SLOC` / `MISSING_SHRH` / `EMPTY_BOX` are shown in the error list — the per-box context is in the PACKING step's box detail panel.

---

## Legacy 2D Flow Preservation

All original functions renamed with `legacy` prefix (`legacyDoIngest`, `legacyAutoAssign`, etc.) and moved to a non-module `<script>` tag scoped inside `#legacy-wrap`. All routes (`/ingest`, `/assign`, `/regroup`, `/generate-master`, `/generate-individuals`, `/audit`) are unchanged. The legacy section is collapsed inside a `<details>` element — not removed. No regression introduced.

---

## Known Gaps / TODO for Downstream

| Gap | Owner | Notes |
|-----|-------|-------|
| `connex3d.js` not yet committed | 3D agent | Frontend wired against Contract D; WebGL fallback active |
| `scene.onBoxDrop` payload format | 3D agent | Frontend reads `STATE._pendingDragBomId` on `dragenter`; the exact payload from the 3D callback is not yet confirmed — may need one-line fix once 3D ships |
| AI helper | AI Assistant (fast-follow) | Hook at `#ai-helper-hook` in INDIVIDUAL step right rail |
| SITREP PDF | DD1750 agent | `/api/sitrep/pdf` returns JSON bytes as placeholder; will auto-improve when `sitrep_render.render_sitrep_pdf` is implemented |

---

## How to Verify

```bash
# Start the server
cd master-1750-tool && python3 app.py

# Confirm new shell loads (not legacy)
curl -s http://localhost:8000/ | grep "CONNEX 1750"
# -> <title>CONNEX 1750 — Packing List Generator</title>

# Confirm static modules load (ES module imports)
curl -s http://localhost:8000/static/app.js | head -3
curl -s http://localhost:8000/static/glossary.js | head -3

# Confirm API routes (note: macOS system proxy on :8000 may intercept --
# test from Python if curl shows 404)
python3 -c "import requests; print(requests.get('http://localhost:8000/api/profiles').status_code)"
# -> 200

# Run the full legacy + new test suite (no regressions)
python3 -m pytest test_packing.py test_grouping.py test_reconcile.py test_zero_on_hand.py \
                  test_profiles.py test_connex.py test_sitrep.py -v

# Open in browser, step through workflow:
# 1. Fill profile form → Save Profile → auto-advances to Connex Setup
# 2. Set box count → Open Connex → advances to Packing
# 3. Drop BOM PDFs → assign to boxes → fill SLOC+SHRH → advance
# 4. Fill SUN/signer → Seal Connex → Contract B errors appear inline if invalid
# 5. Add optional individual items
# 6. Download DD1750 ZIP
# 7. Choose another connex or SITREP
```
