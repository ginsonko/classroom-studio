const {app,BrowserWindow,ipcMain,protocol,session,net,screen,dialog,shell,Menu,desktopCapturer,powerSaveBlocker,Notification,clipboard,nativeImage}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {Files,normal}=require('./files.cjs');const {OfficeConverter}=require('./office.cjs');const {atomicJSON,readJSON,within,cleanTemps}=require('./core.cjs');
const {Recording}=require('./recording.cjs');const ai=require('./ai.cjs');const {createDock}=require('./dock.cjs');const {projection,authorizeMessage,applyMessage}=require('./gate.cjs');const {Ledger}=require('./ledger.cjs');const {Agents}=require('./agents.cjs');const {createReminders}=require('./remind.cjs');const {injectCookieShim}=require('./htmlshim.cjs');const exporter=require('./exporter.cjs');const {Study}=require('./study.cjs');const {Notify}=require('./notify.cjs');const warmup=require('./warmup.cjs');const {Manim}=require('./manim.cjs');const {ManimSetup}=require('./manimSetup.cjs');const {Reconciler}=require('./reconcile.cjs');const {Archive}=require('./archive.cjs');const {SCHEME,linkFromArgv}=require('./importLink.cjs');const {Updater}=require('./updater.cjs');const {Plugins}=require('./plugins.cjs');const agentKit=require('./agentKit.cjs');
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
 // 插件页面只能在自己的 plugin://<id>/ 里跳转，不能把框架导航到外部网站（防止带着数据跳走）
 wc.on('will-frame-navigate',ev=>{try{const from=ev.frame?.url||'';if(!/^plugin:/i.test(from))return;const a=new URL(from),b=new URL(ev.url);if(b.protocol!=='plugin:'||b.host!==a.host){ev.preventDefault();log.warn('拦截插件页面跳转',a.host,String(ev.url).slice(0,200));}}catch{ev.preventDefault();}});
 wc.on('unresponsive',()=>log.error('页面无响应',who()));
 wc.on('responsive',()=>log.info('页面恢复响应',who()));
 wc.on('did-fail-load',(_ev,code,desc,url,main)=>{if(main)log.warn('页面加载失败',who(),code,desc,String(url).slice(0,200));});
});
// 学生画面上的网页课件、插件（如计时器提示音）要能直接出声：学生窗口没人点，等不到「用户手势」
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{scheme:'studio',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}},{scheme:'lesson',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}},{scheme:'plugin',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
const files=new Files(path.join(DATA,'cache'));
const windows=new Map(),roles=new Map();let plugins,saved={},publicData={},settings,recording,saveTimer,saveQueue=Promise.resolve(),quitting=false,closing=false,blocker=null,ledger,agents,reminders,study,notifier,manim,reconciler,archive,updater;
const send=(win,ch,data)=>{if(win&&!win.isDestroyed()&&!win.webContents.isCrashed())win.webContents.send(ch,data);};
const notify=(type,value={})=>{if(value.error)log.warn('提示',type,value.message);for(const [role,w]of windows)if(role==='teacher')send(w,'cs:event',{type,...value});};
const busy=()=>['starting','recording','stopping'].includes(recording?.status.phase);
function safeRole(e){if(e.senderFrame!==e.sender.mainFrame)throw Error('课件页面没有桌面控制权限');const role=roles.get(e.sender.id);if(!role)throw Error('未知窗口');return role;}
function saving(){clearTimeout(saveTimer);const work=saveQueue.catch(()=>{}).then(()=>atomicJSON(path.join(DATA,'workspace.json'),{...saved,settings,capabilities:[...files.tokens],urls:[...files.urls],allowedRoots:[...files.roots]}));saveQueue=work.catch(e=>{notify('notice',{message:'本地保存失败：'+e.message,error:true});throw e;});return saveQueue;}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{void saving().catch(()=>{});},700);}
function rememberPublic(){
 const full=saved.shared??{},prior=full.ink??{},merged={...prior};
 for(const[k,v]of Object.entries(publicData.ink??{}))merged[k]=[...v,...(prior[k]??[]).filter(s=>s.layer==='private')];
 saved.shared={...full,...publicData,ink:merged};scheduleSave();
}
// net.fetch(file:) 收到 Range 时只截了内容，状态仍是 200、没有 Content-Range，Chromium 就认为视频不能拖动进度。
// 这里自己按 Range 读文件、回 206，本地视频才能任意跳转（Range 不传给 net.fetch，超出文件长度时它会直接报错）。
const noRange=req=>{const h=new Headers(req.headers);h.delete('range');return h;};
async function fileResponse(file,req,response,headers){
 headers.set('Accept-Ranges','bytes');
 const range=req.headers.get('range');
 if(!range||response.status!==200)return new Response(response.body,{status:response.status,headers});
 void response.body?.cancel().catch(()=>{});
 const size=(await fs.promises.stat(file)).size,m=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
 let start=m&&m[1]!==''?Number(m[1]):NaN,end=m&&m[2]!==''?Number(m[2]):size-1;
 if(m&&m[1]===''&&m[2]!==''){start=Math.max(0,size-Number(m[2]));end=size-1;}
 end=Math.min(end,size-1);
 if(!Number.isFinite(start)||start>end||start>=size){headers.set('Content-Range',`bytes */${size}`);headers.delete('content-length');return new Response(null,{status:416,headers});}
 headers.set('Content-Range',`bytes ${start}-${end}/${size}`);headers.set('Content-Length',String(end-start+1));
 return new Response(require('node:stream').Readable.toWeb(fs.createReadStream(file,{start,end})),{status:206,headers});
}
function guardSession(ses){
 ses.protocol.handle('studio',async req=>{try{const u=new URL(req.url);if(u.hostname!=='app')return new Response('Not found',{status:404});let rel=decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html';const base=rel.startsWith('recorder.')||rel.startsWith('snip.')?__dirname:path.join(ROOT,process.env.CS_DIST||'dist');const file=path.resolve(base,rel);if(!within(base,file))return new Response('Denied',{status:403});const response=await net.fetch(pathToFileURL(file).href);const headers=new Headers(response.headers);headers.set('Content-Security-Policy',"default-src 'self' lesson: data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' lesson: plugin: data: blob: https: http:; connect-src 'self' lesson: plugin: blob: https: http:; frame-src lesson: plugin: https: http: blob:; media-src 'self' lesson: blob: https: http:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'");return new Response(response.body,{status:response.status,headers});}catch{return new Response('Resource unavailable',{status:404});}});
 ses.protocol.handle('lesson',async req=>{try{const file=files.resolve(req.url);const response=await net.fetch(pathToFileURL(file).href,{headers:noRange(req)});const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');headers.set('X-Content-Type-Options','nosniff');if(/\.html?$/i.test(file)&&response.status===200&&!req.headers.get('range')){headers.delete('content-length');return new Response(injectCookieShim(Buffer.from(await response.arrayBuffer())),{status:200,headers});}return await fileResponse(file,req,response,headers);}catch{return new Response('课件文件已移动或不可读取',{status:404});}});
 // 插件：plugin://<id>/…，每个插件一个独立来源；页面注入 SDK，内容安全策略只放行 plugin.json 里写明的域名
 ses.protocol.handle('plugin',async req=>{try{const r=plugins?.resolve(req.url);if(!r)return new Response('<meta charset="utf-8"><body style="font:14px system-ui;color:#8a93a3;padding:24px">这个插件已停用，或者文件不存在。</body>',{status:404,headers:{'content-type':'text/html; charset=utf-8'}});const response=await net.fetch(pathToFileURL(r.file).href,{headers:noRange(req)});const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Cache-Control','no-store');headers.set('Access-Control-Allow-Origin','*');headers.set('Content-Security-Policy',plugins.csp(r.manifest||plugins.manifest(r.id)));if(/\.html?$/i.test(r.file)&&response.status===200&&!req.headers.get('range')){headers.delete('content-length');headers.set('content-type','text/html; charset=utf-8');return new Response(plugins.inject(Buffer.from(await response.arrayBuffer())),{status:200,headers});}return await fileResponse(r.file,req,response,headers);}catch{return new Response('插件文件不可读取',{status:404});}});
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
function exportDoc(file,formats,opts){const job=exportQueue.then(()=>exporter.exportMarkdown(file,formats,exportWindow,opts));exportQueue=job.catch(()=>{});return job;}
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
  if(role==='student'&&busy()){e.preventDefault();void closeStudentDuringLesson(w);}
 });
 w.on('closed',()=>{roles.delete(contentId);windows.delete(role);});
 if(role==='student')w.on('minimize',()=>{if(busy()){w.restore();notify('notice',{message:'录课期间请保持学生窗口展开，确保画面持续刷新。'});}});
 await w.loadURL(role==='recorder'?'studio://app/recorder.html':`studio://app/index.html?w=${role}`);
 if(role!=='recorder'&&!TEST)w.show();
 return w;
}
async function closeApp(){
 if(closing)return;closing=true;
 try{if(busy()){const {response}=await dialog.showMessageBox(windows.get('teacher'),{type:'question',buttons:['继续上课','下课保存后退出'],defaultId:0,cancelId:0,message:'课堂录像还在进行，是否先保存？'});if(response===0)return;await recording.stop();if(!(await recording.settle(180000))){notify('notice',{message:'录像仍在收尾，完成后可以关闭。'});return;}}
  if(recording.jobs.length&&!TEST){const j=recording.jobs[0];const {response}=await dialog.showMessageBox(windows.get('teacher'),{type:'question',buttons:['等它生成完','现在退出'],defaultId:0,cancelId:0,message:`回放视频还在生成（${Math.round((j.progress||0)*100)}%）`,detail:'原始录像已经安全保存。现在退出的话，下次打开软件会自动接着生成。'});if(response===0)return;recording.killAll();}
  await windows.get('teacher')?.webContents.executeJavaScript("window.dispatchEvent(new Event('pagehide')); true").catch(()=>{});await new Promise(r=>setTimeout(r,200));await saving();await study?.queue.catch(()=>{});quitting=true;app.quit();
 }finally{closing=false;}
}
/** 录课中关学生窗口：问一句，选「下课」就保存录像后直接关（MP4 在后台生成，不用等） */
let askingClose=false;
async function closeStudentDuringLesson(w){
 if(askingClose)return;askingClose=true;
 try{
  const {response}=await dialog.showMessageBox(w,{type:'question',buttons:['继续上课','下课并保存录像，关闭窗口'],defaultId:0,cancelId:0,message:'这节课还在录像',detail:'选择「下课并保存录像」后窗口会马上关闭，回放视频在后台生成，不影响开始下一节课。'});
  if(response!==1)return;
  await recording.stop();await recording.settle(60000);
  if(!w.isDestroyed())w.close();
 }finally{askingClose=false;}
}
const onSystemDrive=p=>process.platform==='win32'&&path.parse(path.resolve(p)).root.toUpperCase().startsWith((process.env.SystemDrive||'C:').toUpperCase());
/** 换录像目录：原来有录像就问要不要一起搬过去（跨盘时复制后删除原文件） */
async function changeRecordings(dir){
 const old=settings.recordings;if(path.resolve(old)===path.resolve(dir))return;
 const rows=TEST?[]:await recording.list().catch(()=>[]);
 settings.recordings=dir;recording.directory=dir;await fs.promises.mkdir(dir,{recursive:true});await saving();
 if(!rows.length)return;
 const gb=(rows.reduce((a,r)=>a+(r.bytes||0),0)/1024**3).toFixed(1);
 const {response}=await dialog.showMessageBox(windows.get('teacher'),{type:'question',buttons:['一起搬过去','不用，留在原处'],defaultId:0,cancelId:1,message:`要把已有的 ${rows.length} 段录像（${gb} GB）搬到新位置吗？`,detail:'搬过去之后原位置的空间会释放出来。录像较多时需要几分钟，期间可以正常使用。'});
 if(response!==0)return;
 notify('notice',{message:`正在把 ${rows.length} 段录像搬到 ${dir} …`});
 let moved=0;
 for(const r of rows){const target=path.join(dir,path.basename(r.folder));try{if(fs.existsSync(target))continue;try{await fs.promises.rename(r.folder,target);}catch(e){if(e.code!=='EXDEV')throw e;await fs.promises.cp(r.folder,target,{recursive:true,errorOnExist:true});await fs.promises.rm(r.folder,{recursive:true,force:true});}moved++;}catch(e){log.warn('搬录像失败',r.folder,e.message);}}
 notify('notice',{message:`已把 ${moved} 段录像搬到 ${dir}`});notify('recording',{status:recording.status});
}
// ── 桌面快捷方式（Windows）/ 移到「应用程序」（macOS） ────────────
const shortcutPaths=()=>[path.join(app.getPath('desktop'),'最强网课教辅系统.lnk'),path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs','最强网课教辅系统.lnk')];
function shortcutState(){
 if(process.platform==='win32'){const [desk]=shortcutPaths();let ok=false;try{ok=fs.existsSync(desk)&&path.resolve(shell.readShortcutLink(desk).target)===path.resolve(process.execPath);}catch{}return {platform:'win32',desktop:ok};}
 if(process.platform==='darwin')return {platform:'darwin',inApplications:app.isInApplicationsFolder()};
 return {platform:process.platform};
}
function createShortcuts(manual=false){
 if(process.platform==='darwin'){if(app.isInApplicationsFolder())return {...shortcutState(),message:'已经在「应用程序」里了，可以在启动台找到；想放进程序坞，打开后右键程序坞图标 →「选项」→「在程序坞中保留」。'};if(TEST)return shortcutState();try{app.moveToApplicationsFolder();}catch(e){throw Error('没能移动到「应用程序」：'+e.message+'。可以手动把软件拖进「应用程序」文件夹。');}return shortcutState();}
 if(process.platform!=='win32')throw Error('这个系统请手动创建启动方式');
 const opts={target:process.execPath,cwd:path.dirname(process.execPath),description:'最强网课教辅系统',icon:process.execPath,iconIndex:0};
 let made=0;for(const p of shortcutPaths()){try{fs.mkdirSync(path.dirname(p),{recursive:true});if(shell.writeShortcutLink(p,fs.existsSync(p)?'replace':'create',opts))made++;}catch(e){log.warn('创建快捷方式失败',p,e.message);}}
 if(!made)throw Error('没能创建快捷方式，可能是桌面目录没有写入权限');
 saved.shortcut=true;scheduleSave();log.info('快捷方式',manual?'手动创建':'首次启动创建');
 return {...shortcutState(),message:'已在桌面和开始菜单创建快捷方式'};
}
/** 软件被挪了位置：已经建过的快捷方式指向旧位置，悄悄改到新位置 */
function repairShortcuts(){
 if(process.platform!=='win32'||!saved.shortcut||!app.isPackaged)return;
 for(const p of shortcutPaths()){try{if(fs.existsSync(p)&&path.resolve(shell.readShortcutLink(p).target)!==path.resolve(process.execPath))shell.writeShortcutLink(p,'replace',{target:process.execPath,cwd:path.dirname(process.execPath),icon:process.execPath,iconIndex:0,description:'最强网课教辅系统'});}catch{}}
}
/** Windows 上找空间最大的本地硬盘（排除系统盘和 U 盘） */
async function bestDataDrive(){
 if(process.platform!=='win32')return null;
 try{const {runProcess}=require('./recording.cjs');const out=await runProcess('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { $_.DeviceID + "|" + $_.FreeSpace }'],{timeout:20000});
  const sys=(process.env.SystemDrive||'C:').toUpperCase();
  return out.split(/\r?\n/).map(l=>l.trim().split('|')).filter(([d,f])=>/^[A-Z]:$/i.test(d||'')&&d.toUpperCase()!==sys&&Number(f)>20*1024**3).map(([d,f])=>({drive:d.toUpperCase(),free:Number(f)})).sort((a,b)=>b.free-a.free)[0]??null;
 }catch(e){log.warn('查找数据盘失败',e.message);return null;}
}
/** 首次启动：问一次要不要建桌面快捷方式；录像目录在系统盘时建议换到空间大的盘。都只问一次。 */
async function firstRunPrompts(){
 if(TEST||!app.isPackaged)return;
 const t=windows.get('teacher');if(!t||t.isDestroyed())return;
 if(!saved.askedShortcut){
  saved.askedShortcut=true;scheduleSave();
  if(process.platform==='win32'&&!shortcutState().desktop){const {response}=await dialog.showMessageBox(t,{type:'question',buttons:['创建快捷方式','不用了'],defaultId:0,cancelId:1,message:'要在桌面创建「最强网课教辅系统」的快捷方式吗？',detail:'以后双击桌面图标就能打开。也可以随时在「设置 → 窗口、录课与回放」里添加。'});if(response===0)try{createShortcuts();}catch(e){notify('notice',{message:e.message,error:true});}}
  else if(process.platform==='darwin'&&!app.isInApplicationsFolder()){const {response}=await dialog.showMessageBox(t,{type:'question',buttons:['移到「应用程序」','以后再说'],defaultId:0,cancelId:1,message:'要把软件移到「应用程序」文件夹吗？',detail:'移过去以后可以在启动台里打开，也能放进程序坞。软件会自动重新打开。'});if(response===0)try{createShortcuts();}catch(e){notify('notice',{message:e.message,error:true});}}
 }
 if(!saved.askedRecordings&&onSystemDrive(settings.recordings)){
  saved.askedRecordings=true;scheduleSave();
  const best=await bestDataDrive();if(!best)return;
  const target=path.join(best.drive+'\\','ClassroomStudioData','recordings');
  const {response}=await dialog.showMessageBox(t,{type:'question',buttons:[`改到 ${best.drive} 盘`,'保持在 C 盘'],defaultId:0,cancelId:1,message:'课堂录像现在保存在系统盘（C 盘），容易把 C 盘占满',detail:`建议改到 ${best.drive} 盘（剩余 ${(best.free/1024**3).toFixed(0)} GB）：\n${target}\n以后也可以在「设置 → 窗口、录课与回放」里更换。`});
  if(response===0)try{await changeRecordings(target);notify('notice',{message:'录像以后保存到 '+target});}catch(e){notify('notice',{message:'更换录像目录失败：'+e.message,error:true});}
 }
}
// ── 框选截屏：先把导播台和浮层让开，截整屏，再在截图上框选 ────────────
let snipping=null;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function screenSnip(){
 if(snipping)throw Error('正在截屏，先完成上一次');
 const t=windows.get('teacher'),d=dockManager.window;
 const tShown=!!(t&&!t.isDestroyed()&&t.isVisible()&&!t.isMinimized()),dShown=!!(d&&!d.isDestroyed()&&d.isVisible());
 const images=path.join(files.cache,'images');await fs.promises.mkdir(images,{recursive:true});
 const temp=path.join(images,'snip-'+Date.now()+'.png');let win=null;
 snipping=true;
 try{
  // 导播台用透明度让开而不是最小化：截完原样恢复，不会跳到学生窗口前面
  if(tShown)t.setOpacity(0);if(dShown)d.hide();
  await pause(process.platform==='darwin'?500:350);
  const disp=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),sf=disp.scaleFactor||1;
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(disp.size.width*sf),height:Math.round(disp.size.height*sf)}});
  const src=sources.find(s=>String(s.display_id)===String(disp.id))??sources[0];
  if(!src||src.thumbnail.isEmpty())throw Error(process.platform==='darwin'?'没能截到屏幕：请在「系统设置 → 隐私与安全性 → 屏幕录制」里允许「最强网课教辅系统」，然后重新打开软件':'没能截到屏幕');
  const full=src.thumbnail;await fs.promises.writeFile(temp,full.toPNG());
  const ses=session.fromPartition('studio-snip');if(!ses.csReady){guardSession(ses);ses.csReady=true;}
  win=new BrowserWindow({...disp.bounds,frame:false,show:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,enableLargerThanScreen:true,hasShadow:false,backgroundColor:'#000000',webPreferences:{preload:path.join(__dirname,'snip-preload.cjs'),session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setAlwaysOnTop(true,'screen-saver');win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  const wc=win.webContents;
  const picked=new Promise(resolve=>{const h=(e,r)=>{if(e.sender!==wc)return;ipcMain.removeListener('cs:snip',h);resolve(r);};ipcMain.on('cs:snip',h);win.on('closed',()=>{ipcMain.removeListener('cs:snip',h);resolve(null);});});
  await win.loadURL('studio://app/snip.html?img='+encodeURIComponent(files.url(temp)));
  if(TEST&&process.env.CS_SHOW!=='1')win.setBounds({...disp.bounds,x:disp.bounds.x-6000});else win.setBounds(disp.bounds);
  win.show();win.focus();
  const r=await picked;
  if(!r||!(r.width>2&&r.height>2))return null;
  const k=full.getSize().width/Math.max(1,r.viewW||disp.bounds.width),ky=full.getSize().height/Math.max(1,r.viewH||disp.bounds.height);
  const area={x:Math.max(0,Math.round(r.x*k)),y:Math.max(0,Math.round(r.y*ky)),width:Math.round(r.width*k),height:Math.round(r.height*ky)};
  area.width=Math.min(area.width,full.getSize().width-area.x);area.height=Math.min(area.height,full.getSize().height-area.y);
  const out=path.join(images,require('node:crypto').randomUUID()+'.png');await fs.promises.writeFile(out,full.crop(area).toPNG());
  log.info('框选截屏',area.width+'×'+area.height);
  return normal(out);
 }finally{
  if(win&&!win.isDestroyed())win.destroy();
  fs.promises.unlink(temp).catch(()=>{});
  if(tShown&&t&&!t.isDestroyed())t.setOpacity(1);
  if(dShown)dockManager.sync();
  snipping=null;
 }
}
/**
 * 粘贴事件里拿不到图片时，从系统剪贴板兜底：位图；复制的图片文件（微信 / QQ 里「复制」图片常常是文件）；网页里复制的 <img>。
 * 返回 data: 地址，没有图片返回 null。
 */
const IMG_EXT=/\.(png|jpe?g|bmp|gif|webp)$/i;
async function clipboardImage(){
 // Electron 44 的剪贴板是网页式接口：位图是 image/png，复制的文件是 text/uri-list（file:/// 地址）
 const items=await clipboard.read().catch(()=>[]);
 const get=async(type)=>{for(const it of items)if(it.types.includes(type))try{return await it.getType(type);}catch{}return null;};
 for(const type of ['image/png','image/jpeg']){const b=await get(type);if(b&&b.size>0&&b.size<40*1024*1024)return 'data:'+type+';base64,'+Buffer.from(await b.arrayBuffer()).toString('base64');}
 const paths=[],url=require('node:url');
 const list=await get('text/uri-list');
 if(list)for(const u of (await list.text()).split(/\r?\n/))if(/^file:\/\//i.test(u.trim()))try{paths.push(url.fileURLToPath(u.trim()));}catch{}
 const html=await get('text/html'),src=html?/<img[^>]+src=["']([^"']+)["']/i.exec(await html.text())?.[1]:null;
 if(src&&/^data:image\/(png|jpeg|gif|webp|bmp);base64,/.test(src)&&src.length<40*1024*1024)return src;
 if(src&&/^file:\/\//i.test(src))try{paths.push(url.fileURLToPath(src));}catch{}
 for(const p of paths){
  if(!IMG_EXT.test(p))continue;
  try{const st=fs.statSync(p);if(!st.isFile()||st.size>30*1024*1024)continue;
   const ni=nativeImage.createFromPath(p);if(!ni.isEmpty())return ni.toDataURL();
   const ext=path.extname(p).slice(1).toLowerCase().replace('jpg','jpeg');return 'data:image/'+ext+';base64,'+fs.readFileSync(p).toString('base64');}catch{}
 }
 return null;
}
function canUsePath(role,p){if(/^https?:\/\//i.test(p)){const u=new URL(p);if(u.username||u.password)throw Error('网址不能包含凭据');return u.href;}if(role==='teacher'||role==='dock')return files.allowed(p);if(within(path.join(files.cache,'images'),path.resolve(p)))return files.allowed(p);const mat=publicData.pgmMat;if(mat&&(p===mat.src?.path||p===mat.src?.pdf||mat.pages?.some(x=>x.doc?.pdf===p||x.src===p)))return files.allowed(p);if(publicData.warm?.some(x=>x.path===p))return files.allowed(p);throw Error('只能访问正在展示或老师预加载的课件');}
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
 // 学生窗口里 Ctrl+V / 拖入图片贴到黑板：老师拿着笔，或学生工具开放时都可以
 if((method==='saveImage'||method==='clipboardImage')&&role==='student'&&publicData.drawAuthor!=='teacher'&&publicData.studentTools!=='open')throw Error('老师锁定了学生工具，现在不能贴图');
 if(method==='clipboardImage'&&(trusted||role==='student'))return clipboardImage();
 // 学生画面里打开的插件课件：只能存取自己的数据、报告错误
 if(role==='student'&&(method==='plugins.storage'||method==='plugins.error'))return pluginCall(method,value,e);
 if(!trusted&&method!=='saveImage')throw Error('此操作仅在教师窗口可用');
 if(typeof method==='string'&&method.startsWith('ai.'))return ai.handle(method,value,{windows,dataDir:DATA,sender:e.sender,ledger,reconciler});
 if(typeof method==='string'&&method.startsWith('agents.'))return agentCall(method,value);
 if(typeof method==='string'&&method.startsWith('study.'))return studyCall(method,value);
 if(typeof method==='string'&&method.startsWith('notify.'))return notifier.handle(method,value);
 if(typeof method==='string'&&method.startsWith('manim.'))return manim.handle(method,value);
 if(typeof method==='string'&&method.startsWith('motion.'))return motionCall(method,value);
 if(typeof method==='string'&&method.startsWith('update.'))return updateCall(method,value);
 if(typeof method==='string'&&method.startsWith('plugins.'))return pluginCall(method,value,e);
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
 case 'pickRecordings':{if(busy()||recording.jobs.length)throw Error('录像保存、回放生成完以后再修改目录');const r=await dialog.showOpenDialog(windows.get('teacher'),{title:'选择录像保存目录',properties:['openDirectory','createDirectory']});if(!r.canceled)await changeRecordings(r.filePaths[0]);return settings.recordings;}
 case 'startLesson':{await makeWindow('student');if(busy())return recording.status;await makeWindow('recorder');if(blocker===null)blocker=powerSaveBlocker.start('prevent-display-sleep');return recording.start({...settings,studentId:value?.studentId,title:value?.title},TEST&&value?.synthetic===true);}
 case 'stopLesson':return recording.stop();
 case 'recordStatus':return recording.status;
 case 'recordings':return recording.list();
 case 'recoverRecording':{const item=(await recording.list()).find(x=>x.id===value);if(!item)throw Error('找不到这段录像');if(item.phase==='converting')return null;return recording.enqueue(item.folder,{id:item.id,title:item.title,studentId:item.studentId});}
 case 'deleteRecording':{const folder=await recording.remove(value);if(TEST)await fs.promises.rm(folder,{recursive:true,force:true});else await shell.trashItem(folder);log.info('删除录像',folder);return true;}
 case 'recordingsInfo':{const rows=await recording.list();const disk=await recording.disk(settings.recordings);return {dir:normal(settings.recordings),free:disk.free,total:disk.total,used:rows.reduce((a,r)=>a+(r.bytes||0),0),count:rows.length,systemDrive:onSystemDrive(settings.recordings)};}
 case 'nextLesson':{if(!busy())throw Error('现在没有在录课');await recording.stop();if(!(await recording.settle(60000)))throw Error('上一节还没收尾，请稍后再点');await makeWindow('recorder');if(blocker===null)blocker=powerSaveBlocker.start('prevent-display-sleep');return recording.start({...settings,studentId:value?.studentId,title:value?.title},TEST&&value?.synthetic===true);}
 case 'shortcut.create':return createShortcuts(true);
 case 'shortcut.state':return shortcutState();
 case 'openRecording':{const item=(await recording.list()).find(x=>x.id===value);if(!item)throw Error('找不到这段录像');const err=await shell.openPath(item.phase==='complete'?item.mp4:item.raw);if(err)throw Error(err);return;}
 case 'recordingsFolder':await fs.promises.mkdir(settings.recordings,{recursive:true});return shell.openPath(settings.recordings);
 case 'exportBoard':{const w=await makeWindow('student'),r=await dialog.showSaveDialog(windows.get('teacher'),{title:'保存当前板书',defaultPath:path.join(settings.recordings,'课堂板书-'+Date.now()+'.png'),filters:[{name:'PNG',extensions:['png']}]});if(r.canceled)return null;await fs.promises.writeFile(r.filePath,(await w.webContents.capturePage()).toPNG());return r.filePath;}
 case 'screenSnip':return screenSnip();
 case 'notice':notify('notice',{message:String(value||'').slice(0,300),error:true});return;
 case 'saveImage':{if(typeof value!=='string'||value.length>50*1024*1024||!value.startsWith('data:image/png;base64,'))throw Error('图片数据无效');const file=path.join(files.cache,'images',require('node:crypto').randomUUID()+'.png');await fs.promises.mkdir(path.dirname(file),{recursive:true});await fs.promises.writeFile(file,Buffer.from(value.split(',')[1],'base64'));return normal(file);}
 default:throw Error('未实现的桌面操作：'+method);
 }
});
// 课堂动画导出的 MP4：先存进缓存目录（上屏、预览都用它），老师要留底再另存一份
async function motionCall(method,value){
 const dir=path.join(files.cache,'motion'),safe=t=>String(t||'课堂动画').replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,40);
 switch(method){
 case 'motion.save':{
  const data=value?.data;
  if(!(data instanceof Uint8Array)||data.length<1024||data.length>2*1024**3||Buffer.from(data.subarray(4,8)).toString()!=='ftyp')throw Error('视频数据无效');
  await fs.promises.mkdir(dir,{recursive:true});
  // 缓存里只留最近 7 天的
  for(const f of await fs.promises.readdir(dir).catch(()=>[])){const p=path.join(dir,f);try{if(Date.now()-(await fs.promises.stat(p)).mtimeMs>7*864e5)await fs.promises.rm(p,{force:true});}catch{}}
  const file=path.join(dir,safe(value.title)+'-'+Date.now()+'.mp4');
  await fs.promises.writeFile(file,data);log.info('课堂动画导出',file,data.length);
  return normal(file);}
 case 'motion.saveAs':{
  const src=path.resolve(String(value?.path||''));
  if(!within(dir,src)||!fs.existsSync(src))throw Error('找不到导出的视频，请重新导出');
  const to=TEST&&value.to?String(value.to):(await dialog.showSaveDialog(windows.get('teacher'),{title:'保存课堂动画',defaultPath:path.join(settings.recordings||app.getPath('videos'),safe(value.title)+'.mp4'),filters:[{name:'MP4 视频',extensions:['mp4']}]})).filePath;
  if(!to)return null;
  await fs.promises.copyFile(src,to);
  if(!TEST)shell.showItemInFolder(to);
  return normal(to);}
 default:throw Error('未知的动画操作：'+method);
 }
}
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
async function pluginCall(method,value,e){
 const v=value||{},owner=BrowserWindow.fromWebContents(e.sender)||windows.get('teacher');
 switch(method){
 case 'plugins.list':return plugins.list();
 case 'plugins.pickImport':{const folder=v.folder===true;const r=await dialog.showOpenDialog(owner,folder?{title:'选择插件文件夹（里面有 plugin.json）',properties:['openDirectory']}:{title:'导入插件',properties:['openFile'],filters:[{name:'插件包',extensions:['csplugin','zip']}]});if(r.canceled||!r.filePaths[0])return null;return plugins.stage(r.filePaths[0]);}
 case 'plugins.inspectPath':{canUsePath('teacher',v.path);return plugins.stage(v.path);}
 case 'plugins.install':return plugins.install(v.token);
 case 'plugins.discard':plugins.discard(v.token);return true;
 case 'plugins.enable':return plugins.setEnabled(v.id,!!v.on);
 case 'plugins.pause':return plugins.setPaused(!!v.on);
 case 'plugins.remove':return plugins.remove(v.id);
 case 'plugins.export':{const p=plugins.pack(v.id);const to=TEST&&v.to?String(v.to):(await dialog.showSaveDialog(owner,{title:'导出插件',defaultPath:path.join(app.getPath('desktop'),p.name.replace(/[\\/:*?"<>|]/g,'_')),filters:[{name:'插件包',extensions:['csplugin']}]})).filePath;if(!to)return null;fs.writeFileSync(to,p.data);if(!TEST)shell.showItemInFolder(to);return normal(to);}
 case 'plugins.duplicate':return plugins.duplicate(v.id);
 case 'plugins.history':return plugins.history(v.id);
 case 'plugins.rollback':return plugins.rollback(v.id,v.name);
 case 'plugins.error':{const r=plugins.error(String(v.id||''),String(v.message||''));if(r.disabled)notify('notice',{message:`插件「${r.name}」频繁出错，已自动停用。可以在「插件」页重新打开或删除。`,error:true});return r;}
 case 'plugins.storage':return plugins.storage(String(v.id||''),v.op,v.key,v.value);
 case 'plugins.examples':return plugins.examples();
 case 'plugins.stageExample':return plugins.stageExample(v.folder);
 case 'plugins.setTemplate':return plugins.setTemplate(v.kind,v.ref||'');
 case 'plugins.skills':return plugins.skills().map(({dir,...s})=>s);
 // 插件请老师选文件：只把老师选中的文件内容交给插件，插件拿不到路径
 case 'plugins.pickFile':{const kinds={image:['png','jpg','jpeg','gif','webp','svg','bmp'],text:['txt','md','csv','json','tex','html'],pdf:['pdf'],doc:['docx','doc','pptx','xlsx','pdf']};const ext=kinds[v.accept];const r=await dialog.showOpenDialog(owner,{title:String(v.title||'选择文件').slice(0,40),properties:['openFile',...(v.multiple?['multiSelections']:[])],filters:ext?[{name:'文件',extensions:ext}]:[]});if(r.canceled)return [];const out=[];for(const p of r.filePaths.slice(0,5)){const st=await fs.promises.stat(p);if(st.size>20*1024*1024)throw Error('文件太大（超过 20 MB）：'+path.basename(p));const ext2=path.extname(p).slice(1).toLowerCase();const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',bmp:'image/bmp',pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json',html:'text/html',tex:'text/plain'}[ext2]||'application/octet-stream';const buf=await fs.promises.readFile(p);out.push({name:path.basename(p),size:st.size,type:mime,dataUrl:`data:${mime};base64,${buf.toString('base64')}`,...(/^text\/|json/.test(mime)?{text:buf.toString('utf8')}:{})});}return out;}
 case 'plugins.reveal':{const id=plugins.safeId(v.id);const d=path.join(plugins.installedDir,id);if(!TEST)await shell.openPath(d);return normal(d);}
 default:throw Error('未知的插件操作：'+method);
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
 case 'agents.start':{const v=value||{};let pluginFrom='';if(v.kind==='plugin'&&v.pluginId){pluginFrom=path.join(plugins.installedDir,plugins.safeId(v.pluginId));if(!fs.existsSync(path.join(pluginFrom,'plugin.json')))throw Error('没有这个插件');}const t=agents.start({engine:v.engine,title:v.title,prompt:v.prompt,context:v.context,cap:v.cap,useStudioKey:!!v.useStudioKey,formats:v.formats,model:v.model,permission:v.permission,skill:v.skill,kind:v.kind,effort:v.effort,attachments:v.attachments,pluginFrom});log.info('后台任务开始',t.id,t.engine,t.permission,t.kind||'',t.title);return t;}
 case 'agents.configure':return agents.configure(value?.id,value||{});
 case 'agents.inject':return agents.inject(value?.id,value?.text,value?.attachments);
 case 'agents.pickAttach':{const r=await dialog.showOpenDialog(windows.get('teacher'),{title:'添加附件（图片、Word、PDF 等）',properties:['openFile','multiSelections'],filters:[{name:'图片和文档',extensions:['png','jpg','jpeg','webp','gif','pdf','docx','doc','pptx','xlsx','txt','md','csv','json','html','svg']},{name:'所有文件',extensions:['*']}]});return r.canceled?[]:r.filePaths.slice(0,8).map(normal);}
 // AI 工坊：任务里正在做的插件挂到 plugin://dev-<任务>/ 预览，满意了装上
 case 'agents.pluginPreview':{const t=agents.get(value?.id);if(!t.pluginDir)throw Error('这个任务不是做插件的');const id=plugins.setDev(t.id,t.pluginDir);const r=agents.checkPlugin(agents.tasks.get(t.id));return {id,manifest:r.manifest,problems:r.problems,files:r.files?.length||0,bytes:r.bytes||0};}
 case 'agents.pluginInstall':{const t=agents.get(value?.id);if(!t.pluginDir)throw Error('这个任务不是做插件的');if(t.status==='running')throw Error('AI 还在改这个插件，等这一轮做完再装');const k=plugins.setDev(t.id,t.pluginDir).slice(4);const p=plugins.installDev(k);log.info('AI 工坊插件已安装',p.id,p.version,t.id);return p;}
 case 'agents.stop':return agents.stop(value);
 case 'agents.calibrate':return agents.calibrate(value?.id,value?.actual);
 case 'agents.remove':{agents.remove(value);try{plugins.setDev(String(value),null);}catch{}return;}
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
 case 'study.pickImport':{const r=await dialog.showOpenDialog(windows.get('teacher'),{title:'导入题目（Word / PDF / 图片）',properties:['openFile','multiSelections'],filters:[{name:'试卷、作业、截图',extensions:['docx','doc','pdf','rtf','png','jpg','jpeg','bmp','webp','txt','md']}]});return r.canceled?[]:r.filePaths.map(p=>files.authorize(p));}
 case 'study.ocr':return files.ocrImages(value);
 case 'study.pickSchedule':{const r=await dialog.showOpenDialog(windows.get('teacher'),{title:'导入课表（Excel / Word / PDF / 图片 / 文字）',properties:['openFile'],filters:[{name:'课表',extensions:['xlsx','xls','et','csv','docx','doc','rtf','pdf','txt','md','png','jpg','jpeg','bmp','webp']}]});return r.canceled?null:files.authorize(r.filePaths[0]);}
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
 plugins=new Plugins({dir:path.join(DATA,'plugins'),log,emit:m=>notify(m.type,m)});
 if(plugins.safeMode)log.warn('插件：上两次启动没有正常运行，这次不加载插件');
 // 正常跑满 1 分钟算启动成功，清掉「连续启动失败」计数
 setTimeout(()=>plugins.stable(),TEST?3000:60000);
 agentKit.setExtra(()=>plugins.skills());
 agents=new Agents({dir:path.join(DATA,'agents'),toolsDir:path.join(DATA,'tools'),fetch:(u,o)=>net.fetch(u,o),ledger,credentials:()=>ai.credentials(DATA),log,emit:m=>notify('agent',{agent:m}),exporter:exportDoc,onCharge:()=>reconciler?.soon(120000),imageGen:(v)=>ai.handle('ai.image',v,{windows,dataDir:DATA,ledger,reconciler})});
 reconciler=new Reconciler({ledger,credentials:()=>ai.credentials(DATA),log,emit:m=>{if(m.tasks?.length)agents.refreshCost(m.tasks);notify('ledger',m);}});if(!TEST)reconciler.start();try{files.authorize(agents.dir,true);}catch{}
 study=new Study({dir:path.join(DATA,'study'),exportDoc,log});files.authorize(study.dir,true);study.templateCss=kind=>plugins.templateCss(kind);
 notifier=new Notify({dir:DATA,root:study.dir,test:TEST,log});
 manim=new Manim({dir:path.join(files.cache,'manim'),log,test:TEST,ffmpeg:path.join(ROOT,'bin',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),setup:new ManimSetup({dir:path.join(DATA,'tools','manim'),fetch:(u,o)=>net.fetch(u,o),log,emit:state=>notify('manimSetup',{state}),...(TEST&&process.env.CS_MANIM_SETUP?JSON.parse(process.env.CS_MANIM_SETUP):{})})});await fs.promises.mkdir(manim.dir,{recursive:true});
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
 recording=new Recording({directory:settings.recordings,ffmpeg:path.join(ROOT,'bin',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),onChange:status=>{notify('recording',{status});if(!['starting','recording','stopping'].includes(status.phase)&&blocker!==null){powerSaveBlocker.stop(blocker);blocker=null;}},send:m=>send(windows.get('recorder'),'cs:event',m),onSaved:r=>{log.info('回放已生成',r.path);notify('recordSaved',{record:{id:r.id,title:r.title,studentId:r.studentId}});}});
 // 自动更新：清单地址和公钥可以用环境变量换成测试服务器（两个都给才生效）
 const feed=process.env.CS_UPDATE_FEED,pub=process.env.CS_UPDATE_PUBKEY;
 updater=new Updater({appRoot:ROOT,version:VERSION,dataDir:DATA,fetch:(u,o)=>net.fetch(u,o),log,emit:s=>notify('update',{update:s}),packaged:app.isPackaged,...(feed&&pub?{feeds:[feed],publicKey:pub}:{})});
 const lastUpdate=updater.takeResult();
 // macOS 没有菜单时输入框里的 ⌘C / ⌘V 都不能用，留一个最小的系统菜单
 Menu.setApplicationMenu(process.platform==='darwin'?Menu.buildFromTemplate([{role:'appMenu',label:'最强网课教辅系统'},{role:'editMenu',label:'编辑'},{role:'windowMenu',label:'窗口'}]):null);await makeWindow('teacher');await makeWindow('student');if(!TEST)await dockManager.ensure();
 if(lastUpdate)setTimeout(()=>notify('update',{update:{phase:lastUpdate.ok?'done':'failed',result:lastUpdate}}),2500);
 if(!TEST){void recording.resume();repairShortcuts();setTimeout(()=>void firstRunPrompts().catch(e=>log.warn('首次启动提示',e.message)),4000);}
 if(!TEST){const auto=()=>{if(settings.updateCheck!==false)void updater.check();};setTimeout(auto,20000);setInterval(auto,12*3600000).unref?.();}
 if(TEST)globalThis.classroomStudioTest={get updater(){return updater;},windows,roles,files,recording,dock:dockManager,data:DATA,get saved(){return saved;},get publicData(){return publicData;},makeWindow,saving,get agents(){return agents;},get study(){return study;},get notifier(){return notifier;},get manim(){return manim;},get archive(){return archive;},get ledger(){return ledger;},get reconciler(){return reconciler;},get settings(){return settings;},get plugins(){return plugins;},remindLesson,exportDoc,offerLink:l=>offerLink(l)};
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
