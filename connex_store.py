"""
connex_store.py — CRUD for Connex JSON under data/connexes/.

Each connex is a JSON file named <connex_id>.json.
All writes are atomic (write-temp-then-rename).  No global state beyond the
filesystem — pure-ish functions, importable without Flask.

Seal validation (Contract B) lives here as validate_seal() so it can be unit
tested in isolation.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any

import packing  # existing module — item_key, grouped_box_map, reassign, occupied_boxes

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONNEXES_DIR = os.path.join(BASE_DIR, "data", "connexes")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _connex_path(connex_id: str) -> str:
    return os.path.join(CONNEXES_DIR, f"{connex_id}.json")


def _atomic_write(path: str, data: dict) -> None:
    """Write data to path atomically: write to a sibling temp file, then rename."""
    dir_ = os.path.dirname(path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def _empty_box(box_num: int) -> dict:
    """Return a canonical empty box dict for box number box_num."""
    return {
        "box_num": box_num,
        "bom_ids": [],
        "sloc": "",
        "shrh_poc": "",
        "individual_items": [],
        "complete": False,
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def create_connex(
    profile_id: str,
    box_count: int,
    connex_no: str = "",
) -> dict:
    """
    Create a new Connex in status="building" with box_count pre-spawned boxes.

    Returns the persisted connex dict.
    """
    os.makedirs(CONNEXES_DIR, exist_ok=True)

    now = _now_iso()
    connex_id = uuid.uuid4().hex
    connex = {
        "connex_id": connex_id,
        "profile_id": profile_id,
        "status": "building",
        "ingest_job_id": None,
        "box_count": box_count,
        "boxes": [_empty_box(n) for n in range(1, box_count + 1)],
        "sun": "",
        "connex_no": connex_no,
        "seal_no": "",
        "packed_by": "",
        "signed_by": "",
        "date": datetime.now(timezone.utc).strftime("%d %b %Y").upper(),
        "created": now,
        "sealed": None,
    }
    _atomic_write(_connex_path(connex_id), connex)
    return connex


def load_connex(connex_id: str) -> dict | None:
    """Return the connex dict or None if not found."""
    path = _connex_path(connex_id)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save_connex(connex: dict) -> dict:
    """Persist connex to disk and return it (no changes to the dict)."""
    os.makedirs(CONNEXES_DIR, exist_ok=True)
    _atomic_write(_connex_path(connex["connex_id"]), connex)
    return connex


def patch_connex(connex_id: str, patch: dict) -> dict | None:
    """
    Apply a partial update (patch) to a connex.

    Accepts the top-level scalar fields (sun, connex_no, seal_no, packed_by,
    signed_by, date, ingest_job_id) and a boxes list for per-box updates.

    When patch["boxes"] is present each entry is matched by box_num and the
    following sub-fields are merged: sloc, shrh_poc, individual_items.

    individual_items replaces the box's list entirely when provided.

    Returns the updated connex or None if not found.
    """
    connex = load_connex(connex_id)
    if connex is None:
        return None

    # Top-level scalar fields allowed via PUT.
    for field in ("sun", "connex_no", "seal_no", "packed_by", "signed_by", "date", "ingest_job_id"):
        if field in patch:
            connex[field] = patch[field]

    # Per-box updates.
    if "boxes" in patch:
        # Build a lookup from box_num to the existing box dict.
        box_by_num = {b["box_num"]: b for b in connex["boxes"]}
        for box_patch in patch["boxes"]:
            box_num = box_patch.get("box_num")
            if box_num is None or box_num not in box_by_num:
                continue
            box = box_by_num[box_num]
            for field in ("sloc", "shrh_poc"):
                if field in box_patch:
                    box[field] = box_patch[field]
            if "individual_items" in box_patch:
                box["individual_items"] = box_patch["individual_items"]
            # Recompute completeness: has content AND has sloc AND has shrh_poc.
            box["complete"] = _box_is_complete(box)

    _atomic_write(_connex_path(connex_id), connex)
    return connex


def attach_ingest_job(connex_id: str, ingest_job_id: str) -> dict | None:
    """
    Link an ingest job to this connex (sets ingest_job_id).

    Returns the updated connex or None if not found.
    """
    return patch_connex(connex_id, {"ingest_job_id": ingest_job_id})


def apply_bom_assignments(connex_id: str, bom_ids_by_box: dict[int, list[str]]) -> dict | None:
    """
    Reflect the results of a packing.reassign / separate / exclude operation
    back into the connex's box.bom_ids lists.

    bom_ids_by_box: {box_num: [bom_id, ...]}  — replaces existing bom_ids for
    every box.  Boxes not in the dict get their bom_ids cleared.

    Also recomputes box.complete for each box.

    Returns the updated connex or None if not found.
    """
    connex = load_connex(connex_id)
    if connex is None:
        return None

    for box in connex["boxes"]:
        box["bom_ids"] = bom_ids_by_box.get(box["box_num"], [])
        box["complete"] = _box_is_complete(box)

    _atomic_write(_connex_path(connex_id), connex)
    return connex


# ---------------------------------------------------------------------------
# Contract B — Seal validation
# ---------------------------------------------------------------------------

def _box_has_content(box: dict) -> bool:
    """True if the box has at least one BOM or at least one individual item."""
    return bool(box.get("bom_ids")) or bool(box.get("individual_items"))


def _box_is_complete(box: dict) -> bool:
    """
    A box is "complete" when it has content AND both sloc and shrh_poc are filled.
    Empty boxes are not considered incomplete — they're just empty.
    """
    if not _box_has_content(box):
        return False
    return bool(box.get("sloc", "").strip()) and bool(box.get("shrh_poc", "").strip())


def validate_seal(connex: dict) -> list[str]:
    """
    Run all Contract B seal checks.  Returns a list of human-readable error
    messages (all failures, not short-circuit).  Empty list means valid.

    Error codes embedded as prefixes for machine parsing:
        EMPTY_BOX        — a box has no content
        MISSING_SLOC     — populated box missing sloc
        MISSING_SHRH     — populated box missing shrh_poc
        NO_SIGNER        — signed_by blank
        SIGNER_EQ_PACKER — signed_by == packed_by
    """
    errors: list[str] = []

    for box in connex.get("boxes", []):
        n = box["box_num"]
        has_content = _box_has_content(box)

        if not has_content:
            errors.append(
                f"EMPTY_BOX: Box {n} is empty — add contents or reduce box count."
            )
            continue  # missing SLOC/SHRH checks are N/A for an empty box

        if not box.get("sloc", "").strip():
            errors.append(f"MISSING_SLOC: Box {n} needs a SLOC.")

        if not box.get("shrh_poc", "").strip():
            errors.append(f"MISSING_SHRH: Box {n} needs a SHRH POC.")

    signed_by = (connex.get("signed_by") or "").strip()
    packed_by = (connex.get("packed_by") or "").strip()

    if not signed_by:
        errors.append("NO_SIGNER: Enter who is signing for this connex.")
    elif signed_by == packed_by:
        errors.append("SIGNER_EQ_PACKER: Signer must differ from packer.")

    return errors


def seal_connex(connex_id: str) -> dict:
    """
    Run seal validation.  On success, flip status to "sealed", stamp timestamp,
    persist.

    Returns:
        {"ok": bool, "errors": [str], "connex": dict | None}
    """
    connex = load_connex(connex_id)
    if connex is None:
        return {"ok": False, "errors": ["Connex not found."], "connex": None}

    errors = validate_seal(connex)
    if errors:
        return {"ok": False, "errors": errors, "connex": connex}

    connex["status"] = "sealed"
    connex["sealed"] = _now_iso()
    _atomic_write(_connex_path(connex_id), connex)
    return {"ok": True, "errors": [], "connex": connex}


# ---------------------------------------------------------------------------
# Box-level completeness recompute (helper called after any assignment change)
# ---------------------------------------------------------------------------

def recompute_box_completeness(connex: dict) -> dict:
    """
    Recompute box.complete for every box in the connex dict.
    Mutates the connex in-place (the caller may then persist).
    """
    for box in connex.get("boxes", []):
        box["complete"] = _box_is_complete(box)
    return connex


__all__ = [
    "create_connex",
    "load_connex",
    "save_connex",
    "patch_connex",
    "attach_ingest_job",
    "apply_bom_assignments",
    "validate_seal",
    "seal_connex",
    "recompute_box_completeness",
    "_box_has_content",
    "_box_is_complete",
]
