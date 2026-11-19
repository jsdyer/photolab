import {adjustPixels, histogram, inspect, maxBytes, normalizeCrop} from './image.mjs';

import {hasGps, inventoryCsv} from './inventory.mjs';

const $ = id => document.getElementById(id);
const tones = ['exposure','contrast','saturation','warmth'];
const adjustments = () => Object.fromEntries(tones.map(key => [key, $(key).valueAsNumber]));
function resetTones() {
  for (const key of tones) {
    $(key).value = 0;
    $(key + '-value').value = '0';
  }
  $('compare-tones').checked = false;
}
function cropSize() {
  return Number($('rotate').value) % 180 ? {width:crop.height, height:crop.width} : crop;
}
const cropFields = ['x','y','width','height'];
const formatBytes = bytes => (bytes / (1024 * 1024)).toFixed(2) + ' MiB';
const limitSide = 8192, limitPixels = 24_000_000;
const number = new Intl.NumberFormat('en-CA');
const channels = {luma:'#326742',red:'#9b3b37',green:'#347a4c',blue:'#305a90'};
let photo = null;
let crop = null;
let start = null;
let generation = 0;
let batchGeneration = 0;
let entries = [];
let pendingPaint = 0;
let analysis = null;
let output = {width:0, height:0};
let exporting = false;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function writeCrop() {
  for (const field of cropFields) $(field).value = crop[field];
  $('x').max = photo.bitmap.width - 1;
  $('y').max = photo.bitmap.height - 1;
  $('width').max = photo.bitmap.width - crop.x;
  $('height').max = photo.bitmap.height - crop.y;
}

function fitSize(width, height, maxWidth, maxHeight, maxArea = Infinity) {
  const ratio = Math.min(1, maxWidth / width, maxHeight / height, Math.sqrt(maxArea / (width * height)));
  return {width:Math.max(1, Math.floor(width * ratio)),height:Math.max(1,Math.floor(height * ratio))};
}

function writeSize(size) {
  output = size;
  $('out-width').value = output.width;
  $('out-height').value = output.height;
}

function deriveSize(preferred, requested) {
  let width = preferred === 'width' ? requested : output.width;
  let height = preferred === 'height' ? requested : output.height;
  if ($('lock').checked) {
    if (preferred === 'height') width = Math.max(1, Math.round(height * cropSize().width / cropSize().height));
    else height = Math.max(1, Math.round(width * cropSize().height / cropSize().width));
  }
  return fitSize(width, height, limitSide, limitSide, limitPixels);
}

function resetCrop() {
  crop = {x:0,y:0,width:photo.bitmap.width,height:photo.bitmap.height};
  writeCrop();
  writeSize(fitSize(cropSize().width,cropSize().height,limitSide,limitSide,limitPixels));
  paintSoon();
}

function setCrop(rectangle) {
  crop = normalizeCrop(rectangle, photo.bitmap.width, photo.bitmap.height);
  writeCrop();
  writeSize(fitSize(cropSize().width,cropSize().height,limitSide,limitSide,limitPixels));
  paintSoon();
}

function clear() {
  generation++;
  batchGeneration++;
  entries = [];
  $('collection').hidden = true;
  $('inventory').replaceChildren();
  photo?.bitmap.close();
  photo = null;
  crop = null;
  start = null;
  analysis = null;
  $('file').value = '';
  $('workbench').hidden = true;
  $('clear').hidden = true;
  for (const id of ['original','preview','histogram']) $(id).width = 1;
  status('Ready.');
}

async function load(filePromise, knownMetadata = null) {
  const ticket = ++generation;
  $('clear').hidden = false;
  status('Opening photo locally…');
  try {
    const file = await filePromise;
    if (file.size > maxBytes) throw new Error('Choose an image smaller than 48 MiB.');
    const meta = knownMetadata ?? inspect(await file.arrayBuffer());
    const bitmap = await createImageBitmap(file, {imageOrientation:'from-image'});
    if (ticket !== generation) {bitmap.close();return;}
    photo?.bitmap.close();
    photo = {file, meta, bitmap};
    start = null;
    for (const button of $('inventory').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(entries[Number(button.dataset.index)]?.file === file));
    }
    $('workbench').hidden = false;
    $('filename').textContent = file.name;
    $('summary').textContent = meta.format + ' · ' + bitmap.width + ' × ' + bitmap.height + ' px · ' + formatBytes(file.size);
    $('digest').textContent = '';
    $('hash').disabled = !globalThis.crypto?.subtle;
    $('format').value = meta.format === 'PNG' ? 'image/png' : 'image/jpeg';
    $('quality-label').hidden = meta.format === 'PNG';
    resetTones();
    $('rotate').value = '0';
    previousAngle = 0;
    $('mirror').checked = false;
    renderMetadata();
    resetCrop();
    status('Photo opened. Changes apply to the export copy.');
  } catch (error) {
    if (ticket === generation) {
      $('clear').hidden = !photo;
      status(error.message || 'The browser could not decode that image.', true);
    }
  }
}

