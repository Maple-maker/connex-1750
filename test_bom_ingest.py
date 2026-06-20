"""
test_bom_ingest.py — Scratch test for bom_ingest.ingest_bom()
Run from the spine repo root via the venv python:
    /path/to/venv/bin/python test_bom_ingest.py
"""
import sys, os, json

# Make sure we can import our modules from the spine directory
sys.path.insert(0, os.path.dirname(__file__))

from bom_ingest import ingest_bom
from dd1750_core import extract_metadata, OCR_AVAILABLE, _normalize_niin


# ─────────────────────────────────────────────────────────────────────────────
# Issue 4 regression: end-item Serial / LIN / NIIN / DESC must parse out of the
# printed HEADER BAND of an image-only GCSS-Army BOM, not just the filename.
#
# The header OCR pass needs a live tesseract binary, which isn't always present.
# So the CORE assertion feeds a representative OCR-text header string straight
# through extract_metadata() — that path runs regardless of OCR install and
# exercises the hardened regexes + NIIN normalization. When a real tesseract
# binary IS available, we additionally ingest the golden ANTENNA MAST GROUP PDF
# (whose filename carries serial+LIN but NOT the NIIN) and assert the NIIN was
# recovered from CONTENT.
# ─────────────────────────────────────────────────────────────────────────────

def _tesseract_runnable() -> bool:
    """OCR_AVAILABLE means the python bindings imported; it does NOT guarantee
    the tesseract binary is on PATH. Probe for the binary so live-OCR assertions
    only run when OCR can actually execute."""
    import shutil
    return OCR_AVAILABLE and shutil.which("tesseract") is not None


def test_extract_metadata_from_ocr_header_text():
    """extract_metadata parses the reference header even with OCR confusables."""
    # Representative OCR-text of the ANTENNA MAST GROUP header band. The NIIN is
    # rendered with the classic tesseract confusables (O for 0, l/I for 1) to
    # prove the normalization step. Reference values:
    #   NIIN 015246888 | LIN A80637 | SER 650140 | DESC ANTENNA MAST GROUP | UIC WH1ZB0
    header = (
        "UIC: WH1ZB0   SER/EQUIP NO: 650140\n"
        "END ITEM NIIN: O15246888   LIN: A80637   DESC: ANTENNA MAST GROUP\n"
    )
    meta = extract_metadata(header)

    assert meta.end_item_niin == "015246888", f"NIIN parse/normalize failed: {meta.end_item_niin!r}"
    assert meta.lin == "A80637", f"LIN parse failed: {meta.lin!r}"
    assert meta.serial_equip_no == "650140", f"Serial parse failed: {meta.serial_equip_no!r}"
    assert meta.end_item_description.startswith("ANTENNA MAST GROUP"), \
        f"DESC parse failed: {meta.end_item_description!r}"
    assert meta.uic == "WH1ZB0", f"UIC parse failed: {meta.uic!r}"
    print("PASS  test_extract_metadata_from_ocr_header_text")


def test_niin_normalization_unit():
    """_normalize_niin maps OCR confusables O->0, I/l->1 and leaves digits."""
    assert _normalize_niin("O15246888") == "015246888"
    assert _normalize_niin("Ol5246888") == "015246888"
    assert _normalize_niin("015246888") == "015246888"
    print("PASS  test_niin_normalization_unit")


def test_lin_bounded_to_six_chars():
    """LIN regex stops at 6 alphanumerics and won't swallow adjacent header text."""
    meta = extract_metadata("LIN: A80637 DESC: ANTENNA MAST GROUP")
    assert meta.lin == "A80637", f"LIN over/under-captured: {meta.lin!r}"
    print("PASS  test_lin_bounded_to_six_chars")


def test_satellite_bom_lin_and_nomenclature_from_center_admin():
    """LIN + end-item DESC come from the center admin band of the BOM header,
    never from the unit-DESC token (W81LNF) on the line above. Reference BOM:
    LIN S78397 | NIIN 015476611 | DESC SATELLITE COMMUNICA | SER 0095."""
    header = (
        "Date: 03/30/2026   COMPONENT LISTING / HAND RECEIPT   Page 1 of 1\n"
        "FE: 40370539   UIC: WH1ZB0   DESC: W81LNF 0004 AD BN 03 BTY B ADA BA   SLOC: AS8J\n"
        "END ITEM NIIN: 015476611   LIN: S78397   DESC: SATELLITE COMMUNICA   TO: Jaiden D. Rabatin\n"
        "SER/EQUIP NO: 0095   PUB/BOM SOURCE:   FROM: James M. Holland\n"
    )
    meta = extract_metadata(header)
    assert meta.lin == "S78397", f"LIN not from center admin field: {meta.lin!r}"
    assert meta.lin != "W81LNF", "LIN wrongly grabbed the unit-DESC token!"
    assert meta.end_item_niin == "015476611", f"NIIN parse failed: {meta.end_item_niin!r}"
    assert meta.end_item_description.startswith("SATELLITE COMMUNICA"), \
        f"end-item nomenclature (DESC) parse failed: {meta.end_item_description!r}"
    print("PASS  test_satellite_bom_lin_and_nomenclature_from_center_admin")


