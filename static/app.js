/* app.js — CONNEX 1750 workflow state machine + wiring.
 * Owned by: Frontend agent.
 * No framework, no build step. Vanilla ES modules.
 * Consumed by: templates/index.html (type="module" script).
 *
 * Architecture:
 *   - One explicit STATE object; render functions are pure-ish (read STATE → write DOM).
 *   - All backend calls go through typed helpers (api.*).
 *   - 3D scene is driven via Contract D only; never touch three.js directly.
 *   - The 3D module may be absent (no WebGL) — fall back to list view gracefully.
 */

import { GLOSSARY, buildHelpPopover } from "./glossary.js";

/* =========================================================
 * DOM convenience
 * ========================================================= */
const $  = (id)  => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

/* HTML-escape utility — always escape before injecting into innerHTML */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================
 * STATE — single source of truth for the whole session.
 * Never mutate nested objects in place; always assign a new reference
 * so render functions can do simple equality checks.
 * ========================================================= */
let STATE = {
  /* workflow position */
  step: "PROFILE",   // one of the 8 states below

  /* operator identity */
  profile: null,     // Profile dict from /api/profiles

  /* insignia gallery — loaded once from /static/formations/manifest.json */
  formations: [],          // full list from manifest
  selectedFormation: null, // { file, name, echelon, is_adata } picked by operator

  /* current connex being packed */
  connex: null,      // Connex dict from /api/connex/<id>

  /* BOM ingest job — comes from the existing /ingest route */
  job_id: null,
  boms: [],          // array of BOM objects (from /ingest response)

  /* 3D scene handle — null if WebGL unavailable */
  scene: null,

  /* selected box (1-based) in the detail panel */
  selectedBox: null,

  /* SITREP result (final step) */
  sitrep: null,

  /* connexes produced in this session (for SITREP) */
  sessionConnexIds: [],
};

/* 8-step workflow state machine. Order matters for the stepper. */
const STEPS = [
  "PROFILE",
  "CONNEX_SETUP",
  "PACKING",
  "SEAL_DATA",
  "INDIVIDUAL",
  "CLOSE_STAMP",
  "NEXT?",
  "SITREP",
];

const STEP_LABELS = {
  PROFILE:     { label: "Profile",        sub: "Choose brigade / battalion" },
  CONNEX_SETUP:{ label: "Connex Setup",   sub: "Name container, set box count" },
  PACKING:     { label: "Packing",        sub: "Ingest BOMs, assign to boxes" },
  SEAL_DATA:   { label: "Seal Data",      sub: "SUN, CONNEX #, SEAL #, signers" },
  INDIVIDUAL:  { label: "Individual Items", sub: "Optional loose items per box" },
  CLOSE_STAMP: { label: "Close & Stamp",  sub: "Stamp + generate DD1750s" },
  "NEXT?":     { label: "Next Connex?",   sub: "Another container or finish" },
  SITREP:      { label: "SITREP",         sub: "Commander summary PDF" },
};

/* =========================================================
 * API helpers — all network calls go here.
 * Returns parsed JSON or throws {status, message}.
 * ========================================================= */
const api = {
  async get(url) {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) throw { status: r.status, message: j.error || r.statusText };
    return j;
  },

  async post(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw { status: r.status, message: j.error || r.statusText };
    return j;
  },

  async put(url, body) {
    const r = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw { status: r.status, message: j.error || r.statusText };
    return j;
  },

  /* POST multipart/form-data (for BOM ingest) */
  async postForm(url, formData) {
    const r = await fetch(url, { method: "POST", body: formData });
    const j = await r.json();
    if (!r.ok) throw { status: r.status, message: j.error || r.statusText };
    return j;
  },

  /* Binary download helper */
  async download(url, body, filename) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).error || msg; } catch (_) {}
      throw { status: r.status, message: msg };
    }
    const blob = await r.blob();
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  },
};

/* =========================================================
 * Transition guard — can we move from current step to target?
 * Returns null if OK, or a string describing why not.
 * ========================================================= */
function guardTransition(to) {
  const s = STATE;
  switch (to) {
    case "CONNEX_SETUP":
      if (!s.profile) return "Select or create a profile first.";
      break;
    case "PACKING":
      if (!s.connex) return "Create a connex first.";
      break;
    case "SEAL_DATA":
      if (!s.connex) return "No connex loaded.";
      // Every populated box must be complete (server-side check; we mirror locally)
      if (!allBoxesComplete()) return "All boxes must be complete (SLOC + SHRH POC filled) before sealing.";
      break;
    case "INDIVIDUAL":
      if (!s.connex) return "No connex loaded.";
      break;
    case "CLOSE_STAMP":
      // Must be sealed
      if (!s.connex || s.connex.status !== "sealed") return "Seal the connex before closing.";
      break;
    case "NEXT?":
      if (!s.connex || s.connex.status !== "sealed") return "Complete the current connex first.";
      break;
    case "SITREP":
      if (!s.sessionConnexIds.length) return "No sealed connexes in this session.";
      break;
  }
  return null; // OK
}

/* Are all populated boxes complete? (mirrors server-side rule) */
function allBoxesComplete() {
  if (!STATE.connex) return false;
  return STATE.connex.boxes.every(b => {
    const populated = (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length);
    if (!populated) return true; // empty box — server will reject at seal, but UI doesn't block early
    return b.sloc && b.shrh_poc;
  });
}

/* =========================================================
 * Step navigation
 * ========================================================= */
function goTo(step) {
  const err = guardTransition(step);
  if (err) { showError("step-error", err); return; }
  hideError("step-error");
  STATE.step = step;
  renderAll();
}

/* =========================================================
 * Master render — called on every state change.
 * ========================================================= */
function renderAll() {
  renderStepper();
  renderStepPanel();
  renderBanner();
}

/* =========================================================
 * Stepper render
 * ========================================================= */
function renderStepper() {
  const ol = $("cx-stepper");
  if (!ol) return;
  const curIdx = STEPS.indexOf(STATE.step);
  ol.innerHTML = STEPS.map((s, i) => {
    const done   = i < curIdx;
    const active = i === curIdx;
    const cls    = done ? "cx-stepper__item cx-stepper__item--done"
                 : active ? "cx-stepper__item cx-stepper__item--active"
                 : "cx-stepper__item";
    const dot    = done ? "&#10003;" : String(i + 1);
    return `<li class="${cls}" data-step="${esc(s)}" onclick="window._stepClick('${esc(s)}')">
      <span class="cx-stepper__dot">${dot}</span>
      <span class="cx-stepper__body">
        <span class="cx-stepper__label">${esc(STEP_LABELS[s].label)}</span>
        <span class="cx-stepper__sublabel">${esc(STEP_LABELS[s].sub)}</span>
      </span>
    </li>`;
  }).join("");
}

/* Global click handler for stepper — only allow navigating to completed steps
 * or the immediately next step. */
window._stepClick = function(step) {
  const curIdx = STEPS.indexOf(STATE.step);
  const tgtIdx = STEPS.indexOf(step);
  if (tgtIdx <= curIdx) {
    // Going back is always allowed (no data loss from re-visiting)
    STATE.step = step;
    renderAll();
  } else if (tgtIdx === curIdx + 1) {
    goTo(step); // forward one step — runs guard
  }
  // Jumping forward more than one step is not allowed via stepper click
};

/* =========================================================
 * Banner render (profile unit identity)
 * Shows the brigade insignia image when available; falls back to package emoji.
 * ========================================================= */
