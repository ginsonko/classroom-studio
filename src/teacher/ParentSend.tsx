// 家长通知：联系方式设置 + 发送前预览确认。密钥（Webhook、授权码）只在主进程里，页面只看得到末 4 位。
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Check, ClipboardCopy, Copy, Loader2, Mail, MessageSquareText, Send, Settings2, X } from 'lucide-react';
import { host } from '../lib/host';
import { parentMessage, type LessonNote, type SendRecord } from '../lib/studyLogic';
import type { Student } from '../lib/types';

export interface Contact { wecom: string; wecomName: string; email: string[] }
export interface NotifyView { smtp: { user: string; host: string; port: number; security: string; fromName: string; hasPass: boolean; passHint: string }; contacts: Record<string, Contact> }
const EMPTY: NotifyView = { smtp: { user: '', host: '', port: 465, security: 'ssl', fromName: '', hasPass: false, passHint: '' }, contacts: {} };

export const useNotify = create<{ v: NotifyView; loaded: boolean; refresh: () => Promise<void>; set: (v: NotifyView) => void }>()((set) => ({
  v: EMPTY, loaded: false,
  refresh: async () => { if (!host.electron) { set({ loaded: true }); return; } try { set({ v: await host.call<NotifyView>('notify.get'), loaded: true }); } catch { set({ loaded: true }); } },
  set: (v) => set({ v }),
}));
const contactOf = (v: NotifyView, id: string): Contact => v.contacts[id] ?? { wecom: '', wecomName: '', email: [] };
export const smtpReady = (v: NotifyView) => !!(v.smtp.user && v.smtp.host && v.smtp.hasPass);
const PRESET: Record<string, string> = { 'qq.com': 'smtp.qq.com', 'foxmail.com': 'smtp.qq.com', 'vip.qq.com': 'smtp.qq.com', '163.com': 'smtp.163.com', '126.com': 'smtp.126.com', 'yeah.net': 'smtp.yeah.net', 'sina.com': 'smtp.sina.com', 'sohu.com': 'smtp.sohu.com', 'aliyun.com': 'smtp.aliyun.com', 'gmail.com': 'smtp.gmail.com', '139.com': 'smtp.139.com' };
const CH_NAME = { wecom: '企业微信群', email: '邮件' } as const;
const when = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 课后总结下方的发送记录 */
export function SendLog({ sends }: { sends?: SendRecord[] }) {
  if (!sends?.length) return null;
  return <div className="ps-log">{sends.slice(-6).reverse().map((s, i) => <div key={i} className={s.ok ? 'ok' : 'bad'}>{s.ok ? <Check size={12} /> : <X size={12} />}<b>{CH_NAME[s.channel]}</b><span>{when(s.at)}</span><i>{s.ok ? '已发送给 ' + s.to : s.error}</i></div>)}</div>;
}

