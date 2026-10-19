// 真实模型实测（手动运行，会产生费用）：用数据副本里的 AI 配置跑一个场景脚本，回复原文存到 dump 目录。
// 用法：npm run build 后
//   $env:CS_DATA_DIR='<数据副本目录>'; npx electron test/quiet.cjs test/ai-real.cjs <场景脚本.cjs> [参数]
// 场景脚本导出 async (ctx) => 结果对象；ctx 见下方。窗口放在所有屏幕之外，不弹窗、不动鼠标。
const fs = require('node:fs'); const path = require('node:path');
if (!process.env.CS_DATA_DIR || /ClassroomStudioData[\\/]*$/i.test(process.env.CS_DATA_DIR)) { console.error('CS_DATA_DIR 必须指向数据副本'); process.exit(2); }
const scenario = path.resolve(process.argv.find((a) => /\.cjs$/.test(a) && !/ai-real\.cjs$|quiet\.cjs$/.test(a)) || '');
const arg = process.argv.at(-1) === scenario || process.argv.at(-1).endsWith(path.basename(scenario)) ? '' : process.argv.at(-1);
const name = path.basename(scenario, '.cjs') + (arg ? '-' + arg.replace(/[^\w.-]/g, '_') : '');
const out = path.join(process.env.CS_DATA_DIR, '..', 'out', name + '-' + new Date().toISOString().slice(5, 16).replace(/[:T]/g, '')); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_AI_DUMP = path.join(out, 'dump');
const ledgerFile = path.join(process.env.CS_DATA_DIR, 'ai-ledger.jsonl');
const spent = () => { try { return fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').filter(Boolean).reduce((s, l) => s + (JSON.parse(l).cny || 0), 0); } catch { return 0; } };
const before = spent();
if (before > 18) { console.error(`实测预算快用完了：已花 ¥${before.toFixed(2)}`); process.exit(3); }
const { app } = require('electron'); const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message.slice(0, 400)); }); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(200); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('ai-real timed out'); app.exit(1); }, 1800000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA')); await until(() => call(student, '!!window.__studioQA'));
  const left = Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 }); student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  teacher.showInactive(); student.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState(),M=await Q.aiMods();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, n) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(n + ': ' + r.__err); return r; };
  const ctx = {
    api, teacher, student, out, sleep, until, arg, fs, path, T: run(teacher, 'teacher'), S: run(student, 'student'),
    shot: async (w, file, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, file), (await w.webContents.capturePage()).toPNG()); return path.join(out, file); },
    spent: () => spent() - before,
    log: (...a) => { const line = a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log(line); fs.appendFileSync(path.join(out, 'log.txt'), line + '\n'); },
  };
  const cfg = await ctx.T(`return await Q.host.call('ai.getConfig')`);
  if (!cfg.hasKey) throw Error('副本里没有可用的 Key');
  ctx.log('model', cfg.model, 'vision', cfg.visionModel || '(同主模型)');
  const result = await require(scenario)(ctx);
  const cost = spent() - before;
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ok: true, result, cost, consoleErrors: errors }, null, 2));
  console.log(`COST ¥${cost.toFixed(3)}  TOTAL ¥${spent().toFixed(3)}`); console.log('RESULT ' + out);
  clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((error) => {
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ok: false, error: error.stack, cost: spent() - before, consoleErrors: errors }, null, 2));
  console.error(error); console.log(`COST ¥${(spent() - before).toFixed(3)}`); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
