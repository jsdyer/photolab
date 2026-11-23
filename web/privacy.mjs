/* Bounded local JPEG/PNG metadata inspection. No network or signature verification. */
const utf8 = new TextDecoder();
const latin = new TextDecoder('iso-8859-1');
const ascii = bytes => String.fromCharCode(...bytes);
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const sizes = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,13:4};
const tags = {256:'ImageWidth',257:'ImageLength',258:'BitsPerSample',259:'Compression',262:'PhotometricInterpretation',270:'ImageDescription',271:'Make',272:'Model',273:'StripOffsets',274:'Orientation',277:'SamplesPerPixel',278:'RowsPerStrip',279:'StripByteCounts',282:'XResolution',283:'YResolution',296:'ResolutionUnit',305:'Software',306:'DateTime',315:'Artist',318:'WhitePoint',330:'SubIFDs',513:'JPEGInterchangeFormat',514:'JPEGInterchangeFormatLength',700:'XMP',33432:'Copyright',33434:'ExposureTime',33437:'FNumber',34665:'ExifIFDPointer',34853:'GPSInfoIFDPointer',34855:'ISO',36864:'ExifVersion',36867:'DateTimeOriginal',36868:'DateTimeDigitized',36880:'OffsetTime',36881:'OffsetTimeOriginal',37121:'ComponentsConfiguration',37377:'ShutterSpeedValue',37378:'ApertureValue',37379:'BrightnessValue',37380:'ExposureBiasValue',37385:'Flash',37386:'FocalLength',37500:'MakerNote',37510:'UserComment',40960:'FlashpixVersion',40961:'ColorSpace',40962:'PixelXDimension',40963:'PixelYDimension',40965:'InteropIFDPointer',42016:'ImageUniqueID',42032:'CameraOwnerName',42033:'BodySerialNumber',42034:'LensSpecification',42035:'LensMake',42036:'LensModel',42037:'LensSerialNumber'};
const gpsTags = {0:'GPSVersionID',1:'GPSLatitudeRef',2:'GPSLatitude',3:'GPSLongitudeRef',4:'GPSLongitude',5:'GPSAltitudeRef',6:'GPSAltitude',7:'GPSTimeStamp',8:'GPSSatellites',9:'GPSStatus',10:'GPSMeasureMode',11:'GPSDOP',12:'GPSSpeedRef',13:'GPSSpeed',14:'GPSTrackRef',15:'GPSTrack',16:'GPSImgDirectionRef',17:'GPSImgDirection',18:'GPSMapDatum',19:'GPSDestLatitudeRef',20:'GPSDestLatitude',21:'GPSDestLongitudeRef',22:'GPSDestLongitude',23:'GPSDestBearingRef',24:'GPSDestBearing',25:'GPSDestDistanceRef',26:'GPSDestDistance',27:'GPSProcessingMethod',28:'GPSAreaInformation',29:'GPSDateStamp',30:'GPSDifferential',31:'GPSHPositioningError'};
export const defaults = {maxFiles:100,maxFileMiB:48,maxBatchFiles:20,maxBatchMiB:192,maxMetadataRows:2000,maxValueCharacters:4000,maxInflatedTextBytes:1048576,maxExportSide:8192,maxExportPixels:24000000,batchJpegQuality:0.92};
export function normalizeConfig(raw={}) {
  const config={...defaults};
  for(const key of Object.keys(config)) {
    const value=Number(raw[key]);
    if(Number.isFinite(value)&&value>0) config[key]=Math.min(value,defaults[key]*4);
  }
  for(const key of Object.keys(config).filter(k=>k!=='batchJpegQuality')) config[key]=Math.floor(config[key]);
  config.batchJpegQuality=Math.min(1,config.batchJpegQuality);
  return config;
}
export function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes) {crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function tiff(bytes, add, issue, state, prefix) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<8) {issue('Truncated EXIF/TIFF header.');return;}
  const order=v.getUint16(0),le=order===0x4949;
  if(![0x4949,0x4d4d].includes(order)||v.getUint16(2,le)!==42){issue('Unrecognized EXIF/TIFF header.');return;}
  const u16=p=>v.getUint16(p,le),u32=p=>v.getUint32(p,le);
  const visited=new Set();
  function directory(offset, group, depth=0) {
    if(!offset)return;
    if(depth>8||visited.size>=32||visited.has(offset)){issue('EXIF directory recursion or repeated pointer stopped.');return;}
    visited.add(offset);
    if(offset<8||offset+2>bytes.length){issue('EXIF directory points outside its container.');return;}
    const count=u16(offset);
    if(offset+2+count*12+4>bytes.length){issue('Truncated EXIF directory.');return;}
    for(let i=0;i<count;i++) {
      if(state.rows.length>=state.config.maxMetadataRows){issue('Metadata row limit reached.');return;}
      const p=offset+2+i*12,tag=u16(p),type=u16(p+2),n=u32(p+4),size=sizes[type];
      const name=(group==='GPS'?gpsTags[tag]:tags[tag])||'Tag 0x'+tag.toString(16).padStart(4,'0');
      const key=`${prefix}/${group}/${name}`;
      if(!size){add(key,`Unsupported TIFF type ${type}; ${n} values`,'EXIF');issue('One or more EXIF types were not decoded.');continue;}
      const len=n*size,start=len<=4?p+8:u32(p+8);
      if(!Number.isSafeInteger(len)||start+len>bytes.length){add(key,'Invalid value bounds','EXIF');issue('EXIF value outside its container.');continue;}
      const data=bytes.subarray(start,start+len);
      let value;
      if(type===2)value=latin.decode(data).replace(/\0+$/,'');
      else if(type===7)value=`${len} bytes · hex ${hex(data.subarray(0,64))}${len>64?'…':''}`;
      else {
        const values=[];
        for(let j=0;j<Math.min(n,64);j++) {
          const at=start+j*size;
          if(type===1)values.push(v.getUint8(at));
          else if(type===6)values.push(v.getInt8(at));
          else if(type===3)values.push(u16(at));
          else if(type===8)values.push(v.getInt16(at,le));
          else if(type===4||type===13)values.push(u32(at));
          else if(type===9)values.push(v.getInt32(at,le));
          else if(type===11)values.push(v.getFloat32(at,le));
          else if(type===12)values.push(v.getFloat64(at,le));
          else {const a=type===5?u32(at):v.getInt32(at,le),b=type===5?u32(at+4):v.getInt32(at+4,le);values.push(`${a}/${b}`);}
        }
        value=values.join(', ')+(n>64?` … (${n} values)`: '');
      }
      add(key,value,'EXIF',group==='GPS');
      if(group==='GPS')state.gps=true;
      if(tag===37500)state.notes.add('MakerNote is listed as bounded raw bytes; manufacturer-specific fields are not decoded.');
      if([34665,34853,40965].includes(tag)&&n===1&&(type===4||type===13)) directory(u32(start),tag===34665?'Exif':tag===34853?'GPS':'Interop',depth+1);
      if(tag===330&&(type===4||type===13))for(let j=0;j<Math.min(n,8);j++)directory(u32(start+j*4),`SubIFD${j+1}`,depth+1);
    }
    const next=u32(offset+2+count*12);
    if(next)directory(next,group==='IFD0'?'Thumbnail':group+' next',depth+1);
  }
  directory(u32(4),'IFD0');
}
async function inflate(bytes, maxBytes) {
  if(typeof DecompressionStream==='undefined')throw new Error('Compressed metadata cannot be decoded in this browser.');
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const parts=[];let total=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maxBytes)throw new Error('Compressed text exceeds the inspection limit.');parts.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const out=new Uint8Array(total);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;
}
function iptc(data,add,issue,prefix) {
  const names={5:'ObjectName',25:'Keywords',55:'DateCreated',60:'TimeCreated',80:'Byline',85:'BylineTitle',90:'City',92:'SubLocation',95:'ProvinceState',101:'CountryName',105:'Headline',110:'Credit',115:'Source',116:'CopyrightNotice',120:'CaptionAbstract',122:'WriterEditor'};
  let p=0,n=0;
  while(p+5<=data.length&&n++<2000){if(data[p]!==0x1c){issue('Undecoded IPTC resource bytes.');break;}const record=data[p+1],tag=data[p+2];let len=(data[p+3]<<8)|data[p+4];p+=5;if(len&0x8000){const extra=len&0x7fff;if(extra>4||p+extra>data.length){issue('Invalid IPTC length.');break;}len=0;for(let j=0;j<extra;j++)len=len*256+data[p++];}if(p+len>data.length){issue('Truncated IPTC field.');break;}add(`${prefix}/IPTC ${record}:${tag} ${record===2?(names[tag]||''):''}`,latin.decode(data.subarray(p,p+len)),'IPTC');p+=len;}
}
function photoshop(data,add,issue,prefix) {
  let p=14, n=0;const v=new DataView(data.buffer,data.byteOffset,data.byteLength);
  while(p+12<=data.length&&n++<2000){if(ascii(data.subarray(p,p+4))!=='8BIM'){issue('Unrecognized Photoshop resource signature.');break;}const id=v.getUint16(p+4);p+=6;const nameLength=data[p];p+=1+nameLength;if((nameLength+1)%2)p++;if(p+4>data.length){issue('Truncated Photoshop resource.');break;}const length=v.getUint32(p);p+=4;if(p+length>data.length){issue('Truncated Photoshop resource.');break;}const payload=data.subarray(p,p+length);if(id===0x0404)iptc(payload,add,issue,prefix);else add(`${prefix}/Photoshop resource 0x${id.toString(16)}`,`${length} bytes · hex ${hex(payload.subarray(0,32))}`,'Photoshop');p+=length+(length%2);}
}
export async function inspectMetadata(input, rawConfig={}) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input), config=normalizeConfig(rawConfig);
  if(bytes.length>config.maxFileMiB*1048576)throw new Error(`File exceeds ${config.maxFileMiB} MiB inspection limit.`);
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const state={format:'Unknown',rows:[],containers:[],issues:[],notes:new Set(),gps:false,credential:false,jumbf:false,complete:true,config,animated:false};
  const issue=message=>{state.complete=false;if(!state.issues.includes(message))state.issues.push(message);};
  const add=(key,value,group='Container',sensitive=false)=>{
    if(state.rows.length>=config.maxMetadataRows){issue('Metadata row limit reached.');return;}
    let text=String(value??'');if(text.length>config.maxValueCharacters){text=text.slice(0,config.maxValueCharacters)+'… [truncated]';state.notes.add('Long field values are truncated in the inspection report.');}
    state.rows.push({key,value:text,group,sensitive});
  };
  const container=(type,offset,length,kind)=>{state.containers.push({type,offset,length,kind});};
  if(bytes.length>=8&&v.getUint32(0)===0x89504e47&&v.getUint32(4)===0x0d0a1a0a) {
    state.format='PNG';let p=8,end=false,idat=false,ihdr=false,n=0;
    while(p+12<=bytes.length&&n++<10000) {
      const len=v.getUint32(p),type=ascii(bytes.subarray(p+4,p+8));
      if(p+12+len>bytes.length){issue('Truncated PNG chunk.');break;}
      const data=bytes.subarray(p+8,p+8+len);
      if(crc32(bytes.subarray(p+4,p+8+len))!==v.getUint32(p+8+len))issue(`PNG ${type} checksum mismatch.`);
      const safe=['IHDR','PLTE','IDAT','IEND','tRNS','sRGB','gAMA','cHRM','pHYs','cICP','mDCV','cLLI'].includes(type);
      container(type,p,len,safe?'Image structure':'Metadata');
      if(type==='IHDR'){if(ihdr)issue('Duplicate PNG IHDR.');ihdr=true;if(p!==8||len!==13)issue('Invalid PNG IHDR.');if(len>=13){state.width=v.getUint32(p+8);state.height=v.getUint32(p+12);if(!state.width||!state.height)issue('Invalid PNG dimensions.');}}
      if(type==='IDAT')idat=true;
      if(type==='eXIf')tiff(data,add,issue,state,'PNG eXIf');
      else if(['tEXt','zTXt','iTXt'].includes(type)) {
        const zero=data.indexOf(0);if(zero<1||zero>79){issue(`Invalid PNG ${type} keyword.`);}
        else {
          const keyword=latin.decode(data.subarray(0,zero));let textBytes=data.subarray(zero+1),encoding=latin;
          try {
            if(type==='zTXt'){if(textBytes[0]!==0)throw new Error('Unknown PNG text compression method.');textBytes=await inflate(textBytes.subarray(1),config.maxInflatedTextBytes);}
            if(type==='iTXt') {
              const compressed=textBytes[0],method=textBytes[1];let at=2;
              if(![0,1].includes(compressed)||method!==0)throw new Error('Invalid iTXt compression flags.');
              const langEnd=textBytes.indexOf(0,at),translatedEnd=textBytes.indexOf(0,langEnd+1);
              if(langEnd<0||translatedEnd<0)throw new Error('Malformed iTXt header.');
              textBytes=textBytes.subarray(translatedEnd+1);encoding=utf8;
              if(compressed)textBytes=await inflate(textBytes,config.maxInflatedTextBytes);
            }
            add(`PNG ${type}/${keyword}`,encoding.decode(textBytes),keyword==='XML:com.adobe.xmp'?'XMP':'PNG text');
          }catch(error){add(`PNG ${type}/${keyword}`,'Not decoded: '+error.message,'PNG text');issue(error.message);}
        }
      } else if(type==='tIME'&&len===7) add('PNG tIME',`${v.getUint16(p+8)}-${data[2]}-${data[3]} ${data[4]}:${data[5]}:${data[6]} UTC`,'PNG time');
      else if(type==='caBX'){state.credential=true;add('PNG caBX','C2PA/JUMBF container present; signature and assertions not validated.','Content Credentials');}
      else if(!safe){add('PNG '+type,`${len} bytes · hex ${hex(data.subarray(0,32))}`,'Container');if(['acTL','fcTL','fdAT'].includes(type))state.animated=true;}
      p+=12+len;if(type==='IEND'){end=true;if(len)issue('Invalid PNG IEND length.');break;}
    }
    if(!end||!ihdr||!idat)issue('PNG is missing IHDR, IDAT or IEND.');
    if(end&&p<bytes.length){container('Trailing bytes',p,bytes.length-p,'Metadata');add('PNG trailing bytes',bytes.length-p);issue('Bytes follow PNG IEND.');}
    if(n>=10000)issue('PNG chunk limit reached.');
  } else if(bytes.length>=2&&v.getUint16(0)===0xffd8) {
    state.format='JPEG';let p=2,end=false,scan=false,n=0;
    while(p<bytes.length&&n++<20000) {
      if(bytes[p]!==0xff){issue('Unexpected JPEG marker data.');break;}
      const start=p;while(p<bytes.length&&bytes[p]===0xff)p++;if(p>=bytes.length)break;const marker=bytes[p++];
      if(marker===0xd9){end=true;container('EOI',start,p-start,'Image structure');break;}
      if(marker===0x00){issue('Unexpected JPEG byte stuffing.');break;}
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(p+2>bytes.length){issue('Truncated JPEG marker.');break;}
      const len=v.getUint16(p);if(len<2||p+len>bytes.length){issue('Truncated JPEG segment.');break;}
      const data=bytes.subarray(p+2,p+len),name=marker>=0xe0&&marker<=0xef?'APP'+(marker-0xe0):marker===0xfe?'COM':'0x'+marker.toString(16);
      const jfif=marker===0xe0&&data.length===14&&ascii(data.subarray(0,5))==='JFIF\0'&&data[12]===0&&data[13]===0;
      const adobe=marker===0xee&&data.length===12&&ascii(data.subarray(0,5))==='Adobe';
      const structure=[0xc0,0xc1,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcc,0xcd,0xce,0xcf,0xda,0xdb,0xdc,0xdd,0xde,0xdf].includes(marker);
      const metadata=!structure&&!jfif&&!adobe;
      container(name,start,p+len-start,metadata?'Metadata':'Image structure');
      if(marker===0xe1&&ascii(data.subarray(0,6))==='Exif\0\0')tiff(data.subarray(6),add,issue,state,'JPEG EXIF');
      else if(marker===0xe1&&ascii(data.subarray(0,29))==='http://ns.adobe.com/xap/1.0/\0')add('JPEG XMP',utf8.decode(data.subarray(29)),'XMP');
      else if(marker===0xed&&ascii(data.subarray(0,14))==='Photoshop 3.0\0')photoshop(data,add,issue,'JPEG APP13');
      else if(marker===0xfe)add('JPEG comment',latin.decode(data),'Comment');
      else if(marker===0xeb&&data[0]===0x4a&&data[1]===0x50){state.jumbf=true;const content=latin.decode(data);if(content.includes('c2pa'))state.credential=true;add('JPEG APP11 JUMBF',`${data.length} bytes; ${state.credential?'C2PA label detected':'C2PA identity not established'}. No signature validation.`,'Content Credentials');}
      else if(metadata)add('JPEG '+name,`${data.length} bytes · hex ${hex(data.subarray(0,32))}`,'Container');
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&data.length>=6){state.height=v.getUint16(p+3);state.width=v.getUint16(p+5);}
      p+=len;
      if(marker===0xda){scan=true;while(p<bytes.length){if(bytes[p++]!==0xff)continue;const candidate=p-1;while(p<bytes.length&&bytes[p]===0xff)p++;if(p>=bytes.length)break;if(bytes[p]===0||bytes[p]>=0xd0&&bytes[p]<=0xd7){p++;continue;}p=candidate;break;}}
    }
    if(!end||!scan||!state.width||!state.height)issue('JPEG is missing a frame, image scan or end marker.');
    if(end&&p<bytes.length){container('Trailing bytes',p,bytes.length-p,'Metadata');add('JPEG trailing bytes',bytes.length-p);issue('Bytes follow JPEG EOI.');}
    if(n>=20000)issue('JPEG segment limit reached.');
  } else if(bytes.length>=16&&ascii(bytes.subarray(4,8))==='ftyp') {
    const brand=ascii(bytes.subarray(8,12));
    state.format=['heic','heix','hevc','hevx','mif1','msf1'].includes(brand)?'HEIC/HEIF':'ISO BMFF';
    add('Container brand',brand);issue('HEIC/HEIF and other ISO BMFF metadata, pixel decoding and sanitization are not supported. Export a JPEG/PNG copy in a trusted image editor first, then inspect that copy here.');
  } else {issue('Unsupported file signature. Choose JPEG or PNG for metadata inspection and verified export.');}
  const metadataContainers=state.containers.filter(c=>c.kind==='Metadata').length;
  return {format:state.format,bytes:bytes.length,width:state.width??null,height:state.height??null,rows:state.rows,containers:state.containers,issues:state.issues,notes:[...state.notes],complete:state.complete,animated:state.animated,metadataContainers,gps:state.gps?'EXIF GPS fields present':state.complete?'No EXIF GPS fields found':'Unknown — inspection incomplete',credentials:state.credential?'C2PA container or label detected — unverified':state.jumbf?'JUMBF detected — C2PA identity unconfirmed':state.complete?'No embedded C2PA container detected':'Not fully assessed',c2paDetected:state.credential};
}
/* Strip encoder-added metadata only after parsing a complete freshly encoded image.
   Opaque ICC/APP payloads are removed, never added to the verification allowlist. */
