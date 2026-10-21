import { Layers } from 'lucide-react';
import { useStore } from '../lib/store';
import { builtOf, clicksOf, settleView } from '../lib/slideSteps';

/** PPT 分步开关：开着时显示这一页放到第几下；关掉就整页显示。课件里没有单击动画时不出现 */
export function StepToggle({ className, size = 14 }: { className: string; size?: number }) {
  const on = useStore((s) => s.slideSteps !== false);
  const mat = useStore((s) => s.pgmMat);
  const pgm = useStore((s) => s.pgm);
  if (mat.kind !== 'slides' || !mat.pages.some((p) => p.clicks)) return null;
  const n = clicksOf(mat, pgm.page, on), c = builtOf(mat, pgm, on);
  const tip = on
    ? (n ? `PPT 动画分步出现：这一页按了 ${c} 下，共 ${n} 下 · 翻页笔 / → 先放完动画再翻页` : '这一页没有单击动画') + ' · 点一下改成整页显示'
    : '整页显示：PPT 动画不分步 · 点一下改回按单击动画分步出现';
  return (
    <button className={className + (on ? ' on' : '')} aria-pressed={on} data-tip={tip}
      onClick={() => {
        // 改回分步时正在看的这页按「已放完」算，画面不会突然缩回开头
        const st = useStore.getState();
        st.setShared(on ? { slideSteps: false } : { slideSteps: true, pgm: settleView(st.pgmMat, { ...st.pgm, build: undefined }) });
      }}>
      <Layers size={size} />
      <span className="num">{on ? (n ? `${c}/${n}` : '分步') : '整页'}</span>
    </button>
  );
}
