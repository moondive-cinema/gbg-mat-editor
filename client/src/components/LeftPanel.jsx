import { THEME, KEEP, KILL } from '../constants';
import { hexToRgb } from '../utils/colorUtils';
import { Tip, Sec, TBtn, MBtn, Sld, Btn, cS } from './ui';

export function LeftPanel({
  hCount, undo, redo,
  tool, setTool, brushColor, setBC, brushSize, setBS,
  onAllKeep, onAllKill,
  crop, onCrop, onResetCrop,
  morphAmt, setMorphAmt, commitMorph, isReady,
  featherRad, onFeather, softRad, onSoftRad,
  saveHistory,
}){
  return(
    <div style={{width:222,minWidth:222,background:"#161616",borderRight:"1px solid #222",display:"flex",flexDirection:"column",overflowY:"auto"}}>
      <Sec label="HISTORY">
        <div style={{display:"flex",gap:6}}>
          <Tip label="Ctrl+Z"><button onClick={undo} disabled={hCount.u===0} style={{...cS,borderColor:"#3a3a3a",color:hCount.u>0?"#ccc":"#444"}}>↩ UNDO</button></Tip>
          <Tip label="Ctrl+Shift+Z"><button onClick={redo} disabled={hCount.r===0} style={{...cS,borderColor:"#3a3a3a",color:hCount.r>0?"#ccc":"#444"}}>↪ REDO</button></Tip>
        </div>
      </Sec>
      <Sec label="TOOL">
        <div style={{display:"flex",gap:6}}>
          <Tip label="B"><TBtn active={tool==="brush"} onClick={()=>setTool("brush")}>✏ BRUSH</TBtn></Tip>
          <Tip label="C"><TBtn active={tool==="crop"} onClick={()=>setTool("crop")}>⊡ CROP</TBtn></Tip>
        </div>
      </Sec>
      <Sec label="CANVAS">
        <div style={{display:"flex",gap:6}}>
          <button onClick={onAllKeep} style={{...cS,borderColor:KEEP+"44",color:KEEP}}>ALL KEEP</button>
          <button onClick={onAllKill} style={{...cS,borderColor:KILL+"44",color:KILL}}>ALL KILL</button>
        </div>
        <div style={{color:"#555",fontSize:9,marginTop:4}}>※ Raw mask에 영구 적용</div>
      </Sec>
      {tool==="brush"&&
        <Sec label="BRUSH">
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            <Tip label="X"><MBtn active={brushColor==="keep"} color={KEEP} onClick={()=>setBC("keep")}>KEEP</MBtn></Tip>
            <Tip label="X"><MBtn active={brushColor==="kill"} color={KILL} onClick={()=>setBC("kill")}>KILL</MBtn></Tip>
          </div>
          <Sld label="SIZE  [ ]" value={brushSize} min={5} max={200} step={5} unit="px" onChange={setBS}/>
        </Sec>
      }
      {tool==="crop"&&<Sec label="CROP (%)">{["top","bottom","left","right"].map(k=>(<Sld key={k} label={k.toUpperCase()} value={crop[k]} min={0} max={50} step={0.5} unit="%" onChange={v=>onCrop(k,v)} onStart={saveHistory}/>))}<Btn onClick={onResetCrop}>RESET CROP</Btn></Sec>}
      <div style={{borderTop:"1px solid #222",margin:"2px 0"}}/>
      <Sec label="① EXPAND / CONTRACT">
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{color:morphAmt<0?KILL:morphAmt>0?KEEP:"#aaa",fontSize:10}}>{morphAmt<0?`CONTRACT ${Math.abs(morphAmt)}px`:morphAmt>0?`EXPAND ${morphAmt}px`:"NO CHANGE"}</span><span style={{color:"#aaa",fontSize:10}}>{morphAmt}px</span></div>
        <input type="range" min={-60} max={60} step={1} value={morphAmt} onChange={e=>setMorphAmt(+e.target.value)} style={{width:"100%",accentColor:THEME,marginBottom:4}}/>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{color:"#666",fontSize:9}}>← CONTRACT</span><span style={{color:"#666",fontSize:9}}>EXPAND →</span></div>
        <button onClick={commitMorph} disabled={!isReady||!morphAmt} style={{width:"100%",padding:"5px 0",background:morphAmt&&isReady?THEME+"22":"#1a1a1a",border:`1px solid ${morphAmt&&isReady?THEME:"#2a2a2a"}`,borderRadius:3,color:morphAmt&&isReady?THEME:"#555",fontFamily:"inherit",fontSize:11,cursor:morphAmt&&isReady?"pointer":"not-allowed"}}>APPLY TO MASK</button>
        <div style={{color:"#666",fontSize:9,marginTop:4}}>※ Raw mask에 영구 적용</div>
      </Sec>
      <Sec label="② ROUND EDGE"><Sld label="RADIUS" value={featherRad} min={0} max={80} step={1} unit="px" onChange={onFeather}/>{featherRad>0&&<div style={{fontSize:9,color:"#888",marginTop:2}}>경계 모서리 둥글게</div>}</Sec>
      <Sec label="③ SOFT EDGE"><Sld label="RADIUS" value={softRad} min={0} max={60} step={1} unit="px" onChange={onSoftRad}/>{softRad>0&&<div style={{fontSize:9,color:"#888",marginTop:2}}>경계면 양방향 블러</div>}</Sec>
      <Sec label="LEGEND">
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><div style={{width:13,height:13,background:`rgba(${hexToRgb(KEEP).join(',')},0.3)`,borderRadius:2,border:`1px solid ${KEEP}`}}/><span style={{color:"#aaa",fontSize:10}}>KEEP</span></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:13,height:13,background:`rgba(${hexToRgb(KILL).join(',')},0.3)`,borderRadius:2,border:`1px solid ${KILL}`}}/><span style={{color:"#aaa",fontSize:10}}>KILL</span></div>
      </Sec>
    </div>
  );
}
