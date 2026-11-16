# Photo Lab

[Open Photo Lab](https://coolcode.ca/photolab/) to inspect, crop, resize and export a JPEG or PNG. Use the synthetic coast example to try the crop drag, compare the original and export preview, read sample GPS and camera tags, and inspect luminance or RGB histograms.

The original image, its SHA-256 hash and edits stay in the current browser tab. Numeric crop controls support keyboard input. A metadata report can contain the original coordinates, while the clean image is re-encoded from pixels and omits original camera metadata. The readout covers selected EXIF tags, including from PNG eXIf. It does not interpret every maker note or other metadata format. The included coast illustration and metadata are generated for demonstration.

## Build and verify

Run `python3 scripts/build.py` and `python3 -m http.server 8000 --directory dist`. Open http://localhost:8000/. This app has no runtime dependencies. The build generates a synthetic PNG solely from standard Python libraries.

The browser accepts source images up to 48 MiB, 52 megapixels and 16,000 pixels per side. Exports are capped at 24 megapixels and 8,192 pixels per side. JPEG exports fill transparency in white. Open the browser's built-in download list to find the exported files. Run the parser and histogram checks with `node --test tests/image.test.mjs` after building.
