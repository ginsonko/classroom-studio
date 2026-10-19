'use strict';
// 家长通知：企业微信群「消息推送」（Webhook）和邮件（SMTP，SSL 465 或 STARTTLS 587）。
// Webhook 地址和邮箱授权码都是密钥：用 safeStorage 加密存在 DATA/notify.json，页面只能看到末 4 位，日志里不出现。
// 只有老师在预览里点了确认才会调用 send，这里不做任何自动发送。
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { safeStorage, nativeImage, clipboard, ClipboardItem } = require('electron');

const WECOM_IMAGE_MAX = 2 * 1024 * 1024;
const WECOM_MD_MAX = 4096;

function seal(s) {
  if (safeStorage.isEncryptionAvailable()) return { enc: 'safe', v: safeStorage.encryptString(s).toString('base64') };
  return { enc: 'plain', v: Buffer.from(s, 'utf8').toString('base64') };
}
function unseal(x) {
  if (!x?.v) return '';
  try { return x.enc === 'safe' ? safeStorage.decryptString(Buffer.from(x.v, 'base64')) : Buffer.from(x.v, 'base64').toString('utf8'); } catch { return ''; }
}

/** 老师可能只粘贴了 key，也可能粘贴整条地址（带空格、换行） */
function webhookUrl(input, test) {
  const s = String(input || '').replace(/\s+/g, '');
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s)) return 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + s;
  let u;
  try { u = new URL(s); } catch { throw Error('这不是一个网址。请在企业微信群的「消息推送」里复制完整的 Webhook 地址'); }
  const key = u.searchParams.get('key') || '';
  if (u.protocol === 'https:' && u.hostname === 'qyapi.weixin.qq.com' && u.pathname === '/cgi-bin/webhook/send' && /^[\w-]{8,}$/.test(key)) return `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`;
  if (test && u.protocol === 'http:' && u.hostname === '127.0.0.1') return u.toString();
  throw Error('地址不对：企业微信消息推送地址以 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key= 开头');
}
const keyHint = (url) => (new URL(url).searchParams.get('key') || url).slice(-4);

function emails(input) {
  const list = String(input || '').split(/[\s,;，；、]+/).map((x) => x.trim()).filter(Boolean);
  for (const e of list) if (!/^[^\s@<>()"]+@[^\s@<>()"]+\.[A-Za-z]{2,}$/.test(e)) throw Error('邮箱地址格式不对：' + e);
  if (list.length > 3) throw Error('每个学生最多填 3 个家长邮箱');
  return [...new Set(list)];
}
const maskMail = (e) => e.replace(/^(.)[^@]*(@.*)$/, '$1***$2');

function wecomError(j, status) {
  const code = j?.errcode, msg = String(j?.errmsg || '').split(/, ?hint|more info/i)[0].slice(0, 120);
  if (code === 93000) return '企业微信说这个地址无效：消息推送可能被删除或重建了，请重新复制地址';
  if (code === 45009) return '企业微信限制发送频率（每分钟最多 20 条），请 1 分钟后再试';
  if (code === 40058 || code === 44004) return '消息内容为空或格式不对（' + msg + '）';
  if (code === 40009 || code === 40011) return '长图太大或格式不支持（企业微信要求 2MB 以内的 PNG/JPG）';
  if (code === 93004) return '这个群的消息推送已被停用，请在群设置里重新开启';
  if (code !== undefined) return `企业微信返回错误 ${code}：${msg}`;
  return '企业微信没有正常回应' + (status ? `（HTTP ${status}）` : '');
}
async function wecomPost(url, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.errcode !== 0) throw Error(wecomError(j, res.status));
  } catch (e) {
    if (e?.name === 'AbortError') throw Error('企业微信 20 秒没有回应，请检查网络后重发');
    if (e instanceof TypeError || /fetch failed/i.test(String(e?.message))) throw Error('连不上企业微信服务器（' + (e.cause?.code || e.message) + '），请检查网络后重发');
    throw e;
  } finally { clearTimeout(t); }
}
/** markdown 按 UTF-8 字节截断，避免切坏汉字 */
function clipBytes(s, max) {
  const b = Buffer.from(s, 'utf8');
  if (b.length <= max) return s;
  const tail = '\n…（内容较长，完整版见长图）';
  let out = b.subarray(0, max - Buffer.byteLength(tail)).toString('utf8');
  out = out.replace(/\uFFFD+$/, '');
  return out + tail;
}
/** 企业微信图片 ≤ 2MB：先原样，不行转 JPEG 降质量，再缩小 */
function wecomImage(file) {
  const raw = fs.readFileSync(file);
  if (raw.length <= WECOM_IMAGE_MAX && /\.(png|jpe?g)$/i.test(file)) return raw;
  let img = nativeImage.createFromPath(file);
  if (img.isEmpty()) throw Error('长图读不出来，请重新导出长图');
  for (let round = 0; round < 6; round++) {
    for (const q of [85, 70, 55]) { const j = img.toJPEG(q); if (j.length <= WECOM_IMAGE_MAX) return j; }
    const { width } = img.getSize();
    img = img.resize({ width: Math.max(320, Math.round(width * 0.75)), quality: 'good' });
  }
  throw Error('长图压缩到 2MB 以内失败，请减少内容后重新导出');
}

