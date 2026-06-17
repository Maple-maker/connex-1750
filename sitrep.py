"""
sitrep.py — Build the SITREP JSON model (Contract C) from one or many connexes.

Aggregates connex data, computes totals, generates flags.

Pure function — no Flask, no I/O.  Import and call build_sitrep().
The result is JSON-serializable and matches Contract C exactly.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def build_sitrep(
    connexes: list[dict],
    profile: dict | None = None,
) -> dict:
    """
    Build a SITREP JSON model from a list of connex dicts (already loaded from disk).

    Args:
        connexes : list of connex dicts as stored (from connex_store.load_connex).
        profile  : optional profile dict; used for the profile sub-object.

    Returns:
        A dict matching Contract C (04_AGENT_ORCHESTRATION.md §5).
    """
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    profile_block = {
        "brigade": "",
        "battalion": "",
        "battery": "",
    }
    if profile:
        profile_block = {
            "brigade":   profile.get("brigade", ""),
            "battalion": profile.get("battalion", ""),
            "battery":   profile.get("battery", ""),
        }

    connex_count = len(connexes)
    total_boxes = 0
    total_boms = 0
    total_individual_items = 0
    flags: list[str] = []

    sitrep_connexes: list[dict] = []

    for cx in connexes:
        cx_no = cx.get("connex_no") or "[CONNEX# PENDING]"
        sun = cx.get("sun") or "[SUN PENDING]"
        seal_no = cx.get("seal_no") or ""
        status = cx.get("status", "building")

        # Flags: missing SUN#
        if not cx.get("sun", "").strip():
            flags.append(f"Connex {cx_no} is missing SUN#.")

        boxes_out: list[dict] = []
        zero_on_hand_boxes = 0

        for box in cx.get("boxes", []):
            box_num = box["box_num"]
            bom_ids = box.get("bom_ids", [])
            individual_items = box.get("individual_items", [])

            # Only include boxes that have content.
            if not bom_ids and not individual_items:
                continue

            total_boxes += 1
            bom_count = len(bom_ids)
            total_boms += bom_count
            total_individual_items += len(individual_items)

            # Build the boms list for this box from bom metadata stashed in the connex.
            # The connex stores bom_ids; the caller is responsible for providing the
            # bom metadata via bom_meta (passed through the connex's attached job).
            # For the SITREP we surface the bom_ids as nomenclature placeholders
            # when full BOM metadata is not embedded.  The route layer enriches these
            # using the JOBS dict when available.
            boms_block = [
                {
                    "nomenclature": bid,
                    "lin": "",
                    "serial": "",
                    "item_count": 0,
                }
                for bid in bom_ids
            ]

            # Filter non-empty individual items.
            items_block = [
                {
                    "description": it.get("description", ""),
                    "sn": it.get("sn", ""),
                    "nsn": it.get("nsn", ""),
                    "lin": it.get("lin", ""),
                }
                for it in individual_items
                if any(v for v in it.values())  # skip fully blank rows
            ]

            boxes_out.append({
                "box_num": box_num,
                "sloc": box.get("sloc", ""),
                "shrh_poc": box.get("shrh_poc", ""),
                "boms": boms_block,
                "individual_items": items_block,
            })

            if bom_count == 0 and not individual_items:
                zero_on_hand_boxes += 1

        if zero_on_hand_boxes:
            flags.append(
                f"Connex {cx_no} has {zero_on_hand_boxes} zero-on-hand box(es)."
            )

        sitrep_connexes.append({
            "connex_id": cx.get("connex_id", ""),
            "connex_no": cx_no,
            "sun": sun,
            "seal_no": seal_no,
            "status": status,
            "boxes": boxes_out,
        })

    return {
        "generated": now_iso,
        "profile": profile_block,
        "connex_count": connex_count,
        "box_count": total_boxes,
        "bom_count": total_boms,
        "individual_item_count": total_individual_items,
        "connexes": sitrep_connexes,
        "flags": flags,
    }


def enrich_sitrep_boms(sitrep: dict, boms_by_id: dict[str, dict]) -> dict:
    """
    Replace placeholder bom_ids in sitrep.connexes[].boxes[].boms with real
    metadata from boms_by_id.

    boms_by_id: {bom_id: bom_dict}  — bom dicts from the ingest job.

    Returns the same sitrep dict (mutated in-place for efficiency).
    This is called by the route layer when the ingest job is available in memory.
    """
    for cx in sitrep.get("connexes", []):
        for box in cx.get("boxes", []):
            enriched_boms: list[dict] = []
            for bom_entry in box.get("boms", []):
                bom_id = bom_entry.get("nomenclature", "")  # placeholder holds bom_id
                bom = boms_by_id.get(bom_id)
                if bom:
                    enriched_boms.append({
                        "nomenclature": bom.get("nomenclature") or bom.get("model", bom_id),
                        "lin": bom.get("lin", ""),
                        "serial": bom.get("serial_number", ""),
                        "item_count": bom.get("item_count", 0),
                    })
                else:
                    # Preserve the placeholder so the client can see what's missing.
                    enriched_boms.append(bom_entry)
            box["boms"] = enriched_boms
    return sitrep


__all__ = [
    "build_sitrep",
    "enrich_sitrep_boms",
]
