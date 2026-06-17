# 3D Connex Agent Handoff

**Date:** 2026-06-17
**Agent:** 3D Connex
**Wave:** 2
**Branch:** feat/connex-3d

---

## Files Delivered

| File | Purpose |
|------|---------|
| `static/connex3d.js` | Contract D ES module — exports `createConnexScene` |
| `static/connex3d/_harness.html` | Isolated dev/QA harness — exercises every Contract D method |
| `docs/handoff/3d-connex.md` | This file |

---

## Importmap — Frontend MUST add to `templates/index.html`

Add this block **before any `<script type="module">`** that imports or transitively loads `connex3d.js`:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  }
}
</script>
```

Then load the module:
```html
<script type="module" src="/static/connex3d.js"></script>
<!-- or import inside your app.js module -->
```

`connex3d.js` imports by bare specifier (`import * as THREE from 'three'`) so the importmap must be present before it runs. The CDN serves three.js as a native ES module; no bundler or build step required.

---

## Contract D — Module Surface

```js
import { createConnexScene } from '/static/connex3d.js';

const scene = createConnexScene(canvasEl, opts);
```

### `createConnexScene(canvasEl, opts)` → ConnexScene

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `canvasEl` | `HTMLCanvasElement` | yes | The `<canvas>` element to render into. Must have non-zero `clientWidth`/`clientHeight`. |
| `opts.animate` | `boolean` | no (default `true`) | Set `false` in tests to skip animations and resolve Promises instantly. |

**Throws** `Error` (message starts with `[connex3d]`) if WebGL is unavailable. Frontend must wrap in try/catch and show list fallback.

---

### ConnexScene methods

#### `setBoxCount(n: number): void`
Spawn or despawn boxes to exactly `n` (clamped to 0–24). New boxes scale-in; removed boxes pop off. Grid re-layouts automatically.

#### `setBoxState(boxNum: number, state: object): void`
Recolor + re-badge a single box. `boxNum` is 1-based.

```js
scene.setBoxState(3, {
  complete: false,   // true → green ✓ state
  bomCount: 2,       // shown in badge when complete
  hasItems: true,    // true + !complete → amber ⚠ state
});
```

State → color mapping (reads Contract E tokens, never hardcoded hex):
- `hasItems: false` → `--connex-empty` (gray)
- `hasItems: true, complete: false` → `--connex-warn` (amber) + ⚠ badge
- `complete: true` → `--connex-ok` (green) + ✓ + bomCount badge

#### `onBoxDrop(cb: (boxNum: number, payload: any) => void): void`
Register the drop callback. Fired by `resolveDropAt()` when a dragged payload lands on a box.

#### `onBoxSelect(cb: (boxNum: number) => void): void`
Register the select callback. Fired on `pointerup` over a box mesh.

#### `openConnex(animate?: boolean): Promise<void>`
Swing doors open; camera eases to look inside. Returns a Promise that resolves when the animation completes (or immediately if `animate=false`).

#### `closeConnex(animate?: boolean): Promise<void>`
Swing doors shut. Returns a Promise.

#### `applyStamp(text: string): void`
Fade a stencil battalion-stamp decal onto the closed door face. `text` may contain `\n` for multi-line. Matches the `.cx-stamp` visual aesthetic from the design system.

#### `highlightBox(boxNum: number, on: boolean): void`
Show/hide the gold selection ring (`--connex-gold`) around a box. Used both for drag-over affordance and persistent selection. Clearing one box's ring when a new one is highlighted is handled internally.

#### `resolveDropAt(clientX: number, clientY: number, payload: any): void`
**Call from the canvas `drop` event handler.** Raycasts from pointer coordinates to find the box under the cursor, fires `onBoxDrop(boxNum, payload)`, and clears the drag highlight. Frontend owns the data move (call `/api/connex/<id>/assign` in `onBoxDrop`).

#### `resize(): void`
Update renderer + camera aspect ratio. Call from a `ResizeObserver` on the canvas wrapper or from `window.resize`.

#### `dispose(): void`
Free all GPU resources (geometries, materials, textures, renderer). Remove event listeners. After calling `dispose()` the instance is unusable.

---

## Drag-Drop Protocol (how Frontend wires it)

```js
// 1. Register drop callback
scene.onBoxDrop((boxNum, payload) => {
  fetch(`/api/connex/${connexId}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves: [{ bom_id: payload.bomId, box_num: boxNum }] }),
  }).then(r => r.json()).then(({ connex }) => {
    // 2. Update box state from response
    const box = connex.boxes[boxNum - 1];
    scene.setBoxState(boxNum, {
      complete: box.sloc && box.shrh_poc && box.boms.length > 0,
      bomCount: box.boms.length,
      hasItems: box.boms.length > 0,
    });
  });
});

// 3. Canvas dragover — highlight box under pointer
canvas.addEventListener('dragover', e => {
  e.preventDefault();
  scene.resolveDropAt(e.clientX, e.clientY, { __probe: true }); // noop payload to trigger highlight side-effect
  // OR: call scene.highlightBox after your own hit-test — both patterns work.
});

// 4. Canvas drop
canvas.addEventListener('drop', e => {
  e.preventDefault();
  const payload = { bomId: e.dataTransfer.getData('text/plain') };
  scene.resolveDropAt(e.clientX, e.clientY, payload);
});
```

> Note: `resolveDropAt` fires `onBoxDrop` only when a box is hit. If the pointer misses all boxes it is a no-op. The drag highlight is cleared automatically on every `resolveDropAt` call.

---

## Opening the Harness

```bash
# Option 1 — Flask (recommended, handles ES module CORS)
python app.py
# then open: http://localhost:5000/static/connex3d/_harness.html

# Option 2 — Python static server from repo root
python3 -m http.server 5001
# then open: http://localhost:5001/static/connex3d/_harness.html
```

The harness exercises every Contract D method via buttons. Drag the BOM cards onto the canvas to test drop flow. The Event Log panel shows all callbacks fired.

---

## Opts Accepted

| opt | default | description |
|-----|---------|-------------|
| `animate` | `true` | Set `false` in QA / headless tests. Animations skip; Promises resolve immediately. |

---

## Contracts Consumed

- Contract E (`static/tokens.css`) — reads `--connex-empty`, `--connex-warn`, `--connex-ok`, `--connex-gold`, `--connex-gray` via `getComputedStyle` at runtime. Never hardcodes hex.

## Contracts Produced

- Contract D (`static/connex3d.js`) — the full `createConnexScene` API described above.

---

## Known Gaps / TODO for Downstream

- **Frontend must add the importmap** (exact block in this doc) to `templates/index.html`.
- `resolveDropAt` currently uses `onBoxDrop` to signal the drop. If Frontend needs a synchronous "which box is under pointer X,Y" without side effects, expose a separate `getBoxAt(clientX, clientY): number | null` — not needed for the current contract but easy to add.
- The ghost prompt ("Choose box count") is visible when `boxCount = 0`. Frontend should call `setBoxCount(n)` as soon as the operator picks a count.
- `applyStamp(text)` replaces any existing stamp. Multiple stamps on the same connex are not supported — call once after `closeConnex()`.
- Dispose leaks are guarded only for items created by `createConnexScene`. Shared geometry/material cache (`_geoCache`) in the module scope persists for the page lifetime — acceptable for a single-page tool; reset on full page navigation.

## How to Verify

1. Open harness via Flask or Python server (URLs above).
2. Click **openConnex()** → doors swing open.
3. Click **setBoxCount(8)** → 8 boxes spawn with scale-in animation.
4. Change box # to 2, click **⚠ Warn** → box 2 turns amber with ⚠.
5. Change box # to 2, click **✓ OK** → box 2 turns green with ✓.
6. Click **Highlight On** → gold ring appears on box 2.
7. Drag a BOM card onto the canvas → box under pointer highlights, Event Log shows `onBoxDrop(box=N, payload={bomId:...})`.
8. Click a box mesh → Event Log shows `onBoxSelect(N)`.
9. Click **closeConnex()** → doors swing shut.
10. Enter stamp text, click **applyStamp()** → stencil fades in on the door.
11. Confirm no console errors. Confirm GPU memory via browser DevTools Performance tab (heap should not grow on repeated open/close cycles).