// ── 最小 SMTP 客户端 ─────────────────────────────────────
class Wire {
  constructor(sock) {
    this.sock = sock; this.buf = ''; this.cur = []; this.ready = []; this.waiters = []; this.err = null;
    sock.setEncoding('utf8');
    sock.on('data', (d) => { this.buf += d; this.pump(); });
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => this.fail(Error('邮件服务器断开了连接')));
  }
  pump() {
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1);
      this.cur.push(line);
      if (/^\d{3}(?: |$)/.test(line)) { this.ready.push({ code: Number(line.slice(0, 3)), text: this.cur.join('\n') }); this.cur = []; }
    }
    this.flush();
  }
  flush() { while (this.waiters.length && (this.ready.length || this.err)) { const w = this.waiters.shift(); if (this.ready.length) w.ok(this.ready.shift()); else w.no(this.err); } }
  fail(e) { if (!this.err) this.err = e; this.flush(); }
  read() { return new Promise((ok, no) => { this.waiters.push({ ok, no }); this.flush(); }); }
  /** verb 只用于报错，AUTH 的内容不会出现在错误信息里 */
  async cmd(line, expect, verb) {
    if (line !== null) this.sock.write(line + '\r\n');
    const r = await this.read();
    if (!expect.includes(r.code)) throw smtpError(r, verb);
    return r;
  }
}
function smtpError(r, verb) {
  const said = r.text.replace(/\s+/g, ' ').slice(0, 160);
  if (verb === 'AUTH') return Error('邮箱账号或授权码不对。QQ/163 邮箱要填在网页版邮箱设置里生成的「授权码」，不是登录密码（服务器：' + said + '）');
  if (verb === 'RCPT') return Error('收件邮箱被拒收，请检查家长邮箱地址（服务器：' + said + '）');
  if (verb === 'MAIL') return Error('发件邮箱被拒绝，发件邮箱必须和登录账号一致（服务器：' + said + '）');
  if (verb === 'DATA' || verb === 'BODY') return Error('邮件被服务器拒收，可能被判为垃圾邮件或附件太大（服务器：' + said + '）');
  return Error(`邮件服务器拒绝了 ${verb}（${said}）`);
}
function connectError(e, host, port) {
  const code = e?.code || '';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return Error(`找不到邮件服务器 ${host}，请检查服务器地址和网络`);
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH/.test(code)) return Error(`连不上邮件服务器 ${host}:${port}（${code}），请检查端口（QQ/163 用 465）和网络`);
  if (/CERT|SSL|TLS|self.signed/i.test(code + (e?.message || ''))) return Error(`和邮件服务器 ${host} 建立加密连接失败（${code || e.message}）`);
  return e instanceof Error ? e : Error(String(e));
}

