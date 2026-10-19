const {contextBridge,ipcRenderer,webUtils}=require('electron');
const sync=(method,value)=>{const r=ipcRenderer.sendSync('cs:sync',{method,value});if(r?.error)throw Error(r.error);return r?.value;};
// 去掉 Electron 给主进程错误加的「Error invoking remote method 'cs:call': Error:」前缀，老师只看到中文原因
const call=(method,value)=>ipcRenderer.invoke('cs:call',{method,value}).catch(e=>{throw Error(String(e?.message??e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));});
const on=(channel,fn)=>{const f=(_e,v)=>fn(v);ipcRenderer.on(channel,f);return()=>ipcRenderer.removeListener(channel,f);};
const initial=sync('init');
if(initial.role==='recorder')contextBridge.exposeInMainWorld('classroom',{call,on:fn=>on('cs:event',fn)});
else{
contextBridge.exposeInMainWorld('csDock',{
 rail:(w,h)=>ipcRenderer.send('cs:dock',{type:'rail',w,h}),
 shape:rects=>ipcRenderer.send('cs:dock',{type:'shape',rects}),
 drag:(phase,x,y)=>ipcRenderer.send('cs:dock',{type:'drag',phase,screenX:x,screenY:y}),
 focus:on=>ipcRenderer.send('cs:dock',{type:'focus',on:!!on}),
 log:text=>ipcRenderer.send('cs:dock',{type:'log',text:String(text)}),
});
contextBridge.exposeInMainWorld('csHost',{
 electron:true,test:initial.test,role:initial.role,dataDir:initial.dataDir,cacheDir:initial.cacheDir,initial:initial.state,
 scanTree:(root,opts)=>call('scanTree',{root,opts}),listDir:p=>call('listDir',p),exists:p=>call('exists',p),
 pickFolder:()=>call('pickFolder'),pickFiles:()=>call('pickFiles'),fileUrl:p=>sync('fileUrl',p),
 pathForFile:f=>{const p=webUtils.getPathForFile(f);if(p)sync('dropPath',p);return p||null;},
 convert:async(p,progress)=>{const id=crypto.randomUUID(),off=on('cs:event',e=>{if(e.type==='convert'&&e.id===id)progress?.(e.progress);});try{return await call('convert',{path:p,id});}finally{off();}},
 openStudentWindow:()=>void call('student'),displays:()=>call('displays'),placeStudent:(id,fullscreen)=>void call('placeStudent',{id,fullscreen}),
 revealInFolder:p=>void call('reveal',p),openDock:()=>void call('dock'),persist:v=>call('persist',v),
 busPost:m=>ipcRenderer.send('cs:bus',m),onBus:fn=>on('cs:bus',fn),call,onEvent:fn=>on('cs:event',fn)
});
}
