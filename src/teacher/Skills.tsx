// 技能包界面：上课页学生卡下的一排按钮、运行进度窗口、学情里的技能包管理（新建、编辑、导入导出）。
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, CircleSlash, Copy, Download, Loader2, Pause, Pencil, Play, Plus, RotateCcw, Sparkles, Trash2, Upload, X, Zap } from 'lucide-react';
import { useStore } from '../lib/store';
import { host } from '../lib/host';
import { useStudy } from '../lib/studyStore';
import { lessonDocument } from '../lib/studyActions';
import type { SendRecord } from '../lib/studyLogic';
import { allSkills, answerRun, cleanSkill, closeRun, loadSkills, runSkill, saveSkills, skillJson, STEPS, useRun, useSkills, type Skill, type SkillStep, type StepId } from '../lib/skills';
import { SendSheet, useNotify } from './ParentSend';

const yuan = (v: number) => (v >= 0.01 ? '¥' + v.toFixed(2) : v > 0 ? '<¥0.01' : '');
const aiTag = (use: StepId) => STEPS[use].ai === true ? '会调用 AI' : STEPS[use].ai === 'maybe' ? '配置了 AI 时调用 AI' : '';

/** 上课页学生卡里的一排技能按钮 */
export function SkillBar() {
  const mine = useSkills((s) => s.list), run = useRun((s) => s.run);
  useEffect(() => { void loadSkills(); }, []);
  const [err, setErr] = useState('');
  const busy = !!run && !['done', 'stopped'].includes(run.phase);
  const go = (s: Skill) => { setErr(''); void runSkill(s).catch((e) => setErr((e as Error).message)); };
  return <div className="sk-bar">
    <div className="scard-ans-h"><span>技能包</span><i>一键串起常用操作</i></div>
    <div className="sk-btns">{allSkills(mine).map((s) => <button key={s.id} disabled={busy || !host.electron} onClick={() => go(s)} data-tip={s.desc || s.steps.map((x) => STEPS[x.use].name).join(' → ')}><Zap size={12} />{s.name}</button>)}</div>
    {err && <div className="scard-ans-m">{err}</div>}
  </div>;
}

/** 运行进度：每一步的状态、确认 / 跳过 / 重试 / 停止，以及「发给家长」的预览 */
export function SkillRunner() {
  const run = useRun((s) => s.run);
  const student = useStore((s) => s.students.find((x) => x.id === run?.ctx.studentId));
  const sent = useRef(false);
  useEffect(() => { if (run?.phase === 'parent') { sent.current = false; void useNotify.getState().refresh(); } }, [run?.phase]);
  if (!run) return null;
  const { skill, states, notes, cost, phase, ctx } = run;
  const total = cost.reduce((a, b) => a + b, 0);
  const cur = states.findIndex((x) => x === 'ask' || x === 'run' || (x === 'fail' && phase === 'error'));
  const finished = phase === 'done' || phase === 'stopped';
  if (phase === 'parent' && ctx.lesson && student) return <SendSheet note={ctx.lesson} student={student} image={ctx.image ?? ''}
    makeImage={async () => { const r = await lessonDocument(ctx.lesson!, student.name, ['png']); const p = r.out.find((f) => f.endsWith('.png')); if (!p) throw Error(r.errors[0] || '没有生成长图'); return p; }}
    onSent={(r: SendRecord[]) => { if (r.some((x) => x.ok)) sent.current = true; useStudy.getState().update((d) => ({ ...d, lessons: d.lessons.map((l) => (l.id === ctx.lesson!.id ? { ...l, sends: [...(l.sends ?? []), ...r].slice(-30) } : l)) })); }}
    onClose={() => answerRun(sent.current ? 'go' : 'skip')} />;
  return <div className="sheet-bg sk-run-bg">
    <div className="record-editor sd-editor sk-runner" role="dialog" aria-label={'技能包：' + skill.name}>
      <div className="card-h"><b><Zap size={14} /> {skill.name}</b><span className="sk-who">{ctx.name}</span><span className="flex" />{total > 0 && <span className="sk-cost">AI 花费 {yuan(total)}</span>}<button type="button" onClick={closeRun} aria-label="关闭"><X size={16} /></button></div>
      <ol className="sk-steps">{skill.steps.map((s, i) => {
        const st = states[i], def = STEPS[s.use];
        return <li key={i} className={'sk-' + st}>
          <span className="sk-ic">{st === 'run' ? <Loader2 size={14} className="ags-spin" /> : st === 'done' ? <Check size={14} /> : st === 'fail' ? <X size={14} /> : st === 'skip' ? <CircleSlash size={13} /> : st === 'ask' ? <Pause size={13} /> : <span>{i + 1}</span>}</span>
          <div><b>{def.name}{s.use === 'variants' && s.args?.n ? ` ${s.args.n} 道` : ''}</b>{cost[i] > 0 && <em>{yuan(cost[i])}</em>}
            <p>{notes[i] || (st === 'wait' ? def.desc : '')}</p>
            {st === 'ask' && <p className="sk-q">{s.use === 'parent' ? '下一步打开发送预览，你确认后才会发出去。' : `下一步：${def.desc}。${aiTag(s.use) ? aiTag(s.use) + '，费用记进 AI 账本。' : ''}`}</p>}
          </div>
        </li>;
      })}</ol>
      {ctx.files.length > 0 && <div className="sk-files">{[...new Set(ctx.files)].map((f) => <button key={f} className="sd-file" onClick={() => void host.call('study.open', f).catch(() => {})}>{f.split('/').pop()}</button>)}</div>}
      <div className="record-actions">
        {phase === 'ask' && <><button type="button" onClick={() => answerRun('stop')}>停止</button><button type="button" onClick={() => answerRun('skip')}>跳过这步</button><button type="button" className="btn-cue sk-go" onClick={() => answerRun('go')}><Play size={13} />{STEPS[skill.steps[cur]?.use]?.name ? '继续：' + STEPS[skill.steps[cur].use].name : '继续'}</button></>}
        {phase === 'error' && <><button type="button" onClick={() => answerRun('stop')}>停止</button><button type="button" onClick={() => answerRun('skip')}>跳过这步</button><button type="button" className="btn-cue" onClick={() => answerRun('retry')}><RotateCcw size={13} />重试</button></>}
        {phase === 'parent' && <><span className="sd-note">找不到这位学生的资料，不能打开发送预览。</span><button type="button" onClick={() => answerRun('skip')}>跳过这步</button></>}
        {phase === 'running' && <span className="sd-note">运行中…可以随时关掉这个窗口停止。</span>}
        {finished && <><span className="sd-note">{phase === 'stopped' ? '已停止。' : '全部完成。'}{total > 0 ? `本次 AI 约 ${yuan(total)}，已记进 AI 账本。` : ''}</span><button type="button" className="btn-cue" onClick={closeRun}>完成</button></>}
      </div>
    </div>
  </div>;
}

