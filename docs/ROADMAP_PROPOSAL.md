# C.R.A.T.E. Roadmap Proposal — Issue 9

**Author:** A6 (PRODUCT ADVISOR, call sign CDR INTENT)
**Status:** Advisory only — no code changed. This document recommends what to build next.
**Scope:** Container Readiness and Accountability Tracking Engine (C.R.A.T.E.) — the Flask + vanilla-JS connex packing / DD1750 generator used by sub-hand-receipt holders (SHRH) and commanders.

---

## Intro

C.R.A.T.E. already does the hard part: it ingests BOM PDFs (with OCR), packs items into connex boxes on a 2D split-screen, validates a seal, and emits per-box + Master DD1750 PDFs plus a SITREP / Movement Packet. The 7-step workflow is solid and the data model is clean (connexes as JSON on disk, profiles persisted, ingest jobs in `job_store`).

The opportunity now is **accountability and command visibility**, not more packing mechanics. An SHRH needs the tool to make their sign-off defensible. A commander needs to see readiness across every connex without opening each one. The candidate features below are evaluated against what the code *already* stores — so "low effort" claims are grounded in the actual model, not optimism.

A note on grounding, because it changes the rankings:
- `boxBadge()` in `app.js` **already computes green/amber/red** state (Empty / Ready / Needs SLOC/POC / Incomplete). A readiness roll-up is reuse, not new logic.
- `lin_source` / `serial_source` / `niin_source` provenance tags are **already surfaced** through the API (`app.py` ~L391). Low-confidence flagging is a render change only.
- `build_sitrep()` in `sitrep.py` **already aggregates** connex_count, box_count, bom_count, zero-on-hand boxes, and missing-SUN flags. A commander dashboard is mostly a new view over an existing data feed.
- `/api/session-packet` **already merges** SITREP + per-connex Master 1750s into one `Movement_Packet.pdf`. The "combined PDF" feature is largely shipped.
- Profiles **already persist** `default_shrh_poc` and brigade/battalion/battery. A reusable SHRH directory is an extension, not a greenfield build.
- **Gap that matters:** `bom_ingest.py` reads both `oh_qty` and `auth_qty`, but **collapses them into a single `qty`** and only keeps a boolean `zero_on_hand`. The authorized quantity is *not persisted* on the BOM. Any shortage annex must first retain `auth_qty` through ingest.

---

## Ranked evaluation

Each feature: value, effort (S/M/L), dependencies, and whether existing data supports it.

### 1. Signature capture / digital sign-off
- **Value (SHRH/CDR):** High. The DD1750 signature block is the whole point of accountability — an e-signed packet that prints SHRH + commander names/dates into the 1750 is the difference between "a packing list" and "a hand-receipt artifact." Directly serves both roles.
- **Effort:** M. Add `signed_by`/`commander_sign` + signature image/initials + timestamps to the connex model; capture UI (typed name or canvas initials); wire into `render_core` signature block.
- **Dependencies:** Touches `connex_store` schema, `render_core` DD1750 layout, and a new Review-step UI control.
- **Existing data:** Partial. `packed_by` and `signed_by` *names* already exist and are seal-validated (signer must differ from packer). No signature artifact, no commander field, not rendered into the signature block yet.

### 2. Discrepancy / shortage annex (auto when OH Qty < Auth Qty)
- **Value:** High for commanders — shortages are the #1 thing they chase. An auto-generated annex listing every line where on-hand < authorized is genuinely useful.
- **Effort:** M–L. **Blocked on a data gap:** `auth_qty` is currently discarded at ingest (collapsed into `qty`). Must first persist `auth_qty` alongside `oh_qty`, then compute deltas, then render an annex page.
- **Dependencies:** `bom_ingest.py` (retain auth_qty), the BOM/job model, a new annex renderer.
- **Existing data:** No — this is the one feature whose headline data does **not** survive ingest today. Do not call it cheap.

### 3. Change log / audit trail per connex
- **Value:** Medium. Useful for disputes ("who changed box 3's SLOC?"), but day-to-day SHRH/CDR rarely read it. Strong for trust, weak for daily use.
- **Effort:** M. Every `patch_connex` / `seal_connex` / box add-remove is already a single chokepoint — append an event entry there. UI to display is small.
- **Dependencies:** `connex_store` write paths; a log render in the connex view.
- **Existing data:** No persisted history, but writes are centralized so instrumentation is clean.

### 4. Commander dashboard across all connexes
- **Value:** High. The single biggest unmet need for a commander: one screen showing % complete, # unsealed, zero-on-hand flags, and shortages across every connex.
- **Effort:** M. The data feed largely exists in `build_sitrep()` (counts, zero-on-hand flags, status, missing SUN). Mostly a new aggregation endpoint + a dashboard view.
- **Dependencies:** Reuses `sitrep.py` aggregation; new front-end view; benefits from #5's color logic and #2's shortage data.
- **Existing data:** Yes — counts, statuses, and zero-on-hand flags are already computed; needs roll-up presentation, not new computation.

### 5. Readiness color roll-up (green/amber/red) per connex and SHRH
- **Value:** Medium–High. Instant triage. Mirrors the badge language operators already see at the box level, lifted to connex and SHRH level.
- **Effort:** S. `boxBadge()` already encodes the three-state logic. Roll connex = worst-of-its-boxes (+ seal status); group by `shrh_poc`. Pure derived view.
- **Dependencies:** Reuses existing badge logic; pairs naturally with #4 (it's the dashboard's visual grammar).
- **Existing data:** Yes — box state, completeness, and seal status all already exist.

