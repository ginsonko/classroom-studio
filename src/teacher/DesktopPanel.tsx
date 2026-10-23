import {useEffect,useRef,useState} from 'react';
import {FolderOpen,MonitorUp,Video,X,Download} from 'lucide-react';
import {host,type DisplayInfo} from '../lib/host';
import {isLive,useRecording} from '../lib/recording';
import {toast} from '../lib/toast';
import {useStore} from '../lib/store';
import {redetect,setAnswerAutoDetect} from '../doc/answers';
import {saveBoard,saveBoardPdf} from '../ink/boardExport';
import {ToolbarEditor} from '../ui/ToolbarEditor';
import {TOOL_META} from '../ui/ToolPalette';
import {isLong} from '../lib/longBoard';
import '../styles/desktop.css';
type Settings={recordings:string;microphone:boolean;systemAudio:boolean;bitrate:number;captureGuard?:boolean;remindMinutes?:number;autostart?:boolean};
type Recording={id:string;createdAt:string;phase:string;bytes:number;folder:string;mp4:string;title?:string;studentId?:string|null};
type ShortcutState={platform:string;desktop?:boolean;inApplications?:boolean};
export function DesktopPanel(){
 const [settings,setSettings]=useState<Settings|null>(null),[displays,setDisplays]=useState<DisplayInfo[]>([]),[rows,setRows]=useState<Recording[]>([]),[error,setError]=useState('');
 const phase=useRecording(s=>s.status.phase),busy=isLive(phase),jobs=useRecording(s=>s.status.jobs?.length??0);
 const [shortcut,setShortcut]=useState<ShortcutState|null>(null);
 useEffect(()=>{if(host.electron)host.call<ShortcutState>('shortcut.state').then(setShortcut).catch(()=>{});},[]);
 const st=useStore();
 const recordsRef=useRef<HTMLDivElement>(null),toRecords=useRecording(s=>s.panel==='records');
 // 设置读回来之前上面的几节还没渲染，等内容齐了再滚
 useEffect(()=>{if(!toRecords||!settings)return;const t=setTimeout(()=>{const sec=recordsRef.current,body=sec?.parentElement;if(sec&&body)body.scrollTop+=sec.getBoundingClientRect().top-body.getBoundingClientRect().top;},60);return()=>clearTimeout(t);},[toRecords,rows.length,settings]);
 const refresh=()=>host.call<Recording[]>('recordings').then(setRows);
 useEffect(()=>{Promise.all([host.call<Settings>('settings'),host.displays(),host.call<Recording[]>('recordings')]).then(([s,d,r])=>{setSettings(s);setDisplays(d);setRows(r);}).catch(e=>setError(e.message));},[]);
 useEffect(()=>{if(phase==='complete'||phase==='recoverable')void refresh();},[phase]);
 const run=async(fn:()=>Promise<unknown>)=>{try{setError('');await fn();}catch(e){setError((e as Error).message);}};
 const multi=st.pgmMat.kind==='board'&&!isLong(st.pgmMat)&&st.pgmMat.pages.length>1;
 const done=(f:string[]|null)=>{if(f?.length)toast(f.length>1?`板书已保存，共 ${f.length} 张`:'板书已保存');};
 const update=(p:Partial<Settings>)=>void run(async()=>setSettings(await host.call<Settings>('setSettings',p)));
 return <div className="desktop-backdrop" onClick={()=>useRecording.setState({panel:false})}><section className="desktop-panel" onClick={e=>e.stopPropagation()}>
  <header><div><small>LOCAL STUDIO</small><h2>窗口、录课与回放</h2></div><button className="ico" aria-label="关闭设置" onClick={()=>useRecording.setState({panel:false})}><X size={19}/></button></header>
  <div className="desktop-body">
   <div className="desktop-section"><h3>四屏工作区</h3><p>腾讯会议共享「课堂展示」窗口。教师工具是单独窗口；首次授课前请用会议预览确认共享范围。</p><div className="desktop-actions"><button onClick={()=>host.openStudentWindow()}><MonitorUp size={15}/>打开学生画面</button><button onClick={()=>host.openDock()}>打开教师工具</button>{multi?<>
    <button onClick={()=>void run(()=>saveBoard('stitch').then(done))} data-tip="所有页从上到下拼成一张长图"><Download size={15}/>保存板书 · 拼成长图</button>
    <button onClick={()=>void run(()=>saveBoard('pages').then(done))} data-tip="每页一张，按「名字-01、-02…」编号">每页一张</button>
    <button onClick={()=>void run(()=>saveBoard('page').then(done))}>只存第 {st.pgm.page+1} 页</button>
   </>:<button onClick={()=>void run(()=>saveBoard().then(done))} data-tip={isLong(st.pgmMat)?'整块长黑板存成一张长图':undefined}><Download size={15}/>保存当前板书 PNG</button>}
    {st.pgmMat.kind==='board'&&<><button onClick={()=>void run(()=>saveBoardPdf().then(done))} data-tip="A4 纸，多页黑板一张纸放两页，长黑板自动分页">存成 PDF</button><button onClick={()=>void run(()=>saveBoardPdf({saveInk:true}).then(done))} data-tip="白底深色字、不印格子，适合打印">PDF · 打印省墨</button></>}</div><div className="display-list">{displays.map((d,i)=><button key={d.id} onClick={()=>host.placeStudent(d.id,true)}>显示器 {i+1}{d.primary?' · 主屏':''}<small>{d.bounds.width} × {d.bounds.height} · 学生全屏</small></button>)}</div></div>
   {settings&&<div className="desktop-section"><h3>腾讯会议怎么共享</h3><div className="share-guide"><div className="good"><b>推荐：共享窗口 →「课堂展示」</b>学生只看到课堂展示窗口；教师浮层、导播台和你桌面上的其他东西都不会被共享。</div><div className="bad"><b>不推荐：共享整个屏幕</b>浮层、导播台和弹窗都会被学生看到。必须共享屏幕时，可以打开下面的防截屏。</div></div><label className="setting-check"><input type="checkbox" checked={!!settings.captureGuard} onChange={e=>update({captureGuard:e.target.checked})}/>防截屏：教师浮层和导播台在任何共享、截图里都不显示</label><p>注意：开启后，部分会议软件全屏共享时会在浮层位置显示一块黑色。只共享「课堂展示」窗口时不需要开启。</p></div>}
   {settings&&<div className="desktop-section"><h3>课前提醒</h3><label className="quality">按课表提前提醒<select value={settings.remindMinutes??10} onChange={e=>update({remindMinutes:Number(e.target.value)})}><option value={0}>不提醒</option><option value={5}>提前 5 分钟</option><option value={10}>提前 10 分钟</option><option value={15}>提前 15 分钟</option><option value={30}>提前 30 分钟</option></select></label><label className="setting-check"><input type="checkbox" checked={!!settings.autostart} onChange={e=>update({autostart:e.target.checked})}/>开机自动启动导播台（这样提醒不会漏）</label><p>提醒以 Windows 系统通知弹出，导播台里也会显示一条横幅。导播台没开着的时候不会提醒。微信、邮件提醒会在后续版本加入。</p></div>}
   <div className="desktop-section"><h3>答案页</h3><label className="setting-check"><input type="checkbox" checked={st.answerGuard!==false} onChange={e=>st.setShared({answerGuard:e.target.checked})}/>答案页对学生遮住，老师点「揭晓」后才显示</label><label className="setting-check"><input type="checkbox" disabled={st.answerGuard===false} checked={st.answerAutoDetect} onChange={e=>setAnswerAutoDetect(e.target.checked)}/>打开 PDF / PPT 时自动识别答案页（文字识别在本机完成，不上传）</label><p>页面中间出现「答案：」「【解析】」时只遮住下半部分，题目照常显示。识别不准时，在教师工具里点页码，可以把当前页设为或取消答案页，会按文件记住。{st.pgmMat.src?.path&&<button className="link-btn" onClick={()=>void redetect()}>重新识别当前课件</button>}</p></div>
   <div className="desktop-section"><h3>书写与学生操作</h3><div className="desktop-actions"><button className={st.drawAuthor==='teacher'?'selected':''} onClick={()=>st.setShared({drawAuthor:'teacher'})}>教师书写</button><button className={st.drawAuthor==='student'?'selected':''} onClick={()=>st.setShared({drawAuthor:'student',studentTools:'open',selectedInk:null})}>交给学生标注</button><button onClick={()=>st.setShared({studentTools:st.studentTools==='locked'?'open':'locked'})}>{st.studentTools==='locked'?'解锁学生工具':'锁定学生工具'}</button></div><p>使用远程控制时，软件无法区分远端鼠标与本机鼠标；由你在这里交接书写权限。</p></div>
   <div className="desktop-section"><h3>浮层工具栏</h3><p>工具太多找不到？选一套预设，或者自己挑要显示的工具。在浮层工具栏上点右键也能打开这里。</p><ToolbarEditor meta={(t)=>TOOL_META[t]} physics/></div>
   <div className="desktop-section"><h3>界面布局</h3><p>浮层放太大、拖到看不见的地方，或者换了显示器以后窗口跑出屏幕，点这里一键恢复：教师端和课堂展示窗口回到默认大小并居中，教师浮层回到左上角、100%、展开，学生工具条回到左下角，左右两栏重新展开。工具栏里显示哪些工具不受影响。</p><div className="desktop-actions"><button onClick={()=>void run(async()=>{await host.call('layoutReset');st.set({libraryOpen:true,rightOpen:true,libraryW:300,rightW:340});toast('已恢复默认布局');})}>恢复默认布局</button></div></div>
   <div className="desktop-section"><h3>自动本地录课</h3><p>点击顶部「开始上课」后录制学生展示窗口。教师阅读器和独立工具窗不作为录制目标。</p>{settings&&<><label className="setting-check"><input type="checkbox" disabled={busy} checked={settings.microphone} onChange={e=>update({microphone:e.target.checked})}/>录制我的麦克风</label><label className="setting-check"><input type="checkbox" disabled={busy} checked={settings.systemAudio} onChange={e=>update({systemAudio:e.target.checked})}/>录制系统声音（含会议里学生的声音）</label><label className="quality">视频清晰度<select disabled={busy} value={settings.bitrate} onChange={e=>update({bitrate:Number(e.target.value)})}><option value={1500000}>节省空间 · 1.5 Mbps</option><option value={3000000}>标准课堂 · 3 Mbps</option><option value={5000000}>清晰文字 · 5 Mbps</option></select></label><div className="folder-path">{settings.recordings}</div><div className="desktop-actions"><button disabled={busy||jobs>0} onClick={()=>void run(async()=>{const recordings=await host.call<string>('pickRecordings');setSettings({...settings,recordings});})}>更换保存目录</button><button onClick={()=>void run(()=>host.call('recordingsFolder'))}><FolderOpen size={15}/>打开录像目录</button></div></>}</div>
   <div className="desktop-section" ref={recordsRef}><h3>本地课堂回放</h3><p>全部录像都在左侧「回放」页：可以播放、删除、查看占用的空间。绑定了学生的录像也会出现在「学生」页该学生的档案里。{rows.length>0&&<> 现在共 {rows.length} 段。</>}</p><div className="desktop-actions"><button onClick={()=>{st.set({page:'replay'});useRecording.setState({panel:false});}}><Video size={15}/>打开回放页</button></div></div>
   <div className="desktop-section"><h3>{shortcut?.platform==='darwin'?'应用程序与程序坞':'桌面快捷方式'}</h3><p>{shortcut?.platform==='darwin'?(shortcut.inApplications?'软件已经在「应用程序」里，可以在启动台打开。想放进程序坞：打开软件后右键程序坞里的图标 →「选项」→「在程序坞中保留」。':'软件还不在「应用程序」文件夹里。移过去以后可以在启动台打开，也能放进程序坞。'):shortcut?.desktop?'桌面上已经有快捷方式了。软件换了位置也会自动更新快捷方式。':'在桌面和开始菜单各放一个图标，以后双击就能打开，不用再去文件夹里找。'}</p><div className="desktop-actions"><button disabled={shortcut?.platform==='darwin'&&shortcut.inApplications} onClick={()=>void run(async()=>{const r=await host.call<ShortcutState&{message?:string}>('shortcut.create');setShortcut(r);if(r.message)toast(r.message);})}>{shortcut?.platform==='darwin'?'移到「应用程序」':shortcut?.desktop?'重新创建快捷方式':'添加桌面快捷方式'}</button></div></div>
   {error&&<div role="alert" className="desktop-error">{error}</div>}
  </div>
 </section></div>;
}
