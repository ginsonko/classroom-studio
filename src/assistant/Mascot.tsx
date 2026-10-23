// 助教形象「小羽」：圆滚滚的小羽毛鸟，头顶一根羽毛呆毛、红色蝴蝶结（结上是软件标志里的播放三角），抱着一支铅笔。
// 纯 SVG + CSS 动画：待机会呼吸眨眼、眼睛跟着鼠标转；思考、说话、开心、干活、提醒、睡着各有动作。
import { useEffect, useId, useRef, useState } from 'react';

export type Mood = 'idle' | 'think' | 'talk' | 'happy' | 'work' | 'alert' | 'sleep';

export function Mascot({ mood = 'idle', size = 96, follow = false, className = '', title }: { mood?: Mood; size?: number; follow?: boolean; className?: string; title?: string }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, ''), id = (k: string) => `m${raw}${k}`, url = (k: string) => `url(#${id(k)})`;
  const ref = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    if (!follow || mood === 'sleep') { setLook([0, 0]); return; }
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = ref.current?.getBoundingClientRect(); if (!r) return;
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.56), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
        setLook([(dx / d) * 3.4 * k, (dy / d) * 3 * k]);
      });
    };
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, [follow, mood]);
  const [lx, ly] = mood === 'think' ? [2.6, -3.2] : look;
  const eye = (x: number) => (
    <g className="m-eye">
      <ellipse cx={x} cy={118} rx={11.5} ry={13.5} fill="#1b2232" />
      <ellipse cx={x} cy={123} rx={8} ry={7} fill={url('iris')} />
      <circle cx={x + 4} cy={112.5} r={4.3} fill="#fff" />
      <circle cx={x - 4.2} cy={124.5} r={1.9} fill="#fff" opacity={0.9} />
    </g>
  );
  return (
    <svg ref={ref} className={'mascot ' + className} data-mood={mood} viewBox="0 0 200 210" width={size} height={size * 1.05} role="img" aria-label={title ?? 'AI 助教'}>
      <defs>
        <radialGradient id={id('body')} cx="36%" cy="30%" r="78%">
          <stop offset="0" stopColor="#a6f7fb" /><stop offset=".45" stopColor="#4fe0ef" /><stop offset="1" stopColor="#15a7bd" />
        </radialGradient>
        <linearGradient id={id('belly')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffaf1" /><stop offset="1" stopColor="#ffe9cf" /></linearGradient>
        <linearGradient id={id('wing')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2cc6d9" /><stop offset="1" stopColor="#0f8fa6" /></linearGradient>
        <linearGradient id={id('feather')} x1="0" y1="1" x2=".4" y2="0"><stop offset="0" stopColor="#ffffff" /><stop offset=".55" stopColor="#c9f8fc" /><stop offset="1" stopColor="#ff7a6b" /></linearGradient>
        <linearGradient id={id('bow')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff7b6e" /><stop offset="1" stopColor="#ff3b30" /></linearGradient>
        <linearGradient id={id('iris')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1b2232" stopOpacity="0" /><stop offset="1" stopColor="#3aa9c4" /></linearGradient>
      </defs>
      <ellipse className="m-shadow" cx="100" cy="197" rx="46" ry="6" fill="#000" opacity=".16" />
      <g className="m-all">
        <g className="m-feet" fill="#ffb547" stroke="#e8963a" strokeWidth="1.2">
          <ellipse cx="84" cy="191" rx="11" ry="5.5" /><ellipse cx="116" cy="191" rx="11" ry="5.5" />
        </g>
        <g className="m-wing-l"><path d="M44 119 C24 127 19 154 32 169 C43 161 50 147 52 129 Z" fill={url('wing')} stroke="#0d8196" strokeWidth="1" /></g>
        <g className="m-crest">
          <path d="M97 70 C85 60 80 47 85 36 C93 45 98 57 97 70 Z" fill="#2cc6d9" />
          <path d="M100 70 C91 53 96 34 113 21 C118 40 113 57 100 70 Z" fill={url('feather')} stroke="#9fe9f1" strokeWidth=".8" />
          <path d="M100 69 Q104 47 112 25" fill="none" stroke="#1fb5c9" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M103 52 l6 -3 M104 44 l6 -4 M101 60 l5 -2" stroke="#1fb5c9" strokeWidth="1" strokeLinecap="round" opacity=".7" />
        </g>
        <path className="m-body" d="M100 64 C142 64 164 94 164 130 C164 168 136 190 100 190 C64 190 36 168 36 130 C36 94 58 64 100 64 Z" fill={url('body')} stroke="#139fb5" strokeWidth="1.4" />
        <ellipse cx="72" cy="90" rx="17" ry="9" transform="rotate(-32 72 90)" fill="#fff" opacity=".38" />
        <ellipse cx="100" cy="161" rx="40" ry="27" fill={url('belly')} />
        <path d="M84 157 q5 5 10 0 M106 157 q5 5 10 0 M95 168 q5 5 10 0" fill="none" stroke="#f1d6b2" strokeWidth="2" strokeLinecap="round" />
        <g className="m-bow">
          <path d="M129 75 C120 63 110 67 112 76 C114 85 124 81 129 75 Z M129 75 C138 63 148 67 146 76 C144 85 134 81 129 75 Z" fill={url('bow')} />
          <path d="M126 79 l-4 9 l5 -2 M132 79 l4 9 l-5 -2" fill="#e0302a" />
          <circle cx="129" cy="75" r="5" fill="#e0302a" />
          <path d="M127.4 72.6 L127.4 77.4 L131.6 75 Z" fill="#fff" />
        </g>
        <g className="m-face">
          <g className="m-look" style={{ transform: `translate(${lx}px, ${ly}px)` }}>
            <g className="m-eyes-open">{eye(78)}{eye(122)}</g>
          </g>
          <g className="m-eyes-happy" fill="none" stroke="#1b2232" strokeWidth="4.4" strokeLinecap="round">
            <path d="M67 121 Q78 105 89 121" /><path d="M111 121 Q122 105 133 121" />
          </g>
          <g className="m-eyes-sleep" fill="none" stroke="#1b2232" strokeWidth="3.6" strokeLinecap="round">
            <path d="M68 119 Q78 127 88 119" /><path d="M112 119 Q122 127 132 119" />
          </g>
          <ellipse className="m-blush" cx="60" cy="133" rx="9.5" ry="5.6" fill="#ff7b93" opacity=".45" />
          <ellipse className="m-blush" cx="140" cy="133" rx="9.5" ry="5.6" fill="#ff7b93" opacity=".45" />
          <path className="m-beak" d="M92 131 Q100 126 108 131 Q100 140 92 131 Z" fill="#ffb547" stroke="#e8963a" strokeWidth=".9" strokeLinejoin="round" />
          <g className="m-mouth">
            <path d="M91.5 130 Q100 124.5 108.5 130 Q106.5 143 100 144 Q93.5 143 91.5 130 Z" fill="#ffb547" stroke="#e8963a" strokeWidth=".9" />
            <path d="M94.5 133 Q100 131 105.5 133 Q104 141 100 141.5 Q96 141 94.5 133 Z" fill="#7a2d2d" />
            <ellipse cx="100" cy="139" rx="3.6" ry="2" fill="#ff8fa3" />
          </g>
        </g>
        <g className="m-wing-r">
          <g className="m-pencil" transform="translate(171 146) rotate(28)">
            <rect x="-3.4" y="-30" width="6.8" height="5" rx="1.4" fill="#ff8fa3" />
            <rect x="-3.4" y="-25.5" width="6.8" height="2" fill="#c9ced8" />
            <rect x="-3.4" y="-23.5" width="6.8" height="20" fill="#ffd166" />
            <path d="M-3.4 -3.5 L3.4 -3.5 L0 5 Z" fill="#f6d2a8" /><path d="M-1.2 2 L1.2 2 L0 5 Z" fill="#3a3f4b" />
          </g>
          <path d="M156 119 C176 127 181 154 168 169 C157 161 150 147 148 129 Z" fill={url('wing')} stroke="#0d8196" strokeWidth="1" />
        </g>
      </g>
      <g className="m-fx m-dots"><rect x="140" y="26" width="46" height="24" rx="12" fill="#fff" stroke="#bfeff5" strokeWidth="1.5" /><circle cx="151" cy="38" r="3.4" fill="#2cc6d9" /><circle cx="163" cy="38" r="3.4" fill="#2cc6d9" /><circle cx="175" cy="38" r="3.4" fill="#2cc6d9" /><circle cx="142" cy="56" r="4" fill="#fff" stroke="#bfeff5" strokeWidth="1.2" /></g>
      <g className="m-fx m-spark" fill="#ffd166">
        <path d="M34 66 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z" /><path d="M170 82 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" /><path d="M152 30 l2.4 6 l6 2.4 l-6 2.4 l-2.4 6 l-2.4 -6 l-6 -2.4 l6 -2.4 Z" />
      </g>
      <g className="m-fx m-hearts" fill="#ff6b81">
        <path d="M156 58 c-4 -6 -12 -2 -9 4 c2 4 9 8 9 8 s7 -4 9 -8 c3 -6 -5 -10 -9 -4 Z" /><path d="M38 76 c-3 -4 -8 -1 -6 3 c1 3 6 5 6 5 s5 -2 6 -5 c2 -4 -3 -7 -6 -3 Z" />
      </g>
      <g className="m-fx m-alert"><circle cx="160" cy="52" r="13" fill="#ff3b30" /><rect x="158" y="42" width="4" height="12" rx="2" fill="#fff" /><circle cx="160" cy="59" r="2.3" fill="#fff" /></g>
      <g className="m-fx m-zz" fill="#7c8fb0" fontFamily="Inter, sans-serif" fontWeight="800"><text x="146" y="62" fontSize="16">z</text><text x="160" y="46" fontSize="20">z</text><text x="176" y="28" fontSize="24">Z</text></g>
    </svg>
  );
}