/** security: 'ssl'（465，一连上就加密）| 'starttls'（587）| 'none'（只给测试用的本机假服务器） */
async function smtpSend({ host, port, security, user, pass, from, to, raw, timeout = 30000 }) {
  let sock, wire, timer;
  const open = (s) => { wire = new Wire(s); return wire; };
  const connect = () => new Promise((ok, no) => {
    const s = security === 'ssl' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    s.once(security === 'ssl' ? 'secureConnect' : 'connect', () => { s.removeAllListeners('error'); ok(s); });
    s.once('error', no);
  });
  const work = (async () => {
    try { sock = await connect(); } catch (e) { throw connectError(e, host, port); }
    open(sock);
    await wire.cmd(null, [220], '连接');
    const name = 'classroom-studio';
    let ehlo = await wire.cmd('EHLO ' + name, [250], 'EHLO');
    if (security === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.text)) throw Error('邮件服务器不支持 STARTTLS 加密，请改用 465 端口');
      await wire.cmd('STARTTLS', [220], 'STARTTLS');
      sock.removeAllListeners('data'); sock.removeAllListeners('close'); sock.removeAllListeners('error');
      sock = await new Promise((ok, no) => { const s = tls.connect({ socket: sock, servername: host }); s.once('secureConnect', () => ok(s)); s.once('error', (e) => no(connectError(e, host, port))); });
      open(sock);
      ehlo = await wire.cmd('EHLO ' + name, [250], 'EHLO');
    }
    if (/AUTH[ =][^\n]*\bLOGIN\b/i.test(ehlo.text) || !/AUTH[ =][^\n]*\bPLAIN\b/i.test(ehlo.text)) {
      await wire.cmd('AUTH LOGIN', [334], 'AUTH');
      await wire.cmd(Buffer.from(user).toString('base64'), [334], 'AUTH');
      await wire.cmd(Buffer.from(pass).toString('base64'), [235], 'AUTH');
    } else {
      await wire.cmd('AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`).toString('base64'), [235], 'AUTH');
    }
    await wire.cmd(`MAIL FROM:<${from}>`, [250], 'MAIL');
    for (const t of to) await wire.cmd(`RCPT TO:<${t}>`, [250, 251], 'RCPT');
    await wire.cmd('DATA', [354], 'DATA');
    const body = raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    sock.write(body + (body.endsWith('\r\n') ? '' : '\r\n'));
    await wire.cmd('.', [250], 'BODY');
    await wire.cmd('QUIT', [221], 'QUIT').catch(() => {});
  })();
  const limit = new Promise((_, no) => { timer = setTimeout(() => no(Error(`邮件服务器 ${Math.round(timeout / 1000)} 秒没有回应，请检查网络后重发`)), timeout); });
  try { await Promise.race([work, limit]); } finally { clearTimeout(timer); work.catch(() => {}); sock?.destroy(); }
}

const b64 = (s) => '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
const wrap = (buf) => buf.toString('base64').replace(/.{76}(?=.)/g, '$&\r\n');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function rfcDate(d) {
  const p2 = (n) => String(n).padStart(2, '0'), tz = -d.getTimezoneOffset();
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}, ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()} `
    + `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${tz >= 0 ? '+' : '-'}${p2(Math.floor(Math.abs(tz) / 60))}${p2(Math.abs(tz) % 60)}`;
}
/** multipart/related：正文 HTML 里内嵌长图（家长打开邮件就能看到），同时保留纯文字版 */
function mimeMessage({ fromName, from, to, subject, text, image, imageName }) {
  const rel = 'rel-' + crypto.randomUUID(), alt = 'alt-' + crypto.randomUUID();
  const paras = String(text).split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => `<p style="margin:0 0 10px;line-height:1.7">${esc(p)}</p>`).join('');
  const html = `<!doctype html><html><body style="font-family:'Microsoft YaHei',sans-serif;font-size:15px;color:#222;max-width:760px">${paras}${image ? '<p><img src="cid:report" style="max-width:100%" alt="课后反馈长图"></p>' : ''}<p style="color:#999;font-size:12px">由最强网课教辅系统发送</p></body></html>`;
  const lines = [
    `From: ${b64(fromName || '老师')} <${from}>`, `To: ${to.map((t) => `<${t}>`).join(', ')}`, `Subject: ${b64(subject)}`,
    `Date: ${rfcDate(new Date())}`, `Message-ID: <${crypto.randomUUID()}@classroom-studio>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${rel}"`, '',
    `--${rel}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(text, 'utf8')),
    `--${alt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(html, 'utf8')),
    `--${alt}--`,
  ];
  if (image) lines.push(`--${rel}`, `Content-Type: image/png; name="${b64(imageName)}"`, 'Content-Transfer-Encoding: base64', 'Content-ID: <report>', `Content-Disposition: inline; filename="${b64(imageName)}"`, '', wrap(image));
  lines.push(`--${rel}--`, '');
  return lines.join('\r\n');
}

/** 常见邮箱的 SMTP 服务器，老师只填邮箱地址时自动带出 */
const PRESETS = { 'qq.com': 'smtp.qq.com', 'foxmail.com': 'smtp.qq.com', 'vip.qq.com': 'smtp.qq.com', '163.com': 'smtp.163.com', '126.com': 'smtp.126.com', 'yeah.net': 'smtp.yeah.net', 'sina.com': 'smtp.sina.com', 'sohu.com': 'smtp.sohu.com', 'aliyun.com': 'smtp.aliyun.com', 'gmail.com': 'smtp.gmail.com', '139.com': 'smtp.139.com' };

