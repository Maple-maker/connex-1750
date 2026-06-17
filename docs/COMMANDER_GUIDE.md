# COMMANDER'S GUIDE — Reading the SITREP

Audience: battery/battalion commander or XO reviewing the packing SITREP before equipment moves.

---

## What the SITREP is

The SITREP (Situation Report) is a single document — PDF or JSON — that gives you a complete picture of what is packed, where it is, who is accountable for it, and what is missing or unresolved.

It is generated at Step 6 of the operator workflow and covers all connexes packed in a session or under a unit profile. You do not need to access the packing tool to read it — it is a standalone document for command review.

---

## How to request the SITREP

Tell your S4 to generate and send you the SITREP PDF. It is produced by clicking **Download SITREP PDF** at Step 6. Alternatively, the S4 can pull the JSON version via `POST /api/sitrep` for integration with other systems.

---

## How the packing was documented (6-step workflow summary)

The SITREP reflects work done across 6 steps:

1. **PROFILE** — unit identity selected from the brigade insignia gallery; banner and stamp text set.
2. **CONNEX SETUP** — connex named and box count set.
3. **PACKING** — BOM PDFs ingested; equipment dragged into box cards on a 2D split-screen; individual items added; SLOC and SHRH POC filled per box.
4. **SEAL DATA** — SUN #, CONNEX #, SEAL #, packer, and signer entered.
5. **REVIEW & SEAL** — per-box checklist confirmed; battalion stamp applied; DD1750 ZIP downloaded.
6. **SITREP** — this document.

---

## Structure of the SITREP

### Header block

| Field | What it tells you |
|-------|------------------|
| Generated | Date/time the SITREP was produced |
| Brigade | Unit identifier |
| Battalion | |
| Battery | |
| Connex count | Total shipping containers in scope |
| Box count | Total boxes across all connexes |
| BOM count | Total end items (equipment lines) packed |
| Individual item count | Loose items added outside standard BOMs |

Use the counts to cross-check against your property book. If your property book shows 47 end items going into this move but the SITREP shows 43 BOMs, there is a gap to resolve before the equipment moves.

---

### Connex block (one per container)

| Field | What it tells you |
|-------|------------------|
| Connex # | Physical container identifier. `[CONNEX PENDING]` means the number was not recorded — get it from the transportation officer. |
| SUN # | Shipment Unit Number — a unique alphanumeric tracking code used by the Unit Movement Officer (UMO) to track, load, and manifest equipment during deployments. `[SUN PENDING]` means unassigned — coordinate with the UMO before the equipment moves. |
| Seal # | Tamper-evident seal number. `[SEAL PENDING]` means the seal was not recorded — verify with the S4 before certifying the connex. |
| Status | `sealed` = documentation complete, validation passed. `building` = connex has not been sealed — do not move it. |

**A connex with status `building` should not leave the motor pool.** Verify with the S4 why it appears in the SITREP if it is not sealed.

---

### Box block (one per box within a connex)

| Field | What it tells you |
|-------|------------------|
| Box # | Sequential number within the connex (Box 1, Box 2, ...) |
| SLOC | Physical location of the box. If this location is wrong (e.g. a building not in your AO), clarify with the S4 before movement. |
| SHRH POC | Sub-hand receipt holder for this box. This person signs the hand receipt at destination. If the name is wrong, the property will be received by the wrong person — correct it before the connex ships. |
| BOMs | Each end item: nomenclature, LIN, serial, and item count. This is what is physically in the box. |
| Individual items | Loose items added outside BOM PDFs: description, SN, NSN, LIN as available. |

---

### Flags section

The flags list surfaces conditions that require your attention before the equipment moves.

| Flag | What it means | Action |
|------|--------------|--------|
| `Connex CONEX-XX has N zero-on-hand box(es)` | One or more boxes have items on the property book but zero physical quantity. | Direct the S4 to reconcile against the property book. Zero-on-hand items must be accounted for before the connex ships. |
| `N connexes missing SUN#` | Shipment Unit Numbers were not entered. | Coordinate with the UMO. SUN# is required for load planning and manifesting. Do not dispatch until SUN#s are assigned and documented. |

If the flags section is empty, there are no known anomalies. This does not replace a physical inventory — it confirms the documentation is internally consistent.

---

## Verification checklist before certifying movement

- [ ] All connexes show status `sealed`.
- [ ] No `building` status connexes in the SITREP.
- [ ] Every box has a named SHRH POC.
- [ ] Every box has a SLOC.
- [ ] BOM count matches the property book quantity going on this movement order.
- [ ] Individual item count matches your manual manifest (if applicable).
- [ ] Flags section is empty, or each flag has a documented explanation.
- [ ] SUN #, CONNEX #, and SEAL # are filled in — no `PENDING` placeholders. If any remain pending, confirm in writing why before authorizing movement.
- [ ] Signed By is not the same person as Packed By.

---

## What is NOT in the SITREP

- **Weight and cube** — the tool does not track dimensional or weight data. Coordinate separately with transportation for load planning.
- **Classified items** — if any equipment is classified, it must not be documented in this system without appropriate security controls. Handle per your unit SOP.
- **SHR reconciliation results** — the SHR (Sub-Hand Receipt) reconciliation report is separate (`/reconcile` route in the legacy flow). The SITREP tracks who is accountable per box; the SHR reconciliation tracks whether on-hand matches the hand receipt.

---

## Questions

Direct technical questions to the S4 shop or the system administrator. See `docs/S4_GUIDE.md` for the pre-seal checklist and accountability field definitions.
