# USER GUIDE — CONNEX 1750 Operator Workflow

Audience: the operator at a laptop — S4 clerk, supply sergeant, or platoon leader — stepping through the 6-step packing workflow.

---

## Before you start

Have these items ready:

- BOM PDFs for all equipment going into this connex (one PDF per end item, or a batch export)
- The physical connex number, SUN number, and seal number (or leave blank to print a placeholder and fill in later)
- Names of the person packing and the person signing (they must be different people)
- SLOC (Storage Location Code) for each box — the physical location where that box will be stored
- SHRH POC for each box — the person accountable for the items in that box

Open the tool at http://localhost:8000 (or your Railway URL). The workflow stepper on the left rail shows your progress through all 6 steps.

---

## Glossary — what every `?` term means

Wherever you see a `?` button in the interface, click it to show this definition.

| Term | Definition |
|------|-----------|
| **SLOC** | Storage Location Code — where this box/item is physically stored (e.g. building, room, yard slot). |
| **SHRH POC** | Sub-Hand Receipt Holder, Point of Contact — the person accountable for these items. |
| **SUN #** | Shipment Unit Number — a unique alphanumeric tracking code used by a Unit Movement Officer (UMO) to track, load, and manifest equipment during deployments. Leave blank to print a placeholder. |
| **CONNEX #** | The container's identifying number. The CONNEX # is stamped or stenciled on the exterior door and side panels of the physical container. Leave blank to print a placeholder. |
| **SEAL #** | The numbered security seal on the connex doors. The SEAL # is printed on the plastic or metal tamper-evident seal bar threaded through the door handles. Leave blank to print a placeholder. |
| **NSN** | National Stock Number — 13-digit supply ID (e.g. 1005-01-231-0973). |
| **LIN** | Line Item Number — 6-character item identifier (e.g. M39331). |
| **NIIN** | National Item Identification Number — the 9-digit core of an NSN. |
| **UOI** | Unit of Issue — how the item is counted (EA = each, BX = box, etc.). |

---

## Step 1 — PROFILE: Select your unit

The profile personalizes the app with your brigade banner and pre-fills standard header fields.

1. The Profile step shows the brigade insignia gallery — 97 formations, searchable by name. Images lazy-load; on a slow connection wait a moment for the gallery to populate.
2. Click your brigade's insignia to select it. The formation name appears below the card.
3. Fill in the profile form:
   - **Brigade** — e.g. "108th ADA Brigade" (auto-populated from the gallery selection)
   - **Battalion** — e.g. "2-55 ADA"
   - **Battery** — e.g. "B"
   - **UIC** — e.g. "WH1ZB0"
   - **Default Packed By** — your name in LAST, FIRST MI format; pre-fills the packer field on every connex
   - **Stamp Text** — text for the battalion stamp applied to sealed connexes (e.g. "2-55 ADA")
4. Click **Save Profile**. Your selected insignia appears in the banner at the top of every step. The app advances to Step 2.

Saved profiles are reused across sessions. If you already have a profile, click it on the profile list to load it — no need to fill the form again.

---

## Step 2 — CONNEX SETUP: Name the connex and set box count

1. Enter the **Connex #** (e.g. "CONEX-01"). You can leave this blank and fill it in at Step 4.
2. Enter the **number of boxes** (1–24) that this connex will contain.
3. Click **Create Connex**. The app advances to the Packing step.

The connex is now in "building" status. You can adjust individual box contents in Step 3, but the box count is fixed after this step.

---

## Step 3 — PACKING: Ingest BOMs and fill each box

Step 3 is a 2D split-screen. No 3D is needed here.

**Left panel — BOM pool and individual items**
**Right panel — box cards**

### 3a — Ingest BOMs

1. In the left panel, click **Upload BOM PDFs** (or drag and drop files onto the upload zone).
2. Drop all your BOM PDFs at once. The tool parses each PDF and creates a BOM card for each end item.
3. BOM cards appear in the left panel tray. Each card shows the nomenclature, LIN, NSN, and serial number. Cards with missing LIN or model are flagged with an amber warning — click the card to edit before assigning.

### 3b — Assign BOMs to boxes

**Drag and drop:**
1. Drag a BOM card from the left panel.
2. Drop it onto a box card in the right panel. The target box highlights on hover.

**Click to assign:**
1. Click a BOM card to select it (card highlights gold).
2. Click the target box card. The BOM is assigned.

Each BOM can only be assigned to one box. To reassign, drag or click it to a different box.

### 3c — Fill SLOC and SHRH POC for each box

Each box card in the right panel has inline fields:

- **SLOC** (`?`) — enter the storage location code for this box. Required before sealing.
- **SHRH POC** (`?`) — enter the name of the sub-hand receipt holder. Required before sealing.

**Box status badge:**

| Badge | Meaning |
|-------|---------|
| Empty (gray) | No BOMs or individual items assigned |
| Needs SLOC/SHRH (amber) | Has content but a required field is missing |
| Complete (green) | Has content, SLOC filled, SHRH POC filled |

All boxes must show **Complete** (green) before the app lets you advance to Step 4.

### 3d — Add individual items to a box

Individual items are loose items not covered by BOM PDFs — tools, accessories, non-standard components, or items too few to have their own BOM.

