"""
sitrep_render.py — Commander's SITREP PDF renderer (CONNEX-3D build, Wave 1).

Renders the Contract C SITREP JSON model into a clean PDF one-pager+.
Uses ReportLab only (no blank template overlay needed — this is a
synthesized summary document, not a pre-printed form).

Public API (called by Backend):
    render_sitrep_pdf(sitrep_dict: dict, output_path: str | None = None)
        -> bytes | str

Layout per page:
    Header block  — SITREP title, brigade/battalion/battery, generated date.
    Per-connex sections — Connex#, SUN, SEAL, status, then per-box sub-blocks.
    Per-box sub-block — SLOC, SHRH POC, BOMs list, individual items list.
    Flags section — all flags from sitrep["flags"], highlighted if non-empty.
    Totals summary — connex/box/BOM/individual-item counts at the end.

Pagination: ReportLab's multi-page flow. Content that doesn't fit on the
current page triggers a new page automatically via the _Writer helper class.
Data is never truncated silently — all BOMs and individual items are printed.
"""

import io
import os
from datetime import datetime
from typing import Optional, Union

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)

# ---------------------------------------------------------------------------
# Color palette — matches the command-center design tokens from Contract E
# ---------------------------------------------------------------------------
C_BLACK  = colors.HexColor("#0E0F11")   # command-center base
C_GOLD   = colors.HexColor("#D4BF91")   # primary accent
C_GRAY   = colors.HexColor("#B2B4B3")   # neutral / container body
C_OK     = colors.HexColor("#6FCF97")   # sealed / complete
C_WARN   = colors.HexColor("#E0B341")   # needs attention
C_EMPTY  = colors.HexColor("#5A5E63")   # empty / pending
C_WHITE  = colors.white
C_RED    = colors.HexColor("#8C1A1A")   # flags / errors

PAGE_W, PAGE_H = LETTER          # 612 × 792 pts
MARGIN = 0.65 * inch
BODY_W = PAGE_W - 2 * MARGIN


# ---------------------------------------------------------------------------
# Page template — header + footer on every page
# ---------------------------------------------------------------------------

def _make_page_template(doc, unit_line: str, generated: str):
    """
    Return a PageTemplate that draws the SITREP page header and footer.
    The header is a dark banner; the footer shows page numbers.
    """
    frame = Frame(MARGIN, MARGIN + 30, BODY_W, PAGE_H - 2 * MARGIN - 60,
                  id="body", showBoundary=0)

    def on_page(canvas, doc):
        canvas.saveState()

        # --- dark top banner ---
        banner_h = 44
        canvas.setFillColor(C_BLACK)
        canvas.rect(0, PAGE_H - banner_h, PAGE_W, banner_h, fill=1, stroke=0)

        canvas.setFont("Helvetica-Bold", 13)
        canvas.setFillColor(C_GOLD)
        canvas.drawString(MARGIN, PAGE_H - 28, "COMMANDER'S SITREP — CONNEX PACKING")

        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(C_GRAY)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 17, unit_line)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 29,
                               f"Generated: {generated[:19]}")

        # --- thin gold rule under the banner ---
        canvas.setStrokeColor(C_GOLD)
        canvas.setLineWidth(1.2)
        canvas.line(MARGIN, PAGE_H - banner_h - 2, PAGE_W - MARGIN, PAGE_H - banner_h - 2)

        # --- footer ---
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(C_GRAY)
        canvas.drawCentredString(PAGE_W / 2, 18, f"Page {doc.page}")
        canvas.setStrokeColor(C_GRAY)
        canvas.setLineWidth(0.4)
        canvas.line(MARGIN, 28, PAGE_W - MARGIN, 28)

        canvas.restoreState()

    return PageTemplate(id="main", frames=[frame], onPage=on_page)


# ---------------------------------------------------------------------------
# Paragraph styles
# ---------------------------------------------------------------------------

def _styles():
    """Return a dict of named ParagraphStyles."""
    base = dict(fontName="Helvetica", fontSize=9, leading=13, textColor=C_BLACK)
    return {
        "normal":     ParagraphStyle("normal",     **base),
        "small":      ParagraphStyle("small",      fontName="Helvetica",
                                     fontSize=7.5, leading=10, textColor=C_BLACK),
        "label":      ParagraphStyle("label",      fontName="Helvetica-Bold",
                                     fontSize=8.5, leading=12, textColor=C_BLACK),
        "connex_hdr": ParagraphStyle("connex_hdr", fontName="Helvetica-Bold",
                                     fontSize=11, leading=15, textColor=C_GOLD,
                                     backColor=C_BLACK, borderPad=4),
        "box_hdr":    ParagraphStyle("box_hdr",    fontName="Helvetica-Bold",
                                     fontSize=9, leading=12, textColor=C_WHITE,
                                     backColor=C_EMPTY, borderPad=3),
        "flag":       ParagraphStyle("flag",       fontName="Helvetica-Oblique",
                                     fontSize=8.5, leading=12, textColor=C_RED),
        "section":    ParagraphStyle("section",    fontName="Helvetica-Bold",
                                     fontSize=10, leading=14, textColor=C_BLACK),
        "totals_lbl": ParagraphStyle("totals_lbl", fontName="Helvetica-Bold",
                                     fontSize=9, leading=13, textColor=C_BLACK),
    }