/** 学情 → 技能包：查看、运行、复制、编辑、导入导出 */
export function SkillsTab() {
  const mine = useSkills((s) => s.list), loaded = useSkills((s) => s.loaded), run = useRun((s) => s.run);
  const student = useStore((s) => s.students.find((x) => x.id === s.studentId));
  const [edit, setEdit] = useState<Skill | null>(null), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [del, setDel] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void loadSkills(); }, []);
  const busy = !!run && !['done', 'stopped'].includes(run.phase);
  const say = (m: string) => { setMsg(m); setErr(''); };
  const fail = (m: string) => { setErr(m); setMsg(''); };
  const put = async (s: Skill) => { const list = mine.some((x) => x.id === s.id) ? mine.map((x) => (x.id === s.id ? s : x)) : [...mine, s]; await saveSkills(list); };
  const exportIt = async (s: Skill) => { try { const p = await host.call<string>('study.exportSkill', { name: s.name, json: skillJson(s) }); say('已导出到 ' + p); } catch (e) { fail((e as Error).message); } };
  const importIt = async (f: File) => {
    try {
      const raw = JSON.parse(await f.text());
      const list = (Array.isArray(raw) ? raw : [raw]).map((x) => cleanSkill(x));
      await saveSkills([...mine, ...list]); say(`导入了 ${list.map((x) => `「${x.name}」`).join('、')}`);
    } catch (e) { fail('导入失败：' + (e instanceof SyntaxError ? '不是有效的 JSON 文件' : (e as Error).message)); }
  };
  if (!loaded) return <div className="sd-pane"><div className="ags-loading"><Loader2 className="ags-spin" /></div></div>;
  return <div className="sd-pane">
    <div className="sd-bar">
      <h3>技能包</h3><span className="sd-note">把常用的几步串成一个按钮，上课页学生卡下面可以一键运行。会调用 AI 的步骤默认先停下来问你；发给家长永远要你在预览里确认。</span>
      <span className="flex" />
      <button className="sd-btn" onClick={() => setEdit({ id: 'u-' + crypto.randomUUID().slice(0, 8), name: '我的技能包', desc: '', steps: [{ use: 'capture' }, { use: 'read' }] })}><Plus size={13} />新建</button>
      <button className="sd-btn" onClick={() => file.current?.click()}><Upload size={13} />导入</button>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importIt(f); }} />
    </div>
    {msg && <p className="sd-msg">{msg}</p>}{err && <p className="sd-err">{err}</p>}
    <div className="sk-list">{allSkills(mine).map((s) => <article key={s.id} className="sk-card">
      <header><b>{s.name}</b>{s.builtin && <span className="sd-tag">内置</span>}</header>
      {s.desc && <p>{s.desc}</p>}
      <ol>{s.steps.map((x, i) => <li key={i}>{STEPS[x.use].name}{x.use === 'variants' && x.args?.n ? ` ${x.args.n} 道` : ''}{(x.confirm || x.use === 'parent') && <i>先确认</i>}{STEPS[x.use].ai === true && <em>AI</em>}</li>)}</ol>
      <footer>
        <button className="ags-go" disabled={busy || !student} onClick={() => void runSkill(s).catch((e) => fail((e as Error).message))} data-tip={student ? '给 ' + student.name + ' 运行' : '先在顶栏选择学生'}><Play size={13} />运行</button>
        {s.builtin ? <button className="sd-btn" onClick={() => setEdit({ ...s, id: 'u-' + crypto.randomUUID().slice(0, 8), name: s.name + '（我的）', builtin: false, steps: s.steps.map((x) => ({ ...x })) })}><Copy size={13} />复制后修改</button>
          : <><button className="sd-btn" onClick={() => setEdit({ ...s, steps: s.steps.map((x) => ({ ...x })) })}><Pencil size={13} />编辑</button>
            <button className={'sd-btn' + (del === s.id ? ' sd-danger' : '')} onClick={() => { if (del !== s.id) { setDel(s.id); return; } setDel(''); void saveSkills(mine.filter((x) => x.id !== s.id)).then(() => say(`已删除「${s.name}」`), (e) => fail((e as Error).message)); }} onBlur={() => setDel('')}><Trash2 size={13} />{del === s.id ? '再点一次删除' : '删除'}</button></>}
        <button className="sd-btn" onClick={() => void exportIt(s)}><Download size={13} />导出</button>
      </footer>
    </article>)}</div>
    {edit && <SkillEditor skill={edit} onClose={() => setEdit(null)} onSave={async (s) => { await put(s); setEdit(null); say(`已保存「${s.name}」`); }} />}
  </div>;
}