function renderMetadata() {
  const info = photo.meta, exif = info.exif;
  const units = (n, unit) => Number.isFinite(n) && n > 0 ? n + unit : null;
  const exp = exif.exposure > 0 && exif.exposure < 1 ?
    '1/' + Math.round(1 / exif.exposure) + ' s' : units(exif.exposure,' s');
  const gps = Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude) ?
    exif.latitude.toFixed(6) + ', ' + exif.longitude.toFixed(6) : null;
  const rows = [
    ['Format', info.format], ['Stored dimensions', info.width + ' × ' + info.height + ' px'],
    ['Camera', exif.camera], ['Lens', exif.lens],
    ['Captured', exif.captured ? [exif.captured, exif.offset].filter(Boolean).join(' ') : null],
    ['EXIF modified', exif.modified], ['Exposure', exp], ['Aperture', exif.fNumber > 0 ? 'f/' + exif.fNumber : null],
    ['ISO', exif.iso], ['Focal length',units(exif.focalLength,' mm')],
    ['Exif orientation',exif.orientation], ['Software',exif.software], ['GPS coordinates',gps || 'Absent from selected EXIF fields']
  ];
  $('metadata').replaceChildren(...rows.filter(([,value]) => value != null && value !== '').flatMap(([label,value]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    return [dt, dd];
  }));
}

function canvasSize(canvas, width, height) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function drawOriginal() {
  const canvas = $('original');
  const size = fitSize(photo.bitmap.width, photo.bitmap.height, 760, 470);
  canvasSize(canvas,size.width,size.height);
  const g = canvas.getContext('2d');
  g.clearRect(0,0,size.width,size.height);
  g.drawImage(photo.bitmap,0,0,size.width,size.height);
  const sx = size.width / photo.bitmap.width, sy = size.height / photo.bitmap.height;
  const left = crop.x * sx, top = crop.y * sy, right = (crop.x + crop.width) * sx, bottom = (crop.y + crop.height) * sy;
  g.fillStyle = 'rgba(10,20,15,.53)';
  g.fillRect(0,0,size.width,top);
  g.fillRect(0,bottom,size.width,size.height-bottom);
  g.fillRect(0,top,left,bottom-top);
  g.fillRect(right,top,size.width-right,bottom-top);
  g.strokeStyle = '#e6f7a9';
  g.lineWidth = 2;
  g.strokeRect(left,top,right-left,bottom-top);
}

function renderPixels(canvas, width, height, mime, originalTones = false) {
  canvasSize(canvas,width,height);
  const g = canvas.getContext('2d', {willReadFrequently:canvas.id === 'preview'});
  g.clearRect(0,0,width,height);
  const angle = Number($('rotate').value);
  const drawWidth = angle % 180 ? height : width;
  const drawHeight = angle % 180 ? width : height;
  g.save();
  g.translate(width / 2, height / 2);
  if ($('mirror').checked) g.scale(-1, 1);
  g.rotate(angle * Math.PI / 180);
  g.imageSmoothingQuality = 'high';
  g.drawImage(photo.bitmap, crop.x, crop.y, crop.width, crop.height, -drawWidth/2, -drawHeight/2, drawWidth, drawHeight);
  g.restore();
  const settings = adjustments();
  if (!originalTones && Object.values(settings).some(value => value !== 0)) {
    // Process strips to bound the extra pixel buffer on large exports.
    for (let y = 0; y < height; y += 128) {
      const pixels = g.getImageData(0, y, width, Math.min(128, height - y));
      adjustPixels(pixels.data, settings);
      g.putImageData(pixels, 0, y);
    }
  }
  if (mime === 'image/jpeg') {
    g.save();
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#fff';
    g.fillRect(0,0,width,height);
    g.restore();
  }
  return g;
}

