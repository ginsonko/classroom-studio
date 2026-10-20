// 课堂动画的结果区：封面（联系表）→ 点一下载入引擎实时播放（带配乐）、拖进度、全屏 → 导出 MP4 → 我先看 / 上屏 / 另存为。
// 同一时间只保留一个载入的片子（每个都占一个 WebGL 上下文），点开另一个时前一个自动收起。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Download, FolderOpen, Loader2, Maximize2, Pause, Play, Square, Volume2, VolumeX } from 'lucide-react';
import type { FilmSpec } from '../motion/core';
import type { Film } from '../motion/stage';
import type { Material } from '../lib/types';
import { host } from '../lib/host';
import { fileEntry, prepareMaterial } from '../lib/library';

let active: { id: symbol; close: () => void } | null = null;
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const sizeOf = (n: number) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

export function MotionView({ spec, sheet, send }: { spec: FilmSpec; sheet?: string; send: (m: Material) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null), film = useRef<Film | null>(null), me = useRef(Symbol('motion'));
  const stopPlay = useRef<(() => void) | null>(null), audio = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode | null; buf: AudioBuffer | null } | null>(null);
  const [phase, setPhase] = useState<'poster' | 'loading' | 'ready'>('poster');
  const [playing, setPlaying] = useState(false), [t, setT] = useState(0), [dur, setDur] = useState(spec.shots.reduce((a, s) => a + s.dur, 0));
  const [mute, setMute] = useState(() => localStorage.getItem('cs.motion.mute') === '1');
  const [exp, setExp] = useState<{ k: number; sig: { cancelled: boolean } } | null>(null), [video, setVideo] = useState<{ path: string; bytes: number } | null>(null);
  const [mat, setMat] = useState<Material | null>(null), [err, setErr] = useState(''), [json, setJson] = useState(false), [saved, setSaved] = useState('');
  const starts = spec.shots.reduce<number[]>((a, s, i) => (a.push(i ? a[i - 1] + spec.shots[i - 1].dur : 0), a), []);

  const run = useRef(0);
  const silence = () => { try { audio.current?.src?.stop(); } catch { /* 已停 */ } if (audio.current) audio.current.src = null; };
  const pause = () => { run.current++; stopPlay.current?.(); stopPlay.current = null; silence(); setPlaying(false); };
  const close = () => {
    pause(); film.current?.dispose(); film.current?.canvas.remove(); film.current = null;
    void audio.current?.ctx.close().catch(() => {}); audio.current = null;
    setPhase('poster');
    if (active?.id === me.current) active = null;
  };
  useEffect(() => () => close(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (): Promise<Film> => {
    if (film.current) return film.current;
    if (active && active.id !== me.current) active.close();
    active = { id: me.current, close };
    setPhase('loading'); setErr('');
    const { Film } = await import('../motion/stage');
    const f = new Film(spec);
    await f.load();
    f.canvas.className = 'mv-canvas';
    box.current?.append(f.canvas);
    f.render(0);
    film.current = f; setDur(f.duration); setPhase('ready');
    return f;
  };
  // 画面先走，配乐合成好后按已经过去的时间接上（第一次合成整部配乐要几秒，不能让画面干等）
  const music = async (from: number, since: number, id: number) => {
    if (mute || spec.music === false) return;
    if (!audio.current) audio.current = { ctx: new AudioContext(), src: null, buf: null };
    const a = audio.current;
    if (!a.buf) { const { makeScore } = await import('../motion/score'); a.buf = await makeScore(spec); }
    if (a.ctx.state === 'suspended') await a.ctx.resume();
    if (id !== run.current || audio.current !== a) return;
    const at = from + (performance.now() - since) / 1000;
    if (at >= a.buf.duration - 0.05) return;
    silence();
    const src = a.ctx.createBufferSource(); src.buffer = a.buf; src.connect(a.ctx.destination);
    src.start(0, at); a.src = src;
  };
  const play = async (from = t >= dur - 0.05 ? 0 : t) => {
    try {
      const f = await load();
      pause();
      const id = run.current;
      setPlaying(true);
      stopPlay.current = f.play(from, (now) => { setT(now); if (now >= f.duration) { setPlaying(false); stopPlay.current = null; silence(); } });
      void music(from, performance.now(), id).catch((e) => console.warn('课堂动画配乐没能播放', e));
    } catch (e) { setErr('播放失败：' + (e as Error).message); setPhase(film.current ? 'ready' : 'poster'); }
  };
  const seek = (v: number) => { const f = film.current; if (!f) return; const was = playing; pause(); f.render(v); setT(v); if (was) void play(v); };
  const toggleMute = () => { const m = !mute; setMute(m); localStorage.setItem('cs.motion.mute', m ? '1' : '0'); if (m) silence(); else if (playing) void music(t, performance.now(), run.current).catch(() => {}); };

  const doExport = async () => {
    const sig = { cancelled: false };
    setErr(''); setSaved(''); setExp({ k: 0, sig });
    try {
      const f = await load();
      pause();
      const { exportMp4 } = await import('../motion/exportMp4');
      const r = await exportMp4(f, { bitrate: 10e6, signal: sig, onProgress: (k, frame) => { setExp({ k, sig }); setT(frame / f.fps); } });
      const title = spec.title || '课堂动画';
      if (host.electron) {
        const path = await host.call<string>('motion.save', { data: r.bytes, title });
        setVideo({ path, bytes: r.bytes.length });
        const m = await prepareMaterial(fileEntry(path));
        setMat({ ...m, title: '课堂动画 · ' + title });
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'video/mp4' })); a.download = title + '.mp4'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      }
      f.render(0); setT(0);
    } catch (e) { if (!sig.cancelled) setErr('导出失败：' + (e as Error).message); }
    finally { setExp(null); }
  };
  const saveAs = async () => {
    if (!video) return;
    try { const p = await host.call<string | null>('motion.saveAs', { path: video.path, title: spec.title }); if (p) setSaved(p); }
    catch (e) { setErr((e as Error).message); }
  };

  const shotIdx = starts.reduce((a, s, i) => (t >= s ? i : a), 0);
  return <div className="mv">
    <div className={'mv-stage' + (phase !== 'ready' ? ' poster' : '')} ref={box} onDoubleClick={() => void box.current?.requestFullscreen?.()}>
      {phase !== 'ready' && <>
        {sheet ? <img src={sheet} alt="动画截帧" /> : <div className="mv-blank">{spec.title}</div>}
        <button className="mv-big" disabled={phase === 'loading'} onClick={() => void play(0)} aria-label="播放">{phase === 'loading' ? <Loader2 size={22} className="spin" /> : <Play size={22} />}</button>
        {phase === 'loading' && <span className="mv-loading">正在载入动画引擎…</span>}
      </>}
      {phase === 'ready' && !playing && !exp && <button className="mv-big ghost" onClick={() => void play()} aria-label="播放"><Play size={22} /></button>}
    </div>
    <div className="mv-bar">
      <button onClick={() => (playing ? pause() : void play())} disabled={!!exp || phase === 'loading'} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
      <input type="range" min={0} max={dur} step={0.01} value={Math.min(t, dur)} disabled={phase !== 'ready' || !!exp} onChange={(e) => seek(+e.target.value)} aria-label="进度" />
      <span className="mv-time num">{fmt(t)} / {fmt(dur)}</span>
      {spec.music !== false && <button onClick={toggleMute} data-tip={mute ? '预览时打开配乐' : '预览时静音（导出的视频仍带配乐）'} aria-label="配乐">{mute ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>}
      <button onClick={() => void (async () => { await load(); box.current?.requestFullscreen?.(); })()} disabled={!!exp} data-tip="全屏播放（双击画面也可以）" aria-label="全屏"><Maximize2 size={13} /></button>
    </div>
    <div className="mv-shots">{spec.shots.map((s, i) => <button key={i} className={phase === 'ready' && i === shotIdx ? 'on' : ''} disabled={!!exp} onClick={() => void (async () => { await load(); seek(starts[i] + 0.01); })()} data-tip={`${s.dur} 秒`}>{i + 1}. {s.name}</button>)}</div>
    {exp ? <div className="mv-exp">
      <div className="ai-manim-row"><Loader2 size={12} className="spin" /><span>正在导出 MP4（1080p，{spec.music !== false ? '带配乐' : '无配乐'}）… {Math.round(exp.k * 100)}%</span><span className="flex" /><button onClick={() => { exp.sig.cancelled = true; }}><Square size={11} />取消</button></div>
      <div className="ai-manim-bar"><i style={{ width: Math.max(2, exp.k * 100) + '%' }} /></div>
    </div> : video && mat ? <div className="ai-sub"><span>已导出 {sizeOf(video.bytes)}，学生窗口按视频播放：</span>{send(mat)}</div> : null}
    <div className="ai-manim-row">
      <button className="mv-go" disabled={!!exp} onClick={() => void doExport()} data-tip="按 1080p、每秒 30 帧导出成 MP4。导出后可以「我先看」「上屏」给学生播放，也可以另存一份">{video ? <><Download size={12} />重新导出</> : <><Download size={12} />{host.electron ? '导出 MP4 · 上屏' : '导出 MP4'}</>}</button>
      {video && <button onClick={() => void saveAs()} data-tip="另存一份到你选的文件夹"><Download size={12} />另存为…</button>}
      {video && <button onClick={() => host.revealInFolder(saved || video.path)}><FolderOpen size={12} />打开文件夹</button>}
      <span className="flex" />
      <button className="ai-manim-log" onClick={() => setJson(!json)}><ChevronDown size={12} />{json ? '收起分镜' : '查看分镜'}</button>
    </div>
    {saved && <div className="ai-foot-note">已另存到 {saved}</div>}
    {err && <div className="ai-warn"><div>{err}</div></div>}
    {json && <pre className="ai-manim-code mv-json">{JSON.stringify(spec, null, 1)}</pre>}
  </div>;
}
