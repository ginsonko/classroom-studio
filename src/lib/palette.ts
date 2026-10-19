// ── 色板：语义色名，按黑板皮肤自动适配 ─────────────────────
export type BoardSkin = 'white' | 'ivory' | 'wheat' | 'bean' | 'chalk' | 'slate' | 'space' | 'night' | 'sepia';

export const PEN_COLORS: { id: string; name: string; light: string; dark: string }[] = [
  { id: 'ink', name: '墨', light: '#1b1d22', dark: '#f4f2ea' },
  { id: 'red', name: '红', light: '#e0352b', dark: '#ff7a6e' },
  { id: 'blue', name: '蓝', light: '#1f5fd1', dark: '#7fb2ff' },
  { id: 'green', name: '绿', light: '#178a4c', dark: '#7be0a6' },
  { id: 'orange', name: '橙', light: '#e07a12', dark: '#ffbf66' },
  { id: 'violet', name: '紫', light: '#7a3fd1', dark: '#c9a6ff' },
];
export const STUDENT_COLOR = { light: '#d61f8c', dark: '#ff7ac8' };
export const DARK_BOARDS: BoardSkin[] = ['chalk', 'slate', 'space', 'night'];

export function resolveColor(c: string, boardSkin: BoardSkin, onPage: boolean) {
  const dark = !onPage && DARK_BOARDS.includes(boardSkin);
  if (c === 'student') return dark ? STUDENT_COLOR.dark : STUDENT_COLOR.light;
  if (c === 'ai') return dark ? '#7fe3ef' : '#0f8f9c';
  const p = PEN_COLORS.find((x) => x.id === c);
  if (p) return dark ? p.dark : p.light;
  return c;
}
