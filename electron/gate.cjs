const SHARED=['pgm','pgmMat','boardSkin','pattern','eyeCare','ink','studentTools','inkOptions','drawAuthor','selectedInk','curtain','spotlight','takeAt','sim','tool','color','size','objKind','revealed','answerGuard','warm','subject','desk','deskLimit','slideSteps'];
const clone=v=>JSON.parse(JSON.stringify(v));
// 学生画面里打开着的各项（当前项 + 桌面上的窗口）：笔迹都要同步过去
const deskIds=state=>new Set([state.pgmMat?.id,...(Array.isArray(state.desk)?state.desk:[]).map(w=>w&&w.id)].filter(x=>typeof x==='string'));
const num=(v,lo,hi,d)=>Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):d;
/** 桌面窗口列表：老师可以开新项；学生只能挪动 / 收起 / 关闭已经打开的项，课件内容一律以现有状态为准 */
function cleanDesk(desk,state,trusted){
 if(!Array.isArray(desk))return null;const old=new Map((Array.isArray(state.desk)?state.desk:[]).map(w=>[w.id,w]));if(state.pgmMat)old.set(state.pgmMat.id,{...old.get(state.pgmMat.id),id:state.pgmMat.id,mat:state.pgmMat,view:state.pgm});
 const seen=new Set(),out=[];
 for(const w of desk.slice(0,500)){
  if(!w||typeof w.id!=='string'||w.id.length>500||seen.has(w.id))continue;const was=old.get(w.id);if(!trusted&&!was)continue;
  const mat=trusted?w.mat:was.mat;if(!mat||mat.id!==w.id)continue;seen.add(w.id);
  const r=Array.isArray(w.rect)?w.rect:[];const rect=[num(r[0],-0.9,0.95,0.2),num(r[1],-0.05,0.95,0.1),num(r[2],0.08,1,0.56),num(r[3],0.08,1,0.6)];
  const view=w.view&&w.view.materialId===w.id?w.view:was?.view;
  out.push({id:w.id,mat,view,rect,mode:['max','normal','min'].includes(w.mode)?w.mode:'max',...(['max','normal'].includes(w.prev)?{prev:w.prev}:{}),z:num(w.z,0,1e9,0),at:num(w.at,0,1e15,0),...(trusted?(w.sim?{sim:w.sim}:{}):(was?.sim?{sim:was.sim}:{}))});
 }
 return out;
}
function projection(state={}){const out=Object.fromEntries(SHARED.filter(k=>k in state).map(k=>[k,state[k]]));const ids=deskIds(state);out.ink=Object.fromEntries(Object.entries(state.ink??{}).filter(([k])=>ids.has(k.slice(0,k.lastIndexOf('#')))).map(([k,v])=>[k,v.filter(s=>s.layer!=='private')]));return clone(out);}
function validStroke(s){return s&&typeof s.id==='string'&&s.id.length<200&&typeof s.tool==='string'&&Array.isArray(s.pts)&&s.pts.length<90000&&s.pts.every(Number.isFinite)&&Number.isFinite(s.size)&&typeof s.color==='string'&&s.layer!=='private';}
function authorizeMessage(role,m,state){
 if(!m||typeof m!=='object'||JSON.stringify(m).length>20*1024*1024)return null;
 const trusted=role==='teacher'||role==='dock',current=`${state.pgm?.materialId}#${state.pgm?.page}`;
 if(m.t==='hello')return {t:'hello',from:String(m.from).slice(0,120)};
 if(m.t==='cmd')return trusted&&typeof m.name==='string'&&/^[a-z][\w.]{0,40}$/i.test(m.name)&&JSON.stringify(m.arg??null).length<20000?{t:'cmd',name:m.name,arg:m.arg??null}:null;
 if(m.t==='snapshot')return role==='teacher'?{t:'snapshot',to:String(m.to),shared:projection(m.shared)}:null;
 if(m.t==='shared'){
  // 学生工具栏开放时，学生和老师一样可以翻页、切换 / 摆放窗口、放大、聚光灯和幕布；不能开新课件
  const keys=trusted?SHARED:state.drawAuthor==='teacher'||state.studentTools==='open'?['selectedInk','pgm','pgmMat','desk','sim','curtain','spotlight','objKind','inkOptions','slideSteps']:['selectedInk'];
  const patch=Object.fromEntries(Object.entries(m.patch??{}).filter(([k])=>keys.includes(k)));
  // 学生端工具栏开放时，学生点工具即「接过笔」；只能把书写权交给自己，不能交还或冒充老师
  if(!trusted&&state.studentTools==='open'&&m.patch?.drawAuthor==='student')patch.drawAuthor='student';
  if(patch.desk!==undefined){patch.desk=cleanDesk(patch.desk,state,trusted);if(!patch.desk)delete patch.desk;}
  if(!trusted&&patch.objKind!==undefined&&(typeof patch.objKind!=='string'||patch.objKind.length>60))delete patch.objKind;
  if(!trusted&&patch.inkOptions!==undefined){const o=patch.inkOptions||{},was=state.inkOptions||{};patch.inkOptions={...was,eraserMode:o.eraserMode==='stroke'?'stroke':'segment',eraserSize:['s','m','l'].includes(o.eraserSize)?o.eraserSize:(was.eraserSize??'m'),shapeSnap:o.shapeSnap!==false};}
  if(patch.deskLimit!==undefined)patch.deskLimit=num(Math.round(patch.deskLimit),0,999,10);
  if(patch.slideSteps!==undefined)patch.slideSteps=patch.slideSteps!==false;
  // 学生只能切到桌面上已经打开的项，课件内容用现有的那份
  if(!trusted&&patch.pgmMat){const id=patch.pgmMat.id,w=id===state.pgmMat?.id?{mat:state.pgmMat}:(Array.isArray(state.desk)?state.desk:[]).find(x=>x&&x.id===id);if(w?.mat)patch.pgmMat=w.mat;else{delete patch.pgmMat;delete patch.pgm;delete patch.sim;delete patch.desk;}}
  const matId=(patch.pgmMat??state.pgmMat)?.id;
  if(!trusted&&patch.pgm&&patch.pgm.materialId!==matId)delete patch.pgm;
  if(patch.sim&&(!trusted&&patch.sim.matId!==matId||!Number.isFinite(patch.sim.offset)||!Number.isFinite(patch.sim.rate)||patch.sim.rate<=0||!Number.isFinite(patch.sim.startedAt)||Object.values(patch.sim.params??{}).some(v=>!Number.isFinite(v))))delete patch.sim;
  if(patch.revealed!==undefined)patch.revealed=Array.isArray(patch.revealed)?patch.revealed.filter(x=>typeof x==='string'&&x.length<300).slice(-300):[];
  if(patch.answerGuard!==undefined)patch.answerGuard=patch.answerGuard!==false;
  if(patch.warm!==undefined)patch.warm=(Array.isArray(patch.warm)?patch.warm:[]).filter(x=>x&&typeof x.path==='string'&&x.path.length<1000&&!/^https?:/i.test(x.path)).slice(0,4).map(x=>({path:x.path,title:String(x.title||'').slice(0,120)}));
  if(patch.ink)patch.ink=projection({...state,...patch}).ink;
  if(patch.selectedInk){const ids=new Set((state.ink?.[current]??[]).filter(s=>s.layer!=='private'&&(trusted||state.drawAuthor==='teacher'||s.author==='student')).map(s=>s.id));patch.selectedInk={key:current,ids:(patch.selectedInk.ids??[]).filter(id=>ids.has(id))};}
  return Object.keys(patch).length?{t:'shared',patch}:null;
 }
 if(!trusted&&(m.key!==current||(state.drawAuthor==='student'&&state.studentTools!=='open')))return null;
 const actor=trusted?(m.actor??m.author??'teacher'):state.drawAuthor??'student';
 const canEdit=s=>s.layer!=='private'&&(trusted||actor==='teacher'||s.author==='student');
 // 实时笔迹每帧都要过这里，用不到这份名单：按需再建，不必每帧扫一遍整页笔迹
 let ids=null;const allowed={has:id=>(ids??=new Set((state.ink?.[m.key]??[]).filter(canEdit).map(s=>s.id))).has(id)};
 // 学生窗口贴的图只能是软件自己存下的本地图片（lesson:// 地址），不能让老师那边去加载外部网址
 const clean=s=>{if(!validStroke(s))return null;if(!trusted&&s.img!==undefined&&(typeof s.img!=='string'||!/^lesson:\/\/[0-9a-f]{20,}\//.test(s.img)))return null;return {...s,author:trusted?s.author:actor,layer:'public'};};
 if(m.t==='edit')return {t:'edit',key:m.key,remove:(m.remove??[]).filter(id=>allowed.has(id)),upsert:(m.upsert??[]).map(clean).filter(Boolean),actor,...(trusted&&Array.isArray(m.order)?{order:m.order.filter(x=>typeof x==='string')}: {})};
 if(m.t==='stroke'){const stroke=clean(m.stroke);return stroke?{t:'stroke',key:m.key,stroke}:null;}
 if(m.t==='erase')return {t:'erase',key:m.key,ids:(m.ids??[]).filter(id=>allowed.has(id))};
 if(m.t==='clear')return {t:'erase',key:m.key,ids:(state.ink?.[m.key]??[]).filter(s=>canEdit(s)&&(!m.author||s.author===m.author)).map(s=>s.id)};
 if(m.t==='history')return {t:'history',key:m.key,actor:trusted?m.actor:actor,redo:!!m.redo};
 if(m.t==='live')return {t:'live',key:m.key,from:String(m.from),stroke:m.stroke?clean(m.stroke):null};
 if(m.t==='laser'&&Array.isArray(m.pts)&&m.pts.length===2&&m.pts.every(Number.isFinite))return {t:'laser',key:m.key,from:String(m.from),pts:m.pts};
 return null;
}
function applyMessage(state,m){
 if(m.t==='shared'){const ink=m.patch.ink;Object.assign(state,m.patch);if(ink)state.ink=ink;}
 if(m.t==='edit'||m.t==='stroke'||m.t==='erase'){
  const removed=new Set(m.remove??m.ids??[]),updates=new Map((m.upsert??(m.stroke?[m.stroke]:[])).map(s=>[s.id,s]));
  const next=(state.ink?.[m.key]??[]).filter(s=>!removed.has(s.id)||updates.has(s.id)).map(s=>{const x=updates.get(s.id);updates.delete(s.id);return x??s;});next.push(...updates.values());if(m.order){const rank=new Map(m.order.map((id,i)=>[id,i]));next.sort((a,b)=>(rank.get(a.id)??1e9)-(rank.get(b.id)??1e9));}state.ink={...state.ink,[m.key]:next};
 }
 return state;
}
module.exports={SHARED,projection,authorizeMessage,applyMessage};