function drawHistogram() {
  if (!analysis) return;
  const canvas = $('histogram'), width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(2,window.devicePixelRatio || 1);
  canvasSize(canvas,Math.round(width * ratio),Math.round(height * ratio));
  const g = canvas.getContext('2d');
  g.setTransform(ratio,0,0,ratio,0,0);
  g.clearRect(0,0,width,height);
  const selected = $('channel').value;
  const bins = analysis[selected], max = Math.max(1,...bins);
  g.fillStyle = channels[selected];
  for (let i=0;i<256;i++) {
    const bar = bins[i] / max * (height - 5);
    g.fillRect(i * width / 256,height - bar,width / 256 + .15,bar);
  }
  const percentage = count => (100 * count / analysis.visible).toFixed(1) + '%';
  $('hist-summary').textContent = analysis.visible ?
    'Dark pixels ' + percentage(analysis.shadows) + ' · Bright pixels ' + percentage(analysis.highlights) :
    'The preview is entirely transparent.';
}

function paintSoon() {
  cancelAnimationFrame(pendingPaint);
  pendingPaint = requestAnimationFrame(() => {
    if (!photo) return;
    drawOriginal();
    const size = fitSize(output.width,output.height,760,470);
    const compareTones = $('compare-tones').checked;
    $('preview-heading').textContent = compareTones ? 'Original tones · edits retained for export' : 'Export preview';
    const g = renderPixels($('preview'),size.width,size.height,$('format').value,compareTones);
    analysis = histogram(g.getImageData(0,0,size.width,size.height).data);
    drawHistogram();
    $('export-size').textContent = number.format(output.width) + ' × ' + number.format(output.height) + ' px';
  });
}

function point(event) {
  const rect = $('original').getBoundingClientRect();
  return {
    x: Math.max(0,Math.min(photo.bitmap.width,(event.clientX - rect.left) * photo.bitmap.width / rect.width)),
    y: Math.max(0,Math.min(photo.bitmap.height,(event.clientY - rect.top) * photo.bitmap.height / rect.height)),
  };
}

function drawDrag(event) {
  if (!start || event.pointerId !== start.id) return;
  const end = point(event);
  if (Math.abs(start.x - end.x) < 2 && Math.abs(start.y - end.y) < 2) return;
  setCrop({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)});
}

function download(blob, fileName) {
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {href, download:fileName});
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

const safeBase = file => file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g,'-') || 'photo';

function showInventory() {
  $('collection').hidden = entries.length < 2;
  const rows = entries.map(({file, meta, error}, index) => {
    const row = document.createElement('tr');
    const filename = row.insertCell();
    if (error) {
      filename.textContent = file.name;
      const message = row.insertCell();
      message.colSpan = 4;
      message.textContent = error;
      return row;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = file.name;
    button.dataset.index = index;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => load(file, meta));
    filename.append(button);
    for (const value of [meta.width + ' × ' + meta.height, meta.exif.camera,
      [meta.exif.captured, meta.exif.offset].filter(Boolean).join(' '), hasGps(meta) ? 'Present' : 'Absent']) {
      row.insertCell().textContent = value || '—';
    }
    return row;
  });
  $('inventory').replaceChildren(...rows);
  const inspected = entries.filter(entry => entry.meta);
  const gpsCount = inspected.filter(entry => hasGps(entry.meta)).length;
  $('inventory-summary').textContent = inspected.length + ' of ' + entries.length + ' files inspected · ' + gpsCount + ' with EXIF coordinates';
}

async function openFiles(files) {
  if (!files.length) return;
  if (files.length > 100) {
    status('Choose up to 100 photos at a time.', true);
    return;
  }
  clear();
  const ticket = batchGeneration;
  $('clear').hidden = false;
  for (const file of files) {
    status('Reading file ' + (entries.length + 1) + ' of ' + files.length + '…');
    const entry = {file};
    try {
      if (file.size > maxBytes) throw new Error('Exceeds 48 MiB.');
      entry.meta = inspect(await file.arrayBuffer());
    } catch (error) {
      entry.error = error.message || 'Unreadable file.';
    }
    if (ticket !== batchGeneration) return;
    entries.push(entry);
  }
  showInventory();
  const first = entries.find(entry => entry.meta);
  if (first) await load(first.file, first.meta);
  else status(entries.length === 1 ? entries[0].error : 'No supported photos found in this selection.', true);
}

