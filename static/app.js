/* app.js — CRATE (Container Readiness and Accountability Tracking Engine)
 * No framework, no build step. Vanilla ES modules.
 */

import { GLOSSARY, buildHelpPopover } from "./glossary.js";

const $  = (id)  => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================
 * STATE
 * ========================================================= */
let STATE = {
  step: "PROFILE",
  profile: null,
  formations: [],
  // Insignia cascade selections (Division → Brigade → Battalion DUI).
  _currentTier: "division",
  selectedDivision: null,      // SSI patch (echelon Division)
  selectedBrigade: null,       // SSI patch (echelon Brigade) — the unit identity
  selectedBattalionDUI: null,  // DUI patch (echelon Regiment/Battalion)
  selectedFormation: null,     // legacy alias kept in sync with selectedBrigade
  connex: null,
  job_id: null,
  boms: [],
  itemBoxMap: {},      // item_key ("bom_id:line_no") -> box_num, from /assign
  openBoms: {},        // bom_id -> true when its drill-down is expanded
  sessionConnexIds: [],
  sitrep: null,
};

const STEPS = ["PROFILE", "CONNEX_SETUP", "PACKING", "BOX_STATUS", "SEAL_DATA", "REVIEW_SEAL", "NEXT_SITREP"];

const STEP_LABELS = {
  PROFILE:      { label: "Profile",        sub: "Choose brigade / battalion" },
  CONNEX_SETUP: { label: "Connex Setup",   sub: "Name container, set box count" },
  PACKING:      { label: "Packing",        sub: "Assign items to boxes" },
  BOX_STATUS:   { label: "Box Status",     sub: "Label, SLOC/POC, audit" },
  SEAL_DATA:    { label: "Seal Data",      sub: "SUN, CONNEX #, SEAL #, signers" },
  REVIEW_SEAL:  { label: "Review & Seal",  sub: "Final check + apply stamp" },
  NEXT_SITREP:  { label: "Next / SITREP",  sub: "Another connex or finish" },
};

/* =========================================================
 * INSIGNIA CASCADE — tier config + badges
 * Three echelon tiers feed the profile gallery. The patch manifest carries no
 * parent→child linkage, so each tier is an independent picker; the breadcrumb
 * concatenates whatever was chosen at each level (not a filtered drill-down).
 * ========================================================= */
const TIERS = {
  division:  { label: "Division",  echelons: ["Division"],                        defType: "SSI" },
  brigade:   { label: "Brigade",   echelons: ["Brigade"],                         defType: "SSI" },
  // "Other" folds the handful of motto/camp DUIs into the battalion tier so no
  // manifest entry is orphaned out of every picker.
  battalion: { label: "Battalion", echelons: ["Regiment", "Battalion", "Other"], defType: "DUI" },
};

// SSI = shoulder sleeve insignia (blue badge); DUI = distinctive unit insignia
// / crest (gold badge). Inline-styled off the design tokens to keep CSS minimal.
function insigniaBadge(type) {
  if (type === "SSI") return `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:var(--radius-sm);background:var(--connex-blue);color:#fff;">SSI</span>`;
  if (type === "DUI") return `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:var(--radius-sm);background:var(--connex-gold);color:#1a1a1a;">DUI</span>`;
  return "";
}

/* =========================================================
 * API helpers
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
  async patch(url, body) {
    const r = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw { status: r.status, message: j.error || r.statusText };
    return j;
  },
  async postForm(url, formData) {
    const r = await fetch(url, { method: "POST", body: formData });
    const j = await r.json();
    if (!r.ok) throw { status: r.status, message: j.error || r.statusText };
    return j;
  },
  async del(url) {
    const r = await fetch(url, { method: "DELETE" });
    const j = await r.json();
    // box endpoints signal failures with a machine-readable `code`
    // (SEALED / BOX_NOT_EMPTY / NOT_FOUND) — surface it for callers.
    if (!r.ok) throw { status: r.status, code: j.code, message: j.error || j.code || r.statusText };
    return j;
  },
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  },
};

/* =========================================================
 * Transition guard
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
    case "BOX_STATUS":
      if (!s.connex) return "Create a connex first.";
      break;
    case "SEAL_DATA":
      if (!s.connex) return "No connex loaded.";
      if (!allBoxesHaveRequiredFields()) return "Every populated box needs SLOC and SHRH POC. Finish them on the Box Status page.";
      break;
    case "REVIEW_SEAL":
      if (!s.connex) return "No connex loaded.";
      break;
    case "NEXT_SITREP":
      if (!s.sessionConnexIds.length) return "Complete the current connex first.";
      break;
  }
  return null;
}

function allBoxesHaveRequiredFields() {
  if (!STATE.connex) return false;
  return STATE.connex.boxes.every(b => {
    const populated = (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length);
    if (!populated) return true;
    return b.sloc && b.shrh_poc;
  });
}

/* =========================================================
 * Navigation
 * ========================================================= */
function goTo(step) {
  const err = guardTransition(step);
  if (err) { showError("step-error", err); return; }
  hideError("step-error");
  STATE.step = step;
  renderAll();
}

window.goTo = goTo;

window._stepClick = function(step) {
  const curIdx = STEPS.indexOf(STATE.step);
  const tgtIdx = STEPS.indexOf(step);
  if (tgtIdx < curIdx) {
    STATE.step = step;
    hideError("step-error");
    renderAll();
  } else if (tgtIdx === curIdx + 1) {
    goTo(step);
  }
};

/* =========================================================
 * Master render
 * ========================================================= */
function renderAll() {
  renderStepper();
  renderBanner();
  renderStepPanel();
}

function renderStepper() {
  const ol = $("cx-stepper");
  if (!ol) return;
  const curIdx = STEPS.indexOf(STATE.step);
  ol.innerHTML = STEPS.map((s, i) => {
    const done   = i < curIdx;
    const active = i === curIdx;
    const cls    = done   ? "cx-stepper__item cx-stepper__item--done"
                 : active ? "cx-stepper__item cx-stepper__item--active"
                 :          "cx-stepper__item";
    const dot = done ? "&#10003;" : String(i + 1);
    return `<li class="${cls}" data-step="${esc(s)}" onclick="window._stepClick('${esc(s)}')">
      <span class="cx-stepper__dot">${dot}</span>
      <span class="cx-stepper__body">
        <span class="cx-stepper__label">${esc(STEP_LABELS[s].label)}</span>
        <span class="cx-stepper__sublabel">${esc(STEP_LABELS[s].sub)}</span>
      </span>
    </li>`;
  }).join("");
}

function renderBanner() {
  const el = $("cx-banner");
  if (!el) return;
  if (!STATE.profile) {
    el.innerHTML = `<span class="cx-banner__emblem">&#x1F4E6;</span>
      <span class="cx-banner__body">
        <span class="cx-banner__unit">CRATE</span>
        <span class="cx-banner__sub">No profile loaded</span>
      </span>`;
    return;
  }
  const p = STATE.profile;
  const patch = (file, alt) => file
    ? `<img src="/static/formations/${esc(file)}" alt="${esc(alt || "")}" class="cx-banner__emblem"
            width="40" height="40" style="object-fit:contain;" loading="lazy"
            onerror="this.style.display='none'">`
    : "";
  // Division SSI (when present) shown alongside the brigade SSI.
  const emblems = (p.division_image || p.brigade_image)
    ? `${patch(p.division_image, p.division)}${patch(p.brigade_image, p.brigade)}`
    : `<span class="cx-banner__emblem">&#x1F4E6;</span>`;
  el.innerHTML = `${emblems}
    <span class="cx-banner__body">
      <span class="cx-banner__unit">${esc(p.brigade || "")}</span>
      <span class="cx-banner__sub">${esc(p.battalion || "")}${p.battery ? " — " + esc(p.battery) + " BTY" : ""}</span>
    </span>`;
}

function renderStepPanel() {
  const center = $("cx-step-content");
  const right  = $("cx-right-rail-content");
  if (!center) return;
  switch (STATE.step) {
    case "PROFILE":      renderProfileStep(center, right); break;
    case "CONNEX_SETUP": renderConnexSetupStep(center, right); break;
    case "PACKING":      renderPackingStep(center, right); break;
    case "BOX_STATUS":   renderBoxStatusStep(center, right); break;
    case "SEAL_DATA":    renderSealDataStep(center, right); break;
    case "REVIEW_SEAL":  renderReviewSealStep(center, right); break;
    case "NEXT_SITREP":  renderNextSitrepStep(center, right); break;
  }
}

/* =========================================================
 * STEP 1 — PROFILE
 * ========================================================= */
function renderProfileStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel" id="profile-resume-wrap" style="display:none;margin-bottom:var(--space-4);"></div>

    <div class="cx-panel" id="profile-gallery-panel">
      <h2 class="cx-panel__title">1 &middot; Select Your Unit Insignia</h2>
      <p class="cx-field-hint">Work down the echelons: Division → Brigade → Battalion. Brigade is required; the others are optional.</p>

      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-3);">
        <button type="button" class="cx-3tier-tab cx-3tier-tab--active" data-tier="division"  onclick="switchTier('division')">Division</button>
        <button type="button" class="cx-3tier-tab"                       data-tier="brigade"   onclick="switchTier('brigade')">Brigade</button>
        <button type="button" class="cx-3tier-tab"                       data-tier="battalion" onclick="switchTier('battalion')">Battalion</button>
      </div>

      <div id="cascade-breadcrumb" style="display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-3);min-height:1.4em;"></div>

      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-4);">
        <input class="cx-field" id="gallery-search" placeholder="Search unit name…"
               style="flex:1;min-width:160px;" oninput="filterGallery()">
        <select class="cx-field" id="gallery-insignia" style="width:140px;" onchange="renderGallery()">
          <option value="SSI">SSI</option>
          <option value="DUI">DUI</option>
          <option value="All">All types</option>
        </select>
      </div>
      <div id="insignia-grid" style="
        display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));
        gap:var(--space-3);max-height:380px;overflow-y:auto;padding:var(--space-2);">
        <div class="cx-field-hint">Loading insignia…</div>
      </div>
    </div>

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
        <label class="cx-label">Battery / Company</label>
        <input class="cx-field" id="p_battery" placeholder="B">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">UIC <span class="cx-field-hint">(optional)</span></label>
        <input class="cx-field cx-field--mono" id="p_uic" placeholder="W3BX2K">
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
        <input class="cx-field" id="p_shrh" placeholder="DOE, JOHN">
      </div>
      <div id="profile-save-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
        <button class="cx-btn cx-btn--primary" onclick="saveProfile()">Save &amp; Continue</button>
        <button class="cx-btn cx-btn--ghost"   onclick="resetCascade()">Reset Selections</button>
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

