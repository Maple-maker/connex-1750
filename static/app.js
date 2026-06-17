/* app.js — CONNEX 1750 workflow state machine (6-step redesign).
 * Owned by: Frontend agent.
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
  selectedFormation: null,
  connex: null,
  job_id: null,
  boms: [],
  _dragBomId: null,
  _clickBomId: null,
  scene: null,
  sessionConnexIds: [],
  sitrep: null,
};

const STEPS = ["PROFILE", "CONNEX_SETUP", "PACKING", "SEAL_DATA", "REVIEW_SEAL", "NEXT_SITREP"];

const STEP_LABELS = {
  PROFILE:      { label: "Profile",        sub: "Choose brigade / battalion" },
  CONNEX_SETUP: { label: "Connex Setup",   sub: "Name container, set box count" },
  PACKING:      { label: "Packing",        sub: "Assign BOMs to boxes" },
  SEAL_DATA:    { label: "Seal Data",      sub: "SUN, CONNEX #, SEAL #, signers" },
  REVIEW_SEAL:  { label: "Review & Seal",  sub: "3D review + apply stamp" },
  NEXT_SITREP:  { label: "Next / SITREP",  sub: "Another connex or finish" },
};

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
  async postForm(url, formData) {
    const r = await fetch(url, { method: "POST", body: formData });
    const j = await r.json();
    if (!r.ok) throw { status: r.status, message: j.error || r.statusText };
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
    case "SEAL_DATA":
      if (!s.connex) return "No connex loaded.";
      if (!allBoxesHaveRequiredFields()) return "Every populated box needs SLOC and SHRH POC before sealing.";
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
  if (STATE.step === "REVIEW_SEAL" && step !== "REVIEW_SEAL") disposeScene();
  STATE.step = step;
  renderAll();
}

window.goTo = goTo;

window._stepClick = function(step) {
  const curIdx = STEPS.indexOf(STATE.step);
  const tgtIdx = STEPS.indexOf(step);
  if (tgtIdx < curIdx) {
    if (STATE.step === "REVIEW_SEAL") disposeScene();
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
        <span class="cx-banner__unit">CONNEX 1750</span>
        <span class="cx-banner__sub">No profile loaded</span>
      </span>`;
    return;
  }
  const p = STATE.profile;
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

function renderStepPanel() {
  const center = $("cx-step-content");
  const right  = $("cx-right-rail-content");
  if (!center) return;
  switch (STATE.step) {
    case "PROFILE":      renderProfileStep(center, right); break;
    case "CONNEX_SETUP": renderConnexSetupStep(center, right); break;
    case "PACKING":      renderPackingStep(center, right); break;
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
      <h2 class="cx-panel__title">1 &middot; Select Your Brigade</h2>
      <p class="cx-field-hint">Pick your unit insignia, then fill in battalion details below.</p>
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-4);">
        <input class="cx-field" id="gallery-search" placeholder="Search unit name…"
               style="flex:1;min-width:160px;" oninput="filterGallery()">
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
  renderGallery();
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

function renderGallery() {
  const grid = $("insignia-grid");
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
             alt="${esc(f.name)}" width="72" height="72" loading="lazy"
             style="object-fit:contain;display:block;margin:0 auto var(--space-2);"
             onerror="this.style.display='none'">
        <div style="font-size:var(--text-xs);color:var(--connex-gray);
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;"
             title="${esc(f.name)}">${esc(f.name)}</div>
        ${badgeCls ? `<span class="${badgeCls}" style="font-size:10px;margin-top:var(--space-1);">ADA</span>` : ""}
      </div>`;
  }).join("");
}

window.filterGallery = function() { renderGallery(); };

window.selectFormation = function(file) {
  const formation = STATE.formations.find(f => f.file === file);
  if (!formation) return;
  STATE.selectedFormation = formation;
  renderGallery();
  const panel = $("profile-detail-panel");
  if (panel) panel.style.display = "";
  const img   = $("selected-insignia-img");
  const label = $("selected-brigade-label");
  if (img)   { img.src = `/static/formations/${esc(file)}`; img.alt = esc(formation.name); }
  if (label)  label.textContent = formation.name;
  const stamp = $("p_stamp");
  if (stamp && !stamp.value) {
    const match = formation.name.match(/\b\d+\w*/);
    stamp.value = match ? match[0].toUpperCase() : formation.name.split(" ")[0].toUpperCase();
  }
  panel && panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

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
  const brigade       = STATE.selectedFormation.name;
  const brigade_image = STATE.selectedFormation.file;
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
        <input class="cx-field cx-field--mono" id="cs_connex_no" placeholder="CONEX-01 (optional)">
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
 * STEP 3 — PACKING (2D split-screen)
 * Left: BOM pool + individual item form
 * Right: Box cards with inline SLOC/SHRH + chip assignments
 * ========================================================= */
