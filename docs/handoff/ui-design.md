# UI Design Agent Handoff

**Date:** 2026-06-17
**Agent:** UI Design
**Wave:** 1
**Branch:** feat/connex-3d

---

## Files Delivered

| File | Purpose |
|------|---------|
| `static/tokens.css` | Contract E custom properties — 3D reads these via getComputedStyle |
| `static/style.css`  | Full component library — all §4 classes, glassmorphism, layout shell, responsive |
| `static/_styleguide.html` | Static visual QA harness — all components + all four box-state badges |
| `docs/handoff/ui-design.md` | This file |

---

## How to Open the Style Guide

```bash
# From the repo root — Flask serves static/ automatically:
python app.py
# then open: http://localhost:5000/static/_styleguide.html

# Or open directly in browser (no server needed — CSS uses relative links):
open static/_styleguide.html
```

---

## Component Class Reference

| Class | Usage |
|-------|-------|
| `.cx-panel` | Glass card container. Wraps any content block. Add `.cx-panel__title` for section header. |
| `.cx-panel--2` | Raised nested glass surface (more opaque, higher blur). |
| `.cx-btn` | Base button. Combine with a modifier below. Min 44px touch target. |
| `.cx-btn--primary` | Gold fill CTA — e.g. "Generate DD1750". |
| `.cx-btn--ghost` | Transparent with gold stroke — e.g. "Preview SITREP". |
| `.cx-btn--danger` | Red outline — destructive actions (remove box, clear). |
| `.cx-btn--sm` | Compact (32px height) for toolbar actions. |
| `.cx-btn--loading` | Hides text, shows spinner. Add `pointer-events:none` while async. |
| `.cx-field-wrap` | Column flex wrapper for label + input + hint. |
| `.cx-label` | Uppercase tracked gold label. Put `.cx-help` trigger inside for ? affordance. |
| `.cx-field` | Base text input. Dark glass background, gold focus ring. |
| `.cx-field--mono` | JetBrains Mono input — **required** for UIC, NSN, LIN, NIIN, serial numbers, connex/SUN/SEAL IDs. |
| `.cx-field--error` | Red border for validation error state. Pair with `.cx-field-error-msg`. |
| `.cx-field-hint` | Gray helper text below input. |
| `.cx-field-error-msg` | Red error text below input. Add `role="alert"`. |
| `.cx-badge` | Status pill base. Always combine with a state modifier. |
| `.cx-badge--ok` | Box complete (green, --connex-ok). |
| `.cx-badge--warn` | Needs attention (amber, --connex-warn). |
| `.cx-badge--empty` | Empty / inactive (gray, --connex-empty). |
| `.cx-badge--danger` | Validation error (red, --connex-danger). |
| `.cx-badge--selected` | Selected ring state (gold, matches 3D selection ring). |
| `.cx-stepper` | `<ol>` workflow progress. Children are `.cx-stepper__item`. |
| `.cx-stepper__item` | Step row — add `--done` (green check) or `--active` (gold ring). |
| `.cx-stepper__dot` | Circle indicator. Put step number or ✓ inside. |
| `.cx-stepper__label` / `.cx-stepper__sublabel` | Step name and subtitle inside `.cx-stepper__body`. |
| `.cx-banner` | Unit identity banner (brigade/battalion/battery). |
| `.cx-banner__emblem` | 40×40 icon slot — SVG or character. |
| `.cx-banner__unit` / `.cx-banner__sub` | Unit name (gold) and subtitle (gray). |
| `.cx-help` | Wrapper span for the ? popover. |
| `.cx-help__trigger` | `<button>` (the ? circle). Pass `onclick="toggleHelp(this)"`. |
| `.cx-help__popover` | Popover card. Contains `.cx-help__term` (bold gold label) + copy text. |
| `.cx-stamp` | Battalion stamp — double border, mono font, stencil aesthetic. |
| `.cx-stamp--rotated` | Decorative -8° tilt for door/SITREP use. |
| `.cx-stamp--worn` | Ink-fade variant (opacity 0.55). |
| `.cx-bom-card` | Draggable BOM item card. Add `draggable="true"`. |
| `.cx-bom-card--assigned` | Green left border — card is placed in a box. |
| `.cx-bom-card--warn` | Amber left border — assigned but box missing required field. |
| `.cx-bom-card--drop-target` | Green ring — active drag hover target. Applied by Frontend on dragover. |
| `.cx-bom-card--ghost` | Invisible placeholder while drag is in flight. |
| `.cx-bom-card__nom` | Nomenclature text (2-line clamp). |
| `.cx-bom-card__qty` | Quantity badge (gold mono). |
| `.cx-bom-card__codes` | Flex row of code chips. |
| `.cx-bom-card__code--lin` / `--nsn` / `--sn` | Code chip color variants. |
| `.cx-layout` | 3-column grid shell (220px / 1fr / 320px). |
| `.cx-rail-left` / `.cx-rail-right` | Left/right panels. Collapse to horizontal drawers ≤1100px. |
| `.cx-center` | Center column — wraps the active workflow panels. |
| `.cx-view-toggle` + `.cx-view-toggle__btn` | 3D / Table toggle strip. Add `--active` to current tab. |
| `.cx-error-list` + `.cx-error-list__item` | Seal validation error block. Mirror of Contract B. |
| `.cx-divider` | 1px gold-tinted separator. |
| `.cx-section-title` | Uppercase gold section label inside a rail. |
| `.cx-mono` | Inline mono span for read-only code values. |

