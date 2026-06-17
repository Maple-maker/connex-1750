# Frontend Agent Handoff

**Date:** 2026-06-17
**Branch:** feat/connex-3d
**Agent:** Frontend (Wave 2 → Wave 3 redesign → Wave 3 tutorial)

---

## Files Created / Changed

| File | Status | Notes |
|------|--------|-------|
| `templates/index.html` | REPLACED | 3-column .cx-layout shell; three.js importmap; legacy 2D flow preserved in `<details>`; split-screen CSS; no persistent 3D canvas at load; tutorial overlay + header button |
| `static/app.js` | REPLACED | 6-step ES-module state machine; 2D split-screen PACKING; 3D ONLY in REVIEW_SEAL; all Contract A calls; tutorial carousel |
| `static/glossary.js` | NEW | Canonical GLOSSARY (13 terms) + `buildHelpPopover()` helper; img/caption support for SEAL#/CONNEX# |
| `docs/handoff/frontend.md` | NEW | This file |

**Files NOT changed (owned by other agents):**
`static/style.css`, `static/tokens.css`, `static/connex3d.js`, `app.py`, all Python modules.

---

## State Machine Map — 6 Steps

```
STATE.step ──────────────────────── Guard (cannot advance until…)
┌──────────────────────────────────────────────────────────────────────┐
│ PROFILE         renderProfileStep()       no guard (entry point)    │
│   ↓ goTo()      GET /static/formations/manifest.json               │
│                 GET /api/profiles  (resume card)                    │
│                 POST /api/profiles                                  │
│ CONNEX_SETUP    renderConnexSetupStep()   STATE.profile set          │
│   ↓             POST /api/connex                                    │
│ PACKING         renderPackingStep()       STATE.connex set           │
│   ↓             POST /ingest (attach)                               │
│   [2D split]    POST /api/connex/<id>/attach                        │
│                 POST /api/connex/<id>/assign   (BOM → box)         │
│                 PUT  /api/connex/<id>          (SLOC/SHRH per box) │
│ SEAL_DATA       renderSealDataStep()      allBoxesComplete()         │
│   ↓             PUT  /api/connex/<id>  (SUN/CONNEX/signed_by)     │
│ REVIEW_SEAL     renderReviewSealStep()    STATE.connex set           │
│   [3D mount]    POST /api/connex/<id>/seal → Contract B errors     │
│                 POST /api/connex/<id>/generate → ZIP download       │
│   ↓ on success  → auto-advance after 1.2 s                        │
│ NEXT_SITREP     renderNextSitrepStep()    connex.status==="sealed"   │
│   ↓ "another"   → reset connex/boms, loop to CONNEX_SETUP         │
│   ↓ "sitrep"    POST /api/sitrep                                    │
│                 POST /api/sitrep/pdf → PDF download                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Key design decisions from Wave 3 redesign:**
- INDIVIDUAL items are added inside the PACKING step (left pool, "Add Individual Item" form). No separate INDIVIDUAL step.
- 3D canvas is NOT present at page load. It is created dynamically inside `renderReviewSealStep()` and disposed by `goTo()` on step exit.
- The persistent 3D/Table view toggle from the old design is gone — no such element exists in the HTML.
- PACKING is a pure 2D split-screen (pool ↔ boxes). Zero three.js in steps 1–4.

**Back-navigation:** clicking a completed stepper dot (index ≤ current) always succeeds with no guard check. Forward-jump of >1 step via stepper is blocked.

---

## PACKING Step — 2D Split-Screen Detail

HTML structure (rendered by `renderPackingStep()`):
```
#packing-split   { grid-template-columns: 1fr 1fr }
├── left column
│   ├── #bom-drop-zone          Drop PDF → ingestBoms() → POST /ingest
│   ├── #pool-cards             Rendered by renderPoolCards()
│   │   └── .cx-bom-card[draggable]   Pool = boms not in any box.bom_ids
│   └── #individual-form        Hidden until "+ Add Individual Item" click
└── right column
    └── #box-cards              Rendered by renderBoxCards()
        └── .cx-panel per box
            ├── BOM chips + × unassign buttons
            ├── individual item chips + × remove buttons
            ├── #sloc-N input   → onchange: saveBoxField(N,'sloc',val)
            └── #shrh-N input   → onchange: saveBoxField(N,'shrh_poc',val)
