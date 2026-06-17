# S4 GUIDE — Accountability Mapping and SITREP Interpretation

Audience: S4 shop — the officer or NCO responsible for property accountability, packing documentation, and SITREP review.

---

## How the tool maps to accountability

Every line on a DD Form 1750 traces back to an accountable person and a physical location. The tool enforces this mapping before it lets a connex seal.

| Tool field | Accountability function |
|-----------|------------------------|
| **SHRH POC** (per box) | Names the Sub-Hand Receipt Holder responsible for every item in that box. Required before sealing. Entered at Step 3 (PACKING) inline on each box card. |
| **SLOC** (per box) | The physical Storage Location Code — building, room, or yard slot — where that box is staged. Required before sealing. Entered at Step 3 (PACKING). |
| **Packed By** | The person who physically packed and documented the connex. Printed on every DD1750. Pre-filled from the profile; editable at Step 4. |
| **Signed By** | The person who validates and signs off. Must differ from Packed By — the tool blocks sealing if they match. Entered at Step 4 (SEAL DATA). |
| **SUN #** | Shipment Unit Number — a unique alphanumeric tracking code used by the Unit Movement Officer (UMO) to track, load, and manifest equipment during deployments. Entered at Step 4. Can be left blank (prints as `[SUN PENDING]`). |
| **CONNEX #** | Physical container identifier. Entered at Step 4. Can be left blank (prints as `[CONNEX PENDING]`). |
| **SEAL #** | The numbered tamper-evident seal on the connex doors. Entered at Step 4. Can be left blank (prints as `[SEAL PENDING]`). |

---

## The 6-step workflow at a glance (S4 perspective)

| Step | What happens | S4 action |
|------|-------------|-----------|
| 1 PROFILE | Operator selects brigade from the insignia gallery (97 formations); profile saves unit identity | Provide UIC, stamp text, and default packed-by name to the operator |
| 2 CONNEX SETUP | Operator names the connex and sets box count | Confirm box count matches the planned packing plan |
| 3 PACKING | 2D split-screen: BOM PDFs ingested, dragged into box cards; SLOC + SHRH POC filled per box; individual items added | Provide SLOC and SHRH POC for each box before the operator reaches this step |
| 4 SEAL DATA | Operator enters SUN #, CONNEX #, SEAL #, packer, and signer | Provide SUN # from the transportation officer; confirm signer ≠ packer |
| 5 REVIEW & SEAL | Read-only 3D view + per-box checklist; seal action downloads ZIP (Master_1750.pdf + per-box PDFs) | Review the checklist with the operator; sign the connex-level 1750 as Signed By |
| 6 NEXT / SITREP | Pack another connex or generate the SITREP | Review SITREP PDF for flags before certifying movement |

---

## Before a connex can seal — the checklist the tool enforces

`POST /api/connex/<id>/seal` runs these checks and returns all failures at once (HTTP 200, `ok: false`):

| Check code | Condition | What it means for the S4 |
|------------|-----------|--------------------------|
| `EMPTY_BOX` | A box has no BOMs and no individual items | Box N is allocated but unpacked. Either assign content or create a new connex with fewer boxes. |
| `MISSING_SLOC` | A populated box has no SLOC | Storage location for Box N is unknown. Provide the SLOC. |
| `MISSING_SHRH` | A populated box has no SHRH POC | No one is named accountable for Box N. Assign a sub-hand receipt holder. |
| `NO_SIGNER` | `Signed By` is blank | Nobody has signed for this connex. Required. |
| `SIGNER_EQ_PACKER` | Signer and packer are the same person | Segregation of duties: the person who packs cannot also sign. |

Blank SUN, CONNEX, and SEAL numbers are **not** blocking — they render as bracketed placeholders.

---

## What the downloaded ZIP contains

After sealing at Step 5 (Review & Seal), the operator downloads a ZIP file:

| File | Contents |
|------|---------|
| `Master_1750.pdf` | All boxes condensed onto a single master DD1750, organized by box number. Use this as the connex-level accountability document. |
| `Box_001.pdf`, `Box_002.pdf`, ... | One DD1750 per occupied box. Each has the box's SLOC, SHRH POC, BOM rows, and individual items. Use these as the box-level hand receipt at destination. |

All PDFs carry the battalion stamp from the profile's Stamp Text field.

---

## Reading the SITREP

The SITREP covers all connexes in a session or under a unit profile. See `docs/COMMANDER_GUIDE.md` for the full SITREP field reference. Key points for the S4:

**Summary block** — confirms total connexes, boxes, BOMs, and individual items. Cross-check against the property book.

**Per-connex block** — shows status (`building` or `sealed`). A connex in `building` status has not been through the seal step and should not move.

**Per-box block** — lists SLOC, SHRH POC, and every BOM and individual item. Verify SHRH POCs are correct — they are the persons who sign the hand receipt at destination.

**Flags** — anomalies requiring S4 action:

| Flag | Action required |
|------|----------------|
| `Connex CONEX-XX has N zero-on-hand box(es)` | Reconcile against the property book before movement. |
| `N connexes missing SUN#` | Coordinate with the transportation/UMO officer. SUN# is required for load planning and manifesting. |

---

## Workflow for the S4 shop

1. **Before packing (Step 3):** confirm SHRH POCs and SLOCs with the property officer. The operator needs these for every box.
2. **Before Step 4:** provide the SUN # from the transportation officer or UMO if available. If not yet assigned, leave blank — the operator prints placeholders.
3. **At Step 5:** review the per-box checklist with the operator. Confirm SHRH POCs, SLOCs, and BOM counts before authorizing the seal.
4. **Signing:** enter your name in the Signed By field at Step 4. You must be a different person from the packer.
5. **After physical sealing:** record the SEAL # from the physical tamper-evident seal. If not entered before the PDF was generated, annotate the printed Master_1750.pdf by hand or re-generate after entering the number.
6. **At destination:** the per-box PDFs are the receiving documents. Each box's SHRH POC signs the hand receipt at destination.

---

## Legacy 2D flow

The original batch-child-1750 → master-1750 workflow is still accessible on the main page inside the "Legacy" collapsible section. It uses the same routes (`/ingest`, `/generate-master`, `/audit`). Use it for simple packing lists that do not require connex-level accountability or SITREPs.