def test_golden_bom_niin_from_content_when_renamed():
    """When OCR can actually run, the NIIN must come from the header image even
    if the filename is stripped of identifiers (NIIN is never in the filename)."""
    if not _tesseract_runnable():
        print("SKIP  test_golden_bom_niin_from_content_when_renamed (tesseract binary not on PATH)")
        return

    golden = (
        "/Users/jaidenrabatin/Desktop/AEGIS/30-PROJECTS/active/1750_bulk_editor/"
        "CONNEX_1750_AGENT_STARTER/FC BOMS/650140 B34S A80637 ANTENNA MAST GROUP.pdf"
    )
    if not os.path.exists(golden):
        print(f"SKIP  test_golden_bom_niin_from_content_when_renamed (fixture missing: {golden})")
        return

    # Copy to a neutral name so any recovered NIIN/LIN/serial PROVES it came from
    # the paperwork content, not the filename.
    import shutil, tempfile
    tmpdir = tempfile.mkdtemp()
    neutral = os.path.join(tmpdir, "scan_0001.pdf")
    shutil.copyfile(golden, neutral)
    try:
        result = ingest_bom(neutral, nomenclature="ANTENNA MAST GROUP")
        assert result["end_item_niin"] == "015246888", \
            f"NIIN not recovered from content: {result['end_item_niin']!r}"
        assert result["niin_source"] == "content", \
            f"niin_source tag wrong: {result['niin_source']!r}"
        print("PASS  test_golden_bom_niin_from_content_when_renamed "
              f"(niin={result['end_item_niin']} source={result['niin_source']})")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_form_bom_lin_and_nomenclature_from_content_when_renamed():
    """The crux regression: a GCSS form BOM (no extractable text) routed through
    bom_parser must still recover LIN + end-item nomenclature from the header
    IMAGE via OCR — NOT from the filename. Proven by renaming the file to a
    neutral name so the filename fallback can't supply LIN/nomenclature."""
    if not _tesseract_runnable():
        print("SKIP  test_form_bom_lin_and_nomenclature_from_content_when_renamed (tesseract binary not on PATH)")
        return

    src = (
        "/Users/jaidenrabatin/Desktop/AEGIS/30-PROJECTS/active/1750_bulk_editor/"
        "CONNEX_1750_AGENT_STARTER/FC BOMS/0095 S78397 SATELLITE COMMUNICA.pdf"
    )
    if not os.path.exists(src):
        print(f"SKIP  test_form_bom_lin_and_nomenclature_from_content_when_renamed (fixture missing)")
        return

    import shutil, tempfile
    tmpdir = tempfile.mkdtemp()
    neutral = os.path.join(tmpdir, "random item.pdf")
    shutil.copyfile(src, neutral)
    try:
        r = ingest_bom(neutral, nomenclature="random item")
        assert r["lin"] == "S78397", f"LIN not from content (got {r['lin']!r}, filename had none)"
        assert r["lin_source"] == "content", f"lin_source: {r['lin_source']!r}"
        assert "SATELLITE COMMUNICA" in r["nomenclature"].upper(), \
            f"nomenclature came from filename, not header DESC: {r['nomenclature']!r}"
        assert r["end_item_niin"] == "015476611", f"NIIN: {r['end_item_niin']!r}"
        print("PASS  test_form_bom_lin_and_nomenclature_from_content_when_renamed "
              f"(lin={r['lin']} nomen={r['nomenclature']!r})")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _run_issue4_regression():
    print(f"\n{'='*70}")
    print(f"Issue 4 regression  (OCR_AVAILABLE={OCR_AVAILABLE}, "
          f"tesseract_runnable={_tesseract_runnable()})")
    test_extract_metadata_from_ocr_header_text()
    test_niin_normalization_unit()
    test_lin_bounded_to_six_chars()
    test_satellite_bom_lin_and_nomenclature_from_center_admin()
    test_golden_bom_niin_from_content_when_renamed()
    test_form_bom_lin_and_nomenclature_from_content_when_renamed()

TEST_BOMS = [
    (
        "/Users/jaidenrabatin/Desktop/AEGIS/30-PROJECTS/active/1750_bulk_editor/FC BOMS/"
        "EPP TRUCK 10T2K1J23F1024820.pdf",
        "EPP TRUCK 10T",
    ),
    (
        "/Users/jaidenrabatin/Desktop/AEGIS/30-PROJECTS/active/1750_bulk_editor/FC BOMS/"
        "0137 A05023 INTERROGATOR SET.pdf",
        "INTERROGATOR SET",
    ),
    (
        "/Users/jaidenrabatin/Desktop/AEGIS/30-PROJECTS/active/1750_bulk_editor/arms room BOMs/"
        "103133 M39263  LMG 5.56MM M249.pdf",
        "LMG M249",
    ),
]

for pdf_path, nom in TEST_BOMS:
    print(f"\n{'='*70}")
    print(f"FILE   : {os.path.basename(pdf_path)}")
    result = ingest_bom(pdf_path, nomenclature=nom)
    print(f"LIN    : {result['lin'] or '(none)'}")
    print(f"SERIAL : {result['serial_number'] or '(none)'}")
    print(f"MODEL  : {result['model'] or '(none)'}")
    print(f"NIIN   : {result['end_item_niin'] or '(none)'}")
    print(f"UIC    : {result['uic'] or '(none)'}")
    print(f"ITEMS  : {result['item_count']}")

    if result["items"]:
        print("  First 2 items:")
        for item in result["items"][:2]:
            print(f"    [{item['line_no']}] {item['description']}  NSN={item['nsn']}  qty={item['qty']}  ui={item['unit_of_issue']}")
    else:
        print("  (no items extracted)")

    if result["warnings"]:
        for w in result["warnings"]:
            print(f"  WARN: {w}")
    if result["errors"]:
        for e in result["errors"]:
            print(f"  ERR : {e}")

# Issue 4 regression assertions (these raise on failure -> non-zero exit).
_run_issue4_regression()

print(f"\n{'='*70}")
print("Done.")