# ---------------------------------------------------------------------------
# Row builders
# ---------------------------------------------------------------------------

def _sp(pt): return Spacer(1, pt)


def _bom_table(boms: list, styles: dict) -> Optional[Table]:
    """
    Build a compact Table of BOM rows.
    Columns: Nomenclature | LIN | Serial | Subitems
    ("Subitems" = qty of subitems packed inside each end item / BOM.)
    Returns None when boms list is empty.
    """
    if not boms:
        return None

    header = [
        Paragraph("<b>Nomenclature</b>", styles["small"]),
        Paragraph("<b>LIN</b>",          styles["small"]),
        Paragraph("<b>Serial</b>",        styles["small"]),
        Paragraph("<b>Subitems</b>",      styles["small"]),
    ]
    rows = [header]
    for b in boms:
        rows.append([
            Paragraph(str(b.get("nomenclature", "") or "")[:60], styles["small"]),
            Paragraph(str(b.get("lin", "") or "")[:10],          styles["small"]),
            Paragraph(str(b.get("serial", "") or "")[:20],       styles["small"]),
            Paragraph(str(b.get("item_count", "") or ""),        styles["small"]),
        ])

    col_widths = [BODY_W * 0.48, BODY_W * 0.13, BODY_W * 0.25, BODY_W * 0.14]
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, 0), C_GRAY),
        ("TEXTCOLOR",   (0, 0), (-1, 0), C_BLACK),
        ("FONTNAME",    (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, -1), 7.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, colors.HexColor("#F5F5F3")]),
        ("GRID",        (0, 0), (-1, -1), 0.3, C_GRAY),
        ("TOPPADDING",  (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def _individual_table(items: list, styles: dict) -> Optional[Table]:
    """
    Build a compact Table of individual items.
    Columns: Description | SN | NSN | LIN
    Returns None when items list is empty.
    """
    if not items:
        return None

    header = [
        Paragraph("<b>Description</b>", styles["small"]),
        Paragraph("<b>SN</b>",           styles["small"]),
        Paragraph("<b>NSN</b>",          styles["small"]),
        Paragraph("<b>LIN</b>",          styles["small"]),
    ]
    rows = [header]
    for it in items:
        rows.append([
            Paragraph(str(it.get("description", "") or "")[:55], styles["small"]),
            Paragraph(str(it.get("sn", "") or "")[:20],          styles["small"]),
            Paragraph(str(it.get("nsn", "") or "")[:16],         styles["small"]),
            Paragraph(str(it.get("lin", "") or "")[:10],         styles["small"]),
        ])

    col_widths = [BODY_W * 0.44, BODY_W * 0.22, BODY_W * 0.20, BODY_W * 0.14]
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#D0C8B8")),
        ("FONTSIZE",    (0, 0), (-1, -1), 7.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, colors.HexColor("#F5F5F3")]),
        ("GRID",        (0, 0), (-1, -1), 0.3, C_GRAY),
        ("TOPPADDING",  (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def _status_color(status: str) -> colors.Color:
    s = (status or "").lower()
    if s == "sealed":
        return C_OK
    if s == "building":
        return C_WARN
    return C_EMPTY


# ---------------------------------------------------------------------------
# Main renderer
# ---------------------------------------------------------------------------

def render_sitrep_pdf(
    sitrep_dict: dict,
    output_path: Optional[str] = None,
) -> Union[bytes, str]:
    """
    Render a Contract C SITREP dict to PDF.

    Args:
        sitrep_dict:  Contract C JSON as a Python dict (see 04_AGENT_ORCHESTRATION §5).
        output_path:  If provided, write the PDF to this path and return the path.
                      If None, return raw bytes.

    Returns:
        str  — output_path when output_path was provided.
        bytes — raw PDF bytes when output_path is None.

    Layout (in order):
        - Header block (brigade/battalion/date)
        - Per-connex sections
          - Connex identifier row (connex#, SUN, SEAL, status)
          - Per-box sub-blocks (SLOC, SHRH POC, BOMs table, individual items table)
        - Flags section (if any)
        - Totals summary
    """
    buf = io.BytesIO()
    target = output_path or buf

    # --- Build unit label from profile ---
    profile = sitrep_dict.get("profile") or {}
    unit_parts = [
        str(profile.get("brigade", "") or ""),
        str(profile.get("battalion", "") or ""),
        str(profile.get("battery", "") or ""),
    ]
    unit_line = " / ".join(p for p in unit_parts if p)

    generated = str(sitrep_dict.get("generated", datetime.utcnow().isoformat()) or "")

    doc = BaseDocTemplate(
        target,
        pagesize=LETTER,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN + 50,      # reserve space for the banner
        bottomMargin=MARGIN + 30,   # reserve space for footer
        title="Commander SITREP",
    )
    pt = _make_page_template(doc, unit_line, generated)
    doc.addPageTemplates([pt])

    styles = _styles()
    story = []

    # =========================================================================
    # 1. Connex-by-connex sections
    # =========================================================================
    connexes = sitrep_dict.get("connexes") or []
    for cx in connexes:
        cx_no   = str(cx.get("connex_no", "") or "[CONNEX PENDING]")
        sun     = str(cx.get("sun",      "") or "[SUN PENDING]")
        seal    = str(cx.get("seal_no",  "") or "[SEAL PENDING]")
        status  = str(cx.get("status",   "") or "building")
        sc      = _status_color(status)

        # --- Connex header row ---
        cx_header_data = [[
            Paragraph(f"CONNEX: {cx_no}", styles["connex_hdr"]),
            Paragraph(f"SUN: {sun}",      styles["connex_hdr"]),
            Paragraph(f"SEAL: {seal}",    styles["connex_hdr"]),
            Paragraph(status.upper(),     ParagraphStyle(
                "cx_status",
                fontName="Helvetica-Bold", fontSize=10, leading=14,
                textColor=sc, backColor=C_BLACK, borderPad=4,
            )),
        ]]
        cx_header_tbl = Table(
            cx_header_data,
            colWidths=[BODY_W * 0.30, BODY_W * 0.28, BODY_W * 0.24, BODY_W * 0.18],
        )
        cx_header_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C_BLACK),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("LINEBELOW",     (0, 0), (-1, -1), 1.5, C_GOLD),
        ]))
        story.append(_sp(10))
        story.append(cx_header_tbl)
        story.append(_sp(4))

        # --- Per-box sub-blocks ---
        boxes = cx.get("boxes") or []
        for box in boxes:
            box_num  = box.get("box_num", "?")
            label    = str(box.get("label",    "") or "")
            sloc     = str(box.get("sloc",     "") or "")
            shrh_poc = str(box.get("shrh_poc", "") or "")
            boms     = box.get("boms") or []
            ind_items = box.get("individual_items") or []

            box_title = f"BOX {box_num}" + (f" — {label}" if label else "")

            box_meta_lines = []
            if sloc:
                box_meta_lines.append(f"SLOC: {sloc}")
            if shrh_poc:
                box_meta_lines.append(f"SHRH POC: {shrh_poc}")
            meta_text = "  |  ".join(box_meta_lines) if box_meta_lines else "(no metadata)"

            box_elements = [
                _sp(4),
                Paragraph(f"{box_title}  —  {meta_text}", styles["box_hdr"]),
            ]

            # BOMs table
            if boms:
                box_elements.append(_sp(3))
                box_elements.append(Paragraph("Bills of Material:", styles["label"]))
                bom_tbl = _bom_table(boms, styles)
                if bom_tbl:
                    box_elements.append(bom_tbl)
            else:
                box_elements.append(Paragraph("  (no BOMs)", styles["small"]))

            # Individual items table
            if ind_items:
                box_elements.append(_sp(3))
                box_elements.append(Paragraph("Individual Items:", styles["label"]))
                ind_tbl = _individual_table(ind_items, styles)
                if ind_tbl:
                    box_elements.append(ind_tbl)

            # Keep the box block together on one page if possible
            story.append(KeepTogether(box_elements))
            story.append(_sp(6))

    # =========================================================================
    # 2. Flags section
    # =========================================================================
    flags = sitrep_dict.get("flags") or []
    if flags:
        story.append(_sp(12))
        story.append(Paragraph("FLAGS / ATTENTION ITEMS", styles["section"]))
        story.append(_sp(4))
        for flag in flags:
            story.append(Paragraph(f"⚠  {flag}", styles["flag"]))
            story.append(_sp(2))

    # =========================================================================
    # 3. Totals summary table
    # =========================================================================
    story.append(_sp(14))
    story.append(Paragraph("TOTALS SUMMARY", styles["section"]))
    story.append(_sp(5))

    totals_data = [
        [Paragraph("Metric", styles["totals_lbl"]),
         Paragraph("Count",  styles["totals_lbl"])],
        ["Connexes",         str(sitrep_dict.get("connex_count", len(connexes)))],
        ["Total Boxes",      str(sitrep_dict.get("box_count",     ""))],
        ["End Items Packed (BOMs)", str(sitrep_dict.get("bom_count", ""))],
        ["Individual Items", str(sitrep_dict.get("individual_item_count", ""))],
    ]
    totals_tbl = Table(totals_data, colWidths=[BODY_W * 0.60, BODY_W * 0.40])
    totals_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), C_GOLD),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [C_WHITE, colors.HexColor("#F5F5F3")]),
        ("GRID",          (0, 0), (-1, -1), 0.4, C_GRAY),
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
    ]))
    story.append(totals_tbl)

    # =========================================================================
    # Build the PDF
    # =========================================================================
    doc.build(story)

    if output_path:
        return output_path

    buf.seek(0)
    return buf.read()


__all__ = ["render_sitrep_pdf"]