---

## Canonical Glossary Copy — Location for Frontend

The term→copy map lives in **two places** (same content):

1. **`static/_styleguide.html`** — `<script id="glossary-data" type="application/json">` block in §10.
   Frontend can parse it: `JSON.parse(document.getElementById('glossary-data').textContent)`.

2. **Repeat below** (source of truth if you want to extract to a standalone file):

```js
// static/glossary.js — Frontend owns this file; copy the GLOSSARY object from here
export const GLOSSARY = {
  "SLOC":     { term: "SLOC",     copy: "Storage Location Code — where this box/item is physically stored (e.g. building, room, yard slot)." },
  "SHRH POC": { term: "SHRH POC", copy: "Sub-Hand Receipt Holder, Point of Contact — the person accountable for these items." },
  "SUN #":    { term: "SUN #",    copy: "Shipment Unit Number — the tracking number for this connex/shipment. Leave blank to print a placeholder." },
  "CONNEX #": { term: "CONNEX #", copy: "The container's identifying number. Leave blank to print a placeholder." },
  "SEAL #":   { term: "SEAL #",   copy: "The numbered security seal on the connex doors. Leave blank to print a placeholder." },
  "NSN":      { term: "NSN",      copy: "National Stock Number — 13-digit supply ID (e.g. 1005-01-231-0973)." },
  "LIN":      { term: "LIN",      copy: "Line Item Number — 6-character item identifier (e.g. M39331)." },
  "NIIN":     { term: "NIIN",     copy: "National Item Identification Number — the 9-digit core of an NSN." },
  "UOI":      { term: "UOI",      copy: "Unit of Issue — how the item is counted (EA = each, BX = box, etc.)." }
};
```

**Wire a .cx-help popover:**
```html
<span class="cx-help">
  <button class="cx-help__trigger" aria-label="What is NSN?" onclick="toggleHelp(this)">?</button>
  <div class="cx-help__popover" role="tooltip">
    <span class="cx-help__term">NSN</span>
    National Stock Number — 13-digit supply ID (e.g. 1005-01-231-0973).
  </div>
</span>
```
Include the `toggleHelp()` function from `_styleguide.html` in `app.js` or inline.

---

## Design Decisions Worth Noting

**Glassmorphism + dark base:** `backdrop-filter: blur(14px)` requires a non-opaque background behind the panel; the `--connex-black` body handles this. On browsers without backdrop-filter support the panel falls back to the solid RGBA background — acceptable degradation.

**Box-state color contract:** `--connex-empty`, `--connex-warn`, `--connex-ok`, `--connex-gold` (selected ring) match Contract E §7 exactly. 3D reads these via `getComputedStyle(document.documentElement).getPropertyValue('--connex-ok')`. Do NOT rename or add new semantic states without updating Contract E in `04_AGENT_ORCHESTRATION.md`.

**Mono font on code fields:** `.cx-field--mono` applies JetBrains Mono with 0.08em letter-spacing. This is required (not optional) for any input that takes UIC, NSN, LIN, NIIN, serial numbers, connex numbers, SUN, or SEAL values. It makes precision data scannable and signals "exact value expected."

**Touch targets:** all `.cx-btn` and `.cx-help__trigger` meet 44×44px minimum. `.cx-btn--sm` drops to 32px — acceptable for desktop-first tool operators.

**Responsive:** rails collapse to horizontal drawers at ≤1100px. The stepper flips to horizontal.

**Stamp aesthetic:** `.cx-stamp` uses a double-border (border + outline) and mono font to read as a physical inked stencil. The `SEALED` stamp in the CSS seal animation (`.seal-stamp`) and the SITREP HTML stamp both derive from `stamp_text` on the profile, so they stay visually consistent.

---

## Contracts Consumed

- Contract E (tokens) — verbatim, including token names 3D reads.

## Contracts Produced

- Contract E implementation in `static/tokens.css`.
- Component classes consumed by Frontend (Contract D consumers: 3D gets colors, Frontend gets classes).

## Known Gaps / TODO for Downstream

- Frontend must wire `toggleHelp()` function into `app.js` (or inline in template).
- Frontend owns `static/glossary.js` — lift the JSON from `#glossary-data` or the block above.
- The layout shell (`.cx-layout`) is defined in CSS; Frontend applies it to `templates/index.html`.
- `.cx-bom-card--drop-target` applied by Frontend on `dragover` events via `highlightBox()` from the 3D module.
- `.cx-stepper` step labels are static in the styleguide; Frontend drives active/done state via JS class manipulation.

## How to Verify

1. `open static/_styleguide.html` — all sections §1–§14 should render with dark gold aesthetic.
2. Click any `?` trigger — popover appears with bold gold term and gray copy.
3. Click outside — popover closes.
4. Press Escape — popover closes.
5. Resize to ≤1100px — layout collapses to stacked, stepper goes horizontal.
6. Confirm the four badge states are visible in §6: ok (green) / warn (amber) / empty (gray) / danger (red).
