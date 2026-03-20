import { useState, useRef, useEffect, useCallback } from 'react';
import { THEME, KEEP, KILL, DW, DH, WATCH_ENABLED, ZOOM_STEPS } from './constants';
import { hexToRgb } from './utils/colorUtils';
import { stackBlur, applyMorph, composite, loadFile, imgToCanvas } from './utils/imageProcessing';
import { CL } from './components/ui';
import { Toolbar } from './components/Toolbar';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';

function App(){
  const containerRef=useRef(null);
  const canvasRef=useRef(null),imgDataRef=useRef(null),maskRawRef=useRef(null);
  const mwRef=useRef(0),mhRef=useRef(0),painting=useRef(false),lastPos=useRef(null),scaleRef=useRef(1);
  const overlayRef=useRef(0.5),featherRef=useRef(0),softRef=useRef(0);
  const cropRef=useRef({top:0,bottom:0,left:0,right:0}),brushColorRef=useRef('keep'),brushSizeRef=useRef(40),toolRef=useRef('brush');
  const panningRef=useRef(false),panStartRef=useRef({}),zoomRef=useRef(1),panRef=useRef({x:0,y:0});
  const watchTimer=useRef(null),lastMtime=useRef(null);
  const compositeDataRef=useRef(null);
  const undoStack=useRef([]),redoStack=useRef([]);
  const [hCount,setHCount]=useState({u:0,r:0});
  const [loaded,setLoaded]=useState({img:false,mask:false});
  const [log,setLog]=useState(WATCH_ENABLED?"감시 폴더 대기 중… 또는 이미지 열기":"입력소스를 선택해주세요");
  const [gen,setGen]=useState(false);
  const [tool,setToolS]=useState('brush');
  const [brushColor,setBCStr]=useState('keep');
  const [brushSize,setBSStr]=useState(40);
  const [overlayOp,setOverlayOp]=useState(0.5);
  const [featherRad,setFeatherRad]=useState(0);
  const [softRad,setSoftRad]=useState(0);
  const [crop,setCropS]=useState({top:0,bottom:0,left:0,right:0});
  const [morphAmt,setMorphAmt]=useState(0);
  const [cursorPos,setCursorPos]=useState(null);
  const [overCanvas,setOverCanvas]=useState(false);
  const [zoom,setZoom]=useState(1);
  const [pan,setPan]=useState({x:0,y:0});
  const [watchActive,setWatchActive]=useState(WATCH_ENABLED);
  const [projectName,setProjectName]=useState('');
  const [outputDir,setOutputDir]=useState('');
  const [pickerOpen,setPickerOpen]=useState(false);
  const [pickerData,setPickerData]=useState(null);
  const videoRef=useRef(null);
  const streamObjRef=useRef(null);
  const streamAnimRef=useRef(null);
  const [streamActive,setStreamActive]=useState(false);
  const [liveView,setLiveView]=useState(false);
  const [camDevices,setCamDevices]=useState([]);
  const [selectedCam,setSelectedCam]=useState('');
  const [imageSource,setImageSource]=useState('none'); // 'none' | 'stream' | 'file'
  const dispWRef=useRef(DW),dispHRef=useRef(DH);
  const [dispW,setDispW]=useState(DW);
  const [dispH,setDispH]=useState(DH);
  const maskOverlayCanvasRef=useRef(null);
  const maskOverlayDirtyRef=useRef(true);

  const loadedRef=useRef(loaded);
  const genRef=useRef(gen);
  useEffect(()=>{loadedRef.current=loaded;},[loaded]);
  useEffect(()=>{genRef.current=gen;},[gen]);

  // 앱 시작 시 config 로드
  useEffect(()=>{
    fetch('/config').then(r=>r.json()).then(cfg=>{
      if(cfg.project_name)setProjectName(cfg.project_name);
      if(cfg.output_dir)setOutputDir(cfg.output_dir);
    }).catch(()=>{});
  },[]);

  const persistConfig=useCallback((pn,od)=>{
    fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project_name:pn,output_dir:od})}).catch(()=>{});
  },[]);

  const browseTo=useCallback(async(path)=>{
    try{
      const r=await fetch('/browse?path='+encodeURIComponent(path));
      const d=await r.json();
      if(d.error)throw new Error(d.error);
      setPickerData(d);
    }catch(err){setLog(`폴더 탐색 실패: ${err.message}`);}
  },[]);

  const handlePickDir=useCallback(async()=>{
    if(pickerOpen){setPickerOpen(false);return;}
    setPickerOpen(true);
    await browseTo(outputDir||'~');
  },[pickerOpen,outputDir,browseTo]);

  const selectDir=useCallback((path)=>{
    setOutputDir(path);
    persistConfig(projectName,path);
    setPickerOpen(false);
  },[projectName,persistConfig]);

  const setTool=v=>{toolRef.current=v;setToolS(v);};
  const setBC=v=>{brushColorRef.current=v;setBCStr(v);};
  const setBS=v=>{brushSizeRef.current=v;setBSStr(v);};

  const saveHistory=useCallback(()=>{
    if(!maskRawRef.current)return;
    undoStack.current.push({data:new Uint8ClampedArray(maskRawRef.current),w:mwRef.current,h:mhRef.current,crop:{...cropRef.current}});
    if(undoStack.current.length>40)undoStack.current.shift();
    redoStack.current=[];setHCount({u:undoStack.current.length,r:0});
  },[]);

  const buildMask=()=>{
    const raw=maskRawRef.current,w=mwRef.current,h=mhRef.current;if(!raw||!w)return null;
    const data=new Uint8ClampedArray(raw),c=cropRef.current;
    const ct=Math.floor(c.top/100*h),cb=Math.floor(c.bottom/100*h),cl=Math.floor(c.left/100*w),cr=Math.floor(c.right/100*w);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(y<ct||y>=h-cb||x<cl||x>=w-cr){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=0;data[i+3]=255;}}
    if(featherRef.current>0){stackBlur(data,w,h,featherRef.current);for(let i=0;i<w*h;i++){const v=data[i*4]>127?255:0;data[i*4]=data[i*4+1]=data[i*4+2]=v;data[i*4+3]=255;}}
    if(softRef.current>0)stackBlur(data,w,h,softRef.current);
    return data;
  };

  const redraw=useCallback(()=>{
    if(!canvasRef.current||!imgDataRef.current||!maskRawRef.current)return;
    const ctx=canvasRef.current.getContext('2d');
    const dw=dispWRef.current,dh=dispHRef.current;
    if(!compositeDataRef.current||compositeDataRef.current.width!==dw||compositeDataRef.current.height!==dh)
      compositeDataRef.current=ctx.createImageData(dw,dh);
    const mask=buildMask();if(!mask)return;
    const mw=mwRef.current,mh=mhRef.current;
    if(mw*mh*4!==mask.length)return;
    composite(ctx,imgDataRef.current,mask,mw,mh,overlayRef.current,compositeDataRef.current,dw,dh);
  },[]);

  const buildMaskOverlay=useCallback(()=>{
    const raw=maskRawRef.current,mw=mwRef.current,mh=mhRef.current;
    const dw=dispWRef.current,dh=dispHRef.current;
    if(!raw||!mw||!dw)return;
    if(!maskOverlayCanvasRef.current)maskOverlayCanvasRef.current=document.createElement('canvas');
    const oc=maskOverlayCanvasRef.current;oc.width=dw;oc.height=dh;
    const octx=oc.getContext('2d'),buf=octx.createImageData(dw,dh);
    const sx=mw/dw,sy=mh/dh;
    const [kr,kg,kb]=hexToRgb(KEEP),[xr,xg,xb]=hexToRgb(KILL);
    for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
      const mi=(Math.floor(y*sy)*mw+Math.floor(x*sx))*4,di=(y*dw+x)*4;
      const v=raw[mi]/255;
      const a=Math.round(overlayRef.current*0.85*255);
      if(v>0.5){buf.data[di]=kr;buf.data[di+1]=kg;buf.data[di+2]=kb;buf.data[di+3]=a;}
      else{buf.data[di]=xr;buf.data[di+1]=xg;buf.data[di+2]=xb;buf.data[di+3]=a;}
    }
    octx.putImageData(buf,0,0);
    maskOverlayDirtyRef.current=false;
  },[]);

  const undo=useCallback(()=>{
    if(undoStack.current.length===0)return;
    redoStack.current.push({data:new Uint8ClampedArray(maskRawRef.current),w:mwRef.current,h:mhRef.current,crop:{...cropRef.current}});
    const prev=undoStack.current.pop();
    maskRawRef.current=prev.data;mwRef.current=prev.w;mhRef.current=prev.h;
    if(prev.crop){cropRef.current=prev.crop;setCropS({...prev.crop});}
    setHCount({u:undoStack.current.length,r:redoStack.current.length});redraw();
  },[redraw]);

  const redo=useCallback(()=>{
    if(redoStack.current.length===0)return;
    undoStack.current.push({data:new Uint8ClampedArray(maskRawRef.current),w:mwRef.current,h:mhRef.current,crop:{...cropRef.current}});
    const next=redoStack.current.pop();
    maskRawRef.current=next.data;mwRef.current=next.w;mhRef.current=next.h;
    if(next.crop){cropRef.current=next.crop;setCropS({...next.crop});}
    setHCount({u:undoStack.current.length,r:redoStack.current.length});redraw();
  },[redraw]);

  const compositeDirty=useCallback((mx0,my0,mx1,my1)=>{
    if(!canvasRef.current||!imgDataRef.current||!maskRawRef.current)return;
    const ctx=canvasRef.current.getContext('2d');
    const dw=dispWRef.current,dh=dispHRef.current;
    if(!compositeDataRef.current||compositeDataRef.current.width!==dw||compositeDataRef.current.height!==dh)
      compositeDataRef.current=ctx.createImageData(dw,dh);
    const mw=mwRef.current,mh=mhRef.current,sx=dw/mw,sy=dh/mh;
    const cx0=Math.max(0,Math.floor(mx0*sx)-1),cy0=Math.max(0,Math.floor(my0*sy)-1);
    const cx1=Math.min(dw,Math.ceil(mx1*sx)+1),cy1=Math.min(dh,Math.ceil(my1*sy)+1);
    composite(ctx,imgDataRef.current,maskRawRef.current,mw,mh,overlayRef.current,compositeDataRef.current,dw,dh,cx0,cy0,cx1,cy1);
  },[]);

  const ingestImage=useCallback(async(src,filename,resetMask=false)=>{
    const MAX_W=1280;const ar=src.width/src.height;
    const dw=Math.min(src.width,MAX_W);const dh=Math.round(dw/ar);
    dispWRef.current=dw;dispHRef.current=dh;setDispW(dw);setDispH(dh);
    compositeDataRef.current=null;
    imgDataRef.current=imgToCanvas(src,dw,dh);
    if(!maskRawRef.current||resetMask){
      const w=src.width,h=src.height,blank=new Uint8ClampedArray(w*h*4);
      for(let i=0;i<w*h;i++){blank[i*4]=blank[i*4+1]=blank[i*4+2]=255;blank[i*4+3]=255;}
      maskRawRef.current=blank;mwRef.current=w;mhRef.current=h;
      undoStack.current=[];redoStack.current=[];setHCount({u:0,r:0});
      setLoaded({img:true,mask:true});
    } else setLoaded(p=>({...p,img:true}));
    setLog(`${filename} 로드 완료 (${src.width}×${src.height})`);
    requestAnimationFrame(redraw);
  },[redraw]);

  const handleMedia=async e=>{
    const file=e.target.files[0];e.target.value='';if(!file)return;
    stopStream();
    featherRef.current=0;setFeatherRad(0);softRef.current=0;setSoftRad(0);setMorphAmt(0);
    const zc={top:0,bottom:0,left:0,right:0};cropRef.current=zc;setCropS({...zc});
    if(file.type.startsWith('video/')){
      setLog(`비디오 로딩: ${file.name}…`);
      stopLiveView();
      if(streamObjRef.current){streamObjRef.current.getTracks().forEach(t=>t.stop());streamObjRef.current=null;}
      const video=videoRef.current;
      if(video.src)URL.revokeObjectURL(video.src);
      video.srcObject=null;video.src=URL.createObjectURL(file);video.loop=true;
      await video.play();
      setStreamActive(true);setImageSource('file');setCamDevices([]);setSelectedCam('');
      startLiveView(true);
      setLog(`${file.name} — ⊙ CAPTURE로 프레임 캡처`);
    } else {
      setLog(`로딩: ${file.name}…`);
      try{
        const src=await loadFile(file);
        const sameSize=maskRawRef.current&&mwRef.current===src.width&&mhRef.current===src.height;
        await ingestImage(src,file.name,!sameSize);
        setImageSource('file');
      }catch(err){setLog(`로드 실패: ${err.message}`);}
    }
  };

  useEffect(()=>{
    if(!watchActive){if(watchTimer.current)clearInterval(watchTimer.current);return;}
    const poll=async()=>{
      try{
        const headers=lastMtime.current?{"If-Modified-Since":lastMtime.current}:{};
        const resp=await fetch("/latest",{headers});
        if(resp.status===304)return;if(!resp.ok)return;
        const lm=resp.headers.get("Last-Modified");if(lm)lastMtime.current=lm;
        const fn=resp.headers.get("X-Filename")||"latest.jpg";
        const blob=await resp.blob();
        const file=new File([blob],fn,{type:blob.type});
        const src=await loadFile(file);
        await ingestImage(src,fn,true);
        setLog(`📂 ${fn} 자동 로드 — ✦ AI MASK로 마스크 생성`);
      }catch(_){}
    };
    poll();watchTimer.current=setInterval(poll,2000);
    return()=>clearInterval(watchTimer.current);
  },[watchActive,ingestImage]);

  const handleGenerateMask=useCallback(async()=>{
    if(!imgDataRef.current){setLog("이미지를 먼저 로드해주세요");return;}
    setGen(true);setLog("AI 마스크 생성 중…");
    try{
      const off=document.createElement("canvas");off.width=dispWRef.current;off.height=dispHRef.current;
      off.getContext("2d").putImageData(imgDataRef.current,0,0);
      const blob=await new Promise(r=>off.toBlob(r,"image/png"));
      const fd=new FormData();fd.append("image",blob,"frame.png");
      const resp=await fetch("/generate",{method:"POST",body:fd});
      if(!resp.ok){const e=await resp.json().catch(()=>({error:resp.statusText}));throw new Error(e.error);}
      const mblob=await resp.blob();
      const src=await loadFile(new File([mblob],"ai_mask.png",{type:"image/png"}));
      const nw=mwRef.current||src.width,nh=mhRef.current||src.height;
      const id=imgToCanvas(src,nw,nh);
      saveHistory();
      for(let i=0;i<id.data.length;i+=4){const g=Math.round(0.299*id.data[i]+0.587*id.data[i+1]+0.114*id.data[i+2]);const v=g>127?255:0;id.data[i]=id.data[i+1]=id.data[i+2]=v;id.data[i+3]=255;}
      maskRawRef.current=new Uint8ClampedArray(id.data);mwRef.current=nw;mhRef.current=nh;
      setLoaded(p=>({...p,mask:true}));setLog(`AI 마스크 완료 (${nw}×${nh})`);
      requestAnimationFrame(redraw);
    }catch(err){setLog(`AI 마스크 실패: ${err.message}`);}
    finally{setGen(false);}
  },[saveHistory,redraw]);

  // ── Stream ──────────────────────────────────────────────────────────────────
  const stopLiveView=useCallback(()=>{
    if(streamAnimRef.current){cancelAnimationFrame(streamAnimRef.current);streamAnimRef.current=null;}
    setLiveView(false);
  },[]);

  const startLiveView=useCallback((isNewMedia=false)=>{
    const video=videoRef.current;if(!video||!canvasRef.current)return;
    const beginDraw=()=>{
      const MAX_W=1280;
      const vw=video.videoWidth||DW,vh=video.videoHeight||DH;
      const ar=vw/vh;
      const dw=Math.min(vw,MAX_W),dh=Math.round(dw/ar);
      dispWRef.current=dw;dispHRef.current=dh;setDispW(dw);setDispH(dh);
      if(!maskRawRef.current||(isNewMedia&&(mwRef.current!==vw||mhRef.current!==vh))){
        const blank=new Uint8ClampedArray(vw*vh*4);
        for(let i=0;i<vw*vh;i++){blank[i*4]=blank[i*4+1]=blank[i*4+2]=255;blank[i*4+3]=255;}
        maskRawRef.current=blank;mwRef.current=vw;mhRef.current=vh;
        undoStack.current=[];redoStack.current=[];setHCount({u:0,r:0});
        setLoaded(p=>({...p,mask:true}));
      }
      maskOverlayDirtyRef.current=true;
      setLiveView(true);
      const ctx=canvasRef.current.getContext('2d');
      const draw=()=>{
        if(video.readyState>=2){
          ctx.drawImage(video,0,0,dispWRef.current,dispHRef.current);
          if(maskRawRef.current&&mwRef.current){
            if(maskOverlayDirtyRef.current)buildMaskOverlay();
            if(maskOverlayCanvasRef.current)ctx.drawImage(maskOverlayCanvasRef.current,0,0);
          }
        }
        streamAnimRef.current=requestAnimationFrame(draw);
      };
      streamAnimRef.current=requestAnimationFrame(draw);
    };
    if(video.videoWidth>0){beginDraw();}
    else{video.addEventListener('loadedmetadata',beginDraw,{once:true});}
  },[]);

  const stopStream=useCallback(()=>{
    stopLiveView();
    if(streamObjRef.current){streamObjRef.current.getTracks().forEach(t=>t.stop());streamObjRef.current=null;}
    const video=videoRef.current;
    if(video){video.pause();video.srcObject=null;if(video.src){URL.revokeObjectURL(video.src);video.src='';}}
    setStreamActive(false);setCamDevices([]);setSelectedCam('');
    maskOverlayCanvasRef.current=null;maskOverlayDirtyRef.current=true;
    requestAnimationFrame(redraw);
  },[stopLiveView,redraw]);


  const handleToggleStream=useCallback(async()=>{
    if(streamActive){stopStream();return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
      streamObjRef.current=stream;
      videoRef.current.srcObject=stream;
      await videoRef.current.play();
      setStreamActive(true);
      const devs=await navigator.mediaDevices.enumerateDevices();
      const vdevs=devs.filter(d=>d.kind==='videoinput');
      setCamDevices(vdevs);
      const activeId=stream.getVideoTracks()[0]?.getSettings()?.deviceId||'';
      setSelectedCam(activeId);
      startLiveView(true);
      setLog('스트림 연결됨 — ⊙ CAPTURE로 프레임 캡처');
    }catch(e){setLog('스트림 실패: '+e.message);}
  },[streamActive,stopStream,startLiveView]);

  const switchCamera=useCallback(async(deviceId)=>{
    setSelectedCam(deviceId);
    stopLiveView();
    if(streamObjRef.current)streamObjRef.current.getTracks().forEach(t=>t.stop());
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:deviceId}},audio:false});
      streamObjRef.current=stream;
      videoRef.current.srcObject=stream;
      await videoRef.current.play();
      startLiveView(true);
    }catch(e){setLog('카메라 전환 실패: '+e.message);}
  },[stopLiveView,startLiveView]);

  const captureFrame=useCallback(async()=>{
    const video=videoRef.current;if(!video||video.readyState<2)return;
    stopLiveView();
    const off=document.createElement('canvas');
    off.width=video.videoWidth||DW;off.height=video.videoHeight||DH;
    off.getContext('2d').drawImage(video,0,0);
    const blob=await new Promise(r=>off.toBlob(r,'image/png'));
    const file=new File([blob],'stream_capture.png',{type:'image/png'});
    setMorphAmt(0);
    const zc={top:0,bottom:0,left:0,right:0};cropRef.current=zc;setCropS({...zc});
    try{
      const src=await loadFile(file);
      await ingestImage(src,'stream_capture.png',false);
      setImageSource('stream');
      setLog('프레임 캡처 완료 — ✦ AI MASK로 마스크 생성');
    }catch(e){setLog('캡처 실패: '+e.message);}
  },[stopLiveView,ingestImage]);

  const handleReset=()=>{
    stopStream();
    imgDataRef.current=null;maskRawRef.current=null;mwRef.current=0;mhRef.current=0;lastMtime.current=null;
    canvasRef.current?.getContext("2d")?.clearRect(0,0,dispWRef.current,dispHRef.current);
    dispWRef.current=DW;dispHRef.current=DH;setDispW(DW);setDispH(DH);
    undoStack.current=[];redoStack.current=[];setHCount({u:0,r:0});
    setLoaded({img:false,mask:false});setImageSource('none');setLog(watchActive?"감시 폴더 대기 중…":"입력소스를 선택해주세요");
    setZoomVal(1);panRef.current={x:0,y:0};setPan({x:0,y:0});
    featherRef.current=0;setFeatherRad(0);softRef.current=0;setSoftRad(0);setMorphAmt(0);
    const zc={top:0,bottom:0,left:0,right:0};cropRef.current=zc;setCropS({...zc});
  };

  const handleExport=useCallback(async()=>{
    const w=mwRef.current,h=mhRef.current,mask=buildMask();if(!mask||!imgDataRef.current)return;
    // matte
    const mc=document.createElement("canvas");mc.width=w;mc.height=h;
    const mctx=mc.getContext("2d"),mid=mctx.createImageData(w,h);
    for(let i=0;i<w*h;i++){const v=Math.min(255,Math.max(0,mask[i*4]));mid.data[i*4]=mid.data[i*4+1]=mid.data[i*4+2]=v;mid.data[i*4+3]=255;}
    mctx.putImageData(mid,0,0);
    // reference — original image with mask overlay (matching display composite)
    const tmp=document.createElement("canvas");tmp.width=imgDataRef.current.width;tmp.height=imgDataRef.current.height;
    tmp.getContext("2d").putImageData(imgDataRef.current,0,0);
    const rc=document.createElement("canvas");rc.width=w;rc.height=h;
    const rctx=rc.getContext("2d");
    rctx.drawImage(tmp,0,0,w,h);
    const rid=rctx.getImageData(0,0,w,h);
    const [kr,kg,kb]=hexToRgb(KEEP),[xr,xg,xb]=hexToRgb(KILL);
    const op=overlayRef.current;
    for(let i=0;i<w*h;i++){
      const di=i*4,v=mask[i*4]/255;
      let r=rid.data[di],g=rid.data[di+1],b=rid.data[di+2];
      if(v>0.5){const s=(v-0.5)*2;const wt=Math.min(1,op*s*0.85);r=r*(1-wt)+kr*wt;g=g*(1-wt)+kg*wt;b=b*(1-wt)+kb*wt;}
      else{const s=(0.5-v)*2;const wt=Math.min(1,op*s*0.85);r=r*(1-wt)+xr*wt;g=g*(1-wt)+xg*wt;b=b*(1-wt)+xb*wt;}
      rid.data[di]=r;rid.data[di+1]=g;rid.data[di+2]=b;
    }
    rctx.putImageData(rid,0,0);
    setLog("저장 중…");
    try{
      const [mblob,rblob]=await Promise.all([
        new Promise(r=>mc.toBlob(r,"image/png")),
        new Promise(r=>rc.toBlob(r,"image/png")),
      ]);
      const fd=new FormData();
      fd.append("matte",mblob,"matte.png");
      fd.append("reference",rblob,"reference.png");
      const resp=await fetch("/save",{method:"POST",body:fd});
      const data=await resp.json();
      if(!resp.ok)throw new Error(data.error);
      setLog(`✓ 저장 완료: ${data.matte} / ${data.reference}`);
    }catch(err){setLog(`저장 실패: ${err.message}`);}
  },[buildMask]);

  const setZoomVal=v=>{zoomRef.current=v;setZoom(v);};
  const zoomIn=()=>{const i=ZOOM_STEPS.findIndex(z=>z>zoomRef.current);setZoomVal(ZOOM_STEPS[Math.min(i<0?ZOOM_STEPS.length-1:i,ZOOM_STEPS.length-1)]);};
  const zoomOut=()=>{const i=[...ZOOM_STEPS].reverse().findIndex(z=>z<zoomRef.current);setZoomVal(ZOOM_STEPS[Math.max(ZOOM_STEPS.length-1-i,0)]);};
  const fitView=useCallback(()=>{
    if(containerRef.current){const r=containerRef.current.getBoundingClientRect();const z=Math.max(0.25,Math.min((r.width-40)/dispWRef.current,(r.height-40)/dispHRef.current,4));setZoomVal(z);}
    else setZoomVal(1);
    panRef.current={x:0,y:0};setPan({x:0,y:0});
  },[]);

  useEffect(()=>{
    const handleKey=e=>{
      const isCmd=(e.metaKey||e.ctrlKey);
      if(isCmd){
        switch(e.key.toLowerCase()){
          case'z':e.preventDefault();if(e.shiftKey)redo();else undo();break;
          case'y':e.preventDefault();redo();break;
          case'o':e.preventDefault();document.getElementById('fileInput')?.click();break;
          case'g':e.preventDefault();if(loadedRef.current.img&&!genRef.current)handleGenerateMask();break;
          case's':e.preventDefault();if(loadedRef.current.img&&loadedRef.current.mask)handleExport();break;
          case'p':case'ㅔ':e.preventDefault();handleToggleStream();break;
        }
      } else {
        switch(e.key){
          case'q':case'Q':case'ㅂ':
            streamActive&&liveView?captureFrame():streamActive?startLiveView():handleToggleStream();break;
          case'w':case'W':case'ㅈ':setMorphAmt(v=>Math.max(-60,v-5));break;
          case'e':case'E':case'ㄷ':setMorphAmt(v=>Math.min(60,v+5));break;
          case's':case'S':case'ㄴ':setBS(Math.max(5,brushSizeRef.current-5));break;
          case'd':case'D':case'ㅇ':setBS(Math.min(200,brushSizeRef.current+5));break;
          case']':setBS(Math.min(200,brushSizeRef.current+5));break;
          case'[':setBS(Math.max(5,brushSizeRef.current-5));break;
          case'o':case'O':case'ㅐ':document.getElementById('fileInput')?.click();break;
          case'b':case'B':case'ㅠ':setTool('brush');break;
          case'c':case'C':case'ㅊ':setTool('crop');break;
          case'x':case'X':case'ㅌ':setBC(brushColorRef.current==='keep'?'kill':'keep');break;
          case'f':case'F':case'ㄹ':fitView();break;
        }
      }
    };
    window.addEventListener('keydown',handleKey);
    return()=>window.removeEventListener('keydown',handleKey);
  },[undo,redo,handleGenerateMask,handleExport,fitView,handleToggleStream,startLiveView,captureFrame,streamActive,liveView]);

  const getPos=e=>{const rect=canvasRef.current.getBoundingClientRect();const z=zoomRef.current;scaleRef.current=z;return{x:(e.clientX-rect.left)/z*(mwRef.current/dispWRef.current),y:(e.clientY-rect.top)/z*(mhRef.current/dispHRef.current)};};
  const paintCircle=(cx,cy)=>{
    const w=mwRef.current,h=mhRef.current;
    const rx=(brushSizeRef.current/2)*(w/dispWRef.current),ry=(brushSizeRef.current/2)*(h/dispHRef.current);
    const val=brushColorRef.current==='keep'?255:0,raw=maskRawRef.current;
    const x0=Math.max(0,Math.floor(cx-rx)),x1=Math.min(w-1,Math.ceil(cx+rx));
    const y0=Math.max(0,Math.floor(cy-ry)),y1=Math.min(h-1,Math.ceil(cy+ry));
    for(let py=y0;py<=y1;py++)for(let px=x0;px<=x1;px++){
      if((px-cx)**2/rx**2+(py-cy)**2/ry**2<=1){const i=(py*w+px)*4;raw[i]=raw[i+1]=raw[i+2]=val;raw[i+3]=255;}
    }
    maskOverlayDirtyRef.current=true;
    return{x0,y0,x1:x1+1,y1:y1+1};
  };
  const doPaint=e=>{
    if(toolRef.current!=='brush'||!painting.current||!maskRawRef.current)return;
    const pos=getPos(e);
    let dx0=Infinity,dy0=Infinity,dx1=-Infinity,dy1=-Infinity;
    const expand=d=>{dx0=Math.min(dx0,d.x0);dy0=Math.min(dy0,d.y0);dx1=Math.max(dx1,d.x1);dy1=Math.max(dy1,d.y1);};
    if(lastPos.current){
      const{x:lx,y:ly}=lastPos.current,ddx=pos.x-lx,ddy=pos.y-ly,dist=Math.sqrt(ddx*ddx+ddy*ddy);
      const rmin=Math.min((brushSizeRef.current/2)*(mwRef.current/dispWRef.current),(brushSizeRef.current/2)*(mhRef.current/dispHRef.current));
      const steps=Math.max(1,Math.ceil(dist/(rmin*0.3)));
      for(let s=1;s<=steps;s++)expand(paintCircle(lx+ddx*s/steps,ly+ddy*s/steps));
    }else expand(paintCircle(pos.x,pos.y));
    lastPos.current=pos;
    if(dx0<dx1)compositeDirty(dx0,dy0,dx1,dy1);
  };
  const onMouseMove=e=>{const rect=canvasRef.current?.getBoundingClientRect();if(rect){scaleRef.current=rect.width/dispWRef.current;setCursorPos({x:(e.clientX-rect.left)/zoomRef.current,y:(e.clientY-rect.top)/zoomRef.current});}doPaint(e);};
  const commitMorph=()=>{if(!morphAmt||!maskRawRef.current)return;saveHistory();applyMorph(maskRawRef.current,mwRef.current,mhRef.current,Math.abs(morphAmt),morphAmt>0?'dilate':'erode');setMorphAmt(0);maskOverlayDirtyRef.current=true;redraw();};
  const onWheel=e=>{e.preventDefault();e.deltaY<0?zoomIn():zoomOut();};
  const onPanStart=e=>{if(e.button!==1&&!(e.button===0&&e.altKey))return;e.preventDefault();panningRef.current=true;panStartRef.current={mx:e.clientX,my:e.clientY,px:panRef.current.x,py:panRef.current.y};};
  const onPanMove=e=>{if(!panningRef.current)return;const next={x:panStartRef.current.px+(e.clientX-panStartRef.current.mx),y:panStartRef.current.py+(e.clientY-panStartRef.current.my)};panRef.current=next;setPan({...next});};
  const onPanEnd=()=>{panningRef.current=false;};
  const onOverlay=v=>{overlayRef.current=v;setOverlayOp(v);maskOverlayDirtyRef.current=true;redraw();};
  const onFeather=v=>{featherRef.current=v;setFeatherRad(v);redraw();};
  const onSoftRad=v=>{softRef.current=v;setSoftRad(v);redraw();};
  const onCrop=(k,v)=>{const next={...cropRef.current,[k]:v};cropRef.current=next;setCropS({...next});redraw();};

  const isReady=loaded.mask&&(loaded.img||liveView);
  const hasCrop=crop.top>0||crop.bottom>0||crop.left>0||crop.right>0;

  // ── ALL KEEP / ALL KILL handlers for LeftPanel ──
  const onAllKeep=()=>{saveHistory();if(!maskRawRef.current)return;for(let i=0;i<maskRawRef.current.length;i+=4){maskRawRef.current[i]=maskRawRef.current[i+1]=maskRawRef.current[i+2]=255;maskRawRef.current[i+3]=255;}maskOverlayDirtyRef.current=true;redraw();};
  const onAllKill=()=>{saveHistory();if(!maskRawRef.current)return;for(let i=0;i<maskRawRef.current.length;i+=4){maskRawRef.current[i]=maskRawRef.current[i+1]=maskRawRef.current[i+2]=0;maskRawRef.current[i+3]=255;}maskOverlayDirtyRef.current=true;redraw();};
  const onResetCrop=()=>{saveHistory();const z={top:0,bottom:0,left:0,right:0};cropRef.current=z;setCropS(z);redraw();};

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"#111",color:"#ddd",fontFamily:"'JetBrains Mono','Courier New',monospace",fontSize:12}}>
      <Toolbar
        streamActive={streamActive} liveView={liveView} imageSource={imageSource}
        camDevices={camDevices} selectedCam={selectedCam}
        loaded={loaded} gen={gen} watchActive={watchActive} setWatchActive={setWatchActive}
        log={log} isReady={isReady}
        projectName={projectName} setProjectName={setProjectName}
        outputDir={outputDir} setOutputDir={setOutputDir}
        pickerOpen={pickerOpen} pickerData={pickerData}
        captureFrame={captureFrame} startLiveView={startLiveView}
        handleToggleStream={handleToggleStream} switchCamera={switchCamera}
        handleMedia={handleMedia} handleGenerateMask={handleGenerateMask}
        handleReset={handleReset} handleExport={handleExport}
        handlePickDir={handlePickDir} browseTo={browseTo} selectDir={selectDir}
        setPickerOpen={setPickerOpen} persistConfig={persistConfig}
      />

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <LeftPanel
          hCount={hCount} undo={undo} redo={redo}
          tool={tool} setTool={setTool} brushColor={brushColor} setBC={setBC}
          brushSize={brushSize} setBS={setBS}
          onAllKeep={onAllKeep} onAllKill={onAllKill}
          crop={crop} onCrop={onCrop} onResetCrop={onResetCrop}
          morphAmt={morphAmt} setMorphAmt={setMorphAmt} commitMorph={commitMorph}
          isReady={isReady}
          featherRad={featherRad} onFeather={onFeather}
          softRad={softRad} onSoftRad={onSoftRad}
          saveHistory={saveHistory}
        />

        {/* CANVAS AREA */}
        <video ref={videoRef} style={{display:"none"}} muted playsInline/>
        <div ref={containerRef} style={{flex:1,background:"#0d0d0d",overflow:"hidden",position:"relative"}} onWheel={onWheel} onMouseDown={onPanStart} onMouseMove={e=>{onPanMove(e);onMouseMove(e);}} onMouseUp={e=>{onPanEnd();painting.current=false;lastPos.current=null;}} onMouseLeave={e=>{onPanEnd();setOverCanvas(false);setCursorPos(null);painting.current=false;lastPos.current=null;}}>
          {liveView&&<div style={{position:"absolute",top:10,left:10,background:"#c0392b",color:"#fff",fontSize:9,fontWeight:"bold",letterSpacing:2,padding:"3px 8px",borderRadius:3,zIndex:10,pointerEvents:"none"}}>● LIVE</div>}
          {!isReady&&!liveView&&<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,pointerEvents:"none",userSelect:"none"}}><div style={{fontSize:48,color:"#1e1e1e"}}>⊡</div><div style={{fontSize:12,letterSpacing:2,color:"#2a2a2a"}}>{WATCH_ENABLED?"감시 폴더 대기 중 또는 이미지 열기":"입력소스를 선택해주세요"}</div></div>}
          <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`,transformOrigin:"center center",position:"relative"}} onMouseEnter={()=>setOverCanvas(true)} onMouseLeave={()=>{setOverCanvas(false);setCursorPos(null);}}>
              <canvas ref={canvasRef} width={dispW} height={dispH} style={{display:"block",width:dispW,height:dispH,border:"1px solid #222",cursor:"none"}} onMouseDown={e=>{if(e.button===0&&!e.altKey){saveHistory();painting.current=true;lastPos.current=null;doPaint(e);}}} onMouseMove={onMouseMove} onMouseUp={()=>{painting.current=false;lastPos.current=null;requestAnimationFrame(redraw);}}/>
              {tool==="brush"&&overCanvas&&cursorPos&&isReady&&<div style={{position:"absolute",left:cursorPos.x,top:cursorPos.y,width:brushSize,height:brushSize,transform:"translate(-50%,-50%)",border:`1px solid ${brushColor==="keep"?KEEP:KILL}`,borderRadius:"50%",pointerEvents:"none",boxShadow:"0 0 0 1px rgba(0,0,0,0.7)"}}/>}
              {isReady&&hasCrop&&<>{crop.top>0&&<CL side="top" v={crop.top}/>}{crop.bottom>0&&<CL side="bottom" v={crop.bottom}/>}{crop.left>0&&<CL side="left" v={crop.left}/>}{crop.right>0&&<CL side="right" v={crop.right}/>}</>}
            </div>
          </div>
        </div>

        <RightPanel
          zoom={zoom} zoomIn={zoomIn} zoomOut={zoomOut} fitView={fitView}
          setZoomVal={setZoomVal} panRef={panRef} setPan={setPan}
          overlayOp={overlayOp} onOverlay={onOverlay}
          tool={tool} brushColor={brushColor} brushSize={brushSize}
          featherRad={featherRad} softRad={softRad} morphAmt={morphAmt} crop={crop}
        />
      </div>
    </div>
  );
}

export default App;
