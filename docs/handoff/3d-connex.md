# Seal Animation — Handoff

> **History:** This doc previously described a three.js "Contract D" 3D scene
> (`static/connex3d.js` + `static/connex3d/_harness.html`). That code was **dead** —
> imported nowhere, never wired into `index.html`, and replaced by a pure-CSS seal
> animation. The three.js files and harness were **deleted**. There is no WebGL,
> no canvas, no importmap anywhere in this app. If you find a stray reference to
> `connex3d`, it is a leftover and should be removed.

---

## What it is

The "Apply Stamp & Seal" button at Step 5 plays a full-screen **CSS 3D-transform**
animation of a shipping connex closing and being sealed. It is built entirely from
HTML + CSS transforms — no library, no build step.

- **JS:** `playSealAnimation(unitLabel)` in `static/app.js` (builds the overlay,
  sequences the reveal via `setTimeout` class toggles, returns a `Promise`).
- **CSS:** the `.seal-*` rules in `static/style.css` (the `SEAL ANIMATION OVERLAY`
  block).
- **Caller:** `applyStampAndGenerate()` in `static/app.js`.

---

## DOM structure (built by JS)

```
#seal-overlay                 (fixed full-screen scrim; .seal-active toggles opacity)
  .seal-scene                 (perspective: 1000px)
    .seal-connex              (rotateX(6deg) rotateY(-22deg), preserve-3d — 3/4 view)
      .seal-top               (top face, rotateX(90deg))
      .seal-side              (left face, rotateY(-90deg))
        .seal-side-star       (★ — fades in)
        .seal-side-badge      (unit label — fades in)
      .seal-front             (front face, preserve-3d — holds the doors)
        .seal-front-ribs
        .seal-door-left  > .dl-bar   (hinge left edge,  rotateY(-62°) → 0°)
        .seal-door-right > .dr-bar   (hinge right edge, rotateY( 62°) → 0°)
        .seal-seam            (center seam line)
        .seal-lock-bar        (gold bar, width 0 → 400px)
        .seal-stamp           (SEALED, scale(0) → scale(1))
  .seal-status-line           ("Generating DD1750s…" — fades in)
```

---

## Class-toggle ↔ CSS contract

The JS **only toggles classes**; all motion lives in CSS transitions. These must
stay in agreement:

| JS toggles class | On element | CSS rule that responds |
|------------------|-----------|------------------------|
| `seal-active`    | `#seal-overlay`        | `#seal-overlay.seal-active { opacity: 1 }` |
| `door-closed`    | `.seal-door-left/right`| `.seal-door-*.door-closed { transform: rotateY(0) }` |
| `visible`        | `.seal-side-star`      | `.seal-side-star.visible { color: … }` |
| `visible`        | `.seal-side-badge`     | `.seal-side-badge.visible { color: … }` |
| `locked`         | `.seal-lock-bar`       | `.seal-lock-bar.locked { width: 400px }` |
| `visible`        | `.seal-stamp`          | `.seal-stamp.visible { transform: …scale(1) }` |
| `visible`        | `.seal-status-line`    | `.seal-status-line.visible { opacity: 1 }` |

---

## Timeline (ms, from `requestAnimationFrame` after overlay is appended)

| t (ms) | Action |
|--------|--------|
| 0      | `#seal-overlay` gets `.seal-active` → scrim fades in (0.35s) |
| 350    | Left door `.door-closed` → swings −62° → 0° (0.7s) |
| 530    | Right door `.door-closed` → swings +62° → 0° (0.7s) |
| 1100   | Side `★` + unit badge fade in (~0.5s) |
| 1350   | Gold lock bar `.locked` → width 0 → 400px slides across seam (0.55s) |
| 1950   | `SEALED` stamp `.visible` → scale(0) → scale(1) with overshoot ease (0.3s) |
| 2150   | Status line "Generating DD1750s…" fades in |
| 3100   | `.seal-active` removed → scrim fades out; overlay removed at 3480ms; Promise resolves |

Total runtime ≈ **3.5s**. If you retune, keep each step's start after the previous
transition has visibly begun, and keep the door open angle at ±62° (edge-on ±78°
reads as invisible in the 3/4 view).

---

## Reduced motion

The global rule at the top of `style.css` forces **all** transitions/animations to
`0.01ms` under `prefers-reduced-motion: reduce`. Left alone, that snaps the whole
sequence to its end state instantly and looks broken.

There is a **scoped `@media (prefers-reduced-motion: reduce)` override** at the end
of the `.seal-*` block that restores a calm, motion-free version:

- doors start already closed (no swing),
- gold bar appears at full width via a short opacity fade (no slide),
- SEALED stamp appears at full size via opacity fade (no scale pop),
- overlay/star/badge/status keep their opacity-only fades.

The JS sequence is unchanged — it still toggles the same classes at the same times;
the reduced-motion CSS just removes the spatial motion. If you add new moving parts
to the seal, add a matching reduced-motion entry so the global nuke doesn't break it.

---

## Timing race (caller)

`applyStampAndGenerate()` fires the download API call **concurrently** with the
animation:

```js
const apiCall = api.download(...).catch(e => { apiError = e; });
await playSealAnimation(unitLabel);   // always runs full ~3.5s
await apiCall;                         // then await whatever's left of the download
```

This ordering is deliberate: the animation **always** runs to completion before the
overlay is removed or the step advances to `NEXT_SITREP`. A fast (or failing) API
response can **not** tear the overlay down early or jump steps mid-animation —
`goTo("NEXT_SITREP")` only fires after both `await`s resolve. Preserve this ordering
if you touch the function.
