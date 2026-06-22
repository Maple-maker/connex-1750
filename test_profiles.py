"""
test_profiles.py — Unit tests for profiles.py

Run with: python3 test_profiles.py  (from the master-1750-tool directory)
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import uuid
from unittest import mock

# Ensure the module root is on the path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Redirect the module's data directory to a temp dir before importing.
_tmp_data_dir = tempfile.mkdtemp()

import profiles

_original_profiles_dir = profiles.PROFILES_DIR
profiles.PROFILES_DIR = os.path.join(_tmp_data_dir, "profiles")
os.makedirs(profiles.PROFILES_DIR, exist_ok=True)


def teardown_module():
    shutil.rmtree(_tmp_data_dir, ignore_errors=True)


class TestUpsertProfile(unittest.TestCase):
    def setUp(self):
        # Clean the profiles dir before each test.
        shutil.rmtree(profiles.PROFILES_DIR, ignore_errors=True)
        os.makedirs(profiles.PROFILES_DIR, exist_ok=True)

    def test_create_new_profile_returns_dict_with_id(self):
        p = profiles.upsert_profile("108th ADA", "2-55 ADA", "B")
        self.assertIn("profile_id", p)
        self.assertEqual(p["brigade"], "108th ADA")
        self.assertEqual(p["battalion"], "2-55 ADA")
        self.assertEqual(p["battery"], "B")

    def test_profile_persists_to_disk(self):
        p = profiles.upsert_profile("108th ADA", "2-55 ADA", "B")
        pid = p["profile_id"]
        loaded = profiles.load_profile(pid)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["profile_id"], pid)

    def test_upsert_by_unit_identity_updates_not_duplicates(self):
        p1 = profiles.upsert_profile("108th ADA", "2-55 ADA", "B", uic="WH1ZB0")
        p2 = profiles.upsert_profile("108th ADA", "2-55 ADA", "B", uic="NEW_UIC")
        self.assertEqual(p1["profile_id"], p2["profile_id"])
        self.assertEqual(p2["uic"], "NEW_UIC")
        # Only one file on disk.
        files = [f for f in os.listdir(profiles.PROFILES_DIR) if f.endswith(".json")]
        self.assertEqual(len(files), 1)

    def test_different_unit_identity_creates_new_profile(self):
        profiles.upsert_profile("108th ADA", "2-55 ADA", "B")
        profiles.upsert_profile("108th ADA", "2-55 ADA", "A")  # different battery
        all_profiles = profiles.list_profiles()
        self.assertEqual(len(all_profiles), 2)

    def test_list_profiles_sorted_by_last_used_desc(self):
        import time
        p1 = profiles.upsert_profile("108th ADA", "2-55 ADA", "B")
        time.sleep(1.1)  # timestamps are second-precision; need >1s gap
        p2 = profiles.upsert_profile("99th ADA", "1-1 ADA", "A")
        listing = profiles.list_profiles()
        self.assertEqual(listing[0]["profile_id"], p2["profile_id"])

    def test_load_nonexistent_returns_none(self):
        result = profiles.load_profile("deadbeef" * 4)
        self.assertIsNone(result)

    def test_optional_fields_default_to_empty(self):
        p = profiles.upsert_profile("108th ADA", "2-55 ADA", "B")
        self.assertEqual(p.get("uic"), "")
        self.assertEqual(p.get("default_packed_by"), "")
        self.assertEqual(p.get("default_shrh_poc"), "")
        self.assertEqual(p.get("stamp_text"), "")

    def test_all_optional_fields_saved_and_loaded(self):
        p = profiles.upsert_profile(
            "108th ADA", "2-55 ADA", "B",
            uic="WH1ZB0",
            default_packed_by="1LT RABATIN",
            default_shrh_poc="CPT JONES",
            stamp_text="2-55 ADA",
        )
        loaded = profiles.load_profile(p["profile_id"])
        self.assertEqual(loaded["uic"], "WH1ZB0")
        self.assertEqual(loaded["default_packed_by"], "1LT RABATIN")
        self.assertEqual(loaded["stamp_text"], "2-55 ADA")

    def test_touch_last_used_updates_timestamp(self):
        import time
        p = profiles.upsert_profile("108th ADA", "2-55 ADA", "B")
        old_ts = p["last_used"]
        time.sleep(1.1)  # need >1s gap since we use second precision
        result = profiles.touch_last_used(p["profile_id"])
        self.assertIsNotNone(result)
        self.assertNotEqual(result["last_used"], old_ts)

    def test_touch_last_used_nonexistent_returns_none(self):
        result = profiles.touch_last_used("nonexistent" * 3)
        self.assertIsNone(result)

    def test_brigade_image_round_trips(self):
        """brigade_image is saved and loaded correctly."""
        p = profiles.upsert_profile(
            "108th ADA", "2-55 ADA", "B",
            brigade_image="108th_Air_Defense_Artillery_Brigade.svg",
        )
        loaded = profiles.load_profile(p["profile_id"])
        self.assertEqual(loaded["brigade_image"], "108th_Air_Defense_Artillery_Brigade.svg")

    def test_brigade_image_defaults_to_empty(self):
        """Profiles created without brigade_image default to ''."""
        p = profiles.upsert_profile("108th ADA", "2-55 ADA", "B")
        self.assertEqual(p.get("brigade_image", ""), "")

    def test_brigade_image_updates_on_upsert(self):
        """Upsert overwrites brigade_image when the unit identity matches."""
        p1 = profiles.upsert_profile("108th ADA", "2-55 ADA", "B",
                                      brigade_image="old.svg")
        p2 = profiles.upsert_profile("108th ADA", "2-55 ADA", "B",
                                      brigade_image="new.svg")
        self.assertEqual(p1["profile_id"], p2["profile_id"])
        self.assertEqual(p2["brigade_image"], "new.svg")


class TestAtomicWrite(unittest.TestCase):
    """Verify that the written file is valid JSON (atomic write is opaque here)."""

    def setUp(self):
        shutil.rmtree(profiles.PROFILES_DIR, ignore_errors=True)
        os.makedirs(profiles.PROFILES_DIR, exist_ok=True)

    def test_written_file_is_valid_json(self):
        p = profiles.upsert_profile("108th ADA", "2-55 ADA", "B")
        path = os.path.join(profiles.PROFILES_DIR, f"{p['profile_id']}.json")
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        self.assertEqual(data["profile_id"], p["profile_id"])


class TestConcurrentMutations(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(profiles.PROFILES_DIR, ignore_errors=True)
        os.makedirs(profiles.PROFILES_DIR, exist_ok=True)

    def test_concurrent_upserts_do_not_create_duplicate_profiles(self):
        first_write_started = threading.Event()
        release_first_write = threading.Event()
        second_update_done = threading.Event()
        original_atomic_write = profiles._atomic_write

        def delayed_atomic_write(path, data):
            if data.get("uic") == "FIRST" and not first_write_started.is_set():
                first_write_started.set()
                self.assertTrue(release_first_write.wait(timeout=2))
            original_atomic_write(path, data)

        def first_upsert():
            profiles.upsert_profile("108th ADA", "2-55 ADA", "B", uic="FIRST")

        def second_upsert():
            profiles.upsert_profile("108th ADA", "2-55 ADA", "B", uic="SECOND")
            second_update_done.set()

        with mock.patch.object(profiles, "_atomic_write", side_effect=delayed_atomic_write):
            first = threading.Thread(target=first_upsert)
            second = threading.Thread(target=second_upsert)
            first.start()
            self.assertTrue(first_write_started.wait(timeout=2))
            second.start()
            second_update_done.wait(timeout=0.2)
            release_first_write.set()
            first.join(timeout=2)
            second.join(timeout=2)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        profile_files = [
            name for name in os.listdir(profiles.PROFILES_DIR)
            if name.endswith(".json")
        ]
        self.assertEqual(len(profile_files), 1)


if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
