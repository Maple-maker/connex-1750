"""
test_acceptance.py  —  CONNEX 1750 Acceptance + Adversarial Suite
Run as a script:  python3 test_acceptance.py

Tests the live Flask server (must be running on port 8000 before running).
Follows the §8 MVP acceptance walkthrough from 01_MVP_BUILD_GUIDE.md and
the adversarial matrix from AGENT_QA.md.

DO NOT run with pytest — the script uses sys.exit() for CI signalling.
"""

import os
import sys
import io
import zipfile
import requests

BASE = "http://localhost:8000"
BOM_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "arms room BOMs",
)

# ---------------------------------------------------------------------------
# Test accounting
# ---------------------------------------------------------------------------

_results: list[tuple[str, str, str]] = []  # (label, PASS|FAIL, detail)
_failures = 0


def chk(label: str, cond: bool, detail: str = "") -> bool:
    global _failures
    status = "PASS" if cond else "FAIL"
    _results.append((label, status, detail))
    if not cond:
        _failures += 1
    print(f"[{status}] {label}" + (f"  ({detail})" if detail else ""))
    return cond


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ingest(*filenames: str) -> tuple[str, list[str]]:
    """Upload one or more BOM PDFs; return (job_id, [bom_id, ...])."""
    handles = []
    files_list = []
    for fname in filenames:
        fpath = os.path.join(BOM_DIR, fname)
        h = open(fpath, "rb")
        handles.append(h)
        files_list.append(("boms", (fname, h, "application/pdf")))
    r = requests.post(f"{BASE}/ingest", files=files_list)
    for h in handles:
        h.close()
    assert r.status_code == 200, f"/ingest returned {r.status_code}: {r.text[:200]}"
    data = r.json()
    return data["job_id"], [b["bom_id"] for b in data["boms"]]


def _make_profile() -> str:
    r = requests.post(
        f"{BASE}/api/profiles",
        json={
            "brigade": "108th ADA Brigade",
            "battalion": "2-55 ADA",
            "battery": "B",
            "uic": "WH1ZB0",
            "default_packed_by": "1LT RABATIN, JAIDEN",
            "stamp_text": "2-55 ADA",
            "brigade_image": "108th_Air_Defense_Artillery_Brigade.svg",
        },
    )
    assert r.status_code == 200
    return r.json()["profile"]["profile_id"]


def _make_connex(profile_id: str, box_count: int, connex_no: str = "") -> str:
    payload: dict = {"profile_id": profile_id, "box_count": box_count}
    if connex_no:
        payload["connex_no"] = connex_no
    r = requests.post(f"{BASE}/api/connex", json=payload)
    assert r.status_code == 200, f"POST /api/connex: {r.status_code} {r.text[:200]}"
    return r.json()["connex"]["connex_id"]


def _seal_connex(
    connex_id: str,
    packed_by: str = "1LT RABATIN, JAIDEN",
    signed_by: str = "CPT HOLLAND",
    date: str = "17 JUN 2026",
) -> dict:
    """Set signer fields and seal; raise if seal fails."""
    requests.put(
        f"{BASE}/api/connex/{connex_id}",
        json={"packed_by": packed_by, "signed_by": signed_by, "date": date},
    )
    r = requests.post(f"{BASE}/api/connex/{connex_id}/seal")
    assert r.json().get("ok"), f"Seal failed: {r.json().get('errors')}"
    return r.json()["connex"]


# ---------------------------------------------------------------------------
# SECTION 1 — Regression guard (verify server is healthy)
# ---------------------------------------------------------------------------

def test_health():
    print("\n=== REGRESSION: Server health ===")
    r = requests.get(f"{BASE}/api/health")
    chk("Health endpoint 200", r.status_code == 200, str(r.status_code))
    chk("Health status=ok", r.json().get("status") == "ok")


# ---------------------------------------------------------------------------
# SECTION 2 — §8 Acceptance walkthrough
# ---------------------------------------------------------------------------