function SkillEditor({ skill, onClose, onSave }: { skill: Skill; onClose: () => void; onSave: (s: Skill) => Promise<void> }) {
  const [s, setS] = useState(skill), [err, setErr] = useState('');
  const steps = s.steps, setSteps = (v: SkillStep[]) => setS({ ...s, steps: v });
  const move = (i: number, d: number) => { const v = [...steps], j = i + d; if (j < 0 || j >= v.length) return; [v[i], v[j]] = [v[j], v[i]]; setSteps(v); };
  const save = async () => { try { await onSave(cleanSkill(s, s.id)); } catch (e) { setErr((e as Error).message); } };
  return <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
    <form className="record-editor sd-editor sk-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="card-h"><b><Sparkles size={14} /> 编辑技能包</b><span className="flex" /><button type="button" onClick={onClose} aria-label="关闭"><X size={16} /></button></div>
      <label>名字<input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} maxLength={40} /></label>
      <label>说明<input value={s.desc ?? ''} onChange={(e) => setS({ ...s, desc: e.target.value })} maxLength={120} placeholder="可选" /></label>
      <h4>步骤（按顺序运行）</h4>
      <ol className="sk-edit-steps">{steps.map((x, i) => {
        const def = STEPS[x.use];
        return <li key={i}>
          <span className="n">{i + 1}</span>
          <div>
            <select value={x.use} onChange={(e) => { const u = e.target.value as StepId; steps[i] = { use: u, confirm: STEPS[u].confirm }; setSteps([...steps]); }}>
              {(Object.keys(STEPS) as StepId[]).map((k) => <option key={k} value={k}>{STEPS[k].name}</option>)}
            </select>
            <p>{def.desc}{def.ai === true ? '（会调用 AI）' : ''}</p>
            <div className="sk-args">
              <label className="record-check"><input type="checkbox" checked={x.use === 'parent' || !!x.confirm} disabled={x.use === 'parent'} onChange={(e) => { steps[i] = { ...x, confirm: e.target.checked }; setSteps([...steps]); }} />运行前先问我</label>
              {def.args?.map((a) => a.kind === 'bool'
                ? <label key={a.key} className="record-check"><input type="checkbox" checked={(x.args?.[a.key] ?? a.def) !== false} onChange={(e) => { steps[i] = { ...x, args: { ...x.args, [a.key]: e.target.checked } }; setSteps([...steps]); }} />{a.label}</label>
                : <label key={a.key}>{a.label}<input type="number" min={a.min} max={a.max} value={Number(x.args?.[a.key] ?? a.def)} onChange={(e) => { steps[i] = { ...x, args: { ...x.args, [a.key]: Number(e.target.value) } }; setSteps([...steps]); }} /></label>)}
            </div>
          </div>
          <span className="sk-tools">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移"><ArrowUp size={13} /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="下移"><ArrowDown size={13} /></button>
            <button type="button" onClick={() => setSteps(steps.filter((_, k) => k !== i))} aria-label="删除这一步"><Trash2 size={13} /></button>
          </span>
        </li>;
      })}</ol>
      {steps.length < 12 && <button type="button" className="sd-btn" onClick={() => setSteps([...steps, { use: 'homework', confirm: false }])}><Plus size={13} />加一步</button>}
      <p className="sk-hint">步骤会把结果交给下一步：收题 → 识题 → 入库 → 出变式题 → 组作业；写课后总结 → 导出长图 → 发给家长。顺序不对时，运行到那一步会提示并让你跳过。</p>
      {err && <p className="sd-err">{err}</p>}
      <div className="record-actions"><button type="button" onClick={onClose}>取消</button><button className="btn-cue" type="submit">保存</button></div>
    </form>
  </div>;
}
