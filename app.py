"""
app.py — Flask web app for the Master DD1750 Packing List tool.

Routes:
  GET  /              -> the single-page UI (templates/index.html)
  POST /upload        -> accept a batch of child 1750 PDFs, parse filenames,
                         sniff NSNs, aggregate, return rows JSON for the table
  POST /generate      -> take finalized rows + header JSON, render the master
                         DD1750 PDF, stream it back as a download
  POST /audit         -> take finalized rows + header JSON, run audit_master,
                         return the pass/fail report
  GET  /api/health    -> liveness probe for Railway

The heavy lifting lives in master_core (new logic) and render_core (v25's proven
renderer). This file is just plumbing: request parsing, temp-file handling, and
JSON/PDF responses.
"""

import csv
import io
import os
import re
import tempfile
import zipfile
from collections import Counter
from datetime import datetime
from uuid import uuid4

from flask import (
    Flask, render_template, request, jsonify, send_file, abort
)
from werkzeug.utils import secure_filename

import bom_ingest
import shr_ingest
import reconcile as reconcile_mod
import packing
import master_core
import render_core

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB batch ceiling

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PDF = os.path.join(BASE_DIR, "blank_1750.pdf")

# In-memory job store.  Assumes a single gunicorn worker — fine for this
# single-user tool.  Each key is a uuid4 hex; value is the full job dict.
JOBS: dict = {}


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Upload + parse a batch of child 1750 PDFs
# ---------------------------------------------------------------------------

@app.route("/upload", methods=["POST"])
def upload():
    """
    Accept multipart 'files' (one or many PDFs). For each:
      - parse the filename into a ParsedMEI (shape-based classifier)
      - best-effort sniff the NSN from the PDF body
    Then aggregate into master rows and return them as JSON.

    Response: {"rows": [ {box_num, model, lin, nsn, serials[], qty, needs_review}, ... ],
               "file_count": N, "parsed": [ per-file parse for transparency ]}
    """
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files uploaded (expected form field 'files')."}), 400

    parsed_list = []
    per_file = []

    # Work inside one temp dir so sniff_nsn can read the bytes from disk.
    with tempfile.TemporaryDirectory() as tmpdir:
        for f in files:
            if not f or not f.filename:
                continue
            fname = f.filename
            # Skip anything that isn't a PDF (the test data has a stray directory
            # entry with no .pdf extension).
            if not fname.lower().endswith(".pdf"):
                continue

            mei = master_core.parse_filename(fname)

            # Best-effort NSN sniff from the saved bytes.
            try:
                safe = secure_filename(fname) or "upload.pdf"
                disk_path = os.path.join(tmpdir, safe)
                f.save(disk_path)
                nsn = master_core.sniff_nsn(disk_path)
            except Exception:
                nsn = ""
            # Stash the sniffed NSN on the object so aggregate_meis can use it.
            setattr(mei, "nsn_sniffed", nsn)

            parsed_list.append(mei)
            d = mei.to_dict()
            d["nsn"] = nsn
            per_file.append(d)

    if not parsed_list:
        return jsonify({"error": "No PDF files found in the upload."}), 400

    rows = master_core.aggregate_meis(parsed_list)
    return jsonify({
        "rows": [r.to_dict() for r in rows],
        "file_count": len(parsed_list),
        "parsed": per_file,
    })


# ---------------------------------------------------------------------------
# Upload SHR CSV (from shr-extractor) → return rows for the review table
# ---------------------------------------------------------------------------

@app.route("/upload-csv", methods=["POST"])
def upload_csv():
    """
    Accept a single CSV file exported by the shr-extractor tool.
    Expected columns: lin, mpo_description, nsn, nsn_description, oh_qty,
                      serial_number, unit, date
    Groups rows by (lin, nsn) so each unique item becomes one master row
    with all its serial numbers consolidated.

    Response: {"rows": [...], "record_count": N}
    """
    f = request.files.get("csv")
    if not f or not f.filename:
        return jsonify({"error": "No CSV file provided (expected form field 'csv')."}), 400
    if not f.filename.lower().endswith(".csv"):
        return jsonify({"error": "File must be a .csv export from the SHR extractor."}), 400

    try:
        text = f.read().decode("utf-8-sig")  # strip BOM if present
        reader = csv.DictReader(io.StringIO(text))
        raw_rows = list(reader)
    except Exception as e:
        return jsonify({"error": f"Could not parse CSV: {e}"}), 400

    if not raw_rows:
        return jsonify({"error": "CSV is empty."}), 400

    # Normalise column names (strip whitespace, lowercase)
    def col(row, *names):
        for n in names:
            for k, v in row.items():
                if k.strip().lower() == n:
                    return (v or "").strip()
        return ""

    # Group by (lin, nsn) → one MasterRow per unique item
    from collections import OrderedDict
    groups = OrderedDict()
    record_count = 0

    for raw in raw_rows:
        record_count += 1
        lin = col(raw, "lin").upper()
        nsn = col(raw, "nsn")
        model = col(raw, "nsn_description", "mpo_description")
        sn = col(raw, "serial_number")
        try:
            qty = int(col(raw, "oh_qty") or "1")
        except ValueError:
            qty = 1

        key = (lin, nsn)
        if key not in groups:
            groups[key] = {
                "model": model,
                "lin": lin,
                "nsn": nsn,
                "serials": [],
                "qty": qty,
                "needs_review": False,
            }
        if sn and sn not in groups[key]["serials"]:
            groups[key]["serials"].append(sn)

    # Assign box numbers and update qty to serial count where serials exist
    rows = []
    for i, (key, row) in enumerate(groups.items(), start=1):
        row["box_num"] = i
        if row["serials"]:
            row["qty"] = len(row["serials"])
        rows.append(row)

    return jsonify({"rows": rows, "record_count": record_count})