At the bottom of the left panel, use the **Add Individual Item** form:

1. Select which box the item belongs to.
2. Fill any combination of fields:
   - **Description** — free text (e.g. "SLING ASSY, SINGLE POINT")
   - **SN** — serial number
   - **NSN** (`?`) — 13-digit National Stock Number
   - **LIN** (`?`) — 6-character Line Item Number
3. All fields are optional. An item with only a description is valid.
4. Click **Add Item**. The item appears on the box card.

Individual items count toward box completeness — a box with individual items but no SLOC/SHRH POC will still show the amber badge until those fields are filled.

> **Fast-follow note:** An AI helper (owl-alpha) that suggests NSN and LIN from a description is planned but not yet connected. The hook is present in the form but inactive.

---

## Step 4 — SEAL DATA: Enter connex-level accountability fields

When all boxes are green, fill the connex-level seal data.

| Field | Notes |
|-------|-------|
| **SUN #** (`?`) | Leave blank to print `[SUN PENDING]` on the PDF. |
| **CONNEX #** (`?`) | Leave blank to print `[CONNEX PENDING]`. The ? popover shows a reference photo of where to read this number on a physical container. |
| **SEAL #** (`?`) | Leave blank to print `[SEAL PENDING]`. The ? popover shows a reference photo of where to read the seal number. |
| **Packed By** | Pre-filled from your profile. Editable. |
| **Signed By** | Must be a different person from Packed By. Required. |
| **Date** | Pre-filled with today. Editable. |

Click **Save & Continue**. The app advances to Review & Seal.

---

## Step 5 — REVIEW & SEAL: Confirm boxes and download PDFs

Step 5 has two parts: a visual review and the seal action.

### 5a — Review

The center panel shows a **read-only 3D view** of the packed connex with color-coded boxes:

| Color | Meaning |
|-------|---------|
| Gray | Empty box |
| Amber | Box has content but a required field was missing (should not appear if all boxes were green at Step 3) |
| Green | Box is complete |

Click any box in the 3D view to highlight it in the per-box checklist on the right.

The **per-box checklist** on the right panel lists every box with its SLOC, SHRH POC, BOM count, and individual item count. Review each line.

**No WebGL / browser doesn't support 3D?** The 3D view is hidden and the per-box checklist is shown on its own. The workflow completes normally.

### 5b — Seal and download

When you are satisfied with the review:

1. Click **Apply Brigade Stamp & Seal**.
2. The 3D connex doors close (animated) and the battalion stamp from your profile appears on the door face.
3. The server generates and downloads a ZIP file containing:
   - **Master_1750.pdf** — all boxes condensed onto a master DD1750, organized by box number
   - **Box_001.pdf**, **Box_002.pdf**, ... — one DD1750 per occupied box, with the battalion stamp, full header (SUN, CONNEX #, SEAL #, SLOC, SHRH POC, Packed By, Signed By), all BOM rows, and individual items

Blank SUN/CONNEX/SEAL fields print as `[SUN PENDING]`, `[CONNEX PENDING]`, `[SEAL PENDING]`.

---

## Seal validation errors

If the connex cannot be sealed, errors appear before the seal action:

| Error | What to fix |
|-------|------------|
| `EMPTY_BOX: Box N is empty` | Go back to Packing (Step 3) and assign at least one BOM or individual item to Box N, or create a new connex with fewer boxes. |
| `Box N needs a SLOC` | Open Box N in Step 3 and fill the SLOC field. |
| `Box N needs a SHRH POC` | Open Box N in Step 3 and fill the SHRH POC field. |
| `Enter who is signing for this connex` | Fill the Signed By field in Step 4. |
| `Signer must differ from packer` | Signed By and Packed By cannot be the same person. |

`SUN #`, `CONNEX #`, and `SEAL #` may be left blank — they render as bracketed placeholders.

---

## Step 6 — NEXT / SITREP

After sealing, choose:

- **Pack another connex** — reuses your saved profile and loops back to Step 2 with a fresh connex. All connexes from this session are tracked for the SITREP.
- **Generate SITREP** — produces a commander's SITREP covering all connexes in this session or under your profile. Click **Download SITREP PDF** to get the PDF for the commander.

The SITREP shows totals (connexes, boxes, BOMs, individual items) and per-connex / per-box breakdowns with SLOC, SHRH POC, and a flags list for any anomalies (missing SUN numbers, zero-on-hand boxes).

---

## Tips

- **Save your profile first** — it pre-fills fields and shows your brigade insignia in the banner.
- **Leave SUN/CONNEX/SEAL blank** if you don't have the numbers yet. Print with placeholders and annotate by hand, or re-generate the PDFs after you have the numbers.
- **BOM ingest is in-memory.** If you close the browser or the server restarts, re-upload your BOM PDFs. Connex and profile data are saved to disk and survive restarts.
- **Back-navigation** — click any completed step dot in the left stepper to go back and review. You cannot skip forward more than one step at a time.
- **Multiple connexes** — complete the full workflow through Step 6 for the first connex, then loop back to Step 2 for the next. The SITREP at Step 6 covers all of them.
- **No 3D until Step 5** — the packing workflow (Steps 1–4) is entirely 2D. You do not need a WebGL-capable browser to complete a packing operation.