function renderPackingStep(center, right) {
  center.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h2 class="cx-panel__title">3 &middot; Packing</h2>
      <p class="cx-field-hint">
        Ingest BOM PDFs, then assign them to boxes. Click a BOM to select it (gold ring), then click a box to assign.
        Or drag a BOM card onto a box.
      </p>
    </div>

    <div id="packing-split">
      <!-- LEFT: Pool -->
      <div>
        <div class="cx-panel" style="margin-bottom:var(--space-3);">
          <h3 class="cx-panel__title cx-section-title">BOM Pool</h3>
          <div id="bom-drop-zone" class="cx-bom-card cx-bom-card--drop-target"
               style="padding:var(--space-4);text-align:center;cursor:pointer;margin-bottom:var(--space-3);"
               ondragover="event.preventDefault();this.classList.add('cx-bom-card--drop-target')"
               ondragleave="this.classList.remove('cx-bom-card--drop-target')"
               ondrop="handleBomZoneDrop(event)"
               onclick="document.getElementById('bom-file-input').click()">
            <strong>Drop BOM PDFs here</strong> or click to browse<br>
            <span class="cx-field-hint">Multiple files OK.</span>
            <input type="file" id="bom-file-input" accept="application/pdf" multiple style="display:none;"
                   onchange="ingestBoms(this.files)">
          </div>
          <div id="ingest-status" class="cx-field-hint" style="min-height:1.2em;margin-bottom:var(--space-2);"></div>
          <div id="packing-pool">
            ${STATE.boms.length ? renderPoolCards() : '<span class="cx-field-hint">No BOMs ingested yet.</span>'}
          </div>
        </div>

        <!-- Individual item form -->
        <div class="cx-panel">
          <h3 class="cx-panel__title cx-section-title">Individual Item</h3>
          <p class="cx-field-hint">Add a loose item directly to a box (not from a BOM).</p>
          <div class="cx-field-wrap">
            <label class="cx-label">Description</label>
            <input class="cx-field" id="ind_desc" placeholder="Carrying case">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);">
            <div class="cx-field-wrap">
              <label class="cx-label">SN</label>
              <input class="cx-field cx-field--mono" id="ind_sn" placeholder="">
            </div>
            <div class="cx-field-wrap">
              <label class="cx-label">NSN ${buildHelpPopover("NSN")}</label>
              <input class="cx-field cx-field--mono" id="ind_nsn" placeholder="1005-01-231-0973">
            </div>
            <div class="cx-field-wrap">
              <label class="cx-label">LIN ${buildHelpPopover("LIN")}</label>
              <input class="cx-field cx-field--mono" id="ind_lin" placeholder="M39331">
            </div>
            <div class="cx-field-wrap">
              <label class="cx-label">Assign to Box</label>
              <select class="cx-field" id="ind_box_num">
                ${STATE.connex ? STATE.connex.boxes.map(b => `<option value="${b.box_num}">Box ${b.box_num}</option>`).join("") : ""}
              </select>
            </div>
          </div>
          <div id="ind-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
          <button class="cx-btn cx-btn--ghost cx-btn--sm" style="margin-top:var(--space-2);"
                  onclick="addIndividualItemToBox()">+ Add to Box</button>
        </div>
      </div>

      <!-- RIGHT: Box cards -->
      <div id="packing-boxes">
        ${renderBoxCards()}
      </div>
    </div>

    <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
      <button class="cx-btn cx-btn--primary" onclick="goTo('SEAL_DATA')">Seal Data &rarr;</button>
    </div>
    <div id="packing-advance-error" role="alert" class="cx-field-error-msg" style="display:none;margin-top:var(--space-2);"></div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      <h3 class="cx-panel__title">Assign Mode</h3>
      <p class="cx-field-hint" id="assign-mode-hint">Click a BOM card to select it (gold ring), then click a box card to assign it. Or drag and drop.</p>
      <p class="cx-field-hint">Click &times; on a chip to unassign.</p>
    </div>
    <div class="cx-panel" style="margin-top:var(--space-3);">
      <h3 class="cx-panel__title">Progress</h3>
      <div id="packing-progress">${renderPackingProgress()}</div>
    </div>`;
}

function renderPoolCards() {
  return STATE.boms.map(bom => {
    const assignedBox = bomAssignedBox(bom);
    const isSelected  = STATE._clickBomId === bom.bom_id;
    let cls = "cx-bom-card";
    if (isSelected)  cls += " cx-bom-card--selected";
    if (assignedBox) cls += " cx-bom-card--assigned";
    return `<div class="${cls}" draggable="true"
               data-bom-id="${esc(bom.bom_id)}"
               ondragstart="handleBomDragStart(event,'${esc(bom.bom_id)}')"
               onclick="selectBomCard('${esc(bom.bom_id)}')"
               style="cursor:pointer;margin-bottom:var(--space-2);">
      <span class="cx-bom-card__nom">${esc(bom.nomenclature || bom.filename)}</span>
      <span class="cx-bom-card__qty">${esc(bom.item_count || "")} items</span>
      <div class="cx-bom-card__codes">
        ${bom.lin ? `<span class="cx-bom-card__code--lin cx-mono">${esc(bom.lin)}</span>` : ""}
        ${bom.end_item_niin ? `<span class="cx-bom-card__code--nsn cx-mono">${esc(bom.end_item_niin)}</span>` : ""}
      </div>
      ${assignedBox ? `<span class="cx-badge cx-badge--ok" style="margin-top:var(--space-1);">Box ${assignedBox}</span>` : ""}
    </div>`;
  }).join("");
}

function renderBoxCards() {
  if (!STATE.connex) return '<span class="cx-field-hint">No connex loaded.</span>';
  return STATE.connex.boxes.map(b => {
    const populated = (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length);
    let badgeCls, badgeText;
    if (b.complete)                                 { badgeCls = "cx-badge cx-badge--ok";    badgeText = "Complete"; }
    else if (populated && (!b.sloc || !b.shrh_poc)) { badgeCls = "cx-badge cx-badge--warn";  badgeText = "Needs SLOC/SHRH"; }
    else if (populated)                             { badgeCls = "cx-badge cx-badge--warn";  badgeText = "Incomplete"; }
    else                                            { badgeCls = "cx-badge cx-badge--empty"; badgeText = "Empty"; }

    const bomChips = (b.bom_ids || []).map(bid => {
      const bom = STATE.boms.find(bm => bm.bom_id === bid);
      const label = bom ? (bom.nomenclature || bom.filename || bid).slice(0, 22) : bid.slice(0, 8);
      return `<span style="display:inline-flex;align-items:center;gap:4px;
                background:rgba(196,160,100,0.15);border:1px solid var(--connex-gold);
                border-radius:var(--radius-sm);padding:2px 6px;font-size:var(--text-xs);margin:2px;">
        ${esc(label)}
        <button style="background:none;border:none;color:var(--connex-gray);cursor:pointer;padding:0;font-size:12px;line-height:1;"
                onclick="event.stopPropagation();unassignBom('${esc(bid)}',${b.box_num})" title="Unassign">&times;</button>
      </span>`;
    }).join("");

    const itemChips = (b.individual_items || []).map((it, idx) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;
               background:rgba(100,196,160,0.12);border:1px solid var(--connex-ok);
               border-radius:var(--radius-sm);padding:2px 6px;font-size:var(--text-xs);margin:2px;">
        ${esc(it.description || "Item")}
        <button style="background:none;border:none;color:var(--connex-gray);cursor:pointer;padding:0;font-size:12px;line-height:1;"
                onclick="event.stopPropagation();removeIndividualFromBox(${b.box_num},${idx})" title="Remove">&times;</button>
      </span>`
    ).join("");

    return `<div class="cx-panel cx-panel--2"
                 style="margin-bottom:var(--space-3);cursor:pointer;"
                 data-box-num="${b.box_num}"
                 ondragover="event.preventDefault();this.classList.add('box-card--drag-over')"
                 ondragleave="this.classList.remove('box-card--drag-over')"
                 ondrop="handleBoxCardDrop(event,${b.box_num})"
                 onclick="handleBoxCardClick(${b.box_num})">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2);">
        <strong>Box ${b.box_num}</strong>
        <span class="${badgeCls}">${badgeText}</span>
      </div>
      <div style="min-height:28px;margin-bottom:var(--space-2);">${bomChips}${itemChips}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);"
           onclick="event.stopPropagation()">
        <div class="cx-field-wrap">
          <label class="cx-label" style="font-size:10px;">SLOC ${buildHelpPopover("SLOC")}</label>
          <input class="cx-field cx-field--mono" style="font-size:var(--text-xs);padding:4px 6px;"
                 id="sloc-${b.box_num}" value="${esc(b.sloc || "")}" placeholder="BLDG-100"
                 onblur="saveBoxField(${b.box_num},'sloc',this.value)">
        </div>
        <div class="cx-field-wrap">
          <label class="cx-label" style="font-size:10px;">SHRH POC ${buildHelpPopover("SHRH POC")}</label>
          <input class="cx-field" style="font-size:var(--text-xs);padding:4px 6px;"
                 id="shrh-${b.box_num}" value="${esc(b.shrh_poc || "")}" placeholder="CPT JONES"
                 onblur="saveBoxField(${b.box_num},'shrh_poc',this.value)">
        </div>
      </div>
    </div>`;
  }).join("");
}

