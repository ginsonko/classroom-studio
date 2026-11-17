'use strict';
// 使用真实 Agents / Ledger / ToolHost / MCP。所有窗口离屏，真实键鼠组件完全不加载。
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.CS_APPROVED_RUN_ROOT || path.resolve(__dirname, '../..'));
if (/^[GHI]:/i.test(root)) throw Error('请将 CS_APPROVED_RUN_ROOT 设为 C/D/E/F 的已核验 NTFS 临时工作目录；不得在 G/H/I 运行本次任务');
const temp = path.join(root, '临时真跑');
const evidence = path.join(root, '验证证据');
const mode = process.argv.includes('--claude') ? 'claude' : 'codex';
if (fs.existsSync(path.join(evidence,mode+'-result.json'))) throw Error('已有本内核真跑记录，先审阅，不自动重复收费');
const work = path.join(temp, mode);
fs.mkdirSync(work, {recursive:true}); fs.mkdirSync(evidence, {recursive:true});
const electron = require('electron'); const {app, BrowserWindow} = electron;
app.setPath('userData', path.join(work, 'browser'));
app.setPath('sessionData', path.join(work, 'browser'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const log = (...args) => {
  const text = args.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
  fs.appendFileSync(path.join(evidence, mode + '-run.log'), text + '\n'); console.log(text);
};
let ag, th, ledger;
const save = () => {
  if (!ag) return;
  for (const t of ag.tasks.values()) {
    const target = path.join(evidence, mode, t.id); fs.mkdirSync(target, {recursive:true});
    fs.writeFileSync(path.join(target,'task.json'), JSON.stringify(ag.public(t,true),null,2));
    fs.cpSync(t.work, path.join(target,'成果'), {recursive:true, filter:p => !['.cs','.agents','.claude','.git'].includes(path.basename(p))});
  }
  if (ledger) fs.writeFileSync(path.join(evidence, mode+'-ledger.json'), JSON.stringify(ledger.entries,null,2));
};
const finish = (code) => { save(); th?.stop(); app.exit(code); };
process.on('uncaughtException', e=>{log('FAIL', e.message);finish(1);});
process.on('unhandledRejection', e=>{log('FAIL', e.message);finish(1);});
app.whenReady().then(async()=>{
  const {Agents} = require('../electron/agents.cjs');
  const {Ledger} = require('../electron/ledger.cjs');
  const {ToolHost,fail} = require('../electron/toolHost.cjs');
  const {WebTools} = require('../electron/webTools.cjs');
  const {PageCheck} = require('../electron/pageCheck.cjs');
  const {AiBrowser} = require('../electron/aiBrowser.cjs');
  const credentials = require('./relay-key.cjs').readRelay();
  if (!credentials.key) throw Error('没有已保存的接口凭据');
  ledger = new Ledger(work);
  // 不沿用别的模型校准倍率，先用无折扣官方估价控制花费。
  ledger.setBudget({caps:{task:mode==='codex'?0.9:1.2,day:mode==='codex'?3:1.5,month:5},factor:1});
  const logger = {info:()=>{}, warn:(...x)=>log('WARN',...x.map(String))};
  th = new ToolHost({dataDir:work,log:logger});
  const hidden = new BrowserWindow({show:false,focusable:false,webPreferences:{sandbox:true}});
  th.parts.web = new WebTools({electron,host:th,log:logger});
  th.parts.page = new PageCheck({electron,log:logger});
  th.parts.browser = new AiBrowser({electron,host:th,window:()=>hidden,log:logger});
  th.parts.desk = {call:async()=>fail('此次验收严禁真实键鼠与屏幕截图','disabled'),stopAll:()=>{}};
  // 不允许弹卡、交给用户、下载确认或桌面动作。
  th.ask = async()=> 'deny';
  const call = th.call.bind(th);
  th.call = async(key,name,args)=>{
    if (/^(screen_capture|desktop_)/.test(name)) return fail('此次验收严禁真实键鼠与屏幕截图','disabled');
    const r = await call(key,name,args);
    fs.appendFileSync(path.join(evidence,mode+'-tools.jsonl'),JSON.stringify({at:Date.now(),key,name,args,isError:!!r.isError,text:r.text})+'\n');
    log('TOOL', name, r.isError?'failed':'ok');
    return r;
  };
  await th.start();
  ag = new Agents({dir:path.join(work,'tasks'),ledger,credentials:()=>credentials,tools:th,log:logger,emit:m=>{
    if(m.event && ['usage','note','error'].includes(m.event.kind)) log(m.event.kind,m.event.text);
  }});
  // 单独的 CLI 配置/缓存目录，不改父进程或用户的配置。
  const env = ag.env.bind(ag);
  ag.env=t=>({...env(t), CODEX_HOME:path.join(work,'codex-home'),CLAUDE_CONFIG_DIR:path.join(work,'claude-home')});
  // Agents.run 会读取本次子进程环境中的目录用于查 rollout。
  fs.mkdirSync(path.join(work,'codex-home'),{recursive:true});
  // 干净的 CODEX_HOME 没有 [windows] sandbox 时，Codex 0.163 在 Windows 上把 workspace-write 静默降成只读，任务写不出文件。
  if (process.platform==='win32') fs.writeFileSync(path.join(work,'codex-home','config.toml'),`[windows]\nsandbox = ${JSON.stringify(process.env.CS_CODEX_WIN_SANDBOX||'elevated')}\n`);
  const det = await ag.detect(); log('ENGINES',det.codex.version,det.claude.version);
  if(!det[mode].found) throw Error(mode+' 内核未安装');
  const prompt = mode==='codex'
    ? '查一道 2024 北京高一物理期中超重失重公开真题并附出处网址。先用 cs_tools 的 web_search 查找，再核实题目原文。上一轮已有候选出处 https://www.gaokzx.com/gk/shitiku/130402.html ，候选为人大附中高一上期中第6题，但须核实后才引用。找到一道带出处的题就立即写「超重失重真题.md」，参考答案找不到就标注「未找到」，不要为答案继续翻页。文件包括年份、地区、学校、年级、考试类型、题号、完整原题和出处网址。最多一次搜索、两次抓取；图像题可开内置浏览器截图看。别操作真实桌面。'
    : '执行一个最小工具验收：先用 cs_tools 的 web_search 搜索「牛顿第二定律」一次；写 hello.html（标题和按钮，按钮点击后把标题改成「已点击」）；用 cs_tools 的 page_check 检查 hello.html 一次；把搜索结果里的一个真实网址及自检结论写入「Claude工具验收.md」，然后结束。不用其他网页工具，不操作桌面。';
  const task = ag.start({engine:mode,title:mode+' 限额真跑',prompt,permission:'full',formats:[],useStudioKey:true,model:mode==='codex'?'gpt-6-astra':(process.env.CS_CLAUDE_MODEL||'claude-3-5-haiku-20241022'),effort:'low',cap:mode==='codex'?0.9:1.2});
  log('START',task.id,'cap',task.cap);
  const deadline=Date.now()+15*60000;
  const watch=setInterval(()=>{
    const t=ag.tasks.get(task.id);
    if(Date.now()>deadline && t.child) ag.halt(t,'failed','验收超过15分钟');
    if(t.child || t.status==='running') return;
    clearInterval(watch);
    const file=path.join(t.work,mode==='codex'?'超重失重真题.md':'Claude工具验收.md');
    const calls=fs.existsSync(path.join(evidence,mode+'-tools.jsonl'))?fs.readFileSync(path.join(evidence,mode+'-tools.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)).filter(x=>x.key==='task:'+t.id):[];
    const count=name=>calls.filter(x=>x.name===name&&!x.isError).length;
    const exists=fs.existsSync(file)&&fs.statSync(file).size>0;
    const text=exists?fs.readFileSync(file,'utf8'):'';
    const urls=[...new Set(text.match(/https?:\/\/[^\s)）\]>"'，。]+/g)||[])];
    const requirements=mode==='codex'?count('web_search')>=1&&t.wrapped&&urls.length>0:count('web_search')===1&&count('page_check')===1;
    const result={engine:mode,task:t.id,status:t.status,cny:t.cny,cap:t.cap,wrapped:!!t.wrapped,turns:t.turns,file:exists?file:null,urls,tools: calls.map(x=>({name:x.name,isError:x.isError})),requirementsPassed:!!requirements,sourcePersonallyReviewed:false,verified:false};
    fs.writeFileSync(path.join(evidence,mode+'-result.json'),JSON.stringify(result,null,2));
    log('RESULT',result); finish(t.status==='done' && exists && requirements && t.cny<=t.cap?0:1);
  },1000);
});
