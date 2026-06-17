/**
 * connex3d.js — Contract D implementation
 *
 * Exports createConnexScene(canvasEl, opts) → ConnexScene
 * No three.js types leak across the module boundary.
 * Colors are read from CSS custom properties (Contract E) via getComputedStyle.
 *
 * Requires: importmap with three@0.160.0 (see docs/handoff/3d-connex.md)
 * No build step — pure ES module loaded by the browser.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Color helpers ────────────────────────────────────────────────────────────

/** Read a CSS custom property from :root as a hex string (trimmed). */
function tok(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** Convert a CSS color string to a THREE.Color. */
function cssColor(name) {
  return new THREE.Color(tok(name));
}

// ── Geometry / material helpers ──────────────────────────────────────────────

/**
 * Make a MeshStandardMaterial using a color from a token name.
 * Caller owns the material; dispose() frees it.
 */
function makeMat(tokenName, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: cssColor(tokenName),
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.45,
    ...opts,
    color: cssColor(tokenName), // ensure color not overwritten by spread
  });
}

// Shared geometry pool so we don't duplicate allocations.
const _geoCache = new Map();
function cachedBox(w, h, d) {
  const key = `box_${w}_${h}_${d}`;
  if (!_geoCache.has(key)) {
    _geoCache.set(key, new THREE.BoxGeometry(w, h, d));
  }
  return _geoCache.get(key);
}

// ── Connex shell builder ─────────────────────────────────────────────────────

/**
 * Build the ISO shipping-container shell as a group of procedural meshes.
 * Dimensions evoke a 10ft ISO container (ratio: 2.44 × 2.59 × 3.05 m scaled).
 * Returns { group, doorL, doorR } — doors are sub-groups with pivot at hinge edge.
 */
