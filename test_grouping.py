"""
test_grouping.py — Like-item grouping, box recount, separate, and regroup.

Covers the arms-room workflow: 50 identical M4s start grouped in ONE box
(qty 50), box numbers are always contiguous 1..N (no vacated-box gaps when
condensing), and the user can pull a single end item into its own box.

Run with pytest, or standalone:  ./venv/bin/python test_grouping.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import app as flask_app
import job_store
from packing import (
    grouped_box_map,
    compact_box_map,
    occupied_boxes,
    boxes_to_master_rows,
    item_key,
)
from master_core import condense_master_rows


def _bom(bom_id, nom, lin, niin, serial):
    # One end item = one BOM with a single line (the arms-room shape).
    return {
        "bom_id": bom_id, "filename": f"{nom}.pdf", "nomenclature": nom,
        "model": nom, "lin": lin, "end_item_niin": niin, "serial_number": serial,
        "item_count": 1,
        "items": [{"line_no": 1, "description": nom, "nsn": niin,
                   "qty": 1, "unit_of_issue": "EA"}],
        "warnings": [], "errors": [],
    }


def _arms_room():
    # 50 M4s (same LIN+NIIN) + 3 M17 pistols + 1 M249.
    boms = [_bom(f"M4-{i}", "RIFLE M4", "R12345", "N1111", f"M4SN{i:03d}") for i in range(50)]
    boms += [_bom(f"M17-{i}", "PISTOL M17", "P67890", "N2222", f"M17SN{i}") for i in range(3)]
    boms += [_bom("M249-0", "LMG M249", "L11111", "N3333", "M249SN1")]
    return boms


# ---------------------------------------------------------------------------
# grouped_box_map — like items share a box, contiguous numbering
# ---------------------------------------------------------------------------

def test_like_items_grouped_into_one_box():
    boms = _arms_room()
    bm = grouped_box_map(boms)

    # 54 end items, 3 distinct LIN/NIIN -> exactly 3 boxes, contiguous.
    assert occupied_boxes(bm) == [1, 2, 3]

    rows = boxes_to_master_rows(boms, bm)
    by_model = {r["model"]: r for r in rows}
    assert by_model["RIFLE M4"]["qty"] == 50, "all 50 M4s in one box"
    assert by_model["PISTOL M17"]["qty"] == 3
    assert by_model["LMG M249"]["qty"] == 1
    # 50 distinct serials collected on the grouped box.
    assert len(by_model["RIFLE M4"]["serials"]) == 50


def test_unknown_items_never_merge():
    # No LIN/NIIN/model identity -> each gets its OWN box (don't pool unknowns).
    boms = [
        {"bom_id": "X", "nomenclature": "", "model": "", "lin": "",
         "end_item_niin": "", "serial_number": "", "items": [{"line_no": 1}]},
        {"bom_id": "Y", "nomenclature": "", "model": "", "lin": "",
         "end_item_niin": "", "serial_number": "", "items": [{"line_no": 1}]},
    ]
    bm = grouped_box_map(boms)
    assert occupied_boxes(bm) == [1, 2]
    assert bm[item_key("X", 1)] != bm[item_key("Y", 1)]


# ---------------------------------------------------------------------------
# compact_box_map — the recount (no gaps)
# ---------------------------------------------------------------------------

def test_compact_removes_gaps_preserving_order():
    gappy = {"A:1": 1, "B:1": 6, "C:1": 9, "D:1": 6}
    compacted = compact_box_map(gappy)
    assert sorted(set(compacted.values())) == [1, 2, 3]
    # order preserved: box 1 -> 1, box 6 -> 2, box 9 -> 3
    assert compacted["A:1"] == 1
    assert compacted["B:1"] == 2 and compacted["D:1"] == 2
    assert compacted["C:1"] == 3
    assert compact_box_map({}) == {}


# ---------------------------------------------------------------------------
# Routes: /regroup recounts; /assign 'separate' pulls one item out
# ---------------------------------------------------------------------------

def _inject_job(boms, box_map):
    job_id = "testjob"
    job_store.save_job(job_id, {
        "boms": boms,
        "shr": None,
        "reconciliation": None,
        "box_map": box_map,
        "assigned_bom_ids": set(),
        "created_at": "now",
    })
    return job_id, flask_app.app.test_client()


def test_regroup_recounts_after_a_gap():
    boms = _arms_room()
    # Simulate a gappy map (as the OLD condense produced): boxes 1, 6, 9.
    box_map = {}
    for b in boms[:50]:
        box_map[item_key(b["bom_id"], 1)] = 1
    for b in boms[50:53]:
        box_map[item_key(b["bom_id"], 1)] = 6
    box_map[item_key("M249-0", 1)] = 9
    assert occupied_boxes(box_map) == [1, 6, 9]  # gappy on purpose

    job_id, c = _inject_job(boms, box_map)
    r = c.post("/regroup", json={"job_id": job_id})
    assert r.status_code == 200
    occ = r.get_json()["occupied_boxes"]
    assert occ == [1, 2, 3], f"regroup must recount to contiguous, got {occ}"


def test_separate_pulls_one_item_into_new_box():
    boms = _arms_room()
    box_map = grouped_box_map(boms)
    assert occupied_boxes(box_map) == [1, 2, 3]

    job_id, c = _inject_job(boms, box_map)
    # Pull one M4 out of the box of 50.
    r = c.post("/assign", json={"job_id": job_id,
                                "moves": [{"bom_id": "M4-0", "separate": True}]})
    assert r.status_code == 200
    body = r.get_json()
    assert body["occupied_boxes"] == [1, 2, 3, 4], "separated item lands in a new box"
    assert body["box_by_bom"]["M4-0"] == 4

    # Master now shows 49 in the grouped box + 1 in its own.
    job = job_store.load_job(job_id)
    rows = boxes_to_master_rows(job["boms"], job["box_map"])
    cond = condense_master_rows(rows)
    # condense_master_rows merges by model+lin, so the lone M4 re-merges with
    # the group at the MASTER level (same item) — that's expected; the SPLIT is
    # a physical-box decision, which the individuals path honors per box_num.
    m4_qty = sum(r["qty"] for r in cond if r["model"] == "RIFLE M4")
    assert m4_qty == 50


if __name__ == "__main__":
    tests = [
        test_like_items_grouped_into_one_box,
        test_unknown_items_never_merge,
        test_compact_removes_gaps_preserving_order,
        test_regroup_recounts_after_a_gap,
        test_separate_pulls_one_item_into_new_box,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL  {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed.")
    sys.exit(1 if failed else 0)
