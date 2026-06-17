/* glossary.js — CONNEX 1750 jargon term map.
 * Owned by: Frontend agent.
 * Source of truth: 03_UI_REDESIGN_SYSTEM.md §5 / ui-design handoff.
 * Every ambiguous label in the UI must have a ? wired to one of these entries.
 * Do NOT add new terms here without a matching .cx-help popover in index.html / app.js.
 */

export const GLOSSARY = {
  "SLOC":     { term: "SLOC",     copy: "Storage Location Code — where this box/item is physically stored (e.g. building, room, yard slot)." },
  "SHRH POC": { term: "SHRH POC", copy: "Sub-Hand Receipt Holder, Point of Contact — the person accountable for these items." },
  "SUN #":    { term: "SUN #",    copy: "Shipment Unit Number — the tracking number for this connex/shipment. Leave blank to print a placeholder." },
  "CONNEX #": { term: "CONNEX #", copy: "The container's identifying number. Leave blank to print a placeholder." },
  "SEAL #":   { term: "SEAL #",   copy: "The numbered security seal on the connex doors. Leave blank to print a placeholder." },
  "NSN":      { term: "NSN",      copy: "National Stock Number — 13-digit supply ID (e.g. 1005-01-231-0973)." },
  "LIN":      { term: "LIN",      copy: "Line Item Number — 6-character item identifier (e.g. M39331)." },
  "NIIN":     { term: "NIIN",     copy: "National Item Identification Number — the 9-digit core of an NSN." },
  "UOI":      { term: "UOI",      copy: "Unit of Issue — how the item is counted (EA = each, BX = box, etc.)." },
  "CONNEX":   { term: "CONNEX",   copy: "Intermodal shipping container used to pack and transport equipment. Each connex holds multiple boxes." },
  "SEAL":     { term: "SEAL",     copy: "Numbered tamper-evident seal applied to connex doors at closure. Recorded on the DD1750 for accountability." },
  "SUN":      { term: "SUN",      copy: "Shipment Unit Number — top-level tracking ID for this connex shipment. Can be left blank; a placeholder prints on the PDF." },
};

/* buildHelpPopover(key) — returns the HTML string for a .cx-help span.
 * Use this in render functions rather than hand-writing each popover. */
export function buildHelpPopover(key) {
  const entry = GLOSSARY[key];
  if (!entry) return "";
  const safeKey  = key.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const safeTerm = entry.term.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const safeCopy = entry.copy.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<span class="cx-help">
    <button class="cx-help__trigger" aria-label="What is ${safeTerm}?" onclick="toggleHelp(this)">?</button>
    <div class="cx-help__popover" role="tooltip">
      <span class="cx-help__term">${safeTerm}</span>
      ${safeCopy}
    </div>
  </span>`;
}