# ---------------------------------------------------------------------------
# Generate the master DD1750 PDF
# ---------------------------------------------------------------------------

@app.route("/generate", methods=["POST"])
def generate():
    """
    Body: {"rows": [...], "header": {...}}
    Renders the master DD1750 and streams it back as Master_DD1750.pdf.
    """
    data = request.get_json(silent=True) or {}
    rows = data.get("rows", [])
    header = data.get("header", {})

    if not rows:
        return jsonify({"error": "No rows provided to generate."}), 400

    # Re-sequence box numbers 1..N defensively (UI should already do this).
    for i, r in enumerate(rows, start=1):
        r["box_num"] = i

    items = master_core.rows_to_bom_items(rows)
    header_info = master_core.build_master_header(header, rows)

    # Render to a temp file, then stream it.
    out_fd, out_path = tempfile.mkstemp(suffix=".pdf")
    os.close(out_fd)
    try:
        render_core.generate_dd1750_from_items(
            items,
            TEMPLATE_PDF,
            out_path,
            header=header_info,
            draw_master_header_fn=render_core.draw_master_header,
        )
        with open(out_path, "rb") as fh:
            pdf_bytes = fh.read()
    finally:
        try:
            os.remove(out_path)
        except OSError:
            pass

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="Master_DD1750.pdf",
    )


# ---------------------------------------------------------------------------
# Audit the master structure
# ---------------------------------------------------------------------------

@app.route("/audit", methods=["POST"])
def audit():
    """
    Body: {"rows": [...], "header": {...}}
    Runs audit_master and returns {passed, issues[], box_count}.
    """
    data = request.get_json(silent=True) or {}
    rows = data.get("rows", [])
    header = data.get("header", {})
    result = master_core.audit_master(rows, header)
    return jsonify(result)


# ---------------------------------------------------------------------------
# Health probe
# ---------------------------------------------------------------------------

@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "master-1750-tool",
        "template_present": os.path.exists(TEMPLATE_PDF),
    })


# ---------------------------------------------------------------------------
# Helper: find the representative (first-item) box for a BOM in a box_map
# ---------------------------------------------------------------------------

def _representative_box(bom: dict, box_map: dict) -> int | None:
    """Return the box number of the BOM's first item, or None if no items."""
    bom_id = bom["bom_id"]
    for item in bom.get("items", []):
        key = packing.item_key(bom_id, item["line_no"])
        if key in box_map:
            return box_map[key]
    return None


# ---------------------------------------------------------------------------
# POST /ingest — upload BOMs (PDFs) + optional SHR PDF; create a job
# ---------------------------------------------------------------------------

@app.route("/ingest", methods=["POST"])
def ingest():
    """
    Multipart form fields:
      boms  — one or many PDF files (the child 1750 BOMs)
      shr   — optional single PDF (the hand-receipt / SHR)

    Creates a job, returns JSON with job_id and per-BOM metadata.
    """
    bom_files = request.files.getlist("boms")
    shr_file = request.files.get("shr")

    if not bom_files:
        return jsonify({"error": "No BOM files provided (field: 'boms')."}), 400

    boms = []       # list of ingest_bom result dicts
    shr_dict = None

    with tempfile.TemporaryDirectory() as tmpdir:
        # --- Ingest each BOM PDF ---
        for f in bom_files:
            if not f or not f.filename:
                continue
            fname = f.filename
            safe = secure_filename(fname) or "bom.pdf"
            disk_path = os.path.join(tmpdir, safe)
            f.save(disk_path)
            # Use the filename stem (no extension) as the nomenclature label.
            nomenclature = os.path.splitext(fname)[0]
            bom = bom_ingest.ingest_bom(disk_path, nomenclature=nomenclature)
            boms.append(bom)

        if not boms:
            return jsonify({"error": "No valid PDF BOM files found."}), 400

        # --- Ingest SHR if provided ---
        if shr_file and shr_file.filename:
            safe_shr = secure_filename(shr_file.filename) or "shr.pdf"
            shr_path = os.path.join(tmpdir, safe_shr)
            shr_file.save(shr_path)
            shr_dict = shr_ingest.ingest_shr(shr_path)

        # --- Reconcile (if SHR present) ---
        reconciliation = None
        if shr_dict:
            reconciliation = reconcile_mod.reconcile(boms, shr_dict)

        # --- Default box assignment: GROUP like end items (same LIN/NIIN) ---
        # An arms room with 50 identical M4s starts as one box (qty 50), boxes
        # numbered 1..N with no gaps.  The user pulls individual end items into
        # their own box later via a 'separate' move.
        box_map = packing.grouped_box_map(boms)

    # --- Suggested header ---
    # UIC: pick the most common non-empty value from the BOMs.
    uic_counts = Counter(
        b.get("uic", "").strip() for b in boms if b.get("uic", "").strip()
    )
    suggested_uic = uic_counts.most_common(1)[0][0] if uic_counts else ""
    today_str = datetime.utcnow().strftime("%d %b %Y").upper()

    # --- Build response: per-BOM metadata ---
    rec_by_bom = (reconciliation or {}).get("by_bom", {})
    boms_out = []
    for bom in boms:
        bom_id = bom["bom_id"]
        rep_box = _representative_box(bom, box_map)
        rec_entry = rec_by_bom.get(bom_id, {})
        boms_out.append({
            "bom_id":         bom_id,
            "filename":       bom.get("filename", ""),
            "nomenclature":   bom.get("nomenclature", ""),
            "model":          bom.get("model", ""),
            "lin":            bom.get("lin", ""),
            "end_item_niin":  bom.get("end_item_niin", ""),
            "serial_number":  bom.get("serial_number", ""),
            "item_count":     bom.get("item_count", 0),
            "box_num":        rep_box,
            "zero_on_hand":   bom.get("zero_on_hand", False),
            "reconcile_status": rec_entry.get("status") if rec_entry else None,
            "items":          bom.get("items", []),  # full component list for UI drill-in
            "warnings":       bom.get("warnings", []),
            "errors":         bom.get("errors", []),
        })

    # Collect per-BOM warnings for easy UI display.
    warnings_by_bom = {
        b["bom_id"]: b.get("warnings", []) for b in boms if b.get("warnings")
    }

    # Create and store the job.
    job_id = uuid4().hex
    JOBS[job_id] = {
        "boms":              boms,
        "shr":               shr_dict,
        "reconciliation":    reconciliation,
        "box_map":           box_map,
        "assigned_bom_ids":  set(),   # only boms explicitly placed by the user
        "created_at":        datetime.utcnow().isoformat(),
    }

    return jsonify({
        "job_id":           job_id,
        "boms":             boms_out,
        "occupied_boxes":   packing.occupied_boxes(box_map),
        "suggested_header": {"uic": suggested_uic, "date": today_str},
        "reconcile_summary": (reconciliation or {}).get("summary"),
        "warnings_by_bom":  warnings_by_bom,
    })