def test_acceptance_walkthrough():
    print("\n=== §8 ACCEPTANCE WALKTHROUGH ===")

    # Step 1: Create profile with brigade_image
    r = requests.post(
        f"{BASE}/api/profiles",
        json={
            "brigade": "108th ADA Brigade",
            "battalion": "2-55 ADA",
            "battery": "B",
            "uic": "WH1ZB0",
            "default_packed_by": "1LT RABATIN, JAIDEN",
            "stamp_text": "2-55 ADA",
            "brigade_image": "108th_Air_Defense_Artillery_Brigade.svg",
        },
    )
    chk("Step 1: profile create returns 200", r.status_code == 200, str(r.status_code))
    profile = r.json().get("profile", {})
    profile_id = profile.get("profile_id", "")
    chk("Step 1: profile_id non-empty", bool(profile_id))
    chk("Step 1: brigade_image persisted", profile.get("brigade_image") == "108th_Air_Defense_Artillery_Brigade.svg")

    # GET profile round-trip
    r = requests.get(f"{BASE}/api/profiles/{profile_id}")
    chk("Step 1: GET profile round-trip", r.status_code == 200)
    chk("Step 1: brigade matches", r.json()["profile"].get("brigade") == "108th ADA Brigade")

    # GET all profiles includes new profile
    r = requests.get(f"{BASE}/api/profiles")
    chk("Step 1: GET /api/profiles includes new profile", any(p["profile_id"] == profile_id for p in r.json().get("profiles", [])))

    # Step 2: Open a connex, spawn 3 boxes
    r = requests.post(
        f"{BASE}/api/connex",
        json={"profile_id": profile_id, "box_count": 3, "connex_no": "CONEX-QA1"},
    )
    chk("Step 2: connex create 200", r.status_code == 200)
    connex = r.json().get("connex", {})
    connex_id = connex.get("connex_id", "")
    chk("Step 2: connex_id non-empty", bool(connex_id))
    chk("Step 2: 3 boxes spawned", len(connex.get("boxes", [])) == 3)
    chk("Step 2: status=building", connex.get("status") == "building")
    chk("Step 2: profile_id stored", connex.get("profile_id") == profile_id)

    # Step 3: Ingest 3 real BOM PDFs, attach, assign to boxes, set SLOC/SHRH
    job_id, bom_ids = _ingest(
        "SN_W0013298 C06935 CARBINE 5.56MILL M4A1.pdf",
        "SN_W0000185 C06935 CARBINE 5.56MILL M4A1.pdf",
        "M09009 MACH GUN 5.56MM M249 SN_ 128853.pdf",
    )
    chk("Step 3: 3 bom_ids returned", len(bom_ids) == 3, str(len(bom_ids)))

    r = requests.post(f"{BASE}/api/connex/{connex_id}/attach", json={"ingest_job_id": job_id})
    chk("Step 3: attach job 200", r.status_code == 200)
    chk("Step 3: ingest_job_id stored", r.json()["connex"].get("ingest_job_id") == job_id)

    r = requests.post(
        f"{BASE}/api/connex/{connex_id}/assign",
        json={"moves": [
            {"bom_id": bom_ids[0], "box_num": 1},
            {"bom_id": bom_ids[1], "box_num": 2},
            {"bom_id": bom_ids[2], "box_num": 3},
        ]},
    )
    chk("Step 3: assign BOMs 200", r.status_code == 200)

    r = requests.put(
        f"{BASE}/api/connex/{connex_id}",
        json={"boxes": [
            {"box_num": 1, "sloc": "BLDG-100", "shrh_poc": "CPT JONES"},
            {"box_num": 2, "sloc": "BLDG-200", "shrh_poc": "SSG MOORE"},
            {"box_num": 3, "sloc": "BLDG-300", "shrh_poc": "SPC SMITH"},
        ]},
    )
    chk("Step 3: SLOC/SHRH set 200", r.status_code == 200)
    connex = r.json()["connex"]
    chk("Step 3: all 3 boxes complete", all(b.get("complete") for b in connex["boxes"]))

    # Step 4: Blocked from sealing without signer
    r = requests.post(f"{BASE}/api/connex/{connex_id}/seal")
    chk("Step 4: seal without signer blocked (ok=False)", r.json().get("ok") == False)
    chk("Step 4: NO_SIGNER error returned", any("NO_SIGNER" in e for e in r.json().get("errors", [])))

    # Provide signer and seal
    requests.put(
        f"{BASE}/api/connex/{connex_id}",
        json={"sun": "SUN-7890", "seal_no": "S-12345",
              "packed_by": "1LT RABATIN, JAIDEN", "signed_by": "CPT HOLLAND",
              "date": "17 JUN 2026"},
    )
    r = requests.post(f"{BASE}/api/connex/{connex_id}/seal")
    chk("Step 4: seal ok=True after providing signer", r.json().get("ok") == True, str(r.json().get("errors", [])))
    chk("Step 4: status=sealed", r.json()["connex"].get("status") == "sealed")
    chk("Step 4: sealed timestamp set", bool(r.json()["connex"].get("sealed")))

    # Step 5: Add optional individual item
    r = requests.put(
        f"{BASE}/api/connex/{connex_id}",
        json={"boxes": [{"box_num": 1, "individual_items": [
            {"description": "SLING WEAPON M249", "sn": "SN-TEST001", "nsn": "1005-01-111-1111", "lin": "S99999"},
        ]}]},
    )
    chk("Step 5: individual item added 200", r.status_code == 200)
    box1 = next(b for b in r.json()["connex"]["boxes"] if b["box_num"] == 1)
    chk("Step 5: item present in box", len(box1.get("individual_items", [])) == 1)
    chk("Step 5: description stored", box1["individual_items"][0].get("description") == "SLING WEAPON M249")

    # Step 6: Generate per-box DD1750 ZIP
    r = requests.post(f"{BASE}/api/connex/{connex_id}/generate")
    chk("Step 6: generate 200", r.status_code == 200, str(r.status_code))
    chk("Step 6: content-type is zip", "zip" in r.headers.get("Content-Type", "").lower(), r.headers.get("Content-Type", ""))
    if r.status_code == 200:
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            names = z.namelist()
            chk("Step 6: 3 PDFs in ZIP (one per box)", len(names) == 3, str(names))
            chk("Step 6: all entries are PDFs", all(n.endswith(".pdf") for n in names))
            for name in names:
                data = z.read(name)
                chk(f"Step 6: {name} is valid PDF", data[:4] == b"%PDF")
                chk(f"Step 6: {name} > 10KB", len(data) > 10240, f"{len(data)} bytes")

    # Step 7: Start a second connex under same profile; first connex intact
    connex2_id = _make_connex(profile_id, 1, "CONEX-QA2")
    chk("Step 7: second connex created", bool(connex2_id))
    r = requests.get(f"{BASE}/api/connex/{connex_id}")
    chk("Step 7: first connex still accessible", r.status_code == 200)
    chk("Step 7: first connex still sealed", r.json()["connex"].get("status") == "sealed")

    # Complete and seal second connex
    job_id2, bom_ids2 = _ingest("M39331 MACHINE GUN CALIBER A001382.pdf")
    requests.post(f"{BASE}/api/connex/{connex2_id}/attach", json={"ingest_job_id": job_id2})
    requests.post(f"{BASE}/api/connex/{connex2_id}/assign", json={"moves": [{"bom_id": bom_ids2[0], "box_num": 1}]})
    requests.put(f"{BASE}/api/connex/{connex2_id}", json={"boxes": [{"box_num": 1, "sloc": "BLDG-400", "shrh_poc": "SFC DAVIS"}]})
    _seal_connex(connex2_id)

    # Step 8: SITREP across both connexes
    r = requests.post(f"{BASE}/api/sitrep", json={"connex_ids": [connex_id, connex2_id]})
    chk("Step 8: SITREP 200", r.status_code == 200)
    sitrep = r.json().get("sitrep", {})
    chk("Step 8: connex_count=2", sitrep.get("connex_count") == 2, str(sitrep.get("connex_count")))
    chk("Step 8: profile present", bool(sitrep.get("profile")))
    chk("Step 8: 2 connex entries", len(sitrep.get("connexes", [])) == 2)
    chk("Step 8: box_count >= 2", sitrep.get("box_count", 0) >= 2, str(sitrep.get("box_count")))
    chk("Step 8: bom_count >= 4", sitrep.get("bom_count", 0) >= 4, str(sitrep.get("bom_count")))
    chk("Step 8: generated timestamp", bool(sitrep.get("generated")))

    # SITREP by profile_id
    r = requests.post(f"{BASE}/api/sitrep", json={"profile_id": profile_id})
    chk("Step 8: SITREP by profile_id 200", r.status_code == 200)
    chk("Step 8: connex_count>=2 via profile", r.json()["sitrep"].get("connex_count", 0) >= 2)

    # SITREP PDF
    r = requests.post(f"{BASE}/api/sitrep/pdf", json={"connex_ids": [connex_id, connex2_id]})
    chk("Step 8: SITREP PDF 200", r.status_code == 200)
    chk("Step 8: SITREP PDF starts with %PDF", r.content[:4] == b"%PDF", f"starts={r.content[:4]}")
    chk("Step 8: SITREP PDF > 1KB", len(r.content) > 1024, f"{len(r.content)} bytes")


