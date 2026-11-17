// AI 工坊「新任务」页示例小卡片 + 老师预监完整示例预览抽屉 + 小羽联动状态
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, FileCheck2, Loader2, Minus, MonitorPlay, Plus, Puzzle, Sparkles, X } from 'lucide-react';
import { create } from 'zustand';
import { host } from '../lib/host';
import { fileEntry, prepareMaterial } from '../lib/library';
import { defaultView, stepView, useStore } from '../lib/store';
import { Stage } from '../stage/Stage';
import { PluginFrame } from '../plugins/PluginFrame';
import { usePlugins, type Manifest, type Staged } from '../plugins/pluginStore';
import { useGuide } from '../guide/guide';
import { toast } from '../lib/toast';

export interface ShowcasePreviewMedia {
  type: 'video' | 'slides';
  src?: string;
  poster?: string;
  images?: string[];
  srcUrl?: string;
  posterUrl?: string;
  imageUrls?: string[];
}

export interface ShowcaseFullEntry {
  label: string;
  file: string;
  kind: 'html' | 'pdf' | 'pptx' | 'docx' | 'png' | 'plugin';
}

export interface ShowcaseItem {
  id: string;
  skill: string;
  label: string;
  one: string;
  highlights: string[];
  when: string[];
  formats: string;
  cost: string;
  preview: ShowcasePreviewMedia;
  full: ShowcaseFullEntry[];
  styleRef: string[];
}

export interface ShowcaseManifest {
  version: number;
  topic: string;
  items: ShowcaseItem[];
}

export interface ShowcaseOpenPayload {
  ok: boolean;
  id: string;
  index: number;
  label: string;
  item: ShowcaseItem;
  entry: ShowcaseFullEntry;
  kind: ShowcaseFullEntry['kind'];
  path?: string;
  url?: string;
  pluginPreview?: {
    id: string;
    folder: string;
    path: string;
    manifest: Manifest | null;
    problems: string[];
  };
}

export interface StyleRefSelection {
  id: string;
  label: string;
  paths: string[];
}

interface ShowcaseState {
  manifest: ShowcaseManifest | null;
  loaded: boolean;
  viewer: ShowcaseOpenPayload | null;
  loadingOpen: boolean;
  error: string;
  /** 从小羽示例卡或预览抽屉点「照这个风格做」跳去工坊新任务页的意图 */
  workshopIntent: { id: string; index: number; at: number } | null;
}

export const useShowcase = create<ShowcaseState>()(() => ({
  manifest: null,
  loaded: false,
  viewer: null,
  loadingOpen: false,
  error: '',
  workshopIntent: null,
}));

