# Photo Lab

[Open Photo Lab](https://coolcode.ca/photolab/) to inventory, inspect, crop, resize and export photos on your device. Pick a JPEG or PNG, drop a group of photos, or open the credited Apollo 8 photograph.

<!-- coolcode:guide -->
Open a group of photos to compare camera names, capture times and GPS presence. Select a photo to adjust exposure, contrast, saturation and warmth. Compare original tones on the same crop, rotate or flip, and download the edited pixels.
<!-- /coolcode:guide -->

The inventory accepts up to 100 files, lists unreadable files individually and omits exact coordinates from its CSV. Missing EXIF fields appear as dashes. Dimensions refer to the stored pixels. Camera capture times come from DateTimeOriginal, with the recorded offset when available. The individual JSON report can contain the original coordinates and optional SHA-256 hash. Files and edits stay in the current tab. Switching photos resets the crop, size, light, colour and orientation controls.

Light and colour sliders update the preview and histogram together. Preview original tones keeps the crop and orientation matched for comparison. The download always uses your adjustments. Rotation and horizontal flip apply to the cropped output. The individual JSON report includes the chosen adjustments.

The editor provides numeric and drag crop controls, resize, luminance and RGB histograms, and a side-by-side preview. A clean JPEG or PNG is re-encoded from pixels without the original camera metadata. JPEG fills transparency in white. Reader limits are 48 MiB, 52 megapixels and 16,000 pixels per side. Exports are capped at 24 megapixels and 8,192 pixels per side.

## Included photograph

*Earthrise*, frame AS08-14-2383, was photographed by Bill Anders aboard Apollo 8 on 24 December 1968. The included 640-pixel JPEG comes from NASA’s public image library. The date and credit come from the archive record. Photo Lab leaves the file’s embedded metadata as published. [NASA image record](https://science.nasa.gov/resource/apollo-8s-iconic-earthrise/) · [NASA JPEG](https://images-assets.nasa.gov/image/as08-14-2383/as08-14-2383~small.jpg)

## Build and verify

Run `python3 scripts/build.py`, `node --test tests/*.test.mjs` and `python3 -m http.server 8000 --directory dist`. Open http://localhost:8000/. No runtime dependencies or API keys are required.