# ---------------------------------------------------------------------------
# SECTION 3 — Contract B seal validation matrix
# ---------------------------------------------------------------------------

def test_seal_validation_matrix():
    print("\n=== CONTRACT B SEAL VALIDATION MATRIX ===")
    profile_id = _make_profile()

    def _box_connex(n_boxes: int, sloc_for: dict | None = None, shrh_for: dict | None = None) -> str:
        """Create connex with item-populated boxes; optionally override sloc/shrh per box."""
        cid = _make_connex(profile_id, n_boxes)
        boxes_patch = []
        for i in range(1, n_boxes + 1):
            sloc = (sloc_for or {}).get(i, f"BLDG-{i}00")
            shrh = (shrh_for or {}).get(i, "CPT JONES")
            boxes_patch.append({
                "box_num": i,
                "sloc": sloc,
                "shrh_poc": shrh,
                "individual_items": [{"description": f"ITEM {i}", "sn": "", "nsn": "", "lin": ""}],
            })
        requests.put(f"{BASE}/api/connex/{cid}", json={
            "boxes": boxes_patch,
            "packed_by": "1LT RABATIN, JAIDEN",
            "signed_by": "CPT HOLLAND",
            "date": "17 JUN 2026",
        })
        return cid

    # B1: EMPTY_BOX
    cid = _box_connex(2)
    requests.put(f"{BASE}/api/connex/{cid}", json={"boxes": [{"box_num": 2, "individual_items": []}]})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("B1 EMPTY_BOX: ok=False", r.json().get("ok") == False)
    chk("B1 EMPTY_BOX: error code present", any("EMPTY_BOX" in e for e in r.json().get("errors", [])))

    # B2: MISSING_SLOC
    cid = _box_connex(1, sloc_for={1: ""})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("B2 MISSING_SLOC: ok=False", r.json().get("ok") == False)
    chk("B2 MISSING_SLOC: error code present", any("MISSING_SLOC" in e for e in r.json().get("errors", [])))

    # B3: MISSING_SHRH
    cid = _box_connex(1, shrh_for={1: ""})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("B3 MISSING_SHRH: ok=False", r.json().get("ok") == False)
    chk("B3 MISSING_SHRH: error code present", any("MISSING_SHRH" in e for e in r.json().get("errors", [])))

    # B4: NO_SIGNER
    cid = _box_connex(1)
    requests.put(f"{BASE}/api/connex/{cid}", json={"signed_by": ""})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("B4 NO_SIGNER: ok=False", r.json().get("ok") == False)
    chk("B4 NO_SIGNER: error code present", any("NO_SIGNER" in e for e in r.json().get("errors", [])))

    # B5: SIGNER_EQ_PACKER
    cid = _box_connex(1)
    requests.put(f"{BASE}/api/connex/{cid}", json={"packed_by": "1LT RABATIN", "signed_by": "1LT RABATIN"})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("B5 SIGNER_EQ_PACKER: ok=False", r.json().get("ok") == False)
    chk("B5 SIGNER_EQ_PACKER: error code present", any("SIGNER_EQ_PACKER" in e for e in r.json().get("errors", [])))

    # B6: Sunny day — all optional fields blank, seal succeeds
    cid = _box_connex(1)
    requests.put(f"{BASE}/api/connex/{cid}", json={"sun": "", "connex_no": "", "seal_no": ""})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("B6 Sunny-day (blank SUN/CONNEX/SEAL): ok=True", r.json().get("ok") == True, str(r.json().get("errors", [])))
    chk("B6 Sunny-day: status=sealed", r.json()["connex"].get("status") == "sealed")

    # B7: Multiple errors returned together
    cid = _box_connex(2, sloc_for={1: ""}, shrh_for={2: ""})
    requests.put(f"{BASE}/api/connex/{cid}", json={
        "boxes": [{"box_num": 2, "individual_items": [], "shrh_poc": ""}],
        "signed_by": "",
    })
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    errs = r.json().get("errors", [])
    chk("B7 Multiple errors: >=2 returned", len(errs) >= 2, str(errs))


