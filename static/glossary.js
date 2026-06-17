/* glossary.js — CONNEX 1750 jargon term map.
 * Owned by: Frontend agent.
 * Source of truth: 03_UI_REDESIGN_SYSTEM.md §5 / ui-design handoff.
 * Every ambiguous label in the UI must have a ? wired to one of these entries.
 * Do NOT add new terms here without a matching .cx-help popover in index.html / app.js.
 *
 * Entry shape:
 *   { term, copy, [img], [caption] }
 *   img     — optional URL served at /static/help/<file>.jpg
 *   caption — short line rendered under the image
 */

export const GLOSSARY = {
  "SLOC":     { term: "SLOC",     copy: "Storage Location Code — where this box/item is physically stored (e.g. building, room, yard slot)." },
  "SHRH POC": { term: "SHRH POC", copy: "Sub-Hand Receipt Holder, Point of Contact — the person accountable for these items." },
  "SUN #":    { term: "SUN #",    copy: "Shipment Unit Number — a unique, alphanumeric tracking code used by a Unit Movement Officer (UMO) to track, load, and manifest military equipment during deployments." },
  "CONNEX #": {
    term: "CONNEX #",
    copy: "The container's identifying number. Leave blank to print a placeholder.",
    img: "/static/help/connex-location.jpg",
    caption: "The container number (e.g. SBIU 208788) is stencilled on the connex door and side.",
  },
  "SEAL #": {
    term: "SEAL #",
    copy: "The numbered security seal on the connex doors. Leave blank to print a placeholder.",
    img: "/static/help/seal-location.jpg",
    caption: "The seal number is stamped on the connex seal.",
  },
  "NSN":      { term: "NSN",      copy: "National Stock Number — 13-digit supply ID (e.g. 1005-01-231-0973)." },
  "LIN":      { term: "LIN",      copy: "Line Item Number — 6-character item identifier (e.g. M39331)." },
  "NIIN":     { term: "NIIN",     copy: "National Item Identification Number — the 9-digit core of an NSN." },
  "UOI":      { term: "UOI",      copy: "Unit of Issue — how the item is counted (EA = each, BX = box, etc.)." },
  "CONNEX":   { term: "CONNEX",   copy: "Intermodal shipping container used to pack and transport equipment. Each connex holds multiple boxes." },
  "SEAL":     { term: "SEAL",     copy: "Numbered tamper-evident seal applied to connex doors at closure. Recorded on the DD1750 for accountability." },
  "SUN":      { term: "SUN",      copy: "Shipment Unit Number — top-level tracking ID for this connex shipment. Can be left blank; a placeholder prints on the PDF." },
};

/* buildHelpPopover(key) — returns the HTML string for a .cx-help span.
 * Use this in render functions rather than hand-writing each popover.
 * When entry.img is set, renders a reference photo + caption inside the popover. */
export function buildHelpPopover(key) {
  const entry = GLOSSARY[key];
  if (!entry) return "";
  const safeTerm    = entry.term.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const safeCopy    = entry.copy.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const safeImg     = entry.img     ? entry.img.replace(/"/g, "&quot;")     : "";
  const safeCaption = entry.caption ? entry.caption.replace(/&/g, "&amp;").replace(/</g, "&lt;") : "";

  /* Optional image block — only emitted when entry.img is present */
  const imgBlock = safeImg
    ? `<img src="${safeImg}" alt="${safeCaption || safeTerm}" loading="lazy"
            style="max-width:100%;border-radius:6px;margin-top:6px;display:block;">
       ${safeCaption ? `<span style="display:block;font-size:11px;color:var(--connex-gray);margin-top:4px;">${safeCaption}</span>` : ""}`
    : "";

  return `<span class="cx-help">
    <button class="cx-help__trigger" aria-label="What is ${safeTerm}?" onclick="toggleHelp(this)">?</button>
    <div class="cx-help__popover" role="tooltip"
         style="max-width:280px;max-height:70vh;overflow-y:auto;">
      <span class="cx-help__term">${safeTerm}</span>
      ${safeCopy}
      ${imgBlock}
    </div>
  </span>`;
}
