// 家长通知验收（Electron 主进程里跑，需要 safeStorage / nativeImage）：
//   npx electron test/quiet.cjs test/notify.cjs
// 本机假企业微信服务 + 假 SMTP 服务；最后做两项只读的网络探测（不登录、不发信）：
//   QQ / 163 邮箱 465 端口 TLS 握手并读取 EHLO；用一个不存在的 key 请求企业微信，确认错误码解释正确。
// CS_OFFLINE=1 跳过网络探测。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { app, nativeImage, clipboard, safeStorage } = require('electron');
const { Notify, webhookUrl, emails, clipBytes } = require('../electron/notify.cjs');

const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.stack]); } };

function fakeWecom() {
  const got = []; let reply = { errcode: 0, errmsg: 'ok' };
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      got.push({ url: req.url, body: JSON.parse(body) });
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, got, port: srv.address().port, set: (r) => (reply = r) })));
}

/** 最小假 SMTP：EHLO / AUTH LOGIN / MAIL / RCPT / DATA / QUIT，记录收到的信 */
function fakeSmtp({ user, pass }) {
  const mails = [];
  const srv = net.createServer((s) => {
    s.setEncoding('utf8');
    let buf = '', state = 'cmd', data = '', who = {}, auth = [];
    const say = (l) => s.write(l + '\r\n');
    say('220 fake.smtp ready');
    s.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (state === 'data') { if (line === '.') { state = 'cmd'; mails.push({ ...who, data }); data = ''; say('250 queued'); } else data += line + '\r\n'; continue; }
        if (state === 'user') { auth[0] = Buffer.from(line, 'base64').toString(); state = 'pass'; say('334 UGFzc3dvcmQ6'); continue; }
        if (state === 'pass') { auth[1] = Buffer.from(line, 'base64').toString(); state = 'cmd'; if (auth[0] === user && auth[1] === pass) { who.user = auth[0]; say('235 ok'); } else say('535 Login fail. Please enter your authorization code to login'); continue; }
        const v = line.split(' ')[0].toUpperCase();
        if (v === 'EHLO') { s.write('250-fake.smtp\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n'); }
        else if (v === 'AUTH') { state = 'user'; say('334 VXNlcm5hbWU6'); }
        else if (v === 'MAIL') { if (!who.user) say('530 auth first'); else { who.from = line; who.to = []; say('250 ok'); } }
        else if (v === 'RCPT') { who.to.push(/<(.+)>/.exec(line)[1]); say('250 ok'); }
        else if (v === 'DATA') { state = 'data'; say('354 go'); }
        else if (v === 'QUIT') { say('221 bye'); s.end(); }
        else say('502 ?');
      }
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, mails, port: srv.address().port })));
}

