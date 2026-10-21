import { create } from 'zustand';
import { bus, WINDOW_ID } from './bus';
import { boardMaterial } from './library';
import {STUDENTS,SLOTS} from './mock';
import { host } from './host';
import type { Author, Material, Stroke, Tool, View, Student, LessonSlot, ChapterState, AnswerMark, DeskWin } from './types';
import { BASE, DEFAULT_LIMIT, cascade, deskIds, matOfKey, syncDesk, tileDesk, tileIds, topZ, trimDesk } from './desk';
import { studentSubject, type SubjectId } from './subjects';
import type { SimSync } from '../physics/model';
import { SCREEN, grownFor, isLong, longMaterial, scrollView } from './longBoard';

const W = new URLSearchParams(location.search).get('w');
export const ROLE = host.role ?? (W === 'student' ? 'student' : W === 'dock' ? 'dock' : 'teacher');
export type Skin = 'graphite' | 'midnight' | 'paper' | 'contrast';
import type { BoardSkin } from './palette';
export type { BoardSkin };
export { PEN_COLORS, STUDENT_COLOR, DARK_BOARDS, resolveColor } from './palette';
export type Pattern = 'none' | 'grid' | 'dots' | 'lines' | 'coord' | 'four' | 'tian';
export type Page = 'console' | 'schedule' | 'students' | 'study' | 'agents' | 'auto' | 'replay' | 'plugins';
export interface Shared {
  pgm: View; pgmMat: Material; boardSkin: BoardSkin; pattern: Pattern; eyeCare: number;
  ink: Record<string, Stroke[]>; studentTools: 'open' | 'locked' | 'hidden';
  inkOptions: { eraserMode:'stroke'|'segment'; eraserSize?:'s'|'m'|'l'; eraserV?:number; shapeSnap:boolean };
  drawAuthor: 'teacher' | 'student'; selectedInk: {key:string; ids:string[]} | null;
  curtain: number | null; spotlight: {x:number;y:number;r:number} | null; takeAt: number;
  sim: SimSync | null; tool: Tool; color: string; size: number; objKind: string;
  revealed: string[];   // 已向学生揭晓的答案页：materialId#page
  answerGuard: boolean; // 关闭后答案页不再对学生遮挡
  warm: {path:string;title:string}[]; // 学生窗口提前在后台加载的本地网页课件（课前检查通过的）
  subject: SubjectId; // 当前学生的学科：浮层等其它窗口靠它隐藏物理专属功能（students/studentId 是本地键，不同步）
  desk: DeskWin[];    // 学生画面里打开着的各项（黑板垫底），各自记住页码；当前项 = pgmMat
  deskLimit: number;  // 同时打开的课件上限（不含黑板），0 不限
}
interface Local {
  students:Student[]; slots:LessonSlot[]; learning:Record<string,ChapterState[][]>;
  skin: Skin; motion: boolean; page: Page; libraryOpen: boolean; rightOpen: boolean;
  libraryW: number; rightW: number; pinned: string[]; recents: string[]; favorites: string[]; expanded: string[];
  pvw: {mat:Material;view:View} | null; reader: {mat:Material;view:View;split:Material|null};
  notes: Record<string,string>; studentId: string; rec: {on:boolean;start:number};
  aiOpen: boolean; skinsOpen: boolean; paletteOpen: boolean; roots: string[]; saveError: string | null;
  answerMarks: Record<string, number[] | AnswerMark>;   // 文件路径 → 老师确认过的答案页（旧版只存页码）
  answerAutoDetect: boolean;   // 打开 PDF / PPT 时按文字自动识别答案页
  freeSubject: SubjectId;      // 自由课堂（不绑学生）用的学科，记住老师上次选的
}
export interface InkChange { remove?: string[]; upsert?: Stroke[]; order?: string[] }
interface HistoryEntry { before: Stroke[]; after: Stroke[]; beforeOrder?:string[]; afterOrder?:string[] }
type Histories = Record<string, {undo: HistoryEntry[]; redo: HistoryEntry[]}>;
interface Actions {
  set: (p:Partial<Shared&Local>)=>void; setShared:(p:Partial<Shared>)=>void;
  addStroke:(key:string,s:Stroke,broadcast?:boolean)=>void;
  editInk:(key:string,changes:InkChange,actor?:Author)=>void;
  erase:(key:string,ids:string[],broadcast?:boolean)=>void;
  clearInk:(key:string,author?:string,broadcast?:boolean)=>void;
  undo:(key:string,author:string)=>void; redo:(key:string,author:string)=>void;
  open:(mat:Material,page?:number)=>void; cue:(mat:Material,view?:Partial<View>)=>void;
  take:()=>void; showNow:(mat:Material,view?:Partial<View>)=>void; pgmTo:(p:Partial<View>)=>void; touch:(id:string)=>void;
  /** 切到学生画面里已打开的一项（回到它原来的页码） */
  focusWin:(id:string)=>void;
  /** 改窗口的位置 / 样子（占满、浮动、收起） */
  setWin:(id:string,p:Partial<Pick<DeskWin,'rect'|'mode'>>)=>void;
  closeWin:(id:string)=>void;
  /** 再开一块黑板 */
  newBoard:()=>void;
  /** 开一块长黑板（一整条往下写） */
  newLongBoard:()=>void;
  /** 当前项和最近用过的课件并排摆开 */
  tileWins:()=>void;
}
export type State=Shared&Local&Actions;
export const inkKey=(materialId:string,page:number)=>`${materialId}#${page}`;
export const defaultView=(mat:Material,p:Partial<View>={}):View=>({materialId:mat.id,page:0,slide:0,fit:mat.kind==='board'?'page':mat.pages.some(x=>(x.slides?.length??0)>1)?'slides':mat.pages[0]?.h>mat.pages[0]?.w?'width':'page',zoom:1,...(isLong(mat)?{y:0}:{}),...p});
export const SHARED_KEYS:(keyof Shared)[]=['pgm','pgmMat','boardSkin','pattern','eyeCare','ink','studentTools','inkOptions','drawAuthor','selectedInk','curtain','spotlight','takeAt','sim','tool','color','size','objKind','revealed','answerGuard','warm','subject','desk','deskLimit'];
const LOCAL_KEYS:(keyof Local)[]=['students','slots','learning','skin','motion','libraryOpen','rightOpen','libraryW','rightW','pinned','recents','favorites','expanded','notes','studentId','roots','reader','pvw','answerMarks','answerAutoDetect','freeSubject'];
const board=boardMaterial();
// contextBridge 传进来的对象不可扩展：撤销记录等要原地修改的数据必须先深拷贝，否则第一次在新页面书写就抛错
const stored = (()=>{if(host.electron)return host.initial?JSON.parse(JSON.stringify(host.initial)):{};if(ROLE!=='teacher')return {};try{return JSON.parse(localStorage.getItem('cs.v2.teacher')||'{}');}catch{return {};}})();
const history:Histories=ROLE==='teacher'?(stored.history as Histories??{}):{};
const sharedInit:Shared={pgm:defaultView(board),pgmMat:board,boardSkin:'ivory',pattern:'grid',eyeCare:0,ink:{},studentTools:'open',inkOptions:{eraserMode:'segment',eraserSize:'m',eraserV:2,shapeSnap:true},drawAuthor:'teacher',selectedInk:null,curtain:null,spotlight:null,takeAt:0,sim:null,tool:'pen',color:'ink',size:3,objKind:'block',revealed:[],answerGuard:true,warm:[],subject:'physics',desk:[],deskLimit:DEFAULT_LIMIT,...stored.shared};
if(!Array.isArray(sharedInit.desk))sharedInit.desk=[];
if(!Number.isFinite(sharedInit.deskLimit))sharedInit.deskLimit=DEFAULT_LIMIT;
// A restarted simulation resumes paused; no hidden elapsed-time jump.
if(sharedInit.sim)sharedInit.sim={...sharedInit.sim,playing:false};
// 0.8.1 起橡皮默认局部擦除（像真橡皮）；旧存档里的整笔擦除是当时的默认值，不是老师选的
if(!sharedInit.inkOptions.eraserV)sharedInit.inkOptions={...sharedInit.inkOptions,eraserMode:'segment',eraserSize:'m',eraserV:2};
const localInit:Local={students:host.electron?[]:STUDENTS,slots:host.electron?[]:SLOTS,learning:{},skin:'graphite',motion:true,page:'console',libraryOpen:true,rightOpen:true,libraryW:300,rightW:340,pinned:[],recents:[],favorites:[],expanded:[],pvw:null,reader:{mat:board,view:defaultView(board),split:null},notes:{},studentId:host.electron?'free':'junyu',rec:{on:false,start:0},aiOpen:false,skinsOpen:false,paletteOpen:false,roots:[],saveError:null,answerMarks:{},answerAutoDetect:true,freeSubject:'physics',...(ROLE==='teacher'?stored.local:{})};
// 0.7 之前的存档 shared 里没有 subject：按当前学生推一次
const inferredSubject=!(stored.shared&&'subject'in stored.shared);
if(inferredSubject){const stu=localInit.students.find((x)=>x.id===localInit.studentId);sharedInit.subject=stu?studentSubject(stu):localInit.freeSubject;}