function buildConnexShell(matSteel, matDoor) {
  const group = new THREE.Group();

  // Container body dimensions (scene units, not real meters)
  const W = 4.8;   // width (long axis — the side walls)
  const H = 3.2;   // height
  const D = 2.4;   // depth (short axis — the door end + back)
  const T = 0.08;  // wall thickness

  // ── Floor ──────────────────────────────────────────────────────────────────
  const floorGeo = new THREE.BoxGeometry(W - T * 2, T, D - T * 2);
  const floor = new THREE.Mesh(floorGeo, matSteel);
  floor.position.set(0, -(H / 2) + T / 2, 0);
  floor.receiveShadow = true;
  group.add(floor);

  // Floor grid (decorative)
  const gridHelper = new THREE.GridHelper(Math.max(W, D) * 0.9, 8, 0x3a3c40, 0x2a2c30);
  gridHelper.position.y = -(H / 2) + T + 0.001;
  group.add(gridHelper);

  // ── Ceiling ────────────────────────────────────────────────────────────────
  const ceil = new THREE.Mesh(cachedBox(W, T, D), matSteel);
  ceil.position.set(0, H / 2 - T / 2, 0);
  ceil.castShadow = true;
  group.add(ceil);

  // ── Left wall ─────────────────────────────────────────────────────────────
  const lwGeo = new THREE.BoxGeometry(T, H, D);
  const lw = new THREE.Mesh(lwGeo, matSteel);
  lw.position.set(-(W / 2) + T / 2, 0, 0);
  lw.castShadow = true;
  group.add(lw);

  // ── Right wall ────────────────────────────────────────────────────────────
  const rw = new THREE.Mesh(lwGeo, matSteel);
  rw.position.set(W / 2 - T / 2, 0, 0);
  rw.castShadow = true;
  group.add(rw);

  // ── Back wall (closed end) ────────────────────────────────────────────────
  const bwGeo = new THREE.BoxGeometry(W, H, T);
  const bw = new THREE.Mesh(bwGeo, matSteel);
  bw.position.set(0, 0, -(D / 2) + T / 2);
  bw.castShadow = true;
  group.add(bw);

  // ── Corrugation ribs on left / right / back walls ─────────────────────────
  // Thin instanced horizontal strips to suggest corrugated steel.
  const ribW = 0.04;
  const ribCounts = Math.floor(H / 0.22);
  const ribGeoH = new THREE.BoxGeometry(W + T, ribW, ribW); // horizontal span for back
  const ribGeoV = new THREE.BoxGeometry(ribW, ribW, D + T); // depth span for side walls

  for (let i = 0; i < ribCounts; i++) {
    const y = -(H / 2) + 0.22 + i * 0.22;

    // back wall rib
    const ribBack = new THREE.Mesh(ribGeoH, matSteel);
    ribBack.position.set(0, y, -(D / 2));
    group.add(ribBack);

    // left wall rib
    const ribL = new THREE.Mesh(ribGeoV, matSteel);
    ribL.position.set(-(W / 2), y, 0);
    group.add(ribL);

    // right wall rib
    const ribR = new THREE.Mesh(ribGeoV, matSteel);
    ribR.position.set(W / 2, y, 0);
    group.add(ribR);
  }

  // ── Corner castings (8 boxes at the 8 corners) ────────────────────────────
  const castGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const castMat = new THREE.MeshStandardMaterial({
    color: cssColor('--connex-gray'),
    roughness: 0.3,
    metalness: 0.8,
  });
  const cx = W / 2;
  const cy = H / 2;
  const cz = D / 2;
  [
    [-cx, -cy, -cz], [cx, -cy, -cz], [-cx, cy, -cz], [cx, cy, -cz],
    [-cx, -cy,  cz], [cx, -cy,  cz], [-cx, cy,  cz], [cx, cy,  cz],
  ].forEach(([x, y, z]) => {
    const cast = new THREE.Mesh(castGeo, castMat);
    cast.position.set(x, y, z);
    cast.castShadow = true;
    group.add(cast);
  });

  // ── Doors (two panels, hinged at left/right edges of the front face) ───────
  // Door panels live in pivot groups so we can rotate around the hinge axis.
  const doorW = (W / 2) - T;
  const doorH = H - T * 2;
  const doorGeo = new THREE.BoxGeometry(doorW, doorH, T * 1.5);

  // Door frame bar across the top / bottom of door opening
  const frameBarGeo = new THREE.BoxGeometry(W, T, T * 2);
  const frameTop = new THREE.Mesh(frameBarGeo, matSteel);
  frameTop.position.set(0, H / 2 - T / 2, D / 2);
  group.add(frameTop);
  const frameBot = new THREE.Mesh(frameBarGeo, matSteel);
  frameBot.position.set(0, -(H / 2) + T / 2, D / 2);
  group.add(frameBot);

  // Left door pivot group — pivot at x = -W/2 + T (left hinge)
  const doorLPivot = new THREE.Group();
  doorLPivot.position.set(-(W / 2) + T, 0, D / 2);

  const doorLMesh = new THREE.Mesh(doorGeo, matDoor);
  doorLMesh.position.set(doorW / 2, 0, 0); // offset right from pivot
  doorLMesh.castShadow = true;
  doorLPivot.add(doorLMesh);
  group.add(doorLPivot);

  // Right door pivot group — pivot at x = +W/2 - T (right hinge)
  const doorRPivot = new THREE.Group();
  doorRPivot.position.set((W / 2) - T, 0, D / 2);

  const doorRMesh = new THREE.Mesh(doorGeo, matDoor);
  doorRMesh.position.set(-doorW / 2, 0, 0); // offset left from pivot
  doorRMesh.castShadow = true;
  doorRPivot.add(doorRMesh);
  group.add(doorRPivot);

  // ── Locking bars (decorative vertical bars on door panels) ────────────────
  const barGeo = new THREE.BoxGeometry(0.05, doorH * 0.85, 0.06);
  const barMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x888a89),
    roughness: 0.4,
    metalness: 0.7,
  });
  const barL = new THREE.Mesh(barGeo, barMat);
  barL.position.set(doorW * 0.65, 0, T); // near lock-edge of left door
  doorLMesh.add(barL);

  const barR = new THREE.Mesh(barGeo, barMat);
  barR.position.set(-doorW * 0.65, 0, T);
  doorRMesh.add(barR);

  return { group, doorL: doorLPivot, doorR: doorRPivot, W, H, D };
}