let inflight: Promise<ShowcaseManifest> | null = null;
export function loadShowcase(force = false): Promise<ShowcaseManifest> {
  if (!force && useShowcase.getState().loaded && useShowcase.getState().manifest) {
    return Promise.resolve(useShowcase.getState().manifest!);
  }
  if (!force && inflight) return inflight;
  if (!host.electron) {
    const empty: ShowcaseManifest = { version: 1, topic: '', items: [] };
    useShowcase.setState({ manifest: empty, loaded: true });
    return Promise.resolve(empty);
  }
  inflight = host.call<ShowcaseManifest>('showcase.manifest')
    .then((mf) => {
      const clean: ShowcaseManifest = mf && Array.isArray(mf.items) ? mf : { version: 1, topic: '', items: [] };
      useShowcase.setState({ manifest: clean, loaded: true, error: '' });
      return clean;
    })
    .catch((e) => {
      const empty: ShowcaseManifest = { version: 1, topic: '', items: [] };
      useShowcase.setState({ manifest: empty, loaded: true, error: (e as Error).message });
      return empty;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** 在老师预监与老师端预览抽屉中打开完整示例（绝不触碰学生窗口） */
export async function openShowcaseExample(id: string, index = 0): Promise<ShowcaseOpenPayload | null> {
  if (!host.electron) {
    toast('请在桌面版查看完整离线示例');
    return null;
  }
  useShowcase.setState({ loadingOpen: true, error: '' });
  try {
    const res = await host.call<ShowcaseOpenPayload>('showcase.open', { id, index });
    return res;
  } catch (e) {
    const msg = (e as Error).message;
    useShowcase.setState({ loadingOpen: false, error: msg });
    toast('打开示例失败：' + msg);
    return null;
  }
}

export function closeShowcaseViewer() {
  useShowcase.setState({ viewer: null, loadingOpen: false });
}

/** 从小羽或预览抽屉跳到 AI 工坊「新任务」页并应用「照这个风格做」 */
export function applyShowcaseToWorkshop(id: string, index = 0) {
  useShowcase.setState({ workshopIntent: { id, index, at: Date.now() }, viewer: null });
  useStore.getState().set({ page: 'agents' });
}

export function stripEstimateSuffix(cost: string): string {
  return String(cost || '').replace(/[，,·\s]*仅估算[。.\s]*$/, '').trim();
}

export function styleRefOf(item: ShowcaseItem, subIndex = 0): StyleRefSelection {
  const sub = item.id === 'free' ? item.full[subIndex]?.label : '';
  const picked = item.id === 'free' && item.full.length > 1 && item.styleRef.length === item.full.length
    ? [item.styleRef[subIndex] ?? item.styleRef[0]]
    : item.styleRef;
  return {
    id: item.id,
    label: sub ? `${item.label}（${sub}）` : item.label,
    paths: picked.length ? picked : (item.skill ? [item.skill] : []),
  };
}

/** 工坊「新任务」右侧示例小卡片（7 要素齐全，点选或 hover 类型平滑切换） */
export function ShowcaseCard({
  item,
  pluginTemplateName,
  onApplyStyle,
  onCardEnter,
  onCardLeave,
}: {
  item: ShowcaseItem | null;
  pluginTemplateName?: string;
  onApplyStyle: (item: ShowcaseItem, subIndex: number) => void;
  onCardEnter?: () => void;
  onCardLeave?: () => void;
}) {
  const [slide, setSlide] = useState(0);
  const [subIdx, setSubIdx] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideOn = useGuide((s) => s.welcome || (s.active && !s.min));

  useEffect(() => {
    setSlide(0);
    setSubIdx(0);
  }, [item?.id]);

  const imgs = item?.preview.type === 'slides' ? (item.preview.imageUrls ?? []) : [];
  useEffect(() => {
    if (imgs.length <= 1) return;
    const t = window.setInterval(() => {
      setSlide((i) => (i + 1) % imgs.length);
    }, 2200);
    return () => clearInterval(t);
  }, [item?.id, imgs.length]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    void v.play().catch(() => {});
  }, [item?.id, item?.preview.srcUrl]);

  if (!item) {
    if (!pluginTemplateName) return null;
    return (
      <aside className={'sc-card sc-placeholder' + (guideOn ? ' guide-avoid' : '')} data-qa="showcase-placeholder" onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
        <div className="sc-ph-head"><Puzzle size={15} /><b>插件扩展任务</b></div>
        <p>来自已安装插件「{pluginTemplateName}」的任务模板，暂无内置示例卡片。在左侧填写要求即可直接开始。</p>
      </aside>
    );
  }

  const isVideo = item.preview.type === 'video' && !!item.preview.srcUrl;
  const costMain = stripEstimateSuffix(item.cost);
  const multiFull = item.full.length > 1;

  return (
    <aside
      key={item.id}
      className={'sc-card' + (guideOn ? ' guide-avoid' : '')}
      data-qa="showcase-card"
      data-showcase-id={item.id}
      onMouseEnter={onCardEnter}
      onMouseLeave={onCardLeave}
      onFocus={onCardEnter}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onCardLeave?.(); }}
    >
      {/* ① 会动的预览（8秒无声循环 WebM 或 3～4 张自动轮播带圆点切换） */}
      <div className="sc-media" data-qa="showcase-media">
        <span className="sc-badge">{item.label} · 成品示例</span>
        {isVideo ? (
          <video
            ref={videoRef}
            key={item.preview.srcUrl}
            className="sc-video"
            src={item.preview.srcUrl}
            poster={item.preview.posterUrl || undefined}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
          />
        ) : imgs.length > 0 ? (
          <>
            <img
              key={`${item.id}-${slide}`}
              className="sc-slide"
              src={imgs[Math.min(slide, imgs.length - 1)]}
              alt={`${item.label} 预览 ${slide + 1}`}
              draggable={false}
            />
            {imgs.length > 1 && (
              <div className="sc-dots" role="tablist" aria-label="示例轮播切换">
                {imgs.map((_, k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={k === slide}
                    aria-label={`第 ${k + 1} 张预览`}
                    className={'sc-dot' + (k === slide ? ' on' : '')}
                    onClick={() => setSlide(k)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="sc-media-empty"><MonitorPlay size={22} /><span>{item.label}示例预览</span></div>
        )}
      </div>

      {multiFull && (
        item.full.length <= 3 ? (
          <div className="sc-subtabs" data-qa="showcase-subtabs">
            {item.full.map((f, k) => (
              <button
                key={f.file || k}
                type="button"
                className={'sc-subtab' + (k === subIdx ? ' on' : '')}
                onClick={() => { setSubIdx(k); if (item.id === 'free') setSlide(k); }}
                title={f.label}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="sc-subpick" data-qa="showcase-subtabs">
            <span className="sc-k">成品预览</span>
            <select
              className="sc-subselect"
              aria-label="选择要查看的示例成品"
              value={subIdx}
              onChange={(e) => setSubIdx(Number(e.target.value))}
            >
              {item.full.map((f, k) => (
                <option key={f.file || k} value={k}>{f.label}</option>
              ))}
            </select>
          </div>
        )
      )}

      {/* ② 一句话说明 */}
      <p className="sc-one" data-qa="showcase-one">{item.one}</p>

      {/* ③ 三个亮点 */}
      {item.highlights.length > 0 && (
        <ul className="sc-hl" data-qa="showcase-highlights">
          {item.highlights.slice(0, 3).map((h, i) => (
            <li key={i}><Check size={12} /><span>{h}</span></li>
          ))}
        </ul>
      )}

      {/* ④ 「适合什么时候用」小标签 */}
      {item.when.length > 0 && (
        <div className="sc-when" data-qa="showcase-when">
          <span className="sc-k">适合什么时候用</span>
          {item.when.map((w, i) => <i key={i} className="sc-tag">{w}</i>)}
        </div>
      )}

      {/* ⑤ 交付格式 & ⑥ 参考耗时与花费（标「仅估算」） */}
      <div className="sc-meta">
        <div className="sc-meta-row" data-qa="showcase-formats">
          <span className="sc-k">交付格式</span>
          <span className="sc-v">{item.formats}</span>
        </div>
        <div className="sc-meta-row" data-qa="showcase-cost">
          <span className="sc-k">参考耗时与花费</span>
          <span className="sc-v">{costMain || '按任务复杂度计算'}<em className="sc-est">仅估算</em></span>
        </div>
      </div>

      {/* ⑦ 两个按钮：「看完整示例」「照这个风格做」 */}
      <div className="sc-acts">
        <button
          type="button"
          className="sc-btn ghost"
          data-qa="showcase-open"
          onClick={() => void openShowcaseExample(item.id, subIdx)}
        >
          <Eye size={13} />看完整示例
        </button>
        <button
          type="button"
          className="sc-btn primary"
          data-qa="showcase-apply"
          onClick={() => onApplyStyle(item, subIdx)}
        >
          <Sparkles size={13} />照这个风格做
        </button>
      </div>
    </aside>
  );
}

/** 挂载在教师主窗口顶层：响应 showcaseOpen 事件，放入老师预监（pvw）并打开离线完整预览抽屉 */
export function ShowcaseHost() {
  const viewer = useShowcase((s) => s.viewer);
  const error = useShowcase((s) => s.error);
  const pvw = useStore((s) => s.pvw);
  const [preparing, setPreparing] = useState(false);
  const [pluginToast, setPluginToast] = useState('');
  const [pluginEntryIdx, setPluginEntryIdx] = useState(0);
  const [installing, setInstalling] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!host.electron || host.role === 'student' || host.role === 'dock') return;
    void loadShowcase();
    return host.onEvent((e) => {
      if (e?.type !== 'showcaseOpen' || !e.showcase) return;
      const payload = e.showcase as ShowcaseOpenPayload;
      const ticket = ++seqRef.current;
      setPluginEntryIdx(0);
      setPluginToast('');
      useShowcase.setState({ viewer: payload, loadingOpen: false, error: '' });
      if (payload.kind === 'plugin' && payload.pluginPreview?.manifest) {
        const { id, manifest } = payload.pluginPreview;
        usePlugins.setState((s) => ({ dev: { ...s.dev, [id]: manifest } }));
        setPreparing(false);
      } else if (payload.path) {
        setPreparing(true);
        const initView = payload.kind === 'png' ? { fit: 'width' as const, zoom: 0.72 } : undefined;
        void prepareMaterial(fileEntry(payload.path))
          .then((mat) => {
            if (seqRef.current !== ticket || useShowcase.getState().viewer !== payload) return;
            useStore.getState().set({ pvw: { mat, view: defaultView(mat, initView), teacherOnly: true } });
          })
          .catch((e: Error) => { if (seqRef.current === ticket) useShowcase.setState({ error: e.message }); })
          .finally(() => { if (seqRef.current === ticket) setPreparing(false); });
      }
    });
  }, []);

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeShowcaseViewer(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewer]);

  if (!viewer) return null;

  const { item, entry, index } = viewer;
  const isPlugin = viewer.kind === 'plugin' && !!viewer.pluginPreview;
  const matchedPvw = !isPlugin && pvw && viewer.path && pvw.mat.path === viewer.path ? pvw : null;
  const pm = viewer.pluginPreview?.manifest ?? null;
  const pluginEntries = pm ? [
    ...pm.contributes.panels.map((p) => ({ key: 'panel:' + p.id, label: p.title, entry: p.entry, wide: false, w: p.width, h: p.height })),
    ...pm.contributes.lessons.map((p) => ({ key: 'lesson:' + p.id, label: p.title, entry: p.entry, wide: true, w: 0, h: 0 })),
    ...pm.contributes.pages.map((p) => ({ key: 'page:' + p.id, label: p.title, entry: p.entry, wide: true, w: 0, h: 0 })),
  ] : [];
  const curPluginEntry = pluginEntries[Math.min(pluginEntryIdx, Math.max(0, pluginEntries.length - 1))] ?? null;

  const setPvwView = (patch: Partial<NonNullable<typeof pvw>['view']>) => {
    const cur = useStore.getState().pvw;
    if (!cur) return;
    useStore.getState().set({
      pvw: {
        ...cur,
        view: {
          ...cur.view,
          ...patch,
          page: Math.max(0, Math.min(patch.page ?? cur.view.page, cur.mat.pages.length - 1)),
        },
      },
    });
  };

  const installDemoPlugin = async () => {
    const pp = viewer.pluginPreview;
    if (!pp) return;
    setInstalling(true);
    try {
      const staged = pp.folder
        ? await host.call<Staged>('plugins.stageExample', { folder: pp.folder })
        : await host.call<Staged>('plugins.inspectPath', { path: pp.path });
      if (staged?.token) {
        await host.call('plugins.install', { token: staged.token });
        toast(`示例插件「${pm?.name || entry.label}」已安装到导播台`);
      }
    } catch (e) {
      toast('安装示例插件失败：' + (e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="sc-viewer-mask" data-qa="showcase-viewer" onPointerDown={(e) => { if (e.target === e.currentTarget) closeShowcaseViewer(); }}>
      <section className="sc-viewer" role="dialog" aria-label={`完整示例预览：${entry.label}`}>
        <header className="sc-viewer-head">
          <span className="tally cue"><EyeOff size={12} />老师预监 · 绝不上学生屏</span>
          <b className="sc-viewer-title">{entry.label}</b>
          {item.full.length > 1 && (
            <div className="sc-viewer-tabs" data-qa="showcase-viewer-tabs">
              {item.full.map((f, k) => (
                <button
                  key={f.file || k}
                  type="button"
                  className={k === index ? 'on' : ''}
                  onClick={() => void openShowcaseExample(item.id, k)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <span className="flex" />
          {!isPlugin && matchedPvw && (
            <button
              type="button"
              className="sc-v-btn"
              onClick={() => { useStore.getState().set({ page: 'console', rightOpen: true }); closeShowcaseViewer(); }}
              title="切到上课页右侧预监监视器查看"
            >
              在导播台预监栏查看
            </button>
          )}
          {isPlugin && pm && (
            <button type="button" className="sc-v-btn" disabled={installing} onClick={() => void installDemoPlugin()}>
              <FileCheck2 size={13} />{installing ? '安装中…' : '装进导播台试用'}
            </button>
          )}
          <button
            type="button"
            className="sc-v-btn primary"
            data-qa="showcase-viewer-apply"
            onClick={() => applyShowcaseToWorkshop(item.id, index)}
          >
            <Sparkles size={13} />照这个风格做
          </button>
          <button type="button" className="sc-v-close" aria-label="关闭示例预览" onClick={closeShowcaseViewer}>
            <X size={16} />
          </button>
        </header>

        <div className="sc-viewer-body">
          {isPlugin ? (
            <div className="sc-plugin-box">
              {pluginEntries.length > 1 && (
                <div className="sc-viewer-tabs">
                  {pluginEntries.map((pe, k) => (
                    <button key={pe.key} type="button" className={k === pluginEntryIdx ? 'on' : ''} onClick={() => setPluginEntryIdx(k)}>
                      {pe.label}
                    </button>
                  ))}
                </div>
              )}
              {curPluginEntry ? (
                <div
                  className={'sc-plugin-stage' + (curPluginEntry.wide ? ' wide' : '')}
                  style={curPluginEntry.wide ? undefined : { width: Math.min(curPluginEntry.w || 420, 680), height: Math.min(curPluginEntry.h || 460, 560) }}
                >
                  <PluginFrame
                    key={`${viewer.pluginPreview!.id}|${curPluginEntry.entry}`}
                    id={viewer.pluginPreview!.id}
                    entry={curPluginEntry.entry}
                    where="preview"
                    isolated
                    title={curPluginEntry.label}
                    onToast={setPluginToast}
                    onClose={() => setPluginToast('预览模式下保持打开')}
                  />
                </div>
              ) : (
                <div className="sc-viewer-wait">这个插件没有界面面板</div>
              )}
              {pluginToast && <div className="sc-plugin-note">{pluginToast}</div>}
            </div>
          ) : error ? (
            <div className="sc-viewer-wait" role="alert">
              <span>示例打开失败：{error}</span>
              <button className="sc-v-btn" onClick={() => void openShowcaseExample(item.id, index)}>重试</button>
            </div>
          ) : preparing || !matchedPvw ? (
            <div className="sc-viewer-wait">
              <Loader2 size={18} className="ags-spin" />
              <span>正在老师预监中准备完整示例…</span>
            </div>
          ) : (
            <Stage
              mat={matchedPvw.mat}
              view={matchedPvw.view}
              author="teacher"
              tool="pointer"
              color="ink"
              size={3}
              inkEnabled={false}
              boardFill
              overlays={false}
              pad={16}
            />
          )}
        </div>

        {!isPlugin && matchedPvw && (
          <footer className="sc-viewer-foot">
            {matchedPvw.mat.total > 1 && (
              <div className="sc-pager" data-qa="showcase-pager">
                <button
                  type="button"
                  aria-label="上一页"
                  disabled={matchedPvw.view.page <= 0 && matchedPvw.view.slide <= 0}
                  onClick={() => setPvwView(stepView(matchedPvw.mat, matchedPvw.view, -1, { pages: true }))}
                >
                  <ChevronLeft size={15} />上一页
                </button>
                <span className="num">第 {matchedPvw.view.page + 1} / {matchedPvw.mat.total} 页</span>
                <button
                  type="button"
                  aria-label="下一页"
                  disabled={matchedPvw.view.page >= matchedPvw.mat.total - 1}
                  onClick={() => setPvwView(stepView(matchedPvw.mat, matchedPvw.view, 1, { pages: true }))}
                >
                  下一页<ChevronRight size={15} />
                </button>
              </div>
            )}
            {['pdf', 'word', 'slides', 'image'].includes(matchedPvw.mat.kind) && (
              <div className="sc-zoom">
                <button type="button" className={matchedPvw.view.fit === 'page' ? 'on' : ''} onClick={() => setPvwView({ fit: 'page', zoom: 1 })}>整页</button>
                <button type="button" className={matchedPvw.view.fit === 'width' ? 'on' : ''} onClick={() => setPvwView({ fit: 'width', zoom: 1 })}>适宽</button>
                <button type="button" aria-label="缩小" onClick={() => setPvwView({ zoom: Math.max(0.5, +(matchedPvw.view.zoom - 0.15).toFixed(2)) })}><Minus size={13} /></button>
                <span className="num">{Math.round(matchedPvw.view.zoom * 100)}%</span>
                <button type="button" aria-label="放大" onClick={() => setPvwView({ zoom: Math.min(2.5, +(matchedPvw.view.zoom + 0.15).toFixed(2)) })}><Plus size={13} /></button>
              </div>
            )}
            <span className="flex" />
            <span className="sc-viewer-hint">完整示例离线内置，仅供老师预览与试玩</span>
          </footer>
        )}
      </section>
    </div>
  );
}
