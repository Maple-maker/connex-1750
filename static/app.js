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
  selectedFormation: null,
  connex: null,
  job_id: null,
  boms: [],
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
  const hasBoms = STATE.boms.length > 0;
  center.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h2 class="cx-panel__title">3 &middot; Packing</h2>
      <p class="cx-field-hint">Ingest BOM PDFs, then assign each to a box using the table below.</p>
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
        ? `<div style="overflow-x:auto;">
             <table class="cx-bom-table">
               <thead><tr>
                 <th>#</th>
                 <th>Nomenclature</th>
                 <th>LIN</th>
                 <th>SN</th>
                 <th>Items</th>
                 <th>Assign to Box</th>
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
            ${STATE.connex ? STATE.connex.boxes.map(b => `<option value="${b.box_num}">Box ${b.box_num}</option>`).join("") : ""}
          </select>
        </div>
      </div>
      <div id="ind-error" role="alert" class="cx-field-error-msg" style="display:none;"></div>
      <button class="cx-btn cx-btn--ghost cx-btn--sm" style="margin-top:var(--space-2);"
              onclick="addIndividualItemToBox()">+ Add to Box</button>
    </div>

    <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
      <button class="cx-btn cx-btn--primary" onclick="goTo('SEAL_DATA')">Seal Data &rarr;</button>
    </div>
    <div id="packing-advance-error" role="alert" class="cx-field-error-msg" style="display:none;margin-top:var(--space-2);"></div>`;

  if (right) right.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h3 class="cx-panel__title">Box Status</h3>
      <p class="cx-field-hint" style="margin-bottom:var(--space-2);">Fill in SLOC and SHRH POC for each occupied box.</p>
      <div id="packing-boxes">${renderBoxCards()}</div>
    </div>
    <div class="cx-panel">
      <h3 class="cx-panel__title">Progress</h3>
      <div id="packing-progress">${renderPackingProgress()}</div>
    </div>`;
}

function renderBomTableRows() {
  if (!STATE.connex) return '';
  return STATE.boms.map((bom, idx) => {
    const assignedBox = bomAssignedBox(bom);
    const boxOptions = [
      `<option value="">— Unassigned —</option>`,
      ...STATE.connex.boxes.map(b =>
        `<option value="${b.box_num}" ${assignedBox === b.box_num ? 'selected' : ''}>Box ${b.box_num}</option>`)
    ].join('');
    const lin = bom.lin || '';
    const sn  = bom.serial_number || '';
    return `<tr>
      <td style="color:var(--connex-gray);font-size:var(--text-xs);">${idx + 1}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(bom.nomenclature || bom.filename)}">${esc(bom.nomenclature || bom.filename)}</td>
      <td class="cx-mono"><span class="cx-label-tag">LIN</span>${esc(lin || '—')}</td>
      <td class="cx-mono"><span class="cx-label-tag">SN</span>${esc(sn || '—')}</td>
      <td style="text-align:center;">${esc(String(bom.item_count || 0))}</td>
      <td>
        <select class="cx-field" style="min-width:120px;padding:4px 6px;font-size:var(--text-xs);"
                onchange="assignBomToBoxFromSelect('${esc(bom.bom_id)}', this.value)">
          ${boxOptions}
        </select>
      </td>
    </tr>`;
  }).join('');
}

function renderBoxCards() {
  if (!STATE.connex) return '<span class="cx-field-hint">No connex loaded.</span>';
  return STATE.connex.boxes.map(b => {
    const bomNames = (b.bom_ids || []).map(bid => {
      const bom = STATE.boms.find(bm => bm.bom_id === bid);
      return bom ? (bom.nomenclature || bom.filename || bid.slice(0,8)).slice(0,30) : bid.slice(0,8);
    });
    const indCount = (b.individual_items || []).length;
    const populated = bomNames.length > 0 || indCount > 0;
    let badgeCls, badgeText;
    if (!populated)           { badgeCls = "cx-badge cx-badge--empty"; badgeText = "Empty"; }
    else if (b.complete)      { badgeCls = "cx-badge cx-badge--ok";    badgeText = "Ready"; }
    else if (!b.sloc || !b.shrh_poc) { badgeCls = "cx-badge cx-badge--warn"; badgeText = "Needs SLOC/SHRH"; }
    else                      { badgeCls = "cx-badge cx-badge--warn";  badgeText = "Incomplete"; }

    const contentLines = [
      ...bomNames.map(n => `<div style="font-size:var(--text-xs);color:var(--connex-light);padding:2px 0;border-bottom:1px solid var(--connex-stroke);">${esc(n)}</div>`),
      ...(indCount > 0 ? [`<div style="font-size:var(--text-xs);color:var(--connex-gray);">+ ${indCount} individual item(s)</div>`] : []),
    ].join('') || `<div class="cx-field-hint" style="font-size:var(--text-xs);">No BOMs assigned</div>`;

    return `<div class="cx-panel cx-panel--2" style="margin-bottom:var(--space-2);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2);">
        <strong style="color:var(--connex-light);">Box ${b.box_num}</strong>
        <span class="${badgeCls}">${badgeText}</span>
      </div>
      <div style="margin-bottom:var(--space-2);">${contentLines}</div>
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
  const tbody = $("bom-table-body");
  if (tbody && STATE.boms.length) tbody.innerHTML = renderBomTableRows();
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
 * STEP 5 — REVIEW_SEAL
 * Audit flags + box checklist (no 3D)
 * ========================================================= */