# ---------------------------------------------------------------------------
# POST /assign — move BOMs or individual items to different boxes
# ---------------------------------------------------------------------------

@app.route("/assign", methods=["POST"])
def assign():
    """
    Body: {
        "job_id": "...",
        "moves": [
            {"bom_id": "...", "box_num": 3},        // move entire BOM
            {"item_key": "bom_id:line_no", "box_num": 5}  // move one item
        ]
    }
    Returns updated occupied_boxes and each BOM's representative box.
    """
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    job = JOBS.get(job_id)
    if job is None:
        return jsonify({"error": f"Job '{job_id}' not found."}), 404

    boms = job["boms"]
    box_map = job["box_map"]

    for move in data.get("moves", []):
        # Exclude move: drop every key for this BOM so it leaves the packing
        # list entirely (used to remove a zero-on-hand box that isn't present).
        if move.get("exclude"):
            bom_id = move.get("bom_id")
            bom = next((b for b in boms if b["bom_id"] == bom_id), None)
            if bom is None:
                continue
            box_map = dict(box_map)
            for item in bom.get("items", []):
                box_map.pop(packing.item_key(bom_id, item["line_no"]), None)
            continue

        # Separate move: pull one end item out of its shared box into a new box
        # of its own (the next free number).  Inverse of grouping — e.g. take
        # one M4 out of the box of 50 so it ships separately.
        if move.get("separate"):
            bom_id = move.get("bom_id")
            bom = next((b for b in boms if b["bom_id"] == bom_id), None)
            if bom is None:
                continue
            occ = packing.occupied_boxes(box_map)
            new_box = (max(occ) + 1) if occ else 1
            for item in bom.get("items", []):
                key = packing.item_key(bom_id, item["line_no"])
                box_map = packing.reassign(box_map, key, new_box)
            continue

        target_box = int(move["box_num"])

        if "item_key" in move:
            # Move a single item.
            box_map = packing.reassign(box_map, move["item_key"], target_box)

        elif "bom_id" in move:
            # Move ALL items in this BOM.
            bom_id = move["bom_id"]
            bom = next((b for b in boms if b["bom_id"] == bom_id), None)
            if bom is None:
                continue
            for item in bom.get("items", []):
                key = packing.item_key(bom_id, item["line_no"])
                box_map = packing.reassign(box_map, key, target_box)

    # Persist the updated map back into the job.
    job["box_map"] = box_map

    # Build box_by_bom: bom_id -> representative box.
    box_by_bom = {}
    for bom in boms:
        rep = _representative_box(bom, box_map)
        box_by_bom[bom["bom_id"]] = rep

    return jsonify({
        "occupied_boxes": packing.occupied_boxes(box_map),
        "box_by_bom":     box_by_bom,
    })


# ---------------------------------------------------------------------------
# POST /regroup — re-group like end items (same LIN/NIIN) and recount boxes
# ---------------------------------------------------------------------------

@app.route("/regroup", methods=["POST"])
def regroup():
    """
    Body: {"job_id": "..."}
    Rebuild the box assignment by grouping like end items (same LIN/NIIN) into
    shared boxes, numbered 1..N with no gaps.  This is the "Condense" action:
    it normalizes the packing list back to one box per distinct end item and
    guarantees an accurate, contiguous box count.  Resets any manual splits.
    """
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    job = JOBS.get(job_id)
    if job is None:
        return jsonify({"error": f"Job '{job_id}' not found."}), 404

    boms = job["boms"]
    box_map = packing.grouped_box_map(boms)
    job["box_map"] = box_map

    box_by_bom = {b["bom_id"]: _representative_box(b, box_map) for b in boms}
    return jsonify({
        "occupied_boxes": packing.occupied_boxes(box_map),
        "box_by_bom":     box_by_bom,
    })


# ---------------------------------------------------------------------------
# POST /reconcile — return the stored reconciliation report
# ---------------------------------------------------------------------------