```

**Assignment paths:**
1. **Drag-drop:** `ondragstart` → `STATE._dragBomId`; `ondrop` → `assignBomToBox(bomId, boxNum)` → `POST /assign {moves:[...]}`
2. **Click-select:** click pool card → `STATE._clickSelectBomId = bomId` (gold outline); click box card → `assignBomToBox(bomId, boxNum)`
3. **Unassign:** click `×` chip → `POST /assign {moves:[{bom_id, exclude:true}]}`

A box is `complete` when: populated AND has SLOC AND has SHRH POC. Computed server-side on every write; `box.complete` is read directly from the response.

---

## REVIEW_SEAL Step — 3D Integration

3D canvas is mounted in `initReviewScene()` (async, non-blocking):
```js
const mod    = await import("/static/connex3d.js");  // dynamic import — throws → fallback
const canvas = document.createElement("canvas");
mount.appendChild(canvas);
STATE.scene  = mod.createConnexScene(canvas, {});
await STATE.scene.openConnex(false);     // read-only, no drag
STATE.scene.setBoxCount(boxes.length);
boxes.forEach(b => STATE.scene.setBoxState(b.box_num, {...}));
STATE.scene.onBoxSelect(boxNum => showReviewBoxDetail(boxNum));
```

On WebGL failure: `try/catch` suppresses; `#cx-3d-loading` shows "3D view unavailable — using checklist above." The box checklist table is always rendered regardless of 3D availability.

On stamp + seal (in `applySealAndDownload()`):
```js
STATE.scene.applyStamp(profile.stamp_text);
await STATE.scene.closeConnex(true);
```

On step exit: `STATE.scene.dispose()` is called by `goTo()` when leaving REVIEW_SEAL.

---

## Contract A Routes Called Per Step

| Step | Routes Called |
|------|--------------|
| PROFILE | `GET /api/profiles`, `POST /api/profiles`, `GET /api/profiles/<id>` |
| CONNEX_SETUP | `POST /api/connex` |
| PACKING | `POST /ingest`, `POST /api/connex/<id>/attach`, `POST /api/connex/<id>/assign`, `PUT /api/connex/<id>` |
| SEAL_DATA | `PUT /api/connex/<id>` |
| REVIEW_SEAL | `POST /api/connex/<id>/seal`, `POST /api/connex/<id>/generate` |
| NEXT_SITREP | `POST /api/sitrep`, `POST /api/sitrep/pdf` |

---

## Glossary Coverage

All jargon terms have `?` popovers via `buildHelpPopover()` from `glossary.js`:

| Term | Where |
|------|-------|
| SLOC | Box cards in PACKING step — labeled "req" |
| SHRH POC | Box cards in PACKING step — labeled "req" |
| SUN # | SEAL_DATA step |
| CONNEX # | CONNEX_SETUP + SEAL_DATA |
| SEAL # | SEAL_DATA step |
| NSN | PACKING step individual item form |
| LIN | PACKING step individual item form |
| CONNEX | CONNEX_SETUP step title |

---

## Seal Error Display

`renderSealErrors(errors)` in REVIEW_SEAL step:
- Renders the `errors` array from `POST /api/connex/<id>/seal` response (`{ok:false, errors:[...]}`) into `#seal-errors`.
- Contract B error codes: `EMPTY_BOX`, `MISSING_SLOC`, `MISSING_SHRH`, `NO_SIGNER`, `SIGNER_EQ_PACKER`.
- Blank SUN/CONNEX#/SEAL# are allowed at seal (server returns ok=true).

---

## Tutorial Carousel

### Gate logic
```js
const TUTORIAL_STORAGE_KEY = "connex_tutorial_v1_seen";
// On DOMContentLoaded: if !localStorage.getItem(key) → openTutorial()
// On close/skip/get-started: localStorage.setItem(key, "1")
```

### Public API (all on `window`)
| Function | Description |
|----------|-------------|
| `openTutorial()` | Opens modal at slide 0; attaches keyboard handler |
| `closeTutorial()` | Closes modal; sets localStorage gate; removes keyboard handler |
| `tutorialNext()` | Advances one slide; on last slide calls closeTutorial() |
| `tutorialBack()` | Goes back one slide |
| `tutorialGoTo(idx)` | Jumps to a specific slide (dot indicator click) |
| `handleTutorialBackdropClick(e)` | Closes if backdrop (not modal) clicked |

### Keyboard
- `ArrowRight` → next slide
- `ArrowLeft` → back
- `Escape` → close
- `Tab` / `Shift+Tab` → focus trapped inside `#cx-tutorial-modal`

### Slides (7 total)
1. Welcome — overview of the whole tool
2. Step 1 · Profile — insignia gallery + unit save
3. Step 2 · Connex Setup — name + box count
4. Step 3 · Packing — drag/click-select BOM assignment + SLOC/SHRH
5. Step 4 · Seal Data — SUN/CONNEX/SEAL # + signer
6. Step 5 · Review & Seal — visual check + stamp + ZIP download
7. Step 6 · Next / SITREP — another connex or commander's SITREP

