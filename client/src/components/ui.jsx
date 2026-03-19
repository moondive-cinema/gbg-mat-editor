import { useState, useRef } from 'react';
import { THEME } from '../constants';
import { hexToRgb } from '../utils/colorUtils';

/** Tooltip wrapper — display:contents so no layout impact. */
export function Tip({label,children}){
  const [show,setShow]=useState(false);
  const [pos,setPos]=useState({x:0,y:0});
  return(
    <div style={{display:"contents"}}
      onMouseEnter={()=>setShow(true)}
      onMouseLeave={()=>setShow(false)}
      onMouseMove={e=>setPos({x:e.clientX,y:e.clientY})}>
      {children}
      {show&&<div style={{position:"fixed",left:pos.x+14,top:pos.y-32,background:"#1e1e1e",border:"1px solid #3a3a3a",borderRadius:3,padding:"3px 8px",fontSize:9,color:"#aaa",pointerEvents:"none",whiteSpace:"nowrap",zIndex:999,letterSpacing:1}}>{label}</div>}
    </div>
  );
}

/** File open button with hidden input. */
export function FBtn({label,onChange,active}){
  const ref=useRef();
  return(
    <>
      <button onClick={()=>ref.current.click()} style={{padding:"6px 14px",background:active?THEME+"22":"#1a1a1a",border:`1px solid ${active?THEME+"66":"#2a2a2a"}`,borderRadius:4,color:active?THEME:"#666",fontFamily:"inherit",fontSize:12,cursor:"pointer",fontWeight:active?"bold":"normal"}}>{active?"✓ ":""}{label}</button>
      <input ref={ref} id="fileInput" type="file" accept="image/jpeg,image/png,image/tiff,.tif,.tiff,video/mp4,video/quicktime,video/webm,.mov,.mp4,.webm" onChange={onChange} style={{display:"none"}}/>
    </>
  );
}

/** Section wrapper with label. */
export function Sec({label,children}){return(<div style={{borderBottom:"1px solid #1e1e1e",padding:"9px 11px"}}><div style={{color:"#888",fontSize:9,letterSpacing:2,marginBottom:7}}>{label}</div>{children}</div>);}

/** Tool toggle button. */
export function TBtn({active,onClick,children}){return(<button onClick={onClick} style={{flex:1,padding:"6px 0",background:active?THEME:"#1a1a1a",border:`1px solid ${active?THEME:"#333"}`,borderRadius:3,color:active?"#111":"#bbb",fontFamily:"inherit",fontSize:11,cursor:"pointer",fontWeight:active?"bold":"normal"}}>{children}</button>);}

/** Mode button (keep/kill). */
export function MBtn({active,color,onClick,children}){return(<button onClick={onClick} style={{flex:1,padding:"7px 0",background:active?`${color}22`:"#1a1a1a",border:`1.5px solid ${active?color:"#333"}`,borderRadius:3,color:active?color:"#aaa",fontFamily:"inherit",fontSize:11,cursor:"pointer",fontWeight:active?"bold":"normal",letterSpacing:0.5}}>{children}</button>);}

/** Range slider with label. */
export function Sld({label,value,min,max,step,unit,onChange,onStart}){return(<div style={{marginBottom:7}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{color:"#aaa",fontSize:10}}>{label}</span><span style={{color:THEME,fontSize:10}}>{value}{unit}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)} onPointerDown={onStart} style={{width:"100%",accentColor:THEME}}/></div>);}

/** Generic button. */
export function Btn({onClick,children}){return(<button onClick={onClick} style={{width:"100%",padding:"5px 0",marginTop:5,background:"#1a1a1a",border:"1px solid #333",borderRadius:3,color:"#aaa",fontFamily:"inherit",fontSize:10,cursor:"pointer"}}>{children}</button>);}

/** Crop line overlay. */
export function CL({side,v}){
  const rgb=hexToRgb(THEME).join(',');
  const s={position:"absolute",background:`rgba(${rgb},0.07)`,borderColor:`rgba(${rgb},0.55)`,borderStyle:"dashed",borderWidth:0,pointerEvents:"none"};
  if(side==="top"){s.top=0;s.left=0;s.right=0;s.height=`${v}%`;s.borderBottomWidth=1;}
  if(side==="bottom"){s.bottom=0;s.left=0;s.right=0;s.height=`${v}%`;s.borderTopWidth=1;}
  if(side==="left"){s.left=0;s.top=0;s.bottom=0;s.width=`${v}%`;s.borderRightWidth=1;}
  if(side==="right"){s.right=0;s.top=0;s.bottom=0;s.width=`${v}%`;s.borderLeftWidth=1;}
  return <div style={s}/>;
}

/** Shared style constants. */
export const cS={flex:1,padding:"7px 0",background:"#1a1a1a",border:"1px solid",borderRadius:3,fontFamily:"inherit",fontSize:10,cursor:"pointer",fontWeight:"bold",letterSpacing:0.5};
export const zS={flex:1,padding:"5px 0",background:"#1a1a1a",border:"1px solid #333",borderRadius:3,color:"#bbb",fontFamily:"inherit",fontSize:14,cursor:"pointer",fontWeight:"bold"};
export const iS={padding:"4px 6px",background:"#111",border:"1px solid #2a2a2a",borderRadius:3,color:"#ccc",fontFamily:"inherit",fontSize:11,outline:"none"};