@app.route("/reconcile", methods=["POST"])
def reconcile_report():
    """
    Body: {"job_id": "..."}
    Returns the reconciliation dict (or an empty shell if no SHR was provided).
    """
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    job = JOBS.get(job_id)
    if job is None:
        return jsonify({"error": f"Job '{job_id}' not found."}), 404

    rec = job.get("reconciliation")
    if rec is None:
        rec = {"by_bom": {}, "summary": {"total": 0, "clean": 0, "flagged": 0}}
    return jsonify(rec)


# ---------------------------------------------------------------------------
# PATCH /api/job/<job_id>/bom/<bom_id> — update editable fields on a BOM
# ---------------------------------------------------------------------------

@app.route("/api/job/<job_id>/bom/<bom_id>", methods=["PATCH"])
def patch_bom(job_id, bom_id):
    """
    PATCH /api/job/<job_id>/bom/<bom_id>
    Body: {"serial_number": "...", "lin": "..."}  (any subset)
    Updates the in-memory BOM so subsequent PDF generation uses the new values.
    """
    job = JOBS.get(job_id)
    if job is None:
        return jsonify({"error": f"Job '{job_id}' not found."}), 404
    bom = next((b for b in job["boms"] if b["bom_id"] == bom_id), None)
    if bom is None:
        return jsonify({"error": f"BOM '{bom_id}' not found in job."}), 404
    data = request.get_json(silent=True) or {}
    for field in ("serial_number", "lin"):
        if field in data:
            bom[field] = str(data[field]).strip()
    return jsonify({"bom_id": bom_id, "serial_number": bom.get("serial_number", ""), "lin": bom.get("lin", "")})


# ---------------------------------------------------------------------------
# POST /generate-individuals — render one DD1750 per box, ZIP and stream
# ---------------------------------------------------------------------------

@app.route("/generate-individuals", methods=["POST"])
def generate_individuals():
    """
    Body: {"job_id": "...", "header": {...}}
    Renders one DD1750 PDF per occupied box, zips them, streams as
    Individual_1750s.zip.
    """
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    job = JOBS.get(job_id)
    if job is None:
        return jsonify({"error": f"Job '{job_id}' not found."}), 404

    boms = job["boms"]
    box_map = job["box_map"]
    header = data.get("header", {})
    condense = bool(data.get("condense", False))

    if not packing.occupied_boxes(box_map):
        return jsonify({"error": "No occupied boxes — assign items first."}), 400

    # Build the exact same condensed rows the master PDF uses so that
    # individual 1750 count and box numbers are always identical to the master.
    # Each condensed row → one individual 1750 PDF; items from all physical
    # boxes that share that row are combined and condensed into one list.
    raw_master_rows = packing.boxes_to_master_rows(boms, box_map)
    condensed_rows  = master_core.condense_master_rows(raw_master_rows)
    if not condensed_rows:
        return jsonify({"error": "No rows to render — assign items to boxes first."}), 400

    # Map condensed row (by model+lin key) → physical box numbers that feed it.
    def _mk(row):
        return (
            master_core.normalize_model(str(row.get("model", "") or "")),
            str(row.get("lin", "") or "").strip().upper(),
        )

    from collections import defaultdict
    seq_to_phys: dict = defaultdict(list)
    condensed_key_to_seq = {_mk(r): r["box_num"] for r in condensed_rows}
    for raw in raw_master_rows:
        seq = condensed_key_to_seq.get(_mk(raw))
        if seq is not None:
            seq_to_phys[seq].append(raw["box_num"])

    total_boxes = len(condensed_rows)
    zip_buffer = io.BytesIO()

    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for c_row in condensed_rows:
                seq_num   = c_row["box_num"]
                phys_boxes = seq_to_phys.get(seq_num, [])

                # Collect items from every physical box that belongs to this row.
                raw_items: list = []
                for pb in phys_boxes:
                    raw_items.extend(packing.items_for_box(boms, box_map, pb))

                if not raw_items:
                    continue

                # Condense when explicitly requested OR when multiple physical
                # boxes are merged into one condensed row.
                if condense or len(phys_boxes) > 1:
                    raw_items = packing.condense_items(raw_items)

                bom_items = []
                for it in raw_items:
                    nsn_str = it.get("nsn", "") or ""
                    source_serials = it.get("source_serials", [])
                    if source_serials:
                        sn_part = "SN: " + ", ".join(source_serials)
                        nsn_str = (nsn_str + "  " + sn_part).strip() if nsn_str else sn_part
                    bom_items.append(render_core.BomItem(
                        line_no=seq_num,
                        description=it.get("description", ""),
                        nsn=nsn_str,
                        qty=it.get("qty", 1),
                        unit_of_issue=it.get("unit_of_issue", "EA"),
                    ))

                # Determine distinct source BOMs for the END ITEM header field.
                seen_bom_ids: list = []
                for it in raw_items:
                    if it["bom_id"] not in seen_bom_ids:
                        seen_bom_ids.append(it["bom_id"])
                source_boms = [b for b in boms if b["bom_id"] in seen_bom_ids]

                if len(source_boms) == 1:
                    sb = source_boms[0]
                    end_item_str = render_core.format_end_item(
                        sb.get("nomenclature", ""),
                        sb.get("model", ""),
                        sb.get("serial_number", ""),
                    )
                else:
                    noms = [b.get("nomenclature") or b.get("model", "") for b in source_boms]
                    distinct_noms = list(dict.fromkeys(n for n in noms if n))
                    serials_part = ", ".join(
                        b.get("serial_number", "") for b in source_boms
                        if b.get("serial_number", "")
                    )
                    end_item_str = (
                        f"{distinct_noms[0] if distinct_noms else 'BOX'} "
                        f"({len(source_boms)}x)\nSN: {serials_part}" if serials_part
                        else "; ".join(distinct_noms)
                    )

                hdr = master_core.build_master_header(header, [])
                hdr.end_item = end_item_str
                hdr.num_boxes = str(total_boxes)

                out_fd, out_path = tempfile.mkstemp(suffix=".pdf", dir=tmpdir)
                os.close(out_fd)
                render_core.generate_dd1750_from_items(
                    bom_items,
                    TEMPLATE_PDF,
                    out_path,
                    header=hdr,
                    draw_master_header_fn=render_core.draw_master_header,
                )

                first_nom = (source_boms[0].get("nomenclature")
                             or source_boms[0].get("model", "box")) if source_boms else "box"
                safe_nom = re.sub(r'[^\w\-]', '_', first_nom)[:40]
                zip_name = f"Box_{seq_num:03d}_{safe_nom}.pdf"

                with open(out_path, "rb") as fh:
                    zf.writestr(zip_name, fh.read())

    zip_buffer.seek(0)
    return send_file(
        zip_buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name="Individual_1750s.zip",
    )


