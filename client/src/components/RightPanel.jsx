import { THEME } from '../constants';
import { Tip, Sld, zS } from './ui';

export function RightPanel({
  zoom, zoomIn, zoomOut, fitView, setZoomVal, panRef, setPan,
  overlayOp, onOverlay,
  tool, brushColor, brushSize, featherRad, softRad, morphAmt, crop,
}){
  return(
    <div style={{width:144,minWidth:144,background:"#161616",borderLeft:"1px solid #222",padding:11,display:"flex",flexDirection:"column",gap:6}}>
      <div style={{color:"#888",fontSize:9,letterSpacing:2,marginBottom:3}}>VIEW</div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:4,padding:"4px 0",marginBottom:5}}><span style={{color:THEME,fontSize:13,fontWeight:"bold"}}>{Math.round(zoom*100)}%</span></div>
      <div style={{display:"flex",gap:4,marginBottom:4}}>
        <button onClick={zoomOut} style={zS}>−</button>
        <Tip label="F"><button onClick={fitView} style={{...zS,flex:2,fontSize:9}}>FIT</button></Tip>
        <button onClick={zoomIn} style={zS}>+</button>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>{[0.5,1,2,4].map(z=>(<button key={z} onClick={()=>{setZoomVal(z);panRef.current={x:0,y:0};setPan({x:0,y:0});}} style={{flex:"1 0 calc(50% - 4px)",padding:"3px 0",background:zoom===z?"#252525":"#1a1a1a",border:`1px solid ${zoom===z?THEME:"#2a2a2a"}`,borderRadius:3,color:zoom===z?THEME:"#888",fontFamily:"inherit",fontSize:10,cursor:"pointer"}}>{z===0.5?"50%":z===1?"100%":z===2?"200%":"400%"}</button>))}</div>
      <div style={{color:"#555",fontSize:9,lineHeight:1.7,marginBottom:8}}>스크롤: 줌<br/>Alt+드래그: 팬</div>
      <div style={{borderTop:"1px solid #222",marginBottom:6}}/>
      <div style={{color:"#888",fontSize:9,letterSpacing:2,marginBottom:3}}>OVERLAY</div>
      <Sld label="OPACITY" value={Math.round(overlayOp*100)} min={0} max={100} step={5} unit="%" onChange={v=>onOverlay(v/100)}/>
      <div style={{borderTop:"1px solid #222",marginBottom:6}}/>
      <div style={{color:"#888",fontSize:9,letterSpacing:2,marginBottom:3}}>STATUS</div>
      {[["TOOL",tool.toUpperCase()],["BRUSH",brushColor.toUpperCase()],["SIZE",`${brushSize}px`],["ROUND",featherRad>0?`${featherRad}px`:"OFF"],["SOFT",softRad>0?`${softRad}px`:"OFF"],["MORPH",morphAmt?`${morphAmt>0?"EXP":"CON"} ${Math.abs(morphAmt)}px`:"—"],["CROP T",`${crop.top}%`],["CROP B",`${crop.bottom}%`],["CROP L",`${crop.left}%`],["CROP R",`${crop.right}%`]].map(([k,v])=>(<div key={k} style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#666",fontSize:10}}>{k}</span><span style={{color:"#bbb",fontSize:10,fontWeight:"bold"}}>{v}</span></div>))}
      <div style={{marginTop:"auto",fontSize:9,color:"#2a2a2a",lineHeight:1.8}}>Project Méliès<br/>v0.5 — Capture Hour</div>
    </div>
  );
}
