import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {inspectMetadata,verifyClean,compareMetadata,crc32,makeZip,normalizeConfig,sha256,stripEncodedMetadata} from '../web/privacy.mjs';
const bytes = async path => new Uint8Array(await readFile(new URL(path,import.meta.url)));
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;};
const enc = text => new TextEncoder().encode(text);
function chunk(type,data){const out=new Uint8Array(data.length+12),v=new DataView(out.buffer);v.setUint32(0,data.length);out.set(enc(type),4);out.set(data,8);v.setUint32(data.length+8,crc32(out.subarray(4,data.length+8)));return out;}
function stripPng(input){const parts=[input.subarray(0,8)];const v=new DataView(input.buffer,input.byteOffset,input.byteLength);for(let p=8;p+12<=input.length;){const len=v.getUint32(p),type=new TextDecoder().decode(input.subarray(p+4,p+8));if(['IHDR','IDAT','IEND'].includes(type))parts.push(input.subarray(p,p+len+12));p+=len+12;}return concat(...parts);}
function insertPng(input,...chunks){return concat(input.subarray(0,33),...chunks,input.subarray(33));}
function segment(marker,data){const out=new Uint8Array(4+data.length);out.set([255,marker]);new DataView(out.buffer).setUint16(2,data.length+2);out.set(data,4);return out;}