# ---------------------------------------------------------------------------
# POST /generate-master — render the master DD1750 PDF and stream it
# ---------------------------------------------------------------------------

@app.route("/generate-master", methods=["POST"])
def generate_master():
    """
    Body: {"job_id": "...", "header": {...}}
    Renders the master DD1750 (one row per occupied box) and streams it as
    Master_DD1750.pdf.
    """
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    job = JOBS.get(job_id)
    if job is None:
        return jsonify({"error": f"Job '{job_id}' not found."}), 404

    boms = job["boms"]
    box_map = job["box_map"]
    header = data.get("header", {})

    rows = packing.boxes_to_master_rows(boms, box_map)
    if not rows:
        return jsonify({"error": "No rows to render — assign items to boxes first."}), 400

    # Collapse same-model end items into one row and re-sequence box numbers 1..N.
    rows = master_core.condense_master_rows(rows)

    items = master_core.rows_to_bom_items(rows)
    hdr = master_core.build_master_header(header, rows)

    out_fd, out_path = tempfile.mkstemp(suffix=".pdf")
    os.close(out_fd)
    try:
        render_core.generate_dd1750_from_items(
            items,
            TEMPLATE_PDF,
            out_path,
            header=hdr,
            draw_master_header_fn=render_core.draw_master_header,
        )
        with open(out_path, "rb") as fh:
            pdf_bytes = fh.read()
    finally:
        try:
            os.remove(out_path)
        except OSError:
            pass

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="Master_DD1750.pdf",
    )


# ===========================================================================
# CONNEX-3D ROUTES — Backend agent (Wave 1)
# All routes below are new additive routes.  They do NOT modify any existing
# route or helper above this line.
# ===========================================================================

import profiles as _profiles
import connex_store as _connex_store
import sitrep as _sitrep

# ---------------------------------------------------------------------------
# Profile routes  (Contract A §Profiles)
# ---------------------------------------------------------------------------

@app.route("/api/profiles", methods=["GET"])
def api_list_profiles():
    """GET /api/profiles -> {profiles: [Profile, ...]}"""
    return jsonify({"profiles": _profiles.list_profiles()})


@app.route("/api/profiles", methods=["POST"])
def api_create_profile():
    """
    POST /api/profiles  body: {brigade, battalion, battery, uic?,
                                default_packed_by?, default_shrh_poc?, stamp_text?,
                                brigade_image?}
    -> {profile: Profile}   (create or upsert by (brigade, battalion, battery))
    """
    data = request.get_json(silent=True) or {}
    brigade   = (data.get("brigade") or "").strip()
    battalion = (data.get("battalion") or "").strip()
    battery   = (data.get("battery") or "").strip()

    if not brigade or not battalion:
        return jsonify({"error": "brigade and battalion are required.", "code": "MISSING_FIELDS"}), 400

    profile = _profiles.upsert_profile(
        brigade=brigade,
        battalion=battalion,
        battery=battery,
        uic=data.get("uic", ""),
        default_packed_by=data.get("default_packed_by", ""),
        default_shrh_poc=data.get("default_shrh_poc", ""),
        stamp_text=data.get("stamp_text", ""),
        brigade_image=data.get("brigade_image", ""),
    )
    return jsonify({"profile": profile})


@app.route("/api/profiles/<profile_id>", methods=["GET"])
def api_get_profile(profile_id):
    """GET /api/profiles/<profile_id> -> {profile: Profile}"""
    profile = _profiles.load_profile(profile_id)
    if profile is None:
        return jsonify({"error": f"Profile '{profile_id}' not found.", "code": "NOT_FOUND"}), 404
    return jsonify({"profile": profile})


# ---------------------------------------------------------------------------
# Connex lifecycle routes  (Contract A §Connex lifecycle)
# ---------------------------------------------------------------------------

@app.route("/api/connex", methods=["POST"])
def api_create_connex():
    """
    POST /api/connex  body: {profile_id, box_count, connex_no?}
    -> {connex: Connex}   status="building", boxes pre-spawned 1..N
    """
    data = request.get_json(silent=True) or {}
    profile_id = data.get("profile_id", "")
    box_count  = data.get("box_count")

    if not profile_id:
        return jsonify({"error": "profile_id is required.", "code": "MISSING_FIELDS"}), 400
    if not isinstance(box_count, int) or box_count < 1:
        return jsonify({"error": "box_count must be a positive integer.", "code": "INVALID_BOX_COUNT"}), 400
    if _profiles.load_profile(profile_id) is None:
        return jsonify({"error": f"Profile '{profile_id}' not found.", "code": "NOT_FOUND"}), 404

    connex = _connex_store.create_connex(
        profile_id=profile_id,
        box_count=box_count,
        connex_no=data.get("connex_no", ""),
    )
    _profiles.touch_last_used(profile_id)
    return jsonify({"connex": connex})