/** 学生家长的联系方式 + 老师的发件邮箱 */
export function ContactsSheet({ student, onClose }: { student: Student; onClose: () => void }) {
  const v = useNotify((s) => s.v), setV = useNotify((s) => s.set);
  const c = contactOf(v, student.id);
  const [wecom, setWecom] = useState(''), [wecomName, setWecomName] = useState(c.wecomName), [email, setEmail] = useState(c.email.join('，'));
  const [user, setUser] = useState(v.smtp.user), [pass, setPass] = useState(''), [fromName, setFromName] = useState(v.smtp.fromName), [smtpHost, setHost] = useState(v.smtp.host), [port, setPort] = useState(String(v.smtp.port || 465));
  const [busy, setBusy] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const run = async (k: string, fn: () => Promise<string>) => { setBusy(k); setErr(''); setMsg(''); try { setMsg(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  const save = () => run('save', async () => {
    let n = await host.call<NotifyView>('notify.setContact', { studentId: student.id, wecomName, email, ...(wecom.trim() ? { wecom } : {}) });
    const smtpChanged = user !== v.smtp.user || !!pass || fromName !== v.smtp.fromName || smtpHost !== v.smtp.host || port !== String(v.smtp.port || 465);
    if (smtpChanged) n = await host.call<NotifyView>('notify.setSmtp', { user, fromName, port: Number(port) || 465, ...(pass ? { pass } : {}), ...(smtpHost !== v.smtp.host ? { host: smtpHost } : {}) });
    setV(n); setWecom(''); setPass(''); setHost(n.smtp.host); setPort(String(n.smtp.port));
    return '已保存。Webhook 地址和授权码已加密保存在本机。';
  });
  const clearWecom = () => run('clear', async () => { setV(await host.call<NotifyView>('notify.setContact', { studentId: student.id, wecom: '' })); return '已删除企业微信地址。'; });
  const testWecom = () => run('tw', async () => { const r = await host.call<{ to: string }>('notify.test', { channel: 'wecom', studentId: student.id }); return `测试消息已发到群里（${r.to}），请在企业微信里确认收到。`; });
  const testMail = () => run('tm', async () => { const r = await host.call<{ to: string }>('notify.test', { channel: 'email' }); return `测试邮件已发给你自己（${r.to}），请去邮箱确认收到（可能在垃圾箱）。`; });
  const dirty = !!wecom.trim() || wecomName !== c.wecomName || email !== c.email.join('，') || user !== v.smtp.user || !!pass || fromName !== v.smtp.fromName || smtpHost !== v.smtp.host || port !== String(v.smtp.port || 465);
  return <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
    <form className="record-editor sd-editor ps-sheet" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="card-h"><b>{student.name} · 家长联系方式</b><span className="flex" /><button type="button" onClick={onClose} aria-label="关闭"><X size={16} /></button></div>
      <h4><MessageSquareText size={14} />企业微信群（消息推送）</h4>
      <label>Webhook 地址 <i>{c.wecom ? `已保存（…${c.wecom}），要更换就粘贴新的` : '在企业微信群设置 → 消息推送 → 添加后复制'}</i><input value={wecom} onChange={(e) => setWecom(e.target.value)} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" autoComplete="off" spellCheck={false} /></label>
      <label>群名称 <i>只用来提醒你发到了哪个群</i><input value={wecomName} onChange={(e) => setWecomName(e.target.value)} placeholder={`例如：${student.name}家长群`} /></label>
      {c.wecom && <div className="ags-row"><button type="button" className="sd-btn" disabled={!!busy || dirty} onClick={() => void testWecom()}>{busy === 'tw' ? <Loader2 size={13} className="ags-spin" /> : <Send size={13} />}发一条测试消息到群里</button><button type="button" className="sd-btn" disabled={!!busy} onClick={() => void clearWecom()}>删除这个地址</button></div>}
      <p className="sd-note">只能发到企业微信的「内部群」。家长只用个人微信的话，用下面的邮件，或在发送窗口里「复制长图」后到微信里粘贴。</p>
      <h4><Mail size={14} />邮件</h4>
      <label>家长邮箱 <i>可以填多个，用逗号隔开；QQ 邮箱能在微信里收到提醒</i><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="例如：12345678@qq.com" /></label>
      <div className="ps-smtp">
        <b>你的发件邮箱（所有学生共用）</b>
        <div className="record-two"><label>邮箱地址<input value={user} onChange={(e) => { const u = e.target.value.trim(), p = PRESET[u.split('@')[1]?.toLowerCase() ?? '']; setUser(u); if (p && (!smtpHost || Object.values(PRESET).includes(smtpHost))) { setHost(p); setPort('465'); } }} placeholder="你的 QQ / 163 邮箱" /></label><label>授权码 <i>{v.smtp.hasPass ? `已保存（…${v.smtp.passHint}）` : '不是邮箱密码'}</i><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={v.smtp.hasPass ? '不改就留空' : '邮箱设置里生成的 16 位授权码'} autoComplete="new-password" /></label></div>
        <div className="record-two"><label>发件人显示名<input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="例如：王老师（物理）" /></label><label>服务器和端口 <i>QQ、163 会自动填</i><div className="ps-host"><input value={smtpHost} onChange={(e) => setHost(e.target.value.trim())} placeholder="smtp.qq.com" /><input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} /></div></label></div>
        {smtpReady(v) && <div className="ags-row"><button type="button" className="sd-btn" disabled={!!busy || dirty} onClick={() => void testMail()}>{busy === 'tm' ? <Loader2 size={13} className="ags-spin" /> : <Send size={13} />}发一封测试邮件给自己</button></div>}
      </div>
      {dirty && <p className="sd-note">先保存，再测试。</p>}
      {msg && <p className="sd-msg">{msg}</p>}
      {err && <p className="sd-err">{err}</p>}
      <div className="record-actions"><button type="button" onClick={onClose}>关闭</button><button className="btn-cue" type="submit" disabled={!!busy || !dirty}>{busy === 'save' ? '保存中…' : '保存'}</button></div>
    </form>
  </div>;
}

/** 发送前预览：老师看过内容、选好渠道、点确认才发 */
export function SendSheet({ note, student, image, makeImage, onSent, onClose }: {
  note: LessonNote; student: Student; image: string; makeImage: () => Promise<string>;
  onSent: (r: SendRecord[]) => void; onClose: () => void;
}) {
  const v = useNotify((s) => s.v), loaded = useNotify((s) => s.loaded);
  const c = contactOf(v, student.id);
  const can = { wecom: !!c.wecom, email: !!c.email.length && smtpReady(v) };
  const [pick, setPick] = useState<{ wecom: boolean; email: boolean }>({ wecom: can.wecom, email: can.email });
  const [img, setImg] = useState(image), [withImg, setWithImg] = useState(true);
  const [busy, setBusy] = useState(''), [err, setErr] = useState(''), [res, setRes] = useState<SendRecord[] | null>(null), [setup, setSetup] = useState(false), [copied, setCopied] = useState('');
  useEffect(() => { setPick({ wecom: can.wecom, email: can.email }); }, [can.wecom, can.email]);
  useEffect(() => {
    if (img) return;
    setBusy('img');
    makeImage().then(setImg, (e) => setErr('长图导出失败：' + (e as Error).message + '。可以只发文字。')).finally(() => setBusy(''));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const msg = parentMessage(note, student.name, withImg && !!img);
  const send = async (channels: ('wecom' | 'email')[]) => {
    setBusy('send'); setErr('');
    try {
      const r = await host.call<SendRecord[]>('notify.send', { studentId: student.id, channels, subject: msg.subject, text: msg.text, markdown: msg.markdown, image: withImg ? img : '' });
      setRes((old) => [...(old ?? []).filter((x) => !channels.includes(x.channel)), ...r]); onSent(r);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const chosen = (['wecom', 'email'] as const).filter((k) => pick[k] && can[k]);
  const failed = res?.filter((r) => !r.ok).map((r) => r.channel) ?? [];
  const copy = async (k: string, fn: () => Promise<unknown>) => { setErr(''); try { await fn(); setCopied(k); setTimeout(() => setCopied(''), 1600); } catch (e) { setErr((e as Error).message); } };
  const imgUrl = (() => { try { return img ? host.fileUrl(img) : ''; } catch { return ''; } })();
  if (setup) return <ContactsSheet student={student} onClose={() => setSetup(false)} />;
  return <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
    <div className="record-editor sd-editor ps-sheet ps-send">
      <div className="card-h"><b>发送给 {student.name} 的家长</b><span className="flex" /><button type="button" className="sd-btn" onClick={() => setSetup(true)}><Settings2 size={13} />联系方式</button><button type="button" onClick={onClose} disabled={busy === 'send'} aria-label="关闭"><X size={16} /></button></div>
      <div className="ps-body">
        <div className="ps-preview">
          <span className="ps-label">家长会收到</span>
          <div className="ps-msg"><b>{msg.subject}</b>{msg.text.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}</div>
          <label className="record-check"><input type="checkbox" checked={withImg} disabled={!img} onChange={(e) => setWithImg(e.target.checked)} />附上课后反馈长图</label>
          {busy === 'img' ? <div className="ps-img empty"><Loader2 size={16} className="ags-spin" />正在生成长图…</div> : imgUrl && withImg ? <img className="ps-img" src={imgUrl} alt="课后反馈长图" /> : null}
          <p className="sd-note">要改内容，关掉这个窗口，在「给家长的话」里改完再发。</p>
        </div>
        <div className="ps-side">
          <span className="ps-label">发送方式</span>
          {!loaded ? <Loader2 size={14} className="ags-spin" /> : <>
            <label className={'ps-ch' + (can.wecom ? '' : ' off')}><input type="checkbox" checked={pick.wecom && can.wecom} disabled={!can.wecom || busy === 'send'} onChange={(e) => setPick({ ...pick, wecom: e.target.checked })} /><MessageSquareText size={14} /><span><b>企业微信群</b><i>{can.wecom ? `${c.wecomName || '已设置'} …${c.wecom}` : '还没有设置'}</i></span></label>
            <label className={'ps-ch' + (can.email ? '' : ' off')}><input type="checkbox" checked={pick.email && can.email} disabled={!can.email || busy === 'send'} onChange={(e) => setPick({ ...pick, email: e.target.checked })} /><Mail size={14} /><span><b>邮件</b><i>{!c.email.length ? '还没有填家长邮箱' : !smtpReady(v) ? '还没有设置你的发件邮箱' : c.email.join('、')}</i></span></label>
            {(!can.wecom || !can.email) && <button type="button" className="sd-btn" onClick={() => setSetup(true)}><Settings2 size={13} />设置联系方式</button>}
          </>}
          <span className="ps-label">家长只用个人微信</span>
          <div className="ps-manual">
            <button type="button" className="sd-btn" disabled={!img} onClick={() => void copy('img', () => host.call('notify.copyImage', img))}><ClipboardCopy size={13} />{copied === 'img' ? '长图已复制' : '复制长图'}</button>
            <button type="button" className="sd-btn" onClick={() => void copy('text', () => navigator.clipboard.writeText(msg.text))}><Copy size={13} />{copied === 'text' ? '文字已复制' : '复制文字'}</button>
            <i>复制后打开微信，在和家长的聊天框里按 Ctrl+V 粘贴发送。</i>
          </div>
        </div>
      </div>
      {res && <div className="ps-res">{res.map((r) => <div key={r.channel} className={r.ok ? 'ok' : 'bad'}>{r.ok ? <Check size={13} /> : <X size={13} />}<b>{CH_NAME[r.channel]}</b><span>{r.ok ? '已发送给 ' + r.to : r.error}</span></div>)}</div>}
      {err && <p className="sd-err">{err}</p>}
      <div className="record-actions">
        <button type="button" onClick={onClose} disabled={busy === 'send'}>{res?.some((r) => r.ok) ? '完成' : '取消'}</button>
        {failed.length > 0 && <button type="button" className="btn-cue" disabled={!!busy} onClick={() => void send(failed)}>{busy === 'send' ? '发送中…' : '重发失败的'}</button>}
        {!res && <button type="button" className="btn-cue ps-go" disabled={!chosen.length || !!busy} onClick={() => void send([...chosen])}>{busy === 'send' ? <Loader2 size={14} className="ags-spin" /> : <Send size={14} />}确认发送{chosen.length ? `（${chosen.map((k) => CH_NAME[k]).join(' + ')}）` : ''}</button>}
      </div>
    </div>
  </div>;
}