class Notify {
  constructor({ dir, root, test, log }) { this.file = path.join(dir, 'notify.json'); this.root = root; this.testMode = !!test; this.log = log; this.recent = new Map(); }
  load() { try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); return { smtp: j.smtp || {}, contacts: j.contacts || {} }; } catch { return { smtp: {}, contacts: {} }; } }
  write(cfg) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2)); fs.renameSync(tmp, this.file); }
  view(cfg = this.load()) {
    const s = cfg.smtp, contacts = {};
    for (const [id, c] of Object.entries(cfg.contacts)) contacts[id] = { wecom: c.wecom?.hint || '', wecomName: c.wecomName || '', email: c.email || [] };
    return { smtp: { user: s.user || '', host: s.host || '', port: s.port || 465, security: s.security || 'ssl', fromName: s.fromName || '', hasPass: !!unseal(s.pass), passHint: s.pass ? s.hint || '' : '' }, contacts };
  }
  setSmtp(v = {}) {
    const cfg = this.load(), s = { ...cfg.smtp };
    if (v.user !== undefined) { const [u] = v.user ? emails(v.user) : ['']; if (v.user && !u) throw Error('发件邮箱格式不对'); s.user = u || ''; }
    const domain = (s.user.split('@')[1] || '').toLowerCase();
    if (v.host !== undefined) s.host = String(v.host).trim().toLowerCase() || PRESETS[domain] || '';
    else if (!s.host && PRESETS[domain]) s.host = PRESETS[domain];
    if (s.host && !/^[a-z0-9.-]+$/.test(s.host)) throw Error('邮件服务器地址格式不对');
    if (v.port !== undefined) { const p = Number(v.port); if (!Number.isInteger(p) || p < 1 || p > 65535) throw Error('端口要是 1~65535 的数字'); s.port = p; }
    s.port ||= 465;
    s.security = v.security === 'none' && this.testMode ? 'none' : s.port === 587 || v.security === 'starttls' ? 'starttls' : 'ssl';
    if (v.fromName !== undefined) s.fromName = String(v.fromName).trim().slice(0, 40);
    if (v.pass !== undefined) { const p = String(v.pass).replace(/\s+/g, ''); if (p) { s.pass = seal(p); s.hint = p.slice(-4); } else { delete s.pass; delete s.hint; } }
    cfg.smtp = s; this.write(cfg); this.log?.info('家长通知', '发件邮箱已保存', s.host, s.port, s.security);
    return this.view(cfg);
  }
  setContact(v = {}) {
    const id = String(v.studentId || '');
    if (!id) throw Error('没有选择学生');
    const cfg = this.load(), c = { ...cfg.contacts[id] };
    if (v.wecom !== undefined) { if (String(v.wecom).trim()) { const url = webhookUrl(v.wecom, this.testMode); c.wecom = { ...seal(url), hint: keyHint(url) }; } else delete c.wecom; }
    if (v.wecomName !== undefined) c.wecomName = String(v.wecomName).trim().slice(0, 40);
    if (v.email !== undefined) c.email = emails(v.email);
    cfg.contacts[id] = c; this.write(cfg); this.log?.info('家长通知', '联系方式已保存', id.slice(0, 8), c.wecom ? '企业微信' : '', c.email?.length ? '邮箱' + c.email.length : '');
    return this.view(cfg);
  }
  imageFile(p) {
    if (!p) return '';
    const f = path.resolve(String(p)), rel = path.relative(this.root, f);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !/\.(png|jpe?g)$/i.test(f)) throw Error('只能发送学情库里导出的长图');
    if (!fs.existsSync(f)) throw Error('长图文件不见了，请重新导出长图');
    return f;
  }
  smtpConfig(cfg) {
    const s = cfg.smtp, pass = unseal(s.pass);
    if (!s.user || !s.host || !pass) throw Error('还没有设置发件邮箱（邮箱地址 + 授权码）');
    return { host: s.host, port: s.port || 465, security: s.security || 'ssl', user: s.user, pass, from: s.user, fromName: s.fromName };
  }
  async wecom(url, { markdown, image }) {
    await wecomPost(url, { msgtype: 'markdown', markdown: { content: clipBytes(markdown, WECOM_MD_MAX) } });
    if (image) { const buf = wecomImage(image); await wecomPost(url, { msgtype: 'image', image: { base64: buf.toString('base64'), md5: crypto.createHash('md5').update(buf).digest('hex') } }); }
  }
  async email(cfg, to, { subject, text, image }) {
    const s = this.smtpConfig(cfg);
    const raw = mimeMessage({ fromName: s.fromName, from: s.from, to, subject, text, image: image ? fs.readFileSync(image) : null, imageName: subject.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60) + '.png' });
    await smtpSend({ ...s, to, raw });
  }
  /** 发给家长。返回每个渠道的结果；失败的渠道不影响其他渠道 */
  async send(v = {}) {
    const cfg = this.load(), c = cfg.contacts[String(v.studentId || '')] || {};
    const channels = (Array.isArray(v.channels) ? v.channels : []).filter((x) => x === 'wecom' || x === 'email');
    if (!channels.length) throw Error('请至少选择一种发送方式');
    const text = String(v.text || '').trim(), markdown = String(v.markdown || text).trim(), subject = String(v.subject || '课后反馈').trim().slice(0, 120);
    if (!text) throw Error('消息内容是空的');
    if (text.length > 20000) throw Error('消息太长');
    const image = this.imageFile(v.image);
    const sig = crypto.createHash('sha1').update(text + '|' + (image || '')).digest('hex');
    const out = [];
    for (const ch of channels) {
      const key = `${v.studentId}:${ch}:${sig}`, at = new Date().toISOString();
      try {
        if (Date.now() - (this.recent.get(key) || 0) < 60000) throw Error('1 分钟内已经发过同样的内容，没有重复发送');
        if (ch === 'wecom') {
          const url = unseal(c.wecom);
          if (!url) throw Error('这个学生还没有填企业微信消息推送地址');
          await this.wecom(url, { markdown, image });
          out.push({ channel: ch, ok: true, at, to: (c.wecomName || '企业微信群') + ' …' + (c.wecom.hint || '') });
        } else {
          if (!c.email?.length) throw Error('这个学生还没有填家长邮箱');
          await this.email(cfg, c.email, { subject, text, image });
          out.push({ channel: ch, ok: true, at, to: c.email.map(maskMail).join('、') });
        }
        this.recent.set(key, Date.now());
      } catch (e) {
        out.push({ channel: ch, ok: false, at, error: e.message, to: ch === 'wecom' ? (c.wecom?.hint ? '…' + c.wecom.hint : '') : (c.email || []).map(maskMail).join('、') });
      }
    }
    this.log?.info('家长通知', '发送', out.map((r) => `${r.channel}:${r.ok ? 'ok' : r.error}`).join('；'));
    return out;
  }
  /** 测试：企业微信发一条短消息到群里；邮件发给老师自己 */
  async test(v = {}) {
    const cfg = this.load();
    if (v.channel === 'email') {
      const s = this.smtpConfig(cfg);
      await this.email(cfg, [s.user], { subject: '最强网课教辅系统 · 发件邮箱测试', text: '这是一封测试邮件。收到说明发件邮箱设置正确，可以给家长发课后反馈了。' });
      this.log?.info('家长通知', '邮件测试通过', s.host);
      return { ok: true, to: maskMail(s.user) };
    }
    const c = cfg.contacts[String(v.studentId || '')] || {}, url = unseal(c.wecom);
    if (!url) throw Error('先填写并保存企业微信消息推送地址');
    await wecomPost(url, { msgtype: 'text', text: { content: '最强网课教辅系统连接测试：这个群以后会收到课后反馈。' } });
    this.log?.info('家长通知', '企业微信测试通过');
    return { ok: true, to: '…' + c.wecom.hint };
  }
  /** Electron 44 起剪贴板是异步的 W3C 风格接口 */
  async copyImage(p) {
    const f = this.imageFile(p), img = nativeImage.createFromPath(f);
    if (img.isEmpty()) throw Error('长图读不出来，请重新导出');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
  }
  async handle(method, value) {
    switch (method) {
      case 'notify.get': return this.view();
      case 'notify.setSmtp': return this.setSmtp(value);
      case 'notify.setContact': return this.setContact(value);
      case 'notify.send': return this.send(value);
      case 'notify.test': return this.test(value);
      case 'notify.copyImage': return this.copyImage(value);
      default: throw Error('未知的通知操作：' + method);
    }
  }
}

module.exports = { Notify, webhookUrl, emails, mimeMessage, smtpSend, clipBytes, PRESETS };
