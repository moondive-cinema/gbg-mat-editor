import { THEME, KEEP, KILL, WATCH_ENABLED } from '../constants';
import { Tip, FBtn, iS } from './ui';
import { FolderPicker } from './FolderPicker';

export function Toolbar({
  streamActive, liveView, imageSource, camDevices, selectedCam,
  loaded, gen, watchActive, setWatchActive, log, isReady,
  projectName, setProjectName, outputDir, setOutputDir,
  pickerOpen, pickerData,
  captureFrame, startLiveView, handleToggleStream, switchCamera,
  handleMedia, handleGenerateMask, handleReset, handleExport,
  handlePickDir, browseTo, selectDir, setPickerOpen, persistConfig,
}){
  return(
    <div style={{background:"#1a1a1a",borderBottom:"1px solid #2a2a2a",padding:"7px 14px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      <span style={{color:THEME,fontWeight:"bold",letterSpacing:2,fontSize:13,whiteSpace:"nowrap"}}>▶ MATTE EDITOR</span>

      {/* VIDEO STREAM / ⊙ CAPTURE — single smart button */}
      {(()=>{
        const isCapture=streamActive&&liveView;
        const isActive=imageSource==='stream'&&!liveView;
        const col=isCapture?KEEP:isActive?THEME:'#ccc';
        const bg=isCapture?KEEP+"22":isActive?THEME+"22":"#222";
        const bd=isCapture?KEEP+"66":isActive?THEME+"66":"#3a3a3a";
        return(
          <button onClick={streamActive&&liveView?captureFrame:streamActive?()=>startLiveView():handleToggleStream}
            style={{padding:"6px 14px",fontFamily:"inherit",fontSize:12,fontWeight:"bold",
              background:bg,border:`1px solid ${bd}`,borderRadius:4,color:col,
              cursor:"pointer",whiteSpace:"nowrap"}}>
            {streamActive&&liveView?"⊙ CAPTURE":"📷 VIDEO STREAM"}
          </button>
        );
      })()}
      {streamActive&&camDevices.length>1&&
        <select value={selectedCam} onChange={e=>switchCamera(e.target.value)}
          style={{padding:"4px 6px",background:"#111",border:"1px solid #2a2a2a",borderRadius:3,
            color:"#ccc",fontFamily:"inherit",fontSize:10,outline:"none",maxWidth:130}}>
          {camDevices.map(d=>(
            <option key={d.deviceId} value={d.deviceId}>
              {d.label||`Camera ${camDevices.indexOf(d)+1}`}
            </option>
          ))}
        </select>
      }

      <Tip label="Ctrl+O"><FBtn label="📁 OPEN MEDIA" onChange={handleMedia} active={imageSource==='file'}/></Tip>
      <Tip label="Ctrl+G">
        <button onClick={handleGenerateMask} disabled={!loaded.img||gen}
          style={{padding:"6px 14px",fontFamily:"inherit",fontSize:12,fontWeight:"bold",
            background:loaded.img&&!gen?THEME+"22":"#1a1a1a",
            border:`1px solid ${loaded.img&&!gen?THEME+"66":"#2a2a2a"}`,
            borderRadius:4,color:loaded.img&&!gen?THEME:"#444",
            cursor:loaded.img&&!gen?"pointer":"not-allowed",whiteSpace:"nowrap"}}>
          {gen?"⏳ AI 생성 중…":"✦ AI MASK"}
        </button>
      </Tip>
      {WATCH_ENABLED&&
        <button onClick={()=>setWatchActive(v=>!v)}
          style={{padding:"5px 10px",fontFamily:"inherit",fontSize:10,
            background:watchActive?THEME+"22":"#1a1a1a",
            border:`1px solid ${watchActive?THEME+"66":"#333"}`,
            borderRadius:4,color:watchActive?THEME:"#888",cursor:"pointer",whiteSpace:"nowrap"}}>
          {watchActive?"👁 감시 중":"👁 감시 중단"}
        </button>
      }
      <button onClick={handleReset}
        style={{padding:"5px 9px",background:"#1a1a1a",border:"1px solid #333",
          borderRadius:4,color:"#888",fontFamily:"inherit",fontSize:11,cursor:"pointer"}}>
        ⟳ NEW
      </button>

      {/* 로그 */}
      <span style={{color:log.includes('실패')||log.includes('로드해주세요')?KILL:THEME,
        fontSize:11,flex:1,marginLeft:4,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {log}
      </span>

      {/* ── SAVE CONFIG + SAVE 버튼 묶음 ── */}
      <div style={{display:"flex",alignItems:"center",gap:6,borderLeft:"1px solid #2a2a2a",paddingLeft:10}}>
        {/* 프로젝트명 */}
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          <span style={{color:"#555",fontSize:8,letterSpacing:1}}>PROJECT</span>
          <input style={{...iS,width:100}} value={projectName} placeholder="project_name"
            onChange={e=>setProjectName(e.target.value)}
            onBlur={e=>persistConfig(e.target.value,outputDir)}/>
        </div>

        {/* 저장 폴더 */}
        <div style={{display:"flex",flexDirection:"column",gap:2,position:"relative"}}>
          <span style={{color:"#555",fontSize:8,letterSpacing:1}}>OUTPUT DIR</span>
          <div style={{display:"flex",gap:4,alignItems:"center"}}>
            <input style={{...iS,width:160}} value={outputDir} placeholder="output path"
              onChange={e=>setOutputDir(e.target.value)}
              onBlur={e=>persistConfig(projectName,e.target.value)}/>
            <button onClick={handlePickDir}
              style={{padding:"4px 7px",background:pickerOpen?THEME+"22":"#1a1a1a",
                border:"1px solid "+(pickerOpen?THEME:"#333"),
                borderRadius:3,color:pickerOpen?THEME:"#aaa",fontFamily:"inherit",
                fontSize:12,cursor:"pointer"}}>
              📁
            </button>
          </div>
          {pickerOpen&&<FolderPicker pickerData={pickerData} browseTo={browseTo} selectDir={selectDir} onClose={()=>setPickerOpen(false)}/>}
        </div>

        {/* SAVE 버튼 */}
        <Tip label="Ctrl+S">
          <button onClick={handleExport} disabled={!isReady}
            style={{padding:"6px 16px",background:isReady?THEME:"#1e1e1e",
              color:isReady?"#111":"#444",border:"none",borderRadius:4,
              fontFamily:"inherit",fontWeight:"bold",fontSize:12,
              cursor:isReady?"pointer":"not-allowed",letterSpacing:1,
              whiteSpace:"nowrap",alignSelf:"flex-end",marginBottom:0}}>
            ↓ SAVE
          </button>
        </Tip>
      </div>
    </div>
  );
}
