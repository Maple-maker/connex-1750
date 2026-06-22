"""
profiles.py — Load/save/list/upsert Profile JSON under data/profiles/.

Each profile is a JSON file named <profile_id>.json.
Upsert logic: POST /api/profiles creates or updates by (brigade, battalion, battery).

All I/O is atomic: write to a temp file, then rename.  No global state beyond the
filesystem — these are pure-ish functions safe to import and test without Flask.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone

from file_lock import exclusive_file_lock

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILES_DIR = os.path.join(BASE_DIR, "data", "profiles")


def _now_iso() -> str:
    """Return current UTC time as an ISO-8601 string (seconds precision)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _profile_path(profile_id: str) -> str:
    return os.path.join(PROFILES_DIR, f"{profile_id}.json")


def _profiles_lock_path() -> str:
    return os.path.join(PROFILES_DIR, ".store.lock")


def _atomic_write(path: str, data: dict) -> None:
    """Write data to path atomically: write temp, then rename."""
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


def load_profile(profile_id: str) -> dict | None:
    """Return the profile dict or None if not found."""
    path = _profile_path(profile_id)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def list_profiles() -> list[dict]:
    """Return all profiles, sorted by last_used descending."""
    profiles = []
    if not os.path.isdir(PROFILES_DIR):
        return profiles
    for fname in os.listdir(PROFILES_DIR):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(PROFILES_DIR, fname), encoding="utf-8") as fh:
                profiles.append(json.load(fh))
        except (json.JSONDecodeError, OSError):
            continue
    profiles.sort(key=lambda p: p.get("last_used", ""), reverse=True)
    return profiles


def upsert_profile(
    brigade: str,
    battalion: str,
    battery: str,
    uic: str = "",
    default_packed_by: str = "",
    default_shrh_poc: str = "",
    stamp_text: str = "",
    brigade_image: str = "",
    division: str = "",
    division_image: str = "",
    battalion_image: str = "",
) -> dict:
    """
    Create or update a profile identified by (brigade, battalion, battery).

    If a profile with matching (brigade, battalion, battery) already exists it
    is updated in place and its last_used timestamp is refreshed.  Otherwise a
    new profile_id is minted and a new file is written.

    Insignia fields are filenames from the static/formations/ manifest. All
    default "" for back-compat with profiles created before each field existed:
      brigade_image  : the brigade SSI (e.g. "1st_Brigade...svg")
      division       : the division name (e.g. "82nd Airborne Division")
      division_image : the division SSI
      battalion_image: the battalion/regiment DUI

    Returns the final profile dict.
    """
    os.makedirs(PROFILES_DIR, exist_ok=True)
    with exclusive_file_lock(_profiles_lock_path()):
        # Search for an existing profile matching the unit identity.
        existing = None
        for p in list_profiles():
            if (
                p.get("brigade", "").strip() == brigade.strip()
                and p.get("battalion", "").strip() == battalion.strip()
                and p.get("battery", "").strip() == battery.strip()
            ):
                existing = p
                break

        now = _now_iso()

        if existing:
            # Update mutable fields; preserve profile_id and created.
            existing.update({
                "uic": uic,
                "default_packed_by": default_packed_by,
                "default_shrh_poc": default_shrh_poc,
                "stamp_text": stamp_text,
                "brigade_image": brigade_image,
                "division": division,
                "division_image": division_image,
                "battalion_image": battalion_image,
                "last_used": now,
            })
            profile = existing
        else:
            profile = {
                "profile_id": uuid.uuid4().hex,
                "brigade": brigade,
                "battalion": battalion,
                "battery": battery,
                "uic": uic,
                "default_packed_by": default_packed_by,
                "default_shrh_poc": default_shrh_poc,
                "stamp_text": stamp_text,
                "brigade_image": brigade_image,
                "division": division,
                "division_image": division_image,
                "battalion_image": battalion_image,
                "created": now,
                "last_used": now,
            }

        _atomic_write(_profile_path(profile["profile_id"]), profile)
        return profile


def touch_last_used(profile_id: str) -> dict | None:
    """
    Refresh last_used for profile_id.  Returns the updated profile, or None if
    the profile does not exist.
    """
    with exclusive_file_lock(_profiles_lock_path()):
        profile = load_profile(profile_id)
        if profile is None:
            return None
        profile["last_used"] = _now_iso()
        _atomic_write(_profile_path(profile_id), profile)
        return profile


__all__ = [
    "load_profile",
    "list_profiles",
    "upsert_profile",
    "touch_last_used",
]
