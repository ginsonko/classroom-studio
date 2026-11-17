import { create } from 'zustand';
import { host } from './host';
import {useStore} from './store';
import {toast} from './toast';
import {clearForLesson} from './classReset';
import {afterClassMap} from './mapUpdate';
import type {Chapter} from './timeline';
import type {TranscriptMeta} from './asr';
import type {AfterMeta} from './afterClassLogic';
export interface RecordJob {id:string;title?:string;progress?:number}
export interface RecordStatus {phase:string;/** 1.7.0 刚丢弃的短录像：until 之前可以撤销 */discarded?:{id:string;seconds:number;until:number;limit:number}|null;id?:string;studentId?:string|null;folder?:string;startedAt?:number;bytes?:number;micLevel?:number;systemLevel?:number;error?:string;path?:string;warning?:string;audio?:{microphone:boolean;system:boolean};jobs?:RecordJob[]}
export interface RecordRow {id:string;createdAt:string;phase:string;bytes:number;folder:string;mp4:string;raw:string;title?:string;studentId?:string|null;progress?:number;startedAt?:number;endedAt?:number;error?:string|null;chapters?:Chapter[];analysis?:RecordAnalysis|null;parts?:RecordPart[];splitting?:boolean;splitError?:string|null;transcript?:TranscriptMeta|null;after?:AfterMeta|null}
/** 给微信用的分段（每段不到 1 小时），在录像文件夹的「微信分段」里 */
export interface RecordPart {file:string;path:string;seconds:number;bytes:number}
/** 下课分析录像的结果（存在 recording.json 里）；sortId 指向可整批撤销的那条整理记录 */
export interface RecordAnalysis {at:string;frames:number;/** 1.7.0 看了几页（板书原图 + 录像画面）、这节课一共有几处书写 / 翻页、其中板书原图几张 */pages?:number;pagesAll?:number;boards?:number;questions:number;attempts:number;map:number;summary:string;weak:string[];sortId?:string;error?:string;
  /** 1.6 课后精析：用了多少句课堂原话、待确认几道、没做精析的原因（没转写 / 超过花费上限 / 出错） */
  voice?:number;pending?:number;taught?:number;fineSkip?:string;
  segments?:{t0:number;t1:number;kind:string;title:string}[];
  /** 每道题的判断（回放进度条上标出来） */
  items?:RecordItem[]}
export interface RecordItem {t0:number;t1:number;stem:string;mode:string;result:string|null;level:number|null;conf:number;questionId?:string;state:'written'|'pending'|'taught'|'teacher'|'skip'}
export interface RecordsInfo {dir:string;free:number|null;total:number|null;used:number;count:number;systemDrive:boolean}
/** 正在录（含开始、收尾）；后台生成回放不算 */
export const LIVE=['starting','recording','stopping'];
export const isLive=(phase:string)=>LIVE.includes(phase);
export const useRecording=create<{status:RecordStatus;error:string|null;panel:boolean|'records';rev:number}>()(()=>({status:{phase:'idle'},error:null,panel:false,rev:0}));
host.onEvent(e=>{
 if(e.type==='recording')useRecording.setState(s=>({status:e.status,error:e.status.error??null,rev:['saved','complete','recoverable'].includes(e.status.phase)&&e.status.phase!==s.status.phase?s.rev+1:s.rev}));
 if(e.type==='notice')useRecording.setState({error:e.message});
 if(e.type==='recordSplit'){
  useRecording.setState(s=>({rev:s.rev+1}));
  const n=e.parts?.length??0,title=e.record?.title||'课堂回放';
  if(e.error)toast(`「${title}」没能切成微信分段：${e.error}`,{ms:10000});
  else if(n)toast(`「${title}」已切成 ${n} 段，每段不到 1 小时，可以直接发微信`,{ms:10000,action:{label:'打开文件夹',run:()=>host.revealInFolder(e.dir+'/'+e.parts[0])}});
 }
 // 1.7.0 下课由主进程判断：够长的才算上课（更新学习地图）；短录像先丢弃，10 秒内可以撤销，撤销了再算
 if(e.type==='recordStopped'&&e.kept)classEnded({phase:'saved',studentId:e.studentId,startedAt:e.startedAt});
 if(e.type==='recordStopped'&&!e.kept)toast(`这段录像只有 ${Math.max(1,Math.round(e.seconds))} 秒，不算上课，${Math.round((e.undoMs??10000)/1000)} 秒后删除`,{ms:e.undoMs??10000,action:{label:'撤销，留下它',run:()=>void keepShort(e.id)}});
 if(e.type==='recordSaved'){
  useRecording.setState(s=>({rev:s.rev+1}));
  // 不在录课时顶部「录像已保存」卡片会出来；正在上下一节时只给一条轻提示
  if(isLive(useRecording.getState().status.phase))toast(`上一节「${e.record?.title||'课堂回放'}」的回放已生成`,{action:{label:'去回放',run:()=>useStore.getState().set({page:'replay'})}});
 }
});
if(host.electron&&host.role==='teacher')host.call<RecordStatus>('recordStatus').then(status=>useRecording.setState({status})).catch(()=>{});
/** 这一节下课：按作答更新学习地图（不等它，失败也不影响录像） */
function classEnded(was:RecordStatus){
 const studentId=was.studentId??'',startedAt=was.startedAt??0;
 if(studentId&&startedAt)void afterClassMap(studentId,startedAt).catch(()=>{});
}
/** title：自动录课时用课表上的课名，手动点的用学生画面上的课件名 */
/** 撤销丢弃短录像：留下来，照常生成回放 */
export async function keepShort(id:string){try{const status=await host.call<RecordStatus>('recordKeepShort',id);useRecording.setState({status});toast('好的，这段录像留下了，照常生成回放');}catch(e){toast((e as Error).message);}}
export async function toggleRecording(title?:string){
 const was=useRecording.getState().status,phase=was.phase;
 const stop=['starting','recording'].includes(phase);
 try{useRecording.setState({error:null});if(!stop)await clearForLesson();const st=useStore.getState();const status=await host.call<RecordStatus>(stop?'stopLesson':'startLesson',{studentId:st.studentId,title:title||st.pgmMat.title});useRecording.setState({status});}catch(e){useRecording.setState({error:(e as Error).message});}
}
/** 自动录课用：只开不关、只关不开（toggle 在状态刚变的那一下可能弄反） */
export async function startRecording(title?:string){if(!isLive(useRecording.getState().status.phase))await toggleRecording(title);}
export async function stopRecording(){if(['starting','recording'].includes(useRecording.getState().status.phase))await toggleRecording();}
/** 连堂：这一节收尾，马上开始录下一节；学生窗口和会议共享都不动 */
export async function nextLesson(title?:string){
 const was=useRecording.getState().status;
 try{useRecording.setState({error:null});await clearForLesson();const st=useStore.getState();const status=await host.call<RecordStatus>('nextLesson',{studentId:st.studentId,title:title||st.pgmMat.title});useRecording.setState({status});toast('上一节已保存，下一节开始录像');}catch(e){useRecording.setState({error:(e as Error).message});}
}
export const fmtBytes=(n:number|null|undefined)=>n==null?'未知':n>=1024**3?(n/1024**3).toFixed(1)+' GB':n<1024**2?'不到 1 MB':(n/1024**2).toFixed(0)+' MB';
