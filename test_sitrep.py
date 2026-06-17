"""
test_sitrep.py — Unit tests for sitrep.py

Run with: python3 test_sitrep.py  (from the master-1750-tool directory)
"""

import sys
import os
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sitrep


def _make_connex(connex_no="CONEX-01", sun="SUN-123", seal_no="S-001",
                 status="sealed", box_count=2, boxes=None):
    if boxes is None:
        boxes = [
            {
                "box_num": 1,
                "bom_ids": ["bom_a"],
                "sloc": "BLDG-100",
                "shrh_poc": "CPT JONES",
                "individual_items": [],
            },
            {
                "box_num": 2,
                "bom_ids": [],
                "sloc": "",
                "shrh_poc": "",
                "individual_items": [],
            },
        ]
    return {
        "connex_id": "cx_" + connex_no.replace("-", ""),
        "profile_id": "prof_abc",
        "connex_no": connex_no,
        "sun": sun,
        "seal_no": seal_no,
        "status": status,
        "box_count": box_count,
        "boxes": boxes,
    }


def _make_profile():
    return {
        "profile_id": "prof_abc",
        "brigade": "108th ADA",
        "battalion": "2-55 ADA",
        "battery": "B",
    }


class TestBuildSitrep(unittest.TestCase):
    def test_returns_required_keys(self):
        result = sitrep.build_sitrep([_make_connex()], _make_profile())
        for key in ("generated", "profile", "connex_count", "box_count",
                    "bom_count", "individual_item_count", "connexes", "flags"):
            self.assertIn(key, result, f"Missing key: {key}")

    def test_connex_count_correct(self):
        result = sitrep.build_sitrep([_make_connex(), _make_connex("CONEX-02")], _make_profile())
        self.assertEqual(result["connex_count"], 2)

    def test_box_count_counts_populated_boxes_only(self):
        cx = _make_connex()  # box 1 has bom, box 2 is empty
        result = sitrep.build_sitrep([cx], _make_profile())
        # Only box 1 is populated.
        self.assertEqual(result["box_count"], 1)

    def test_bom_count_sums_across_connexes(self):
        cx1 = _make_connex(boxes=[
            {"box_num": 1, "bom_ids": ["bom_a", "bom_b"], "sloc": "A", "shrh_poc": "B", "individual_items": []},
        ])
        cx2 = _make_connex("CONEX-02", boxes=[
            {"box_num": 1, "bom_ids": ["bom_c"], "sloc": "C", "shrh_poc": "D", "individual_items": []},
        ])
        result = sitrep.build_sitrep([cx1, cx2], _make_profile())
        self.assertEqual(result["bom_count"], 3)

    def test_individual_item_count_correct(self):
        cx = _make_connex(boxes=[
            {
                "box_num": 1,
                "bom_ids": [],
                "sloc": "BLDG-1",
                "shrh_poc": "CPT X",
                "individual_items": [
                    {"description": "Boots", "sn": "SN1", "nsn": "", "lin": ""},
                    {"description": "Belt", "sn": "SN2", "nsn": "", "lin": ""},
                ],
            }
        ])
        result = sitrep.build_sitrep([cx], _make_profile())
        self.assertEqual(result["individual_item_count"], 2)

    def test_profile_block_populated(self):
        result = sitrep.build_sitrep([_make_connex()], _make_profile())
        self.assertEqual(result["profile"]["brigade"], "108th ADA")
        self.assertEqual(result["profile"]["battalion"], "2-55 ADA")
        self.assertEqual(result["profile"]["battery"], "B")

    def test_missing_sun_generates_flag(self):
        cx = _make_connex(sun="")
        result = sitrep.build_sitrep([cx], _make_profile())
        self.assertTrue(any("SUN" in f for f in result["flags"]))

    def test_populated_sun_no_flag(self):
        cx = _make_connex(sun="SUN-001")
        result = sitrep.build_sitrep([cx], _make_profile())
        sun_flags = [f for f in result["flags"] if "SUN" in f]
        self.assertEqual(sun_flags, [])

    def test_empty_connex_list(self):
        result = sitrep.build_sitrep([], None)
        self.assertEqual(result["connex_count"], 0)
        self.assertEqual(result["box_count"], 0)
        self.assertEqual(result["bom_count"], 0)
        self.assertEqual(result["connexes"], [])

    def test_connex_block_shape(self):
        result = sitrep.build_sitrep([_make_connex()], _make_profile())
        cx_block = result["connexes"][0]
        for key in ("connex_id", "connex_no", "sun", "seal_no", "status", "boxes"):
            self.assertIn(key, cx_block, f"Missing connex key: {key}")

    def test_box_block_shape(self):
        result = sitrep.build_sitrep([_make_connex()], _make_profile())
        box_block = result["connexes"][0]["boxes"][0]
        for key in ("box_num", "sloc", "shrh_poc", "boms", "individual_items"):
            self.assertIn(key, box_block, f"Missing box key: {key}")

    def test_no_profile_gives_empty_profile_block(self):
        result = sitrep.build_sitrep([_make_connex()], None)
        self.assertEqual(result["profile"]["brigade"], "")

    def test_individual_items_filtered_blank_rows(self):
        """Fully blank individual_items rows should be excluded from output."""
        cx = _make_connex(boxes=[
            {
                "box_num": 1,
                "bom_ids": [],
                "sloc": "BLDG-1",
                "shrh_poc": "CPT X",
                "individual_items": [
                    {"description": "", "sn": "", "nsn": "", "lin": ""},  # blank row
                    {"description": "Widget", "sn": "SN1", "nsn": "", "lin": ""},  # real row
                ],
            }
        ])
        result = sitrep.build_sitrep([cx], _make_profile())
        items = result["connexes"][0]["boxes"][0]["individual_items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["description"], "Widget")


class TestEnrichSitrepBoms(unittest.TestCase):
    def _base_sitrep(self):
        return {
            "connexes": [
                {
                    "boxes": [
                        {
                            "boms": [{"nomenclature": "bom_abc", "lin": "", "serial": "", "item_count": 0}],
                            "individual_items": [],
                        }
                    ]
                }
            ]
        }

    def test_enrich_replaces_bom_id_with_real_metadata(self):
        s = self._base_sitrep()
        boms_by_id = {
            "bom_abc": {
                "nomenclature": "M4A1 Carbine",
                "lin": "R97234",
                "serial_number": "SN001",
                "item_count": 12,
            }
        }
        sitrep.enrich_sitrep_boms(s, boms_by_id)
        bom = s["connexes"][0]["boxes"][0]["boms"][0]
        self.assertEqual(bom["nomenclature"], "M4A1 Carbine")
        self.assertEqual(bom["lin"], "R97234")
        self.assertEqual(bom["serial"], "SN001")
        self.assertEqual(bom["item_count"], 12)

    def test_missing_bom_id_keeps_placeholder(self):
        s = self._base_sitrep()
        sitrep.enrich_sitrep_boms(s, {})  # empty lookup
        bom = s["connexes"][0]["boxes"][0]["boms"][0]
        # Placeholder preserved.
        self.assertEqual(bom["nomenclature"], "bom_abc")


class TestIndividualItemsOnlySitrep(unittest.TestCase):
    """
    Regression tests for a connex whose boxes contain ONLY individual_items
    (no ingest job, no bom_ids).  These must produce a valid SITREP and non-zero
    item counts — previously the generate route rejected these connexes with
    NO_JOB; sitrep must handle them too.
    """

    def _individual_item_connex(self):
        return {
            "connex_id": "cx_ind_test",
            "profile_id": "prof_abc",
            "connex_no": "CONEX-IND-01",
            "sun": "SUN-IND-001",
            "seal_no": "S-999",
            "status": "sealed",
            "box_count": 1,
            "boxes": [
                {
                    "box_num": 1,
                    "bom_ids": [],
                    "sloc": "BLDG-200",
                    "shrh_poc": "SGT SMITH",
                    "individual_items": [
                        {"description": "Helmet ACH", "sn": "SN-1",
                         "nsn": "8470-01-523-5949", "lin": "H12345"},
                    ],
                }
            ],
        }

    def test_individual_item_count_non_zero(self):
        cx = self._individual_item_connex()
        result = sitrep.build_sitrep([cx], None)
        self.assertEqual(result["individual_item_count"], 1)

    def test_box_count_non_zero(self):
        """A box with only individual_items counts as an occupied box."""
        cx = self._individual_item_connex()
        result = sitrep.build_sitrep([cx], None)
        self.assertEqual(result["box_count"], 1)

    def test_bom_count_zero(self):
        cx = self._individual_item_connex()
        result = sitrep.build_sitrep([cx], None)
        self.assertEqual(result["bom_count"], 0)

    def test_individual_item_present_in_box_block(self):
        cx = self._individual_item_connex()
        result = sitrep.build_sitrep([cx], None)
        items = result["connexes"][0]["boxes"][0]["individual_items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["description"], "Helmet ACH")
        self.assertEqual(items[0]["sn"], "SN-1")

    def test_no_flags_for_individual_items_only_connex_with_sun(self):
        cx = self._individual_item_connex()
        result = sitrep.build_sitrep([cx], None)
        # SUN is set so no SUN flag; no zero-on-hand boxes since box has items.
        self.assertEqual(result["flags"], [])


if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