@app.route("/api/connex/<connex_id>", methods=["GET"])
def api_get_connex(connex_id):
    """GET /api/connex/<connex_id> -> {connex: Connex}"""
    connex = _connex_store.load_connex(connex_id)
    if connex is None:
        return jsonify({"error": f"Connex '{connex_id}' not found.", "code": "NOT_FOUND"}), 404
    return jsonify({"connex": connex})


@app.route("/api/connex/<connex_id>", methods=["PUT"])
def api_update_connex(connex_id):
    """
    PUT /api/connex/<connex_id>  body: partial Connex
    (boxes[].sloc, boxes[].shrh_poc, boxes[].individual_items,
     sun, connex_no, seal_no, packed_by, signed_by, date)
    -> {connex: Connex}
    """
    data = request.get_json(silent=True) or {}
    connex = _connex_store.patch_connex(connex_id, data)
    if connex is None:
        return jsonify({"error": f"Connex '{connex_id}' not found.", "code": "NOT_FOUND"}), 404
    return jsonify({"connex": connex})


@app.route("/api/connex/<connex_id>/attach", methods=["POST"])
def api_attach_connex(connex_id):
    """
    POST /api/connex/<connex_id>/attach  body: {ingest_job_id}
    -> {connex: Connex}
    """
    data = request.get_json(silent=True) or {}
    ingest_job_id = data.get("ingest_job_id", "")
    if not ingest_job_id:
        return jsonify({"error": "ingest_job_id is required.", "code": "MISSING_FIELDS"}), 400
    if ingest_job_id not in JOBS:
        return jsonify({"error": f"Job '{ingest_job_id}' not found.", "code": "NOT_FOUND"}), 404

    connex = _connex_store.attach_ingest_job(connex_id, ingest_job_id)
    if connex is None:
        return jsonify({"error": f"Connex '{connex_id}' not found.", "code": "NOT_FOUND"}), 404
    return jsonify({"connex": connex})


@app.route("/api/connex/<connex_id>/assign", methods=["POST"])
def api_assign_connex(connex_id):
    """
    POST /api/connex/<connex_id>/assign
    body: {moves: [{bom_id, box_num} | {bom_id, separate:true} | {bom_id, exclude:true}]}

    Wraps the existing packing.reassign / separate / exclude logic.
    Reflects the new box→BOM mapping back into the connex JSON.
    -> {connex: Connex}
    """
    connex = _connex_store.load_connex(connex_id)
    if connex is None:
        return jsonify({"error": f"Connex '{connex_id}' not found.", "code": "NOT_FOUND"}), 404

    ingest_job_id = connex.get("ingest_job_id")
    if not ingest_job_id or ingest_job_id not in JOBS:
        return jsonify({
            "error": "This connex has no attached ingest job. Call /attach first.",
            "code": "NO_JOB",
        }), 400

    data = request.get_json(silent=True) or {}
    job  = JOBS[ingest_job_id]
    boms = job["boms"]
    box_map = job["box_map"]
    assigned_bom_ids: set = job.setdefault("assigned_bom_ids", set())
    box_count = connex.get("box_count", len(connex.get("boxes", [])))

    warnings: list[str] = []

    for move in data.get("moves", []):
        # Item-level move: relocate a single component item (bom_id:line_no)
        # into a box, independent of the rest of its BOM.  Used by the BOM
        # drill-down in the packing UI (note #2).
        if "item_key" in move:
            target_box = move.get("box_num")
            if target_box is None:
                continue
            target_box = int(target_box)
            if target_box < 1 or target_box > box_count:
                warnings.append(
                    f"item {move['item_key']!r} targets box {target_box} which is "
                    f"out of range (connex has {box_count} boxes) — skipped"
                )
                continue
            box_map = packing.reassign(box_map, move["item_key"], target_box)
            continue

        bom_id = move.get("bom_id")
        bom = next((b for b in boms if b["bom_id"] == bom_id), None)

        if bom is None:
            warnings.append(
                f"bom_id {bom_id!r} not found in attached job — skipped"
            )
            continue

        if move.get("exclude"):
            box_map = dict(box_map)
            for item in bom.get("items", []):
                box_map.pop(packing.item_key(bom_id, item["line_no"]), None)
            assigned_bom_ids.discard(bom_id)
            continue

        if move.get("separate"):
            occ = packing.occupied_boxes(box_map)
            new_box = (max(occ) + 1) if occ else 1
            for item in bom.get("items", []):
                key = packing.item_key(bom_id, item["line_no"])
                box_map = packing.reassign(box_map, key, new_box)
            assigned_bom_ids.add(bom_id)
            continue

        target_box = move.get("box_num")
        if target_box is None:
            continue
        target_box = int(target_box)

        # Warn if the target box number is outside the connex range.
        if target_box < 1 or target_box > box_count:
            warnings.append(
                f"bom_id {bom_id!r} targets box {target_box} which is out of range "
                f"(connex has {box_count} boxes) — skipped"
            )
            continue

        for item in bom.get("items", []):
            key = packing.item_key(bom_id, item["line_no"])
            box_map = packing.reassign(box_map, key, target_box)
        assigned_bom_ids.add(bom_id)

    # Persist updated box_map and assigned set back into the in-memory job.
    job["box_map"] = box_map
    job["assigned_bom_ids"] = assigned_bom_ids

    # Build bom_ids_by_box ONLY from explicitly assigned boms.
    # grouped_box_map pre-assigns everything; filtering here prevents a single
    # user assignment from silently force-assigning all other BOMs.
    bom_ids_by_box: dict[int, list[str]] = {}
    for bom in boms:
        if bom["bom_id"] not in assigned_bom_ids:
            continue
        rep = _representative_box(bom, box_map)
        if rep is not None:
            bom_ids_by_box.setdefault(rep, []).append(bom["bom_id"])

    updated = _connex_store.apply_bom_assignments(connex_id, bom_ids_by_box)
    if updated is None:
        return jsonify({"error": f"Connex '{connex_id}' not found.", "code": "NOT_FOUND"}), 404
    # item_box_map (item_key -> box_num) lets the UI render per-item box
    # assignment inside the BOM drill-down.
    return jsonify({"connex": updated, "warnings": warnings, "item_box_map": box_map})


