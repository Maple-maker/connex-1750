"""
test_connex.py — Unit tests for connex_store.py

Run with: python3 test_connex.py  (from the master-1750-tool directory)
"""

import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Redirect data dir before importing.
_tmp_data_dir = tempfile.mkdtemp()

import connex_store

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


if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