export async function stripEncodedMetadata(input, config={}) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  const report=await inspectMetadata(bytes,config);
  if(!['JPEG','PNG'].includes(report.format)||!report.complete)throw new Error('Encoded image is incomplete: '+report.issues.join(' '));
  const removed=report.containers.filter(c=>c.kind==='Metadata');
  if(!removed.length)return bytes;
  const parts=[];let cursor=0,total=0;
  for(const item of removed) {
    const end=item.offset+item.length+(report.format==='PNG'?12:0);
    if(item.offset<cursor||end>bytes.length)throw new Error('Invalid encoded metadata bounds.');
    const part=bytes.subarray(cursor,item.offset);parts.push(part);total+=part.length;cursor=end;
  }
  const tail=bytes.subarray(cursor);parts.push(tail);total+=tail.length;
  const output=new Uint8Array(total);let at=0;
  for(const part of parts){output.set(part,at);at+=part.length;}
  return output;
}
export function verifyClean(report) {
  const supported=['JPEG','PNG'].includes(report.format);
  const passed=supported&&report.complete&&report.metadataContainers===0&&report.rows.length===0;
  return {passed,scope:'JPEG/PNG container metadata: EXIF including GPS, XMP, IPTC, comments/text, C2PA and unknown application/ancillary containers.',message:passed?'Verified: no original metadata containers remain in this export.':'Verification failed or incomplete; this file is not offered as a sanitized copy.',limitations:'Image structure and colour/rendering parameters remain. Visible personal information, filenames and steganography are not assessed. Content Credentials signatures are not validated.'};
}
export function compareMetadata(before,after) {
  const indexed=report=>{const counts=new Map(),map=new Map();for(const row of report.rows){const n=(counts.get(row.key)||0)+1;counts.set(row.key,n);map.set(row.key+' #'+n,row);}return map;};
  const a=indexed(before),b=indexed(after),rows=[];
  for(const key of new Set([...a.keys(),...b.keys()])) {
    const left=a.get(key),right=b.get(key);
    rows.push({key,before:left?.value??null,after:right?.value??null,status:!left?'Added':!right?'Removed':left.value===right.value?'Unchanged':'Changed'});
  }
  return {rows,removed:rows.filter(r=>r.status==='Removed').length,added:rows.filter(r=>r.status==='Added').length,changed:rows.filter(r=>r.status==='Changed').length,unchanged:rows.filter(r=>r.status==='Unchanged').length};
}
export async function sha256(bytes) {
  if(!globalThis.crypto?.subtle)throw new Error('SHA-256 requires a secure browser context.');
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
}
/* Small ZIP writer: stored files only, UTF-8 names, CRC32, no dependencies. */
export function makeZip(files) {
  const chunks=[],central=[];let offset=0;
  for(const {name,bytes} of files) {
    if(!name||name.includes('..')||/[\\/]/.test(name))throw new Error('ZIP entries must have safe flat filenames.');
    const filename=new TextEncoder().encode(name),crc=crc32(bytes),header=new Uint8Array(30+filename.length),v=new DataView(header.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,filename.length,true);header.set(filename,30);
    const item=new Uint8Array(46+filename.length),d=new DataView(item.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,filename.length,true);d.setUint32(42,offset,true);item.set(filename,46);central.push(item);chunks.push(header,bytes);offset+=header.length+bytes.length;
  }
  const end=new Uint8Array(22),v=new DataView(end.buffer),centralSize=central.reduce((n,c)=>n+c.length,0);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);return new Blob([...chunks,...central,end],{type:'application/zip'});
}
