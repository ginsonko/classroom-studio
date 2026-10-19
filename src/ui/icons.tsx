// 物理与板书专用图标：lucide 里没有的自己画，线宽与 lucide 保持一致（2px / 24 栅格）
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
});

export const IDashed = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 20l2.5-2.5M9 15l2.5-2.5M14 10l2.5-2.5M19 5l1-1" /></svg>
);
export const IDArrow = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 19L19 5M5 19v-6M5 19h6M19 5h-6M19 5v6" /></svg>
);
export const ICurveArrow = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 18c2-9 9-12 15-10" /><path d="M15 4.5l4 3.5-4.5 2.5" /></svg>
);
export const IIncline = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 19h18V6z" /><path d="M5 22l2-3M10 22l2-3M15 22l2-3" strokeWidth={1.4} /><rect x="9" y="9.5" width="5" height="4" rx=".6" transform="rotate(-32 11.5 11.5)" /></svg>
);
export const IForce = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="6" cy="18" r="2" fill="currentColor" /><path d="M7.5 16.5L19 5M19 5h-6M19 5v6" /></svg>
);
export const IAxes = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 3v16h16" /><path d="M3 5l2-2 2 2M19 17l2 2-2 2" /><path d="M7 15c3-1 4-7 7-8s4 2 6 1" strokeWidth={1.6} /></svg>
);
export const ICurtain = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18" /><path d="M6 15h12M6 18h12" strokeWidth={1.2} opacity=".5" /><path d="M10 9l2 2 2-2" /></svg>
);
export const ISpot = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="5" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const ILaser = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 21c4-2 6-6 9-9" strokeDasharray="2 3" /><circle cx="16" cy="8" r="3" fill="currentColor" stroke="none" /><circle cx="16" cy="8" r="6" opacity=".35" /></svg>
);
export const IMarker = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M15 4l5 5-9 9H6v-5z" /><path d="M4 21h8" strokeWidth={3} /></svg>
);

/** 产品标志：预监（虚框）推到主监（实框） */
export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="1.5" y="5" width="11" height="9" rx="2" stroke="var(--cue)" strokeWidth="1.8" strokeDasharray="2.4 2" />
    <rect x="9.5" y="9" width="13" height="10" rx="2.2" fill="var(--live)" />
    <path d="M14.5 12.2v3.6l3-1.8z" fill="#fff" />
  </svg>
);
