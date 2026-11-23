"""Exercise the published workbench flows at both narrow and wide viewports."""
import csv
import io
import os
import sys
import re
import json
import hashlib
import struct
import zipfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
url = sys.argv[1]

def png_chunks(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    at, chunks = 8, []
    while at + 12 <= len(data):
        length = struct.unpack(">I", data[at:at + 4])[0]
        chunks.append(data[at + 4:at + 8])
        at += length + 12
        if chunks[-1] == b"IEND":
            break
    assert at == len(data)
    return chunks
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH"))
    for width in (390, 1200):
        page = browser.new_page(viewport={"width": width, "height": 850}, accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        page.locator("#sample").click()
        expect(page.locator("#filename")).to_have_text(re.compile("Earthrise"))
        assert "640 × 640" in page.locator("#summary").inner_text()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

        page.locator("#file").set_input_files([
            ROOT / "tests/fixtures/exif.png", ROOT / "web/earthrise.jpg", ROOT / "README.md",
        ])
        expect(page.locator("#filename")).to_have_text("exif.png")
        assert page.locator("#inventory tr").count() == 3
        summary = page.locator("#inventory-summary").inner_text()
        assert "2 of 3 files" in summary and "1 with EXIF coordinates" in summary
        expect(page.locator("#privacy-gps")).to_have_text("EXIF GPS fields present")
        with page.expect_download() as original_report:
            page.locator("#privacy-report").click()
        metadata = json.loads(Path(original_report.value.path()).read_text())
        assert any("GPSLatitude" in field["key"] for field in metadata["rows"])
        with page.expect_download() as clean_png:
            page.locator("#export").click()
        cleaned = Path(clean_png.value.path()).read_bytes()
        assert set(png_chunks(cleaned)) <= {b"IHDR", b"IDAT", b"IEND", b"sRGB", b"pHYs", b"gAMA", b"cHRM"}
        expect(page.locator("#comparison-status")).to_contain_text("Verified:")
        assert page.locator("#original-hash").inner_text() == hashlib.sha256((ROOT / "tests/fixtures/exif.png").read_bytes()).hexdigest()
        assert page.locator("#output-hash").inner_text() == hashlib.sha256(cleaned).hexdigest()
        assert page.locator("#original-hash").inner_text() != page.locator("#output-hash").inner_text()
        with page.expect_download() as comparison_report:
            page.locator("#comparison-report").click()
        compared = json.loads(Path(comparison_report.value.path()).read_text())
        assert compared["verification"]["passed"]
        assert compared["output"]["metadata"]["metadataContainers"] == 0
        assert any("GPSLatitude" in row["key"] and row["status"] == "Removed" for row in compared["comparison"]["rows"])

        page.locator("#bulk-clean").click()
        expect(page.locator("#bulk-download")).to_be_enabled(timeout=15000)
        assert page.locator("#bulk-results tr").count() == 3
        with page.expect_download() as bundle:
            page.locator("#bulk-download").click()
        with zipfile.ZipFile(bundle.value.path()) as archive:
            assert archive.testzip() is None
            assert set(archive.namelist()) == {"photo-001-clean.png", "photo-002-clean.jpg", "verification.json"}
            manifest = json.loads(archive.read("verification.json"))
            assert [row["status"] for row in manifest["files"]] == ["Verified", "Verified", "Failed"]
            assert "GPSLatitude" not in archive.read("verification.json").decode()
            assert "exif.png" not in archive.read("verification.json").decode()
            for row in manifest["files"][:2]:
                assert row["outputSha256"] == hashlib.sha256(archive.read(row["output"])).hexdigest()

        page.get_by_role("button", name="earthrise.jpg", exact=True).click()
        expect(page.locator("#filename")).to_have_text("earthrise.jpg")
        with page.expect_download() as download:
            page.locator("#inventory-download").click()
        rows = list(csv.DictReader(io.StringIO(Path(download.value.path()).read_text())))
        assert [row["GPS coordinates present"] for row in rows] == ["Yes", "No", ""]
        assert rows[2]["Read error"]

        page.locator("#width").fill("300")
        page.locator("#width").press("Tab")
        page.locator("#rotate").select_option("90")
        assert page.locator("#out-width").input_value() == "640"
        assert page.locator("#out-height").input_value() == "300"
        page.locator("#mirror").check()
        page.locator("#exposure").press("End")
        expect(page.locator("#exposure-value")).to_have_text("2 stops")
        page.wait_for_function("document.querySelector('#preview').width === 640")
        def preview():
            page.evaluate("() => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)))")
            return page.locator("#preview").evaluate("c => c.toDataURL()")
        edited = preview()
        page.locator("#compare-tones").check()
        expect(page.locator("#preview-heading")).to_contain_text("Original tones")
        assert preview() != edited
        page.locator("#compare-tones").uncheck()
        assert preview() == edited
        with page.expect_download() as download:
            page.locator("#export").click()
        assert download.value.suggested_filename == "earthrise-clean.jpg"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.locator("#clear").click()
        assert page.locator("#workbench").is_hidden() and page.locator("#collection").is_hidden() and page.locator("#privacy-desk").is_hidden()
        assert not errors, errors
        page.close()
print("Verified photo inventory, editor, metadata removal, hash comparisons and batch ZIP at 390px and 1200px.")
