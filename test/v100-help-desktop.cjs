// 1.0.0 帮助中心与更新提示（屏幕外窗口）：
//   1. 上次更新的结果：启动后右下角提示「已更新到 …」；
//   2. 说明书：左边目录、搜索过滤、点目录跳到章节、Ctrl+K 不被说明书抢走；
//   3. 关于与更新：版本号、手动检查（本地假清单）、开发版改成「去官网下载」、签名不对的清单报错；
//   4. 静默检查发现新版本：右下角提示，「跳过这个版本」记住，不再提示；关掉自动检查会保存。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v100-help-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const CUR = require('../package.json').version, NEXT = CUR.replace(/\d+$/, (n) => String(+n + 1)); // 当前版本 / 假清单里的新版本
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v100-help-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(path.join(process.env.CS_DATA_DIR, 'updates'), { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'updates', 'result.json'), JSON.stringify({ ok: true, from: '0.9.2', to: CUR }));

// 本地假更新源：清单用测试密钥签名
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const sign = (m) => { const signed = JSON.stringify(m); return JSON.stringify({ signed, sig: crypto.sign(null, Buffer.from(signed), privateKey).toString('base64') }); };
const manifest = { version: NEXT, date: '2026-10-25', notes: ['录课可以暂停', '说明书补充了常见问题'], platforms: { 'win32-x64': { components: { app: { hash: 'h', size: 30e6, sha256: 'x', urls: ['https://example.invalid/app.zip'], paths: ['resources/app/dist'] } } } } };
let feedBody = sign(manifest); let hits = 0;
const server = http.createServer((req, res) => { hits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(feedBody); });
server.listen(0, '127.0.0.1');
process.env.CS_UPDATE_PUBKEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v100 help timed out'); app.exit(1); }, 180000);

server.once('listening', () => {
  process.env.CS_UPDATE_FEED = `http://127.0.0.1:${server.address().port}/latest.json`;
  require('../electron/main.cjs');
  void main();
});