function renderPackingProgress() {
  if (!STATE.connex) return "";
  const boxes     = STATE.connex.boxes;
  const complete  = boxes.filter(b => b.complete).length;
  const populated = boxes.filter(b => (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length)).length;
  return `<div class="cx-field-hint">${complete} of ${populated} populated boxes complete</div>
    <div class="cx-field-hint">${STATE.boms.length} BOMs ingested</div>`;
}

window.selectBomCard = function(bomId) {
  STATE._clickBomId = STATE._clickBomId === bomId ? null : bomId;
  const pool = $("packing-pool");
  if (pool) pool.innerHTML = STATE.boms.length ? renderPoolCards() : '<span class="cx-field-hint">No BOMs ingested yet.</span>';
  const hint = $("assign-mode-hint");
  if (hint) hint.textContent = STATE._clickBomId
    ? "BOM selected. Now click a box card to assign it."
    : "Click a BOM card to select it, then click a box card to assign it.";
};

window.handleBoxCardClick = async function(boxNum) {
  if (!STATE._clickBomId) return;
  const bomId = STATE._clickBomId;
  STATE._clickBomId = null;
  await assignBomToBox(bomId, boxNum);
};

window.handleBomDragStart = function(event, bomId) {
  STATE._dragBomId = bomId;
  event.dataTransfer.setData("application/bom-id", bomId);
  event.dataTransfer.effectAllowed = "move";
};

