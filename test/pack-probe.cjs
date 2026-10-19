// 打包产物启动探针：加载发布目录里的 main.cjs 与 dist，确认三个窗口都能起来。
// 用法：electron test/quiet.cjs test/pack-probe.cjs <发布目录>
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const rel = process.argv.at(-1);
const appDir = path.join(rel, 'resources', 'app');
process.env.CS_TEST = '1';
process.env.CS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-pack-'));
const { app } = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await Promise.resolve().then(fn).catch(() => false); if (v) return v; await sleep(100); } throw Error('Timed out: ' + fn); };
require(path.join(appDir, 'electron', 'main.cjs'));
(async () => {
  const api = await until(() => globalThis.classroomStudioTest);
  const call = (w, js) => w.webContents.executeJavaScript(js);
  const teacher = api.windows.get('teacher'), student = api.windows.get('student');
  await until(() => call(teacher, `!!document.querySelector('.top, header, #root > *')`));
  await until(() => call(student, `!!document.querySelector('.sbar-fab')`));
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock .tdock-zoom')`));
  const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
  // 0.9.2 起安装包自带 Codex CLI：确认在发布目录里、能跑、技能文件也带上了
  const det = await call(teacher, `window.csHost.call('agents.detect')`);
  if (!det.codex.bundled || !fs.existsSync(path.join(appDir, 'bin', 'codex', 'bin', 'codex.exe'))) throw Error('内置 Codex 缺失：' + JSON.stringify(det.codex));
  if (!fs.existsSync(path.join(appDir, 'electron', 'agent-kit', 'skills', 'practice-set', 'SKILL.md'))) throw Error('技能文件缺失');
  const codex = { bundled: det.codex.bundled, using: det.codex.where, version: det.codex.version, found: det.codex.found };
  console.log(JSON.stringify({ ok: true, version, teacherUrl: teacher.webContents.getURL(), studentBar: true, dock: true, codex }));
  for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy();
  app.exit(0);
})().catch((e) => { console.error('PROBE FAIL', e); app.exit(1); });
