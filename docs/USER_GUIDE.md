# USER GUIDE — CONNEX 1750 Operator Workflow

Audience: the operator at a laptop — S4 clerk, supply sergeant, or platoon leader — stepping through the 8-step packing workflow.

---

## Before you start

Have these items ready:

- BOM PDFs for all equipment going into this connex (one PDF per end item, or a batch export)
- The physical connex number, SUN number, and seal number (or leave blank to print a placeholder and fill in later)
- Names of the person packing and the person signing (they must be different people)
- SLOC (Storage Location Code) for each box — the physical location where that box will be stored
- SHRH POC for each box — the person accountable for the items in that box

Open the tool at http://localhost:8000 (or your Railway URL). The workflow stepper on the left rail shows your progress through all 8 steps.

---

## Glossary — what every `?` term means

Wherever you see a `?` button in the interface, click it to show this definition.

| Term | Definition |
|------|-----------|
| **SLOC** | Storage Location Code — where this box/item is physically stored (e.g. building, room, yard slot). |
| **SHRH POC** | Sub-Hand Receipt Holder, Point of Contact — the person accountable for these items. |
| **SUN #** | Shipment Unit Number — the tracking number for this connex/shipment. Leave blank to print a placeholder. |
| **CONNEX #** | The container's identifying number. Leave blank to print a placeholder. |
| **SEAL #** | The numbered security seal on the connex doors. Leave blank to print a placeholder. |
| **NSN** | National Stock Number — 13-digit supply ID (e.g. 1005-01-231-0973). |
| **LIN** | Line Item Number — 6-character item identifier (e.g. M39331). |
| **NIIN** | National Item Identification Number — the 9-digit core of an NSN. |
| **UOI** | Unit of Issue — how the item is counted (EA = each, BX = box, etc.). |

---

## Step 1 — PROFILE: Select your unit

The profile personalizes the app with your brigade banner and pre-fills standard header fields.

1. On the Profile step, your saved profiles appear as cards. Click one to load it.
2. If this is your first time, fill in the "Create Profile" form:
   - **Brigade** — e.g. "108th ADA Brigade"
   - **Battalion** — e.g. "2-55 ADA"
   - **Battery** — e.g. "B"
   - **UIC** — e.g. "WH1ZB0"
   - **Default Packed By** — your name in LAST, FIRST MI format; pre-fills the packer field
   - **Stamp Text** — the text for the battalion stamp on sealed connexes (e.g. "2-55 ADA")
   - **Brigade Insignia** — pick your brigade from the gallery of 97 formations; the selected insignia appears in the banner at the top of every step
3. Click **Save Profile**. The app advances to Step 2.

Your profile is saved and reused across sessions.

---

## Step 2 — CONNEX SETUP: Open a connex and spawn boxes

1. Enter the **Connex #** (e.g. "CONEX-01"). You can leave this blank and fill it in at Step 4.
2. Enter the **number of boxes** (1–24) that this connex will contain.
3. Click **Open Connex**. The 3D connex scene opens and the box count of empty gray boxes appears inside.

The connex is now in "building" status. You can see each box in the 3D view.

**No WebGL / browser doesn't support 3D?** The app automatically shows a list-table view. Every step works the same — you assign BOMs by clicking boxes in the table instead of dragging in 3D.

---

## Step 3 — PACKING: Ingest BOMs and fill each box

This step has two parts: getting BOMs into the system and assigning them to boxes.

### 3a — Ingest BOMs

1. In the right panel, click **Upload BOM PDFs** (or drag and drop files onto the upload zone).
2. Drop all your BOM PDFs at once. The tool parses each PDF and creates a BOM card for each end item.
3. BOM cards appear in the right panel tray. Each card shows the nomenclature, LIN, NSN, and serial number.

### 3b — Assign BOMs to boxes

**In the 3D view:**
1. Drag a BOM card from the right tray and drop it onto a box in the 3D scene.
2. The box highlights gold while you drag over it.
3. Drop — the BOM is assigned and the box color updates: amber (content but missing required fields), green (complete).

**In the list/table view:**
1. Click a BOM card to select it.
2. Click the box row you want to assign it to.

### 3c — Fill SLOC and SHRH POC for each box

After assigning BOMs, click a box to open its detail panel.

- **SLOC** (`?`) — enter the storage location code for this box. Required before sealing.
- **SHRH POC** (`?`) — enter the name of the sub-hand receipt holder for this box. Required before sealing.

Repeat for every box that has content. A box turns green when it has at least one BOM and both SLOC and SHRH POC are filled.

**You cannot advance to Step 4 until all populated boxes are green.**