window.handleBomZoneDrop = function(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("cx-bom-card--drop-target");
  if (event.dataTransfer.files.length) ingestBoms(event.dataTransfer.files);
};

window.handleBoxCardDrop = async function(event, boxNum) {
  event.preventDefault();
  event.currentTarget.classList.remove("box-card--drag-over");
  const bomId = event.dataTransfer.getData("application/bom-id") || STATE._dragBomId;
  STATE._dragBomId = null;
  if (!bomId) return;
  await assignBomToBox(bomId, boxNum);
};

async function assignBomToBox(bomId, boxNum) {
  if (!STATE.connex) return;
  try {
    const data = await api.post(`/api/connex/${STATE.connex.connex_id}/assign`, {
      moves: [{ bom_id: bomId, box_num: boxNum }],
    });
    STATE.connex = data.connex;
    refreshPackingView();
  } catch (e) {
    showError("packing-advance-error", "Assign failed: " + e.message);
  }
}

window.unassignBom = async function(bomId, boxNum) {
  if (!STATE.connex) return;
  try {
    const data = await api.post(`/api/connex/${STATE.connex.connex_id}/assign`, {
      moves: [{ bom_id: bomId, exclude: true }],
    });
    STATE.connex = data.connex;
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
    if (status) status.textContent = `Extracted ${STATE.boms.length} BOM(s).`;
    if (STATE.connex) {
      await api.post(`/api/connex/${STATE.connex.connex_id}/attach`, { ingest_job_id: data.job_id });
    }
    refreshPackingView();
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

window.saveBoxField = async function(boxNum, field, value) {
  if (!STATE.connex) return;
  const box = STATE.connex.boxes.find(b => b.box_num === boxNum);
  if (!box) return;
  box[field] = value;
  try {
    const updatedBoxes = STATE.connex.boxes.map(b =>
      b.box_num === boxNum
        ? { box_num: b.box_num, sloc: b.sloc, shrh_poc: b.shrh_poc }
        : { box_num: b.box_num }
    );
    const data = await api.put(`/api/connex/${STATE.connex.connex_id}`, { boxes: updatedBoxes });
    STATE.connex = data.connex;
    const boxesEl = $("packing-boxes");
    if (boxesEl) boxesEl.innerHTML = renderBoxCards();
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

function refreshPackingView() {
  const pool = $("packing-pool");
  if (pool) pool.innerHTML = STATE.boms.length ? renderPoolCards() : '<span class="cx-field-hint">No BOMs ingested yet.</span>';
  const boxes = $("packing-boxes");
  if (boxes) boxes.innerHTML = renderBoxCards();
  const prog = $("packing-progress");
  if (prog) prog.innerHTML = renderPackingProgress();
}

/* =========================================================
 * STEP 4 — SEAL_DATA
 * ========================================================= */
function renderSealDataStep(center, right) {
  const c = STATE.connex || {};
  center.innerHTML = `
    <div class="cx-panel">
      <h2 class="cx-panel__title">4 &middot; Seal Data</h2>
      <p class="cx-field-hint">Enter identifiers. SUN, CONNEX #, and SEAL # may be left blank — a placeholder prints on the PDF.</p>
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
 * STEP 5 — REVIEW_SEAL
 * 3D read-only canvas (left) + checklist + "Apply Stamp & Seal" (right)
 * ========================================================= */
function renderReviewSealStep(center, right) {
  const boxes     = (STATE.connex && STATE.connex.boxes) || [];
  const populated = boxes.filter(b => (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length));

  const checkRows = populated.map(b => {
    const ok = b.complete;
    return `<tr>
      <td>Box ${b.box_num}</td>
      <td class="cx-mono" style="font-size:var(--text-xs);">${esc(b.sloc || "—")}</td>
      <td style="font-size:var(--text-xs);">${esc(b.shrh_poc || "—")}</td>
      <td>${(b.bom_ids || []).length + (b.individual_items || []).length} item(s)</td>
      <td><span class="cx-badge ${ok ? "cx-badge--ok" : "cx-badge--warn"}">${ok ? "Ready" : "Incomplete"}</span></td>
    </tr>`;
  }).join("");

  center.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h2 class="cx-panel__title">5 &middot; Review &amp; Seal</h2>
      <p class="cx-field-hint">Read-only 3D review of the packed connex. Confirm every box, then apply stamp and download.</p>
    </div>
    <div id="cx-3d-mount" style="margin-bottom:var(--space-4);min-height:380px;background:rgba(0,0,0,0.2);border-radius:var(--radius-md);">
      <p class="cx-field-hint" style="padding:var(--space-4);" id="cx-3d-status">Loading 3D view…</p>
    </div>
    <div class="cx-panel">
      <h3 class="cx-panel__title cx-section-title">Box Checklist</h3>
      <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);">
        <thead><tr>
          <th style="text-align:left;padding:var(--space-2);">Box</th>
          <th style="text-align:left;padding:var(--space-2);">SLOC</th>
          <th style="text-align:left;padding:var(--space-2);">SHRH</th>
          <th style="text-align:left;padding:var(--space-2);">Items</th>
          <th style="text-align:left;padding:var(--space-2);">Status</th>
        </tr></thead>
        <tbody>${checkRows || '<tr><td colspan="5" class="cx-field-hint" style="padding:var(--space-2);">No populated boxes yet.</td></tr>'}</tbody>
      </table>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      ${STATE.profile && STATE.profile.brigade_image ? `
        <img src="/static/formations/${esc(STATE.profile.brigade_image)}"
             alt="" width="80" height="80"
             style="display:block;object-fit:contain;margin:0 auto var(--space-4);"
             onerror="this.style.display='none'">` : ""}
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

  initReviewScene();
}

async function initReviewScene() {
  const mount = $("cx-3d-mount");
  if (!mount) return;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;min-height:380px;display:block;border-radius:var(--radius-md);";
  mount.innerHTML = "";
  mount.appendChild(canvas);

  try {
    const mod = await import("/static/connex3d.js");
    STATE.scene = mod.createConnexScene(canvas, {});

    const boxCount = STATE.connex ? STATE.connex.box_count : 1;
    STATE.scene.setBoxCount(boxCount);
    await STATE.scene.openConnex(true);

    if (STATE.connex) {
      STATE.connex.boxes.forEach(b => {
        STATE.scene.setBoxState(b.box_num, {
          complete: b.complete,
          bomCount: (b.bom_ids || []).length,
          hasItems: !!(b.individual_items && b.individual_items.length),
        });
      });
    }

    await STATE.scene.closeConnex(false);

    if (STATE.profile && STATE.profile.stamp_text) {
      STATE.scene.applyStamp(STATE.profile.stamp_text);
    }

    window.addEventListener("resize", () => { if (STATE.scene) STATE.scene.resize(); });

  } catch (err) {
    console.warn("[connex] 3D unavailable at review:", err.message);
    mount.innerHTML = renderReviewFallbackList();
  }
}

function renderReviewFallbackList() {
  const boxes     = (STATE.connex && STATE.connex.boxes) || [];
  const populated = boxes.filter(b => (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length));
  const items = populated.map(b => {
    const bomNames = (b.bom_ids || []).map(bid => {
      const bom = STATE.boms.find(bm => bm.bom_id === bid);
      return bom ? (bom.nomenclature || bom.filename) : bid.slice(0, 8);
    }).join(", ");
    return `<div class="cx-panel cx-panel--2" style="margin-bottom:var(--space-2);">
      <strong>Box ${b.box_num}</strong> — ${bomNames || "(individual items only)"}
      <span class="cx-badge ${b.complete ? "cx-badge--ok" : "cx-badge--warn"}" style="margin-left:var(--space-2);">
        ${b.complete ? "Ready" : "Incomplete"}
      </span>
    </div>`;
  }).join("");
  return `<div style="padding:var(--space-4);">
    <p class="cx-field-hint" style="margin-bottom:var(--space-3);">3D view unavailable (WebGL not supported). Showing text summary.</p>
    ${items}
  </div>`;
}

window.applyStampAndGenerate = async function() {
  if (!STATE.connex) return;
  const status = $("review-generate-status");
  if (status) status.textContent = "Applying stamp…";

  if (STATE.scene && STATE.profile) {
    try {
      STATE.scene.applyStamp(STATE.profile.stamp_text || "");
      STATE.scene.closeConnex(false);
    } catch (_) {}
  }

  if (status) status.textContent = "Generating DD1750s…";

  try {
    await api.download(
      `/api/connex/${STATE.connex.connex_id}/generate`,
      {},
      `DD1750_${STATE.connex.connex_no || STATE.connex.connex_id}.zip`
    );
    if (status) status.textContent = "Downloaded. Connex complete.";
    goTo("NEXT_SITREP");
  } catch (e) {
    showError("review-generate-error", "Generate failed: " + e.message);
    if (status) status.textContent = "";
  }
};

function disposeScene() {
  if (STATE.scene) {
    try { STATE.scene.dispose(); } catch (_) {}
    STATE.scene = null;
  }
  const mount = $("cx-3d-mount");
  if (mount) mount.innerHTML = "";
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
      <div id="sitrep-content" style="margin-top:var(--space-4);"></div>
      <div id="sitrep-error" role="alert" class="cx-field-error-msg" style="display:none;margin-top:var(--space-2);"></div>
    </div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel">
      <h3 class="cx-panel__title">SITREP</h3>
      <p class="cx-field-hint">Commander's summary PDF covers all sealed connexes in this session.</p>
    </div>`;
}

window.startAnotherConnex = function() {
  STATE.connex       = null;
  STATE.job_id       = null;
  STATE.boms         = [];
  STATE._dragBomId   = null;
  STATE._clickBomId  = null;
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

/* =========================================================
 * toggleHelp
 * ========================================================= */
window.toggleHelp = function(triggerBtn) {
  const help    = triggerBtn.closest(".cx-help");
  const popover = help && help.querySelector(".cx-help__popover");
  if (!popover) return;
  const isOpen = popover.classList.contains("cx-help__popover--open");
  $$(".cx-help__popover--open").forEach(p => p.classList.remove("cx-help__popover--open"));
  if (!isOpen) {
    popover.classList.add("cx-help__popover--open");
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
  if (e.key === "Escape")
    $$(".cx-help__popover--open").forEach(p => p.classList.remove("cx-help__popover--open"));
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
 * INIT
 * ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  renderAll();
});
