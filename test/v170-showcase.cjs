'use strict';
/**
 * 1.7.0-A 九类炫技示例与示例小卡片素材验收测试
 * 运行：npx electron test/quiet.cjs test/v170-showcase.cjs
 *
 * 覆盖：
 * 1. 9 类示例文件夹、说明.md、_showcase/card.json 齐全，examples/README.md 说明完整
 * 2. examples/manifest.json 顺序固定、字段合规、所有引用文件真实存在，总体积 ≤ 15 MB（WebM ≤ 1.5 MB）
 * 3. 所有 HTML 成品通过 htmlProbe（横屏 1280×720 + 手机竖屏 390×844 断网零报错零溢出）
 * 4. 插件样板（源、_showcase、plugin-kit/examples 三处）通过 pluginSpec 且可在 Plugins 暂存安装激活
 * 5. 所有 *题库.json 复用工程真实 src/lib/agentBankLogic.ts (parseBank / citeText) 解析校验通过
 * 6. 所有文档样板（Markdown / 题库 / 导出的 docx、pdf、pptx）过 deliverCheck 零告警且归档/文本结构完整
 * 7. agentKit.installKit 复制 examples 进任务文件夹时严格跳过所有 _showcase 目录
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const electron = require('electron');
const { app, net } = electron;

const ROOT = path.resolve(__dirname, '..');
const EXAMPLES = path.join(ROOT, 'electron', 'agent-kit', 'examples');
const OUT = process.env.CS_TEST_OUT || path.join(ROOT, '.out', 'jia', 'v170-showcase-' + process.pid);
fs.mkdirSync(path.join(OUT, 'udata'), { recursive: true });
app.setPath('userData', path.join(OUT, 'udata'));
app.on('window-all-closed', () => {});

const { buildManifest, FIXED_ORDER, MAX_TOTAL_BYTES } = require('../scripts/showcase-manifest.cjs');
const { probeHtml } = require('../electron/htmlProbe.cjs');
const spec = require('../electron/pluginSpec.cjs');
const { Plugins } = require('../electron/plugins.cjs');
const deliver = require('../electron/deliverCheck.cjs');
const agentKit = require('../electron/agentKit.cjs');
const { entries } = require('../electron/zipkit.cjs');

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
    console.log('ok  ', name);
  } catch (e) {
    results.push(['FAIL', name]);
    console.error('FAIL', name, '\n', e && e.stack ? e.stack : e);
  }
}

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function pdfInfoAndText(buf) {
  const pdfjs = await loadPdfjs();
  const cMapUrl = pathToFileURL(path.join(ROOT, 'public', 'pdfjs', 'cmaps')).href + '/';
  const standardFontDataUrl = pathToFileURL(path.join(ROOT, 'public', 'pdfjs', 'standard_fonts')).href + '/';
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    pages.push(tc.items.map((it) => it.str).join(''));
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { numPages, text: pages.join('\n') };
}

async function pdfTextOnly(buf) {
  const r = await pdfInfoAndText(buf);
  return r.text;
}

function findFiles(dir, pred, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, pred, acc);
    else if (e.isFile() && pred(p, e.name)) acc.push(p);
  }
  return acc;
}

setTimeout(() => {
  console.error('v170-showcase timed out');
  app.exit(1);
}, 240000);

app.whenReady().then(async () => {
  await test('9 类示例文件夹齐全，均含 说明.md 与 _showcase/card.json，README 说明完整', async () => {
    const readme = fs.readFileSync(path.join(EXAMPLES, 'README.md'), 'utf8');
    assert.match(readme, /_showcase/);
    assert.match(readme, /manifest\.json/);

    for (const [expectedId, skill] of FIXED_ORDER) {
      const dir = path.join(EXAMPLES, skill);
      assert.ok(fs.existsSync(dir), `缺少目录 examples/${skill}`);
      assert.ok(fs.existsSync(path.join(dir, '说明.md')), `缺少 examples/${skill}/说明.md`);
      const cardFile = path.join(dir, '_showcase', 'card.json');
      assert.ok(fs.existsSync(cardFile), `缺少 examples/${skill}/_showcase/card.json（id=${expectedId}）`);
    }
  });

  let manifestReport;
  await test('manifest.json 完整、顺序与引用全部有效，WebM ≤ 1.5 MB 且总体积 ≤ 15 MB', async () => {
    manifestReport = buildManifest({ examplesDir: EXAMPLES, write: false, strict: true });
    assert.deepEqual(manifestReport.missingCards, [], '缺失卡片: ' + manifestReport.missingCards.join(', '));
    assert.deepEqual(manifestReport.errors, [], 'manifest 校验错误:\n' + manifestReport.errors.join('\n'));
    assert.equal(manifestReport.itemsCount, 9);
    assert.ok(manifestReport.totalBytes <= MAX_TOTAL_BYTES, `总体积超标: ${manifestReport.totalBytes}`);

    const diskMfPath = path.join(EXAMPLES, 'manifest.json');
    assert.ok(fs.existsSync(diskMfPath), '缺少 examples/manifest.json（请先运行 node scripts/showcase-manifest.cjs）');
    const diskMf = JSON.parse(fs.readFileSync(diskMfPath, 'utf8'));
    assert.equal(diskMf.version, 1);
    assert.deepEqual(
      diskMf.items.map((it) => [it.id, it.skill]),
      FIXED_ORDER,
      'manifest.json 中的条目顺序必须与 FIXED_ORDER 完全一致'
    );

    for (const skill of ['courseware-html', 'plugin-dev']) {
      const webm = path.join(EXAMPLES, skill, '_showcase', 'preview.webm');
      const sz = fs.statSync(webm).size;
      assert.ok(sz > 10 * 1024 && sz <= 1.5 * 1024 * 1024, `${skill} preview.webm 大小异常: ${sz} bytes`);
    }
    console.log(`     examples 总体积 ${(manifestReport.totalBytes / 1024 / 1024).toFixed(2)} MB / 15.00 MB（${manifestReport.totalFiles} 个文件）`);
  });

  await test('所有 HTML 示例成品通过 htmlProbe（横屏 1280×720 + 手机竖屏 390×844 断网零报错零溢出）', async () => {
    const htmlEntries = [];
    for (const item of manifestReport?.manifest?.items || []) {
      for (const f of item.full || []) {
        if (f.kind === 'html') htmlEntries.push(path.join(EXAMPLES, ...f.file.split('/')));
      }
    }
    assert.ok(htmlEntries.length >= 3, 'HTML 成品数至少应有 3 个（互动课件 + 自定义 2 个），实际: ' + htmlEntries.length);
    for (const file of htmlEntries) {
      const res = await probeHtml(file, { electron });
      console.log(`     [htmlProbe] ${path.relative(EXAMPLES, file)} -> ${res.note}`);
      assert.deepEqual(res.problems, [], `${file} htmlProbe 发现问题:\n` + res.problems.join('\n'));
    }
  });

  await test('「电梯体重秤」插件三处副本均通过 pluginSpec 且可装入导播台运行', async () => {
    const pluginDirs = [
      path.join(EXAMPLES, 'plugin-dev', 'elevator-scale'),
      path.join(EXAMPLES, 'plugin-dev', '_showcase', 'elevator-scale'),
      path.join(ROOT, 'electron', 'plugin-kit', 'examples', 'elevator-scale'),
    ];
    for (const d of pluginDirs) {
      const r = spec.checkFolder(d);
      assert.ok(r.manifest, `插件缺少有效 manifest: ${d}`);
      assert.equal(r.manifest.id, 'elevator-scale');
      assert.deepEqual(r.problems, [], `${d} pluginSpec 告警: ` + r.problems.join('; '));
    }

    const tmpPl = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-show-pl-'));
    try {
      const plugins = new Plugins({ dir: tmpPl });
      assert.ok(plugins.examples().some((ex) => ex.id === 'elevator-scale'), 'plugin-kit 示例列表未包含 elevator-scale');
      const staged = plugins.stageExample('elevator-scale');
      assert.deepEqual(staged.problems, []);
      const installed = plugins.install(staged.token);
      assert.equal(installed.id, 'elevator-scale');
      assert.equal(installed.active, true);
    } finally {
      fs.rmSync(tmpPl, { recursive: true, force: true });
    }
  });

  await test('所有题库 JSON 复用工程现有 agentBankLogic.parseBank 题库导入校验逻辑解析通过', async () => {
    const bankBundle = path.join(OUT, 'agentBankLogic.mjs');
    const rolldownCli = path.join(ROOT, 'node_modules', 'rolldown', 'bin', 'cli.mjs');
    execFileSync(process.execPath, [rolldownCli, path.join(ROOT, 'src/lib/agentBankLogic.ts'), '-o', bankBundle, '-p', 'node'], {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'pipe',
    });
    const { parseBank, citeText } = await import(pathToFileURL(bankBundle).href);

    const bankFiles = findFiles(EXAMPLES, (_p, name) => /题库\.json$/i.test(name));
    assert.ok(bankFiles.length >= 3, `题库 JSON 数量不足（期望练习/作业/测验至少 3 份，实际 ${bankFiles.length} 份）`);

    for (const bf of bankFiles) {
      const raw = JSON.parse(fs.readFileSync(bf, 'utf8'));
      const drafts = parseBank(raw, 'physics');
      assert.ok(drafts.length >= 5, `${path.relative(EXAMPLES, bf)} 解析题目数过少: ${drafts.length}`);
      for (const [idx, q] of drafts.entries()) {
        assert.ok(q.stem.length >= 8, `${bf} 第 ${idx + 1} 题题干过短`);
        assert.ok(q.answer.length >= 1, `${bf} 第 ${idx + 1} 题缺少答案`);
        assert.ok(q.analysis.length >= 6, `${bf} 第 ${idx + 1} 题缺少解析`);
        assert.ok(q.difficulty >= 1 && q.difficulty <= 5, `${bf} 第 ${idx + 1} 题难度越界`);
        assert.ok(q.cite && citeText(q.cite).length > 0, `${bf} 第 ${idx + 1} 题缺少有效出处 cite`);
      }
      console.log(`     [parseBank] ${path.relative(EXAMPLES, bf)} -> ${drafts.length} 题可导入`);
    }
  });

  await test('所有文档类样板及导出的 docx / pdf / pptx 过 deliverCheck 零告警且结构完整', async () => {
    const docSkills = ['lecture-slides', 'practice-set', 'homework', 'quiz-paper', 'lesson-notes', 'lesson-plan'];
    for (const skill of docSkills) {
      const srcDir = path.join(EXAMPLES, skill);
      assert.ok(fs.existsSync(srcDir), `缺少文档样板目录 ${skill}`);

      // 在临时副本上执行 deliverCheck，防止写回题库时间戳污染工作树
      const tmpWork = path.join(OUT, 'deliver-' + skill);
      fs.rmSync(tmpWork, { recursive: true, force: true });
      fs.cpSync(srcDir, tmpWork, {
        recursive: true,
        filter: (s) => path.basename(s) !== '_showcase',
      });

      const res = await deliver.checkDeliverables(tmpWork, {
        since: 0,
        skill,
        fetch: (u, o) => net.fetch(u, o),
        pdfText: pdfTextOnly,
      });
      assert.deepEqual(res.problems, [], `${skill} deliverCheck 告警:\n` + res.problems.join('\n'));

      // 逐个检查 _showcase 下导出的 docx / pdf / pptx 成品文件
      const showDir = path.join(srcDir, '_showcase');
      const docFiles = findFiles(showDir, (_p, name) => /\.(docx|pdf|pptx)$/i.test(name));
      assert.ok(docFiles.length >= 2, `${skill}/_showcase 缺少导出的 docx/pdf/pptx 成品`);

      for (const df of docFiles) {
        const buf = fs.readFileSync(df);
        assert.ok(buf.length > 1024, `文件过小: ${df}`);
        if (/\.docx$/i.test(df)) {
          const map = new Map(entries(buf, { maxBytes: 64 * 1024 * 1024 }).map((e) => [e.name, e.data]));
          const xml = map.get('word/document.xml')?.toString('utf8') || '';
          assert.ok(xml.length > 200, `${df} 缺少有效的 word/document.xml`);
          assert.doesNotMatch(xml, /\[图片缺失\]/, `${df} 含缺失图片占位`);
        } else if (/\.pptx$/i.test(df)) {
          const list = entries(buf, { maxBytes: 64 * 1024 * 1024 });
          const slides = list.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name));
          assert.ok(slides.length >= 10, `${df} 幻灯片页数不足: ${slides.length}`);
          for (const sl of slides) {
            assert.doesNotMatch(sl.data.toString('utf8'), /\[图片缺失\]/, `${df} ${sl.name} 含缺失图片`);
          }
        } else if (/\.pdf$/i.test(df)) {
          assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-', `${df} 不是合法的 PDF 文件`);
          const info = await pdfInfoAndText(buf);
          assert.ok(info.numPages >= 1, `${df} PDF 页数为 0`);
          assert.ok(info.text.trim().length >= 30, `${df} PDF 文本层异常为空`);
          assert.doesNotMatch(info.text, /\[图片缺失/, `${df} PDF 含缺失图片`);
        }
      }
      console.log(`     [deliverCheck+docs] ${skill} -> ${docFiles.length} 个导出成品零告警`);
    }
  });

  await test('agentKit.installKit 复制样板进任务文件夹时跳过所有 _showcase 目录', async () => {
    const tmpTask = path.join(OUT, 'task-work');
    fs.rmSync(tmpTask, { recursive: true, force: true });
    fs.mkdirSync(tmpTask, { recursive: true });

    agentKit.installKit(tmpTask, 'codex', '');

    const installedEx = path.join(tmpTask, '.cs-kit', 'examples');
    assert.ok(fs.existsSync(path.join(installedEx, 'courseware-html', '超重与失重.html')), '未复制 courseware-html 源文件');
    assert.ok(fs.existsSync(path.join(installedEx, 'custom', '高一力学经典模型速查网页.html')), '未复制 custom 源文件');
    assert.ok(fs.existsSync(path.join(tmpTask, '.agents', 'skills', 'plugin-dev', 'examples', 'elevator-scale', 'plugin.json')), '未复制 plugin-dev 示例插件');

    const leaked = [];
    const scanShowcase = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === '_showcase') leaked.push(p);
          else scanShowcase(p);
        }
      }
    };
    scanShowcase(installedEx);
    assert.deepEqual(leaked, [], 'installKit 不应复制 _showcase 目录: ' + leaked.join(', '));
  });

  try { fs.rmSync(OUT, { recursive: true, force: true }); } catch {}
  const bad = results.filter((r) => r[0] !== 'ok');
  console.log(`RESULT ${results.length - bad.length}/${results.length} pass`);
  app.exit(bad.length ? 1 : 0);
}).catch((e) => {
  console.error(e);
  try { fs.rmSync(OUT, { recursive: true, force: true }); } catch {}
  app.exit(1);
});