# ---------------------------------------------------------------------------
# SECTION 4 — Adversarial checks
# ---------------------------------------------------------------------------

def test_adversarial():
    print("\n=== ADVERSARIAL CHECKS ===")
    profile_id = _make_profile()

    def ingest_one(fname: str) -> tuple[str, list[str]]:
        return _ingest(fname)

    # ADV1: Mixed populated/empty boxes — seal must block
    print("-- ADV1: mixed empty/populated boxes --")
    cid = _make_connex(profile_id, 2)
    job_id, bom_ids = ingest_one("SN_W0013298 C06935 CARBINE 5.56MILL M4A1.pdf")
    requests.post(f"{BASE}/api/connex/{cid}/attach", json={"ingest_job_id": job_id})
    requests.post(f"{BASE}/api/connex/{cid}/assign", json={"moves": [{"bom_id": bom_ids[0], "box_num": 1}]})
    requests.put(f"{BASE}/api/connex/{cid}", json={"boxes": [{"box_num": 1, "sloc": "BLDG-100", "shrh_poc": "CPT JONES"}]})
    requests.put(f"{BASE}/api/connex/{cid}", json={"packed_by": "1LT RABATIN", "signed_by": "CPT HOLLAND", "date": "17 JUN 2026"})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("ADV1: seal blocked (empty box 2)", r.json().get("ok") == False)
    chk("ADV1: EMPTY_BOX error", any("EMPTY_BOX" in e for e in r.json().get("errors", [])))

    # ADV2: All optional fields blank — PDF must not crash
    print("-- ADV2: blank optional fields no crash --")
    cid = _make_connex(profile_id, 1)
    job_id, bom_ids = ingest_one("SN_W0000185 C06935 CARBINE 5.56MILL M4A1.pdf")
    requests.post(f"{BASE}/api/connex/{cid}/attach", json={"ingest_job_id": job_id})
    requests.post(f"{BASE}/api/connex/{cid}/assign", json={"moves": [{"bom_id": bom_ids[0], "box_num": 1}]})
    requests.put(f"{BASE}/api/connex/{cid}", json={
        "boxes": [{"box_num": 1, "sloc": "BLDG-100", "shrh_poc": "CPT JONES"}],
        "sun": "", "connex_no": "", "seal_no": "",
        "packed_by": "1LT RABATIN, JAIDEN", "signed_by": "CPT HOLLAND", "date": "17 JUN 2026",
    })
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("ADV2: blank optional fields allow seal", r.json().get("ok") == True, str(r.json().get("errors", [])))
    r = requests.post(f"{BASE}/api/connex/{cid}/generate")
    chk("ADV2: generate succeeds (no crash)", r.status_code == 200, str(r.status_code))
    if r.status_code == 200:
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            for name in z.namelist():
                chk(f"ADV2: {name} is valid PDF", z.read(name)[:4] == b"%PDF")

    # ADV3: 0 boxes — rejected cleanly with INVALID_BOX_COUNT
    print("-- ADV3: 0 boxes rejected --")
    r = requests.post(f"{BASE}/api/connex", json={"profile_id": profile_id, "box_count": 0})
    chk("ADV3: 0 boxes returns 400", r.status_code == 400)
    chk("ADV3: INVALID_BOX_COUNT code", r.json().get("code") == "INVALID_BOX_COUNT")

    # ADV4: 24 boxes — accepted
    print("-- ADV4: 24 boxes --")
    r = requests.post(f"{BASE}/api/connex", json={"profile_id": profile_id, "box_count": 24})
    chk("ADV4: 24 boxes accepted", r.status_code == 200)
    if r.status_code == 200:
        chk("ADV4: exactly 24 boxes spawned", len(r.json()["connex"]["boxes"]) == 24, str(len(r.json()["connex"]["boxes"])))

    # ADV5: Re-ingest same BOM twice into same job — each gets unique bom_id, no hidden dedup
    print("-- ADV5: re-ingest same BOM twice --")
    fname = "SN_W0013298 C06935 CARBINE 5.56MILL M4A1.pdf"
    fpath = os.path.join(BOM_DIR, fname)
    h1 = open(fpath, "rb")
    h2 = open(fpath, "rb")
    r = requests.post(f"{BASE}/ingest", files=[
        ("boms", (fname, h1, "application/pdf")),
        ("boms", (fname + "_dup", h2, "application/pdf")),
    ])
    h1.close(); h2.close()
    boms = r.json().get("boms", [])
    bom_ids = [b["bom_id"] for b in boms]
    chk("ADV5: two uploads return 2 distinct bom_ids", len(set(bom_ids)) == 2, str([b[:8] for b in bom_ids]))
    # NOTE: cross-job duplicate assignment silently no-ops (by design — connex only
    # looks up BOMs from its attached job; bom_ids from other jobs are unknown to it).

    # ADV6: generate then start 2nd connex — first connex data intact
    print("-- ADV6: generate then start 2nd connex --")
    cid1 = _make_connex(profile_id, 1)
    job_id1, bids1 = ingest_one("SN_W0007085 C06935 CARBINE 5.56MILL M4A1.pdf")
    requests.post(f"{BASE}/api/connex/{cid1}/attach", json={"ingest_job_id": job_id1})
    requests.post(f"{BASE}/api/connex/{cid1}/assign", json={"moves": [{"bom_id": bids1[0], "box_num": 1}]})
    requests.put(f"{BASE}/api/connex/{cid1}", json={"boxes": [{"box_num": 1, "sloc": "BLDG-100", "shrh_poc": "CPT JONES"}]})
    _seal_connex(cid1)
    requests.post(f"{BASE}/api/connex/{cid1}/generate")  # generate once

    cid2 = _make_connex(profile_id, 2)  # start second connex
    r = requests.get(f"{BASE}/api/connex/{cid1}")
    chk("ADV6: first connex still accessible after generate + second connex create", r.status_code == 200)
    chk("ADV6: first connex still sealed (not overwritten)", r.json()["connex"].get("status") == "sealed")

    # ADV7: individual-items-only box (no BOMs at all)
    print("-- ADV7: individual-items-only box --")
    cid = _make_connex(profile_id, 1)
    requests.put(f"{BASE}/api/connex/{cid}", json={"boxes": [{
        "box_num": 1,
        "sloc": "BLDG-100", "shrh_poc": "CPT JONES",
        "individual_items": [
            {"description": "CLEANING KIT", "sn": "SN-001", "nsn": "1005-01-111-1111", "lin": "C12345"},
        ],
    }]})
    requests.put(f"{BASE}/api/connex/{cid}", json={"packed_by": "1LT RABATIN", "signed_by": "CPT HOLLAND", "date": "17 JUN 2026"})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("ADV7: individual-items-only box seals ok", r.json().get("ok") == True, str(r.json().get("errors", [])))
    r = requests.post(f"{BASE}/api/connex/{cid}/generate")
    chk("ADV7: generate succeeds (items-only path)", r.status_code == 200)
    if r.status_code == 200:
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            chk("ADV7: 1 PDF in ZIP", len(z.namelist()) == 1, str(z.namelist()))

    # ADV8: missing SLOC/SHRH per-box blocked at seal
    print("-- ADV8: per-box SLOC/SHRH blocks --")
    cid = _make_connex(profile_id, 2)
    requests.put(f"{BASE}/api/connex/{cid}", json={"boxes": [
        {"box_num": 1, "sloc": "", "shrh_poc": "CPT JONES",
         "individual_items": [{"description": "WIDGET", "sn": "", "nsn": "", "lin": ""}]},
        {"box_num": 2, "sloc": "BLDG-200", "shrh_poc": "",
         "individual_items": [{"description": "GADGET", "sn": "", "nsn": "", "lin": ""}]},
    ], "packed_by": "1LT RABATIN", "signed_by": "CPT HOLLAND", "date": "17 JUN 2026"})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    errs = r.json().get("errors", [])
    chk("ADV8: seal blocked (missing SLOC/SHRH)", r.json().get("ok") == False)
    chk("ADV8: MISSING_SLOC error for box 1", any("MISSING_SLOC" in e for e in errs), str(errs))
    chk("ADV8: MISSING_SHRH error for box 2", any("MISSING_SHRH" in e for e in errs), str(errs))

    # ADV9: signer == packer at seal time
    print("-- ADV9: signer==packer --")
    cid = _make_connex(profile_id, 1)
    requests.put(f"{BASE}/api/connex/{cid}", json={"boxes": [{
        "box_num": 1, "sloc": "BLDG-100", "shrh_poc": "CPT JONES",
        "individual_items": [{"description": "ITEM", "sn": "", "nsn": "", "lin": ""}],
    }], "packed_by": "1LT RABATIN", "signed_by": "1LT RABATIN", "date": "17 JUN 2026"})
    r = requests.post(f"{BASE}/api/connex/{cid}/seal")
    chk("ADV9: signer==packer blocked", r.json().get("ok") == False)
    chk("ADV9: SIGNER_EQ_PACKER code", any("SIGNER_EQ_PACKER" in e for e in r.json().get("errors", [])))


