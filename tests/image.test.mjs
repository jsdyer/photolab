import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {histogram, inspect, normalizeCrop} from '../web/image.mjs';

test('reads the fixture PNG dimensions and its selected EXIF and GPS tags', async () => {
  const png = await readFile(new URL('./fixtures/exif.png', import.meta.url));
  const result = inspect(png.buffer.slice(png.byteOffset,png.byteOffset + png.byteLength));
  assert.equal(result.format,'PNG');
  assert.equal(result.width,1);
  assert.equal(result.height,1);
  assert.equal(result.exif.iso,400);
  assert.equal(result.exif.exposure,1/125);
  assert.equal(result.exif.latitude.toFixed(6),'44.650000');
  assert.equal(result.exif.longitude.toFixed(6),'-63.580000');
});

test('works with JPEG frame headers and rejects partial files', () => {
  const jpeg = Uint8Array.of(0xff,0xd8,0xff,0xc0,0,8,8,0,40,0,80,3,0xff,0xd9);
  assert.deepEqual(inspect(jpeg.buffer), {format:'JPEG',height:40,width:80,exif:{}});
  assert.throws(() => inspect(Uint8Array.of(255,216,255,192,0,100).buffer), /header/);
});

test('constrains crop dimensions and excludes fully transparent pixels', () => {
  assert.deepEqual(normalizeCrop({x:40,y:-10,width:100,height:8},50,50),{x:40,y:0,width:10,height:8});
  const plot = histogram(new Uint8ClampedArray([0,0,0,255,255,255,255,255,100,100,100,0]));
  assert.equal(plot.visible,2);
  assert.equal(plot.shadows,1);
  assert.equal(plot.highlights,1);
});

test('inventories mixed results without disclosing GPS coordinates in CSV', async () => {
  const {inventoryCsv} = await import('../web/inventory.mjs');
  const fixture = await readFile(new URL('./fixtures/exif.png', import.meta.url));
  const meta = inspect(fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength));
  const csv = inventoryCsv([{file:{name:'"camera", my.png',size:800},meta},
    {file:{name:'=SUM(1,2)',size:4},error:'Invalid file'}]);
  assert.match(csv,/"""camera"", my.png"/);
  assert.match(csv,/"Yes"/);
  assert.match(csv,/"'=SUM\(1,2\)"/);
  assert.doesNotMatch(csv,/44\.65|-63\.58/);
  assert.match(csv,/Invalid file/);
});

test('opens the published Apollo 8 JPEG without fabricating camera coordinates', async () => {
  const jpg = await readFile(new URL('../web/earthrise.jpg', import.meta.url));
  const meta = inspect(jpg.buffer.slice(jpg.byteOffset, jpg.byteOffset + jpg.byteLength));
  assert.deepEqual([meta.format, meta.width, meta.height], ['JPEG', 640, 640]);
  assert.equal(Number.isFinite(meta.exif.longitude), false);
});