function renderReviewSealStep(center, right) {
  const boxes     = (STATE.connex && STATE.connex.boxes) || [];
  const populated = boxes.filter(b => (b.bom_ids && b.bom_ids.length) || (b.individual_items && b.individual_items.length));

  // Audit flags
  const flags = [];
  const allBoms = STATE.boms || [];

  // Flag BOMs missing LIN
  const bomsNoLin = allBoms.filter(b => !b.lin);
  if (bomsNoLin.length) flags.push({ type: "warn", msg: `${bomsNoLin.length} BOM(s) have no LIN — verify before sealing.` });

  // Flag BOMs missing serial number
  const bomsNoSn = allBoms.filter(b => !b.serial_number);
  if (bomsNoSn.length) flags.push({ type: "warn", msg: `${bomsNoSn.length} BOM(s) have no Serial Number.` });

  // Flag unassigned BOMs
  const unassigned = allBoms.filter(b => !bomAssignedBox(b));
  if (unassigned.length) flags.push({ type: "error", msg: `${unassigned.length} BOM(s) are not assigned to any box.` });

  // Flag empty boxes
  const emptyBoxes = boxes.filter(b => !(b.bom_ids && b.bom_ids.length) && !(b.individual_items && b.individual_items.length));
  if (emptyBoxes.length) flags.push({ type: "error", msg: `Box(es) ${emptyBoxes.map(b => b.box_num).join(", ")} are empty — assign items or reduce box count.` });

  // Flag boxes missing SLOC or SHRH
  populated.forEach(b => {
    if (!b.sloc)     flags.push({ type: "warn", msg: `Box ${b.box_num}: missing SLOC.` });
    if (!b.shrh_poc) flags.push({ type: "warn", msg: `Box ${b.box_num}: missing SHRH POC.` });
  });

  if (!flags.length) flags.push({ type: "ok", msg: "All checks passed — connex is ready to seal." });

  const flagsHtml = flags.map(f => `<div class="cx-flag cx-flag--${f.type}">${esc(f.msg)}</div>`).join('');

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
      <td style="font-weight:600;">Box ${b.box_num}</td>
      <td class="cx-mono" style="font-size:var(--text-xs);">${esc(b.sloc || "—")}</td>
      <td style="font-size:var(--text-xs);">${esc(b.shrh_poc || "—")}</td>
      <td style="font-size:var(--text-xs);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(bomNomenclature)}">${esc(bomNomenclature)}</td>
      <td style="text-align:center;">${itemCount}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  center.innerHTML = `
    <div class="cx-panel" style="margin-bottom:var(--space-3);">
      <h2 class="cx-panel__title">5 &middot; Review &amp; Seal</h2>
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
}

window.applyStampAndGenerate = async function() {
  if (!STATE.connex) return;
  const status = $("review-generate-status");
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
    body: "Ingest your BOM PDFs, then use the assignment table to pick which box each BOM goes to. Give each box its SLOC and SHRH POC in the right rail. Add loose individual items directly to any box.",
  },
  {
    badge: "Step 4",
    heading: "Seal Data",
    body: "Enter your SUN #, CONNEX #, and SEAL # (leave blank to print a placeholder), plus who packed and who signs. Tap the ? on any field for help — SEAL # and CONNEX # show a photo of where to read the number.",
  },
  {
    badge: "Step 5",
    heading: "Review & Seal",
    body: "Run an audit on your connex — CRATE flags missing LINs, serial numbers, empty boxes, and missing SLOC/SHRH POC. Resolve all errors, then apply your stamp and download your 1750s.",
  },
  {
    badge: "Step 6",
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
