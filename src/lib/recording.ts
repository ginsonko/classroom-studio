import { create } from 'zustand';
import { host } from './host';
import {useStore} from './store';
export interface RecordStatus {phase:string;id?:string;studentId?:string|null;folder?:string;startedAt?:number;bytes?:number;micLevel?:number;systemLevel?:number;error?:string;path?:string;warning?:string;audio?:{microphone:boolean;system:boolean}}
export const useRecording=create<{status:RecordStatus;error:string|null;panel:boolean|'records'}>()(()=>({status:{phase:'idle'},error:null,panel:false}));
host.onEvent(e=>{if(e.type==='recording')useRecording.setState({status:e.status,error:e.status.error??null});if(e.type==='notice')useRecording.setState({error:e.message});});
if(host.electron&&host.role==='teacher')host.call<RecordStatus>('recordStatus').then(status=>useRecording.setState({status})).catch(()=>{});
export async function toggleRecording(){
 const phase=useRecording.getState().status.phase;
 try{useRecording.setState({error:null});const st=useStore.getState();const status=await host.call<RecordStatus>(['starting','recording'].includes(phase)?'stopLesson':'startLesson',{studentId:st.studentId,title:st.pgmMat.title});useRecording.setState({status});}catch(e){useRecording.setState({error:(e as Error).message});}
}