async function loadProfilesAndGallery() {
  if (!STATE.formations.length) {
    try {
      const r    = await fetch("/static/formations/manifest.json");
      const data = await r.json();
      STATE.formations = data.formations || [];
    } catch (e) {
      STATE.formations = [];
    }
  }
  try {
    const data     = await api.get("/api/profiles");
    const profiles = (data.profiles || []).sort(
      (a, b) => (b.last_used || "").localeCompare(a.last_used || "")
    );
    if (profiles.length) renderResumeCard(profiles[0]);
  } catch (_) {}
  // If a brigade was already chosen this session, keep its detail panel open.
  if (STATE.selectedBrigade) showDetailPanel(STATE.selectedBrigade);
  switchTier(STATE._currentTier);
}

function renderResumeCard(p) {
  const wrap = $("profile-resume-wrap");
  if (!wrap) return;
  const imgSrc = p.brigade_image ? `/static/formations/${esc(p.brigade_image)}` : "";
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

window.resumeSavedProfile = async function(profileId) {
  try {
    const data = await api.get(`/api/profiles/${profileId}`);
    STATE.profile = data.profile;
    const p = STATE.profile;
    // Re-hydrate the cascade selections from the saved insignia filenames so a
    // resumed profile shows its full Division/Brigade/Battalion chain.
    const lookup = (file, name) => file
      ? (STATE.formations.find(f => f.file === file) || { file, name: name || file })
      : null;
    STATE.selectedBrigade      = lookup(p.brigade_image, p.brigade);
    STATE.selectedFormation    = STATE.selectedBrigade;   // legacy alias
    STATE.selectedDivision     = lookup(p.division_image, p.division);
    STATE.selectedBattalionDUI = lookup(p.battalion_image, "");
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

// Selection slot for a given tier.
function tierSelection(tier) {
  return tier === "division" ? STATE.selectedDivision
       : tier === "battalion" ? STATE.selectedBattalionDUI
       : STATE.selectedBrigade;
}

// Switch the active echelon tier: update tab styling, reset the insignia-type
// filter to that tier's default (SSI for division/brigade, DUI for battalion),
// then re-render the breadcrumb and grid.
window.switchTier = function(tier) {
  if (!TIERS[tier]) return;
  STATE._currentTier = tier;
  document.querySelectorAll(".cx-3tier-tab").forEach(b => {
    b.classList.toggle("cx-3tier-tab--active", b.dataset.tier === tier);
  });
  const sel = $("gallery-insignia");
  if (sel) sel.value = TIERS[tier].defType;
  renderCascade();
};

// Render the breadcrumb chain + the gallery grid for the current tier.
function renderCascade() {
  renderBreadcrumb();
  renderGallery();
}

function renderBreadcrumb() {
  const el = $("cascade-breadcrumb");
  if (!el) return;
  const seg = (sel, fallback) => sel
    ? `<span class="cx-crumb">${insigniaBadge(sel.insignia_type)} <span>${esc(sel.name)}</span></span>`
    : `<span class="cx-crumb" style="opacity:.45;">${fallback}</span>`;
  el.innerHTML = [
    seg(STATE.selectedDivision, "Division —"),
    seg(STATE.selectedBrigade, "Brigade —"),
    seg(STATE.selectedBattalionDUI, "Battalion —"),
  ].join(`<span style="opacity:.5;">&rsaquo;</span>`);
}

function renderGallery() {
  const grid = $("insignia-grid");
  if (!grid) return;
  const tier  = TIERS[STATE._currentTier] || TIERS.brigade;
  const query = (($("gallery-search")   || {}).value || "").trim().toLowerCase();
  const itype = (($("gallery-insignia") || {}).value || tier.defType);
  const curFile = (tierSelection(STATE._currentTier) || {}).file;
  const filtered = STATE.formations.filter(f => {
    if (!tier.echelons.includes(f.echelon)) return false;
    if (itype && itype !== "All" && (f.insignia_type || "") !== itype) return false;
    if (query && !f.name.toLowerCase().includes(query)) return false;
    return true;
  });
  if (!filtered.length) {
    grid.innerHTML = `<span class="cx-field-hint" style="grid-column:1/-1;">No ${esc(tier.label)} insignia match your filters.</span>`;
    return;
  }
  grid.innerHTML = filtered.map(f => {
    const selected = curFile && curFile === f.file;
    const badgeCls = f.is_adata ? "cx-badge cx-badge--ok" : "";
    return `
      <div class="cx-panel cx-panel--2 cx-formation-card"
           style="cursor:pointer;text-align:center;padding:var(--space-3);
                  ${selected ? "outline:2px solid var(--connex-gold);outline-offset:2px;" : ""}"
           title="${esc(f.name)}"
           onclick="selectFormation('${esc(f.file)}')">
        <img src="/static/formations/${esc(f.file)}"
             alt="${esc(f.name)}" width="72" height="72" loading="lazy"
             style="object-fit:contain;display:block;margin:0 auto var(--space-2);"
             onerror="this.style.display='none'">
        <div style="font-size:var(--text-xs);color:var(--connex-gray);
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;"
             title="${esc(f.name)}">${esc(f.name)}</div>
        <div style="margin-top:var(--space-1);">${insigniaBadge(f.insignia_type)}${badgeCls ? ` <span class="${badgeCls}" style="font-size:10px;">ADA</span>` : ""}</div>
      </div>`;
  }).join("");
}

// Debounce the search box: it fires oninput on every keystroke and the grid can
// hold hundreds of cards. Coalesce rapid keystrokes into one re-render.
let _galleryFilterTimer = null;
window.filterGallery = function() {
  clearTimeout(_galleryFilterTimer);
  _galleryFilterTimer = setTimeout(renderGallery, 175);
};

// Reveal + populate the detail panel for a chosen brigade.
function showDetailPanel(formation) {
  const panel = $("profile-detail-panel");
  if (panel) panel.style.display = "";
  const img   = $("selected-insignia-img");
  const label = $("selected-brigade-label");
  if (img)   { img.src = `/static/formations/${esc(formation.file)}`; img.alt = esc(formation.name); }
  if (label)  label.textContent = formation.name;
  const stamp = $("p_stamp");
  if (stamp && !stamp.value) {
    const match = formation.name.match(/\b\d+\w*/);
    stamp.value = match ? match[0].toUpperCase() : formation.name.split(" ")[0].toUpperCase();
  }
  return panel;
}

// Pick a patch in the current tier, store it in that tier's slot, and
// auto-advance to the next tier (Division → Brigade → Battalion).
window.selectFormation = function(file) {
  const formation = STATE.formations.find(f => f.file === file);
  if (!formation) return;
  const tier = STATE._currentTier;
  if (tier === "division") {
    STATE.selectedDivision = formation;
    switchTier("brigade");
  } else if (tier === "brigade") {
    STATE.selectedBrigade   = formation;
    STATE.selectedFormation = formation;   // legacy alias
    showDetailPanel(formation);
    switchTier("battalion");
    const panel = $("profile-detail-panel");
    panel && panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    STATE.selectedBattalionDUI = formation;
    renderCascade();
  }
  renderBanner();
};

// Clear all three tier selections and return to the division tier.
window.resetCascade = function() {
  STATE.selectedDivision     = null;
  STATE.selectedBrigade      = null;
  STATE.selectedBattalionDUI = null;
  STATE.selectedFormation    = null;
  const panel = $("profile-detail-panel");
  if (panel) panel.style.display = "none";
  switchTier("division");
};

window.saveProfile = async function() {
  if (!STATE.selectedBrigade) {
    showError("profile-save-error", "Select a brigade insignia first.");
    return;
  }
  const brigade         = STATE.selectedBrigade.name;
  const brigade_image   = STATE.selectedBrigade.file;
  const division        = STATE.selectedDivision ? STATE.selectedDivision.name : "";
  const division_image  = STATE.selectedDivision ? STATE.selectedDivision.file : "";
  const battalion_image = STATE.selectedBattalionDUI ? STATE.selectedBattalionDUI.file : "";
  const battalion     = ($("p_battalion") || {}).value || "";
  const battery       = ($("p_battery")   || {}).value || "";
  const uic           = ($("p_uic")       || {}).value || "";
  const packed_by     = ($("p_packed_by") || {}).value || "";
  const stamp_text    = ($("p_stamp")     || {}).value || "";
  const shrh_poc      = ($("p_shrh")      || {}).value || "";
  if (!battalion) { showError("profile-save-error", "Battalion is required."); return; }
  try {
    const data = await api.post("/api/profiles", {
      brigade, brigade_image, battalion, battery, uic,
      division, division_image, battalion_image,
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

/* =========================================================
 * STEP 2 — CONNEX_SETUP (no 3D)
 * ========================================================= */
function renderConnexSetupStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel">
      <h2 class="cx-panel__title">2 &middot; Connex Setup ${buildHelpPopover("CONNEX")}</h2>
      <p class="cx-field-hint">Name this container and choose how many boxes to pack into it.</p>
      <div class="cx-field-wrap">
        <label class="cx-label">Connex # ${buildHelpPopover("CONNEX #")}</label>
        <input class="cx-field cx-field--mono" id="cs_connex_no" placeholder="CONNEX-01 (optional)">
        <span class="cx-field-hint">Leave blank — a placeholder will print on the PDF.</span>
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Number of Boxes</label>
        <input class="cx-field" id="cs_box_count" type="number" min="1" max="50" value="5">
      </div>
      <div id="cs-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
        <button class="cx-btn cx-btn--primary" onclick="createConnex()">Open Connex &rarr;</button>
      </div>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      <h3 class="cx-panel__title">Tips</h3>
      <p class="cx-field-hint">Boxes are virtual — empty ones won't appear in the generated PDFs.</p>
    </div>`;
}

window.createConnex = async function() {
  const connexNo = ($("cs_connex_no")  || {}).value || "";
  const boxCount = parseInt(($("cs_box_count") || {}).value || "5", 10);
  if (!STATE.profile) { showError("cs-error", "No profile selected."); return; }
  if (isNaN(boxCount) || boxCount < 1) { showError("cs-error", "Enter a valid box count (1 or more)."); return; }
  try {
    const body = { profile_id: STATE.profile.profile_id, box_count: boxCount };
    if (connexNo) body.connex_no = connexNo;
    const data = await api.post("/api/connex", body);
    STATE.connex = data.connex;
    goTo("PACKING");
  } catch (e) {
    showError("cs-error", "Failed to create connex: " + e.message);
  }
};

/* =========================================================
 * STEP 3 — PACKING (spreadsheet assignment)
 * Center: BOM ingest + spreadsheet table + individual item form
 * Right rail: Box status cards (live updates)
 * ========================================================= */
function renderPackingStep(center, right) {
  const hasBoms  = STATE.boms.length > 0;
  const isSealed = STATE.connex && STATE.connex.status === 'sealed';
  center.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h2 class="cx-panel__title">3 &middot; Packing</h2>
      ${isSealed
        ? `<div style="background:var(--connex-gold);color:#1a1a1a;padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);font-size:var(--text-sm);font-weight:600;margin-bottom:var(--space-2);">
             🔒 SEALED — assignments are locked. Re-seal to update.
           </div>`
        : `<p class="cx-field-hint">Ingest BOM PDFs, then assign each to a box using the table below.</p>`}
    </div>

    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title cx-section-title">BOM Ingest</h3>
      <div id="bom-drop-zone"
           style="border:2px dashed var(--connex-stroke);border-radius:var(--radius-md);padding:var(--space-4);text-align:center;cursor:pointer;margin-bottom:var(--space-2);transition:border-color 0.15s;"
           ondragover="event.preventDefault();this.style.borderColor='var(--connex-gold)'"
           ondragleave="this.style.borderColor='var(--connex-stroke)'"
           ondrop="this.style.borderColor='var(--connex-stroke)';handleBomZoneDrop(event)"
           onclick="document.getElementById('bom-file-input').click()">
        <strong style="color:var(--connex-light);">Drop BOM PDFs here</strong> or click to browse<br>
        <span class="cx-field-hint">Multiple files OK. One BOM PDF per end item.</span>
        <input type="file" id="bom-file-input" accept="application/pdf" multiple style="display:none;"
               onchange="ingestBoms(this.files)">
      </div>
      <div id="ingest-status" class="cx-field-hint" style="min-height:1.2em;"></div>
    </div>

    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title cx-section-title">BOM Assignment</h3>
      ${hasBoms
        ? `<p class="cx-field-hint" style="margin-bottom:var(--space-2);">
             Assign each end item to a box. Click <strong>&#9656;</strong> to drop down its
             subitems and assign them individually.</p>
           <div style="overflow-x:auto;">
             <table class="cx-bom-table">
               <thead><tr>
                 <th></th>
                 <th>#</th>
                 <th>Nomenclature</th>
                 <th>LIN</th>
                 <th>SN</th>
                 <th>Subitems</th>
                 <th>Assign to Box</th>
                 <th></th>
               </tr></thead>
               <tbody id="bom-table-body">${renderBomTableRows()}</tbody>
             </table>
           </div>`
        : '<p class="cx-field-hint">Ingest BOM PDFs above to populate this table.</p>'
      }
    </div>

    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title cx-section-title">Individual Item</h3>
      <p class="cx-field-hint">Add a loose item directly to a box (not from a BOM).</p>
      <div class="cx-field-wrap">
        <label class="cx-label">Description</label>
        <input class="cx-field" id="ind_desc" placeholder="Carrying case">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);">
        <div class="cx-field-wrap">
          <label class="cx-label"><span class="cx-label-tag">SN</span> Serial Number</label>
          <input class="cx-field cx-field--mono" id="ind_sn" placeholder="">
        </div>
        <div class="cx-field-wrap">
          <label class="cx-label"><span class="cx-label-tag">NSN</span> ${buildHelpPopover("NSN")}</label>
          <input class="cx-field cx-field--mono" id="ind_nsn" placeholder="1005-01-231-0973">
        </div>
        <div class="cx-field-wrap">
          <label class="cx-label"><span class="cx-label-tag">LIN</span> ${buildHelpPopover("LIN")}</label>
          <input class="cx-field cx-field--mono" id="ind_lin" placeholder="M39331">
        </div>
        <div class="cx-field-wrap">
          <label class="cx-label">Assign to Box</label>
          <select class="cx-field" id="ind_box_num">
            ${individualBoxOptions()}
          </select>
        </div>
      </div>
      <div id="ind-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
      <button class="cx-btn cx-btn--ghost cx-btn--sm" style="margin-top:var(--space-2);"
              onclick="addIndividualItemToBox()">+ Add to Box</button>
    </div>

    <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
      <button class="cx-btn cx-btn--primary" onclick="goTo('BOX_STATUS')">Box Status &rarr;</button>
    </div>
    <div id="packing-advance-error" role="alert" class="cx-field-error-msg" style="display:none;margin-top:var(--space-2);"></div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title">Box Contents</h3>
      <p class="cx-field-hint" style="margin-bottom:var(--space-2);">Label boxes and add SLOC / SHRH POC on the next page.</p>
      <div id="packing-boxes">${renderBoxSummaryCards()}</div>
    </div>
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title">Progress</h3>
      <div id="packing-progress">${renderPackingProgress()}</div>
    </div>
    <div class="cx-panel">
      <h3 class="cx-panel__title">Session</h3>
      <p class="cx-field-hint" style="margin-bottom:var(--space-2);">Save your work and reload it in a future session.</p>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
        <button class="cx-btn cx-btn--ghost" style="flex:1;" onclick="saveSession()">Save Session</button>
        <label class="cx-btn cx-btn--ghost" style="flex:1;text-align:center;cursor:pointer;">
          Load Session<input type="file" accept=".json" style="display:none;" onchange="loadSession(event)">
        </label>
      </div>
      <div id="session-status" class="cx-field-hint" style="min-height:1.2em;margin-top:var(--space-2);"></div>
      <div id="session-error" role="alert" class="cx-field-error-msg" style="display:none;margin-top:var(--space-2);"></div>
    </div>`;
}

function renderBomTableRows() {
  if (!STATE.connex) return '';
  const isSealed = STATE.connex.status === 'sealed';
  return STATE.boms.map((bom, idx) => {
    const assignedBox = bomAssignedBox(bom);
    const boxOptions = [
      `<option value="">— Unassigned —</option>`,
      ...STATE.connex.boxes.map(b =>
        `<option value="${b.box_num}" ${assignedBox === b.box_num ? 'selected' : ''}>Box ${b.box_num}</option>`)
    ].join('');
    const lin = bom.lin || '';
    const sn  = bom.serial_number || '';
    const items = bom.items || [];
    const expander = items.length
      ? `<button class="cx-bom-expander" aria-label="Show subitems"
                 onclick="toggleBomItems('${esc(bom.bom_id)}')"
                 id="exp-${esc(bom.bom_id)}"
                 style="background:none;border:none;color:var(--connex-gold);cursor:pointer;font-size:0.9rem;padding:0 4px;">&#9656;</button>`
      : '';
    const assignCell = isSealed
      ? `<span style="color:var(--connex-gray);font-size:var(--text-xs);">🔒 Box ${assignedBox || '—'}</span>`
      : `<select class="cx-field" style="min-width:120px;padding:4px 6px;font-size:var(--text-xs);"
                onchange="assignBomToBoxFromSelect('${esc(bom.bom_id)}', this.value)">
          ${boxOptions}
        </select>`;
    const replaceCell = isSealed
      ? `<span style="color:var(--connex-gray);font-size:var(--text-xs);">🔒</span>`
      : `<label title="Replace BOM file" style="cursor:pointer;color:var(--connex-gold);font-size:var(--text-xs);white-space:nowrap;">
          ↺ Replace
          <input type="file" accept=".pdf" style="display:none;"
                 onchange="replaceBom('${esc(bom.bom_id)}', event)">
        </label>
        <div id="replace-status-${esc(bom.bom_id)}" class="cx-field-hint" style="display:inline;margin-left:4px;"></div>`;
    return `<tr>
      <td style="text-align:center;width:24px;">${expander}</td>
      <td style="color:var(--connex-gray);font-size:var(--text-xs);">${idx + 1}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(bom.nomenclature || bom.filename)}">${esc(bom.nomenclature || bom.filename)}</td>
      <td class="cx-mono"><span class="cx-label-tag">LIN</span>${esc(lin || '—')}</td>
      <td class="cx-mono" style="min-width:130px;">
        <span class="cx-label-tag">SN</span>
        <input class="cx-field cx-field--mono" style="display:inline;width:110px;padding:2px 4px;font-size:var(--text-xs);vertical-align:middle;"
               value="${esc(sn)}" placeholder="—" ${isSealed ? 'disabled' : ''}
               onblur="saveBomSerial('${esc(bom.bom_id)}', this.value)"
               onclick="event.stopPropagation()">
      </td>
      <td style="text-align:center;">${esc(String(bom.item_count || items.length || 0))}</td>
      <td>${assignCell}</td>
      <td style="text-align:center;">${replaceCell}</td>
    </tr>
    <tr id="items-${esc(bom.bom_id)}" style="display:${STATE.openBoms[bom.bom_id] ? '' : 'none'};">
      <td></td>
      <td colspan="6" style="padding:0;">
        ${renderBomItemRows(bom)}
      </td>
    </tr>`;
  }).join('');
}

/* Drill-down: subitems of one BOM, each independently assignable to a box. */
function renderBomItemRows(bom) {
  const items = bom.items || [];
  if (!items.length) return '<div class="cx-field-hint" style="padding:var(--space-2);">No subitems.</div>';
  const boxesFor = (key) => {
    const cur = STATE.itemBoxMap[key];
    return [
      `<option value="">— Unassigned —</option>`,
      ...((STATE.connex && STATE.connex.boxes) || []).map(b =>
        `<option value="${b.box_num}" ${cur === b.box_num ? 'selected' : ''}>Box ${b.box_num}</option>`)
    ].join('');
  };
  const rows = items.map(it => {
    const key = `${bom.bom_id}:${it.line_no}`;
    return `<tr>
      <td style="text-align:center;color:var(--connex-gray);">${esc(String(it.line_no))}</td>
      <td>${esc(it.description || '—')}</td>
      <td class="cx-mono" style="font-size:var(--text-xs);">${esc(it.nsn || '—')}</td>
      <td style="text-align:center;">${esc(String(it.qty != null ? it.qty : ''))} ${esc(it.unit_of_issue || '')}</td>
      <td>
        <select class="cx-field" style="min-width:110px;padding:3px 6px;font-size:var(--text-xs);"
                onchange="assignItemToBox('${esc(key)}', this.value)">
          ${boxesFor(key)}
        </select>
      </td>
    </tr>`;
  }).join('');
  return `<table class="cx-bom-table" style="margin:0;background:rgba(255,255,255,0.015);">
    <thead><tr>
      <th style="width:40px;">Line</th><th>Description</th><th>NSN</th><th>Qty</th><th>Assign to Box</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

window.toggleBomItems = function(bomId) {
  const row = document.getElementById(`items-${bomId}`);
  const btn = document.getElementById(`exp-${bomId}`);
  if (!row) return;
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : '';
  if (open) delete STATE.openBoms[bomId]; else STATE.openBoms[bomId] = true;
  if (btn) btn.innerHTML = open ? '&#9656;' : '&#9662;';
};

window.assignItemToBox = async function(itemKey, rawBoxNum) {
  if (!STATE.connex) return;
  const move = rawBoxNum
    ? { item_key: itemKey, box_num: parseInt(rawBoxNum, 10) }
    : null;
  if (!move) return;  // "— Unassigned —" is a no-op for individual subitems
  try {
    const data = await api.post(`/api/connex/${STATE.connex.connex_id}/assign`, { moves: [move] });
    STATE.connex = data.connex;
    if (data.item_box_map) STATE.itemBoxMap = data.item_box_map;
    refreshPackingView();
  } catch (e) {
    showError("packing-advance-error", "Item assign failed: " + e.message);
  }
};

/* Box content/status helpers shared by the summary + status cards. */
function boxBomNames(b) {
  return (b.bom_ids || []).map(bid => {
    const bom = STATE.boms.find(bm => bm.bom_id === bid);
    return bom ? (bom.nomenclature || bom.filename || bid.slice(0,8)).slice(0,30) : bid.slice(0,8);
  });
}
function boxBadge(b) {
  const populated = (b.bom_ids || []).length > 0 || (b.individual_items || []).length > 0;
  if (!populated)                  return ["cx-badge cx-badge--empty", "Empty"];
  if (b.complete)                  return ["cx-badge cx-badge--ok",    "Ready"];
  if (!b.sloc || !b.shrh_poc)      return ["cx-badge cx-badge--warn",  "Needs SLOC/POC"];
  return ["cx-badge cx-badge--warn", "Incomplete"];
}
function boxContentLines(b) {
  const indCount = (b.individual_items || []).length;
  return [
    ...boxBomNames(b).map(n => `<div style="font-size:var(--text-xs);color:var(--connex-light);padding:2px 0;border-bottom:1px solid var(--connex-stroke);">${esc(n)}</div>`),
    ...(indCount > 0 ? [`<div style="font-size:var(--text-xs);color:var(--connex-gray);">+ ${indCount} individual item(s)</div>`] : []),
  ].join('') || `<div class="cx-field-hint" style="font-size:var(--text-xs);">No items assigned</div>`;
}

/* Box list for the Packing page right rail. Editable during packing:
   each card carries a remove (×) control, and an "+ Add Box" button is
   appended below. Both are suppressed once the connex is sealed. */
function renderBoxSummaryCards() {
  if (!STATE.connex) return '<span class="cx-field-hint">No connex loaded.</span>';
  const isSealed = STATE.connex.status === 'sealed';
  const cards = STATE.connex.boxes.map(b => {
    const [badgeCls, badgeText] = boxBadge(b);
    const title = b.label ? esc(b.label) : `Box ${b.box_num}`;
    const removeBtn = isSealed
      ? ''
      : `<button class="cx-box-remove" title="Remove Box ${b.box_num}"
                 aria-label="Remove Box ${b.box_num}"
                 onclick="removeBox(${b.box_num})">&times;</button>`;
    return `<div class="cx-panel cx-panel--2" style="margin-bottom:var(--space-2);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);margin-bottom:var(--space-2);">
        <strong style="color:var(--connex-light);">Box ${b.box_num}${b.label ? ` — ${title}` : ""}</strong>
        <span style="display:inline-flex;align-items:center;gap:var(--space-2);">
          <span class="${badgeCls}">${badgeText}</span>
          ${removeBtn}
        </span>
      </div>
      <div>${boxContentLines(b)}</div>
    </div>`;
  }).join('');
  const addBtn = isSealed
    ? ''
    : `<button class="cx-btn cx-btn--ghost cx-btn--sm" style="width:100%;margin-top:var(--space-1);"
               onclick="addBox()">+ Add Box</button>`;
  return cards + addBtn;
}

/* Add a box to the open connex. The add endpoint returns the connex object
   directly (200 → connex). Resync state + re-render so the new box appears in
   every "Assign to Box" dropdown. */
window.addBox = async function() {
  if (!STATE.connex) return;
  try {
    const resp = await api.post(`/api/connex/${STATE.connex.connex_id}/boxes`, {});
    // add returns the connex directly; tolerate a {connex} wrapper too
    STATE.connex = resp.connex || resp;
    refreshPackingView();
  } catch (e) {
    if (e.status === 409) {
      showError("packing-advance-error", "Connex is sealed — re-seal to change boxes.");
    } else {
      showError("packing-advance-error", "Add box failed: " + e.message);
    }
  }
};

/* Remove a box from the open connex. An empty box deletes cleanly; a populated
   box 409s with BOX_NOT_EMPTY unless ?force=1 — so we confirm first, then
   force. The delete endpoint returns {ok, connex}. Box numbers are NOT
   renumbered server-side, so dropdowns stay stable. */
window.removeBox = async function(boxNum) {
  if (!STATE.connex) return;
  const box = STATE.connex.boxes.find(b => b.box_num === boxNum);
  const hasItems = box && ((box.bom_ids && box.bom_ids.length) || (box.individual_items && box.individual_items.length));
  let force = false;
  if (hasItems) {
    if (!confirm(`Box ${boxNum} has items — remove anyway? Its assignments will be cleared.`)) return;
    force = true;
  }
  const url = `/api/connex/${STATE.connex.connex_id}/boxes/${boxNum}${force ? "?force=1" : ""}`;
  try {
    const resp = await api.del(url);
    // delete returns {ok, connex}; tolerate a bare connex too
    STATE.connex = resp.connex || resp;
    refreshPackingView();
  } catch (e) {
    if (e.code === "BOX_NOT_EMPTY") {
      // Race: box gained items since render (or we sent a non-force DELETE).
      // Re-confirm and force.
      if (confirm(`Box ${boxNum} is not empty — remove anyway?`)) {
        try {
          const resp = await api.del(`/api/connex/${STATE.connex.connex_id}/boxes/${boxNum}?force=1`);
          STATE.connex = resp.connex || resp;
          refreshPackingView();
        } catch (e2) {
          showError("packing-advance-error", "Remove box failed: " + e2.message);
        }
      }
    } else if (e.code === "SEALED") {
      showError("packing-advance-error", "Connex is sealed — re-seal to change boxes.");
    } else if (e.code === "NOT_FOUND" || e.status === 404) {
      // Already gone — just resync the view.
      refreshPackingView();
    } else {
      showError("packing-advance-error", "Remove box failed: " + e.message);
    }
  }
};

/* Editable box cards for the Box Status page: custom label + SLOC + SHRH POC. */
function renderBoxStatusCards() {
  if (!STATE.connex) return '<span class="cx-field-hint">No connex loaded.</span>';
  return STATE.connex.boxes.map(b => {
    const [badgeCls, badgeText] = boxBadge(b);
    return `<div class="cx-panel cx-panel--2" style="margin-bottom:var(--space-2);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2);">
        <strong style="color:var(--connex-light);">Box ${b.box_num}</strong>
        <span class="${badgeCls}" id="box-badge-${b.box_num}">${badgeText}</span>
      </div>
      <div style="margin-bottom:var(--space-2);">${boxContentLines(b)}</div>
      <div class="cx-field-wrap" style="margin-bottom:var(--space-2);">
        <label class="cx-label" style="font-size:10px;">Custom Label <span class="cx-field-hint">(e.g. "Launcher BII", "Commo Equipment")</span></label>
        <input class="cx-field" style="font-size:var(--text-xs);padding:4px 6px;"
               id="label-${b.box_num}" value="${esc(b.label || "")}" placeholder="Launcher BII"
               onblur="saveBoxField(${b.box_num},'label',this.value)">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-1);">
        <div>
          <label class="cx-label" style="font-size:10px;">SLOC ${buildHelpPopover("SLOC")}</label>
          <input class="cx-field cx-field--mono" style="font-size:var(--text-xs);padding:4px 6px;"
                 id="sloc-${b.box_num}" value="${esc(b.sloc || "")}" placeholder="BLDG-100"
                 onblur="saveBoxField(${b.box_num},'sloc',this.value)">
        </div>
        <div>
          <label class="cx-label" style="font-size:10px;">SHRH POC ${buildHelpPopover("SHRH POC")}</label>
          <input class="cx-field" style="font-size:var(--text-xs);padding:4px 6px;"
                 id="shrh-${b.box_num}" value="${esc(b.shrh_poc || "")}" placeholder="DOE, JOHN"
                 onblur="saveBoxField(${b.box_num},'shrh_poc',this.value)">
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderPackingProgress() {
  if (!STATE.connex) return "";
  const boxes     = STATE.connex.boxes;
  const complete  = boxes.filter(b => b.complete).length;
  const populated = boxes.filter(b => (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length)).length;
  const assigned  = STATE.boms.filter(bom => bomAssignedBox(bom) !== null).length;
  return `<div class="cx-field-hint">${complete} of ${populated} populated boxes complete</div>
    <div class="cx-field-hint">${assigned} of ${STATE.boms.length} BOMs assigned</div>`;
}

/* Drop zone for file ingest (still supported via drag-onto-zone, not onto box cards) */
window.handleBomZoneDrop = function(event) {
  event.preventDefault();
  if (event.dataTransfer.files.length) ingestBoms(event.dataTransfer.files);
};

/* New: assign from dropdown select */
window.assignBomToBoxFromSelect = async function(bomId, rawBoxNum) {
  if (!STATE.connex) return;
  if (!rawBoxNum) {
    try {
      const data = await api.post(`/api/connex/${STATE.connex.connex_id}/assign`, {
        moves: [{ bom_id: bomId, exclude: true }],
      });
      STATE.connex = data.connex;
      if (data.item_box_map) STATE.itemBoxMap = data.item_box_map;
      refreshPackingView();
    } catch (e) { console.error('Unassign failed:', e.message); }
    return;
  }
  const boxNum = parseInt(rawBoxNum, 10);
  await assignBomToBox(bomId, boxNum);
};

async function assignBomToBox(bomId, boxNum) {
  if (!STATE.connex) return;
  try {
    const data = await api.post(`/api/connex/${STATE.connex.connex_id}/assign`, {
      moves: [{ bom_id: bomId, box_num: boxNum }],
    });
    STATE.connex = data.connex;
    if (data.item_box_map) STATE.itemBoxMap = data.item_box_map;
    refreshPackingView();
  } catch (e) {
    showError("packing-advance-error", "Assign failed: " + e.message);
  }
}

window.unassignBom = async function(bomId) {
  if (!STATE.connex) return;
  try {
    const data = await api.post(`/api/connex/${STATE.connex.connex_id}/assign`, {
      moves: [{ bom_id: bomId, exclude: true }],
    });
    STATE.connex = data.connex;
    if (data.item_box_map) STATE.itemBoxMap = data.item_box_map;
    refreshPackingView();
  } catch (e) {
    console.error("Unassign failed:", e.message);
  }
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
    // Don't auto-assign — user assigns manually via the table
    STATE.boms = STATE.boms.map(b => ({ ...b, box_num: null }));
    STATE.itemBoxMap = {};
    STATE.openBoms   = {};
    if (status) status.textContent = `Extracted ${STATE.boms.length} BOM(s). Assign each to a box below.`;
    if (STATE.connex) {
      await api.post(`/api/connex/${STATE.connex.connex_id}/attach`, { ingest_job_id: data.job_id });
    }
    // Re-render the full packing step so the table appears
    renderPackingStep($("cx-step-content"), $("cx-right-rail-content"));
  } catch (e) {
    if (status) status.textContent = "Ingest failed: " + e.message;
  }
};

window.addIndividualItemToBox = async function() {
  const description = ($("ind_desc")    || {}).value || "";
  const sn          = ($("ind_sn")      || {}).value || "";
  const nsn         = ($("ind_nsn")     || {}).value || "";
  const lin         = ($("ind_lin")     || {}).value || "";
  const boxNum      = parseInt(($("ind_box_num") || {}).value || "1", 10);
  if (!description) { showError("ind-error", "Description is required."); return; }
  if (!STATE.connex) return;
  const box = STATE.connex.boxes.find(b => b.box_num === boxNum);
  if (!box) return;
  if (!box.individual_items) box.individual_items = [];
  box.individual_items.push({ description, sn, nsn, lin });
  try {
    const updatedBoxes = STATE.connex.boxes.map(b =>
      b.box_num === boxNum
        ? { box_num: b.box_num, individual_items: b.individual_items }
        : { box_num: b.box_num }
    );
    const data = await api.put(`/api/connex/${STATE.connex.connex_id}`, { boxes: updatedBoxes });
    STATE.connex = data.connex;
    hideError("ind-error");
    ["ind_desc","ind_sn","ind_nsn","ind_lin"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    refreshPackingView();
  } catch (e) {
    showError("ind-error", "Save failed: " + e.message);
  }
};

window.removeIndividualFromBox = async function(boxNum, idx) {
  if (!STATE.connex) return;
  const box = STATE.connex.boxes.find(b => b.box_num === boxNum);
  if (!box || !box.individual_items) return;
  box.individual_items.splice(idx, 1);
  try {
    const updatedBoxes = STATE.connex.boxes.map(b =>
      b.box_num === boxNum
        ? { box_num: b.box_num, individual_items: b.individual_items }
        : { box_num: b.box_num }
    );
    const data = await api.put(`/api/connex/${STATE.connex.connex_id}`, { boxes: updatedBoxes });
    STATE.connex = data.connex;
    refreshPackingView();
  } catch (e) {
    console.error("Remove individual item failed:", e.message);
  }
};

window.saveBomSerial = async function(bomId, value) {
  const bom = STATE.boms.find(b => b.bom_id === bomId);
  if (!bom) return;
  const trimmed = value.trim();
  if (bom.serial_number === trimmed) return;  // no change
  bom.serial_number = trimmed;
  if (STATE.job_id) {
    try {
      await api.patch(`/api/job/${STATE.job_id}/bom/${bomId}`, { serial_number: trimmed });
    } catch (e) {
      console.error("saveBomSerial failed:", e.message);
    }
  }
  // Refresh audit flags only — no full re-render needed
  const audit = $("boxstatus-audit");
  if (audit) audit.innerHTML = renderAuditFlagsHtml();
};

window.saveBoxField = async function(boxNum, field, value) {
  if (!STATE.connex) return;
  const box = STATE.connex.boxes.find(b => b.box_num === boxNum);
  if (!box) return;
  box[field] = value;
  try {
    const patchBox = { box_num: boxNum };
    patchBox[field] = value;
    const updatedBoxes = STATE.connex.boxes.map(b =>
      b.box_num === boxNum ? patchBox : { box_num: b.box_num }
    );
    const data = await api.put(`/api/connex/${STATE.connex.connex_id}`, { boxes: updatedBoxes });
    STATE.connex = data.connex;
    // Surgical update — never re-create input elements (that kills focus mid-typing).
    // Update only the badge for this box, the audit flags, and progress counters.
    const updatedBox = STATE.connex.boxes.find(b => b.box_num === boxNum);
    const badge = $(`box-badge-${boxNum}`);
    if (badge && updatedBox) {
      const [cls, text] = boxBadge(updatedBox);
      badge.className = cls;
      badge.textContent = text;
    }
    const audit = $("boxstatus-audit");
    if (audit) audit.innerHTML = renderAuditFlagsHtml();
    const progress = $("boxstatus-progress");
    if (progress) progress.innerHTML = renderPackingProgress();
    // Keep the packing-page read-only summary in sync if it's mounted.
    const summary = $("packing-boxes");
    if (summary) summary.innerHTML = renderBoxSummaryCards();
    const prog = $("packing-progress");
    if (prog) prog.innerHTML = renderPackingProgress();
  } catch (e) {
    console.error("saveBoxField failed:", e.message);
  }
};

function bomAssignedBox(bom) {
  if (!STATE.connex) return null;
  for (const box of STATE.connex.boxes) {
    if (box.bom_ids && box.bom_ids.includes(bom.bom_id)) return box.box_num;
  }
  return null;
}

/* <option> list for the individual-item box picker. Shared by the initial
   render and refreshPackingView so it stays in sync after add/remove box. */
function individualBoxOptions() {
  if (!STATE.connex) return "";
  return STATE.connex.boxes
    .map(b => `<option value="${b.box_num}">Box ${b.box_num}</option>`)
    .join("");
}

function refreshPackingView() {
  const tbody = $("bom-table-body");
  if (tbody && STATE.boms.length) tbody.innerHTML = renderBomTableRows();
  const boxes = $("packing-boxes");
  if (boxes) boxes.innerHTML = renderBoxSummaryCards();
  const prog = $("packing-progress");
  if (prog) prog.innerHTML = renderPackingProgress();
  // Keep the individual-item box picker in sync with the live box list
  // (it lives in the center panel and isn't part of the table rebuild).
  const indSel = $("ind_box_num");
  if (indSel) {
    const prev = indSel.value;
    indSel.innerHTML = individualBoxOptions();
    // Preserve selection if that box still exists; else fall back to first.
    if (prev && STATE.connex && STATE.connex.boxes.some(b => String(b.box_num) === prev)) {
      indSel.value = prev;
    }
  }
}

/* Re-render the Box Status page in place (cards + audit + progress). */
function refreshBoxStatusView() {
  const cards = $("boxstatus-cards");
  if (cards) cards.innerHTML = renderBoxStatusCards();
  const audit = $("boxstatus-audit");
  if (audit) audit.innerHTML = renderAuditFlagsHtml();
  const prog = $("boxstatus-progress");
  if (prog) prog.innerHTML = renderPackingProgress();
}

/* =========================================================
 * Audit flags — computed once, shown on Box Status + Review.
 * ========================================================= */
function computeAuditFlags() {
  const flags = [];
  const boxes   = (STATE.connex && STATE.connex.boxes) || [];
  const allBoms = STATE.boms || [];

  const bomsNoLin = allBoms.filter(b => !b.lin);
  if (bomsNoLin.length) flags.push({ type: "warn", msg: `${bomsNoLin.length} BOM(s) have no LIN — verify before sealing.`, action: "go-packing" });

  const bomsNoSn = allBoms.filter(b => !b.serial_number);
  if (bomsNoSn.length) flags.push({ type: "warn", msg: `${bomsNoSn.length} BOM(s) have no Serial Number.`, action: "go-packing" });

  const unassigned = allBoms.filter(b => !bomAssignedBox(b));
  if (unassigned.length) flags.push({ type: "error", msg: `${unassigned.length} BOM(s) are not assigned to any box.`, action: "go-packing" });

  const populated = boxes.filter(b => (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length));
  const emptyBoxes = boxes.filter(b => !(b.bom_ids && b.bom_ids.length) && !(b.individual_items && b.individual_items.length));
  if (emptyBoxes.length) flags.push({ type: "error", msg: `Box(es) ${emptyBoxes.map(b => b.box_num).join(", ")} are empty — assign items or reduce box count.`, action: "focus-box", box: emptyBoxes[0].box_num });

  populated.forEach(b => {
    if (!b.sloc)     flags.push({ type: "warn", msg: `Box ${b.box_num}: missing SLOC.`,     action: "focus-sloc", box: b.box_num });
    if (!b.shrh_poc) flags.push({ type: "warn", msg: `Box ${b.box_num}: missing SHRH POC.`, action: "focus-shrh", box: b.box_num });
  });

  if (!flags.length) flags.push({ type: "ok", msg: "All checks passed — connex is ready to seal." });
  return flags;
}

function renderAuditFlagsHtml() {
  return computeAuditFlags().map(f => {
    if (f.action) {
      return `<button class="cx-flag cx-flag--${f.type}" style="cursor:pointer;text-align:left;width:100%;background:none;border:none;padding:0;" onclick="navigateToAuditTarget('${f.action}',${f.box || 0})">${esc(f.msg)} &#8594;</button>`;
    }
    return `<div class="cx-flag cx-flag--${f.type}">${esc(f.msg)}</div>`;
  }).join('');
}

/* =========================================================
 * STEP — BOX_STATUS (label, organize, SLOC/POC, audit)
 * ========================================================= */
function renderBoxStatusStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h2 class="cx-panel__title">4 &middot; Box Status</h2>
      <p class="cx-field-hint">Label and organize each box, apply its SLOC and SHRH POC, and review the audit before sealing.</p>
    </div>

    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title cx-section-title">Audit</h3>
      <div id="boxstatus-audit" style="margin-top:var(--space-2);">${renderAuditFlagsHtml()}</div>
    </div>

    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title cx-section-title">Boxes</h3>
      <div id="boxstatus-cards" style="margin-top:var(--space-2);">${renderBoxStatusCards()}</div>
    </div>

    <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
      <button class="cx-btn cx-btn--ghost"   onclick="goTo('PACKING')">&larr; Packing</button>
      <button class="cx-btn cx-btn--primary" onclick="goTo('SEAL_DATA')">Seal Data &rarr;</button>
    </div>
    <div id="boxstatus-advance-error" role="alert" class="cx-field-error-msg" style="display:none;margin-top:var(--space-2);"></div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title">Progress</h3>
      <div id="boxstatus-progress">${renderPackingProgress()}</div>
    </div>
    <div class="cx-panel">
      <h3 class="cx-panel__title">What goes here</h3>
      <p class="cx-field-hint">Give each box a custom label (e.g. "Launcher BII", "Commo Equipment"),
        set where it's stored (SLOC) and who's accountable (SHRH POC). Resolve audit errors before sealing.</p>
    </div>`;
}

/* =========================================================
 * STEP 5 — SEAL_DATA
 * ========================================================= */
function renderSealDataStep(center, right) {
  const c = STATE.connex || {};
  center.innerHTML = `
    <div class="cx-panel">
      <h2 class="cx-panel__title">5 &middot; Seal Data</h2>
      <p class="cx-field-hint">Enter identifiers. SUN, Connex Serial Number, and SEAL # may be left blank — a placeholder prints on the PDF.</p>
      <div class="cx-field-wrap">
        <label class="cx-label">SUN # ${buildHelpPopover("SUN #")}</label>
        <input class="cx-field cx-field--mono" id="sd_sun" value="${esc(c.sun || "")}" placeholder="SUN-2026-001 (optional)">
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Connex Serial Number ${buildHelpPopover("CONNEX SERIAL NUMBER")}</label>
        <input class="cx-field cx-field--mono" id="sd_connex_no" value="${esc(c.connex_no || "")}" placeholder="CONNEX-01 (optional)">
        <span class="cx-field-hint">Pre-filled from setup. Update if the number changed.</span>
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
        <label class="cx-label">Signed By <span class="cx-field-hint"> — must differ from Packed By</span></label>
        <input class="cx-field" id="sd_signed_by" value="${esc(c.signed_by || "")}" placeholder="CPT HOLLAND">
        <div id="sd-signer-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
      </div>
      <div class="cx-field-wrap">
        <label class="cx-label">Date</label>
        <input class="cx-field" id="sd_date" value="${esc(c.date || todayLabel())}" placeholder="17 JUN 2026">
      </div>
      <div id="seal-errors" class="cx-error-list" style="display:none;margin-top:var(--space-4);"></div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
        <button class="cx-btn cx-btn--primary" onclick="submitSeal()">Seal Connex &rarr;</button>
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

window.saveSealDraft = async function() { await patchSealFields(); };

window.submitSeal = async function() {
  await patchSealFields();
  if (!STATE.connex) return;
  try {
    const data = await api.post(`/api/connex/${STATE.connex.connex_id}/seal`, {});
    if (data.ok) {
      STATE.connex = data.connex;
      STATE.sessionConnexIds.push(STATE.connex.connex_id);
      goTo("REVIEW_SEAL");
    } else {
      renderSealErrors(data.errors || []);
    }
  } catch (e) {
    renderSealErrors([e.message]);
  }
};

async function patchSealFields() {
  if (!STATE.connex) return;
  const sun      = ($("sd_sun")        || {}).value || "";
  const connexNo = ($("sd_connex_no")  || {}).value || "";
  const sealNo   = ($("sd_seal_no")    || {}).value || "";
  const packedBy = ($("sd_packed_by")  || {}).value || "";
  const signedBy = ($("sd_signed_by")  || {}).value || "";
  const date     = ($("sd_date")       || {}).value || "";
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

function renderSealErrors(errors) {
  const el = $("seal-errors");
  if (!el) return;
  if (!errors || !errors.length) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "";
  el.innerHTML = `<ul>` + errors.map(e => `<li class="cx-error-list__item">${esc(e)}</li>`).join("") + `</ul>`;
  const fieldMap = {
    "NO_SIGNER":        "sd_signed_by",
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
 * STEP 6 — REVIEW_SEAL
 * Audit flags + box checklist (no 3D)
 * ========================================================= */
function renderReviewSealStep(center, right) {
  const boxes     = (STATE.connex && STATE.connex.boxes) || [];
  const allBoms   = STATE.boms || [];

  const flagsHtml = renderAuditFlagsHtml();

  const checkRows = boxes.map(b => {
    const hasContent = (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length);
    const itemCount = (b.bom_ids || []).length + (b.individual_items || []).length;
    const bomNomenclature = (b.bom_ids || []).map(bid => {
      const bom = allBoms.find(bm => bm.bom_id === bid);
      return bom ? (bom.nomenclature || bom.filename || bid.slice(0,8)) : bid.slice(0,8);
    }).join('; ') || (hasContent ? 'individual items' : '—');
    let statusBadge;
    if (!hasContent)      statusBadge = `<span class="cx-badge cx-badge--empty">Empty</span>`;
    else if (b.complete)  statusBadge = `<span class="cx-badge cx-badge--ok">Ready</span>`;
    else                  statusBadge = `<span class="cx-badge cx-badge--warn">Incomplete</span>`;
    return `<tr>
      <td style="font-weight:600;">Box ${b.box_num}${b.label ? `<br><span class="cx-field-hint" style="font-weight:400;">${esc(b.label)}</span>` : ""}</td>
      <td class="cx-mono" style="font-size:var(--text-xs);">${esc(b.sloc || "—")}</td>
      <td style="font-size:var(--text-xs);">${esc(b.shrh_poc || "—")}</td>
      <td style="font-size:var(--text-xs);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(bomNomenclature)}">${esc(bomNomenclature)}</td>
      <td style="text-align:center;">${itemCount}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  center.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h2 class="cx-panel__title">6 &middot; Review &amp; Seal</h2>
      <p class="cx-field-hint">Audit your connex before sealing. Resolve all errors; warnings are advisory.</p>
    </div>

    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title cx-section-title">Audit Flags</h3>
      <div style="margin-top:var(--space-2);">${flagsHtml}</div>
    </div>

    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title cx-section-title">Box Manifest</h3>
      <div style="overflow-x:auto;">
        <table class="cx-bom-table">
          <thead><tr>
            <th>Box</th>
            <th>SLOC</th>
            <th>SHRH POC</th>
            <th>Contents</th>
            <th>#</th>
            <th>Status</th>
          </tr></thead>
          <tbody>${checkRows || '<tr><td colspan="6" class="cx-field-hint" style="padding:var(--space-2);">No boxes configured.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  const _railPatch = (file) => file
    ? `<img src="/static/formations/${esc(file)}" alt="" width="72" height="72"
            style="object-fit:contain;" onerror="this.style.display='none'">`
    : "";
  if (right) right.innerHTML = `
    <div class="cx-panel">
      ${STATE.profile && (STATE.profile.division_image || STATE.profile.brigade_image) ? `
        <div style="display:flex;justify-content:center;gap:var(--space-3);margin:0 auto var(--space-4);">
          ${_railPatch(STATE.profile.division_image)}
          ${_railPatch(STATE.profile.brigade_image)}
        </div>` : ""}
      <div class="cx-stamp cx-stamp--rotated" style="margin:0 auto var(--space-4);width:fit-content;">
        ${esc((STATE.profile && STATE.profile.stamp_text) || "UNIT")}
      </div>
      <div id="review-generate-status" class="cx-field-hint" style="min-height:1.2em;"></div>
      <div id="review-generate-error" role="alert" class="cx-field-error-msg" style="display:none;margin-bottom:var(--space-2);"></div>
      <button class="cx-btn cx-btn--primary" style="width:100%;" onclick="applyStampAndGenerate()">
        Apply Stamp &amp; Seal → Download
      </button>
    </div>
    <div class="cx-panel" style="margin-top:var(--space-3);">
      <p class="cx-field-hint">
        Connex: <span class="cx-mono">${esc((STATE.connex && STATE.connex.connex_no) || "[CONNEX PENDING]")}</span><br>
        SUN: <span class="cx-mono">${esc((STATE.connex && STATE.connex.sun) || "[SUN PENDING]")}</span><br>
        SEAL: <span class="cx-mono">${esc((STATE.connex && STATE.connex.seal_no) || "[SEAL PENDING]")}</span>
      </p>
    </div>`;
}

/* Play the connex-closing seal animation as a full-screen overlay.
 * Runs the API call concurrently — animation and download race in parallel. */
window.applyStampAndGenerate = async function() {
  if (!STATE.connex) return;
  const uiStatus = $("review-generate-status");
  if (uiStatus) uiStatus.textContent = "Sealing connex & generating DD1750s…";

  // Seal + generate the ZIP directly. The browser's own save-file dialog is the
  // confirmation; no overlay animation (removed — it was resource-heavy and the
  // download popup covered it anyway).
  try {
    await api.download(
      `/api/connex/${STATE.connex.connex_id}/generate`,
      {},
      `DD1750_${STATE.connex.connex_no || STATE.connex.connex_id}.zip`
    );
  } catch (e) {
    showError("review-generate-error", "Generate failed: " + e.message);
    if (uiStatus) uiStatus.textContent = "";
    return;
  }
  if (uiStatus) uiStatus.textContent = "Downloaded. Connex complete.";
  goTo("NEXT_SITREP");
};

function disposeScene() {
  // no-op — 3D view removed
}

/* =========================================================
 * STEP 6 — NEXT_SITREP
 * ========================================================= */
function renderNextSitrepStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel">
      <h2 class="cx-panel__title">6 &middot; Next Connex or SITREP</h2>
      <p class="cx-field-hint">
        ${STATE.sessionConnexIds.length} connex(es) completed this session.
      </p>
      <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;margin-top:var(--space-4);">
        <button class="cx-btn cx-btn--primary" onclick="startAnotherConnex()">Prepare Another Connex</button>
        <button class="cx-btn cx-btn--ghost"   onclick="loadAndShowSitrep()">Generate SITREP PDF</button>
      </div>
      ${STATE.sessionConnexIds.length ? `
      <div style="margin-top:var(--space-4);display:flex;flex-direction:column;gap:var(--space-2);">
        <button class="cx-btn cx-btn--primary" style="width:100%;" onclick="downloadMovementPackage()">
          &#x1F4E6; Download Full Package (ZIP — all DD1750s + SITREP)
        </button>
        <button class="cx-btn cx-btn--ghost" style="width:100%;" onclick="downloadMovementPacket()">
          &#x1F4C4; Download Packet PDF (SITREP + Master 1750s, one file)
        </button>
        <div id="package-status" class="cx-field-hint" style="min-height:1.2em;"></div>
        <div id="package-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
      </div>` : ""}
      <div id="sitrep-content" style="margin-top:var(--space-4);"></div>
      <div id="sitrep-error" role="alert" class="cx-field-error-msg" style="display:none;margin-top:var(--space-2);"></div>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      <h3 class="cx-panel__title">SITREP</h3>
      <p class="cx-field-hint">Commander's summary PDF covers all sealed connexes in this session.</p>
      <p class="cx-field-hint" style="margin-top:var(--space-3);">
        <strong>Full Package</strong> bundles all DD1750s + SITREP into one ZIP — hand the movement officer one file.
      </p>
    </div>`;
}

window.startAnotherConnex = function() {
  STATE.connex       = null;
  STATE.job_id       = null;
  STATE.boms         = [];
  STATE.itemBoxMap   = {};
  STATE.openBoms     = {};
  goTo("CONNEX_SETUP");
};

window.loadAndShowSitrep = async function() {
  hideError("sitrep-error");
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
};

function renderSitrepContent(sitrep) {
  const el = $("sitrep-content");
  if (!el || !sitrep) return;
  const flags = (sitrep.flags || []).map(f => `<li>${esc(f)}</li>`).join("");
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);margin-bottom:var(--space-4);">
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
    <button class="cx-btn cx-btn--primary" onclick="downloadSitrepPdf()">Download SITREP PDF</button>`;
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

window.downloadMovementPackage = async function() {
  if (!STATE.sessionConnexIds.length) return;
  const status = $("package-status");
  const errEl  = $("package-error");
  if (errEl) errEl.style.display = "none";
  if (status) status.textContent = "Building package…";
  try {
    await api.download(
      "/api/session-package",
      { connex_ids: STATE.sessionConnexIds },
      "Movement_Package.zip"
    );
    if (status) status.textContent = "Downloaded.";
  } catch (e) {
    if (status) status.textContent = "";
    showError("package-error", "Package failed: " + e.message);
  }
};

/* =========================================================
 * Save / Load session
 * ========================================================= */
window.downloadMovementPacket = async function() {
  if (!STATE.sessionConnexIds.length) return;
  const status = $("package-status");
  const errEl  = $("package-error");
  if (errEl) errEl.style.display = "none";
  if (status) status.textContent = "Building packet PDF…";
  try {
    await api.download(
      "/api/session-packet",
      { connex_ids: STATE.sessionConnexIds },
      "Movement_Packet.pdf"
    );
    if (status) status.textContent = "Downloaded.";
  } catch (e) {
    if (status) status.textContent = "";
    showError("package-error", "Packet failed: " + e.message);
  }
};

window.replaceBom = async function(bomId, event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file || !STATE.job_id) return;

  const statusEl = $(`replace-status-${bomId}`);
  if (statusEl) statusEl.textContent = "…";

  const fd = new FormData();
  fd.append("bom", file);
  try {
    const data = await api.postForm(`/api/job/${STATE.job_id}/bom/${bomId}/replace`, fd);
    if (data.item_box_map) STATE.itemBoxMap = data.item_box_map;

    // Update the BOM in local state so the table reflects new item count.
    const idx = STATE.boms.findIndex(b => b.bom_id === bomId);
    if (idx >= 0) STATE.boms[idx] = { ...STATE.boms[idx], ...data.bom };

    const d = data.diff;
    const summary = d.added || d.removed
      ? `+${d.added} −${d.removed}`
      : "unchanged";
    if (statusEl) statusEl.textContent = summary;

    renderPackingStep($("cx-step-content"), $("cx-right-rail-content"));
  } catch (e) {
    if (statusEl) statusEl.textContent = "Error";
    console.error("replaceBom failed:", e.message);
  }
};

window.saveSession = async function() {
  if (!STATE.job_id) {
    showError("session-error", "No active job to save — ingest BOMs first.");
    return;
  }
  const status = $("session-status");
  const errEl  = $("session-error");
  if (errEl) errEl.style.display = "none";
  if (status) status.textContent = "Saving…";
  try {
    const data = await api.get(`/api/job/${STATE.job_id}/export`);
    // Bundle connex + profile context alongside the job so Load can reconnect.
    const bundle = {
      ...data,
      connex_id:  STATE.connex  && STATE.connex.connex_id,
      profile_id: STATE.profile && STATE.profile.profile_id,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `CRATE_session_${STATE.connex && STATE.connex.connex_no || STATE.job_id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    if (status) status.textContent = "Saved.";
  } catch (e) {
    if (status) status.textContent = "";
    showError("session-error", "Save failed: " + e.message);
  }
};

window.loadSession = async function(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";  // allow re-selecting the same file
  if (!file) return;

  const status = $("session-status");
  const errEl  = $("session-error");
  if (errEl) errEl.style.display = "none";
  if (status) status.textContent = "Loading…";

  try {
    const text   = await file.text();
    const bundle = JSON.parse(text);
    if (!bundle.crate_export || !bundle.job) throw new Error("Not a valid CRATE session file.");

    // Import job → new job_id on server.
    const imp = await api.post("/api/job/import", { job: bundle.job });
    STATE.job_id = imp.job_id;

    // Restore BOM list from the imported job payload.
    STATE.boms = (bundle.job.boms || []).map(b => ({ ...b, box_num: null }));
    // item_box_map lets bomAssignedBox() compute box assignments client-side.
    STATE.itemBoxMap = bundle.job.box_map || {};

    // Reconnect to the original connex if still available.
    if (bundle.connex_id) {
      try {
        const cx = await api.get(`/api/connex/${bundle.connex_id}`);
        STATE.connex = cx.connex;
        // Re-attach the newly imported job to the connex.
        await api.post(`/api/connex/${bundle.connex_id}/attach`, { ingest_job_id: imp.job_id });
      } catch (_) {
        // Connex gone or server restarted — session job is loaded; connex must be recreated.
        STATE.connex = null;
      }
    }

    if (status) status.textContent = `Loaded ${imp.bom_count} BOM(s).`;
    // Refresh packing step to show restored assignments.
    renderPackingStep($("cx-step-content"), $("cx-right-rail-content"));
  } catch (e) {
    if (status) status.textContent = "";
    showError("session-error", "Load failed: " + e.message);
  }
};

/* =========================================================
 * navigateToAuditTarget — click handler for audit flag items
 * ========================================================= */
window.navigateToAuditTarget = function(action, boxNum) {
  if (action === "go-packing") {
    goTo("PACKING");
    return;
  }
  const focusInput = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
  };
  if (action === "focus-sloc" || action === "focus-shrh" || action === "focus-box") {
    const inputId = action === "focus-sloc" ? `sloc-${boxNum}`
                  : action === "focus-shrh" ? `shrh-${boxNum}`
                  : `label-${boxNum}`;
    if (STATE.step !== "BOX_STATUS") {
      STATE.step = "BOX_STATUS";
      renderAll();
      requestAnimationFrame(() => focusInput(inputId));
    } else {
      focusInput(inputId);
    }
  }
};

/* =========================================================
 * toggleHelp
 * ========================================================= */
/* Reset ONLY the positioning props that toggleHelp adds inline when opening.
   We must NOT use cssText="" here: buildHelpPopover() bakes max-width /
   max-height:70vh / overflow-y:auto into the popover's static inline style so
   tall popovers scroll. Wiping cssText would strip those permanently, so a
   re-opened tall popover (CONNEX#, SEAL# photo popovers) would no longer
   scroll. Clearing individual properties leaves the static inline style intact. */
function resetHelpPopoverPosition(p) {
  ["position", "width", "left", "right", "top", "bottom", "transform"]
    .forEach(prop => p.style.removeProperty(prop));
}

window.toggleHelp = function(triggerBtn) {
  const help    = triggerBtn.closest(".cx-help");
  const popover = help && help.querySelector(".cx-help__popover");
  if (!popover) return;
  const isOpen = popover.classList.contains("cx-help__popover--open");
  $$(".cx-help__popover--open").forEach(p => {
    p.classList.remove("cx-help__popover--open");
    resetHelpPopoverPosition(p);
  });
  if (!isOpen) {
    popover.classList.add("cx-help__popover--open");
    // position:fixed escapes overflow:hidden ancestors — compute from trigger's viewport rect
    requestAnimationFrame(() => {
      const tr   = triggerBtn.getBoundingClientRect();
      const vw   = window.innerWidth;
      const vh   = window.innerHeight;
      const popW = 260;

      let left = tr.left + tr.width / 2 - popW / 2;
      if (left < 8)             left = 8;
      if (left + popW > vw - 8) left = vw - popW - 8;

      popover.style.position  = "fixed";
      popover.style.width     = popW + "px";
      popover.style.left      = left + "px";
      popover.style.transform = "none";

      // open above trigger by default; flip below when near top of viewport
      if (tr.top > 160) {
        popover.style.bottom = (vh - tr.top + 8) + "px";
        popover.style.top    = "auto";
      } else {
        popover.style.top    = (tr.bottom + 8) + "px";
        popover.style.bottom = "auto";
      }
    });
    const close = (e) => {
      if (!help.contains(e.target)) {
        popover.classList.remove("cx-help__popover--open");
        resetHelpPopoverPosition(popover);
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape")
    $$(".cx-help__popover--open").forEach(p => {
      p.classList.remove("cx-help__popover--open");
      resetHelpPopoverPosition(p);
    });
});

/* =========================================================
 * Error helpers
 * ========================================================= */
function showError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = "";
  el.classList.remove("cx-field-hint");
  el.classList.add("cx-field-error-msg");
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
 * TUTORIAL — first-load onboarding carousel.
 *
 * Gate:  localStorage key "connex_tutorial_v1_seen".
 *        Set on close/skip/get-started. Not set = show on load.
 * Reopen: "How it works" button in header calls openTutorial().
 * Keys:  ArrowRight/ArrowLeft navigate; Escape closes.
 * Focus: trapped inside modal while open.
 * ========================================================= */
const TUTORIAL_STORAGE_KEY = "connex_tutorial_v1_seen";

const TUTORIAL_SLIDES = [
  {
    badge: "Welcome",
    heading: "CRATE",
    body: "CRATE (Container Readiness and Accountability Tracking Engine) turns your packing job into finished DD1750s. Assign BOMs to boxes inside a connex, then download a master 1750 + a 1750 for every box, plus a commander’s SITREP.",
  },
  {
    badge: "Step 1",
    heading: "Profile",
    body: "Pick your brigade from the insignia gallery. It personalizes the app and saves your unit so you can reuse it next time.",
  },
  {
    badge: "Step 2",
    heading: "Connex Setup",
    body: "Name your connex and choose how many boxes you’re packing.",
  },
  {
    badge: "Step 3",
    heading: "Packing",
    body: "Ingest your BOM PDFs, then use the assignment table to pick which box each end item goes to. Click the ▸ on any end item to drop down its subitems and assign them to boxes individually. Add loose individual items directly to any box.",
  },
  {
    badge: "Step 4",
    heading: "Box Status",
    body: "Label and organize each box with a custom name (e.g. “Launcher BII”, “Commo Equipment”), apply its SLOC and SHRH POC, and review the audit — CRATE flags missing LINs, serial numbers, empty boxes, and missing SLOC/POC here.",
  },
  {
    badge: "Step 5",
    heading: "Seal Data",
    body: "Enter your SUN #, CONNEX #, and SEAL # (leave blank to print a placeholder), plus who packed and who signs. Tap the ? on any field for help — SEAL # and CONNEX # show a photo of where to read the number.",
  },
  {
    badge: "Step 6",
    heading: "Review & Seal",
    body: "Do a final review of the box manifest, then apply your stamp and download your 1750s.",
  },
  {
    badge: "Step 7",
    heading: "Next / SITREP",
    body: "Pack another connex under the same profile, or finish and generate the commander’s SITREP across everything you packed.",
  },
];

let _tutIdx = 0;

/* Render the current slide into #cx-tutorial-slide */
function renderTutorialSlide() {
  const slide = TUTORIAL_SLIDES[_tutIdx];
  const last  = _tutIdx === TUTORIAL_SLIDES.length - 1;
  const total = TUTORIAL_SLIDES.length;

  /* Slide content */
  const slideEl = $("cx-tutorial-slide");
  if (slideEl) {
    slideEl.innerHTML = `
      <span class="cx-tut__step-badge">${esc(slide.badge)}</span>
      <h2 class="cx-tut__heading">${esc(slide.heading)}</h2>
      <p  class="cx-tut__body">${esc(slide.body)}</p>`;
  }

  /* Dot indicators */
  const dotsEl = $("cx-tutorial-dots");
  if (dotsEl) {
    dotsEl.innerHTML = TUTORIAL_SLIDES.map((_, i) =>
      `<button class="cx-tut__dot${i === _tutIdx ? " cx-tut__dot--active" : ""}"
               aria-label="Slide ${i + 1} of ${total}"
               onclick="tutorialGoTo(${i})"></button>`
    ).join("");
  }

  /* Back button visibility */
  const backBtn = $("cx-tutorial-back");
  if (backBtn) backBtn.style.display = _tutIdx > 0 ? "" : "none";

  /* Next vs Get Started */
  const nextBtn = $("cx-tutorial-next");
  if (nextBtn) {
    nextBtn.textContent = last ? "Get Started →" : "Next →";
  }

  /* Skip link: hide on last slide (replaced by Get Started) */
  const skipBtn = $("cx-tutorial-skip");
  if (skipBtn) skipBtn.style.visibility = last ? "hidden" : "visible";
}

function openTutorial() {
  _tutIdx = 0;
  renderTutorialSlide();
  const backdrop = $("cx-tutorial-backdrop");
  if (backdrop) backdrop.classList.add("cx-tutorial--open");
  /* Trap focus — move to the modal */
  const modal = $("cx-tutorial-modal");
  if (modal) {
    /* Find first focusable element */
    const first = modal.querySelector("button, [tabindex]");
    if (first) setTimeout(() => first.focus(), 50);
  }
  document.addEventListener("keydown", _tutorialKeyHandler);
}

function closeTutorial() {
  const backdrop = $("cx-tutorial-backdrop");
  if (backdrop) backdrop.classList.remove("cx-tutorial--open");
  document.removeEventListener("keydown", _tutorialKeyHandler);
  /* Mark seen so it won't auto-show again */
  try { localStorage.setItem(TUTORIAL_STORAGE_KEY, "1"); } catch (_) {}
}

window.openTutorial  = openTutorial;
window.closeTutorial = closeTutorial;

window.tutorialNext = function() {
  if (_tutIdx < TUTORIAL_SLIDES.length - 1) {
    _tutIdx++;
    renderTutorialSlide();
  } else {
    closeTutorial();
  }
};

window.tutorialBack = function() {
  if (_tutIdx > 0) { _tutIdx--; renderTutorialSlide(); }
};

window.tutorialGoTo = function(idx) {
  _tutIdx = idx;
  renderTutorialSlide();
};

/* Close if backdrop itself (not modal) was clicked */
window.handleTutorialBackdropClick = function(e) {
  if (e.target === $("cx-tutorial-backdrop")) closeTutorial();
};

/* Keyboard handler (attached on open, removed on close) */
function _tutorialKeyHandler(e) {
  if (e.key === "Escape")     { closeTutorial(); return; }
  if (e.key === "ArrowRight") { window.tutorialNext(); return; }
  if (e.key === "ArrowLeft")  { window.tutorialBack(); return; }

  /* Basic focus trap — keep Tab inside the modal */
  if (e.key === "Tab") {
    const modal     = $("cx-tutorial-modal");
    if (!modal) return;
    const focusable = [...modal.querySelectorAll(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )];
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }
}

/* Auto-show on first load if not yet seen */
function tutorialInit() {
  let seen = false;
  try { seen = !!localStorage.getItem(TUTORIAL_STORAGE_KEY); } catch (_) {}
  if (!seen) openTutorial();
}

/* =========================================================
 * INIT
 * ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  renderAll();
  tutorialInit();
  window.addEventListener("resize", () => { /* no-op — 3D view removed */ });
});