// ── Box grid layout ──────────────────────────────────────────────────────────

/**
 * Calculate grid positions for n boxes inside the connex.
 * Returns array of {x, y, z} positions (floor-centered, no overlap).
 * Layout: fill rows left-to-right, front-to-back (toward back wall).
 */
function layoutBoxes(n, shellW, shellD) {
  const boxSide = 0.65;    // box footprint
  const boxH    = 0.65;
  const padding = 0.12;
  const step    = boxSide + padding;
  const floorY  = -(shellD / 2) + boxH / 2 + 0.1; // relative to connex center; note: connex H not D

  // Available interior space (leave wall clearance)
  const innerW = shellW - 0.4;
  const innerD = shellD - 0.5;
  const cols = Math.floor(innerW / step);
  const rows = Math.ceil(n / cols);

  const positions = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      x: -(cols - 1) * step / 2 + col * step,
      y: floorY,   // will be mapped to world coords below
      z: (rows - 1) * step / 2 - row * step,
    });
  }
  return { positions, boxSide, boxH };
}

// ── Sprite label helpers ─────────────────────────────────────────────────────

/**
 * Create a canvas-based sprite that renders text.
 * Returns a THREE.Sprite positioned above the box.
 */
function makeLabel(text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 128, 64);

  ctx.fillStyle = color;
  ctx.font = 'bold 28px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.7, 0.35, 1);
  return sprite;
}

// ── Stamp decal helpers ──────────────────────────────────────────────────────

/**
 * Create a canvas-based plane mesh that renders the battalion stamp text.
 * The plane is parented to the door so it faces outward.
 */
function makeStampDecal(text, doorW, doorH) {
  const canvas = document.createElement('canvas');
  const cw = 512, ch = 256;
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, cw, ch);

  // Outer border (double-border stencil style, matching .cx-stamp)
  ctx.strokeStyle = 'rgba(212,191,145,0.85)';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, cw - 20, ch - 20);
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, cw - 36, ch - 36);

  // Text
  ctx.fillStyle = 'rgba(212,191,145,0.92)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Split multi-line on \n
  const lines = text.split('\n');
  const lineH = ch / (lines.length + 1);
  ctx.font = `bold ${Math.min(48, Math.floor(lineH * 0.72))}px "JetBrains Mono", monospace`;
  lines.forEach((line, i) => {
    ctx.fillText(line.toUpperCase(), cw / 2, lineH * (i + 1));
  });

  const texture = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(doorW * 0.75, doorH * 0.35);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, mat };
}

// ── Easing / animation helpers ───────────────────────────────────────────────

/** Simple ease-in-out quad. t in [0,1] → [0,1]. */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Animate a value from `from` to `to` over `ms` ms.
 * `onUpdate(val)` called each frame; returns a Promise that resolves when done.
 */
