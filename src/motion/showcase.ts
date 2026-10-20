// 样片：《一节课的宇宙》—— 8 个学科、12 个镜头、约 87 秒，展示课堂动画引擎能做什么。
import type { FilmSpec, ItemSpec } from './core';

const sky = (extra: ItemSpec[] = []): ItemSpec[] => [{ type: 'stars' }, { type: 'nebula' }, ...extra];

// 2H₂ + O₂ → 2H₂O 的原子编排：0~3 是氢，4、5 是氧
const H2O_FROM: [string, number, number, number][] = [['H', -3.3, 1.25, 0], ['H', -2.5, 1.25, 0], ['H', -3.3, -1.25, 0], ['H', -2.5, -1.25, 0], ['O', 2.6, 0.62, 0], ['O', 2.6, -0.62, 0]];
const H2O_TO: [string, number, number, number][] = [['H', -2.45, 1.55, 0.2], ['H', -0.85, 1.55, -0.2], ['H', 0.85, -0.25, 0.2], ['H', 2.45, -0.25, -0.2], ['O', -1.65, 0.95, 0], ['O', 1.65, -0.85, 0]];

export const SHOWCASE: FilmSpec = {
  title: '一节课的宇宙 · 课堂动画引擎样片',
  music: true,
  shots: [
    {
      name: '开场', dur: 6.5, bg: 'space', cut: 'none', mood: 'calm', tint: '#7aa2ff',
      camera: { from: [0, 0, 17], to: [0, 0, 12.5], ease: 'out' },
      items: sky([
        { type: 'warp', dur: 4.2, speed: 110 },
        { type: 'rings', at: 1.6, pos: [0, 0.6, -4], color: '#5b7cff' },
        { type: 'particleText', at: 1.4, text: '课堂动画引擎', width: 12.5, pos: [0, 0.9, 0], from: '#4cc9ff', to: '#c084fc', t0: 0.1, t1: 1.9 },
        { type: 'text', at: 3.6, text: '物理 · 化学 · 生物 · 数学 · 地理 · 历史 · 语文 · 英语', y: 700, size: 36, color: '#d6defc', weight: 500, tracking: 10, anim: 'blur' },
        { type: 'hud', at: 0.6, tag: 'CLASSROOM MOTION ENGINE  ·  v1.2' },
      ]),
    },
    {
      name: '物理 · 开普勒第二定律', dur: 8.5, bg: 'space', cut: 'flash', mood: 'drive', tint: '#4cc9ff',
      camera: { from: [-3.5, 10.5, 12.5], to: [-2.2, 6.8, 10.5], look: [-3.6, 0, 0], orbit: 18 },
      items: sky([
        { type: 'sun', radius: 1.2 },
        { type: 'orbit', a: 6.5, e: 0.62, period: 8.5, phase: 2.62, velocity: true, sweep: 0.1, color: '#4cc9ff' },
        { type: 'badge', at: 0.3, subject: '物理', title: '开普勒第二定律', index: '01 / 08' },
        { type: 'label', at: 0.9, dur: 3.2, text: '远日点', sub: '速度最慢', anchor: [-10.53, 0, 0], dx: 120, dy: -110, color: '#ff9ac6' },
        { type: 'label', at: 4.3, dur: 3.6, text: '近日点', sub: '速度最快', anchor: [2.47, 0, 0], dx: -130, dy: -120, color: '#ffd166' },
        { type: 'caption', at: 1.2, dur: 3.6, text: '行星绕太阳运动：离得远时慢，离得近时快' },
        { type: 'caption', at: 5.0, text: '相同时间内，连线扫过的面积相等' },
        { type: 'formula', at: 5.6, tex: '\\frac{\\Delta S_1}{\\Delta t}=\\frac{\\Delta S_2}{\\Delta t}', x: 1580, y: 250, size: 64, color: '#e8f4ff' },
      ]),
    },
    {
      name: '物理 · 电场线', dur: 6.5, bg: 'blueprint', cut: 'wipe', mood: 'drive', tint: '#4cc9ff',
      items: [
        { type: 'field', charges: [{ x: -300, y: 20, q: 1 }, { x: 300, y: 20, q: -1 }], lines: 20 },
        { type: 'badge', at: 0.2, subject: '物理', title: '等量异种电荷的电场线', index: '01 / 08' },
        { type: 'caption', at: 1.0, text: '电场线从正电荷出发，终止于负电荷' },
        { type: 'formula', at: 2.6, tex: 'E=k\\dfrac{Q}{r^{2}}', x: 1620, y: 230, size: 76, color: '#cfeeff' },
      ],
    },
    {
      name: '化学 · 氢气燃烧', dur: 8.5, bg: 'deep', cut: 'flash', mood: 'drive', tint: '#ff8a3d', bloom: 0.7,
      camera: { from: [0, 1.2, 13], to: [0, 0.6, 10.5], look: [0, 0.3, 0], orbit: 22 },
      items: [
        { type: 'stars', count: 1500 },
        { type: 'reaction', from: H2O_FROM, to: H2O_TO, bondsFrom: [[0, 1], [2, 3], [4, 5]], bondsTo: [[4, 0], [4, 1], [5, 2], [5, 3]], t0: 2.2, t1: 4.4, pos: [0, 0.3, 0], scale: 1.3, spin: 0 },
        { type: 'badge', at: 0.3, subject: '化学', title: '氢气在氧气中燃烧', index: '02 / 08' },
        { type: 'label', at: 0.8, dur: 1.6, text: 'H₂', anchor: [-3.81, 1.93, 0], dx: -90, dy: -90, color: '#e6f0ff' },
        { type: 'label', at: 0.8, dur: 1.6, text: 'O₂', anchor: [3.38, 1.1, 0], dx: 100, dy: -100, color: '#ff8a8a' },
        { type: 'label', at: 5.0, text: 'H₂O', anchor: [-2.15, 1.54, 0], dx: -110, dy: -110, color: '#9fd4ff' },
        { type: 'label', at: 5.2, text: 'H₂O', anchor: [2.15, -0.8, 0], dx: 110, dy: 100, color: '#9fd4ff' },
        { type: 'caption', at: 1.0, dur: 3.2, text: '旧的化学键断开，原子重新组合' },
        { type: 'formula', at: 4.6, tex: '\\ce{2H2 + O2 -> 2H2O}', x: 960, y: 900, size: 78, color: '#ffe2c8' },
      ],
    },
    {
      name: '生物 · DNA 双螺旋', dur: 7.5, bg: 'deep', cut: 'zoom', mood: 'drive', tint: '#3ddc97', bloom: 0.6,
      camera: { from: [-1, -3.5, 11], to: [1.2, 1.2, 8.6], look: [0.6, 0, 0], orbit: 25 },
      items: [
        { type: 'stars', count: 1500 },
        { type: 'dna', pairs: 30, lean: 0.38, spin: 0.55, grow: 2.2 },
        { type: 'badge', at: 0.3, subject: '生物', title: 'DNA 双螺旋结构', index: '03 / 08' },
        { type: 'text', at: 2.4, text: '碱基互补配对', x: 1560, y: 400, size: 46, weight: 800, align: 'left' },
        { type: 'text', at: 2.8, text: 'A ═ T', x: 1560, y: 490, size: 58, weight: 800, color: '#ff9c5a', align: 'left', font: 'latin', glow: 18 },
        { type: 'text', at: 3.1, text: 'G ≡ C', x: 1560, y: 575, size: 58, weight: 800, color: '#4fe3a6', align: 'left', font: 'latin', glow: 18 },
        { type: 'caption', at: 1.0, text: '两条链反向平行盘旋，碱基在内侧两两配对' },
      ],
    },
    {
      name: '数学 · 曲面', dur: 6, bg: 'deep', cut: 'flash', mood: 'epic', tint: '#b28dff',
      camera: { from: [8, 6.2, 9.6], to: [7.6, 5.4, 8.8], look: [0.6, -0.1, 0], orbit: 28 },
      items: [
        { type: 'grid', y: -2.6, color: '#5b3cff' },
        { type: 'surface', f: 'sin(x)*cos(y)', to: '(x^2-y^2)/4', morphAt: 2.8, range: 3, height: 1.0, scale: 1.15, spin: 0.08 },
        { type: 'badge', at: 0.3, subject: '数学', title: '曲面与鞍点', index: '04 / 08' },
        { type: 'formula', at: 0.6, dur: 2.3, tex: 'z=\\sin x\\cos y', x: 1560, y: 240, size: 72, color: '#e9ddff' },
        { type: 'formula', at: 3.0, tex: 'z=\\dfrac{x^{2}-y^{2}}{4}', x: 1560, y: 240, size: 72, color: '#ffd1e8' },
        { type: 'caption', at: 3.3, text: '同一张网格，从波纹变成马鞍面' },
      ],
    },
    {
      name: '数学 · 勾股定理', dur: 8.5, bg: 'blueprint', cut: 'wipe', mood: 'drive', tint: '#b28dff',
      items: [
        { type: 'pythagoras', a: 3, b: 4, size: 560, x: 700, y: 560 },
        { type: 'badge', at: 0.2, subject: '数学', title: '勾股定理 · 拼图证明', index: '04 / 08' },
        { type: 'text', at: 0.5, text: '同一个大正方形\n两种拼法', x: 1440, y: 420, size: 50, weight: 800, align: 'left', lineHeight: 1.45 },
        { type: 'caption', at: 4.4, text: '挪动四个直角三角形：剩下的面积不变' },
        { type: 'formula', at: 7.0, tex: 'a^{2}+b^{2}=c^{2}', x: 1440, y: 650, size: 112, color: '#ffffff', align: 'left', glow: 26 },
      ],
    },
    {
      name: '地理 · 地球', dur: 7, bg: 'space', cut: 'zoom', mood: 'calm', tint: '#34d1bf', light: 'sun',
      camera: { from: [0.5, 1.0, 13.5], to: [-1.0, 1.2, 10.2], look: [0, 0.2, 0], orbit: -18 },
      items: sky([
        { type: 'earth', radius: 2.7, tilt: 23.5, spin: 0.4, lon: 3.6 },
        { type: 'badge', at: 0.3, subject: '地理', title: '地球自转与地轴倾斜', index: '05 / 08' },
        { type: 'label', at: 1.8, text: '地轴倾角 23.5°', anchor: [-1.56, 3.6, 0], dx: -190, dy: 30, color: '#ffd166' },
        { type: 'label', at: 2.6, text: '赤道', anchor: [0, 0, 2.7], dx: 200, dy: 70, color: '#ffd166' },
        { type: 'caption', at: 1.2, text: '地球斜着身子自转，太阳直射点南北移动，带来四季' },
      ]),
    },
    {
      name: '历史 · 时间轴', dur: 7.5, bg: 'deep', cut: 'wipe', mood: 'drive', tint: '#e8b04a',
      items: [
        { type: 'timeline', gap: 540, items: [
          { year: -221, name: '秦', note: '统一六国' }, { year: -202, name: '汉', note: '丝绸之路' }, { year: 581, name: '隋', note: '开创科举' },
          { year: 618, name: '唐', note: '贞观之治' }, { year: 960, name: '宋', note: '活字印刷' }, { year: 1271, name: '元', note: '行省制度' },
          { year: 1368, name: '明', note: '郑和下西洋' }, { year: 1644, name: '清', note: '康乾盛世' },
        ] },
        { type: 'badge', at: 0.2, subject: '历史', title: '中国古代主要王朝', index: '06 / 08' },
      ],
    },
    {
      name: '语文 · 登鹳雀楼', dur: 7.5, bg: 'paper', cut: 'fade', mood: 'calm', tint: '#b3261e',
      items: [
        { type: 'mountains', base: 0.7, sunX: 360, sunY: 300 },
        { type: 'poem', lines: ['白日依山尽', '黄河入海流', '欲穷千里目', '更上一层楼'], title: '登鹳雀楼', author: '王之涣', size: 92, x: 1290, y: 250, per: 0.2 },
        { type: 'badge', at: 0.3, subject: '语文', title: '古诗 · 水墨书写', index: '07 / 08', dark: true, color: '#b3261e' },
      ],
    },
    {
      name: '英语 · 动态排版', dur: 5.5, bg: 'aurora', cut: 'glitch', mood: 'drive', tint: '#ff7ab6',
      items: [
        { type: 'kinetic', text: 'Knowledge is light.', highlight: 'light', sub: '知识就是光', size: 150, y: 470 },
        { type: 'badge', at: 0.2, subject: '英语', title: '动态排版', index: '08 / 08' },
      ],
    },
    {
      name: '片尾', dur: 8.5, bg: 'space', cut: 'flash', mood: 'epic', tint: '#7aa2ff',
      camera: { from: [0, 0.2, 15], to: [0, 0.4, 12], ease: 'out' },
      items: sky([
        { type: 'atom', dur: 3.6, pos: [0, 0.8, 0], scale: 1.1 },
        { type: 'rings', at: 0.2, pos: [0, 0.8, -3], color: '#7aa2ff' },
        { type: 'particleText', at: 2.6, text: '一句话，做出一节课的动画', width: 12.5, pos: [0, 1.4, 0], from: '#4cc9ff', to: '#ff7ab6', t0: 0.1, t1: 1.8 },
        { type: 'endcard', at: 4.6, brand: '最强网课教辅系统', line: '课堂动画引擎 · 八大学科 · 实时预览 · 一键导出 MP4', url: 'classroom.yinziapi.top' },
      ]),
    },
  ],
};
