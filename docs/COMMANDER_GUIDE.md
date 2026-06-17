# COMMANDER'S GUIDE — Reading the SITREP

Audience: battery/battalion commander or XO reviewing the packing SITREP before equipment moves.

---

## What the SITREP is

The SITREP (Situation Report) is a single document — PDF or JSON — that gives you a complete picture of what is packed, where it is, who is accountable for it, and what is missing or unresolved.

It is generated at Step 8 of the operator workflow and covers all connexes packed in a session or under a unit profile. You do not need to access the packing tool to read it — it is a standalone document for command review.

---

## How to request the SITREP

Tell your S4 to generate and send you the SITREP PDF. It is produced by clicking **Download SITREP PDF** at Step 8. Alternatively, the S4 can pull the JSON version via `POST /api/sitrep` for integration with other systems.

---

## Structure of the SITREP

### Header block

| Field | What it tells you |
|-------|------------------|
| Generated | Date/time the SITREP was produced |
| Brigade | Unit identifer |
| Battalion | |
| Battery | |
| Connex count | Total shipping containers in scope |
| Box count | Total boxes across all connexes |
| BOM count | Total end items (equipment lines) packed |
| Individual item count | Loose items added outside standard BOMs |

Use the counts to cross-check against your property book. If your property book shows 47 end items going into this connex move but the SITREP shows 43 BOMs, there is a gap to resolve before the equipment moves.

---

### Connex block (one per container)

Each connex section shows:

| Field | What it tells you |
|-------|------------------|
| Connex # | Physical container identifier. `[CONNEX PENDING]` means the number was not entered — get it from the transportation officer. |
| SUN # | Shipment Unit Number — logistics tracking ID. `[SUN PENDING]` means unassigned — coordinate with the S4 before movement. |
| Seal # | Tamper-evident seal number. `[SEAL PENDING]` means the seal has not been applied yet, or the number was not recorded. |
| Status | `sealed` = documentation is complete, validation passed. `building` = connex has not been sealed — do not move it. |

**A connex with status `building` should not leave the motor pool.** Verify with the S4 why it is in the SITREP if it is not sealed.

---

### Box block (one per box within a connex)

| Field | What it tells you |
|-------|------------------|
| Box # | Sequential number within the connex (Box 1, Box 2, etc.) |
| SLOC | Physical location of the box. If this looks wrong (e.g. a building that is not in your AO), clarify with the S4. |
| SHRH POC | The sub-hand receipt holder for this box. This person signs the hand receipt at destination. If the name is wrong, the property will be received by the wrong person. |
| BOMs | Each end item: nomenclature, LIN, serial, and item count. This is what is physically in the box. |
| Individual items | Loose items added outside BOM PDFs: description, SN, NSN, LIN as available. |

---

### Flags section

The flags list surfaces conditions that require your attention before the equipment moves. Common flags:

| Flag | What it means | Action |
|------|--------------|--------|
| `Connex CONEX-XX has N zero-on-hand box(es)` | One or more boxes in that connex have items on the property book but zero physical quantity. | Direct the S4 to reconcile against the property book. Zero-on-hand items should be accounted for before the connex ships. |
| `N connexes missing SUN#` | Shipment Unit Numbers were not entered. | Coordinate with the transportation officer. The SUN# is required for tracking. |
| `2 connexes missing SUN#` (example) | Two containers have no logistics tracking number. | Same as above — do not dispatch until SUN#s are assigned and documented. |

If the flags section is empty, there are no known anomalies. This does not replace a physical inventory — it confirms the documentation is internally consistent.

---

## Verification checklist before signing

Before signing the connex-level DD1750 as the verifying authority:

- [ ] All connexes show status `sealed`.
- [ ] No boxes have status `building` in the SITREP.
- [ ] Every box has a named SHRH POC.
- [ ] Every box has a SLOC.
- [ ] BOM count matches the property book quantity going on this movement.
- [ ] Individual item count matches your manual manifest (if applicable).
- [ ] Flags section is empty, or each flag has a documented explanation.
- [ ] SUN #, CONNEX #, and SEAL # are all filled in (no `PENDING` placeholders) — if any are pending, annotate why.
- [ ] Signed By is not the same person as Packed By.

---

## What is NOT in the SITREP

- **Weight and cube** — the tool does not track dimensional or weight data. This is intentional for MVP. Coordinate separately with transportation for load planning.
- **Classified items** — if any equipment is classified, it must not be documented in this system without appropriate security controls. Handle per your unit SOP.
- **SHR reconciliation results** — the SHR (Sub-Hand Receipt) reconciliation report is separate (`/reconcile` route in the legacy flow). The SITREP tracks who is accountable per box; the SHR reconciliation tracks whether on-hand matches the hand receipt.

---

## Questions

Direct technical questions to the S4 shop or the system administrator. The S4 guide (`docs/S4_GUIDE.md`) has accountability field definitions and the pre-seal checklist.
