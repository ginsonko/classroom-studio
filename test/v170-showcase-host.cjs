// node --test test/v170-showcase-host.cjs：真实样板 + 主进程边界 + 引擎启动顺序；零外部 API。
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Showcase } = require('../electron/showcase.cjs');
const { Plugins } = require('../electron/plugins.cjs');
const { Agents } = require('../electron/agents.cjs');
const out = path.join(os.tmpdir(), 'cs-showcase-host-' + process.pid);
fs.mkdirSync(out, { recursive: true });
const service = new Showcase();
const manifest = service.manifest();
const priorAgent = process.env.CS_AGENT_CODEX;
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-agent.cjs');
after(() => {
  if (priorAgent === undefined) delete process.env.CS_AGENT_CODEX; else process.env.CS_AGENT_CODEX = priorAgent;
  fs.rmSync(out, { recursive: true, force: true });
});

test('真实清单九类、所有预览协议地址均解析到真实文件', () => {
  assert.deepEqual(manifest.items.map(x => x.id), ['html','ppt','quiz','homework','test','notes','plan','plugin','free']);
  for (const i of manifest.items) {
    assert.equal(i.highlights.length,3);
    const urls=i.preview.type==='video'?[i.preview.srcUrl,i.preview.posterUrl]:i.preview.imageUrls;
    assert.ok(urls.length>=2);
    for(const url of urls)assert.ok(fs.statSync(service.resolveProtocolUrl(url)).isFile());
  }
});
test('路径穿越、绝对路径、非法协议均被拒绝', () => {
  for(const p of ['../main.cjs','a/../../main.cjs','/manifest.json','C:/test','a\\..\\secret','a\0b'])assert.throws(()=>service.resolveRel(p),undefined,p);
  for(const u of ['file:///secret','showcase://wrong/manifest.json','showcase://asset/%2e%2e%2fmain.cjs','showcase://asset/%ZZ'])assert.throws(()=>service.resolveProtocolUrl(u),undefined,u);
});
test('目录联接不能逃出 examples；不存在和 _showcase 风格引用被拒绝', () => {
  const root=path.join(out,'sandbox'),outside=path.join(out,'outside');
  fs.mkdirSync(root);fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret.txt'),'outside');
  fs.symlinkSync(outside,path.join(root,'escape'),'junction');
  assert.throws(()=>new Showcase({rootDir:root}).resolveRel('escape/secret.txt'));
  assert.throws(()=>service.prepareStart({styleRef:['missing/file.html']}));
  assert.throws(()=>service.prepareStart({styleRef:['custom/_showcase/shot-1.webp']}));
});
test('全部成品可打开并发出私有预览事件；插件使用独立 dev ID', () => {
  const events=[],plugins=new Plugins({dir:path.join(out,'plugins')}),host=new Showcase({plugins,notify:(...a)=>events.push(a)});
  for(const item of manifest.items)for(let n=0;n<item.full.length;n++){
    const result=host.open({id:item.id,index:n});
    assert.equal(result.ok,true);assert.equal(result.index,n);
    assert.equal(events.at(-1)[0],'showcaseOpen');
    if(result.kind==='plugin'){assert.match(result.pluginPreview.id,/^dev-showcase-/);assert.deepEqual(result.pluginPreview.problems,[])}
    else assert.ok(fs.statSync(result.path).isFile());
  }
  assert.throws(()=>host.open('missing'));
});
test('九类任务在 run 前已有样板；任务背景与真正传给引擎的提示词都含路径', () => {
  const agents=new Agents({dir:path.join(out,'agents')});let ran=0;
  agents.run=(task,prompt)=>{
    const item=manifest.items[ran++],bg=fs.readFileSync(path.join(task.work,'任务背景.md'),'utf8');
    for(const ref of item.styleRef){assert.ok(fs.existsSync(path.join(task.work,'.cs-kit/examples',ref)),ref);assert.ok(bg.includes('.cs-kit/examples/'+ref));assert.ok(prompt.includes('.cs-kit/examples/'+ref))}
  };
  for(const item of manifest.items)agents.start({engine:'codex',title:item.label,prompt:'make a sample',formats:[],kind:item.id==='plugin'?'plugin':'',styleRef:{id:item.id}});
  assert.equal(ran,9);
});
test('自定义选中子示例只带对应源文件；长背景仍保留风格说明', () => {
  const ref=manifest.items.find(i=>i.id==='free').styleRef[2];
  const agents=new Agents({dir:path.join(out,'long-context')});
  agents.run=(task,prompt)=>{
    const bg=fs.readFileSync(path.join(task.work,'任务背景.md'),'utf8');assert.ok(bg.length<=20000);assert.ok(bg.includes(ref));assert.ok(prompt.includes(ref));
    assert.equal(fs.readdirSync(path.join(task.work,'.cs-kit/examples/custom')).length,1);
  };
  agents.start({engine:'codex',prompt:'custom',formats:[],context:'context '.repeat(4000),styleRef:{id:'free',label:'game',paths:[ref]}});
});
test('复制失败必须阻止引擎启动且清理未启动任务', () => {
  const agents=new Agents({dir:path.join(out,'copy-failure')});let ran=false;
  agents.run=()=>{ran=true};
  const original=Showcase.prototype.installReferences;
  Showcase.prototype.installReferences=()=>{throw Error('copy refused')};
  try{assert.throws(()=>agents.start({engine:'codex',prompt:'sample',styleRef:'html'}),/copy refused/)}finally{Showcase.prototype.installReferences=original}
  assert.equal(ran,false);assert.equal(agents.tasks.size,0);
  assert.equal(fs.readdirSync(agents.dir).filter(n=>/^\d{4}-/.test(n)).length,0);
});
test('实际假 CLI 收到风格提示，运行完成，未调用付费接口', async () => {
  const agents=new Agents({dir:path.join(out,'fake-cli')});
  const initial=agents.start({engine:'codex',prompt:'local test',formats:[],styleRef:'html'});
  const end=Date.now()+20000;
  while(Date.now()<end){const t=agents.tasks.get(initial.id);if(['done','failed'].includes(t.status)){assert.equal(t.status,'done',JSON.stringify(t.events));assert.ok(fs.existsSync(path.join(t.work,'args.log')));return}await new Promise(r=>setTimeout(r,50))}
  agents.halt(agents.tasks.get(initial.id),'stopped','test timeout');assert.fail('fake CLI timeout');
});