$('choose').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', event => openFiles(Array.from(event.target.files)));
$('clear').addEventListener('click', clear);
$('inventory-download').addEventListener('click', () => {
  download(new Blob([inventoryCsv(entries)], {type:'text/csv;charset=utf-8'}), 'photo-inventory.csv');
});
$('sample').addEventListener('click', () => {
  clear();
  load(fetch('./earthrise.jpg', {credentials:'omit'}).then(async response => {
    if (!response.ok) throw new Error('Earthrise could not open. Choose a photo from your device.');
    return new File([await response.blob()], 'AS08-14-2383 Earthrise.jpg', {type:'image/jpeg'});
  }));
});
$('drop').addEventListener('dragover', event => {event.preventDefault();$('drop').classList.add('active');});
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('active'));
$('drop').addEventListener('drop', event => {
  event.preventDefault();
  $('drop').classList.remove('active');
  openFiles(Array.from(event.dataTransfer.files));
});
for (const field of cropFields) $(field).addEventListener('change', () => {
  if (photo) setCrop(Object.fromEntries(cropFields.map(id => [id,$(id).valueAsNumber])));
});
for (const field of ['width','height']) $('out-' + field).addEventListener('change', event => {
  const requested = event.target.valueAsNumber;
  writeSize(deriveSize(field,Number.isFinite(requested) ? Math.max(1,Math.min(limitSide,Math.round(requested))) : output[field]));
  paintSoon();
});
$('lock').addEventListener('change', () => {writeSize(deriveSize('width',output.width));paintSoon();});
for (const key of tones) $(key).addEventListener('input', () => {
  $(key + '-value').value = key === 'exposure' ? $(key).value + (Math.abs($(key).valueAsNumber) === 1 ? ' stop' : ' stops') : $(key).value;
  $('compare-tones').checked = false;
  paintSoon();
});
$('reset-tones').addEventListener('click', () => { resetTones(); paintSoon(); });
$('compare-tones').addEventListener('change', paintSoon);
$('mirror').addEventListener('change', paintSoon);
let previousAngle = 0;
$('rotate').addEventListener('change', () => {
  const angle = Number($('rotate').value);
  if ((angle - previousAngle) % 180) writeSize({width:output.height, height:output.width});
  previousAngle = angle;
  paintSoon();
});
$('reset').addEventListener('click', resetCrop);
$('format').addEventListener('change', () => {$('quality-label').hidden = $('format').value === 'image/png';paintSoon();});
$('channel').addEventListener('change', drawHistogram);
new ResizeObserver(drawHistogram).observe($('histogram'));
$('original').addEventListener('pointerdown', event => {
  if (!photo || event.button !== 0 || !event.isPrimary) return;
  $('original').setPointerCapture(event.pointerId);
  start = {...point(event),id:event.pointerId};
});
$('original').addEventListener('pointermove', drawDrag);
$('original').addEventListener('pointerup', event => {
  drawDrag(event);
  if (start?.id === event.pointerId) start = null;
});
$('original').addEventListener('pointercancel', event => {if (start?.id === event.pointerId) start = null;});

$('hash').addEventListener('click', async () => {
  const selected = photo;
  $('hash').disabled = true;
  $('digest').textContent = 'Calculating…';
  try {
    const digest = await crypto.subtle.digest('SHA-256', await selected.file.arrayBuffer());
    selected.digest = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2,'0')).join('');
    if (selected === photo) $('digest').textContent = 'SHA-256 ' + selected.digest;
  } catch {
    if (selected === photo) $('digest').textContent = 'This browser could not hash the photo.';
  } finally {
    if (selected === photo) $('hash').disabled = false;
  }
});

$('report').addEventListener('click', () => {
  const {meta, file, bitmap, digest} = photo;
  const report = {file:file.name,bytes:file.size,sha256:digest || null,...meta,
    displayedPixels:{width:bitmap.width,height:bitmap.height}, crop, output, edits:{...adjustments(),rotationDegrees:Number($('rotate').value),mirror:$('mirror').checked}};
  download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),safeBase(file) + '-report.json');
});

$('export').addEventListener('click', async () => {
  if (!photo || exporting) return;
  exporting = true;
  $('export').disabled = true;
  const canvas = document.createElement('canvas');
  const type = $('format').value, fileName = safeBase(photo.file), quality = Number($('quality').value) / 100;
  try {
    renderPixels(canvas,output.width,output.height,type);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,type,quality));
    if (!blob || blob.type !== type) throw new Error('The browser could not encode the requested format.');
    download(blob,fileName + '-clean.' + (type === 'image/png' ? 'png' : 'jpg'));
  } catch (error) {
    status(error.message + ' Try a smaller export.',true);
  } finally {
    canvas.width = 1;
    exporting = false;
    $('export').disabled = false;
  }
});
