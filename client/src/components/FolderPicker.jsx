import { THEME } from '../constants';

export function FolderPicker({pickerData, browseTo, selectDir, onClose}){
  if(!pickerData) return null;
  return(
    <div style={{position:"fixed",top:58,right:220,
      width:280,maxHeight:320,overflowY:"auto",
      background:"#1a1a1a",border:"1px solid "+THEME,borderRadius:5,
      zIndex:1000,boxShadow:"0 4px 20px rgba(0,0,0,0.6)",padding:6}}>
      <div style={{fontSize:9,color:"#666",padding:"2px 4px 6px",borderBottom:"1px solid #2a2a2a",marginBottom:4,wordBreak:"break-all"}}>
        {pickerData.current}
      </div>
      {pickerData.parent&&
        <div onClick={()=>browseTo(pickerData.parent)}
          style={{padding:"5px 8px",cursor:"pointer",color:"#888",fontSize:11,borderRadius:3}}
          onMouseEnter={e=>e.target.style.background="#252525"}
          onMouseLeave={e=>e.target.style.background="transparent"}>
          ↑ ..
        </div>
      }
      {pickerData.entries.map(e=>(
        <div key={e.path} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 8px",borderRadius:3,cursor:"pointer"}}
          onMouseEnter={ev=>ev.currentTarget.style.background="#252525"}
          onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
          <span onClick={()=>browseTo(e.path)} style={{flex:1,fontSize:11,color:"#ccc",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            📁 {e.name}
          </span>
          <button onClick={()=>selectDir(e.path)}
            style={{marginLeft:6,padding:"2px 6px",background:THEME+"22",border:"1px solid "+THEME,borderRadius:3,color:THEME,fontSize:9,cursor:"pointer",flexShrink:0}}>
            선택
          </button>
        </div>
      ))}
      {pickerData.entries.length===0&&
        <div style={{fontSize:10,color:"#555",padding:"8px",textAlign:"center"}}>하위 폴더 없음</div>
      }
      <div style={{borderTop:"1px solid #2a2a2a",marginTop:4,paddingTop:6,display:"flex",justifyContent:"space-between",gap:4}}>
        <button onClick={()=>selectDir(pickerData.current)}
          style={{flex:1,padding:"5px 0",background:THEME,color:"#111",border:"none",borderRadius:3,fontWeight:"bold",fontSize:11,cursor:"pointer"}}>
          현재 폴더 선택
        </button>
        <button onClick={onClose}
          style={{padding:"5px 10px",background:"#111",border:"1px solid #333",borderRadius:3,color:"#888",fontSize:11,cursor:"pointer"}}>
          닫기
        </button>
      </div>
    </div>
  );
}