/** Single public projection for every initial snapshot and publication. */
export function publicState(s:Shared):Shared {
 // 学生画面里打开着的每一项都要带上笔迹（切回来、浮动窗口里都要看得到），老师的私有笔迹除外
 const ids=deskIds(s.pgmMat.id,s.desk);
 const ink=Object.fromEntries(Object.entries(s.ink).filter(([key])=>ids.has(matOfKey(key))).map(([key,strokes])=>[key,strokes.filter(x=>x.layer!=='private')]));
 return {...Object.fromEntries(SHARED_KEYS.map(k=>[k,s[k]])),ink} as Shared;
}
function publicChanges(key:string,c:InkChange,previous:Stroke[],st:Shared):InkChange|null {
 if(!deskIds(st.pgmMat.id,st.desk).has(matOfKey(key)))return null;
 const publicIds=new Set(previous.filter(x=>x.layer!=='private').map(x=>x.id));
 return {remove:(c.remove??[]).filter(id=>publicIds.has(id)),upsert:(c.upsert??[]).filter(x=>x.layer!=='private'),order:c.order?.filter(id=>(st.ink[key]??[]).some(x=>x.id===id&&x.layer!=='private'))};
}
/** 切到一项时的演示播放状态：回到它上次的参数和进度（暂停），没有就从头开始 */
function simFor(m:Material,cur:SimSync|null,saved?:unknown):SimSync|null{
 if(!(m.scene||(m as {s3d?:unknown}).s3d))return null;
 const rev=(cur?.rev??0)+1,s=saved as SimSync|undefined;
 if(s&&s.matId===m.id){const offset=s.playing?s.offset+Math.max(0,Date.now()-s.startedAt)/1000*s.rate:s.offset;return {...s,playing:false,startedAt:0,offset:Number.isFinite(offset)?offset:0,rev};}
 return {matId:m.id,playing:false,startedAt:0,offset:0,rate:1,rev,params:m.scene?.params??{}};
}
export const useStore=create<State>()((set,get)=>{
 // 打开的课件变了（换项、开新窗口）才重发笔迹；拖窗口、翻页不重发
 let inkIds='';
 const push=(p:Partial<Shared>)=>{const clean=Object.fromEntries(Object.entries(p).filter(([k])=>SHARED_KEYS.includes(k as keyof Shared)));const ids=[...deskIds(get().pgmMat.id,get().desk)].sort().join('|');if('ink'in clean||(('pgmMat'in clean||'desk'in clean)&&ids!==inkIds))clean.ink=publicState(get()).ink;inkIds=ids;bus.post({t:'shared',patch:clean});};
 const edit=(key:string,c:InkChange,actor:Author='teacher',broadcast=true,track=true)=>{
  let prev=get().ink[key]??[];
  if(ROLE==='student'&&get().drawAuthor==='student'){
   if(get().studentTools!=='open')return;
   const own=new Set(prev.filter(x=>x.author==='student').map(x=>x.id));
   c={remove:(c.remove??[]).filter(x=>own.has(x)),upsert:(c.upsert??[]).filter(x=>x.author==='student'&&x.layer!=='private')};
   actor='student';
  }
  const incoming=new Map((c.upsert??[]).map(x=>[x.id,x])); const removed=new Set(c.remove??[]);
  const touched=new Set([...removed,...incoming.keys()]);
  const before=prev.filter(x=>touched.has(x.id));
  const next=prev.filter(x=>!removed.has(x.id)||incoming.has(x.id)).map(x=>{const v=incoming.get(x.id);incoming.delete(x.id);return v??x;});
  next.push(...incoming.values());
  if(c.order){const rank=new Map(c.order.map((id,i)=>[id,i]));next.sort((a,b)=>(rank.get(a.id)??1e9)-(rank.get(b.id)??1e9));}
  const after=next.filter(x=>touched.has(x.id));
  if(JSON.stringify(before)===JSON.stringify(after))return;
  if(ROLE==='teacher'&&track){const h=history[key+'|'+actor]??={undo:[],redo:[]};h.undo.push({before,after,beforeOrder:prev.map(x=>x.id),afterOrder:next.map(x=>x.id)});if(h.undo.length>120)h.undo.shift();h.redo=[];}
  set({ink:{...get().ink,[key]:next}});
  if(broadcast){const pc=publicChanges(key,c,prev,get());if(pc&&((pc.remove?.length??0)||(pc.upsert?.length??0)))bus.post({t:'edit',key,...pc,actor});}
 };
 const travel=(key:string,actor:string,redo:boolean)=>{
  if(ROLE!=='teacher'){bus.post({t:'history',key,actor,redo});return;}
  const h=history[key+'|'+actor];if(!h)return;const item=(redo?h.redo:h.undo).pop();if(!item)return;
  const desired=redo?item.after:item.before,previous=redo?item.before:item.after;
  edit(key,{remove:previous.map(x=>x.id),upsert:desired,order:redo?item.afterOrder:item.beforeOrder},actor as Author,true,false);
  (redo?h.undo:h.redo).push(item);
 };
 return {...sharedInit,...localInit,
 set:(p)=>{set(p);const sp:Record<string,unknown>=Object.fromEntries(Object.entries(p).filter(([k])=>SHARED_KEYS.includes(k as keyof Shared)));if(ROLE==='teacher'&&('studentId' in p||'students' in p)){const ns=get(),stu=ns.students.find((x)=>x.id===ns.studentId),sub=stu?studentSubject(stu):ns.freeSubject;if(sub!==ns.subject){set({subject:sub});sp.subject=sub;}}if(Object.keys(sp).length)push(sp as Partial<Shared>);},
 setShared:(p)=>{set(p);push(p);},
 editInk:(key,c,actor)=>edit(key,c,actor),
 addStroke:(key,s,b=true)=>edit(key,{upsert:[s]},s.author,b),
 erase:(key,ids,b=true)=>edit(key,{remove:ids},get().drawAuthor,b),
 clearInk:(key,author,b=true)=>edit(key,{remove:(get().ink[key]??[]).filter(s=>!author||s.author===author).map(s=>s.id)},(author??'teacher') as Author,b),
 undo:(k,a)=>travel(k,a,false),redo:(k,a)=>travel(k,a,true),
 open:(mat,page=0)=>{get().touch(mat.id);set({reader:{mat,view:defaultView(mat,{page}),split:null}});},
 cue:(mat,view)=>{get().touch(mat.id);set({pvw:{mat,view:defaultView(mat,view)}});},
 take:()=>{const p=get().pvw;if(!p)return;get().showNow(p.mat,p.view);set({pvw:null});},
 // 上屏：已经打开过的课件直接切回去（没指定页码就回到上次那页）；新的加进学生画面，超过上限关掉最久没用的
 showNow:(mat,view)=>{get().touch(mat.id);const st=get();const desk=syncDesk(st.desk,st.pgmMat,st.pgm,st.sim,boardMaterial,defaultView);const i=desk.findIndex(w=>w.id===mat.id);let m=mat,v:View;
  if(i>=0){const w=desk[i];if(mat.kind==='board')m=w.mat;v=view?defaultView(m,view):w.view;desk[i]={...w,mat:m,view:v,mode:w.mode==='min'?(w.prev??'max'):w.mode,z:topZ(desk)+1,at:Date.now()};}
  else{v=defaultView(m,view);desk.push({id:m.id,mat:m,view:v,rect:cascade(desk),mode:'max',z:topZ(desk)+1,at:Date.now()});}
  get().setShared({desk:trimDesk(desk,m.id,st.deskLimit),pgmMat:m,pgm:v,takeAt:Date.now(),curtain:null,spotlight:null,selectedInk:null,sim:simFor(m,st.sim,i>=0?desk[i].sim:undefined)});},
 focusWin:id=>{const st=get();const desk=syncDesk(st.desk,st.pgmMat,st.pgm,st.sim,boardMaterial,defaultView);const i=desk.findIndex(w=>w.id===id);if(i<0)return;const w=desk[i];
  desk[i]={...w,mode:w.mode==='min'?(w.prev??'max'):w.mode,z:topZ(desk)+1,at:Date.now()};
  if(id===st.pgmMat.id){get().setShared({desk});return;}
  get().touch(id);get().setShared({desk,pgmMat:w.mat,pgm:w.view,curtain:null,spotlight:null,selectedInk:null,sim:simFor(w.mat,st.sim,w.sim)});},
 setWin:(id,p)=>{const st=get();const desk=syncDesk(st.desk,st.pgmMat,st.pgm,st.sim,boardMaterial,defaultView);const i=desk.findIndex(w=>w.id===id);if(i<0||id===BASE)return;const w=desk[i];
  const mode=p.mode??w.mode;desk[i]={...w,...p,mode,prev:mode==='min'&&w.mode!=='min'?w.mode:w.prev,z:p.mode&&p.mode!=='min'?topZ(desk)+1:w.z};
  // 收起当前项：回到黑板（或最近用过的浮动窗口）
  if(mode==='min'&&id===st.pgmMat.id){get().setShared({desk});get().focusWin(desk.filter(x=>x.id!==id&&x.mode==='normal').sort((a,b)=>b.z-a.z)[0]?.id??BASE);return;}
  get().setShared({desk});},
 closeWin:id=>{if(id===BASE)return;const st=get();const desk=syncDesk(st.desk,st.pgmMat,st.pgm,st.sim,boardMaterial,defaultView);
  if(id===st.pgmMat.id){const rest=desk.filter(x=>x.id!==id);const next=rest.filter(x=>x.mode!=='min'||x.id===BASE).sort((a,b)=>b.at-a.at)[0]??rest.find(x=>x.id===BASE)!;const j=rest.indexOf(next);rest[j]={...next,mode:next.mode==='min'?(next.prev??'max'):next.mode,z:topZ(rest)+1,at:Date.now()};
   get().setShared({desk:rest,pgmMat:next.mat,pgm:next.view,curtain:null,spotlight:null,selectedInk:null,sim:simFor(next.mat,st.sim,next.sim)});return;}
  get().setShared({desk:desk.filter(x=>x.id!==id)});},
 newBoard:()=>{const n=get().desk.filter(w=>w.mat.kind==='board'&&!isLong(w.mat)).length+1;const b:Material={...boardMaterial(),id:'board-'+Date.now().toString(36),title:'黑板 '+n};get().showNow(b);},
 newLongBoard:()=>{get().showNow(longMaterial(get().desk.filter(w=>isLong(w.mat)).length+1));},
 tileWins:()=>{const st=get();const desk=syncDesk(st.desk,st.pgmMat,st.pgm,st.sim,boardMaterial,defaultView);const ids=tileIds(desk,st.pgmMat.id);if(ids.length<2)return;const next=tileDesk(desk,ids);const cur=next.find(w=>w.id===ids[0])!;cur.at=Date.now();cur.z=topZ(next)+1;
  if(cur.id===st.pgmMat.id)get().setShared({desk:next});else get().setShared({desk:next,pgmMat:cur.mat,pgm:cur.view,curtain:null,spotlight:null,selectedInk:null,sim:simFor(cur.mat,st.sim,cur.sim)});},
 pgmTo:p=>get().setShared({pgm:{...get().pgm,...p},selectedInk:null}),
 touch:id=>{if(id==='board')return;set({recents:[id,...get().recents.filter(x=>x!==id)].slice(0,60)});},
 };
});
let saveTimer:number|undefined;let persistQueue=Promise.resolve();
export function flushStore(){
 if(ROLE!=='teacher')return Promise.resolve();clearTimeout(saveTimer);const s=useStore.getState();
 const value={shared:Object.fromEntries(SHARED_KEYS.map(k=>[k,s[k]])),local:Object.fromEntries(LOCAL_KEYS.map(k=>[k,s[k]])),history};
 if(host.electron){persistQueue=persistQueue.catch(()=>{}).then(()=>host.persist(value)).catch(e=>{if(!useStore.getState().saveError)useStore.setState({saveError:'保存失败：'+String(e.message)});});return persistQueue;}
 try{localStorage.setItem('cs.v2.teacher',JSON.stringify(value));}catch{if(!s.saveError)useStore.setState({saveError:'浏览器存储已满，请使用桌面版保存课堂'});}return Promise.resolve();
}
useStore.subscribe(()=>{if(ROLE!=='teacher')return;clearTimeout(saveTimer);saveTimer=window.setTimeout(flushStore,600);});
// 自由课堂里切换的学科（教师端或浮层都能切）记下来，下次不绑学生时沿用
if(ROLE==='teacher')useStore.subscribe((s,prev)=>{if(s.subject!==prev.subject&&s.subject!==s.freeSubject&&!s.students.some((x)=>x.id===s.studentId))useStore.setState({freeSubject:s.subject});});
// 长黑板滚到离底不到一屏时加长；只由教师窗口改，学生窗口滚动也会经过这里
if(ROLE==='teacher')useStore.subscribe((s,prev)=>{if((s.pgm===prev.pgm&&s.pgmMat===prev.pgmMat)||!isLong(s.pgmMat))return;const g=grownFor(s.pgmMat,s.pgm.y??0);if(g)queueMicrotask(()=>{const cur=useStore.getState();if(cur.pgmMat.id===g.id)cur.setShared({pgmMat:g});});});
window.addEventListener('pagehide',()=>{void flushStore();});
bus.on(m=>{
 const st=useStore.getState();
 switch(m.t){
 case 'hello':if(ROLE==='teacher')bus.post({t:'snapshot',shared:publicState(st),to:m.from});break;
 case 'snapshot':if(m.to===WINDOW_ID){const p=m.shared as Shared;useStore.setState({...p,ink:ROLE==='teacher'?{...st.ink,...p.ink}:p.ink});}break;
 case 'shared':{const p=Object.fromEntries(Object.entries(m.patch).filter(([k])=>SHARED_KEYS.includes(k as keyof Shared))) as Partial<Shared>;if(p.ink&&ROLE==='teacher')p.ink={...st.ink,...p.ink};useStore.setState(p);break;}
 case 'stroke':st.addStroke(m.key,m.stroke as Stroke,false);break;
 case 'erase':st.erase(m.key,m.ids,false);break;
 case 'clear':st.clearInk(m.key,m.author,false);break;
 case 'edit':{const old=st.ink[m.key]??[];const remove=new Set(m.remove??[]),upsert=new Map(((m.upsert??[]) as Stroke[]).map(s=>[s.id,s]));const touched=new Set([...remove,...upsert.keys()]);const next=old.filter(s=>!remove.has(s.id)||upsert.has(s.id)).map(s=>{const n=upsert.get(s.id);upsert.delete(s.id);return n??s;});next.push(...upsert.values());if(m.order){const rank=new Map(m.order.map((id,i)=>[id,i]));next.sort((a,b)=>(rank.get(a.id)??1e9)-(rank.get(b.id)??1e9));}if(ROLE==='teacher'){const h=history[m.key+'|'+(m.actor??'teacher')]??={undo:[],redo:[]};h.undo.push({before:old.filter(s=>touched.has(s.id)),after:next.filter(s=>touched.has(s.id)),beforeOrder:old.map(s=>s.id),afterOrder:next.map(s=>s.id)});if(h.undo.length>120)h.undo.shift();h.redo=[];}useStore.setState({ink:{...st.ink,[m.key]:next}});break;}
 case 'history':if(ROLE==='teacher')(m.redo?st.redo:st.undo)(m.key,m.actor);break;
 }
});
if(ROLE!=='teacher'){bus.post({t:'hello',from:WINDOW_ID});setTimeout(()=>bus.post({t:'hello',from:WINDOW_ID}),700);}
// 推断出来的学科只在教师窗口里；主进程给其它窗口的快照来自存档，要主动发一次，浮层才不会按物理显示
else if(inferredSubject)setTimeout(()=>useStore.getState().setShared({subject:useStore.getState().subject}),0);
// 0.9.1 之前的存档没有 desk：把黑板和当前画面放进去
if(ROLE==='teacher')setTimeout(()=>{const st=useStore.getState();if(st.desk.some(w=>w.id===BASE)&&st.desk.some(w=>w.id===st.pgmMat.id))return;st.setShared({desk:syncDesk(st.desk,st.pgmMat,st.pgm,st.sim,boardMaterial,defaultView)});},0);

