const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const app = path.resolve(__dirname, '../../../..');
const scratch = path.join(app, '.out/rich-numeric');
const out = path.join(scratch, 'lib');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(scratch, 'package.json'), '{"type":"commonjs"}');
const files = ['lib/types.ts','physics/model.ts','physics/sim/domain.ts','physics/sim/engine.ts','physics/sim/presetKit.ts','physics/sim/presetsMech.ts','physics/sim/presetsEM.ts','physics/sim/presets.ts'];
for (const file of files) { const dest = path.join(scratch,'source',file); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.copyFileSync(path.join(app,'src',file),dest); }
const prim = `export const LW={thin:.001,line:.002,bold:.003,vec:.003}; export const BODY_COLORS=["blue","orange","green","violet"]; export const VEC_COLOR={G:"green",N:"blue",f:"orange",spring:"violet",T:"orange",rod:"ink",E:"red",B:"blue",v:"green"}; export const alpha=(x,a)=>x; export const arrow=(...x)=>{}; export const card=(...x)=>{}; export const dot=(...x)=>{}; export const line=(...x)=>{}; export const pill=(...x)=>{}; export const dim=(...x)=>{}; export const angleArc=(...x)=>{}; export const DASH=[]; export type SD=any;`;
const text = `export const fmt=(x,d)=>String(x); export const drawSym=(...x)=>{}; export const drawText=(...x)=>{}; export const measureSym=(...x)=>0; export const textW=(...x)=>0;`;
fs.writeFileSync(path.join(scratch,'source/physics/sim/prim.ts'),prim); fs.writeFileSync(path.join(scratch,'source/physics/sim/text.ts'),text);
const config=path.join(scratch,'tsconfig.json'); fs.writeFileSync(config,JSON.stringify({compilerOptions:{target:'ES2022',module:'Node16',moduleResolution:'Node16',outDir:'./lib',rootDir:'./source',skipLibCheck:true,strict:false, noEmitOnError:false,types:[]},include:['source/**/*.ts']}));
execFileSync(process.execPath,[path.join(app,'node_modules/typescript/bin/tsc'),'-p',config],{cwd:app,stdio:'pipe'});
const {SimRun}=require(path.join(out,'physics/sim/engine.js')); const {PRESETS,makePreset}=require(path.join(out,'physics/sim/presets.js')); const {sceneErrors}=require(path.join(out,'physics/sim/domain.js'));
const result={presets:PRESETS.map(p=>p.id), checks:[], failures:[]};
for(const p of PRESETS){ for(const side of ['min','max']){ try{const vals=Object.fromEntries(p.params.map(x=>[x.key,side==='min'?x.min:x.max])); const m=makePreset(p.id,vals,false); const e=sceneErrors(m.scene); if(e.length) throw new Error(e.join('; ')); const r=new SimRun(m.scene,{events:p.events}); r.ensure(r.duration); assert.ok(r.frames.length>2); for(const f of r.frames) for(const b of f.b) for(const v of [b.x,b.y,b.vx,b.vy,b.ax,b.ay]) assert.ok(Number.isFinite(v),`${p.id}/${side} nonfinite`); result.checks.push({preset:p.id,side,frames:r.frames.length,duration:r.duration,events:r.events.length}); }catch(err){result.failures.push({preset:p.id,side,error:String(err.stack||err)});} } }
for(const p of PRESETS){const a=new SimRun(makePreset(p.id,{},false).scene,{events:p.events}); const b=new SimRun(makePreset(p.id,{},false).scene,{events:p.events}); a.ensure(a.duration); b.ensure(b.duration); assert.deepEqual(a.frames,b.frames);}
result.deterministic=true; result.passed=result.failures.length===0; fs.writeFileSync(path.join(app,'reports','rich-physics-acceptance.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify({passed:result.passed,presets:PRESETS.length,checks:result.checks.length,failures:result.failures},null,2)); if(!result.passed) process.exitCode=1;



