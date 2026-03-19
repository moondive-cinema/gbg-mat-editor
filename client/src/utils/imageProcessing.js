import { KEEP, KILL } from '../constants';
import { hexToRgb } from './colorUtils';

/**
 * Box blur (3-pass separable) on RGBA ImageData-like buffer.
 * Operates in-place on the R channel, copies to G/B.
 */
export function stackBlur(data,w,h,r){
  if(r<1)return;
  for(let p=0;p<3;p++){
    for(let y=0;y<h;y++){let s=0,c=0;for(let x=0;x<Math.min(r,w);x++){s+=data[(y*w+x)*4];c++;}for(let x=0;x<w;x++){const i=x+r,o=x-r-1;if(i<w){s+=data[(y*w+i)*4];c++;}if(o>=0){s-=data[(y*w+o)*4];c--;}data[(y*w+x)*4]=data[(y*w+x)*4+1]=data[(y*w+x)*4+2]=s/c;}}
    for(let x=0;x<w;x++){let s=0,c=0;for(let y=0;y<Math.min(r,h);y++){s+=data[(y*w+x)*4];c++;}for(let y=0;y<h;y++){const i=y+r,o=y-r-1;if(i<h){s+=data[(i*w+x)*4];c++;}if(o>=0){s-=data[(o*w+x)*4];c--;}data[(y*w+x)*4]=data[(y*w+x)*4+1]=data[(y*w+x)*4+2]=s/c;}}
  }
}

/** Deque-based 1D sliding min/max. */
function slidingExtreme(arr,len,r,mx){
  const f=new Uint8Array(len),b=new Uint8Array(len);
  let dq=[];
  for(let i=0;i<len;i++){while(dq.length&&dq[0]<i-r)dq.shift();while(dq.length&&(mx?arr[dq[dq.length-1]]<=arr[i]:arr[dq[dq.length-1]]>=arr[i]))dq.pop();dq.push(i);f[i]=arr[dq[0]];}
  dq=[];
  for(let i=len-1;i>=0;i--){while(dq.length&&dq[0]>i+r)dq.shift();while(dq.length&&(mx?arr[dq[dq.length-1]]<=arr[i]:arr[dq[dq.length-1]]>=arr[i]))dq.pop();dq.push(i);b[i]=arr[dq[0]];}
  const res=new Uint8Array(len);for(let i=0;i<len;i++)res[i]=mx?Math.max(f[i],b[i]):Math.min(f[i],b[i]);return res;
}

/** Separable morphological dilate/erode on RGBA mask buffer. In-place. */
export function applyMorph(raw,w,h,rad,mode){
  if(!rad)return;const mx=mode==='dilate';
  const g=new Uint8Array(w*h);for(let i=0;i<w*h;i++)g[i]=raw[i*4]>127?255:0;
  const t=new Uint8Array(w*h);for(let y=0;y<h;y++)t.set(slidingExtreme(g.subarray(y*w,(y+1)*w),w,rad,mx),y*w);
  const c=new Uint8Array(h);for(let x=0;x<w;x++){for(let y=0;y<h;y++)c[y]=t[y*w+x];const r=slidingExtreme(c,h,rad,mx);for(let y=0;y<h;y++){raw[(y*w+x)*4]=raw[(y*w+x)*4+1]=raw[(y*w+x)*4+2]=r[y];raw[(y*w+x)*4+3]=255;}}
}