test('full TIFF walk retains unknown fields and GPS evidence; original cannot pass clean verification',async()=>{
 const report=await inspectMetadata(await bytes('./fixtures/exif.png'));
 assert.equal(report.format,'PNG');assert.equal(report.complete,true);assert.match(report.gps,/present/);
 assert.ok(report.rows.some(r=>r.key.endsWith('/GPSLatitude')));assert.ok(report.rows.some(r=>r.key.endsWith('/GPSLongitude')));
 assert.ok(report.rows.some(r=>r.key.endsWith('/ISO')&&r.value==='400'));assert.equal(verifyClean(report).passed,false);
});
test('PNG text, compressed text and XMP are decoded, CRCs checked and all counted as metadata',async()=>{
 const clean=stripPng(await bytes('./fixtures/exif.png'));
 const fixture=insertPng(clean,chunk('tEXt',enc('Author\0Private Person')),chunk('zTXt',concat(enc('Description\0'),Uint8Array.of(0),deflateSync('A private location'))),chunk('iTXt',concat(enc('XML:com.adobe.xmp\0'),Uint8Array.of(0,0,0,0),enc('<x:xmpmeta GPSLatitude="44.65"/>'))));
 const report=await inspectMetadata(fixture);
 assert.equal(report.complete,true);assert.equal(report.metadataContainers,3);assert.ok(report.rows.some(r=>r.value==='Private Person'));assert.ok(report.rows.some(r=>r.value==='A private location'));assert.ok(report.rows.some(r=>r.group==='XMP'&&r.value.includes('GPSLatitude')));
 const bad=fixture.slice();bad[40]^=1;assert.equal((await inspectMetadata(bad)).complete,false);
});
test('complete clean PNG passes while trailing, unknown and C2PA chunks fail verification',async()=>{
 const clean=stripPng(await bytes('./fixtures/exif.png')),original=await inspectMetadata(await bytes('./fixtures/exif.png')),report=await inspectMetadata(clean);
 assert.equal(verifyClean(report).passed,true);assert.equal(verifyClean(await inspectMetadata(concat(clean,enc('secret')))).passed,false);
 assert.equal(verifyClean(await inspectMetadata(insertPng(clean,chunk('prIv',enc('private'))))).passed,false);
 const credentials=await inspectMetadata(insertPng(clean,chunk('caBX',enc('c2pa'))));assert.equal(credentials.c2paDetected,true);assert.match(credentials.credentials,/unverified/);assert.equal(verifyClean(credentials).passed,false);
 const compared=compareMetadata(original,report);assert.ok(compared.removed>0);assert.equal(compared.added,0);assert.equal(compared.rows.filter(r=>r.key.includes('GPS')).every(r=>r.status==='Removed'),true);
});
test('JPEG scanner reaches markers after scan data and identifies metadata at both ends',async()=>{
 const jpg=await bytes('../web/earthrise.jpg'),comment=segment(0xfe,enc('Private comment'));
 const fixture=concat(jpg.subarray(0,2),comment,jpg.subarray(2,jpg.length-2),segment(0xeb,enc('JP123456c2pa')),jpg.subarray(jpg.length-2));
 const report=await inspectMetadata(fixture);assert.equal(report.complete,true);assert.ok(report.rows.some(r=>r.value==='Private comment'));assert.equal(report.c2paDetected,true);assert.equal(verifyClean(report).passed,false);
 const truncated=await inspectMetadata(jpg.subarray(0,jpg.length-2));assert.equal(truncated.complete,false);
 assert.equal((await inspectMetadata(concat(jpg,enc('hidden trailer')))).complete,false);
});
test('malformed TIFF offsets and compressed metadata limits never produce a clean verdict',async()=>{
 const clean=stripPng(await bytes('./fixtures/exif.png')),bad=Uint8Array.of(73,73,42,0,255,255,255,255);
 const report=await inspectMetadata(insertPng(clean,chunk('eXIf',bad)));assert.equal(report.complete,false);assert.match(report.gps,/Unknown/);
 const bomb=chunk('zTXt',concat(enc('Comment\0'),Uint8Array.of(0),deflateSync('x'.repeat(4000))));
 const limited=await inspectMetadata(insertPng(clean,bomb),{maxInflatedTextBytes:64});assert.equal(limited.complete,false);assert.ok(limited.issues.some(s=>s.includes('limit')));
});
test('HEIC is explicitly unsupported and never certified as clean',async()=>{
 const file=concat(Uint8Array.of(0,0,0,20),enc('ftypheic'),new Uint8Array(8));const report=await inspectMetadata(file);assert.equal(report.format,'HEIC/HEIF');assert.equal(report.complete,false);assert.equal(verifyClean(report).passed,false);assert.match(report.issues.join(),/not supported/);
});
test('metadata comparisons preserve repeated fields and distinguish changed, added and removed',()=>{
 const before={rows:[{key:'A',value:'one'},{key:'A',value:'two'},{key:'B',value:'gone'}]},after={rows:[{key:'A',value:'one'},{key:'A',value:'changed'},{key:'C',value:'new'}]};
 assert.deepEqual(compareMetadata(before,after).rows.map(r=>r.status),['Unchanged','Changed','Removed','Added']);
});
test('config is extensible with bounded limits and ZIP entries use valid CRC and safe paths',async()=>{
 assert.equal(normalizeConfig({maxBatchFiles:21}).maxBatchFiles,21);assert.equal(normalizeConfig({maxBatchFiles:-1}).maxBatchFiles,20);
 const content=enc('test'),zip=new Uint8Array(await makeZip([{name:'photo-001.png',bytes:content}]).arrayBuffer()),view=new DataView(zip.buffer);
 assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint32(14,true),crc32(content));assert.equal(view.getUint32(zip.length-22,true),0x06054b50);
 assert.throws(()=>makeZip([{name:'../secret',bytes:content}]),/safe/);
 assert.equal(await sha256(enc('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('fresh-encode cleanup removes opaque ICC and all metadata without changing JPEG image coding bytes',async()=>{
 const source=await bytes('../web/earthrise.jpg');
 const clean=await stripEncodedMetadata(source);
 assert.equal(verifyClean(await inspectMetadata(clean)).passed,true);
 const fixture=concat(clean.subarray(0,2),segment(0xe2,enc('ICC_PROFILE\0\x01\x01Private profile description')),segment(0xfe,enc('Encoder comment')),clean.subarray(2,clean.length-2),segment(0xeb,enc('JP123456c2pa')),clean.subarray(clean.length-2));
 assert.equal(verifyClean(await inspectMetadata(fixture)).passed,false);
 const output=await stripEncodedMetadata(fixture);
 assert.deepEqual(output,clean);
 assert.equal(verifyClean(await inspectMetadata(output)).passed,true);
 await assert.rejects(stripEncodedMetadata(fixture.subarray(0,fixture.length-2)),/incomplete/);
 const png=await bytes('./fixtures/exif.png');
 const cleanedPng=await stripEncodedMetadata(png);
 assert.equal(verifyClean(await inspectMetadata(cleanedPng)).passed,true);
 assert.deepEqual(cleanedPng,stripPng(png));
});