function renderBanner() {
  const el = $("cx-banner");
  if (!el) return;
  if (!STATE.profile) {
    el.innerHTML = `<span class="cx-banner__emblem">&#x1F4E6;</span>
      <span class="cx-banner__body">
        <span class="cx-banner__unit">CONNEX 1750</span>
        <span class="cx-banner__sub">No profile loaded</span>
      </span>`;
    return;
  }
  const p      = STATE.profile;
  const imgSrc = p.brigade_image ? `/static/formations/${esc(p.brigade_image)}` : "";
  const emblem = imgSrc
    ? `<img src="${imgSrc}" alt="${esc(p.brigade || "")}" class="cx-banner__emblem"
            width="40" height="40" style="object-fit:contain;" loading="lazy"
            onerror="this.outerHTML='<span class=\\'cx-banner__emblem\\'>&#x1F4E6;</span>'">`
    : `<span class="cx-banner__emblem">&#x1F4E6;</span>`;
  el.innerHTML = `${emblem}
    <span class="cx-banner__body">
      <span class="cx-banner__unit">${esc(p.brigade || "")}</span>
      <span class="cx-banner__sub">${esc(p.battalion || "")}${p.battery ? " — " + esc(p.battery) + " BTY" : ""}</span>
    </span>`;
}

/* =========================================================
 * Step panel router — renders the center + right-rail content
 * ========================================================= */
function renderStepPanel() {
  const center = $("cx-step-content");
  const right  = $("cx-right-rail-content");
  if (!center) return;

  switch (STATE.step) {
    case "PROFILE":      renderProfileStep(center, right); break;
    case "CONNEX_SETUP": renderConnexSetupStep(center, right); break;
    case "PACKING":      renderPackingStep(center, right); break;
    case "SEAL_DATA":    renderSealDataStep(center, right); break;
    case "INDIVIDUAL":   renderIndividualStep(center, right); break;
    case "CLOSE_STAMP":  renderCloseStampStep(center, right); break;
    case "NEXT?":        renderNextStep(center, right); break;
    case "SITREP":       renderSitrepStep(center, right); break;
  }
}

/* =========================================================
 * STEP 1 — PROFILE
 * Insignia gallery → pick brigade visually → fill battalion/battery → save.
 * On load, show "resume" card if a saved profile already exists.
 * ========================================================= */
function renderProfileStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel" id="profile-resume-wrap" style="display:none;margin-bottom:var(--space-4);">
      <!-- Populated by loadProfiles() when a saved profile is found -->
    </div>

    <div class="cx-panel" id="profile-gallery-panel">
      <h2 class="cx-panel__title">1 · Select Your Brigade</h2>
      <p class="cx-field-hint">Pick your unit insignia — then fill in battalion details below.</p>

      <!-- Search + echelon filter -->
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-4);">
        <input class="cx-field" id="gallery-search" placeholder="Search unit name…"
               style="flex:1;min-width:160px;"
               oninput="filterGallery()">
        <select class="cx-field" id="gallery-echelon" style="width:160px;" onchange="filterGallery()">
          <option value="">All Echelons</option>
          <option value="Brigade" selected>Brigade</option>
          <option value="Division">Division</option>
          <option value="Corps">Corps</option>
          <option value="Army">Army</option>
          <option value="Regiment">Regiment</option>
          <option value="Group">Group</option>
        </select>
      </div>

      <!-- Insignia grid — populated by renderGallery() -->
      <div id="insignia-grid" style="
        display:grid;
        grid-template-columns:repeat(auto-fill,minmax(110px,1fr));
        gap:var(--space-3);
        max-height:380px;
        overflow-y:auto;
        padding:var(--space-2);
      ">
        <div class="cx-field-hint">Loading insignia…</div>
      </div>
    </div>

    <!-- Secondary fields — hidden until a brigade is selected -->
    <div class="cx-panel" id="profile-detail-panel" style="display:none;margin-top:var(--space-4);">
      <div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-4);">
        <img id="selected-insignia-img" src="" alt="" width="64" height="64"
             style="object-fit:contain;border-radius:var(--radius-sm);">
        <div>
          <div class="cx-banner__unit" id="selected-brigade-label"></div>
          <div class="cx-banner__sub">Selected Unit</div>
        </div>
      </div>

      <div class="cx-field-wrap">
        <label class="cx-label">Battalion</label>
        <input class="cx-field" id="p_battalion" placeholder="2-55 ADA">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Battery</label>
        <input class="cx-field" id="p_battery" placeholder="B">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">UIC <span class="cx-field-hint">(optional)</span></label>
        <input class="cx-field cx-field--mono" id="p_uic" placeholder="WH1ZB0">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Default Packed By</label>
        <input class="cx-field" id="p_packed_by" placeholder="1LT RABATIN, JAIDEN">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Stamp Text</label>
        <input class="cx-field" id="p_stamp" placeholder="2-55 ADA">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Default SHRH POC ${buildHelpPopover("SHRH POC")}</label>
        <input class="cx-field" id="p_shrh" placeholder="CPT JONES">
      </div>

      <div id="profile-save-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
        <button class="cx-btn cx-btn--primary" onclick="saveProfile()">Save &amp; Continue</button>
        <button class="cx-btn cx-btn--ghost"   onclick="clearBrigadeSelection()">Change Brigade</button>
      </div>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      <h3 class="cx-panel__title">About Profiles</h3>
      <p class="cx-field-hint">Profiles store your unit identity for reuse across sessions.
        The insignia appears in the app banner. The stamp text prints on sealed connexes.</p>
    </div>`;

  loadProfilesAndGallery();
}

/* Load the manifest + saved profiles in parallel */
async function loadProfilesAndGallery() {
  /* Fetch manifest if not already cached */
  if (!STATE.formations.length) {
    try {
      const r    = await fetch("/static/formations/manifest.json");
      const data = await r.json();
      STATE.formations = data.formations || [];
    } catch (e) {
      STATE.formations = [];
      console.warn("[profile] Could not load formations manifest:", e.message);
    }
  }

  /* Check for existing saved profiles → show resume card */
  try {
    const data     = await api.get("/api/profiles");
    const profiles = (data.profiles || []).sort(
      (a, b) => (b.last_used || "").localeCompare(a.last_used || "")
    );
    if (profiles.length) renderResumeCard(profiles[0]);
  } catch (_) {
    /* No profiles yet — that's fine; gallery stays as the entry point */
  }

  renderGallery();
}

/* Render a "welcome back" card for the most-recently-used profile */
function renderResumeCard(p) {
  const wrap = $("profile-resume-wrap");
  if (!wrap) return;

  const imgSrc = p.brigade_image
    ? `/static/formations/${esc(p.brigade_image)}`
    : "";
  const imgHtml = imgSrc
    ? `<img src="${imgSrc}" alt="" width="48" height="48"
            style="object-fit:contain;margin-right:var(--space-3);" loading="lazy">`
    : `<span class="cx-banner__emblem" style="margin-right:var(--space-3);">&#x1F4E6;</span>`;

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
      <div style="display:flex;align-items:center;">
        ${imgHtml}
        <div>
          <div class="cx-banner__unit" style="font-size:var(--text-sm);">${esc(p.brigade || "")}</div>
          <div class="cx-banner__sub">${esc(p.battalion || "")}${p.battery ? " — BTY " + esc(p.battery) : ""}</div>
        </div>
      </div>
      <div style="display:flex;gap:var(--space-2);">
        <button class="cx-btn cx-btn--primary cx-btn--sm"
                onclick="resumeSavedProfile('${esc(p.profile_id)}')">Resume</button>
        <button class="cx-btn cx-btn--ghost cx-btn--sm"
                onclick="dismissResumeCard()">New Profile</button>
      </div>
    </div>`;
  wrap.style.display = "";
}

/* One-click resume: load saved profile and advance */
window.resumeSavedProfile = async function(profileId) {
  try {
    const data = await api.get(`/api/profiles/${profileId}`);
    STATE.profile = data.profile;
    if (STATE.profile.brigade_image) {
      STATE.selectedFormation = STATE.formations.find(
        f => f.file === STATE.profile.brigade_image
      ) || { file: STATE.profile.brigade_image, name: STATE.profile.brigade };
    }
    renderBanner();
    goTo("CONNEX_SETUP");
  } catch (e) {
    console.error("[profile] Resume failed:", e.message);
  }
};

window.dismissResumeCard = function() {
  const wrap = $("profile-resume-wrap");
  if (wrap) wrap.style.display = "none";
};

/* Render (or re-render) the insignia grid based on current filter values */
function renderGallery() {
  const grid    = $("insignia-grid");
  if (!grid) return;

  const query   = (($("gallery-search")  || {}).value || "").trim().toLowerCase();
  const echelon = (($("gallery-echelon") || {}).value || "");

  const filtered = STATE.formations.filter(f => {
    const matchName    = !query   || f.name.toLowerCase().includes(query);
    const matchEchelon = !echelon || f.echelon === echelon;
    return matchName && matchEchelon;
  });

  if (!filtered.length) {
    grid.innerHTML = `<span class="cx-field-hint" style="grid-column:1/-1;">No units match your search.</span>`;
    return;
  }

  grid.innerHTML = filtered.map(f => {
    const selected = STATE.selectedFormation && STATE.selectedFormation.file === f.file;
    const badgeCls = f.is_adata ? "cx-badge cx-badge--ok" : "";
    return `
      <div class="cx-panel cx-panel--2"
           style="cursor:pointer;text-align:center;padding:var(--space-3);
                  ${selected ? "outline:2px solid var(--connex-gold);outline-offset:2px;" : ""}"
           title="${esc(f.name)}"
           onclick="selectFormation('${esc(f.file)}')">
        <img src="/static/formations/${esc(f.file)}"
             alt="${esc(f.name)}"
             width="72" height="72"
             loading="lazy"
             style="object-fit:contain;display:block;margin:0 auto var(--space-2);"
             onerror="this.style.display='none'">
        <div style="font-size:var(--text-xs);color:var(--connex-gray);
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                    max-width:100%;" title="${esc(f.name)}">
          ${esc(f.name)}
        </div>
        ${badgeCls ? `<span class="${badgeCls}" style="font-size:10px;margin-top:var(--space-1);">ADA</span>` : ""}
      </div>`;
  }).join("");
}

/* Called by search/echelon filter inputs */
window.filterGallery = function() {
  renderGallery();
};

/* User clicked an insignia card — highlight it and reveal detail fields */
window.selectFormation = function(file) {
  const formation = STATE.formations.find(f => f.file === file);
  if (!formation) return;

  STATE.selectedFormation = formation;

  /* Re-render gallery to update the selection outline */
  renderGallery();

  /* Populate and show the detail panel */
  const panel = $("profile-detail-panel");
  if (panel) panel.style.display = "";

  const img   = $("selected-insignia-img");
  const label = $("selected-brigade-label");
  if (img)   { img.src = `/static/formations/${esc(file)}`; img.alt = esc(formation.name); }
  if (label)  label.textContent = formation.name;

  /* Pre-fill stamp text from the unit name (last word / short form) */
  const stamp = $("p_stamp");
  if (stamp && !stamp.value) {
    /* Derive a short stamp default: first numeric token in the name, e.g. "108th" */
    const match = formation.name.match(/\b\d+\w*/);
    stamp.value = match ? match[0].toUpperCase() : formation.name.split(" ")[0].toUpperCase();
  }

  /* Scroll detail panel into view on mobile */
  panel && panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

/* Clear selection and return to gallery */
window.clearBrigadeSelection = function() {
  STATE.selectedFormation = null;
  const panel = $("profile-detail-panel");
  if (panel) panel.style.display = "none";
  renderGallery();
};

window.saveProfile = async function() {
  if (!STATE.selectedFormation) {
    showError("profile-save-error", "Select a brigade insignia first.");
    return;
  }

  const brigade      = STATE.selectedFormation.name;
  const brigade_image = STATE.selectedFormation.file;
  const battalion    = ($("p_battalion") || {}).value || "";
  const battery      = ($("p_battery")   || {}).value || "";
  const uic          = ($("p_uic")       || {}).value || "";
  const packed_by    = ($("p_packed_by") || {}).value || "";
  const stamp_text   = ($("p_stamp")     || {}).value || "";
  const shrh_poc     = ($("p_shrh")      || {}).value || "";

  if (!battalion) {
    showError("profile-save-error", "Battalion is required.");
    return;
  }

  try {
    const data = await api.post("/api/profiles", {
      brigade, brigade_image, battalion, battery, uic,
      default_packed_by: packed_by,
      default_shrh_poc:  shrh_poc,
      stamp_text,
    });
    STATE.profile = data.profile;
    renderBanner();
    goTo("CONNEX_SETUP");
  } catch (e) {
    showError("profile-save-error", "Save failed: " + e.message);
  }
};

/* selectProfile — kept for backward compatibility (resume card uses resumeSavedProfile) */
async function selectProfile(profileId) {
  return window.resumeSavedProfile(profileId);
}

/* =========================================================
 * STEP 2 — CONNEX_SETUP
 * Create the connex, spawn boxes in 3D.
 * ========================================================= */
function renderConnexSetupStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel">
      <h2 class="cx-panel__title">2 · Connex Setup ${buildHelpPopover("CONNEX")}</h2>
      <p class="cx-field-hint">Name this container and choose how many boxes to spawn inside it.</p>
      <div class="cx-field-wrap">
        <label class="cx-label">Connex # ${buildHelpPopover("CONNEX #")}</label>
        <input class="cx-field cx-field--mono" id="cs_connex_no" placeholder="CONEX-01 (optional)">
        <span class="cx-field-hint">Leave blank — a placeholder will print on the PDF.</span>
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Number of Boxes</label>
        <input class="cx-field" id="cs_box_count" type="number" min="1" max="50" value="5">
      </div>
      <div id="cs-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
        <button class="cx-btn cx-btn--primary" onclick="createConnex()">Open Connex</button>
      </div>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      <h3 class="cx-panel__title">Tips</h3>
      <p class="cx-field-hint">You can change the box count later — boxes are virtual until a BOM is assigned to them.</p>
    </div>`;
}

window.createConnex = async function() {
  const connexNo  = ($("cs_connex_no")  || {}).value || "";
  const boxCount  = parseInt(($("cs_box_count") || {}).value || "5", 10);

  if (!STATE.profile) { showError("cs-error", "No profile selected."); return; }
  if (isNaN(boxCount) || boxCount < 1) { showError("cs-error", "Enter a valid box count (1 or more)."); return; }

  try {
    const body = { profile_id: STATE.profile.profile_id, box_count: boxCount };
    if (connexNo) body.connex_no = connexNo;

    const data = await api.post("/api/connex", body);
    STATE.connex = data.connex;

    // Drive 3D scene via Contract D
    if (STATE.scene) {
      await STATE.scene.openConnex(true);
      STATE.scene.setBoxCount(boxCount);
    }

    goTo("PACKING");
  } catch (e) {
    showError("cs-error", "Failed to create connex: " + e.message);
  }
};