---

## Step 4 — SEAL DATA: Enter connex-level accountability fields

When all boxes are green (complete), the connex doors close in the 3D view and you can fill seal data.

| Field | Notes |
|-------|-------|
| **SUN #** (`?`) | Leave blank to print `[SUN PENDING]` on the PDF. |
| **CONNEX #** (`?`) | Leave blank to print `[CONNEX PENDING]`. |
| **SEAL #** (`?`) | Leave blank to print `[SEAL PENDING]`. |
| **Packed By** | Pre-filled from your profile. Editable. |
| **Signed By** | Must be a different person from Packed By. Required. |
| **Date** | Pre-filled with today. Editable. |

Click **Seal Connex**. The server validates all fields. If anything is missing, errors appear inline — read each message, fix the field, and click Seal Connex again.

---

## Seal validation errors

These errors appear at Step 4 if the connex cannot be sealed:

| Error | What to fix |
|-------|------------|
| `EMPTY_BOX: Box N is empty` | Go back to Packing and assign at least one BOM or individual item to Box N, or reduce your box count. |
| `Box N needs a SLOC` | Open Box N in Packing and fill the SLOC field. |
| `Box N needs a SHRH POC` | Open Box N in Packing and fill the SHRH POC field. |
| `Enter who is signing for this connex` | Fill the Signed By field. |
| `Signer must differ from packer` | Signed By and Packed By cannot be the same person. |

`SUN #`, `CONNEX #`, and `SEAL #` may be left blank — they render as bracketed placeholders on the PDF.

---

## Step 5 — INDIVIDUAL ITEMS: Add loose items to boxes (optional)

After sealing, you can add individual items to any box that are not covered by BOM PDFs — loose components, tools, or non-standard items.

For each item, click a box and fill any combination of:

| Field | Format | Notes |
|-------|--------|-------|
| Description | Free text | What the item is |
| SN | Free text | Serial number |
| NSN (`?`) | 13-digit (e.g. 1005-01-231-0973) | National Stock Number |
| LIN (`?`) | 6 characters (e.g. M39331) | Line Item Number |

All fields are optional. Click **Add Item**. Add as many items as needed per box.

> **Fast-follow:** An AI helper (owl-alpha) that suggests NSN/LIN from a description is planned but not yet connected. The hook is present in the form — it will appear in a future update.

---

## Step 6 — CLOSE & STAMP: Generate DD1750 PDFs

Click **Generate DD1750s**. The app:

1. Closes the connex doors and applies your battalion stamp (from your profile's Stamp Text field) to the sealed connex.
2. Generates one DD Form 1750 PDF per occupied box.
3. Bundles all PDFs into a ZIP file.
4. Downloads the ZIP automatically.

Each PDF has the battalion stamp, full header (SUN, CONNEX #, SEAL #, SLOC, SHRH POC, Packed By, Signed By), and all BOM rows and individual items for that box. Blank SUN/CONNEX/SEAL fields print as `[SUN PENDING]`, `[CONNEX PENDING]`, `[SEAL PENDING]`.

---

## Step 7 — NEXT: Pack another connex or finish

- **Pack another connex** — reuses your saved profile and loops back to Step 2 with a fresh connex. All BOMs in the current session carry forward in memory.
- **Finish / SITREP** — advances to Step 8.

---

## Step 8 — SITREP: Generate the commander's report

Click **Generate SITREP**. The app compiles a report across all connexes packed in this session (or all connexes for your profile).

The SITREP shows:

- Total connexes, boxes, BOMs, and individual items
- Per-connex breakdown: connex number, SUN, seal number, status (building/sealed)
- Per-box breakdown: SLOC, SHRH POC, all BOMs, all individual items
- Flags: missing SUN numbers, zero-on-hand boxes, any anomalies

Click **Download SITREP PDF** to get the PDF version for the commander.

---

## Tips

- **Save your profile** on the first use — it pre-fills standard fields and puts your brigade insignia in the banner for every session.
- **Leave SUN/CONNEX/SEAL blank** if you don't have the numbers yet. Print the PDFs with placeholders and annotate by hand, or regenerate after you have the numbers.
- **BOM ingest is session-persistent.** If you close the browser or the server restarts, you will need to re-upload your BOM PDFs. The connex and profile JSON files are saved to disk and survive restarts.
- **Back-navigation** — click any completed step dot in the left stepper to go back and review or edit. You cannot skip forward more than one step.
- **Multiple connexes** — pack the first connex completely through Step 7, then loop back to Step 2 for the next one. The SITREP at Step 8 covers all of them.
