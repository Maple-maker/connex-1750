# S4 GUIDE — Accountability Mapping and SITREP Interpretation

Audience: S4 shop — the officer or NCO responsible for property accountability, packing documentation, and SITREP review.

---

## How the tool maps to accountability

Every line on a DD Form 1750 traces back to an accountable person and a physical location. The tool enforces this mapping before it lets a connex seal.

| Tool field | Accountability function |
|-----------|------------------------|
| **SHRH POC** (per box) | Names the Sub-Hand Receipt Holder responsible for every item in that box. Required before sealing. |
| **SLOC** (per box) | The physical Storage Location Code — building, room, or yard slot — where that box is staged. Required before sealing. |
| **Packed By** | The person who physically packed and documented the connex. Printed on every DD1750. |
| **Signed By** | The person who validates and signs off. Must differ from Packed By — the tool blocks sealing if they match. |
| **SUN #** | Shipment Unit Number — the logistics tracking number for the container. Can be left blank (prints as placeholder). |
| **CONNEX #** | Physical container identifier. Can be left blank (prints as placeholder). |
| **SEAL #** | The numbered tamper-evident seal on the connex doors. Can be left blank (prints as placeholder). |

---

## Before a connex can seal — the checklist the tool enforces

The `POST /api/connex/<id>/seal` endpoint runs these checks in order and returns all failures at once (HTTP 200 with `ok: false`):

| Check code | Condition | What it means for the S4 |
|------------|-----------|--------------------------|
| `EMPTY_BOX` | A box has no BOMs and no individual items | Box N is allocated but unpacked. Either assign content or reduce the box count. |
| `MISSING_SLOC` | A populated box has no SLOC | The physical storage location for Box N is unknown. Get it from the S4/property book and fill it in. |
| `MISSING_SHRH` | A populated box has no SHRH POC | No one is named accountable for Box N. Assign a sub-hand receipt holder. |
| `NO_SIGNER` | `Signed By` is blank | Nobody has signed for this connex. Required. |
| `SIGNER_EQ_PACKER` | Signer and packer are the same person | Segregation of duties: the person who packs cannot also sign. |

Blank SUN, CONNEX, and SEAL numbers are **not** blocking — they render as bracketed placeholders on the PDF.

---

## Reading the SITREP

The SITREP is a single document (JSON or PDF) covering all connexes in a session or profile. Use it to verify the complete packing picture before equipment moves.

### Summary block (top of SITREP)

| Field | What it tells you |
|-------|------------------|
| Generated | Timestamp of the SITREP run |
| Profile | Brigade / Battalion / Battery |
| Connex count | How many connexes are in scope |
| Box count | Total boxes across all connexes |
| BOM count | Total Bills of Material (end items) packed |
| Individual item count | Loose items added outside BOM PDFs |

### Per-connex block

| Field | Notes |
|-------|-------|
| Connex # | Physical container ID (or `[CONNEX PENDING]` if blank) |
| SUN | Shipment Unit Number (or `[SUN PENDING]` if blank) |
| Seal # | Tamper-evident seal number (or `[SEAL PENDING]` if blank) |
| Status | `building` (not yet sealed) or `sealed` |

### Per-box block (inside each connex)

| Field | Notes |
|-------|-------|
| Box # | Sequential box number within the connex |
| SLOC | Physical location of this box |
| SHRH POC | Person accountable for this box |
| BOMs | Each end item: nomenclature, LIN, serial, item count |
| Individual items | Loose items: description, SN, NSN, LIN |

### Flags

The flags list at the bottom of the SITREP surfaces anomalies that require S4 attention:

| Flag | Action required |
|------|----------------|
| `Connex CONEX-XX has N zero-on-hand box(es)` | One or more boxes in that connex have no quantity — verify against the property book before movement. |
| `N connexes missing SUN#` | SUN numbers were left blank. Coordinate with the transportation officer and fill in the numbers before the shipment moves. |
| Any other flag | Read it as a data gap — investigate and resolve before certifying the packing list. |

---

## Workflow for the S4 shop

1. **Before packing:** confirm SHRH POCs and SLOCs with the property officer. The operator will need these for every box.
2. **During packing:** the operator runs Steps 1–7. You do not need to be present.
3. **Before the connex is physically sealed:** review the SITREP PDF. Check that every box has a SHRH POC and SLOC. Verify the Signed By name is not the same as Packed By.
4. **After review:** sign the connex-level DD1750 as the verifying authority (Signed By field).
5. **After physical sealing:** fill in the SEAL # on the tool (or annotate the printed PDF by hand). Generate updated DD1750s with the real seal number if needed.
6. **At destination:** the per-box DD1750s are the receiving documents. Each box's SHRH POC is the person who signs the hand receipt at destination.

---

## Legacy 2D flow

The original batch-child-1750 → master-1750 workflow is still accessible on the main page inside the "Legacy" collapsible section. It uses the same routes (`/ingest`, `/generate-master`, `/audit`). Use it for simple packing lists that don't require connex-level accountability or SITREPs.
