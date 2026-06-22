"""
test_connex.py — Unit tests for connex_store.py

Run with: python3 test_connex.py  (from the master-1750-tool directory)
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Redirect data dir before importing.
_tmp_data_dir = tempfile.mkdtemp()

import connex_store
import packing
import master_core

_orig_dir = connex_store.CONNEXES_DIR
connex_store.CONNEXES_DIR = os.path.join(_tmp_data_dir, "connexes")
os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)

FAKE_PROFILE_ID = "profile_abc123"


def _fresh():
    """Create a fresh connex for testing."""
    return connex_store.create_connex(FAKE_PROFILE_ID, box_count=3)


class TestCreateConnex(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)

    def test_creates_connex_with_correct_box_count(self):
        cx = _fresh()
        self.assertEqual(cx["box_count"], 3)
        self.assertEqual(len(cx["boxes"]), 3)

    def test_boxes_numbered_1_to_n(self):
        cx = _fresh()
        nums = [b["box_num"] for b in cx["boxes"]]
        self.assertEqual(nums, [1, 2, 3])

    def test_initial_status_is_building(self):
        cx = _fresh()
        self.assertEqual(cx["status"], "building")

    def test_initial_boxes_are_empty(self):
        cx = _fresh()
        for box in cx["boxes"]:
            self.assertEqual(box["bom_ids"], [])
            self.assertEqual(box["sloc"], "")
            self.assertEqual(box["shrh_poc"], "")
            self.assertFalse(box["complete"])

    def test_connex_persists_to_disk(self):
        cx = _fresh()
        loaded = connex_store.load_connex(cx["connex_id"])
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["connex_id"], cx["connex_id"])

    def test_load_nonexistent_returns_none(self):
        self.assertIsNone(connex_store.load_connex("nonexistent"))


class TestPatchConnex(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)

    def test_patch_top_level_scalar(self):
        cx = _fresh()
        updated = connex_store.patch_connex(cx["connex_id"], {
            "packed_by": "1LT RABATIN",
            "signed_by": "CPT HOLLAND",
            "sun": "SUN-001",
        })
        self.assertEqual(updated["packed_by"], "1LT RABATIN")
        self.assertEqual(updated["signed_by"], "CPT HOLLAND")
        self.assertEqual(updated["sun"], "SUN-001")

    def test_patch_box_sloc_and_shrh(self):
        cx = _fresh()
        updated = connex_store.patch_connex(cx["connex_id"], {
            "boxes": [{"box_num": 1, "sloc": "BLDG-100", "shrh_poc": "CPT JONES"}]
        })
        box1 = next(b for b in updated["boxes"] if b["box_num"] == 1)
        self.assertEqual(box1["sloc"], "BLDG-100")
        self.assertEqual(box1["shrh_poc"], "CPT JONES")

    def test_patch_nonexistent_returns_none(self):
        result = connex_store.patch_connex("nonexistent", {"sun": "X"})
        self.assertIsNone(result)

    def test_patch_unknown_box_num_ignored(self):
        cx = _fresh()
        # Patching box_num=99 (does not exist) should not crash.
        updated = connex_store.patch_connex(cx["connex_id"], {
            "boxes": [{"box_num": 99, "sloc": "BLDG-999"}]
        })
        self.assertIsNotNone(updated)
        # Existing boxes unchanged.
        self.assertEqual(updated["boxes"][0]["sloc"], "")

    def test_patch_individual_items_replaces_list(self):
        cx = _fresh()
        items = [{"description": "Widget", "sn": "SN123", "nsn": "", "lin": ""}]
        updated = connex_store.patch_connex(cx["connex_id"], {
            "boxes": [{"box_num": 1, "individual_items": items}]
        })
        box1 = next(b for b in updated["boxes"] if b["box_num"] == 1)
        self.assertEqual(len(box1["individual_items"]), 1)
        self.assertEqual(box1["individual_items"][0]["description"], "Widget")


class TestConcurrentMutations(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)

    def test_updates_to_different_fields_are_not_lost(self):
        cx = _fresh()
        first_write_started = threading.Event()
        release_first_write = threading.Event()
        second_update_done = threading.Event()
        original_atomic_write = connex_store._atomic_write

        def delayed_atomic_write(path, data):
            if data.get("packed_by") == "PACKER A" and not first_write_started.is_set():
                first_write_started.set()
                self.assertTrue(release_first_write.wait(timeout=2))
            original_atomic_write(path, data)

        def update_packer():
            connex_store.patch_connex(cx["connex_id"], {"packed_by": "PACKER A"})

        def update_signer():
            connex_store.patch_connex(cx["connex_id"], {"signed_by": "SIGNER B"})
            second_update_done.set()

        with mock.patch.object(connex_store, "_atomic_write", side_effect=delayed_atomic_write):
            first = threading.Thread(target=update_packer)
            second = threading.Thread(target=update_signer)
            first.start()
            self.assertTrue(first_write_started.wait(timeout=2))
            second.start()
            second_update_done.wait(timeout=0.2)
            release_first_write.set()
            first.join(timeout=2)
            second.join(timeout=2)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        loaded = connex_store.load_connex(cx["connex_id"])
        self.assertEqual(loaded["packed_by"], "PACKER A")
        self.assertEqual(loaded["signed_by"], "SIGNER B")


class TestBoxCompleteness(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)

    def test_empty_box_not_complete(self):
        box = {"box_num": 1, "bom_ids": [], "sloc": "X", "shrh_poc": "Y", "individual_items": []}
        self.assertFalse(connex_store._box_is_complete(box))

    def test_box_with_bom_but_missing_sloc_not_complete(self):
        box = {"box_num": 1, "bom_ids": ["abc"], "sloc": "", "shrh_poc": "Y", "individual_items": []}
        self.assertFalse(connex_store._box_is_complete(box))

    def test_box_with_bom_and_both_fields_is_complete(self):
        box = {"box_num": 1, "bom_ids": ["abc"], "sloc": "BLDG-1", "shrh_poc": "CPT X", "individual_items": []}
        self.assertTrue(connex_store._box_is_complete(box))

    def test_box_with_individual_item_and_fields_is_complete(self):
        box = {
            "box_num": 1, "bom_ids": [],
            "sloc": "BLDG-1", "shrh_poc": "CPT X",
            "individual_items": [{"description": "Boots", "sn": "", "nsn": "", "lin": ""}],
        }
        self.assertTrue(connex_store._box_is_complete(box))

    def test_patch_triggers_complete_recompute(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=1)
        # Add a BOM id directly then patch SLOC+SHRH.
        connex_store.apply_bom_assignments(cx["connex_id"], {1: ["bom_abc"]})
        updated = connex_store.patch_connex(cx["connex_id"], {
            "boxes": [{"box_num": 1, "sloc": "BLDG-1", "shrh_poc": "SGT X"}]
        })
        box1 = updated["boxes"][0]
        self.assertTrue(box1["complete"])


class TestSealValidation(unittest.TestCase):
    """Unit tests for validate_seal() — Contract B."""

    def _cx(self, **kwargs):
        """Build a minimal connex dict for seal validation."""
        base = {
            "boxes": [
                {"box_num": 1, "bom_ids": ["abc"], "sloc": "BLDG-1", "shrh_poc": "CPT X", "individual_items": []},
            ],
            "packed_by": "1LT RABATIN",
            "signed_by": "CPT HOLLAND",
        }
        base.update(kwargs)
        return base

    def test_valid_connex_has_no_errors(self):
        errors = connex_store.validate_seal(self._cx())
        self.assertEqual(errors, [])

    def test_empty_box_returns_EMPTY_BOX_error(self):
        cx = self._cx()
        cx["boxes"][0]["bom_ids"] = []
        errors = connex_store.validate_seal(cx)
        codes = [e.split(":")[0] for e in errors]
        self.assertIn("EMPTY_BOX", codes)

    def test_missing_sloc_returns_MISSING_SLOC(self):
        cx = self._cx()
        cx["boxes"][0]["sloc"] = ""
        errors = connex_store.validate_seal(cx)
        codes = [e.split(":")[0] for e in errors]
        self.assertIn("MISSING_SLOC", codes)

    def test_missing_shrh_returns_MISSING_SHRH(self):
        cx = self._cx()
        cx["boxes"][0]["shrh_poc"] = ""
        errors = connex_store.validate_seal(cx)
        codes = [e.split(":")[0] for e in errors]
        self.assertIn("MISSING_SHRH", codes)

    def test_missing_signed_by_returns_NO_SIGNER(self):
        cx = self._cx(signed_by="")
        errors = connex_store.validate_seal(cx)
        codes = [e.split(":")[0] for e in errors]
        self.assertIn("NO_SIGNER", codes)

    def test_signer_equals_packer_returns_SIGNER_EQ_PACKER(self):
        cx = self._cx(signed_by="1LT RABATIN")  # same as packed_by
        errors = connex_store.validate_seal(cx)
        codes = [e.split(":")[0] for e in errors]
        self.assertIn("SIGNER_EQ_PACKER", codes)

    def test_all_failures_returned_at_once(self):
        cx = self._cx()
        cx["boxes"] = [
            {"box_num": 1, "bom_ids": [], "sloc": "", "shrh_poc": "", "individual_items": []},
            {"box_num": 2, "bom_ids": ["x"], "sloc": "", "shrh_poc": "", "individual_items": []},
        ]
        cx["signed_by"] = ""
        errors = connex_store.validate_seal(cx)
        codes = [e.split(":")[0] for e in errors]
        self.assertIn("EMPTY_BOX", codes)
        self.assertIn("MISSING_SLOC", codes)
        self.assertIn("MISSING_SHRH", codes)
        self.assertIn("NO_SIGNER", codes)

    def test_blank_sun_connex_seal_no_is_valid(self):
        """sun/connex_no/seal_no blank is valid — not checked at seal time."""
        cx = self._cx(sun="", connex_no="", seal_no="")
        errors = connex_store.validate_seal(cx)
        self.assertEqual(errors, [])

    def test_individual_item_box_without_sloc_fails(self):
        cx = self._cx()
        cx["boxes"] = [{
            "box_num": 1,
            "bom_ids": [],
            "sloc": "",
            "shrh_poc": "CPT X",
            "individual_items": [{"description": "Widget", "sn": "", "nsn": "", "lin": ""}],
        }]
        errors = connex_store.validate_seal(cx)
        codes = [e.split(":")[0] for e in errors]
        self.assertIn("MISSING_SLOC", codes)


class TestSealConnex(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)

    def _create_ready_connex(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=1)
        connex_store.apply_bom_assignments(cx["connex_id"], {1: ["bom_abc"]})
        connex_store.patch_connex(cx["connex_id"], {
            "boxes": [{"box_num": 1, "sloc": "BLDG-1", "shrh_poc": "CPT X"}],
            "packed_by": "1LT RABATIN",
            "signed_by": "CPT HOLLAND",
        })
        return connex_store.load_connex(cx["connex_id"])

    def test_seal_valid_connex_returns_ok_true(self):
        cx = self._create_ready_connex()
        result = connex_store.seal_connex(cx["connex_id"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["errors"], [])

    def test_seal_sets_status_to_sealed(self):
        cx = self._create_ready_connex()
        result = connex_store.seal_connex(cx["connex_id"])
        self.assertEqual(result["connex"]["status"], "sealed")

    def test_seal_stamps_sealed_timestamp(self):
        cx = self._create_ready_connex()
        result = connex_store.seal_connex(cx["connex_id"])
        self.assertIsNotNone(result["connex"]["sealed"])

    def test_seal_invalid_connex_returns_ok_false(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=1)
        result = connex_store.seal_connex(cx["connex_id"])
        self.assertFalse(result["ok"])
        self.assertGreater(len(result["errors"]), 0)

    def test_seal_persists_to_disk(self):
        cx = self._create_ready_connex()
        connex_store.seal_connex(cx["connex_id"])
        loaded = connex_store.load_connex(cx["connex_id"])
        self.assertEqual(loaded["status"], "sealed")

    def test_seal_nonexistent_connex_returns_error(self):
        result = connex_store.seal_connex("nonexistent")
        self.assertFalse(result["ok"])
        self.assertIsNone(result["connex"])

    def test_sealing_an_already_sealed_connex_is_idempotent(self):
        cx = self._create_ready_connex()
        with mock.patch.object(connex_store, "_now_iso", side_effect=["FIRST", "SECOND"]):
            first = connex_store.seal_connex(cx["connex_id"])["connex"]
            second = connex_store.seal_connex(cx["connex_id"])["connex"]
        self.assertEqual(second["sealed"], first["sealed"])


class TestSealedImmutability(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)
        import app as flask_app
        import job_store

        self.client = flask_app.app.test_client()
        self.job_store = job_store
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=1)
        connex_store.apply_bom_assignments(cx["connex_id"], {1: ["bom_abc"]})
        connex_store.patch_connex(cx["connex_id"], {
            "boxes": [{"box_num": 1, "sloc": "BLDG-1", "shrh_poc": "CPT X"}],
            "packed_by": "1LT RABATIN",
            "signed_by": "CPT HOLLAND",
        })
        self.connex = connex_store.seal_connex(cx["connex_id"])["connex"]

    def assert_sealed_rejected(self, operation):
        with self.assertRaises(connex_store.ConnexSealedError):
            operation()

    def test_store_rejects_every_mutation_path(self):
        cid = self.connex["connex_id"]
        changed = dict(self.connex, seal_no="CHANGED")
        operations = [
            lambda: connex_store.patch_connex(cid, {"seal_no": "CHANGED"}),
            lambda: connex_store.attach_ingest_job(cid, "new-job"),
            lambda: connex_store.apply_bom_assignments(cid, {1: ["other-bom"]}),
            lambda: connex_store.add_box(cid),
            lambda: connex_store.remove_box(cid, 1, force=True),
            lambda: connex_store.save_connex(changed),
        ]
        for operation in operations:
            self.assert_sealed_rejected(operation)

    def test_put_route_returns_sealed_conflict(self):
        response = self.client.put(
            f"/api/connex/{self.connex['connex_id']}",
            json={"seal_no": "CHANGED"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["code"], "SEALED")

    def test_attach_route_returns_sealed_conflict(self):
        job_id = "sealed-attach-job"
        self.job_store.save_job(job_id, {
            "boms": [{"bom_id": "bom-x", "items": []}],
            "box_map": {},
            "assigned_bom_ids": set(),
        })
        response = self.client.post(
            f"/api/connex/{self.connex['connex_id']}/attach",
            json={"ingest_job_id": job_id},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["code"], "SEALED")


class TestApplyBomAssignments(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)

    def test_apply_sets_bom_ids_by_box(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=3)
        updated = connex_store.apply_bom_assignments(cx["connex_id"], {
            1: ["bom_a", "bom_b"],
            2: ["bom_c"],
        })
        b1 = next(b for b in updated["boxes"] if b["box_num"] == 1)
        b2 = next(b for b in updated["boxes"] if b["box_num"] == 2)
        b3 = next(b for b in updated["boxes"] if b["box_num"] == 3)
        self.assertEqual(b1["bom_ids"], ["bom_a", "bom_b"])
        self.assertEqual(b2["bom_ids"], ["bom_c"])
        self.assertEqual(b3["bom_ids"], [])  # cleared

    def test_apply_nonexistent_returns_none(self):
        result = connex_store.apply_bom_assignments("nonexistent", {})
        self.assertIsNone(result)


class TestIndividualItemsOnlyConnex(unittest.TestCase):
    """
    Regression tests for the individual-items-only workflow:
    a box that has ONLY individual_items (no bom_ids, no ingest job).
    Seal must succeed; the store layer must reflect the box as occupied.

    The generate route (tested live in the curl walkthrough) reads individual_items
    directly off the box — these tests verify the store layer is correct so
    generate has correct data to work with.
    """

    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)

    def _create_individual_items_connex(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=1)
        updated = connex_store.patch_connex(cx["connex_id"], {
            "packed_by": "1LT RABATIN",
            "signed_by": "CPT HOLLAND",
            "sun": "SUN-IND-001",
            "boxes": [{
                "box_num": 1,
                "sloc": "BLDG-200",
                "shrh_poc": "SGT SMITH",
                "individual_items": [
                    {"description": "Helmet ACH", "sn": "SN-1",
                     "nsn": "8470-01-523-5949", "lin": "H12345"},
                ],
            }],
        })
        return updated

    def test_box_with_individual_item_passes_seal(self):
        """An individual-items-only box must seal successfully (no EMPTY_BOX error)."""
        cx = self._create_individual_items_connex()
        result = connex_store.seal_connex(cx["connex_id"])
        self.assertTrue(result["ok"], msg=f"Expected ok:true but got errors: {result['errors']}")

    def test_individual_item_persists_on_box(self):
        cx = self._create_individual_items_connex()
        loaded = connex_store.load_connex(cx["connex_id"])
        box = loaded["boxes"][0]
        self.assertEqual(len(box["individual_items"]), 1)
        self.assertEqual(box["individual_items"][0]["description"], "Helmet ACH")
        self.assertEqual(box["individual_items"][0]["sn"], "SN-1")

    def test_box_marked_complete_with_individual_item_and_sloc_shrh(self):
        cx = self._create_individual_items_connex()
        box = cx["boxes"][0]
        self.assertTrue(box["complete"])

    def test_box_has_no_bom_ids(self):
        """Confirm bom_ids is empty — content is purely individual_items."""
        cx = self._create_individual_items_connex()
        box = cx["boxes"][0]
        self.assertEqual(box["bom_ids"], [])

    def test_patch_clears_individual_items_when_empty_list_sent(self):
        """Sending individual_items:[] replaces the list (allows UI to clear items)."""
        cx = self._create_individual_items_connex()
        updated = connex_store.patch_connex(cx["connex_id"], {
            "boxes": [{"box_num": 1, "individual_items": []}],
        })
        self.assertEqual(updated["boxes"][0]["individual_items"], [])


class TestGenerateMasterRows(unittest.TestCase):
    """
    Regression tests for the master-row synthesis logic used by /generate to
    build Master_1750.pdf.  The route collects rows from both BOM sources
    (packing.boxes_to_master_rows) and individual_items on each box, then
    passes them through master_core.condense_master_rows + rows_to_bom_items.

    These tests exercise the synthetic individual_items → master row path so
    the ZIP always contains Master_1750.pdf and that path can't silently regress.
    """

    def _make_individual_items_connex_boxes(self):
        """Two boxes each with one individual item, no BOM job."""
        return [
            {
                "box_num": 1,
                "bom_ids": [],
                "sloc": "BLDG-100",
                "shrh_poc": "CPT JONES",
                "individual_items": [
                    {"description": "M4A1 Carbine", "sn": "SN-W001",
                     "nsn": "1005-01-231-0973", "lin": "R97234"},
                ],
            },
            {
                "box_num": 2,
                "bom_ids": [],
                "sloc": "BLDG-101",
                "shrh_poc": "SGT SMITH",
                "individual_items": [
                    {"description": "Helmet ACH", "sn": "SN-H002",
                     "nsn": "8470-01-523-5949", "lin": "H12345"},
                ],
            },
        ]

    def _build_master_rows_from_individual_items(self, boxes):
        """Mirror the row-synthesis logic in api_generate_connex."""
        master_rows = []
        for box in boxes:
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
        return master_rows

    def test_individual_items_produce_master_rows(self):
        boxes = self._make_individual_items_connex_boxes()
        rows = self._build_master_rows_from_individual_items(boxes)
        self.assertEqual(len(rows), 2)

    def test_master_rows_have_correct_box_nums(self):
        boxes = self._make_individual_items_connex_boxes()
        rows = self._build_master_rows_from_individual_items(boxes)
        self.assertEqual(rows[0]["box_num"], 1)
        self.assertEqual(rows[1]["box_num"], 2)

    def test_master_rows_have_description_as_model(self):
        boxes = self._make_individual_items_connex_boxes()
        rows = self._build_master_rows_from_individual_items(boxes)
        self.assertEqual(rows[0]["model"], "M4A1 Carbine")
        self.assertEqual(rows[1]["model"], "Helmet ACH")

    def test_master_rows_include_serial_in_serials_list(self):
        boxes = self._make_individual_items_connex_boxes()
        rows = self._build_master_rows_from_individual_items(boxes)
        self.assertEqual(rows[0]["serials"], ["SN-W001"])

    def test_blank_description_items_skipped(self):
        """Individual items with no description must not generate master rows."""
        boxes = [{
            "box_num": 1, "bom_ids": [],
            "individual_items": [
                {"description": "", "sn": "SN-1", "nsn": "", "lin": ""},  # blank — skip
                {"description": "Real Item", "sn": "SN-2", "nsn": "", "lin": ""},
            ],
        }]
        rows = self._build_master_rows_from_individual_items(boxes)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["model"], "Real Item")

    def test_master_rows_pass_through_condense(self):
        """condense_master_rows must not crash on individual_items-derived rows."""
        import master_core
        boxes = self._make_individual_items_connex_boxes()
        rows = self._build_master_rows_from_individual_items(boxes)
        condensed = master_core.condense_master_rows(rows)
        # Two distinct items — both preserved, re-sequenced 1..2.
        self.assertEqual(len(condensed), 2)
        box_nums = [r["box_num"] for r in condensed]
        self.assertEqual(box_nums, [1, 2])

    def test_condensed_rows_produce_bom_items(self):
        """rows_to_bom_items must not crash and must yield one item per row."""
        import master_core
        boxes = self._make_individual_items_connex_boxes()
        rows = self._build_master_rows_from_individual_items(boxes)
        condensed = master_core.condense_master_rows(rows)
        bom_items = master_core.rows_to_bom_items(condensed)
        # At minimum one BomItem per condensed row (no serial overflow here).
        self.assertGreaterEqual(len(bom_items), 2)

    def test_zip_namelist_includes_master(self):
        """
        Smoke-test that a ZIP built from the individual-items path contains
        Master_1750.pdf.  Exercises the real render_core path end-to-end
        without Flask.
        """
        import zipfile, io, tempfile, os
        import master_core, render_core, packing

        TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blank_1750.pdf")

        boxes = self._make_individual_items_connex_boxes()
        connex = {
            "connex_id": "cx_test_master",
            "connex_no": "CONEX-T1",
            "sun": "SUN-T1",
            "seal_no": "S-T1",
            "box_count": 2,
            "packed_by": "1LT RABATIN",
            "signed_by": "CPT HOLLAND",
            "date": "17 JUN 2026",
            "boxes": boxes,
        }

        master_rows = self._build_master_rows_from_individual_items(boxes)
        condensed = master_core.condense_master_rows(master_rows)
        master_bom_items = master_core.rows_to_bom_items(condensed)

        master_hdr = render_core.build_connex_header(connex, {}, 2, "ALL", None)

        zip_buf = io.BytesIO()
        with tempfile.TemporaryDirectory() as tmpdir:
            with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
                m_fd, m_path = tempfile.mkstemp(suffix=".pdf", dir=tmpdir)
                os.close(m_fd)
                render_core.generate_dd1750_from_items(
                    master_bom_items, TEMPLATE, m_path,
                    header=master_hdr,
                    draw_master_header_fn=render_core.draw_master_header,
                )
                with open(m_path, "rb") as fh:
                    zf.writestr("Master_1750.pdf", fh.read())

                for box in boxes:
                    # minimal per-box PDF (one item)
                    item = box["individual_items"][0]
                    bi = [render_core.BomItem(
                        line_no=1,
                        description=item["description"],
                        nsn=item.get("nsn", ""),
                        qty=1, unit_of_issue="EA",
                    )]
                    hdr = render_core.build_connex_header(connex, box, 2, str(box["box_num"]), None)
                    b_fd, b_path = tempfile.mkstemp(suffix=".pdf", dir=tmpdir)
                    os.close(b_fd)
                    render_core.generate_dd1750_from_items(
                        bi, TEMPLATE, b_path,
                        header=hdr,
                        draw_master_header_fn=render_core.draw_master_header,
                    )
                    with open(b_path, "rb") as fh:
                        zf.writestr(f"Box_{box['box_num']:03d}.pdf", fh.read())

        zip_buf.seek(0)
        names = zipfile.ZipFile(zip_buf).namelist()
        self.assertIn("Master_1750.pdf", names)
        self.assertIn("Box_001.pdf", names)
        self.assertIn("Box_002.pdf", names)
        self.assertEqual(len(names), 3)


class TestAssignWarnings(unittest.TestCase):
    """
    DEFECT-1 regression: POST /api/connex/<id>/assign must return a non-empty
    `warnings` list when a move references a bom_id that is not in the attached
    job, or targets a box number outside the connex range.  Valid moves are still
    applied; HTTP status stays 200.
    """

    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)

        # Import app here so the module-level data-dir patch (above) is already in
        # effect before app.py first touches connex_store.CONNEXES_DIR.
        import app as _app
        import packing

        self._app = _app
        self._packing = packing

        # Create a connex with 2 boxes.
        self._cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=2)
        connex_id = self._cx["connex_id"]

        # Build a minimal fake ingest job with one known BOM.
        fake_item = {"line_no": 1, "description": "Widget", "nsn": "1234-00-111-2222",
                     "qty": 1, "unit_of_issue": "EA"}
        self._known_bom_id = "bom_known_001"
        fake_bom = {"bom_id": self._known_bom_id, "items": [fake_item]}

        # box_map: item key -> box_num
        item_key = packing.item_key(self._known_bom_id, 1)
        fake_box_map = {item_key: 1}

        self._job_id = "job_test_warn"
        import job_store as _js
        _js.save_job(self._job_id, {
            "boms": [fake_bom],
            "box_map": fake_box_map,
            "assigned_bom_ids": set(),
        })
        self._js = _js

        # Attach the fake job to the connex (patch_connex accepts ingest_job_id).
        connex_store.patch_connex(connex_id, {"ingest_job_id": self._job_id})

        self._client = _app.app.test_client()
        self._connex_id = connex_id

    def tearDown(self):
        pass  # SQLite job will be overwritten on next setUp; no cleanup needed

    def test_unknown_bom_id_returns_warning(self):
        """A move with a bom_id not in the attached job must produce a warning."""
        resp = self._client.post(
            f"/api/connex/{self._connex_id}/assign",
            json={"moves": [{"bom_id": "bom_does_not_exist", "box_num": 1}]},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertIn("warnings", body)
        self.assertGreater(len(body["warnings"]), 0)
        self.assertIn("bom_does_not_exist", body["warnings"][0])

    def test_unknown_bom_id_does_not_affect_valid_move(self):
        """A mix of valid + unknown bom_id: valid move applied, unknown warned."""
        resp = self._client.post(
            f"/api/connex/{self._connex_id}/assign",
            json={"moves": [
                {"bom_id": self._known_bom_id, "box_num": 2},     # valid
                {"bom_id": "bom_phantom", "box_num": 1},           # unknown
            ]},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        # Warning for the unknown bom only.
        self.assertEqual(len(body["warnings"]), 1)
        self.assertIn("bom_phantom", body["warnings"][0])
        # Known BOM should now be in box 2.
        box2 = next(b for b in body["connex"]["boxes"] if b["box_num"] == 2)
        self.assertIn(self._known_bom_id, box2["bom_ids"])

    def test_out_of_range_box_num_returns_warning(self):
        """A move targeting a box number beyond box_count must produce a warning."""
        resp = self._client.post(
            f"/api/connex/{self._connex_id}/assign",
            json={"moves": [{"bom_id": self._known_bom_id, "box_num": 99}]},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertIn("warnings", body)
        self.assertGreater(len(body["warnings"]), 0)
        self.assertIn("out of range", body["warnings"][0])

    def test_valid_move_no_warnings(self):
        """A fully valid move must return an empty warnings list."""
        resp = self._client.post(
            f"/api/connex/{self._connex_id}/assign",
            json={"moves": [{"bom_id": self._known_bom_id, "box_num": 1}]},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertIn("warnings", body)
        self.assertEqual(body["warnings"], [])

    def test_separate_creates_real_box(self):
        """A separated BOM must be assigned to a box persisted on the connex."""
        job = self._js.load_job(self._job_id)
        job["box_map"]["other-bom:1"] = 2
        self._js.save_job(self._job_id, job)

        resp = self._client.post(
            f"/api/connex/{self._connex_id}/assign",
            json={"moves": [{"bom_id": self._known_bom_id, "separate": True}]},
        )

        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        box3 = next(b for b in body["connex"]["boxes"] if b["box_num"] == 3)
        self.assertIn(self._known_bom_id, box3["bom_ids"])
        self.assertEqual(body["item_box_map"][f"{self._known_bom_id}:1"], 3)


class TestBoxAddRemove(unittest.TestCase):
    """ISSUE 3 — add/remove box endpoints + store functions."""

    def setUp(self):
        shutil.rmtree(connex_store.CONNEXES_DIR, ignore_errors=True)
        os.makedirs(connex_store.CONNEXES_DIR, exist_ok=True)
        import app as _app
        self._client = _app.app.test_client()

    # ----- store layer -----

    def test_add_box_increments_count(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=3)
        updated = connex_store.add_box(cx["connex_id"])
        self.assertEqual(updated["box_count"], 4)
        self.assertEqual(len(updated["boxes"]), 4)
        self.assertEqual(updated["boxes"][-1]["box_num"], 4)

    def test_add_box_uses_max_plus_one_after_removal(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=3)
        cid = cx["connex_id"]
        # Remove box 2 (empty), then add — new box should be 4, not 2.
        connex_store.remove_box(cid, 2)
        updated = connex_store.add_box(cid)
        nums = [b["box_num"] for b in updated["boxes"]]
        self.assertEqual(nums, [1, 3, 4])

    def test_remove_empty_box_decrements_count(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=3)
        result = connex_store.remove_box(cx["connex_id"], 2)
        self.assertTrue(result["ok"])
        self.assertEqual(result["connex"]["box_count"], 2)
        nums = [b["box_num"] for b in result["connex"]["boxes"]]
        self.assertEqual(nums, [1, 3])  # no renumbering

    def test_remove_nonempty_box_without_force_rejected(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=2)
        connex_store.apply_bom_assignments(cx["connex_id"], {1: ["bom_x"]})
        result = connex_store.remove_box(cx["connex_id"], 1)
        self.assertFalse(result["ok"])
        # Box still present.
        loaded = connex_store.load_connex(cx["connex_id"])
        self.assertEqual(loaded["box_count"], 2)

    def test_remove_nonempty_box_with_force_removes(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=2)
        connex_store.apply_bom_assignments(cx["connex_id"], {1: ["bom_x"]})
        result = connex_store.remove_box(cx["connex_id"], 1, force=True)
        self.assertTrue(result["ok"])
        self.assertEqual(result["connex"]["box_count"], 1)
        nums = [b["box_num"] for b in result["connex"]["boxes"]]
        self.assertEqual(nums, [2])

    def test_remove_missing_box_returns_error(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=1)
        result = connex_store.remove_box(cx["connex_id"], 99)
        self.assertFalse(result["ok"])

    # ----- HTTP routes -----

    def test_route_add_box(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=2)
        resp = self._client.post(f"/api/connex/{cx['connex_id']}/boxes")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["connex"]["box_count"], 3)

    def test_route_remove_empty_box(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=2)
        resp = self._client.delete(f"/api/connex/{cx['connex_id']}/boxes/2")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["connex"]["box_count"], 1)

    def test_route_remove_nonempty_box_409(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=2)
        connex_store.apply_bom_assignments(cx["connex_id"], {1: ["bom_x"]})
        resp = self._client.delete(f"/api/connex/{cx['connex_id']}/boxes/1")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.get_json()["code"], "BOX_NOT_EMPTY")

    def test_route_remove_nonempty_box_force(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=2)
        connex_store.apply_bom_assignments(cx["connex_id"], {1: ["bom_x"]})
        resp = self._client.delete(f"/api/connex/{cx['connex_id']}/boxes/1?force=1")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["connex"]["box_count"], 1)

    def test_route_add_box_sealed_409(self):
        cx = self._sealed_connex()
        resp = self._client.post(f"/api/connex/{cx['connex_id']}/boxes")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.get_json()["code"], "SEALED")

    def test_route_remove_box_sealed_409(self):
        cx = self._sealed_connex()
        resp = self._client.delete(f"/api/connex/{cx['connex_id']}/boxes/1")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.get_json()["code"], "SEALED")

    def _sealed_connex(self):
        cx = connex_store.create_connex(FAKE_PROFILE_ID, box_count=1)
        connex_store.apply_bom_assignments(cx["connex_id"], {1: ["bom_abc"]})
        connex_store.patch_connex(cx["connex_id"], {
            "boxes": [{"box_num": 1, "sloc": "BLDG-1", "shrh_poc": "CPT X"}],
            "packed_by": "1LT RABATIN",
            "signed_by": "CPT HOLLAND",
        })
        connex_store.seal_connex(cx["connex_id"])
        return connex_store.load_connex(cx["connex_id"])


class TestMajorEndItemsHeader(unittest.TestCase):
    """ISSUE 7 — MAJOR END ITEMS count = (#BOMs) + (#non-blank individual items)."""

    def test_per_box_count(self):
        import app as _app
        box = {
            "box_num": 1,
            "bom_ids": ["bom_a", "bom_b"],
            "individual_items": [
                {"description": "Helmet", "sn": "", "nsn": "", "lin": ""},
                {"description": "", "sn": "x", "nsn": "", "lin": ""},  # blank — skip
            ],
        }
        self.assertEqual(_app._box_major_end_items(box), 3)

    def test_header_emits_correct_major_end_items(self):
        import render_core
        connex = {
            "connex_id": "cx", "connex_no": "C1", "sun": "S1", "seal_no": "SE1",
            "box_count": 2, "packed_by": "1LT R", "signed_by": "CPT H",
            "date": "17 JUN 2026", "boxes": [],
        }
        box = {
            "box_num": 1,
            "bom_ids": ["bom_a", "bom_b"],
            "sloc": "BLDG-1", "shrh_poc": "CPT X",
            "individual_items": [
                {"description": "Helmet", "sn": "", "nsn": "", "lin": ""},
                {"description": "", "sn": "x", "nsn": "", "lin": ""},  # blank — skip
            ],
        }
        import app as _app
        hdr = render_core.build_connex_header(
            connex, box, 2, "1", None,
            major_end_items=_app._box_major_end_items(box),
        )
        self.assertIn("MAJOR END ITEMS: (3)", hdr.end_item)
        # NO. BOXES unchanged — still the real box count.
        self.assertEqual(hdr.num_boxes, "2")

    def test_master_sums_over_boxes(self):
        import app as _app
        boxes = [
            {"box_num": 1, "bom_ids": ["a", "b"], "individual_items": [
                {"description": "X", "sn": "", "nsn": "", "lin": ""}]},
            {"box_num": 2, "bom_ids": ["c"], "individual_items": []},
        ]
        master_mei = sum(_app._box_major_end_items(b) for b in boxes)
        self.assertEqual(master_mei, 4)  # (2+1) + (1+0)

    def test_default_falls_back_to_box_count(self):
        import render_core
        connex = {
            "connex_id": "cx", "connex_no": "C1", "sun": "S1", "seal_no": "SE1",
            "box_count": 5, "packed_by": "1LT R", "signed_by": "CPT H",
            "date": "17 JUN 2026", "boxes": [],
        }
        hdr = render_core.build_connex_header(connex, {"box_num": 1}, 5, "1", None)
        self.assertIn("MAJOR END ITEMS: (5)", hdr.end_item)


class TestItemizedMasterRows(unittest.TestCase):
    """
    The connex master 1750 lists ONE row per end item and keeps each item's
    real box number (packing.boxes_to_itemized_master_rows +
    master_core.finalize_master_rows). Two boxes must never produce a box
    number of 3, and multiple end items in a box must each get their own line.
    """

    def _boms_two_boxes(self):
        # Box 1: two different end items. Box 2: two different end items.
        boms = [
            {"bom_id": "b1", "nomenclature": "TRK CG LWB", "model": "",
             "lin": "T62112", "end_item_niin": "015527780",
             "serial_number": "J-K900200A-DY", "items": [{"line_no": 1}]},
            {"bom_id": "b2", "nomenclature": "RADAR SET", "model": "",
             "lin": "R05043", "end_item_niin": "016229674",
             "serial_number": "605135", "items": [{"line_no": 1}]},
            {"bom_id": "b3", "nomenclature": "ENCRYPTION-DECRYPTI", "model": "",
             "lin": "E05003", "end_item_niin": "015302811",
             "serial_number": "0041403", "items": [{"line_no": 1}]},
            {"bom_id": "b4", "nomenclature": "TEST SET", "model": "",
             "lin": "", "end_item_niin": "", "serial_number": "MSD-V3-000535",
             "items": [{"line_no": 1}]},
        ]
        box_map = {"b1:1": 1, "b2:1": 1, "b3:1": 2, "b4:1": 2}
        return boms, box_map

    def test_one_row_per_end_item(self):
        boms, box_map = self._boms_two_boxes()
        rows = packing.boxes_to_itemized_master_rows(boms, box_map)
        rows = master_core.finalize_master_rows(rows)
        self.assertEqual(len(rows), 4)  # not "; "-joined into 2

    def test_box_numbers_reflect_real_boxes(self):
        boms, box_map = self._boms_two_boxes()
        rows = master_core.finalize_master_rows(
            packing.boxes_to_itemized_master_rows(boms, box_map))
        box_nums = [r["box_num"] for r in rows]
        self.assertEqual(box_nums, [1, 1, 2, 2])     # sorted, real boxes
        self.assertEqual(max(box_nums), 2)           # never re-sequenced to 3

    def test_identical_items_merge_within_box_split_across(self):
        # 3 identical M4s in box 1, 2 in box 2 → one row per box, qty 3 / 2.
        boms = [
            {"bom_id": f"m{i}", "nomenclature": "RIFLE M4", "model": "",
             "lin": "A12345", "end_item_niin": "010101010",
             "serial_number": f"SN{i}", "items": [{"line_no": 1}]}
            for i in range(5)
        ]
        box_map = {"m0:1": 1, "m1:1": 1, "m2:1": 1, "m3:1": 2, "m4:1": 2}
        rows = master_core.finalize_master_rows(
            packing.boxes_to_itemized_master_rows(boms, box_map))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["box_num"], 1)
        self.assertEqual(rows[0]["qty"], 3)
        self.assertEqual(rows[1]["box_num"], 2)
        self.assertEqual(rows[1]["qty"], 2)


if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