/* =========================================================
 * STEP 3 — PACKING
 * Ingest BOM PDFs via existing /ingest, render draggable cards,
 * assign to boxes.
 * ========================================================= */
function renderPackingStep(center, right) {
  const boms = STATE.boms;

  center.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-4);">
      <h2 class="cx-panel__title">3 · Packing</h2>
      <p class="cx-field-hint">Ingest BOM PDFs, then drag cards onto boxes in the 3D view — or click a BOM to assign it using the panel on the right.</p>

      <!-- BOM ingest zone -->
      <div class="cx-field-wrap">
        <label class="cx-label">BOM PDFs</label>
        <div id="bom-drop-zone" class="cx-bom-card cx-bom-card--drop-target"
             style="padding:var(--space-6);text-align:center;cursor:pointer;"
             ondragover="event.preventDefault();this.classList.add('cx-bom-card--drop-target')"
             ondragleave="this.classList.remove('cx-bom-card--drop-target')"
             ondrop="handleBomZoneDrop(event)"
             onclick="$('bom-file-input').click()">
          <strong>Drop BOM PDFs here</strong> or click to browse<br>
          <span class="cx-field-hint">Multiple files OK — one BOM PDF per end item.</span>
          <input type="file" id="bom-file-input" accept="application/pdf" multiple style="display:none;"
                 onchange="ingestBoms(this.files)">
        </div>
        <div id="ingest-status" class="cx-field-hint" style="min-height:1.2em;margin-top:var(--space-2);"></div>
      </div>

      <div class="cx-divider"></div>

      <!-- BOM card tray -->
      <div id="bom-tray" style="display:flex;flex-direction:column;gap:var(--space-2);">
        ${boms.length ? renderBomCards(boms) : '<span class="cx-field-hint">No BOMs ingested yet.</span>'}
      </div>
    </div>

    <!-- Box status table (list-view fallback + parallel view) -->
    <div class="cx-panel">
      <h3 class="cx-panel__title">Box Status</h3>
      <div id="box-status-table">${renderBoxStatusTable()}</div>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel" id="box-detail-panel">
      <h3 class="cx-panel__title">Box Detail</h3>
      <p class="cx-field-hint">Click a box in the 3D view or the table to inspect it.</p>
    </div>
    <div class="cx-panel" style="margin-top:var(--space-4);">
      <button class="cx-btn cx-btn--primary" style="width:100%;" onclick="advanceToSealData()">
        Seal Data &#8594;
      </button>
      <div id="packing-advance-error" role="alert" class="cx-field-error-msg" style="display:none;margin-top:var(--space-2);"></div>
    </div>`;
}

function renderBomCards(boms) {
  return boms.map(bom => {
    const assignedBox = bomAssignedBox(bom);
    const cls = assignedBox ? "cx-bom-card cx-bom-card--assigned" : "cx-bom-card";
    return `<div class="${cls}" draggable="true"
               data-bom-id="${esc(bom.bom_id)}"
               ondragstart="handleBomDragStart(event, '${esc(bom.bom_id)}')"
               onclick="openBomAssignPanel('${esc(bom.bom_id)}')">
      <span class="cx-bom-card__nom">${esc(bom.nomenclature || bom.filename)}</span>
      <span class="cx-bom-card__qty">${esc(bom.item_count || "")} items</span>
      <div class="cx-bom-card__codes">
        ${bom.lin  ? `<span class="cx-bom-card__code--lin cx-mono">${esc(bom.lin)}</span>` : ""}
        ${bom.end_item_niin ? `<span class="cx-bom-card__code--nsn cx-mono">${esc(bom.end_item_niin)}</span>` : ""}
      </div>
      ${assignedBox ? `<span class="cx-badge cx-badge--ok">Box ${assignedBox}</span>` : ""}
    </div>`;
  }).join("");
}

/* Find which box a BOM is currently assigned to (from connex state) */
function bomAssignedBox(bom) {
  if (!STATE.connex) return null;
  for (const box of STATE.connex.boxes) {
    if (box.bom_ids && box.bom_ids.includes(bom.bom_id)) return box.box_num;
  }
  return null;
}

function renderBoxStatusTable() {
  if (!STATE.connex) return '<span class="cx-field-hint">No connex loaded.</span>';
  const boxes = STATE.connex.boxes;
  const rows = boxes.map(b => {
    const populated = (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length);
    let badgeCls, badgeText;
    if (b.complete) {
      badgeCls = "cx-badge cx-badge--ok"; badgeText = "Complete";
    } else if (populated && (!b.sloc || !b.shrh_poc)) {
      badgeCls = "cx-badge cx-badge--warn"; badgeText = "Needs SLOC/SHRH";
    } else if (populated) {
      badgeCls = "cx-badge cx-badge--warn"; badgeText = "Incomplete";
    } else {
      badgeCls = "cx-badge cx-badge--empty"; badgeText = "Empty";
    }
    return `<tr>
      <td>${b.box_num}</td>
      <td>${(b.bom_ids || []).length} BOM(s)</td>
      <td><span class="${badgeCls}">${badgeText}</span></td>
      <td><button class="cx-btn cx-btn--ghost cx-btn--sm" onclick="openBoxDetailPanel(${b.box_num})">Edit</button></td>
    </tr>`;
  }).join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
    <thead><tr>
      <th style="text-align:left;padding:var(--space-2);">Box</th>
      <th style="text-align:left;padding:var(--space-2);">BOMs</th>
      <th style="text-align:left;padding:var(--space-2);">Status</th>
      <th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* BOM drag: store bom_id in dataTransfer */
window.handleBomDragStart = function(event, bomId) {
  event.dataTransfer.setData("application/bom-id", bomId);
  event.dataTransfer.effectAllowed = "move";
};

/* File drop zone for BOM PDFs */
window.handleBomZoneDrop = function(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("cx-bom-card--drop-target");
  if (event.dataTransfer.files.length) ingestBoms(event.dataTransfer.files);
};

window.ingestBoms = async function(files) {
  if (!files || !files.length) return;
  const status = $("ingest-status");
  if (status) status.textContent = `Extracting ${files.length} BOM(s)…`;

  const fd = new FormData();
  for (const f of files) fd.append("boms", f);

  try {
    const data = await api.postForm("/ingest", fd);
    STATE.job_id = data.job_id;
    STATE.boms   = data.boms || [];

    if (status) status.textContent = `Extracted ${STATE.boms.length} BOM(s).`;

    // Attach the ingest job to the current connex
    if (STATE.connex) {
      await api.post(`/api/connex/${STATE.connex.connex_id}/attach`, { ingest_job_id: data.job_id });
    }

    // Refresh bom tray + box table
    const tray = $("bom-tray");
    if (tray) tray.innerHTML = renderBomCards(STATE.boms);
  } catch (e) {
    if (status) status.textContent = "Ingest failed: " + e.message;
  }
};

/* Quick-assign panel opened when clicking a BOM card */
window.openBomAssignPanel = function(bomId) {
  const bom = STATE.boms.find(b => b.bom_id === bomId);
  if (!bom || !STATE.connex) return;

  const panel = $("box-detail-panel");
  if (!panel) return;

  const options = STATE.connex.boxes.map(b =>
    `<option value="${b.box_num}" ${bomAssignedBox(bom) === b.box_num ? "selected" : ""}>Box ${b.box_num}</option>`
  ).join("");

  panel.innerHTML = `
    <h3 class="cx-panel__title">Assign BOM</h3>
    <p class="cx-field-hint">${esc(bom.nomenclature || bom.filename)}</p>
    <div class="cx-field-wrap">
      <label class="cx-label">Assign to Box</label>
      <select class="cx-field" id="quick-assign-box">${options}</select>
    </div>
    <div id="quick-assign-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
    <div style="display:flex;gap:var(--space-2);margin-top:var(--space-3);">
      <button class="cx-btn cx-btn--primary" onclick="quickAssignBom('${esc(bomId)}')">Assign</button>
      <button class="cx-btn cx-btn--ghost" onclick="restoreBoxDetailPlaceholder()">Cancel</button>
    </div>`;
};

window.quickAssignBom = async function(bomId) {
  const sel    = $("quick-assign-box");
  const boxNum = sel ? parseInt(sel.value, 10) : null;
  if (!boxNum || !STATE.connex) return;

  try {
    const data = await api.post(`/api/connex/${STATE.connex.connex_id}/assign`, {
      moves: [{ bom_id: bomId, box_num: boxNum }],
    });
    STATE.connex = data.connex;
    syncBoxStateTo3D();
    refreshPackingView();
  } catch (e) {
    showError("quick-assign-error", "Assign failed: " + e.message);
  }
};

/* Called when a drag is dropped onto the 3D canvas (via onBoxDrop callback from Contract D) */
function handleBoxDrop(boxNum, payload) {
  // payload.bomId is set by our handleBomDragStart via dataTransfer;
  // the 3D module fires onBoxDrop with what it captured from its raycasting.
  // But the dragged card's bomId comes via the HTML draggable (dataTransfer),
  // so we read it from the pending drag state instead.
  const bomId = STATE._pendingDragBomId;
  if (!bomId || !STATE.connex) return;
  STATE._pendingDragBomId = null;

  api.post(`/api/connex/${STATE.connex.connex_id}/assign`, {
    moves: [{ bom_id: bomId, box_num: boxNum }],
  }).then(data => {
    STATE.connex = data.connex;
    syncBoxStateTo3D();
    refreshPackingView();
  }).catch(e => console.error("Box drop assign failed:", e.message));
}

/* Update the 3D scene's box states to match server-side connex data */
function syncBoxStateTo3D() {
  if (!STATE.scene || !STATE.connex) return;
  STATE.connex.boxes.forEach(b => {
    STATE.scene.setBoxState(b.box_num, {
      complete: b.complete,
      bomCount: (b.bom_ids || []).length,
      hasItems: !!(b.individual_items && b.individual_items.length),
    });
  });
}

/* Re-render just the mutable parts of the packing view */
function refreshPackingView() {
  const tray = $("bom-tray");
  if (tray) tray.innerHTML = renderBomCards(STATE.boms);
  const table = $("box-status-table");
  if (table) table.innerHTML = renderBoxStatusTable();
}

/* Open the box detail panel (SLOC / SHRH POC fields) for a given box */
window.openBoxDetailPanel = function(boxNum) {
  STATE.selectedBox = boxNum;
  const box = STATE.connex && STATE.connex.boxes.find(b => b.box_num === boxNum);
  if (!box) return;

  const panel = $("box-detail-panel");
  if (!panel) return;

  panel.innerHTML = `
    <h3 class="cx-panel__title">Box ${boxNum}</h3>
    <div class="cx-field-wrap">
      <label class="cx-label">
        SLOC ${buildHelpPopover("SLOC")}
        <span class="cx-badge cx-badge--danger" style="font-size:var(--text-xs);">Required</span>
      </label>
      <input class="cx-field cx-field--mono" id="box-sloc-${boxNum}"
             value="${esc(box.sloc || "")}" placeholder="BLDG-100">
      <div id="sloc-error-${boxNum}" role="alert" class="cx-field-error-msg" style="display:none;"></div>
    </div>
    <div class="cx-field-wrap">
      <label class="cx-label">
        SHRH POC ${buildHelpPopover("SHRH POC")}
        <span class="cx-badge cx-badge--danger" style="font-size:var(--text-xs);">Required</span>
      </label>
      <input class="cx-field" id="box-shrh-${boxNum}"
             value="${esc(box.shrh_poc || "")}" placeholder="CPT JONES">
      <div id="shrh-error-${boxNum}" role="alert" class="cx-field-error-msg" style="display:none;"></div>
    </div>
    <div class="cx-field-hint">BOMs assigned: ${(box.bom_ids || []).length}</div>
    <div style="margin-top:var(--space-3);">
      <button class="cx-btn cx-btn--primary" onclick="saveBoxFields(${boxNum})">Save</button>
    </div>`;

  // Highlight in 3D
  if (STATE.scene) STATE.scene.highlightBox(boxNum, true);
};

window.saveBoxFields = async function(boxNum) {
  const sloc = ($(`box-sloc-${boxNum}`) || {}).value || "";
  const shrh = ($(`box-shrh-${boxNum}`) || {}).value || "";

  let valid = true;
  if (!sloc) { showError(`sloc-error-${boxNum}`, "SLOC is required."); valid = false; }
  else         hideError(`sloc-error-${boxNum}`);
  if (!shrh) { showError(`shrh-error-${boxNum}`, "SHRH POC is required."); valid = false; }
  else         hideError(`shrh-error-${boxNum}`);
  if (!valid) return;

  try {
    // PATCH just this box's fields via PUT /api/connex/<id>
    const updatedBoxes = STATE.connex.boxes.map(b =>
      b.box_num === boxNum ? { ...b, sloc, shrh_poc: shrh } : { box_num: b.box_num }
    );
    const data = await api.put(`/api/connex/${STATE.connex.connex_id}`, { boxes: updatedBoxes });
    STATE.connex = data.connex;
    syncBoxStateTo3D();
    refreshPackingView();
  } catch (e) {
    showError(`sloc-error-${boxNum}`, "Save failed: " + e.message);
  }
};

function restoreBoxDetailPlaceholder() {
  const panel = $("box-detail-panel");
  if (panel) panel.innerHTML = `<h3 class="cx-panel__title">Box Detail</h3><p class="cx-field-hint">Click a box to inspect it.</p>`;
}

window.advanceToSealData = function() {
  if (!allBoxesComplete()) {
    showError("packing-advance-error", "Every populated box needs a SLOC and SHRH POC before sealing.");
    return;
  }
  hideError("packing-advance-error");

  // Close connex in 3D (doors-close animation)
  if (STATE.scene) STATE.scene.closeConnex(true);

  goTo("SEAL_DATA");
};

/* =========================================================
 * STEP 4 — SEAL_DATA
 * SUN / CONNEX # / SEAL # / packed-by / signed-by.
 * Submit to /seal; show Contract B errors inline.
 * ========================================================= */
function renderSealDataStep(center, right) {
  const c = STATE.connex || {};

  center.innerHTML = `
    <div class="cx-panel">
      <h2 class="cx-panel__title">4 · Seal Data</h2>
      <p class="cx-field-hint">Enter identifiers for this connex. SUN, CONNEX #, and SEAL # may be left blank — a placeholder will print on the PDF.</p>

      <div class="cx-field-wrap">
        <label class="cx-label">SUN # ${buildHelpPopover("SUN #")}</label>
        <input class="cx-field cx-field--mono" id="sd_sun" value="${esc(c.sun || "")}" placeholder="SUN-2026-001 (optional)">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">CONNEX # ${buildHelpPopover("CONNEX #")}</label>
        <input class="cx-field cx-field--mono" id="sd_connex_no" value="${esc(c.connex_no || "")}" placeholder="CONEX-01 (optional)">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">SEAL # ${buildHelpPopover("SEAL #")}</label>
        <input class="cx-field cx-field--mono" id="sd_seal_no" value="${esc(c.seal_no || "")}" placeholder="S-12345 (optional)">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Packed By</label>
        <input class="cx-field" id="sd_packed_by"
               value="${esc(c.packed_by || (STATE.profile && STATE.profile.default_packed_by) || "")}"
               placeholder="1LT RABATIN, JAIDEN">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Signed By
          <span class="cx-field-hint"> — must differ from Packed By</span>
        </label>
        <input class="cx-field" id="sd_signed_by" value="${esc(c.signed_by || "")}" placeholder="CPT HOLLAND">
        <div id="sd-signer-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Date</label>
        <input class="cx-field" id="sd_date" value="${esc(c.date || todayLabel())}" placeholder="17 JUN 2026">
      </div>

      <!-- Contract B seal errors shown here -->
      <div id="seal-errors" class="cx-error-list" style="display:none;margin-top:var(--space-4);"></div>

      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
        <button class="cx-btn cx-btn--primary" onclick="submitSeal()">Seal Connex</button>
        <button class="cx-btn cx-btn--ghost"   onclick="saveSealDraft()">Save Draft</button>
      </div>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      <h3 class="cx-panel__title">Rules</h3>
      <ul class="cx-field-hint" style="padding-left:var(--space-4);">
        <li>Signer must differ from packer.</li>
        <li>Every occupied box needs SLOC + SHRH POC.</li>
        <li>Blank SUN/CONNEX#/SEAL# prints a placeholder.</li>
      </ul>
    </div>`;
}

window.saveSealDraft = async function() {
  await patchSealFields();
};

window.submitSeal = async function() {
  await patchSealFields();
  if (!STATE.connex) return;

  try {
    const data = await api.post(`/api/connex/${STATE.connex.connex_id}/seal`, {});
    if (data.ok) {
      STATE.connex = data.connex;
      STATE.sessionConnexIds.push(STATE.connex.connex_id);
      goTo("INDIVIDUAL");
    } else {
      renderSealErrors(data.errors || []);
    }
  } catch (e) {
    renderSealErrors([e.message]);
  }
};

/* Write SUN/CONNEX#/SEAL#/packed_by/signed_by/date to the server */
async function patchSealFields() {
  if (!STATE.connex) return;

  const sun       = ($("sd_sun")        || {}).value || "";
  const connexNo  = ($("sd_connex_no")  || {}).value || "";
  const sealNo    = ($("sd_seal_no")    || {}).value || "";
  const packedBy  = ($("sd_packed_by")  || {}).value || "";
  const signedBy  = ($("sd_signed_by")  || {}).value || "";
  const date      = ($("sd_date")       || {}).value || "";

  try {
    const data = await api.put(`/api/connex/${STATE.connex.connex_id}`, {
      sun, connex_no: connexNo, seal_no: sealNo,
      packed_by: packedBy, signed_by: signedBy, date,
    });
    STATE.connex = data.connex;
  } catch (e) {
    renderSealErrors(["Auto-save failed: " + e.message]);
  }
}

/* Render Contract B errors inline */
function renderSealErrors(errors) {
  const el = $("seal-errors");
  if (!el) return;
  if (!errors || !errors.length) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  el.style.display = "";
  el.innerHTML = `<ul class="cx-error-list__item">` +
    errors.map(e => `<li class="cx-error-list__item">${esc(e)}</li>`).join("") +
    `</ul>`;

  // Field-level highlighting: map error codes to inputs
  const fieldMap = {
    "MISSING_SLOC":   null,   // handled at box level
    "MISSING_SHRH":   null,
    "NO_SIGNER":      "sd_signed_by",
    "SIGNER_EQ_PACKER": "sd_signed_by",
  };
  errors.forEach(e => {
    for (const [code, inputId] of Object.entries(fieldMap)) {
      if (e.startsWith(code) && inputId) {
        const inp = $(inputId);
        if (inp) inp.classList.add("cx-field--error");
      }
    }
  });
}

/* =========================================================
 * STEP 5 — INDIVIDUAL ITEMS
 * Per-box optional items (description, SN, NSN, LIN).
 * AI helper hook is clearly marked below — NOT wired in MVP.
 * ========================================================= */
function renderIndividualStep(center, right) {
  const boxes = (STATE.connex && STATE.connex.boxes) || [];
  const populated = boxes.filter(b => (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length));

  center.innerHTML = `
    <div class="cx-panel">
      <h2 class="cx-panel__title">5 · Individual Items</h2>
      <p class="cx-field-hint">Optionally add loose items to any box — items not covered by a BOM (description, SN, NSN, LIN — all optional).</p>

      <div id="individual-boxes">
        ${populated.map(b => renderIndividualBoxSection(b)).join("")}
      </div>

      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
        <button class="cx-btn cx-btn--primary" onclick="goTo('CLOSE_STAMP')">Continue &#8594;</button>
      </div>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      <h3 class="cx-panel__title">Individual Items</h3>
      <p class="cx-field-hint">Use for miscellaneous items, tools, or accessories not in any BOM.
        All fields are optional — fill only what you know.</p>

      <!-- ============================================================
           AI HELPER HOOK — DEFERRED (fast-follow / owl-alpha)
           When the AI assistant agent is ready, wire it here:
             - Attach to the input fields below (description, NSN, LIN)
             - Call POST /api/ai/suggest-item with {description, box_num, connex_id}
             - Populate suggested NSN/LIN into the form fields
           Contract: /api/ai/suggest-item is a stub defined in ai_assist.py.
           Do NOT connect this in the MVP critical path.
           ============================================================ -->
      <div id="ai-helper-hook" style="display:none;" data-ai-endpoint="/api/ai/suggest-item">
        <!-- AI helper mounts here in fast-follow wave -->
      </div>
    </div>`;
}

function renderIndividualBoxSection(box) {
  const items = box.individual_items || [];
  const itemsHtml = items.map((it, idx) => renderIndividualItemRow(box.box_num, idx, it)).join("");
  return `
    <div class="cx-panel cx-panel--2" style="margin-bottom:var(--space-4);" id="ibox-${box.box_num}">
      <h4 class="cx-section-title">Box ${box.box_num}</h4>
      <div id="ibox-items-${box.box_num}">${itemsHtml}</div>
      <button class="cx-btn cx-btn--ghost cx-btn--sm" style="margin-top:var(--space-2);"
              onclick="addIndividualItem(${box.box_num})">+ Add Item</button>
      <div id="ibox-error-${box.box_num}" role="alert" class="cx-field-error-msg" style="display:none;"></div>
    </div>`;
}

function renderIndividualItemRow(boxNum, idx, item) {
  item = item || {};
  return `
    <div class="cx-panel cx-panel--2" style="margin-bottom:var(--space-2);" id="irow-${boxNum}-${idx}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);">
        <div class="cx-field-wrap">
          <label class="cx-label">Description</label>
          <input class="cx-field" id="idesc-${boxNum}-${idx}" value="${esc(item.description || "")}" placeholder="e.g. Carrying case">
        </div>
        <div class="cx-field-wrap">
          <label class="cx-label">SN</label>
          <input class="cx-field cx-field--mono" id="isn-${boxNum}-${idx}" value="${esc(item.sn || "")}" placeholder="">
        </div>
        <div class="cx-field-wrap">
          <label class="cx-label">NSN ${buildHelpPopover("NSN")}</label>
          <input class="cx-field cx-field--mono" id="insn-${boxNum}-${idx}" value="${esc(item.nsn || "")}" placeholder="1005-01-231-0973">
        </div>
        <div class="cx-field-wrap">
          <label class="cx-label">LIN ${buildHelpPopover("LIN")}</label>
          <input class="cx-field cx-field--mono" id="ilin-${boxNum}-${idx}" value="${esc(item.lin || "")}" placeholder="M39331">
        </div>
      </div>
      <div style="display:flex;gap:var(--space-2);margin-top:var(--space-2);">
        <button class="cx-btn cx-btn--primary cx-btn--sm" onclick="saveIndividualItem(${boxNum}, ${idx})">Save</button>
        <button class="cx-btn cx-btn--danger  cx-btn--sm" onclick="removeIndividualItem(${boxNum}, ${idx})">Remove</button>
      </div>
    </div>`;
}

window.addIndividualItem = function(boxNum) {
  const box = STATE.connex && STATE.connex.boxes.find(b => b.box_num === boxNum);
  if (!box) return;
  if (!box.individual_items) box.individual_items = [];
  box.individual_items.push({ description: "", sn: "", nsn: "", lin: "" });

  const container = $(`ibox-items-${boxNum}`);
  if (container) {
    const idx = box.individual_items.length - 1;
    const div = document.createElement("div");
    div.innerHTML = renderIndividualItemRow(boxNum, idx, box.individual_items[idx]);
    container.appendChild(div.firstElementChild);
  }
};

window.saveIndividualItem = async function(boxNum, idx) {
  const description = ($(`idesc-${boxNum}-${idx}`) || {}).value || "";
  const sn          = ($(`isn-${boxNum}-${idx}`)   || {}).value || "";
  const nsn         = ($(`insn-${boxNum}-${idx}`)  || {}).value || "";
  const lin         = ($(`ilin-${boxNum}-${idx}`)  || {}).value || "";

  if (!STATE.connex) return;
  const box = STATE.connex.boxes.find(b => b.box_num === boxNum);
  if (!box) return;

  if (!box.individual_items) box.individual_items = [];
  box.individual_items[idx] = { description, sn, nsn, lin };

  try {
    // Send full individual_items array for this box
    const updatedBoxes = STATE.connex.boxes.map(b =>
      b.box_num === boxNum
        ? { box_num: b.box_num, individual_items: b.individual_items }
        : { box_num: b.box_num }
    );
    const data = await api.put(`/api/connex/${STATE.connex.connex_id}`, { boxes: updatedBoxes });
    STATE.connex = data.connex;
    hideError(`ibox-error-${boxNum}`);
  } catch (e) {
    showError(`ibox-error-${boxNum}`, "Save failed: " + e.message);
  }
};

window.removeIndividualItem = async function(boxNum, idx) {
  if (!STATE.connex) return;
  const box = STATE.connex.boxes.find(b => b.box_num === boxNum);
  if (!box || !box.individual_items) return;

  box.individual_items.splice(idx, 1);

  const row = $(`irow-${boxNum}-${idx}`);
  if (row) row.remove();

  try {
    const updatedBoxes = STATE.connex.boxes.map(b =>
      b.box_num === boxNum
        ? { box_num: b.box_num, individual_items: b.individual_items }
        : { box_num: b.box_num }
    );
    await api.put(`/api/connex/${STATE.connex.connex_id}`, { boxes: updatedBoxes });
  } catch (e) {
    showError(`ibox-error-${boxNum}`, "Remove failed: " + e.message);
  }
};

/* =========================================================
 * STEP 6 — CLOSE_STAMP + GENERATE
 * Apply stamp in 3D; download DD1750 ZIP.
 * ========================================================= */
function renderCloseStampStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel">
      <h2 class="cx-panel__title">6 · Close &amp; Stamp</h2>
      <p class="cx-field-hint">The connex is sealed. Apply the battalion stamp and download per-box DD1750 PDFs.</p>

      ${STATE.scene ? `
        <div style="margin-bottom:var(--space-4);">
          <button class="cx-btn cx-btn--ghost" onclick="applyStamp3D()">Apply Stamp (3D)</button>
        </div>` : ""}

      <!-- Stamp preview -->
      <div class="cx-stamp cx-stamp--rotated" id="stamp-preview" style="margin-bottom:var(--space-4);">
        ${esc((STATE.profile && STATE.profile.stamp_text) || "UNIT")}
      </div>

      <div id="generate-status" class="cx-field-hint" style="min-height:1.2em;"></div>
      <div id="generate-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>

      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
        <button class="cx-btn cx-btn--primary" onclick="downloadDD1750s()">Download DD1750s (ZIP)</button>
        <button class="cx-btn cx-btn--ghost"   onclick="goTo('NEXT?')">Next &#8594;</button>
      </div>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      <h3 class="cx-panel__title">Stamp</h3>
      <p class="cx-field-hint">The battalion stamp text comes from your profile. The 3D scene applies it as a decal on the closed connex.</p>
    </div>`;

  // Apply stamp on entering this step
  if (STATE.scene && STATE.profile) {
    STATE.scene.applyStamp(STATE.profile.stamp_text || "");
  }
}

