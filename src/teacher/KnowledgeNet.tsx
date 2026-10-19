// 知识网络：按掌握情况给知识点着色；选中一个知识点，画出它的前置链，并往前追溯掌握不好的前置。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ClipboardList, GitBranch } from 'lucide-react';
import { useStore } from '../lib/store';
import { pointKey } from '../lib/subjects';
import { useLearning, usePack, useSubject } from '../lib/subjectState';
import { pct, pointLabel } from '../lib/studyLogic';
import { useStudy } from '../lib/studyStore';
import { EDGES, LEVEL_NAME, NEXT, PREREQ, ancestors, nodeInfo, traceBack, type Level } from '../lib/knowledgeNet';

const short = (k: string) => pointLabel(k).split(' · ').pop() ?? k;

export function NetTab({ onHomework }: { onHomework: (points: string[], prereq: boolean) => void }) {
  const data = useStudy((s) => s.data);
  const studentId = useStore((s) => s.studentId), student = useStore((s) => s.students.find((x) => x.id === s.studentId));
  const subject = useSubject(), pack = usePack();
  const chapters = pack.chapters, books = pack.books;
  const map = useLearning(studentId);
  const info = useMemo(() => nodeInfo(studentId, data, map, subject), [studentId, data, map, subject]);
  const weakest = useMemo(() => [...info].filter(([, v]) => v.level === 'weak').sort((a, b) => (a[1].score ?? 0) - (b[1].score ?? 0)).map(([k]) => k), [info]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { setSel(null); }, [studentId, subject]);
  const cur = sel && info.has(sel) ? sel : weakest[0] ?? null;
  const anc = useMemo(() => (cur ? ancestors(cur) : new Map<string, number>()), [cur]);
  const next = cur ? NEXT.get(cur) ?? [] : [];
  const roots = useMemo(() => (cur ? traceBack([cur], info) : []), [cur, info]);
  const counts = useMemo(() => { const c: Record<Level, number> = { weak: 0, shaky: 0, ok: 0, unknown: 0 }; for (const v of info.values()) c[v.level]++; return c; }, [info]);

  // 选中知识点的前置链连线：等节点排好版后量位置
  const canvas = useRef<HTMLDivElement>(null), nodes = useRef(new Map<string, HTMLButtonElement>());
  const [lines, setLines] = useState<{ d: string; cls: string }[]>([]), [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const box = canvas.current;
    if (!box) return;
    const draw = () => {
      const r0 = box.getBoundingClientRect();
      setSize({ w: box.scrollWidth, h: box.scrollHeight });
      if (!cur) { setLines([]); return; }
      const chain = new Set([cur, ...anc.keys()]);
      const at = (k: string) => { const r = nodes.current.get(k)?.getBoundingClientRect(); return r ? { x: r.left - r0.left + r.width / 2, y: r.top - r0.top + r.height / 2 } : null; };
      const out: { d: string; cls: string }[] = [];
      const edge = (f: string, t: string, cls: string) => {
        const a = at(f), b = at(t);
        if (!a || !b) return;
        const bend = Math.min(80, Math.abs(b.y - a.y) * 0.25 + 18) * (a.x <= b.x ? -1 : 1);
        out.push({ d: `M${a.x},${a.y} Q${(a.x + b.x) / 2 + bend},${(a.y + b.y) / 2} ${b.x},${b.y}`, cls });
      };
      for (const [f, t] of EDGES) if (chain.has(f) && chain.has(t)) edge(f, t, 'kn-e ' + (info.get(f)?.level ?? 'unknown'));
      for (const t of NEXT.get(cur) ?? []) edge(cur, t, 'kn-e next');
      setLines(out);
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(box);
    return () => ro.disconnect();
  }, [cur, anc, info]);

  if (!student) return <div className="sd-pane"><div className="lib-empty">先在顶栏选择一位学生。</div></div>;
  const cls = (k: string) => {
    const lv = info.get(k)!.level;
    const role = !cur ? '' : k === cur ? ' sel' : anc.has(k) ? ' anc' : next.includes(k) ? ' nxt' : ' dim';
    return 'kn-node ' + lv + role;
  };
  return <div className="sd-pane sd-two kn">
    <section className="kn-map">
      <div className="kn-legend">{(['weak', 'shaky', 'ok', 'unknown'] as Level[]).map((l) => <span key={l}><i className={'kn-dot ' + l} />{LEVEL_NAME[l]} <b className="num">{counts[l]}</b></span>)}<span className="sd-note">颜色来自课堂作答和学习地图。点一个知识点，看它的前置链。</span></div>
      <div className="kn-canvas" ref={canvas}>
        <svg className="kn-svg" width={size.w} height={size.h} aria-hidden="true">
          <defs><marker id="kn-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" /></marker></defs>
          {lines.map((l, i) => <path key={i} d={l.d} className={l.cls} markerEnd="url(#kn-arrow)" />)}
        </svg>
        {books.map((book) => <div key={book} className="kn-book"><span className="kn-bk">{book}</span>
          {chapters.map((c, ci) => c.book === book && <div key={ci} className="kn-ch"><span className="kn-cn" title={c.ch}>{c.ch}</span><div className="kn-secs">{c.sec.map((sec, si) => {
            const k = pointKey(pack, ci, si), v = info.get(k)!;
            return <button key={k} ref={(el) => { if (el) nodes.current.set(k, el); else nodes.current.delete(k); }} className={cls(k)} onClick={() => setSel(k === cur ? null : k)} data-tip={`${sec} · ${LEVEL_NAME[v.level]}${v.n ? `　作答 ${v.n} 次，掌握 ${pct(v.score)}` : ''}`}>{sec}</button>;
          })}</div></div>)}
        </div>)}
      </div>
    </section>
    <aside className="sd-preview kn-side">
      {!cur ? <div className="lib-empty">点左边任意一个知识点，查看它需要哪些前置知识、往后会用到哪里。<br />有了作答记录后，薄弱的知识点会标红，这里会自动往前追溯原因。</div> : <>
        <div className="kn-head"><GitBranch size={16} /><div><b>{pointLabel(cur)}</b><i>{LEVEL_NAME[info.get(cur)!.level]}{info.get(cur)!.n ? ` · 作答 ${info.get(cur)!.n} 次，掌握 ${pct(info.get(cur)!.score)}` : ''}</i></div></div>
        <h4>往前追溯：掌握不好的前置</h4>
        {roots.length ? <ol className="kn-roots">{roots.map((r) => <li key={r.key}><button onClick={() => setSel(r.key)}><i className={'kn-dot ' + r.level} /><b>{short(r.key)}</b><span>{LEVEL_NAME[r.level]}{info.get(r.key)?.n ? ' ' + pct(info.get(r.key)?.score) : ''} · {r.dist === 1 ? '直接前置' : `隔 ${r.dist - 1} 层`}</span></button></li>)}</ol>
          : <p className="sd-note">{anc.size ? '前置知识点都掌握了，或还没有记录。问题可能就在这个知识点本身。' : '这是起点知识点，没有前置。'}</p>}
        <div className="ags-row"><button className="ags-go" onClick={() => onHomework([cur], roots.length > 0)}><ClipboardList size={14} />{roots.length ? '组作业：先补前置再练这个' : '组作业：练这个知识点'}</button></div>
        <h4>直接前置</h4>
        <div className="kn-chips">{(PREREQ.get(cur) ?? []).map((k) => <button key={k} className={'kn-chip ' + info.get(k)!.level} onClick={() => setSel(k)}>{short(k)}</button>)}{!(PREREQ.get(cur) ?? []).length && <span className="sd-note">无</span>}</div>
        <h4>学好它之后接着学 <ArrowRight size={12} /></h4>
        <div className="kn-chips">{next.map((k) => <button key={k} className={'kn-chip ' + info.get(k)!.level} onClick={() => setSel(k)}>{short(k)}</button>)}{!next.length && <span className="sd-note">无</span>}</div>
        <p className="sd-note">全部前置（含间接）{anc.size} 个。知识网络按{pack.textbook}整理，只用于提示，不影响题库和作答记录。</p>
      </>}
    </aside>
  </div>;
}