async function main() {
  try {
    const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
    const call = (w, code) => w.webContents.executeJavaScript(code);
    await until(() => call(teacher, '!!window.__studioQA'));
    const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
    teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
    if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
    const wrap = (code) => `(async()=>{try{const $=(q)=>document.querySelector(q),$$=(q)=>[...document.querySelectorAll(q)];const click=(q)=>{const e=typeof q==='string'?$(q):q;if(!e)throw Error('no '+q);e.click();return true};const byText=(q,t)=>$$(q).find(e=>e.textContent.includes(t));${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
    const T = async (code) => { const r = await call(teacher, wrap(code)); if (r && r.__err) throw Error(r.__err); return r; };
    const shot = async (name, wait = 400) => { await sleep(wait); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };

    // ── 1. 上次更新的结果 ──
    const done = await until(() => T(`const t=$('.up-toast.ok');return t&&t.innerText`), 8000, 'update result toast');
    assert.ok(done.includes('已更新到 ' + CUR), done);
    await shot('help-1-updated-toast.png');
    await T(`return click(byText('.up-toast button','关闭'))`);
    await until(() => T(`return !$('.up-toast')`), 3000, 'toast closed');
    assert.ok(!fs.existsSync(path.join(api.data, 'updates', 'result.json')), 'result is consumed once');
    mark('last update result shows once after start');

    // ── 2. 说明书 ──
    await T(`return click('.rail-b[aria-label="帮助"]')`);
    const nav = await until(() => T(`const n=$$('.help-nav .help-ng button');return n.length&&{n:n.length,ch:$$('.help-ch').length,tab:$('.help-tabs .on').innerText,qq:$('.help-qq').innerText}`), 5000, 'manual');
    assert.ok(nav.n >= 15 && nav.n === nav.ch, JSON.stringify(nav));
    assert.match(nav.tab, /说明书/); assert.match(nav.qq, /1035471769/);
    const vertical = await T(`return $$('.help-nav button, .help-ch h2, .help-tabs button').filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>r.width*1.5&&e.innerText.length>2}).map(e=>e.innerText)`);
    assert.deepEqual(vertical, [], 'no vertically stacked labels');
    await shot('help-2-manual.png');
    await T(`const i=$('.help-search input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'录像');i.dispatchEvent(new Event('input',{bubbles:true}));return true`);
    const found = await until(() => T(`const c=$$('.help-ch h2').map(h=>h.innerText);return c.length&&c.length<${nav.ch}&&c`), 3000, 'search filters');
    assert.ok(found.some((t) => /录/.test(t)), JSON.stringify(found));
    await T(`return click('.help-search button')`);
    await until(() => T(`return $$('.help-ch').length===${nav.ch}`), 3000, 'search cleared');
    const last = await T(`const b=$$('.help-nav .help-ng button').at(-1);b.click();return b.innerText`);
    await until(() => T(`const h=$$('.help-ch').at(-1).getBoundingClientRect(),body=$('.help-body').getBoundingClientRect();return Math.abs(h.top-body.top)<80||$('.help-body').scrollTop+$('.help-body').clientHeight>=$('.help-body').scrollHeight-2`), 4000, 'jump to last chapter');
    await T(`const b=$$('.help-nav .help-ng button').at(-1);return b.classList.contains('on')`).then((on) => assert.ok(on));
    await shot('help-3-last-chapter.png', 700);
    mark('manual: chapters, search and jump', { chapters: nav.ch, search: found, last });

    // ── 3. 关于与更新 ──
    await T(`return click(byText('.help-tabs button','关于与更新'))`);
    const ver = await until(() => T(`const v=$('.ab-ver');return v&&v.innerText`), 3000, 'about');
    assert.ok(ver.includes(CUR), ver);
    await T(`return click(byText('.ab-row button','检查更新'))`);
    const avail = await until(() => T(`const c=$('.ab-update');return c.innerText.includes('${NEXT}')&&{text:c.innerText,notes:$$('.ab-notes li').map(l=>l.innerText),btn:$('.ab-acts .go')?.innerText}`), 8000, 'update found');
    assert.deepEqual(avail.notes, manifest.notes);
    assert.match(avail.btn, /去官网下载/, 'a development build cannot replace itself');
    assert.match(avail.text, /开发版不能自动更新/);
    assert.ok(hits >= 1);
    await shot('help-4-about-available.png');
    mark('about: version, manual check finds the next version, dev build links to the website', { button: avail.btn });

    feedBody = feedBody.replace('录课可以暂停', '录课可以暂停!');
    api.updater.state = { phase: 'idle' };
    await T(`return click(byText('.ab-row button','检查更新'))`);
    const err = await until(() => T(`const e=$('.ab-update .ab-err');return e&&e.innerText`), 8000, 'tampered error');
    assert.match(err, /签名不对/);
    feedBody = sign(manifest);
    mark('a tampered manifest is refused with a clear message', { err });

    // ── 4. 静默检查 → 右下角提示 → 跳过 ──
    await T(`return click('.help-x')`);
    await until(() => T(`return !$('.help')`), 3000, 'help closed');
    api.updater.state = { phase: 'idle' };
    await api.updater.check();
    const toast = await until(() => T(`const t=$('.up-toast');return t&&!t.classList.contains('ok')&&t.innerText`), 5000, 'silent check toast');
    assert.ok(toast.includes('发现新版本 ' + NEXT), toast); assert.match(toast, /等 2 项/);
    const dot = await T(`return !!$('.rail-b[aria-label="帮助"] .help-dot')`);
    assert.ok(dot, 'help button shows a dot');
    await shot('help-5-new-version-toast.png');
    await T(`return click(byText('.up-toast button','跳过这个版本'))`);
    await until(() => T(`return !$('.up-toast')`), 3000, 'toast gone');
    await until(() => api.settings.updateSkip === NEXT, 3000, 'skip saved');
    api.updater.state = { phase: 'idle' };
    await api.updater.check();
    await sleep(800);
    assert.equal(await T(`return !!$('.up-toast')`), false, 'skipped version is not announced again');
    mark('silent check announces once; skipping a version is remembered');

    await T(`return click('.tb-brand')`);
    await until(() => T(`return !!$('.ab-row input[type=checkbox]')`), 3000, 'about via brand');
    await T(`return click('.ab-row input[type=checkbox]')`);
    await until(() => api.settings.updateCheck === false, 3000, 'auto check off');
    await T(`return click('.ab-row input[type=checkbox]')`);
    await until(() => api.settings.updateCheck === true, 3000, 'auto check on');
    mark('brand opens about; auto-check toggle is saved');

    assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security Warning/.test(e)), []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results }, null, 2));
    console.log('RESULT ' + out);
    clearTimeout(timer); server.close(); app.exit(0);
  } catch (e) {
    console.error('FAIL', e.stack || e);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), errors, results }, null, 2));
    clearTimeout(timer); server.close(); app.exit(1);
  }
}
