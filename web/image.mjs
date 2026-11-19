export const maxBytes = 48 * 1024 * 1024;
export const maxPixels = 52_000_000;
export const maxDimension = 16_000;

const ascii = (view, at, len) => {
  if (at < 0 || at + len > view.byteLength) return '';
  const bytes = new Uint8Array(view.buffer, view.byteOffset + at, len);
  return new TextDecoder().decode(bytes).replace(/\0.*$/s, '').trim();
};

function readTiff(view) {
  if (view.byteLength < 8) return {};
  const order = view.getUint16(0);
  if (![0x4949,0x4d4d].includes(order)) return {};
  const le = order === 0x4949;
  const u16 = i => view.getUint16(i, le), u32 = i => view.getUint32(i, le);
  const i32 = i => view.getInt32(i, le);
  if (u16(2) !== 42) return {};
  const ifd = offset => {
    if (!Number.isInteger(offset) || offset < 8 || offset + 2 > view.byteLength) return {};
    const result = {};
    const types = {1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};
    const entries = Math.min(200, u16(offset), Math.floor((view.byteLength - offset - 2) / 12));
    for (let i = 0; i < entries; i++) {
      const at = offset + 2 + 12 * i;
      const tag = u16(at), type = u16(at+2), count = u32(at+4);
      if (!types[type] || count < 1 || count > 4096) continue;
      const size = types[type] * count;
      const start = size <= 4 ? at+8 : u32(at+8);
      if (start < 0 || start + size > view.byteLength) continue;
      if (type === 2 || type === 7) {
        result[tag] = ascii(view, start, size);
        continue;
      }
      const values = [];
      for (let n = 0; n < Math.min(20, count); n++) {
        const p = start + n * types[type];
        if (type === 1) values.push(view.getUint8(p));
        if (type === 3) values.push(u16(p));
        if (type === 4) values.push(u32(p));
        if (type === 9) values.push(i32(p));
        if (type === 5 || type === 10) {
          const get = type === 5 ? u32 : i32;
          values.push(get(p+4) ? get(p) / get(p+4) : null);
        }
      }
      if (values.length) result[tag] = values.length === 1 ? values[0] : values;
    }
    return result;
  };
  const primary = ifd(u32(4)), camera = ifd(primary[0x8769]), gps = ifd(primary[0x8825]);
  function coordinate(values, direction, allowed, maximum) {
    if (!Array.isArray(values) || values.length !== 3 || !values.every(n => Number.isFinite(n) && n >= 0) ||
        !allowed.includes(direction) || values[1] >= 60 || values[2] >= 60) return null;
    const amount = values[0] + values[1] / 60 + values[2] / 3600;
    return amount <= maximum ? amount * (['W','S'].includes(direction) ? -1 : 1) : null;
  }
  const latitude = coordinate(gps[2], gps[1], ['N','S'], 90);
  const longitude = coordinate(gps[4], gps[3], ['E','W'], 180);
  return {
    camera: [primary[0x010f], primary[0x0110]].filter(Boolean).join(' '),
    lens: camera[0xa434],
    captured: camera[0x9003],
    modified: primary[0x0132],
    offset: camera[0x9011],
    orientation: primary[0x0112],
    focalLength: camera[0x920a],
    exposure: camera[0x829a],
    fNumber: camera[0x829d],
    iso: camera[0x8827],
    software: primary[0x0131],
    latitude, longitude,
  };
}

function subview(view, offset, length) {
  return new DataView(view.buffer, view.byteOffset + offset, length);
}

export function inspect(buffer) {
  const view = new DataView(buffer);
  let width = 0, height = 0, format, exif = {};
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a &&
      ascii(view, 12, 4) === 'IHDR') {
    format = 'PNG';
    width = view.getUint32(16);
    height = view.getUint32(20);
    for (let at = 8; at + 12 <= view.byteLength;) {
      const length = view.getUint32(at);
      if (at + 12 + length > view.byteLength) break;
      const type = ascii(view, at + 4, 4);
      if (type === 'eXIf') {
        exif = readTiff(subview(view, at + 8, length));
        break;
      }
      if (type === 'IEND') break;
      at += 12 + length;
    }
  } else if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    format = 'JPEG';
    for (let at = 2; at < view.byteLength;) {
      if (view.getUint8(at++) !== 0xff) break;
      while (at < view.byteLength && view.getUint8(at) === 0xff) at++;
      if (at >= view.byteLength) break;
      const marker = view.getUint8(at++);
      if (marker === 0xd9 || marker === 0xda || at + 2 > view.byteLength) break;
      if ((marker >= 0xd0 && marker <= 0xd8) || marker === 1) continue;
      const length = view.getUint16(at);
      if (length < 2 || at + length > view.byteLength) break;
      if (marker === 0xe1 && length >= 8 && view.getUint32(at + 2) === 0x45786966 && view.getUint16(at + 6) === 0) {
        exif = readTiff(subview(view, at + 8, length - 8));
      }
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
        height = view.getUint16(at + 3);
        width = view.getUint16(at + 5);
      }
      at += length;
    }
  } else {
    throw new Error('Choose a JPEG or PNG image.');
  }
  if (!width || !height) throw new Error('The image has an invalid or incomplete header.');
  if (width > maxDimension || height > maxDimension || width * height > maxPixels) {
    throw new Error('This image exceeds the 52-megapixel or 16,000-pixel-side limit.');
  }
  return {width,height,format,exif};
}

export function normalizeCrop(input, imageWidth, imageHeight) {
  const integer = (value, min, max) => Number.isFinite(Number(value)) ?
    Math.min(max, Math.max(min, Math.round(Number(value)))) : min;
  const x = integer(input.x, 0, imageWidth - 1), y = integer(input.y, 0, imageHeight - 1);
  return {x,y,width:integer(input.width,1,imageWidth - x),height:integer(input.height,1,imageHeight - y)};
}

export function adjustPixels(pixels, {exposure, contrast, saturation, warmth}) {
  const gain = 2 ** exposure;
  const slope = 1 + contrast / 100;
  const colour = 1 + saturation / 100;
  const shift = 0.4 * warmth;
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i+3]) continue;
    const r = ((pixels[i] * gain - 128) * slope + 128) + shift;
    const g = (pixels[i+1] * gain - 128) * slope + 128;
    const b = ((pixels[i+2] * gain - 128) * slope + 128) - shift;
    const grey = .2126 * r + .7152 * g + .0722 * b;
    pixels[i] = grey + (r - grey) * colour;
    pixels[i+1] = grey + (g - grey) * colour;
    pixels[i+2] = grey + (b - grey) * colour;
  }
}

export function histogram(pixels) {
  const luma = Array(256).fill(0), red = luma.slice(), green = luma.slice(), blue = luma.slice();
  let visible = 0, shadows = 0, highlights = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i+3] === 0) continue;
    const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
    const light = Math.round(.2126 * r + .7152 * g + .0722 * b);
    luma[light]++;
    red[r]++;
    green[g]++;
    blue[b]++;
    if (light <= 3) shadows++;
    if (light >= 252) highlights++;
    visible++;
  }
  return {luma,red,green,blue,visible,shadows,highlights};
}
