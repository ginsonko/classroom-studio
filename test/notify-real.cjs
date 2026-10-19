// 真实邮件发送实测（手动运行，会真的发信）：发件邮箱给自己发两封——设置测试信 + 一份带长图的课后反馈。
//   $env:CS_SMTP_USER='你@qq.com'; $env:CS_SMTP_PASS='授权码'; $env:CS_SMTP_IMAGE='某张长图.png'
//   npx electron test/quiet.cjs test/notify-real.cjs
// 授权码只从环境变量读，存在临时目录里（safeStorage 加密），结束后删除；输出里不打印授权码。
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { app } = require('electron');
const { Notify } = require('../electron/notify.cjs');

app.whenReady().then(async () => {
  const user = process.env.CS_SMTP_USER, pass = process.env.CS_SMTP_PASS, img = process.env.CS_SMTP_IMAGE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-mail-'));
  let code = 1;
  try {
    if (!user || !pass) throw Error('需要 CS_SMTP_USER 和 CS_SMTP_PASS');
    const root = path.join(dir, 'study'); fs.mkdirSync(root);
    const n = new Notify({ dir, root });
    const v = n.setSmtp({ user, pass, fromName: '教学导播台实测' });
    console.log('smtp', v.smtp.host, v.smtp.port, v.smtp.security, 'pass saved:', v.smtp.hasPass);
    let t = Date.now();
    const r1 = await n.test({ channel: 'email' });
    console.log('PASS 测试邮件已发给', r1.to, Date.now() - t, 'ms');
    n.setContact({ studentId: 's1', email: user });
    let image = '';
    if (img && fs.existsSync(img)) { image = path.join(root, '课后反馈长图.png'); fs.copyFileSync(img, image); }
    t = Date.now();
    const r2 = await n.send({
      studentId: 's1', channels: ['email'], image,
      subject: '小林 · 2026-10-18 课后反馈（实测）',
      text: '小林 · 2026-10-18 课后反馈\n\n本节课：洛伦兹力\n\n小林家长您好，今天我们复习了带电粒子在磁场中的运动。这是一封实测邮件，内容是样例。\n\n课后作业：小林-匀强磁场中的运动-作业-10月18日\n\n完整的课后反馈见下方长图。',
    });
    for (const r of r2) console.log(r.ok ? 'PASS' : 'FAIL', '课后反馈', r.ok ? '已发给 ' + r.to : r.error, Date.now() - t, 'ms', image ? '(带长图 ' + fs.statSync(image).size + ' 字节)' : '(无长图)');
    const dup = await n.send({ studentId: 's1', channels: ['email'], image, subject: 'x', text: '小林 · 2026-10-18 课后反馈\n\n本节课：洛伦兹力\n\n小林家长您好，今天我们复习了带电粒子在磁场中的运动。这是一封实测邮件，内容是样例。\n\n课后作业：小林-匀强磁场中的运动-作业-10月18日\n\n完整的课后反馈见下方长图。' });
    console.log(dup[0].ok ? 'FAIL 重复发送没被拦下' : 'PASS 重复发送被拦下：' + dup[0].error);
    const stored = fs.readFileSync(path.join(dir, 'notify.json'), 'utf8');
    console.log(stored.includes(pass) ? 'FAIL 授权码明文写进了文件' : 'PASS 配置文件里没有授权码明文');
    code = r2.every((r) => r.ok) && !dup[0].ok && !stored.includes(pass) ? 0 : 1;
  } catch (e) { console.log('FAIL', e.message.split(pass || '\u0000').join('***')); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); app.exit(code); }
});