/** Composite image + mask overlay → canvas. Supports dirty-rect via cx0..cy1. */
export function composite(ctx,imgId,mask,mw,mh,op,outBuf,dw,dh,cx0,cy0,cx1,cy1){
  cx0=cx0??0;cy0=cy0??0;cx1=cx1??dw;cy1=cy1??dh;
  const sx=mw/dw,sy=mh/dh,od=outBuf.data,imgD=imgId.data;
  const [kr,kg,kb]=hexToRgb(KEEP);
  const [xr,xg,xb]=hexToRgb(KILL);
  for(let y=cy0;y<cy1;y++)for(let x=cx0;x<cx1;x++){
    const mi=(Math.floor(y*sy)*mw+Math.floor(x*sx))*4,di=(y*dw+x)*4;
    let r=imgD[di],g=imgD[di+1],b=imgD[di+2];
    const v=mask[mi]/255,a=op;
    if(v>0.5){const s=(v-0.5)*2;const weight=Math.min(1,a*s*0.85);r=r*(1-weight)+kr*weight;g=g*(1-weight)+kg*weight;b=b*(1-weight)+kb*weight;}
    else{const s=(0.5-v)*2;const weight=Math.min(1,a*s*0.85);r=r*(1-weight)+xr*weight;g=g*(1-weight)+xg*weight;b=b*(1-weight)+xb*weight;}
    od[di]=r;od[di+1]=g;od[di+2]=b;od[di+3]=255;
  }
  ctx.putImageData(outBuf,0,0,cx0,cy0,cx1-cx0,cy1-cy0);
}

/** Minimal uncompressed TIFF decoder → ImageData. */
export function decodeTIFF(buf){
  const v=new DataView(buf),le=v.getUint16(0,true)===0x4949;
  const g16=o=>v.getUint16(o,le),g32=o=>v.getUint32(o,le);
  if(g16(2)!==42)throw new Error("Not a valid TIFF");
  let off=g32(4);const tags={},n=g16(off);off+=2;
  for(let i=0;i<n;i++){const b=off+i*12,tag=g16(b),type=g16(b+2),cnt=g32(b+4),rv=(o,t)=>t===3?g16(o):g32(o),vo=b+8,by=type===3?2:4;tags[tag]=cnt===1?[rv(vo,type)]:cnt*by<=4?Array.from({length:cnt},(_,k)=>rv(vo+k*by,type)):Array.from({length:cnt},(_,k)=>rv(g32(vo)+k*by,type));}
  const w=tags[256]?.[0],h=tags[257]?.[0],bps=tags[258]?.[0]??8,comp=tags[259]?.[0]??1,photo=tags[262]?.[0]??1,spp=tags[277]?.[0]??1;
  if(!w||!h)throw new Error("TIFF: no dimensions");if(comp!==1)throw new Error("TIFF: compression not supported");
  const rgba=new Uint8ClampedArray(w*h*4),sc=bps===16?1/257:1;let px=0;
  for(let s=0;s<tags[273].length;s++){const o=tags[273][s],b8=bps/8,sp=tags[279][s]/(spp*b8);for(let p=0;p<sp;p++,px++){if(px>=w*h)break;const base=o+p*spp*b8,rd=bps===16?x=>v.getUint16(x,le):x=>v.getUint8(x);let r,g,bb;if(photo===2&&spp>=3){r=rd(base)*sc;g=rd(base+b8)*sc;bb=rd(base+b8*2)*sc;}else{const l=rd(base)*sc;r=g=bb=photo===0?255-l:l;}rgba[px*4]=r;rgba[px*4+1]=g;rgba[px*4+2]=bb;rgba[px*4+3]=255;}}
  return new ImageData(rgba,w,h);
}

/** Load image or TIFF file → {width, height} or Image element. */
export function loadFile(file){
  const ext=file.name.split('.').pop().toLowerCase();
  return new Promise((res,rej)=>{
    const reader=new FileReader();
    if(ext==='tif'||ext==='tiff'){reader.onload=e=>{try{const id=decodeTIFF(e.target.result);const c=document.createElement("canvas");c.width=id.width;c.height=id.height;c.getContext("2d").putImageData(id,0,0);res({width:id.width,height:id.height,_canvas:c});}catch(err){rej(err);}};reader.readAsArrayBuffer(file);}
    else{reader.onload=e=>{const img=new Image();img.onload=()=>res(img);img.onerror=()=>rej(new Error("로드 실패"));img.src=e.target.result;};reader.readAsDataURL(file);}
  });
}

/** Draw source (Image or {_canvas}) to offscreen canvas, return ImageData. */
export function imgToCanvas(src,w,h){const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d");src._canvas?ctx.drawImage(src._canvas,0,0,w,h):ctx.drawImage(src,0,0,w,h);return ctx.getImageData(0,0,w,h);}
