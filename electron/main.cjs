const {app,BrowserWindow,ipcMain,protocol,session,net,screen,dialog,shell,Menu,desktopCapturer,powerSaveBlocker,Notification}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {Files,normal}=require('./files.cjs');const {OfficeConverter}=require('./office.cjs');const {atomicJSON,readJSON,within,cleanTemps}=require('./core.cjs');
const {Recording}=require('./recording.cjs');const ai=require('./ai.cjs');const {createDock}=require('./dock.cjs');const {projection,authorizeMessage,applyMessage}=require('./gate.cjs');const {Ledger}=require('./ledger.cjs');const {Agents}=require('./agents.cjs');const {createReminders}=require('./remind.cjs');const {injectCookieShim}=require('./htmlshim.cjs');const exporter=require('./exporter.cjs');const {Study}=require('./study.cjs');const {Notify}=require('./notify.cjs');const warmup=require('./warmup.cjs');const {Manim}=require('./manim.cjs');const {Reconciler}=require('./reconcile.cjs');const {Archive}=require('./archive.cjs');const {SCHEME,linkFromArgv}=require('./importLink.cjs');const {Updater}=require('./updater.cjs');
const ROOT=path.resolve(__dirname,'..');const VERSION=require(path.join(ROOT,'package.json')).version;
// 默认放在程序所在盘的根目录；内测用户解压到没有写权限的盘（光盘、受限的系统盘）时退回到 %APPDATA%。
const DATA=(()=>{const want=path.resolve(process.env.CS_DATA_DIR||path.join(path.parse(ROOT).root,'ClassroomStudioData'));if(process.env.CS_DATA_DIR)return want;try{fs.mkdirSync(want,{recursive:true});const probe=path.join(want,'.write-probe');fs.writeFileSync(probe,'');fs.unlinkSync(probe);return want;}catch{return path.join(app.getPath('appData'),'ClassroomStudioData');}})();
const TEST=process.env.CS_TEST==='1';
app.setPath('userData',path.join(DATA,'browser'));
const log=require('./log.cjs').createLog(path.join(DATA,'logs'));
log.info('启动',{version:VERSION,electron:process.versions.electron,test:process.env.CS_TEST==='1'});
process.on('uncaughtException',e=>log.error('主进程未捕获异常',e));
process.on('unhandledRejection',e=>log.error('主进程未处理的 Promise 拒绝',e));
app.on('child-process-gone',(_e,d)=>log.error('子进程退出',d));
app.on('web-contents-created',(_e,wc)=>{
 const who=()=>roles.get(wc.id)??wc.getType();
 wc.on('console-message',e=>{if(e.level==='error')log.warn('脚本报错',who(),String(e.message).slice(0,800),e.sourceId?String(e.sourceId).split('/').pop()+':'+e.lineNumber:'');});
 wc.on('render-process-gone',(_ev,d)=>log.error('页面进程退出',who(),d));
 wc.on('unresponsive',()=>log.error('页面无响应',who()));
 wc.on('responsive',()=>log.info('页面恢复响应',who()));
 wc.on('did-fail-load',(_ev,code,desc,url,main)=>{if(main)log.warn('页面加载失败',who(),code,desc,String(url).slice(0,200));});
});
protocol.registerSchemesAsPrivileged([{scheme:'studio',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}},{scheme:'lesson',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
const files=new Files(path.join(DATA,'cache'));
const windows=new Map(),roles=new Map();let saved={},publicData={},settings,recording,saveTimer,saveQueue=Promise.resolve(),quitting=false,closing=false,blocker=null,ledger,agents,reminders,study,notifier,manim,reconciler,archive,updater;
const send=(win,ch,data)=>{if(win&&!win.isDestroyed()&&!win.webContents.isCrashed())win.webContents.send(ch,data);};
const notify=(type,value={})=>{if(value.error)log.warn('提示',type,value.message);for(const [role,w]of windows)if(role==='teacher')send(w,'cs:event',{type,...value});};
const busy=()=>['starting','recording','stopping','converting'].includes(recording?.status.phase);
function safeRole(e){if(e.senderFrame!==e.sender.mainFrame)throw Error('课件页面没有桌面控制权限');const role=roles.get(e.sender.id);if(!role)throw Error('未知窗口');return role;}
function saving(){clearTimeout(saveTimer);const work=saveQueue.catch(()=>{}).then(()=>atomicJSON(path.join(DATA,'workspace.json'),{...saved,settings,capabilities:[...files.tokens],urls:[...files.urls],allowedRoots:[...files.roots]}));saveQueue=work.catch(e=>{notify('notice',{message:'本地保存失败：'+e.message,error:true});throw e;});return saveQueue;}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{void saving().catch(()=>{});},700);}
function rememberPublic(){
 const full=saved.shared??{},prior=full.ink??{},merged={...prior};
 for(const[k,v]of Object.entries(publicData.ink??{}))merged[k]=[...v,...(prior[k]??[]).filter(s=>s.layer==='private')];
 saved.shared={...full,...publicData,ink:merged};scheduleSave();
}
function guardSession(ses){
 ses.protocol.handle('studio',async req=>{try{const u=new URL(req.url);if(u.hostname!=='app')return new Response('Not found',{status:404});let rel=decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html';const base=rel.startsWith('recorder.')?__dirname:path.join(ROOT,process.env.CS_DIST||'dist');const file=path.resolve(base,rel);if(!within(base,file))return new Response('Denied',{status:403});const response=await net.fetch(pathToFileURL(file).href);const headers=new Headers(response.headers);headers.set('Content-Security-Policy',"default-src 'self' lesson: data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' lesson: data: blob: https: http:; connect-src 'self' lesson: blob: https: http:; frame-src lesson: https: http: blob:; media-src 'self' lesson: blob: https: http:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'");return new Response(response.body,{status:response.status,headers});}catch{return new Response('Resource unavailable',{status:404});}});
 ses.protocol.handle('lesson',async req=>{try{const file=files.resolve(req.url);const response=await net.fetch(pathToFileURL(file).href,{headers:req.headers});const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');headers.set('X-Content-Type-Options','nosniff');if(/\.html?$/i.test(file)&&response.status===200&&!req.headers.get('range')){headers.delete('content-length');return new Response(injectCookieShim(Buffer.from(await response.arrayBuffer())),{status:200,headers});}return new Response(response.body,{status:response.status,headers});}catch{return new Response('课件文件已移动或不可读取',{status:404});}});
 ses.setPermissionRequestHandler((wc,p,cb)=>cb(roles.get(wc.id)==='recorder'&&['media','display-capture'].includes(p)));
 ses.setPermissionCheckHandler((wc,p)=>!!wc&&roles.get(wc.id)==='recorder'&&['media','display-capture'].includes(p));
 ses.setDisplayMediaRequestHandler(async(req,callback)=>{try{const rec=windows.get('recorder'),student=windows.get('student');if(!rec||req.frame!==rec.webContents.mainFrame||!student||student.isDestroyed())return callback({});const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0}}),source=sources.find(s=>s.id===student.getMediaSourceId());if(!source)return callback({});callback({video:source,...(settings.systemAudio&&process.platform==='win32'?{audio:'loopback'}:{})});}catch(e){notify('notice',{message:'捕获学生窗口失败：'+e.message,error:true});callback({});}});
}
// 成果导出用的离屏排版窗口：不显示、没有 preload，只加载 export.html
function exportWindow(){
 const ses=session.fromPartition('studio-export');if(!ses.csReady){guardSession(ses);ses.csReady=true;}
 const w=new BrowserWindow({show:false,width:1600,height:900,useContentSize:true,frame:false,webPreferences:{offscreen:true,session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 w.webContents.setFrameRate(30);w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());
 return w;
}
let exportQueue=Promise.resolve();
function exportDoc(file,formats){const job=exportQueue.then(()=>exporter.exportMarkdown(file,formats,exportWindow));exportQueue=job.catch(()=>{});return job;}
files.office=new OfficeConverter({makeWindow:exportWindow,url:p=>files.url(p),log});
const dockManager=createDock({
 settings:()=>settings, save:()=>scheduleSave(), log,
 getStudent:()=>windows.get('student'),
 makeOptions:()=>{
  const ses=session.fromPartition('persist:studio-private');
  if(!ses.csReady){guardSession(ses);ses.csReady=true;}
  return {acceptFirstMouse:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,webSecurity:true}};
 },
 load:win=>win.loadURL('studio://app/index.html?w=dock'),
 onCreate:w=>{
  const id=w.webContents.id;windows.set('dock',w);roles.set(id,'dock');
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  w.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('studio://app/'))e.preventDefault();});
  w.on('closed',()=>{roles.delete(id);if(windows.get('dock')===w)windows.delete('dock');});
 },
});
ipcMain.on('cs:dock',(e,m)=>{try{if(safeRole(e)!=='dock')throw Error('只有教师浮层可以发送此消息');dockManager.message(m);}catch(err){notify('notice',{message:'浮层操作未应用：'+err.message,error:true});}});
async function makeWindow(role){
 const previous=windows.get(role);if(previous&&!previous.isDestroyed()){
  if(role==='recorder'&&previous.webContents.isCrashed()){
   windows.delete(role);roles.delete(previous.webContents.id);try{previous.destroy();}catch{}
  }else{if(role!=='recorder')previous.show();return previous;}
 }
 const ses=session.fromPartition(role==='student'?'persist:studio-public':role==='recorder'?'studio-recorder':'persist:studio-private');
 if(!ses.csReady){guardSession(ses);ses.csReady=true;}
 const options=role==='teacher'?{width:1600,height:960,minWidth:1050,minHeight:640,title:'最强网课教辅系统 · 教师端'}:role==='student'?{width:1280,height:760,minWidth:640,minHeight:400,title:'课堂展示 · 请共享这个窗口'}: {width:320,height:180,title:'课堂录制组件'};
 // acceptFirstMouse：macOS 上窗口不在前台时，第一下落笔 / 点击也直接生效，而不是只用来激活窗口
 const w=new BrowserWindow({...options,show:false,acceptFirstMouse:true,backgroundColor:'#101217',webPreferences:{preload:path.join(__dirname,'preload.cjs'),session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,webSecurity:true}});
 const contentId=w.webContents.id;windows.set(role,w);roles.set(contentId,role);
 if(role==='teacher'){w.setContentProtection(!!settings.captureGuard);w.webContents.setAudioMuted(true);}
 w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 w.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('studio://app/'))e.preventDefault();});
 w.webContents.on('will-attach-webview',e=>e.preventDefault());
 w.webContents.on('render-process-gone',(_e,d)=>{if(role==='recorder')recording?.fail('录制组件异常退出：'+d.reason);else notify('notice',{message:options.title+'意外退出，课堂数据已保存在本地。',error:true});});
 w.on('close',e=>{
  if(quitting)return;
  if(role==='teacher'){e.preventDefault();void closeApp();return;}
  if(role==='student'&&busy()){e.preventDefault();notify('notice',{message:'请先下课并保存录像，再关闭学生窗口。'});}
 });
 w.on('closed',()=>{roles.delete(contentId);windows.delete(role);});
 if(role==='student')w.on('minimize',()=>{if(busy()){w.restore();notify('notice',{message:'录课期间请保持学生窗口展开，确保画面持续刷新。'});}});
 await w.loadURL(role==='recorder'?'studio://app/recorder.html':`studio://app/index.html?w=${role}`);
 if(role!=='recorder'&&!TEST)w.show();
 return w;
}
async function closeApp(){
 if(closing)return;closing=true;
 try{if(busy()){const {response}=await dialog.showMessageBox(windows.get('teacher'),{type:'question',buttons:['继续上课','下课保存后退出'],defaultId:0,cancelId:0,message:'课堂录像还在进行，是否先保存？'});if(response===0)return;await recording.stop();const until=Date.now()+180000;while(busy()&&Date.now()<until)await new Promise(r=>setTimeout(r,500));if(busy()){notify('notice',{message:'录像仍在导出，完成后可以关闭。'});return;}}
  await windows.get('teacher')?.webContents.executeJavaScript("window.dispatchEvent(new Event('pagehide')); true").catch(()=>{});await new Promise(r=>setTimeout(r,200));await saving();await study?.queue.catch(()=>{});quitting=true;app.quit();
 }finally{closing=false;}
}
function canUsePath(role,p){if(/^https?:\/\//i.test(p)){const u=new URL(p);if(u.username||u.password)throw Error('网址不能包含凭据');return u.href;}if(role==='teacher'||role==='dock')return files.allowed(p);const mat=publicData.pgmMat;if(mat&&(p===mat.src?.path||p===mat.src?.pdf||mat.pages?.some(x=>x.doc?.pdf===p||x.src===p)))return files.allowed(p);if(publicData.warm?.some(x=>x.path===p))return files.allowed(p);throw Error('只能访问正在展示或老师预加载的课件');}
ipcMain.on('cs:sync',(e,{method,value})=>{try{const role=safeRole(e);let result;
 if(method==='init')result={role,test:TEST,dataDir:normal(DATA),cacheDir:normal(files.cache),state:role==='teacher'?{shared:saved.shared,local:saved.local,history:saved.history}:{shared:projection(publicData)}};
 else if(method==='dropPath'&&(role==='teacher'||(role==='student'&&publicData.drawAuthor==='teacher')))result=files.authorize(value,fs.statSync(value).isDirectory());
 else if(method==='fileUrl'){canUsePath(role,value);result=files.url(value);}
 else throw Error('这个窗口不能执行此操作');
 e.returnValue={value:result};}catch(err){e.returnValue={error:err.message};}});
ipcMain.on('cs:bus',(e,message)=>{try{const role=safeRole(e),m=authorizeMessage(role,message,publicData);if(!m)return;
 if(m.t==='hello'){send(BrowserWindow.fromWebContents(e.sender),'cs:bus',{t:'snapshot',to:m.from,shared:projection(publicData)});return;}
 if(m.t==='snapshot')return;
 applyMessage(publicData,m);if(['shared','stroke','edit','erase'].includes(m.t))rememberPublic();
 for(const[r,w]of windows)if(r!=='recorder'&&w.webContents.id!==e.sender.id)send(w,'cs:bus',m);
 }catch(err){notify('notice',{message:'同步操作未应用：'+err.message,error:true});}});
ipcMain.handle('cs:call',async(e,{method,value})=>{
 // 窗口关闭或被重建时，渲染进程里还在路上的调用会晚到；窗口已经没了就静默丢弃，不当成错误
 if(!roles.has(e.sender.id)&&e.senderFrame===e.sender.mainFrame){const w=BrowserWindow.fromWebContents(e.sender);if(!w||w.isDestroyed()||!w.isVisible()&&![...windows.values()].includes(w)){log.info('丢弃已关闭窗口的调用',method);return null;}}
 const role=safeRole(e);const trusted=role==='teacher'||role==='dock';
 if(role==='recorder'){
  if(method==='recordReady')return recording.ready(value);
  if(method==='recordChunk')return recording.chunk(value);
  if(method==='recordStopped')return recording.stopped(value);
  if(method==='recordError'&&value.recordId===recording.current?.id)return recording.fail(value.error);
  if(method==='recordMeter'&&value.recordId===recording.current?.id){recording.update({micLevel:Number(value.micLevel)||0,systemLevel:Number(value.systemLevel)||0});return;}
  throw Error('录制组件权限不足');
 }
 if(method==='exists'){try{canUsePath(role,value);return fs.existsSync(value);}catch{return false;}}
 if(method==='persist'&&role==='teacher'){
  const ink={...value.shared?.ink};for(const[k,v]of Object.entries(publicData.ink??{}))ink[k]=[...v,...(ink[k]??[]).filter(s=>s.layer==='private')];
  saved={...saved,...value,shared:{...value.shared,...publicData,ink}};await saving();return;
 }
 if(method==='convert'&&(trusted||(role==='student'&&publicData.drawAuthor==='teacher')))return files.convert(value.path,progress=>send(BrowserWindow.fromWebContents(e.sender),'cs:event',{type:'convert',id:value.id,progress}));
 if(!trusted)throw Error('此操作仅在教师窗口可用');
 if(typeof method==='string'&&method.startsWith('ai.'))return ai.handle(method,value,{windows,dataDir:DATA,sender:e.sender,ledger,reconciler});
 if(typeof method==='string'&&method.startsWith('agents.'))return agentCall(method,value);
 if(typeof method==='string'&&method.startsWith('study.'))return studyCall(method,value);
 if(typeof method==='string'&&method.startsWith('notify.'))return notifier.handle(method,value);
 if(typeof method==='string'&&method.startsWith('manim.'))return manim.handle(method,value);
 if(typeof method==='string'&&method.startsWith('update.'))return updateCall(method,value);
 if(method==='archive.folder'){if(!TEST)await shell.openPath(archive.dir);return normal(archive.dir);}
 if(typeof method==='string'&&method.startsWith('archive.'))return archive.handle(method,value);
 switch(method){
 case 'scanTree':return files.scan(value.root,value.opts);
 case 'listDir':return files.listDir(value);
 case 'slideTexts':return files.slideTexts(value);
 case 'warmup.html':{const p=String(value?.path||''),url=/^https?:\/\//i.test(p)?new URL(p).href:files.url(p);if(!/^(https?|lesson):/i.test(url))throw Error('只能检查网页课件');const ses=session.fromPartition('persist:studio-public');if(!ses.csReady){guardSession(ses);ses.csReady=true;}return warmup.checkHtml({url,session:ses,log});}
 case 'pickFolder':{const r=await dialog.showOpenDialog(windows.get('teacher'),{title:'添加课件目录',properties:['openDirectory']});return r.canceled?null:files.authorize(r.filePaths[0],true);}
 case 'pickFiles':{const r=await dialog.showOpenDialog(windows.get('teacher'),{title:'打开课件',properties:['openFile','multiSelections']});return r.canceled?[]:r.filePaths.map(p=>files.authorize(p));}
 case 'student':{const w=await makeWindow('student');if(!TEST)await dockManager.ensure();return;}
 case 'dock':await dockManager.ensure();return dockManager.state;
 case 'dockState':return dockManager.state;
 case 'dockVisible':return dockManager.setVisible(true);
 case 'dockToggle':return dockManager.setVisible();
 case 'hideDock':return dockManager.setVisible(false);
 case 'displays':return screen.getAllDisplays().map(d=>({id:d.id,label:d.label||`显示器 ${d.id}`,primary:d.id===screen.getPrimaryDisplay().id,bounds:d.bounds}));
 case 'placeStudent':{const d=screen.getAllDisplays().find(d=>d.id===value.id);if(!d)throw Error('显示器已断开');const w=await makeWindow('student');w.setFullScreen(false);w.setBounds(d.bounds);w.setFullScreen(!!value.fullscreen);w.show();if(!TEST)await dockManager.ensure();return;}
 case 'reveal':{const actual=path.resolve(value);if(!within(DATA,actual))files.allowed(actual);shell.showItemInFolder(actual);return;}
 case 'settings':return {...settings,recording:recording.status,displays:screen.getAllDisplays().length};
 case 'setSettings':{
  const rec=['microphone','systemAudio','autoRecord','bitrate'].some(k=>value[k]!==undefined);
  if(rec&&busy())throw Error('请在下课保存后修改录音设置');
  for(const k of ['microphone','systemAudio','autoRecord'])if(typeof value[k]==='boolean')settings[k]=value[k];if([1500000,3000000,5000000].includes(value.bitrate))settings.bitrate=value.bitrate;
  if(typeof value.captureGuard==='boolean'){settings.captureGuard=value.captureGuard;const t=windows.get('teacher');if(t&&!t.isDestroyed())t.setContentProtection(value.captureGuard);dockManager.protect();log.info('防截屏',value.captureGuard?'开启':'关闭');}
  if([0,5,10,15,30].includes(value.remindMinutes))settings.remindMinutes=value.remindMinutes;
  if(typeof value.autostart==='boolean'){settings.autostart=value.autostart;if(app.isPackaged)app.setLoginItemSettings({openAtLogin:value.autostart});}
  scheduleSave();return settings;}
 case 'pickRecordings':{if(busy())throw Error('录像保存后可修改目录');const r=await dialog.showOpenDialog(windows.get('teacher'),{title:'选择录像保存目录',properties:['openDirectory','createDirectory']});if(!r.canceled){settings.recordings=r.filePaths[0];recording.directory=r.filePaths[0];await saving();}return settings.recordings;}
 case 'startLesson':{await makeWindow('student');if(busy())return recording.status;await makeWindow('recorder');if(blocker===null)blocker=powerSaveBlocker.start('prevent-display-sleep');return recording.start({...settings,studentId:value?.studentId,title:value?.title},TEST&&value?.synthetic===true);}
 case 'stopLesson':return recording.stop();
 case 'recordStatus':return recording.status;
 case 'recordings':return recording.list();
 case 'recoverRecording':{if(busy())throw Error('正在录制或导出，请稍后恢复');const item=(await recording.list()).find(x=>x.id===value);if(!item)throw Error('找不到这段录像');recording.update({phase:'converting'});try{const p=await recording.convert(item.folder);recording.update({phase:'complete',path:p,error:null});return p;}catch(e){recording.update({phase:'recoverable',error:e.message});throw e;}}
 case 'openRecording':{const item=(await recording.list()).find(x=>x.id===value);if(!item)throw Error('找不到这段录像');const err=await shell.openPath(item.phase==='complete'?item.mp4:item.raw);if(err)throw Error(err);return;}
 case 'recordingsFolder':await fs.promises.mkdir(settings.recordings,{recursive:true});return shell.openPath(settings.recordings);
 case 'exportBoard':{const w=await makeWindow('student'),r=await dialog.showSaveDialog(windows.get('teacher'),{title:'保存当前板书',defaultPath:path.join(settings.recordings,'课堂板书-'+Date.now()+'.png'),filters:[{name:'PNG',extensions:['png']}]});if(r.canceled)return null;await fs.promises.writeFile(r.filePath,(await w.webContents.capturePage()).toPNG());return r.filePath;}
 case 'saveImage':{if(typeof value!=='string'||value.length>50*1024*1024||!value.startsWith('data:image/png;base64,'))throw Error('图片数据无效');const file=path.join(files.cache,'images',require('node:crypto').randomUUID()+'.png');await fs.promises.mkdir(path.dirname(file),{recursive:true});await fs.promises.writeFile(file,Buffer.from(value.split(',')[1],'base64'));return normal(file);}
 default:throw Error('未实现的桌面操作：'+method);
 }
});
async function updateCall(method,value){
 switch(method){
 case 'update.state':return {...updater.state,version:VERSION,check:settings.updateCheck!==false,skip:settings.updateSkip||''};
 case 'update.check':return updater.check({manual:true});
 case 'update.download':return updater.download();
 case 'update.install':{if(busy())throw Error('正在录课，请下课保存后再更新');updater.launchApply();quitting=true;setTimeout(()=>{void saving().catch(()=>{}).then(()=>study?.queue.catch(()=>{})).then(()=>app.quit());},300);return true;}
 case 'update.settings':{if(typeof value?.check==='boolean')settings.updateCheck=value.check;if(typeof value?.skip==='string')settings.updateSkip=value.skip.slice(0,20);scheduleSave();return {check:settings.updateCheck!==false,skip:settings.updateSkip||''};}
 case 'update.page':{const u=new URL(String(value||updater.state.info?.page||'https://classroom.yinziapi.top/'));if(u.protocol!=='https:')throw Error('只能打开 https 网址');if(!TEST)await shell.openExternal(u.href);return u.href;}
 default:throw Error('未知的更新操作：'+method);
 }
}
async function agentCall(method,value){
 switch(method){
 case 'agents.detect':return agents.detect();
 case 'agents.install':return agents.install(value);
 case 'agents.update':return agents.update(value||'codex');
 case 'agents.bank':return agents.readBank(value?.id,value?.file);
 case 'agents.list':return agents.list();
 case 'agents.get':return agents.get(value);
 case 'agents.start':{const v=value||{};const t=agents.start({engine:v.engine,title:v.title,prompt:v.prompt,context:v.context,cap:v.cap,useStudioKey:!!v.useStudioKey,formats:v.formats,model:v.model,permission:v.permission,skill:v.skill});log.info('后台任务开始',t.id,t.engine,t.permission,t.title);return t;}
 case 'agents.configure':return agents.configure(value?.id,value||{});
 case 'agents.inject':return agents.inject(value?.id,value?.text);
 case 'agents.stop':return agents.stop(value);
 case 'agents.calibrate':return agents.calibrate(value?.id,value?.actual);
 case 'agents.remove':return agents.remove(value);
 case 'agents.files':return agents.files(value);
 case 'agents.export':return agents.exportFile(value?.id,value?.file,value?.formats);
 case 'agents.open':{const t=agents.get(value?.id),f=path.resolve(String(value?.file||'')),rel=path.relative(t.work,f);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('只能打开这个任务的成果文件');if(!/\.(docx?|pdf|pptx?|xlsx?|html?|md|txt|png|jpe?g|svg|gif|webp|mp4)$/i.test(f))throw Error('这种文件不能从这里直接打开，请到文件夹里查看');const err=await shell.openPath(f);if(err)throw Error('打不开：'+err);return;}
 // 成果文件夹授权给资料库，老师可以直接打开里面的课件
 case 'agents.folder':{const t=agents.get(value);return files.authorize(t.work,true);}
 case 'agents.reveal':{const t=agents.get(value);await shell.openPath(t.work);return;}
 default:throw Error('未知的任务操作：'+method);
 }
}
async function studyCall(method,value){
 const inside=f=>{const p=path.resolve(String(f||'')),rel=path.relative(study.dir,p);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('只能打开学情库里的文件');return p;};
 switch(method){
 case 'study.load':return study.load();
 case 'study.save':return study.save(value);
 case 'study.image':return study.image(value);
 case 'study.imageData':return study.imageData(value);
 case 'study.document':return study.document(value||{});
 case 'study.open':{const err=await shell.openPath(inside(value));if(err)throw Error('打不开：'+err);return;}
 case 'study.reveal':shell.showItemInFolder(inside(value));return;
 case 'study.folder':{const f=study.folder(value);if(!TEST)await shell.openPath(f);return normal(f);}
 case 'study.store':return study.store(value);
 case 'study.saveStore':return study.saveStore(value||{});
 case 'study.stat':return files.stat(value);
 case 'study.readText':return files.readText(value);
 case 'study.pickText':{const r=await dialog.showOpenDialog(windows.get('teacher'),{title:'选择聊天记录或要求（txt / md）',properties:['openFile'],filters:[{name:'文本',extensions:['txt','md','csv']}]});if(r.canceled)return null;const p=files.authorize(r.filePaths[0]);return {path:p,text:await files.readText(p)};}
 case 'study.skills':return study.skills();
 case 'study.saveSkills':return study.saveSkills(value);
 case 'study.exportSkill':{const f=await study.exportSkill(value||{});if(!TEST)shell.showItemInFolder(f);return f;}
 default:throw Error('未知的学情操作：'+method);
 }
}
const shown=new Set();
function remindLesson(item){
 const hm=item.at.toTimeString().slice(0,5),title=`${item.minutes} 分钟后上课：${item.studentName}`,body=`${hm} 开始${item.slot.topic?' · '+item.slot.topic:''}。点这里打开导播台。`;
 log.info('课前提醒',title);
 notify('remind',{title,body,studentId:item.slot.studentId,at:item.at.getTime()});
 if(TEST||!Notification.isSupported())return;
 const n=new Notification({title,body,silent:false});
 // 不保留引用的话通知对象可能被回收，点击就没反应
 shown.add(n);n.on('close',()=>shown.delete(n));setTimeout(()=>shown.delete(n),15*60000);
 n.on('click',()=>{const t=windows.get('teacher');if(t&&!t.isDestroyed()){if(t.isMinimized())t.restore();t.show();t.focus();}});
 n.show();
}
async function start(){
 await fs.promises.mkdir(files.cache,{recursive:true});cleanTemps(path.join(DATA,'workspace.json'));saved=await readJSON(path.join(DATA,'workspace.json'),{});
 settings={recordings:path.join(DATA,'recordings'),microphone:true,systemAudio:true,autoRecord:true,bitrate:3000000,captureGuard:false,remindMinutes:10,autostart:false,...saved.settings};
 // 0.4.0：防截屏改为默认关闭（开启时部分会议软件全屏共享会显示黑块）
 if(!saved.migrated040){saved.migrated040=true;settings.captureGuard=false;}
 ledger=new Ledger(DATA);
 agents=new Agents({dir:path.join(DATA,'agents'),toolsDir:path.join(DATA,'tools'),fetch:(u,o)=>net.fetch(u,o),ledger,credentials:()=>ai.credentials(DATA),log,emit:m=>notify('agent',{agent:m}),exporter:exportDoc,onCharge:()=>reconciler?.soon(120000)});
 reconciler=new Reconciler({ledger,credentials:()=>ai.credentials(DATA),log,emit:m=>{if(m.tasks?.length)agents.refreshCost(m.tasks);notify('ledger',m);}});if(!TEST)reconciler.start();try{files.authorize(agents.dir,true);}catch{}
 study=new Study({dir:path.join(DATA,'study'),exportDoc,log});files.authorize(study.dir,true);
 notifier=new Notify({dir:DATA,root:study.dir,test:TEST,log});
 manim=new Manim({dir:path.join(files.cache,'manim'),log,test:TEST});await fs.promises.mkdir(manim.dir,{recursive:true});
 archive=new Archive({dir:path.join(DATA,'archive'),copyFrom:[manim.dir],log});files.authorize(archive.dir,true);
 reminders=createReminders({getLocal:()=>saved.local,getLead:()=>settings.remindMinutes,onDue:remindLesson,log});
 if(!TEST)reminders.start();
 for(const root of [...(saved.allowedRoots??[]),...(saved.local?.roots??[]),files.cache])try{files.authorize(root,true);}catch{}
 for(const[token,root]of saved.capabilities??[])if(fs.existsSync(root))files.tokens.set(token,root);
 for(const[p,url]of saved.urls??[])if(fs.existsSync(p))files.urls.set(p,url);
 if(!saved.shared){saved.shared={pgmMat:{id:'board',kind:'board',title:'课堂黑板',pages:[{w:1600,h:900}],total:1},pgm:{materialId:'board',page:0,slide:0,fit:'page',zoom:1},ink:{},drawAuthor:'teacher',studentTools:'open'};}
 // 0.3.0：学生工具栏默认开放（老版本存档里多半是 locked，升级时迁移一次）
 if(!saved.migrated030){saved.migrated030=true;if(saved.shared.studentTools==='locked')saved.shared.studentTools='open';}
 // 0.8.1：橡皮默认改成局部擦除（旧存档里的整笔擦除是旧默认值）；学生窗口也从这里拿设置，所以在主进程迁移
 if(!saved.shared.inkOptions?.eraserV)saved.shared.inkOptions={shapeSnap:true,...saved.shared.inkOptions,eraserMode:'segment',eraserSize:'m',eraserV:2};
 // 书写权不跨次启动：上次下课时笔在学生手里，这次打开也应先回到老师手里
 saved.shared.drawAuthor='teacher';
 publicData=projection(saved.shared);if(publicData.sim)publicData.sim.playing=false;
 recording=new Recording({directory:settings.recordings,ffmpeg:path.join(ROOT,'bin',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),onChange:status=>{notify('recording',{status});if(!['starting','recording','stopping'].includes(status.phase)&&blocker!==null){powerSaveBlocker.stop(blocker);blocker=null;}},send:m=>send(windows.get('recorder'),'cs:event',m)});
 // 自动更新：清单地址和公钥可以用环境变量换成测试服务器（两个都给才生效）
 const feed=process.env.CS_UPDATE_FEED,pub=process.env.CS_UPDATE_PUBKEY;
 updater=new Updater({appRoot:ROOT,version:VERSION,dataDir:DATA,fetch:(u,o)=>net.fetch(u,o),log,emit:s=>notify('update',{update:s}),packaged:app.isPackaged,...(feed&&pub?{feeds:[feed],publicKey:pub}:{})});
 const lastUpdate=updater.takeResult();
 // macOS 没有菜单时输入框里的 ⌘C / ⌘V 都不能用，留一个最小的系统菜单
 Menu.setApplicationMenu(process.platform==='darwin'?Menu.buildFromTemplate([{role:'appMenu',label:'最强网课教辅系统'},{role:'editMenu',label:'编辑'},{role:'windowMenu',label:'窗口'}]):null);await makeWindow('teacher');await makeWindow('student');if(!TEST)await dockManager.ensure();
 if(lastUpdate)setTimeout(()=>notify('update',{update:{phase:lastUpdate.ok?'done':'failed',result:lastUpdate}}),2500);
 if(!TEST){const auto=()=>{if(settings.updateCheck!==false)void updater.check();};setTimeout(auto,20000);setInterval(auto,12*3600000).unref?.();}
 if(TEST)globalThis.classroomStudioTest={get updater(){return updater;},windows,roles,files,recording,dock:dockManager,data:DATA,get saved(){return saved;},get publicData(){return publicData;},makeWindow,saving,get agents(){return agents;},get study(){return study;},get notifier(){return notifier;},get manim(){return manim;},get archive(){return archive;},get ledger(){return ledger;},get reconciler(){return reconciler;},get settings(){return settings;},remindLesson,exportDoc,offerLink:l=>offerLink(l)};
}
// 一键导入（yinzi-import/1）：网站打开 classroom-studio:// 链接或双击 .yzimport 文件。没开着就带着参数启动，开着就交给已有的实例
let startLink=TEST?'':linkFromArgv(process.argv);
async function offerLink(link){
 if(!link)return;
 const t=windows.get('teacher');
 if(!t||t.isDestroyed()){startLink=link;return;}
 if(t.isMinimized())t.restore();t.show();t.focus();
 // 日志里不写链接和 Key
 try{const s=await ai.offerImport(link,DATA);log.info('一键导入','收到配置',s.site?.host||s.baseUrl);notify('import',{summary:s});}
 catch(err){log.warn('一键导入',err.code||'',err.message);notify('import',{error:true,message:err.message});}
}
if(!TEST&&app.isPackaged){try{app.setAsDefaultProtocolClient(SCHEME);}catch(err){log.warn('注册一键导入协议失败',err.message);}}
if(!TEST&&!app.requestSingleInstanceLock())app.quit();else{app.whenReady().then(start).then(()=>{if(startLink){const l=startLink;startLink='';setTimeout(()=>offerLink(l),1500);}}).catch(err=>{console.error(err);dialog.showErrorBox('最强网课教辅系统启动失败',err.message);app.quit();});app.on('second-instance',(_e,argv)=>{const l=linkFromArgv(argv);if(l)offerLink(l);else windows.get('teacher')?.show();});}
// macOS 不走启动参数：链接和双击的文件通过事件交过来（可能早于 ready）
app.on('open-url',(e,url)=>{e.preventDefault();void offerLink(url);});
app.on('open-file',(e,file)=>{if(/\.yzimport$/i.test(file)){e.preventDefault();void offerLink(file);}});
app.on('activate',()=>{const t=windows.get('teacher');if(t&&!t.isDestroyed())t.show();});
app.on('will-quit',()=>{try{agents?.stopAll();reminders?.stop();reconciler?.stop();}catch{}});
app.on('window-all-closed',()=>{if(TEST||quitting)app.quit();});
app.on('before-quit',e=>{if(!quitting&&!TEST){e.preventDefault();void closeApp();}});
