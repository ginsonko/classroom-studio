import { create } from 'zustand';
import { host } from './host';
import {useStore} from './store';
import {toast} from './toast';
export interface RecordJob {id:string;title?:string;progress?:number}
export interface RecordStatus {phase:string;id?:string;studentId?:string|null;folder?:string;startedAt?:number;bytes?:number;micLevel?:number;systemLevel?:number;error?:string;path?:string;warning?:string;audio?:{microphone:boolean;system:boolean};jobs?:RecordJob[]}
export interface RecordRow {id:string;createdAt:string;phase:string;bytes:number;folder:string;mp4:string;raw:string;title?:string;studentId?:string|null;progress?:number;startedAt?:number;endedAt?:number;error?:string|null}
export interface RecordsInfo {dir:string;free:number|null;total:number|null;used:number;count:number;systemDrive:boolean}
/** 正在录（含开始、收尾）；后台生成回放不算 */
export const LIVE=['starting','recording','stopping'];
export const isLive=(phase:string)=>LIVE.includes(phase);
export const useRecording=create<{status:RecordStatus;error:string|null;panel:boolean|'records';rev:number}>()(()=>({status:{phase:'idle'},error:null,panel:false,rev:0}));
host.onEvent(e=>{
 if(e.type==='recording')useRecording.setState(s=>({status:e.status,error:e.status.error??null,rev:['saved','complete','recoverable'].includes(e.status.phase)&&e.status.phase!==s.status.phase?s.rev+1:s.rev}));
 if(e.type==='notice')useRecording.setState({error:e.message});
 if(e.type==='recordSaved'){
  useRecording.setState(s=>({rev:s.rev+1}));
  // 不在录课时顶部「录像已保存」卡片会出来；正在上下一节时只给一条轻提示
  if(isLive(useRecording.getState().status.phase))toast(`上一节「${e.record?.title||'课堂回放'}」的回放已生成`,{action:{label:'去回放',run:()=>useStore.getState().set({page:'replay'})}});
 }
});
if(host.electron&&host.role==='teacher')host.call<RecordStatus>('recordStatus').then(status=>useRecording.setState({status})).catch(()=>{});
export async function toggleRecording(){
 const phase=useRecording.getState().status.phase;
 try{useRecording.setState({error:null});const st=useStore.getState();const status=await host.call<RecordStatus>(['starting','recording'].includes(phase)?'stopLesson':'startLesson',{studentId:st.studentId,title:st.pgmMat.title});useRecording.setState({status});}catch(e){useRecording.setState({error:(e as Error).message});}
}
/** 连堂：这一节收尾，马上开始录下一节；学生窗口和会议共享都不动 */
export async function nextLesson(){
 try{useRecording.setState({error:null});const st=useStore.getState();const status=await host.call<RecordStatus>('nextLesson',{studentId:st.studentId,title:st.pgmMat.title});useRecording.setState({status});toast('上一节已保存，下一节开始录像');}catch(e){useRecording.setState({error:(e as Error).message});}
}
export const fmtBytes=(n:number|null|undefined)=>n==null?'未知':n>=1024**3?(n/1024**3).toFixed(1)+' GB':n<1024**2?'不到 1 MB':(n/1024**2).toFixed(0)+' MB';