function animate(from, to, ms, onUpdate) {
  return new Promise(resolve => {
    const start = performance.now();
    function step(now) {
      const t = Math.min((now - start) / ms, 1);
      onUpdate(from + (to - from) * easeInOut(t));
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * createConnexScene(canvasEl, opts) → ConnexScene
 *
 * opts (all optional):
 *   animate: bool  — default true; set false to skip animations in tests
 *
 * Throws if WebGL is unavailable (Frontend must catch and fall back to list view).
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {{ animate?: boolean }} [opts]
 * @returns {ConnexScene}
 */
export function createConnexScene(canvasEl, opts = {}) {
  const animationsEnabled = opts.animate !== false;

  // ── WebGL guard ─────────────────────────────────────────────────────────
  if (!canvasEl) throw new Error('[connex3d] canvasEl is required');
  const testCtx = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl');
  if (!testCtx) {
    throw new Error('[connex3d] WebGL is not available in this browser. The list view will be used instead.');
  }

  // ── Renderer ─────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvasEl.clientWidth || 800, canvasEl.clientHeight || 600);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x0e0f11, 1);

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();

  // ── Camera ────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    45,
    (canvasEl.clientWidth || 800) / (canvasEl.clientHeight || 600),
    0.1,
    100
  );
  // Default 3/4 angle looking into the open doors (front-right-above)
  camera.position.set(5.5, 4.5, 7.5);
  camera.lookAt(0, 0, 0);

  // ── OrbitControls ─────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, canvasEl);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.1;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // can't flip under floor
  controls.minDistance = 3;
  controls.maxDistance = 20;
  controls.target.set(0, 0, 0);
  controls.update();

  // ── Lighting ──────────────────────────────────────────────────────────────
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffeedd, 1.2);
  keyLight.position.set(6, 10, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 40;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x8090cc, 0.4);
  rimLight.position.set(-6, 3, -5);
  scene.add(rimLight);

  // ── Materials (shared / reused) ───────────────────────────────────────────
  const matSteel = makeMat('--connex-gray', { roughness: 0.65, metalness: 0.55 });
  const matDoor  = makeMat('--connex-gray', { roughness: 0.55, metalness: 0.6 });
  const matEmpty = new THREE.MeshStandardMaterial({ color: cssColor('--connex-empty'), roughness: 0.7, metalness: 0.2 });
  const matWarn  = new THREE.MeshStandardMaterial({ color: cssColor('--connex-warn'),  roughness: 0.6, metalness: 0.25 });
  const matOk    = new THREE.MeshStandardMaterial({ color: cssColor('--connex-ok'),    roughness: 0.6, metalness: 0.25 });
  const matGold  = new THREE.MeshStandardMaterial({ color: cssColor('--connex-gold'),  roughness: 0.45, metalness: 0.5 });

  // ── Connex shell ──────────────────────────────────────────────────────────
  const { group: shellGroup, doorL, doorR, W: shellW, H: shellH, D: shellD } = buildConnexShell(matSteel, matDoor);
  scene.add(shellGroup);

  // Position connex group so floor is at y=0
  shellGroup.position.y = shellH / 2;

  // Track door state
  // Doors start closed (y-rotation 0 = facing front)
  // Open: left swings -PI/2 (outward), right swings +PI/2
  let doorsOpen = false;

  // ── Ghost prompt (empty-state affordance) ─────────────────────────────────
  const ghostSprite = makeLabel('Choose box count', tok('--connex-gray'));
  ghostSprite.position.set(0, shellH * 0.7, 0.5);
  ghostSprite.scale.set(2.2, 0.7, 1);
  shellGroup.add(ghostSprite);

  // ── Boxes state ───────────────────────────────────────────────────────────
  // Each entry: { mesh, labelSprite, ringMesh, state, highlighted }
  const boxObjects = [];

  // Materials per state (indexed by state name)
  const stateMat = {
    empty: matEmpty,
    warn:  matWarn,
    ok:    matOk,
  };

  // Box geometry (shared, small cube)
  const boxGeo = new THREE.BoxGeometry(0.65, 0.65, 0.65);
  // Ring geometry (thin torus for selection highlight)
  const ringGeo = new THREE.TorusGeometry(0.48, 0.04, 8, 24);

  // ── Stamp decal state ─────────────────────────────────────────────────────
  let stampDecal = null;

  // ── Raycasting ───────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const _pointer = new THREE.Vector2();

  /** Get canvas-relative normalized device coordinates from a PointerEvent or {clientX, clientY}. */
  function toNDC(clientX, clientY) {
    const rect = canvasEl.getBoundingClientRect();
    _pointer.x = ((clientX - rect.left) / rect.width)  * 2 - 1;
    _pointer.y = -((clientY - rect.top)  / rect.height) * 2 + 1;
  }

  /** Raycast against all box meshes; return boxNum (1-based) or null. */
  function raycastBoxes(clientX, clientY) {
    toNDC(clientX, clientY);
    raycaster.setFromCamera(_pointer, camera);
    const meshes = boxObjects.map(b => b.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const idx = meshes.indexOf(hits[0].object);
    return idx >= 0 ? idx + 1 : null; // 1-based
  }

  // ── Callbacks ─────────────────────────────────────────────────────────────
  let _onBoxDrop   = null;
  let _onBoxSelect = null;

  // Drag-over tracking (which box is currently under a drag)
  let _dragHoveredBox = null;

  // ── Canvas event listeners ────────────────────────────────────────────────
  function onPointerMove(e) {
    const boxNum = raycastBoxes(e.clientX, e.clientY);
    // Hover highlight (not the gold selection ring — just subtle visual)
    boxObjects.forEach((b, i) => {
      b.mesh.material.emissive = new THREE.Color(
        (boxNum === i + 1) ? 0x223322 : 0x000000
      );
    });
  }

  function onPointerClick(e) {
    const boxNum = raycastBoxes(e.clientX, e.clientY);
    if (boxNum && _onBoxSelect) _onBoxSelect(boxNum);
  }

  canvasEl.addEventListener('pointermove', onPointerMove);
  canvasEl.addEventListener('pointerup', onPointerClick);

  // ── Render loop ───────────────────────────────────────────────────────────
  let _raf = null;
  let _disposed = false;

  function renderLoop() {
    if (_disposed) return;
    _raf = requestAnimationFrame(renderLoop);
    controls.update();
    renderer.render(scene, camera);
  }
  renderLoop();

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Spawn or despawn boxes to reach count n (1..24). */
  function _setBoxCount(n) {
    const clampN = Math.max(0, Math.min(24, n));

    // Remove excess
    while (boxObjects.length > clampN) {
      const b = boxObjects.pop();
      shellGroup.remove(b.mesh);
      shellGroup.remove(b.labelSprite);
      if (b.ringMesh) shellGroup.remove(b.ringMesh);
      // don't dispose shared geo/mat; just remove from scene
    }

    // Add missing
    const { positions, boxSide, boxH } = layoutBoxes(clampN, shellW, shellD);
    // Re-position existing boxes first
    boxObjects.forEach((b, i) => {
      const p = positions[i];
      b.mesh.position.set(p.x, p.y, p.z);
      b.labelSprite.position.set(p.x, p.y + boxH * 0.85, p.z);
      if (b.ringMesh) {
        b.ringMesh.position.set(p.x, p.y, p.z);
      }
    });

    // Add new boxes
    for (let i = boxObjects.length; i < clampN; i++) {
      const p = positions[i];
      const boxNum = i + 1;

      const mesh = new THREE.Mesh(boxGeo, matEmpty.clone()); // clone so we can recolor independently
      mesh.position.set(p.x, p.y, p.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.scale.set(0.01, 0.01, 0.01); // start tiny for scale-in
      shellGroup.add(mesh);

      // Label sprite
      const label = makeLabel(String(boxNum), tok('--connex-gray'));
      label.position.set(p.x, p.y + boxH * 0.85, p.z);
      shellGroup.add(label);

      // Selection ring (hidden by default)
      const ring = new THREE.Mesh(ringGeo, matGold.clone());
      ring.position.set(p.x, p.y, p.z);
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      shellGroup.add(ring);

      const obj = { mesh, labelSprite: label, ringMesh: ring, state: 'empty', highlighted: false, boxNum };
      boxObjects.push(obj);

      // Scale-in animation
      if (animationsEnabled) {
        const delay = i * 40;
        setTimeout(() => {
          animate(0.01, 1, 220, v => {
            if (!_disposed) mesh.scale.set(v, v, v);
          });
        }, delay);
      } else {
        mesh.scale.set(1, 1, 1);
      }
    }

    // Show/hide ghost prompt
    ghostSprite.visible = clampN === 0;
  }

  /** Recolor a box and update its label to reflect state. */
  function _setBoxState(boxNum, { complete = false, bomCount = 0, hasItems = false }) {
    const idx = boxNum - 1;
    const b = boxObjects[idx];
    if (!b) return;

    let stateKey = 'empty';
    let labelText = String(boxNum);
    let labelColor = tok('--connex-gray');

    if (complete) {
      stateKey = 'ok';
      labelText = `✓ ${bomCount > 0 ? bomCount : ''}`;
      labelColor = tok('--connex-ok');
    } else if (hasItems) {
      stateKey = 'warn';
      labelText = `⚠ ${boxNum}`;
      labelColor = tok('--connex-warn');
    }

    b.state = stateKey;
    b.mesh.material.color.copy(cssColor(`--connex-${stateKey === 'ok' ? 'ok' : stateKey === 'warn' ? 'warn' : 'empty'}`));
    b.mesh.material.needsUpdate = true;

    // Update label
    shellGroup.remove(b.labelSprite);
    const newLabel = makeLabel(labelText, labelColor);
    const bh = 0.65;
    newLabel.position.copy(b.labelSprite.position);
    b.labelSprite.material.map.dispose();
    b.labelSprite.material.dispose();
    b.labelSprite = newLabel;
    shellGroup.add(newLabel);
  }

  // ── Public API (Contract D) ───────────────────────────────────────────────

  const api = {
    /**
     * Spawn/despawn boxes to exactly n (1..24).
     * Re-layouts the grid; scale-in animation for new boxes.
     */
    setBoxCount(n) {
      _setBoxCount(n);
    },

    /**
     * Recolor and re-badge a single box.
     * @param {number} boxNum  — 1-based
     * @param {{ complete: boolean, bomCount: number, hasItems: boolean }} state
     */
    setBoxState(boxNum, state) {
      _setBoxState(boxNum, state);
    },

    /**
     * Register the drop callback. Fired when a dragged payload is dropped
     * on a box. The 3D module resolves the target box by raycasting.
     * @param {(boxNum: number, payload: any) => void} cb
     */
    onBoxDrop(cb) {
      _onBoxDrop = cb;
    },

    /**
     * Register the select callback. Fired on box click.
     * @param {(boxNum: number) => void} cb
     */
    onBoxSelect(cb) {
      _onBoxSelect = cb;
    },

    /**
     * Swing the connex doors open and ease the camera to look inside.
     * @param {boolean} [doAnimate=true]
     * @returns {Promise<void>}
     */
    openConnex(doAnimate = true) {
      if (doorsOpen) return Promise.resolve();
      doorsOpen = true;
      if (!doAnimate || !animationsEnabled) {
        doorL.rotation.y = -Math.PI / 2;
        doorR.rotation.y =  Math.PI / 2;
        return Promise.resolve();
      }
      const pL = animate(0, -Math.PI / 2, 700, v => { doorL.rotation.y = v; });
      const pR = animate(0,  Math.PI / 2, 700, v => { doorR.rotation.y = v; });
      return Promise.all([pL, pR]).then(() => undefined);
    },

    /**
     * Swing the connex doors shut.
     * @param {boolean} [doAnimate=true]
     * @returns {Promise<void>}
     */
    closeConnex(doAnimate = true) {
      if (!doorsOpen) return Promise.resolve();
      doorsOpen = false;
      if (!doAnimate || !animationsEnabled) {
        doorL.rotation.y = 0;
        doorR.rotation.y = 0;
        return Promise.resolve();
      }
      const pL = animate(-Math.PI / 2, 0, 700, v => { doorL.rotation.y = v; });
      const pR = animate( Math.PI / 2, 0, 700, v => { doorR.rotation.y = v; });
      return Promise.all([pL, pR]).then(() => undefined);
    },

    /**
     * Fade in a stencil battalion-stamp decal on the closed door face.
     * @param {string} text — may contain \n for multi-line
     */
    applyStamp(text) {
      // Remove old stamp if any
      if (stampDecal) {
        doorL.remove(stampDecal.mesh);
        stampDecal.mesh.geometry.dispose();
        stampDecal.mat.map.dispose();
        stampDecal.mat.dispose();
        stampDecal = null;
      }

      const doorW = (shellW / 2) - 0.08;
      const doorH = shellH - 0.08 * 2;
      const decal = makeStampDecal(text, doorW, doorH);
      // Position on the outward face of the left door panel (local z = T/2 front face)
      decal.mesh.position.set(doorW * 0.35, 0, 0.07);
      doorL.add(decal.mesh);
      stampDecal = decal;

      // Fade in
      if (animationsEnabled) {
        animate(0, 1, 900, v => { decal.mat.opacity = v; });
      } else {
        decal.mat.opacity = 1;
      }
    },

    /**
     * Toggle the gold selection ring on a box.
     * Also used by Frontend on dragover to show which box is the drop target.
     * @param {number} boxNum — 1-based
     * @param {boolean} on
     */
    highlightBox(boxNum, on) {
      const idx = boxNum - 1;
      const b = boxObjects[idx];
      if (!b || !b.ringMesh) return;
      b.ringMesh.visible = on;
      b.highlighted = on;

      // Clear the old drag-hover if this is a new target
      if (on && _dragHoveredBox !== null && _dragHoveredBox !== boxNum) {
        const prev = boxObjects[_dragHoveredBox - 1];
        if (prev && prev.ringMesh) prev.ringMesh.visible = false;
      }
      _dragHoveredBox = on ? boxNum : null;
    },

    /**
     * Call from the canvas 'drop' event handler.
     * Raycasts to find the box under pointer coords and fires onBoxDrop.
     * @param {number} clientX
     * @param {number} clientY
     * @param {*} payload — whatever Frontend passes (e.g. bom_id)
     */
    resolveDropAt(clientX, clientY, payload) {
      const boxNum = raycastBoxes(clientX, clientY);
      if (boxNum && _onBoxDrop) {
        _onBoxDrop(boxNum, payload);
      }
      // Clear drag highlight
      if (_dragHoveredBox) {
        api.highlightBox(_dragHoveredBox, false);
      }
    },

    /** Notify scene of a canvas resize. Call from ResizeObserver or window resize. */
    resize() {
      const w = canvasEl.clientWidth;
      const h = canvasEl.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },

    /**
     * Free all GPU resources. Call when unmounting the connex panel.
     * After dispose() this instance is unusable.
     */
    dispose() {
      _disposed = true;
      cancelAnimationFrame(_raf);

      canvasEl.removeEventListener('pointermove', onPointerMove);
      canvasEl.removeEventListener('pointerup', onPointerClick);

      controls.dispose();

      // Dispose box meshes (they have cloned materials)
      boxObjects.forEach(b => {
        b.mesh.material.dispose();
        if (b.labelSprite.material.map) b.labelSprite.material.map.dispose();
        b.labelSprite.material.dispose();
        if (b.ringMesh) b.ringMesh.material.dispose();
      });
      boxObjects.length = 0;

      // Dispose stamp decal
      if (stampDecal) {
        stampDecal.mesh.geometry.dispose();
        stampDecal.mat.map.dispose();
        stampDecal.mat.dispose();
        stampDecal = null;
      }

      // Dispose shared geometries
      boxGeo.dispose();
      ringGeo.dispose();

      // Dispose shared materials
      [matSteel, matDoor, matEmpty, matWarn, matOk, matGold].forEach(m => m.dispose());

      // Dispose lights (no GPU resource but clean up scene)
      scene.remove(ambientLight);
      scene.remove(keyLight);
      scene.remove(rimLight);

      renderer.dispose();
    },
  };

  // Show ghost prompt initially (no boxes yet)
  ghostSprite.visible = true;

  return api;
}