window.applyStamp3D = function() {
  if (STATE.scene && STATE.profile) {
    STATE.scene.applyStamp(STATE.profile.stamp_text || "");
  }
};

window.downloadDD1750s = async function() {
  if (!STATE.connex) return;
  const status = $("generate-status");
  if (status) status.textContent = "Generating…";
  try {
    await api.download(
      `/api/connex/${STATE.connex.connex_id}/generate`,
      {},
      `DD1750_${STATE.connex.connex_no || STATE.connex.connex_id}.zip`
    );
    if (status) status.textContent = "Downloaded.";
  } catch (e) {
    showError("generate-error", "Generate failed: " + e.message);
    if (status) status.textContent = "";
  }
};

/* =========================================================
 * STEP 7 — NEXT?
 * Loop to CONNEX_SETUP (same profile) or finish → SITREP.
 * ========================================================= */
function renderNextStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel" style="text-align:center;">
      <h2 class="cx-panel__title">7 · Another Connex?</h2>
      <p class="cx-field-hint" style="margin-bottom:var(--space-6);">
        ${STATE.sessionConnexIds.length} connex(es) completed in this session.
      </p>
      <div style="display:flex;gap:var(--space-4);justify-content:center;">
        <button class="cx-btn cx-btn--primary" onclick="startAnotherConnex()">Prepare Another Connex</button>
        <button class="cx-btn cx-btn--ghost"   onclick="goTo('SITREP')">Finish &amp; Generate SITREP</button>
      </div>
    </div>`;
}

window.startAnotherConnex = function() {
  // Reset connex-level state but keep profile and session connexes
  STATE.connex    = null;
  STATE.job_id    = null;
  STATE.boms      = [];
  STATE.selectedBox = null;

  // Re-open 3D scene for the new connex
  if (STATE.scene) {
    // Dispose old scene; the init will create a fresh one
    STATE.scene.dispose();
    STATE.scene = null;
    initScene();
  }

  goTo("CONNEX_SETUP");
};

/* =========================================================
 * STEP 8 — SITREP
 * POST /api/sitrep with all session connex IDs; offer PDF download.
 * ========================================================= */
function renderSitrepStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel">
      <h2 class="cx-panel__title">8 · Commander's SITREP</h2>
      <p class="cx-field-hint">Generating summary across ${STATE.sessionConnexIds.length} connex(es)…</p>
      <div id="sitrep-content"></div>
      <div id="sitrep-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
    </div>`;

  loadSitrep();
}