function bigPng(file) {
  // 噪点图压不小：1200×2400 的 PNG 远超 2MB，用来测企业微信图片压缩
  const w = 1200, h = 2400, buf = Buffer.alloc(w * h * 4);
  crypto.randomFillSync(buf); for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  fs.writeFileSync(file, nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG());
  return fs.statSync(file).size;
}
const mimePart = (raw, type) => {
  const i = raw.indexOf('Content-Type: ' + type);
  assert.ok(i >= 0, '找不到 ' + type);
  const body = raw.slice(raw.indexOf('\r\n\r\n', i) + 4); return Buffer.from(body.slice(0, body.indexOf('\r\n--')).replace(/\s+/g, ''), 'base64');
};

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-notify-'));
  const root = path.join(tmp, 'study'); fs.mkdirSync(path.join(root, '课后总结'), { recursive: true });
  const log = { info() {}, warn() {}, error() {} };
  const n = new Notify({ dir: tmp, root, test: true, log });
  const wecom = await fakeWecom();
  const smtp = await fakeSmtp({ user: 'teacher@qq.com', pass: 'abcdefghijklmnop' });
  const hook = `http://127.0.0.1:${wecom.port}/cgi-bin/webhook/send?key=test-key-1234`;

  await test('Webhook 地址：完整地址、只粘贴 key、带空格换行都认；别的网址拒绝', () => {
    const k = '693a91f6-7xxx-4bc4-97a0-0ec2sifa5aaa'.replace(/x/g, '0').replace(/s/g, '5').replace(/i/g, '1');
    assert.equal(webhookUrl(' https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + k + '\n'), 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + k);
    assert.equal(webhookUrl(k), 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + k);
    assert.throws(() => webhookUrl('https://evil.example.com/cgi-bin/webhook/send?key=' + k), /地址不对/);
    assert.throws(() => webhookUrl('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + k), /地址不对/);
    assert.throws(() => webhookUrl('随便写的'), /不是一个网址/);
    assert.throws(() => webhookUrl(hook), /地址不对/, '正式模式不允许本机地址');
    assert.equal(webhookUrl(hook, true), hook);
  });

  await test('家长邮箱：多个、中文逗号、去重、格式检查', () => {
    assert.deepEqual(emails('a@qq.com，b@163.com; a@qq.com'), ['a@qq.com', 'b@163.com']);
    assert.throws(() => emails('abc@'), /格式不对/);
    assert.throws(() => emails('a@qq.com,b@qq.com,c@qq.com,d@qq.com'), /最多/);
  });

  await test('密钥加密保存：notify.json 里没有 Webhook 和授权码明文，页面只看到末 4 位', () => {
    n.setContact({ studentId: 's1', wecom: hook, wecomName: '小明家长群', email: 'parent@qq.com' });
    const v = n.setSmtp({ user: 'teacher@qq.com', pass: 'abcd efgh ijkl mnop', fromName: '王老师', host: '127.0.0.1', port: smtp.port, security: 'none' });
    const raw = fs.readFileSync(path.join(tmp, 'notify.json'), 'utf8');
    assert.ok(!raw.includes('test-key-1234') && !raw.includes(String(wecom.port)), 'Webhook 明文泄露');
    assert.ok(!raw.includes('abcdefghijklmnop') && !raw.includes(Buffer.from('abcdefghijklmnop').toString('base64')), '授权码明文泄露');
    assert.equal(safeStorage.isEncryptionAvailable(), true);
    assert.deepEqual(v.contacts.s1, { wecom: '1234', wecomName: '小明家长群', email: ['parent@qq.com'] });
    assert.equal(v.smtp.hasPass, true); assert.equal(v.smtp.passHint, 'mnop'); assert.equal(v.smtp.security, 'none');
    assert.ok(!JSON.stringify(n.view()).includes('abcdefghijklmnop'));
    const auto = new Notify({ dir: path.join(tmp, 'auto'), root, test: false, log }).setSmtp({ user: 'x@163.com' });
    assert.equal(auto.smtp.host, 'smtp.163.com'); assert.equal(auto.smtp.port, 465); assert.equal(auto.smtp.security, 'ssl');
    assert.equal(new Notify({ dir: path.join(tmp, 'auto2'), root, test: false, log }).setSmtp({ user: 'x@qq.com', security: 'none' }).smtp.security, 'ssl', '正式模式不能关加密');
  });

  const png = path.join(root, '课后总结', '小明-课后反馈.png');
  const size = bigPng(png);
  const msg = { studentId: 's1', subject: '小明 · 2026-10-18 课后反馈', text: '本节课：磁场\n\n小明今天进步明显。\n\n.以点开头的一行', markdown: '**小明 · 2026-10-18 课后反馈**\n\n小明今天进步明显。', image: png };

  await test('企业微信：先发 markdown 再发图片，超过 2MB 的长图压缩到 2MB 内，md5 正确', async () => {
    assert.ok(size > 2 * 1024 * 1024, '测试图应超过 2MB，实际 ' + size);
    const r = await n.send({ ...msg, channels: ['wecom'] });
    assert.equal(r[0].ok, true, r[0].error); assert.match(r[0].to, /小明家长群 …1234/);
    assert.equal(wecom.got.length, 2);
    assert.equal(wecom.got[0].body.msgtype, 'markdown'); assert.match(wecom.got[0].body.markdown.content, /小明今天进步明显/);
    const img = wecom.got[1].body.image, buf = Buffer.from(img.base64, 'base64');
    assert.equal(wecom.got[1].body.msgtype, 'image');
    assert.ok(buf.length <= 2 * 1024 * 1024, '图片 ' + buf.length);
    assert.equal(crypto.createHash('md5').update(buf).digest('hex'), img.md5);
    assert.ok(!nativeImage.createFromBuffer(buf).isEmpty(), '压缩后的图打不开');
  });

  await test('防重复：1 分钟内同样内容不再发；失败的可以立即重发', async () => {
    const again = await n.send({ ...msg, channels: ['wecom'] });
    assert.equal(again[0].ok, false); assert.match(again[0].error, /1 分钟内已经发过/);
    assert.equal(wecom.got.length, 2);
    wecom.set({ errcode: 93000, errmsg: 'invalid webhook url, hint: [123], from ip: 1.2.3.4, more info at https://open.work.weixin.qq.com/devtool/query?e=93000' });
    const bad = await n.send({ ...msg, text: msg.text + '（改过）', channels: ['wecom'] });
    assert.equal(bad[0].ok, false); assert.match(bad[0].error, /地址无效/);
    wecom.set({ errcode: 0, errmsg: 'ok' });
    const retry = await n.send({ ...msg, text: msg.text + '（改过）', channels: ['wecom'] });
    assert.equal(retry[0].ok, true, retry[0].error);
  });

  await test('企业微信 markdown 超过 4096 字节时按字节截断，不切坏汉字', () => {
    const s = clipBytes('物理'.repeat(3000), 4096);
    assert.ok(Buffer.byteLength(s) <= 4096); assert.ok(!s.includes('\uFFFD')); assert.match(s, /完整版见长图/);
  });

  await test('邮件：登录、收件人、主题编码、正文和内嵌长图都对；以点开头的行不丢', async () => {
    const r = await n.send({ ...msg, channels: ['email'] });
    assert.equal(r[0].ok, true, r[0].error); assert.equal(r[0].to, 'p***@qq.com');
    const m = smtp.mails.at(-1);
    assert.equal(m.user, 'teacher@qq.com'); assert.deepEqual(m.to, ['parent@qq.com']); assert.match(m.from, /<teacher@qq\.com>/);
    const raw = m.data.replace(/\r\n\.\./g, '\r\n.');
    const subj = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(raw);
    assert.equal(Buffer.from(subj[1], 'base64').toString(), msg.subject);
    assert.match(raw, /From: =\?UTF-8\?B\?[^?]+\?= <teacher@qq\.com>/);
    assert.match(raw, /multipart\/related/); assert.match(raw, /Content-ID: <report>/); assert.match(raw, /^Date: \w{3}, \d{1,2} \w{3} \d{4} \d\d:\d\d:\d\d [+-]\d{4}$/m);
    assert.equal(mimePart(raw, 'text/plain').toString(), msg.text);
    const html = mimePart(raw, 'text/html').toString();
    assert.match(html, /小明今天进步明显/); assert.match(html, /cid:report/); assert.match(html, /\.以点开头的一行/);
    assert.equal(mimePart(raw, 'image/png').length, size, '邮件里的长图应是原图');
  });

  await test('邮件：授权码错了给出能看懂的提示；两个渠道互不影响', async () => {
    n.setSmtp({ pass: 'wrongwrongwrong1', host: '127.0.0.1', port: smtp.port, security: 'none' });
    const r = await n.send({ ...msg, text: msg.text + '（第三版）', channels: ['wecom', 'email'] });
    assert.equal(r.find((x) => x.channel === 'wecom').ok, true);
    const e = r.find((x) => x.channel === 'email');
    assert.equal(e.ok, false); assert.match(e.error, /授权码/); assert.ok(!e.error.includes('wrongwrong'), '错误信息里不能有授权码');
    n.setSmtp({ pass: 'abcdefghijklmnop', host: '127.0.0.1', port: smtp.port, security: 'none' });
  });

  await test('测试按钮：企业微信发一条文字；邮件发给老师自己', async () => {
    const before = wecom.got.length;
    await n.test({ channel: 'wecom', studentId: 's1' });
    assert.equal(wecom.got[before].body.msgtype, 'text');
    const r = await n.test({ channel: 'email' });
    assert.equal(r.to, 't***@qq.com'); assert.deepEqual(smtp.mails.at(-1).to, ['teacher@qq.com']);
  });

  await test('安全：只能发学情库里的图片；没设置的渠道给出提示；连不上服务器有中文说明', async () => {
    await assert.rejects(n.send({ ...msg, image: path.join(tmp, 'notify.json'), channels: ['wecom'] }), /只能发送学情库里导出的长图/);
    const none = await n.send({ ...msg, studentId: 'nobody', channels: ['wecom', 'email'] });
    assert.match(none[0].error, /还没有填企业微信/); assert.match(none[1].error, /还没有填家长邮箱/);
    n.setSmtp({ host: '127.0.0.1', port: 1, security: 'none' });
    n.setContact({ studentId: 's2', email: 'p2@163.com' });
    const off = await n.send({ ...msg, studentId: 's2', channels: ['email'] });
    assert.match(off[0].error, /连不上邮件服务器 127\.0\.0\.1:1/);
  });

  await test('复制长图到剪贴板（家长只用个人微信时手动粘贴）', async () => {
    const within = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Error(what + ' 超时')), ms))]);
    await within(clipboard.writeText('占位'), 5000, '写文字');
    await within(n.copyImage(png), 10000, '复制长图');
    assert.equal(await within(clipboard.has('image/png'), 5000, '读剪贴板'), true);
  });

  if (process.env.CS_OFFLINE !== '1') {
    await test('网络探测：QQ / 163 邮箱 465 端口 TLS 握手成功并支持 AUTH LOGIN（不登录）', async () => {
      for (const host of ['smtp.qq.com', 'smtp.163.com']) {
        const said = await new Promise((ok, no) => {
          const s = tls.connect({ host, port: 465, servername: host }); let buf = '', sent = false;
          const t = setTimeout(() => { s.destroy(); no(Error(host + ' 超时')); }, 15000);
          s.setEncoding('utf8'); s.on('error', (e) => { clearTimeout(t); no(e); });
          s.on('data', (d) => { buf += d; if (!sent && /^220 /m.test(buf)) { sent = true; s.write('EHLO probe\r\n'); } else if (sent && /^250 /m.test(buf)) { s.write('QUIT\r\n'); clearTimeout(t); s.end(); ok(buf); } });
        });
        assert.match(said, /AUTH[ =][^\n]*LOGIN/i, host + ' 没有 AUTH LOGIN：' + said);
      }
    });
    await test('网络探测：企业微信对不存在的 key 返回 93000，提示正确（不会发出任何消息）', async () => {
      const real = new Notify({ dir: path.join(tmp, 'real'), root, test: false, log });
      real.setContact({ studentId: 'x', wecom: '00000000-0000-0000-0000-000000000000' });
      await assert.rejects(real.test({ channel: 'wecom', studentId: 'x' }), /地址无效/);
    });
  }

  wecom.srv.close(); smtp.srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const r of results) console.log(r[0], r[1], r[2] ? '\n' + r[2] : '');
  const bad = results.filter((r) => r[0] !== 'ok').length;
  console.log(`notify: ${results.length - bad}/${results.length} 通过`);
  app.exit(bad ? 1 : 0);
});