@app.route("/api/connex/<connex_id>/seal", methods=["POST"])
def api_seal_connex(connex_id):
    """
    POST /api/connex/<connex_id>/seal
    -> {ok: bool, errors: [str], connex: Connex}

    Validates Contract B rules.  Returns 200 in all cases (including validation
    failures) so the UI can surface field-level guidance without an HTTP error.
    """
    result = _connex_store.seal_connex(connex_id)
    if result["connex"] is None:
        return jsonify({"error": f"Connex '{connex_id}' not found.", "code": "NOT_FOUND"}), 404
    return jsonify(result)


@app.route("/api/connex/<connex_id>/generate", methods=["POST"])
def api_generate_connex(connex_id):
    """
    POST /api/connex/<connex_id>/generate
    -> binary ZIP containing:
       - Master_1750.pdf — single master DD1750 listing all boxes' contents
       - Box_001.pdf, Box_002.pdf, ... — one stamped DD1750 per occupied box

    Works with and without an attached ingest job.  Content comes from two sources:
      1. BOM items (when an ingest job is attached) via packing.items_for_box.
      2. individual_items stored on each box dict.
    A box is skipped only when it has no content from either source.
    """
    connex = _connex_store.load_connex(connex_id)
    if connex is None:
        return jsonify({"error": f"Connex '{connex_id}' not found.", "code": "NOT_FOUND"}), 404

    # Load BOM data from an attached job when present; not required.
    ingest_job_id = connex.get("ingest_job_id")
    job = JOBS.get(ingest_job_id) if ingest_job_id else None
    boms    = job["boms"]    if job else []
    box_map = job["box_map"] if job else {}

    # Load the profile for stamp + header defaults.
    profile = _profiles.load_profile(connex.get("profile_id", "")) or {}

    zip_buffer = io.BytesIO()
    rendered_boxes = 0

    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:

            # ----------------------------------------------------------------
            # Master 1750 — one row per occupied box, both BOM + individual sources
            # ----------------------------------------------------------------

            # BOM-sourced master rows (packing engine, same as /generate-master).
            master_rows = packing.boxes_to_master_rows(boms, box_map) if boms and box_map else []

            # Synthetic master rows for individual_items.  One row per non-blank
            # item, keyed to its box_num so the BOX NO. column is populated.
            for box in connex.get("boxes", []):
                box_num = box["box_num"]
                for item in box.get("individual_items", []):
                    desc = (item.get("description") or "").strip()
                    if not desc:
                        continue
                    master_rows.append({
                        "box_num": box_num,
                        "model":   desc,
                        "lin":     (item.get("lin") or "").strip(),
                        "nsn":     (item.get("nsn") or "").strip(),
                        "serials": [(item.get("sn") or "").strip()] if (item.get("sn") or "").strip() else [],
                        "qty":     1,
                    })

            if master_rows:
                # condense collapses identical end-items across boxes; re-sequences 1..N.
                condensed = master_core.condense_master_rows(master_rows)
                master_bom_items = master_core.rows_to_bom_items(condensed)

                # Use a synthetic "all-boxes" header: sloc/shrh blank on the master
                # (it spans all boxes), stamp from the profile.
                master_hdr = render_core.build_connex_header(
                    connex,
                    {},                         # no single box — master spans all
                    connex.get("box_count", 1),
                    "ALL",                      # box_nums_label for the master
                    profile or None,
                    include_seal=True,
                )

                master_fd, master_path = tempfile.mkstemp(suffix=".pdf", dir=tmpdir)
                os.close(master_fd)
                render_core.generate_dd1750_from_items(
                    master_bom_items,
                    TEMPLATE_PDF,
                    master_path,
                    header=master_hdr,
                    draw_master_header_fn=render_core.draw_master_header,
                )
                with open(master_path, "rb") as fh:
                    zf.writestr("Master_1750.pdf", fh.read())

            # ----------------------------------------------------------------
            # Per-box DD1750s — one stamped PDF per occupied box
            # ----------------------------------------------------------------

            for box in connex.get("boxes", []):
                box_num = box["box_num"]
                bom_items = []

                # Source 1: BOM component items from the ingest job.
                # All items in this box carry the same box_num in column (a).
                if boms and box_map:
                    for it in packing.items_for_box(boms, box_map, box_num):
                        nsn_str = it.get("nsn", "") or ""
                        sn = (it.get("serial_number") or "").strip()
                        if sn:
                            nsn_str = (nsn_str + "  SN: " + sn).strip() if nsn_str else "SN: " + sn
                        bom_items.append(render_core.BomItem(
                            line_no=box_num,
                            description=it.get("description", ""),
                            nsn=nsn_str,
                            qty=it.get("qty", 1),
                            unit_of_issue=it.get("unit_of_issue", "EA"),
                        ))

                # Source 2: individual items on the box.
                for item in box.get("individual_items", []):
                    desc = (item.get("description") or "").strip()
                    if not desc:
                        continue  # skip blank placeholder rows from the UI
                    nsn_str = (item.get("nsn") or "").strip()
                    lin_str = (item.get("lin") or "").strip()
                    sn_str  = (item.get("sn")  or "").strip()
                    parts = []
                    if nsn_str:
                        parts.append(nsn_str)
                    if lin_str:
                        parts.append(f"LIN: {lin_str}")
                    if sn_str:
                        parts.append(f"SN: {sn_str}")
                    bom_items.append(render_core.BomItem(
                        line_no=box_num,
                        description=desc,
                        nsn="  ".join(parts),
                        qty=1,
                        unit_of_issue="EA",
                    ))

                if not bom_items:
                    continue  # empty box — skip

                # build_connex_header injects bracketed placeholders for blank
                # sun/connex_no/seal_no and populates stamp_text from the profile.
                hdr = render_core.build_connex_header(
                    connex,
                    box,
                    connex.get("box_count", 1),
                    str(box_num),
                    profile or None,
                )

                out_fd, out_path = tempfile.mkstemp(suffix=".pdf", dir=tmpdir)
                os.close(out_fd)
                render_core.generate_dd1750_from_items(
                    bom_items,
                    TEMPLATE_PDF,
                    out_path,
                    header=hdr,
                    draw_master_header_fn=render_core.draw_master_header,
                )

                with open(out_path, "rb") as fh:
                    zf.writestr(f"Box_{box_num:03d}.pdf", fh.read())
                rendered_boxes += 1

    if rendered_boxes == 0 and not master_rows:
        return jsonify({"error": "No occupied boxes to render.", "code": "EMPTY_CONNEX"}), 400

    zip_buffer.seek(0)
    connex_label = re.sub(r'[^\w\-]', '_', connex.get("connex_no") or connex_id)[:40]
    return send_file(
        zip_buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"Connex_{connex_label}_DD1750s.zip",
    )