### HTML elements (in index.html)
- `#cx-tutorial-backdrop` — full-screen dim; `.cx-tutorial--open` class toggles visibility
- `#cx-tutorial-modal` — glassmorphism card (glass background, gold border)
- `#cx-tutorial-slide` — injected by `renderTutorialSlide()`
- `#cx-tutorial-dots` — dot row, injected by `renderTutorialSlide()`
- `#cx-tutorial-back`, `#cx-tutorial-next`, `#cx-tutorial-skip`, `#cx-tutorial-close`
- `#cx-tutorial-reopen` — header button, always visible

---

## AI Helper Hook Location

Deferred hook lives in PACKING step's individual-item form. When the AI assistant agent is ready:
- Listen on `#indv_desc` input, debounce 600ms
- POST `/api/ai/suggest-item` with `{description, connex_id}`
- Populate `#indv_nsn` and `#indv_lin` from response

---

## End-to-End Verification Results (Wave 3)

Verified live against real BOM PDFs in `../arms room BOMs/`:

```
[1] Profile: POST /api/profiles → 200, brigade_image wired
[2] Connex:  POST /api/connex   → status=building, 3 boxes
[3] Ingest:  POST /ingest (3 M249/M39331 PDFs) → 3 boms extracted
[4] Attach:  POST /api/connex/<id>/attach → 200
[5] Assign:  POST /api/connex/<id>/assign (3 moves) → boxes populated
[6] SLOC/SHRH: PUT /api/connex/<id> → all 3 boxes complete=True
[7] Seal:    POST /api/connex/<id>/seal → ok=True, status=sealed
[8] ZIP:     POST /api/connex/<id>/generate → 32 KB ZIP
             Master_1750.pdf: 59 693 B  PDF=True
             Box_001.pdf:     60 318 B  PDF=True
             Box_002.pdf:     60 694 B  PDF=True
             Box_003.pdf:     60 692 B  PDF=True
```

---

## Legacy 2D Flow Preservation

All original functions are preserved in a non-module `<script>` tag inside `#legacy-wrap → <details>`. All routes (`/ingest`, `/assign`, `/regroup`, `/generate-master`, `/generate-individuals`, `/audit`) unchanged. No regression.

---

## Known Gaps / TODO for Downstream

| Gap | Owner | Notes |
|-----|-------|-------|
| `connex3d.js` contract | 3D agent | Frontend calls `createConnexScene`, `openConnex`, `setBoxCount`, `setBoxState`, `onBoxSelect`, `applyStamp`, `closeConnex`, `dispose`, `resize` — all via dynamic import with try/catch fallback |
| AI helper | AI Assistant (fast-follow) | Hook in PACKING step individual-item form |
| SITREP PDF richness | DD1750 agent | `/api/sitrep/pdf` returns JSON bytes as placeholder; auto-improves when `sitrep_render` ships |

---

## How to Verify

```bash
# Start server
cd master-1750-tool && python3 app.py

# Server up
python3 -c "import requests; print(requests.get('http://localhost:8000/api/profiles').status_code)"
# -> 200

# Headless flow test
python3 -c "
import requests, os
BASE='http://localhost:8000'
BOM_DIR='../arms room BOMs'
# Profile
p = requests.post(f'{BASE}/api/profiles', json={
  'brigade':'108th ADA','battalion':'2-55 ADA','battery':'B',
  'stamp_text':'2-55 ADA','brigade_image':'108th_Air_Defense_Artillery_Brigade.svg',
  'default_packed_by':'1LT RABATIN','signed_by':'CPT HOLLAND'}).json()['profile']
# Connex
c = requests.post(f'{BASE}/api/connex', json={'profile_id':p['profile_id'],'box_count':2}).json()['connex']
# Ingest
files=[('boms',(f, open(os.path.join(BOM_DIR, f),'rb'),'application/pdf'))
       for f in ['M39331 MACHINE GUN CALIBER A001382.pdf']]
job = requests.post(f'{BASE}/ingest', files=files).json()
requests.post(f'{BASE}/api/connex/{c[\"connex_id\"]}/attach', json={'ingest_job_id':job['job_id']})
requests.post(f'{BASE}/api/connex/{c[\"connex_id\"]}/assign', json={'moves':[{'bom_id':job['boms'][0]['bom_id'],'box_num':1}]})
requests.put(f'{BASE}/api/connex/{c[\"connex_id\"]}', json={'boxes':[{'box_num':1,'sloc':'BLDG-100','shrh_poc':'CPT JONES'}],'packed_by':'1LT RABATIN','signed_by':'CPT JONES'})
seal=requests.post(f'{BASE}/api/connex/{c[\"connex_id\"]}/seal').json()
assert seal['ok'], seal
r=requests.post(f'{BASE}/api/connex/{c[\"connex_id\"]}/generate')
assert r.content[:4]==b'PK', 'Not a ZIP'
print('PASS')
"

# Open browser
open http://localhost:8000/
```
