const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('snip',{
 done:r=>ipcRenderer.send('cs:snip',{x:+r.x,y:+r.y,width:+r.width,height:+r.height,viewW:+r.viewW,viewH:+r.viewH}),
 cancel:()=>ipcRenderer.send('cs:snip',null),
});
