"""Exercise the published workbench flows at both narrow and wide viewports."""
import csv
import io
import os
import sys
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
url = sys.argv[1]
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
        page.get_by_role("button", name="earthrise.jpg", exact=True).click()
        expect(page.locator("#filename")).to_have_text("earthrise.jpg")
        with page.expect_download() as download:
            page.locator("#inventory-download").click()
        rows = list(csv.DictReader(io.StringIO(Path(download.value.path()).read_text())))
        assert [row["GPS coordinates present"] for row in rows] == ["Yes", "No", ""]
        assert rows[2]["Read error"]

        page.locator("#width").fill("300")
        page.locator("#width").press("Tab")
        with page.expect_download() as download:
            page.locator("#export").click()
        assert download.value.suggested_filename == "earthrise-clean.jpg"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.locator("#clear").click()
        assert page.locator("#workbench").is_hidden() and page.locator("#collection").is_hidden()
        assert not errors, errors
        page.close()
print("Verified photo inventory, editor and downloads at 390px and 1200px.")