// ── 翻页：幻灯片模式下逐块前进，跨页自动接续 ─────────────────
export function stepView(mat: Material, v: View, dir: 1 | -1): View {
  if (isLong(mat)) return scrollView(mat, v, dir * SCREEN / 2);
  if (v.fit === 'slides') {
    const n = mat.pages[v.page]?.slides?.length ?? 1;
    let s = v.slide + dir, p = v.page;
    if (s >= n) { if (p + 1 < mat.pages.length) { p++; s = 0; } else s = n - 1; }
    else if (s < 0) { if (p > 0) { p--; s = (mat.pages[p].slides?.length ?? 1) - 1; } else s = 0; }
    return { ...v, page: p, slide: s };
  }
  const page = Math.max(0, Math.min(mat.pages.length - 1, v.page + dir));
  return { ...v, page, slide: 0, fit: v.fit === 'region' ? 'width' : v.fit, region: undefined };
}

export function addBoardPage() {
  const st = useStore.getState();
  if (st.pgmMat.kind !== 'board' || isLong(st.pgmMat)) return;
  const mat = { ...st.pgmMat, pages: [...st.pgmMat.pages, { w: 1600, h: 900 }], total: st.pgmMat.total + 1 };
  st.setShared({ pgmMat: mat, pgm: { ...st.pgm, page: mat.pages.length - 1 } });
}
