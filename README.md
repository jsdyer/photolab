# Photo Lab

[Open Photo Lab](https://coolcode.ca/photolab/) to inventory, inspect, edit and sanitize photos on your device. No file upload, external image service, account or API key is used.

<!-- coolcode:guide -->
Open JPEG or PNG photos to inspect EXIF, GPS, text and other metadata in the Privacy desk. Edit a selected photo, then export a copy: Photo Lab re-inspects the actual output and compares its SHA-256 and metadata with the original. For a group of photos, prepare a verified ZIP with neutral filenames. HEIC is identified but cannot be edited or sanitized here.
<!-- /coolcode:guide -->

## Inspect and compare

The existing photo inventory and editor remain available: camera/time/GPS summaries, numeric and drag crop, resize, exposure, contrast, saturation, warmth, rotation, flip, histograms and matched original-tone preview. Switching photos resets editor adjustments. The inventory CSV omits exact GPS coordinates.

The Privacy desk adds a bounded container and field inspector:

- JPEG: EXIF/TIFF directories, GPS, common EXIF names and unknown numeric tags, XMP packets, Photoshop/IPTC resources, comments, APP containers and trailing data. MakerNote and unknown blocks are identified as bounded raw bytes; their proprietary fields are not interpreted.
- PNG: chunk offsets and CRCs, EXIF, text, compressed text, international text, XMP, timestamps and unknown chunks. Oversized compressed text and malformed structures are reported as incomplete inspections.
- Content Credentials: PNG `caBX` and JPEG APP11 JUMBF/C2PA label presence is reported. **Signatures, trust chains, assertions, remote manifests and authenticity are not validated.** Missing embedded evidence does not prove that an image never had credentials.
- HEIC/HEIF: identifies a recognized container brand and explains that inspection, decoding and sanitization are unsupported. Convert with a trusted image editor, then inspect the JPEG/PNG copy here.

Search the field table, expand the container list, or compare another file. Exporting from the editor automatically displays original/output hashes and added, removed, changed and unchanged field values. A changed SHA-256 establishes different file bytes, not the reason for the change.

Metadata and comparison JSON reports can contain exact coordinates, names, serial numbers and other original identifying data. These reports are separate from the sanitized image and should be treated accordingly. All data stays in the current tab until explicitly downloaded.

## Verified image exports

Photo Lab renders pixels into a fresh JPEG or PNG, removes metadata containers added by the browser encoder (including opaque ICC profiles), then scans the final encoded bytes before offering the download. Image coding segments and compressed pixel data are retained unchanged during this second pass. Verification requires a complete container scan with no EXIF, GPS, XMP, IPTC, comments/text, C2PA or unknown metadata containers. A failed or incomplete output check prevents the sanitized download. Image structure and colour/rendering parameters can remain.

This is a scoped metadata check, not forensic certification. Visible identifying information, filenames, steganography and browser decoder behavior are outside the check. Re-encoding can change colour, compression and dimensions. Content Credentials are removed, and JPEG fills transparent pixels with white. Review the image itself before sharing.

The batch workflow processes whole images sequentially; it does not apply the current editor crop or adjustments. It offers a ZIP only after processing completes. Individual failed files are excluded and explained in the verification manifest. Animated PNG is excluded from batch export to avoid silently discarding frames. The individual editor produces a still image.

Neutral batch filenames are enabled by default. `verification.json` records input positions, output filenames, dimensions, original/output SHA-256, removed-container counts and verification results. It omits original metadata values and, when neutral names are enabled, original filenames. Downloaded images and reports are not retained by a server.

## Change limits

Edit [`web/config.json`](web/config.json), then rebuild/publish. It controls inventory size, privacy inspection limits, batch count and byte budget, decoded-text bounds, batch export dimensions and JPEG quality. Defaults are 100 inventory files, 20 batch files, 192 MiB combined input/output budget, 2,000 metadata rows and 1 MiB per inflated text chunk. Configuration values are bounded in `normalizeConfig` to prevent accidental unlimited allocations.

The existing decoder keeps a hard safety ceiling of 48 MiB, 52 megapixels and 16,000 pixels per side. Lower `maxFileMiB` further restricts it. Existing individual edited exports stay capped at 24 megapixels / 8,192 pixels per side; batch limits are configurable separately through `maxExportPixels` and `maxExportSide`. Long values and proprietary structures are bounded and explicitly noted rather than silently presented as a complete semantic decode.

## Included photograph

*Earthrise*, frame AS08-14-2383, was photographed by Bill Anders aboard Apollo 8 on 24 December 1968. The included 640-pixel JPEG comes from NASA's public image library. The date and credit come from the archive record. Photo Lab leaves the file's embedded metadata as published. [NASA image record](https://science.nasa.gov/resource/apollo-8s-iconic-earthrise/) · [NASA JPEG](https://images-assets.nasa.gov/image/as08-14-2383/as08-14-2383~small.jpg)

## Build and verification

Run `python3 scripts/build.py` and `node --test tests/*.test.mjs`. The static build is copied to `dist`. No runtime dependencies or API keys are required. SHA-256 requires HTTPS or localhost.

The model tests cover real EXIF/GPS fixtures, PNG text/XMP/decompression/CRCs, JPEG metadata before and after image scan data, malformed inputs, HEIC limits, duplicate metadata fields, SHA-256 and ZIP structure. GitHub Actions additionally checks actual browser-encoded output, GPS removal, downloaded hashes, mixed-file batch ZIPs and the existing editing workflow at 390px and 1200px before GitHub Pages publication.

Format references: [PNG specification](https://www.w3.org/TR/png/) · [C2PA technical specification](https://spec.c2pa.org/specifications/specifications/2.3/specs/C2PA_Specification).
