import {inspectMetadata,compareMetadata,verifyClean,sha256,makeZip,normalizeConfig,stripEncodedMetadata} from './privacy.mjs';
import {inspect,maxBytes} from './image.mjs';
const $=id=>document.getElementById(id);
let zip=null;
const state={config:normalizeConfig(),file:null,report:null,comparison:null,files:[],ticket:0,batchTicket:0,busy:false};
fetch('./config.json',{credentials:'omit'}).then(r=>{if(!r.ok)throw new Error('Configuration unavailable');return r.json();}).then(c=>{state.config=normalizeConfig(c);$('file-limits').textContent=`Choose up to ${state.config.maxFiles} JPEG or PNG files. HEIC can be identified, but is not edited or sanitized here. Each can be up to ${Math.min(48,state.config.maxFileMiB)} MiB and 52 megapixels.`;$('batch-dimensions').textContent=`Large images are fitted within ${state.config.maxExportSide.toLocaleString()} pixels per side and ${state.config.maxExportPixels.toLocaleString()} pixels total.`;$('privacy-limits').textContent=`Batch export: up to ${state.config.maxBatchFiles} files and ${state.config.maxBatchMiB} MiB combined. Whole images are re-encoded sequentially; editor adjustments are not applied to the batch.`;}).catch(()=>{$('privacy-limits').textContent='Default limits apply: 20 files and 192 MiB combined. Whole images are re-encoded sequentially.';});
export const privacyConfig=()=>state.config;
const status=text=>{$('privacy-status').textContent=text;};
const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=Object.assign(document.createElement('a'),{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const base=file=>file.name.replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|]/g,'-').replaceAll('..','-')||'photo';
function cells(values,header=false){const tr=document.createElement('tr');for(const value of values){const td=document.createElement(header?'th':'td');td.textContent=String(value??'—');tr.append(td);}return tr;}
function render() {
  if(!state.report)return;
  const r=state.report;
  $('privacy-file').textContent=state.file.name;
  $('privacy-overview').textContent=`${r.format} · ${r.rows.length} metadata fields · ${r.metadataContainers} metadata containers · ${r.bytes.toLocaleString()} bytes`;
  $('privacy-gps').textContent=r.gps;
  $('privacy-credentials').textContent=r.credentials;
  $('privacy-integrity').textContent=r.complete?'Container scan completed':r.issues.join(' ');
  $('privacy-notes').textContent=r.notes.join(' ');
  $('privacy-report').disabled=false;
  $('privacy-compare').disabled=false;
  $('privacy-fields').replaceChildren(...r.rows.filter(row=>{const q=$('privacy-query').value.trim().toLowerCase();return !q||(row.key+' '+row.value).toLowerCase().includes(q);}).map(row=>cells([row.group,row.key,row.value])));
  $('privacy-empty').hidden=r.rows.length!==0;
  $('privacy-structure').replaceChildren(...r.containers.map(c=>cells([c.type,c.offset,c.length,c.kind])));
}
export async function openPrivacy(file) {
  const ticket=++state.ticket;state.file=file;state.report=null;state.comparison=null;
  $('privacy-desk').hidden=false;$('comparison-panel').hidden=true;$('privacy-report').disabled=true;$('privacy-compare').disabled=true;$('privacy-query').value='';
  $('privacy-file').textContent=file.name;$('privacy-overview').textContent='Inspection pending';$('privacy-gps').textContent='Not assessed';$('privacy-credentials').textContent='Not assessed';$('privacy-integrity').textContent='Inspection pending';$('privacy-notes').textContent='';$('privacy-fields').replaceChildren();$('privacy-structure').replaceChildren();
  status('Inspecting metadata locally…');
  try {if(file.size>state.config.maxFileMiB*1048576)throw new Error(`File exceeds ${state.config.maxFileMiB} MiB inspection limit.`);const report=await inspectMetadata(await file.arrayBuffer(),state.config);if(ticket!==state.ticket)return;state.report=report;render();status('Inspection ready. Metadata reports can contain coordinates and identifying fields.');}
  catch(error){if(ticket===state.ticket)status(error.message);}
}
export function setPrivacyFiles(files) {
  state.batchTicket++;zip=null;state.files=files.slice();$('bulk-clean').disabled=!files.length;
  $('bulk-results').replaceChildren();$('bulk-download').disabled=true;
  if(files[0])openPrivacy(files[0]);
}
export function clearPrivacy() {
  state.ticket++;state.batchTicket++;state.file=null;state.report=null;state.comparison=null;state.files=[];zip=null;
  $('privacy-desk').hidden=true;$('bulk-clean').disabled=true;$('bulk-download').disabled=true;$('bulk-results').replaceChildren();
}
async function showComparison(original,originalReport,other,otherReport,verification=null) {
  const ticket=state.ticket;
  const [originalHash,outputHash]=await Promise.all([sha256(await original.arrayBuffer()),sha256(await other.arrayBuffer())]);
  if(ticket!==state.ticket||state.file!==original)return;
  const comparison=compareMetadata(originalReport,otherReport);
  state.comparison={schema:'coolcode.photolab.comparison.v1',capturedAt:new Date().toISOString(),original:{name:original.name,sha256:originalHash,metadata:originalReport},output:{name:other.name||'Edited export',sha256:outputHash,metadata:otherReport},verification,comparison};
  $('comparison-panel').hidden=false;
  $('comparison-title').textContent=verification?'Verified export comparison':'Selected-file comparison';
  $('comparison-status').textContent=verification?verification.message:'These are two independently selected files. A hash difference identifies different file bytes; it does not establish why they differ.';
  $('comparison-summary').textContent=`${comparison.removed} fields removed · ${comparison.changed} changed · ${comparison.added} added · ${comparison.unchanged} unchanged`;
  $('original-hash').textContent=originalHash;$('output-hash').textContent=outputHash;
  $('comparison-fields').replaceChildren(...comparison.rows.map(row=>cells([row.status,row.key,row.before,row.after])));
  $('comparison-report').disabled=false;
}
export async function cleanEncodedExport(blob) {
  const bytes=await stripEncodedMetadata(await blob.arrayBuffer(),state.config);
  return new Blob([bytes],{type:blob.type});
}
export async function verifyExport(original,blob) {
  const [before,after]=await Promise.all([inspectMetadata(await original.arrayBuffer(),state.config),inspectMetadata(await blob.arrayBuffer(),state.config)]);
  const verification=verifyClean(after);
  if(!verification.passed)throw new Error(verification.message+' '+after.issues.join(' '));
  if(state.file===original)await showComparison(original,before,blob,after,verification);
  return verification;
}
$('privacy-query').addEventListener('input',render);
$('privacy-report').addEventListener('click',()=>{if(state.report)download(new Blob([JSON.stringify({schema:'coolcode.photolab.metadata.v1',file:state.file.name,capturedAt:new Date().toISOString(),...state.report},null,2)],{type:'application/json'}),base(state.file)+'-metadata.json');});
$('privacy-compare').addEventListener('click',()=>$('privacy-other').click());
$('privacy-other').addEventListener('change',async event=>{
  const file=event.target.files[0],original=state.file,report=state.report;if(!file||!original||!report)return;
  status('Inspecting the comparison file and calculating both hashes…');
  try {if(file.size>state.config.maxFileMiB*1048576)throw new Error(`File exceeds ${state.config.maxFileMiB} MiB inspection limit.`);const other=await inspectMetadata(await file.arrayBuffer(),state.config);await showComparison(original,report,file,other);if(state.file===original)status('Comparison ready. Both metadata reports remain local.');}catch(error){status(error.message);}finally{event.target.value='';}
});
$('comparison-report').addEventListener('click',()=>{if(state.comparison)download(new Blob([JSON.stringify(state.comparison,null,2)],{type:'application/json'}),'photo-comparison.json');});
$('bulk-download').addEventListener('click',()=>{if(zip)download(zip,'sanitized-photos.zip');});
$('bulk-cancel').addEventListener('click',()=>{state.batchTicket++;status('Batch cancelled. Completed results remain listed; no partial ZIP is offered.');});
$('bulk-clean').addEventListener('click',async()=>{
  if(state.busy)return;
  const files=state.files.slice(),c=state.config;
  if(!files.length)return;
  if(files.length>c.maxBatchFiles||files.reduce((n,f)=>n+f.size,0)>c.maxBatchMiB*1048576){status(`Choose at most ${c.maxBatchFiles} files and ${c.maxBatchMiB} MiB combined for batch export.`);return;}
  const ticket=++state.batchTicket,neutral=$('neutral-names').checked,format=$('bulk-format').value;
  state.busy=true;zip=null;$('bulk-clean').disabled=true;$('bulk-download').disabled=true;$('bulk-cancel').disabled=false;$('bulk-results').replaceChildren();
  const outputs=[],manifest=[];let outputBytes=0;
  try {
    for(let i=0;i<files.length;i++) {
      if(ticket!==state.batchTicket)return;
      const file=files[i],record={inputIndex:i+1,status:'Failed'};let bitmap,canvas;
      status(`Re-encoding and verifying photo ${i+1} of ${files.length}…`);
      try {
        if(file.size>Math.min(maxBytes,c.maxFileMiB*1048576))throw new Error('File is above the per-image limit.');
        const bytes=await file.arrayBuffer(),meta=inspect(bytes),before=await inspectMetadata(bytes,c);
        if(before.animated)throw new Error('Animated PNG is not batch-exported because a still export would discard frames.');
        bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
        const ratio=Math.min(1,c.maxExportSide/bitmap.width,c.maxExportSide/bitmap.height,Math.sqrt(c.maxExportPixels/(bitmap.width*bitmap.height)));
        const width=Math.max(1,Math.floor(bitmap.width*ratio)),height=Math.max(1,Math.floor(bitmap.height*ratio));
        const mime=format==='same'?(meta.format==='JPEG'?'image/jpeg':'image/png'):format;
        canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
        if(mime==='image/jpeg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);}ctx.drawImage(bitmap,0,0,width,height);
        let blob=await new Promise(resolve=>canvas.toBlob(resolve,mime,c.batchJpegQuality));
        if(!blob||blob.type!==mime)throw new Error('Browser could not encode this format.');
        blob=await cleanEncodedExport(blob);
        const outBytes=new Uint8Array(await blob.arrayBuffer()),after=await inspectMetadata(outBytes,c),verification=verifyClean(after);
        if(!verification.passed)throw new Error(verification.message+' '+after.issues.join(' ')+' Remaining: '+after.containers.filter(item=>item.kind==='Metadata').map(item=>item.type).join(', '));
        outputBytes+=outBytes.length;if(outputBytes>c.maxBatchMiB*1048576)throw new Error('Batch output memory limit reached.');
        const name=`${neutral?'photo':base(file)}-${String(i+1).padStart(3,'0')}-clean.${mime==='image/png'?'png':'jpg'}`;
        record.status='Verified';record.output=name;record.width=width;record.height=height;record.originalSha256=await sha256(bytes);record.outputSha256=await sha256(outBytes);record.removedMetadataContainers=before.metadataContainers;record.verification=verification;record.originalInspectionComplete=before.complete;
        outputs.push({name,bytes:outBytes});
      } catch(error){record.error=error.message;}
      finally {bitmap?.close();if(canvas){canvas.width=1;canvas.height=1;}}
      if(ticket!==state.batchTicket)return;
      manifest.push(record);$('bulk-results').append(cells([neutral?`Input ${i+1}`:file.name,record.status,record.output||record.error]));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(outputs.length){outputs.push({name:'verification.json',bytes:new TextEncoder().encode(JSON.stringify({schema:'coolcode.photolab.batch.v1',capturedAt:new Date().toISOString(),note:'Original field values, GPS coordinates and input names are omitted. Re-encoding can change compression, colour and dimensions. Verify visible image content before sharing.',files:manifest},null,2))});zip=makeZip(outputs);$('bulk-download').disabled=false;}
    status(`${manifest.filter(r=>r.status==='Verified').length} of ${files.length} photos verified. Failed files are excluded from the ZIP. The verification manifest omits original metadata values.`);
  }finally {state.busy=false;$('bulk-clean').disabled=!state.files.length;$('bulk-cancel').disabled=true;}
});