async function loadSitrep() {
  try {
    const body = STATE.sessionConnexIds.length
      ? { connex_ids: STATE.sessionConnexIds }
      : { profile_id: STATE.profile && STATE.profile.profile_id };

    const data = await api.post("/api/sitrep", body);
    STATE.sitrep = data.sitrep;
    renderSitrepContent(data.sitrep);
  } catch (e) {
    showError("sitrep-error", "SITREP load failed: " + e.message);
  }
}

function renderSitrepContent(sitrep) {
  const el = $("sitrep-content");
  if (!el || !sitrep) return;

  const flags = (sitrep.flags || []).map(f => `<li>${esc(f)}</li>`).join("");

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-4);margin:var(--space-4) 0;">
      <div class="cx-panel cx-panel--2" style="text-align:center;">
        <div style="font-size:var(--text-lg);color:var(--connex-gold);">${sitrep.connex_count || 0}</div>
        <div class="cx-field-hint">Connexes</div>
      </div>
      <div class="cx-panel cx-panel--2" style="text-align:center;">
        <div style="font-size:var(--text-lg);color:var(--connex-gold);">${sitrep.box_count || 0}</div>
        <div class="cx-field-hint">Boxes</div>
      </div>
      <div class="cx-panel cx-panel--2" style="text-align:center;">
        <div style="font-size:var(--text-lg);color:var(--connex-gold);">${sitrep.bom_count || 0}</div>
        <div class="cx-field-hint">BOMs</div>
      </div>
    </div>

    ${flags ? `<div class="cx-panel cx-panel--2" style="margin-bottom:var(--space-4);">
      <h4 class="cx-section-title">Flags</h4>
      <ul class="cx-field-hint" style="padding-left:var(--space-4);">${flags}</ul>
    </div>` : ""}

    <div style="display:flex;gap:var(--space-3);">
      <button class="cx-btn cx-btn--primary" onclick="downloadSitrepPdf()">Download SITREP PDF</button>
    </div>`;
}

window.downloadSitrepPdf = async function() {
  try {
    const body = STATE.sessionConnexIds.length
      ? { connex_ids: STATE.sessionConnexIds }
      : { profile_id: STATE.profile && STATE.profile.profile_id };
    await api.download("/api/sitrep/pdf", body, "SITREP.pdf");
  } catch (e) {
    showError("sitrep-error", "SITREP PDF failed: " + e.message);
  }
};

/* =========================================================
 * 3D SCENE INTEGRATION (Contract D)
 * ========================================================= */
async function initScene() {
  const canvas = $("cx-3d-canvas");
  if (!canvas) return;

  try {
    // Dynamic import — the module may not exist yet if 3D agent is still building.
    // Import path matches the static/ route Flask serves.
    const mod = await import("/static/connex3d.js");

    STATE.scene = mod.createConnexScene(canvas, {});

    // Wire Contract D callbacks
    STATE.scene.onBoxDrop((boxNum, payload) => handleBoxDrop(boxNum, payload));
    STATE.scene.onBoxSelect((boxNum) => openBoxDetailPanel(boxNum));

    // Expose drag state so handleBoxDrop can read the pending bom_id
    canvas.addEventListener("dragover", (e) => {
      e.preventDefault();
      // Read bom_id from drag state (set in handleBomDragStart)
    });
    canvas.addEventListener("dragenter", (e) => {
      const bomId = e.dataTransfer && e.dataTransfer.getData("application/bom-id");
      if (bomId) STATE._pendingDragBomId = bomId;
    });

    // Handle highlight on box hover during drag
    canvas.addEventListener("dragover", (e) => {
      if (STATE._pendingDragBomId) {
        // 3D module handles highlight via onBoxDrop; nothing extra needed here
      }
    });

    console.log("[connex] 3D scene initialized.");
  } catch (err) {
    console.warn("[connex] 3D scene unavailable — falling back to list view:", err.message);
    // Hide canvas, list view is already rendered as the primary UI
    if (canvas) canvas.style.display = "none";
    const toggle = $("cx-view-toggle");
    if (toggle) toggle.style.display = "none"; // no point toggling
  }
}

/* =========================================================
 * View toggle: 3D ↔ Table
 * ========================================================= */
window.setView = function(view) {
  const canvas = $("cx-3d-canvas");
  const table  = $("cx-list-view");
  const btn3d  = $("btn-view-3d");
  const btnTbl = $("btn-view-table");

  if (view === "3d") {
    if (canvas) canvas.style.display = "";
    if (table)  table.style.display  = "none";
    if (btn3d)  btn3d.classList.add("cx-view-toggle__btn--active");
    if (btnTbl) btnTbl.classList.remove("cx-view-toggle__btn--active");
  } else {
    if (canvas) canvas.style.display = "none";
    if (table)  table.style.display  = "";
    if (btn3d)  btn3d.classList.remove("cx-view-toggle__btn--active");
    if (btnTbl) btnTbl.classList.add("cx-view-toggle__btn--active");
  }
};

/* =========================================================
 * toggleHelp — .cx-help popover open/close.
 * Consumed by all buildHelpPopover() calls in app.js + index.html.
 * ========================================================= */
window.toggleHelp = function(triggerBtn) {
  const help    = triggerBtn.closest(".cx-help");
  const popover = help && help.querySelector(".cx-help__popover");
  if (!popover) return;

  const isOpen = popover.classList.contains("cx-help__popover--open");

  // Close all open popovers first
  $$(".cx-help__popover--open").forEach(p => p.classList.remove("cx-help__popover--open"));

  if (!isOpen) {
    popover.classList.add("cx-help__popover--open");
    // Close on outside click or Escape
    const close = (e) => {
      if (!help.contains(e.target)) {
        popover.classList.remove("cx-help__popover--open");
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $$(".cx-help__popover--open").forEach(p => p.classList.remove("cx-help__popover--open"));
  }
});

/* =========================================================
 * Error / info display helpers
 * ========================================================= */
function showError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = "";
  el.classList.remove("cx-field-hint");
  el.classList.add("cx-field-error-msg");
}

function showInfo(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = "";
  el.classList.remove("cx-field-error-msg");
  el.classList.add("cx-field-hint");
}

function hideError(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = "none";
  el.textContent   = "";
}

/* =========================================================
 * Utilities
 * ========================================================= */
function todayLabel() {
  const d = new Date();
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${String(d.getDate()).padStart(2,"0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/* =========================================================
 * INIT — runs on DOMContentLoaded
 * ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  // Start at PROFILE step
  renderAll();

  // Initialize 3D scene (non-blocking; falls back gracefully)
  initScene();

  // Wire canvas resize
  window.addEventListener("resize", () => {
    if (STATE.scene) STATE.scene.resize();
  });
});

/* Expose goTo globally so inline onclick handlers in rendered HTML can use it */
window.goTo = goTo;

/* Expose selectProfile globally (called from dynamically rendered profile cards) */
window.selectProfile = selectProfile;
