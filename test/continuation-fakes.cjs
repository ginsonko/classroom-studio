'use strict';
// 所有输入设备、窗口、子进程均是假组件。不启动 Electron/PowerShell，不调用模型。
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const cp=require('node:child_process');
const spawned=[], killed=[];
cp.execFile=(_cmd,args,_opts,cb)=>{killed.push(args);cb?.(null,'');};
cp.spawn=(_cmd,args,opts)=>{
  const child=Object.assign(new EventEmitter(),{pid:123456,exitCode:null,killed:false});
  child.stdin=Object.assign(new EventEmitter(),{end:t=>{child.prompt=t;},write:()=>true});
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  spawned.push({child,args,opts});return child;
};
const {Agents}=require('../electron/agents.cjs');
const {Desk}=require('../electron/desk.cjs');
const policy=require('../electron/desk-policy.cjs');
const {preflight,targetPoint,requireTarget}=require('./desk-acceptance.cjs');
const {ToolHost}=require('../electron/toolHost.cjs');
const temp=path.resolve(process.env.CS_FAKE_TEMP||path.join(require('node:os').tmpdir(),'cs-continuation-fakes'));
fs.mkdirSync(temp,{recursive:true});
const screens=[
  {index:1,phys:{x:0,y:0,width:2560,height:1440}},
  {index:2,phys:{x:-3000,y:355,width:1920,height:1080}},
  {index:3,phys:{x:-1080,y:-487,width:1080,height:1922}},
  {index:4,phys:{x:2560,y:402,width:1280,height:1024}},
];
test('旧日志坐标 1412,764 换回物理坐标后仍在靶子按钮内',()=>{
  const r={x:2185,y:1190,width:150,height:63};
  assert.deepEqual(targetPoint(r,screens,{1:{width:1600,height:900}}),{index:1,x:1412,y:764});
  const p=policy.toPhysical(screens[0].phys,{width:1600,height:900},1412,764);
  assert.ok(p.x>=2185&&p.x<2335&&p.y>=1190&&p.y<1253);
});
for(const scale of [1,1.25,1.5,2]) test(`DPI ${scale*100}% 与负原点/竖屏缩略图往返落在目标内`,()=>{
  for(const d of screens){
    const r={x:d.phys.x+120,y:d.phys.y+160,width:Math.round(120*scale),height:Math.round(50*scale)};
    assert.ok(targetPoint(r,screens,{}));
  }
});
const good={ok:true,fg:{hwnd:7,pid:100,title:'记事本',exe:'notepad.exe',rect:[50,50,800,500]},at:{hwnd:7,pid:100}};
test('未复核截图、全屏、游戏、未知前台均拒绝真机测试',()=>{
  assert.throws(()=>preflight(good,screens,false),/截图/);
  assert.throws(()=>preflight({...good,fg:{...good.fg,rect:[0,0,2560,1440]}},screens,true),/整屏/);
  assert.throws(()=>preflight({...good,fg:{...good.fg,exe:'StarRail.exe'}},screens,true),/游戏/);
  assert.throws(()=>preflight({ok:true},screens,true),/不完整/);
  assert.equal(preflight(good,screens,true),true);
});
test('遮挡、同名不同 PID、前台焦点变化均拦截；正确靶子可继续',()=>{
  const ready={hwnd:7,pid:100};
  assert.doesNotThrow(()=>requireTarget(good,ready,true));
  assert.throws(()=>requireTarget({...good,at:{hwnd:7,pid:101}},ready),/不是本次靶子/);
  assert.throws(()=>requireTarget({...good,at:{hwnd:8,pid:100}},ready),/不是本次靶子/);
  assert.throws(()=>requireTarget({...good,fg:{hwnd:8,pid:100}},ready,true),/焦点/);
});
function fakeDesk(){
  const helper=Object.assign(new EventEmitter(),{sent:[],start:async()=>{},abort:()=>{},async send(op,args){
    this.sent.push({op,args});
    if(op==='probe')return {ok:true,desktop:'Default',fg:{hwnd:7,pid:100,title:'靶子',exe:'target.exe'},at:{hwnd:7,pid:100,title:'靶子',exe:'target.exe'}};
    return op==='click'&&this.changed?{ok:false,stopped:'target'}:{ok:true};
  }});
  const desk=new Desk({electron:{},host:{},helper}); desk.displays=()=>screens; desk.badge=()=>{};
  return {desk,helper};
}
test('Desk 将核实的 HWND 传给输入组件，组件报告窗口变化时不宣称点击成功',async()=>{
  const {desk,helper}=fakeDesk();
  const s={key:'fake',source:'task',title:'假组件'};
  try{
    const ok=await desk.call(s,'desktop_click',{x:100,y:100,display:1});
    assert.ok(!ok.isError);assert.equal(helper.sent.find(x=>x.op==='click').args.hwnd,7);
    helper.changed=true;
    const no=await desk.call(s,'desktop_click',{x:100,y:100,display:1});
    assert.ok(no.isError);assert.match(no.text,/目标窗口已变化/);
  }finally{desk.stopAll();}
});
test('非法屏幕编号不得静默回退到主屏',()=>{
  const {desk}=fakeDesk();assert.throws(()=>desk.point({key:'fake'},{display:99,x:10,y:10},screens),/没有找到屏幕/);
});
test('按任务子进程配置找 rollout；75% 收尾预留只触发一次、收尾轮禁联网且给小幅收尾缓冲、同会话续接用量不重复',async()=>{
  // 合成用量验证控制流；不冒充付费真跑。
  const roll=path.join(temp,'rollout.jsonl');
  const write=n=>fs.appendFileSync(roll,JSON.stringify({payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,cached_input_tokens:0,output_tokens:0}}}})+'\n');
  fs.writeFileSync(roll,'');
  const entries=[];
  const ledger={budget:{usdRate:7.2,caps:{task:1}},check:()=>{},cost:(_m,u)=>u.input/1000,record:e=>{const r={cny:e.usage.input/1000};entries.push(r);return r;}};
  const th=new ToolHost({dataDir:temp});
  const ag=new Agents({dir:path.join(temp,'tasks'),ledger,tools:th});
  const fakeCli=path.join(temp,'fake-cli.cjs');fs.writeFileSync(fakeCli,'');
  const prev=process.env.CS_AGENT_CODEX;process.env.CS_AGENT_CODEX=fakeCli;
  const t={id:'fake-budget',engine:'codex',title:'fake',work:temp,permission:'full',cap:1,cny:0,tokens:0,turns:0,session:'same-session',model:'test',pick:'',effort:'high',events:[],queue:[],formats:[],rollout:roll};
  fs.mkdirSync(path.join(ag.dir,t.id),{recursive:true});ag.tasks.set(t.id,t);
  const actualEnv=ag.env.bind(ag);ag.env=t=>({...actualEnv(t),CODEX_HOME:path.join(temp,'isolated-codex')});
  try{
    ag.run(t,'查题');assert.equal(t.rolloutHome,path.join(temp,'isolated-codex'));
    write(749);ag.peekCodex(t);assert.ok(!t.wrapped);
    write(750);ag.peekCodex(t);assert.equal(t.cny,.75);assert.ok(t.wrapped&&t.wrapNext);assert.equal(killed.length,1);
    ag.peekCodex(t);assert.equal(killed.length,1);
    const first=t.child;first.exitCode=1;first.emit('close',1);
    assert.equal(t.turns,2);assert.equal(t.session,'same-session');assert.match(t.child.prompt,/第一步必须先写成品文件/);
    assert.ok(spawned.at(-1).args.includes('resume'));
    assert.ok(spawned.at(-1).args.join(' ').includes('model_reasoning_effort="low"'),'收尾轮降为低推理开销');
    assert.ok(spawned.at(-1).args.join(' ').includes('web_search="disabled"'),'收尾轮关闭原生搜索');
    const blocked=await th.call('task:'+t.id,'web_search',{query:'x'});
    assert.ok(blocked.isError&&blocked.code==='wrapping','收尾轮工具层拦截继续搜索');
    // 收尾轮写文件时略超 cap 1 分钱（1.01 <= 1 + wrapGrace），不中途硬杀，让成品落盘完成
    write(1010);ag.peekCodex(t);assert.equal(t.status,'running');
    ag.chargeCodex(t,{},true);assert.equal(t.cny,1.01);assert.deepEqual(entries.map(e=>e.cny),[.75,.26]);
    const last=t.child;t.turnOk=true;last.exitCode=0;last.emit('close',0);
    assert.equal(t.status,'done');assert.equal(t.wrapNext,false);
  }finally{
    if(t.child){t.child.exitCode=1;t.status='stopped';t.child.emit('close',1);}
    clearInterval(t.watch);
    if(prev===undefined)delete process.env.CS_AGENT_CODEX;else process.env.CS_AGENT_CODEX=prev;
  }
});
test('Claude 美元上限向下取分，不因四舍五入超过剩余额度',()=>{
  const ag=new Agents({dir:path.join(temp,'args'),ledger:{budget:{usdRate:7.2},factorFor:()=>1}});
  const t={engine:'claude',work:temp,permission:'full',cap:1.2,cny:0,events:[],queue:[]};
  const args=ag.args(t,'x'),usd=Number(args[args.indexOf('--max-budget-usd')+1]);
  assert.equal(usd,.16);assert.ok(usd*7.2<=1.2);
});
test('Claude 记账使用自己的模型倍率，不挪用 Codex 的折扣',()=>{
  let recorded;
  const ag=new Agents({dir:path.join(temp,'charge'),ledger:{budget:{usdRate:7.2},factorFor:m=>m==='claude-haiku'?1:.1,factor:()=>.1,check:()=>{},record:e=>(recorded=e,{cny:e.cny})}});
  const t={id:'charge',model:'claude-haiku',engine:'claude',cap:1.5,cny:0,tokens:0,events:[],procUsd:0};
  ag.chargeClaude(t,{usage:{input_tokens:100,output_tokens:50},usd:.1});
  assert.ok(Math.abs(recorded.cny-.72)<1e-9);assert.equal(t.cny,.72);
});
test('两个内核共享的工具说明含先落成品文件和未找到答案收尾规则',()=>{
  const th=new ToolHost({dataDir:temp});assert.match(th.note('full'),/写入目标成品文件落盘/);assert.match(th.note('full'),/未找到/);
});