### 6. Inline "verify extraction" flags for low-confidence SN/LIN/NIIN
- **Value:** Medium–High. Catches OCR/filename-sourced fields before they're sealed into a legal-ish document. Accuracy where it costs the most.
- **Effort:** S. Provenance tags (`lin_source`/`serial_source`/`niin_source`, values `content` vs `filename`) are **already in the API payload**. This is a render/badge change in the BOM table + an audit flag — no backend work.
- **Dependencies:** `app.js` BOM table render + `computeAuditFlags()`; the existing provenance tags from another agent's recent change.
- **Existing data:** Yes — provenance is already surfaced; the UI just doesn't act on it.

### 7. Reusable SHRH directory pre-filled per unit
- **Value:** Medium. Saves retyping POC names; reduces typos that break accountability matching. Quality-of-life, not a capability unlock.
- **Effort:** S–M. Profiles already persist `default_shrh_poc`. Extend to a small list of SHRH names per profile and offer them as a datalist/dropdown when filling box `shrh_poc`.
- **Dependencies:** `profiles.py` schema extension; SHRH POC input fields in Box Status.
- **Existing data:** Partial — one default POC persists today; a directory is an extension of that.

### 8. Print-ready connex placards / box labels (QR/barcode)
- **Value:** Medium. Physical labels with a QR of `box_num` + connex serial help during movement/inventory. Nice for ops, but not core to the sign-off mission.
- **Effort:** M. New label renderer (reportlab can draw a barcode; QR needs a small lib). All source data — box_num, connex_no, seal_no, label — already exists.
- **Dependencies:** New PDF label endpoint; a QR/barcode dependency.
- **Existing data:** Yes — all fields exist; only the renderer and a (small) new dependency are missing.

### 9. Bulk re-seal / clone connex
- **Value:** Low–Medium. Helps repetitive packouts (same connex layout, new serials). Niche; most SHRH pack once per movement.
- **Effort:** M. Deep-copy a connex to `status="building"`, clear seal fields/timestamps, regenerate IDs. Edge cases around ingest-job linkage.
- **Dependencies:** `connex_store` clone fn; box add/remove already exists.
- **Existing data:** Yes — the model is self-contained JSON; cloning is mechanical but needs careful seal/ID reset.

### 10. Offline / PWA mode
- **Value:** Low–Medium. Connectivity in motor pools / on movement is real, but the server-side OCR/PDF pipeline can't go offline, so PWA only helps the shell + already-loaded data. Partial benefit.
- **Effort:** L. Service worker, asset caching, offline state reconciliation, and a clear story for which actions degrade. The vanilla-JS/no-build stack helps, but ingest and PDF gen are server-bound.
- **Dependencies:** Front-end service worker; rethink of which routes are offline-safe.
- **Existing data:** N/A — architectural, not data-driven. Server dependency caps the payoff.

### 11. Export whole connex set as one combined PDF
- **Value:** Medium. Commanders want one file to brief and file. Real value — but **already substantially built.**
- **Effort:** S. `/api/session-packet` already merges SITREP + per-connex Master 1750s into `Movement_Packet.pdf`. Remaining gap is optionally including per-box pages and surfacing the button more prominently.
- **Dependencies:** Mostly UI/labeling; the merge plumbing (pypdf) exists.
- **Existing data:** Yes — feature is ~80% shipped; this is polish, not a build.

---

## Ranking (most to least worth building next)

1. **#4 Commander dashboard** — highest unmet command-visibility need, data feed already exists.
2. **#5 Readiness color roll-up** — S effort, reuses `boxBadge()`, and it's the dashboard's visual language.
3. **#6 Verify-extraction flags** — S effort, provenance tags already in the payload, protects document accuracy.
4. **#1 Signature capture** — high accountability value, M effort, completes the DD1750.
5. **#11 Combined PDF** — high value but already ~80% done; finish it cheaply.
6. **#7 SHRH directory** — S–M QoL, builds on persisted profiles.
7. **#3 Change log** — good for trust, centralized write paths make it clean.
8. **#2 Shortage annex** — high value but gated on retaining `auth_qty`; promote once that data lands.
9. **#8 Placards/QR** — useful for ops, new dependency, not mission-core.
10. **#9 Clone connex** — niche.
11. **#10 PWA** — L effort, capped payoff due to server-bound pipeline.

---

## Top-3 recommendation

**Build #4 (Commander Dashboard), #5 (Readiness Roll-up), and #6 (Verify-Extraction Flags) next — as one coordinated slice.**

These three are the highest-leverage, lowest-risk moves and they reinforce each other. #4 answers the single biggest gap in the product today — a commander cannot see readiness across connexes without opening each one — and crucially its data is *already produced* by `build_sitrep()` (counts, statuses, zero-on-hand flags), so it's a new view, not new computation. #5 is the visual grammar that makes that dashboard legible at a glance, and it's nearly free because `boxBadge()` already encodes the green/amber/red logic; rolling box state up to connex and SHRH level is derived data. #6 rides on provenance tags (`lin_source`/`serial_source`/`niin_source`) that another agent just added and that are *already in the API payload* — turning them into inline "verify this" flags is a render change with zero backend cost, and it raises the accuracy of exactly the SN/LIN/NIIN fields that the dashboard surfaces and the commander signs against. Shipped together, an SHRH gets caught before sealing bad extractions, and a commander gets a single readiness picture color-coded the same way the operator already thinks. The two highest-value items with real data gaps — signature capture (#1) and the shortage annex (#2, which first needs `auth_qty` persisted through ingest) — are the clear next wave after this slice lands.