# ---------------------------------------------------------------------------
# SECTION 5 — Frontend static wiring (headless)
# ---------------------------------------------------------------------------

def test_frontend_wiring():
    print("\n=== FRONTEND STATIC WIRING ===")

    r = requests.get(f"{BASE}/")
    chk("FE: index.html loads", r.status_code == 200)
    html = r.text
    chk("FE: tokens.css referenced", "tokens.css" in html)
    chk("FE: style.css referenced", "style.css" in html)
    chk("FE: connex3d.js referenced", "connex3d.js" in html)
    chk("FE: importmap present", "importmap" in html)
    chk("FE: three importmap present", '"three"' in html or "three.module" in html)
    chk("FE: app.js referenced", "app.js" in html)

    r = requests.get(f"{BASE}/static/tokens.css")
    chk("FE: tokens.css loads", r.status_code == 200)
    for token in ("--connex-gold", "--connex-ok", "--connex-warn", "--connex-empty", "--connex-black"):
        chk(f"FE: {token} defined", token in r.text)

    r = requests.get(f"{BASE}/static/style.css")
    chk("FE: style.css loads", r.status_code == 200)
    chk("FE: style.css non-empty", len(r.text) > 100)

    r = requests.get(f"{BASE}/static/app.js")
    chk("FE: app.js loads", r.status_code == 200)
    chk("FE: app.js POSTs /api/profiles", "/api/profiles" in r.text)
    chk("FE: app.js sends brigade_image", "brigade_image" in r.text)
    chk("FE: app.js fetches formations manifest", "formations/manifest.json" in r.text)
    chk("FE: app.js references /api/sitrep", "/api/sitrep" in r.text)

    r = requests.get(f"{BASE}/static/glossary.js")
    chk("FE: glossary.js loads", r.status_code == 200)
    for term in ("SLOC", "SUN", "NSN", "LIN"):
        chk(f"FE: glossary defines {term}", term in r.text)
    chk("FE: glossary defines SHRH", "SHRH" in r.text or "shrh" in r.text.lower())

    r = requests.get(f"{BASE}/static/connex3d.js")
    chk("FE: connex3d.js loads", r.status_code == 200)
    for sym in ("createConnexScene", "setBoxCount", "onBoxDrop", "resolveDropAt", "applyStamp", "openConnex", "closeConnex"):
        chk(f"FE: connex3d exports {sym}", sym in r.text)

    r = requests.get(f"{BASE}/static/formations/manifest.json")
    chk("FE: formations manifest loads", r.status_code == 200, str(r.status_code))
    if r.status_code == 200:
        chk("FE: manifest has formations list", "formations" in r.json())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("CONNEX 1750 — Acceptance + Adversarial QA Suite")
    print("=" * 60)

    # Pre-flight
    try:
        r = requests.get(f"{BASE}/api/health", timeout=5)
        if r.status_code != 200:
            print(f"ERROR: Server at {BASE} returned {r.status_code}. Is it running?")
            sys.exit(1)
    except requests.ConnectionError:
        print(f"ERROR: Cannot connect to {BASE}. Start the server first: python3 app.py")
        sys.exit(1)

    # Verify BOM dir exists
    if not os.path.isdir(BOM_DIR):
        print(f"ERROR: BOM directory not found: {BOM_DIR}")
        sys.exit(1)

    test_health()
    test_acceptance_walkthrough()
    test_seal_validation_matrix()
    test_adversarial()
    test_frontend_wiring()

    # Summary
    print("\n" + "=" * 60)
    total = len(_results)
    passed = sum(1 for _, s, _ in _results if s == "PASS")
    failed = _failures
    print(f"Results: {passed}/{total} passed, {failed} failed")
    if failed:
        print("\nFAILED tests:")
        for label, status, detail in _results:
            if status == "FAIL":
                print(f"  FAIL  {label}" + (f"  ({detail})" if detail else ""))
        sys.exit(1)
    else:
        print("All tests passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