# ---------------------------------------------------------------------------
# SITREP routes  (Contract A §SITREP, Contract C)
# ---------------------------------------------------------------------------

def _resolve_connexes_for_sitrep(data: dict) -> tuple[list[dict], dict | None]:
    """
    Resolve the connex list + profile from request body.

    Accepts {connex_ids: [...]} OR {profile_id: "..."}.
    Returns (connexes, profile_dict_or_None).

    Uses connex_store.load_connex for all file I/O — avoids importing json
    directly in this module and keeps error handling consistent.
    """
    connex_ids = data.get("connex_ids")
    profile_id = data.get("profile_id")
    profile = None

    if connex_ids:
        connexes = [c for c in (_connex_store.load_connex(cid) for cid in connex_ids) if c]
        if connexes:
            pid = connexes[0].get("profile_id")
            if pid:
                profile = _profiles.load_profile(pid)
    elif profile_id:
        profile = _profiles.load_profile(profile_id)
        connexes = []
        if os.path.isdir(_connex_store.CONNEXES_DIR):
            for fname in os.listdir(_connex_store.CONNEXES_DIR):
                if not fname.endswith(".json"):
                    continue
                # Derive connex_id from filename (strip .json suffix) and
                # load through the store so all I/O is in one place.
                cid = fname[:-5]
                cx = _connex_store.load_connex(cid)
                if cx and cx.get("profile_id") == profile_id:
                    connexes.append(cx)
    else:
        connexes = []

    return connexes, profile


@app.route("/api/sitrep", methods=["POST"])
def api_sitrep():
    """
    POST /api/sitrep  body: {connex_ids:[...]} OR {profile_id}
    -> {sitrep: Sitrep}
    """
    data = request.get_json(silent=True) or {}
    connexes, profile = _resolve_connexes_for_sitrep(data)

    # Enrich BOM nomenclature from in-memory job data where available.
    boms_by_id: dict[str, dict] = {}
    for cx in connexes:
        jid = cx.get("ingest_job_id")
        if jid and jid in JOBS:
            for bom in JOBS[jid].get("boms", []):
                boms_by_id[bom["bom_id"]] = bom

    sitrep = _sitrep.build_sitrep(connexes, profile=profile)
    if boms_by_id:
        sitrep = _sitrep.enrich_sitrep_boms(sitrep, boms_by_id)

    return jsonify({"sitrep": sitrep})


@app.route("/api/sitrep/pdf", methods=["POST"])
def api_sitrep_pdf():
    """
    POST /api/sitrep/pdf  body: same as /api/sitrep
    -> binary PDF

    Delegates to sitrep_render.render_sitrep_pdf(sitrep_dict) which returns
    raw PDF bytes when called without output_path.
    """
    import sitrep_render

    data = request.get_json(silent=True) or {}
    connexes, profile = _resolve_connexes_for_sitrep(data)

    boms_by_id: dict[str, dict] = {}
    for cx in connexes:
        jid = cx.get("ingest_job_id")
        if jid and jid in JOBS:
            for bom in JOBS[jid].get("boms", []):
                boms_by_id[bom["bom_id"]] = bom

    sitrep = _sitrep.build_sitrep(connexes, profile=profile)
    if boms_by_id:
        sitrep = _sitrep.enrich_sitrep_boms(sitrep, boms_by_id)

    pdf_bytes = sitrep_render.render_sitrep_pdf(sitrep)

    from flask import Response
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=sitrep.pdf"},
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
