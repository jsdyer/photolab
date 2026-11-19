export function hasGps(meta) {
  return Number.isFinite(meta.exif.latitude) && Number.isFinite(meta.exif.longitude);
}

export function inventoryCsv(entries) {
  const rows = [['File', 'Bytes', 'Format', 'Stored width', 'Stored height', 'Camera', 'Captured', 'UTC offset', 'GPS coordinates present', 'Read error']];
  for (const {file, meta, error} of entries) {
    rows.push([file.name, file.size, meta?.format, meta?.width, meta?.height, meta?.exif.camera,
      meta?.exif.captured, meta?.exif.offset, meta ? hasGps(meta) ? 'Yes' : 'No' : '', error]);
  }
  function cell(value) {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
