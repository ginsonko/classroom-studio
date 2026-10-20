// 合成配乐：按镜头的切点和情绪（calm / drive / epic）现场合成，不用任何音频素材，没有版权问题。
// 用 OfflineAudioContext 一次渲染完，同样的片子每次生成的声音完全一样。
import { rng, type FilmSpec } from './core';

const BPM = 96, BEAT = 60 / BPM, BAR = BEAT * 4;
const CHORDS = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55], [50, 53, 57], [46, 50, 53], [55, 58, 62], [57, 61, 64]];
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export async function makeScore(spec: FilmSpec, sampleRate = 48000): Promise<AudioBuffer> {
  const cuts: { at: number; dur: number; mood: string; cut: string }[] = [];
  let t = 0;
  for (const s of spec.shots) { cuts.push({ at: t, dur: s.dur, mood: s.mood ?? 'drive', cut: s.cut ?? 'fade' }); t += s.dur; }
  const total = t, len = Math.ceil((total + 0.2) * sampleRate);
  const ac = new OfflineAudioContext(2, len, sampleRate);
  const r = rng(2024);
  const noise = (sec: number) => { const b = ac.createBuffer(1, Math.ceil(sec * sampleRate), sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; return b; };
  const master = ac.createGain(); master.gain.value = 0.8;
  // 压限：启动要快，不然鼓点和重音会顶到 0 dB 削波
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.18;
  master.connect(comp); comp.connect(ac.destination);
  // 混响
  const verb = ac.createConvolver(), ir = ac.createBuffer(2, sampleRate * 3, sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (r() * 2 - 1) * (1 - i / d.length) ** 2.6; }
  verb.buffer = ir; const verbOut = ac.createGain(); verbOut.gain.value = 0.55; verb.connect(verbOut); verbOut.connect(master);
  const send = (node: AudioNode, wet: number, dry = 1) => { const a = ac.createGain(); a.gain.value = dry; node.connect(a); a.connect(master); const b = ac.createGain(); b.gain.value = wet; node.connect(b); b.connect(verb); };
  const moodAt = (time: number) => (cuts.find((c) => time >= c.at && time < c.at + c.dur) ?? cuts[cuts.length - 1]).mood;
  const end = total - 0.4;

  // 铺底和弦
  for (let bar = 0; bar * BAR < end; bar++) {
    const t0 = bar * BAR, chord = CHORDS[bar % CHORDS.length], mood = moodAt(t0 + 0.01);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(mood === 'calm' ? 900 : 1600, t0); lp.Q.value = 0.7;
    const env = ac.createGain(); env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(mood === 'epic' ? 0.075 : 0.055, t0 + 0.7); env.gain.setValueAtTime(mood === 'epic' ? 0.075 : 0.055, t0 + BAR - 0.3); env.gain.linearRampToValueAtTime(0, Math.min(t0 + BAR + 0.6, total));
    lp.connect(env); send(env, 0.5);
    for (const m of [...chord, chord[0] - 12]) for (const det of [-7, 7]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      const v = ac.createGain(); v.gain.value = 0.25; o.connect(v); v.connect(lp); o.start(t0); o.stop(Math.min(t0 + BAR + 0.7, total));
    }
  }
  // 琶音（16 分音符）
  const delay = ac.createDelay(1); delay.delayTime.value = BEAT * 0.75; const fb = ac.createGain(); fb.gain.value = 0.32; delay.connect(fb); fb.connect(delay);
  const arpBus = ac.createGain(); arpBus.gain.value = 1; arpBus.connect(delay); send(arpBus, 0.35); send(delay, 0.4, 0.5);
  for (let i = 0; i * BEAT / 4 < end; i++) {
    const t0 = i * BEAT / 4, bar = Math.floor(t0 / BAR), chord = CHORDS[bar % CHORDS.length], mood = moodAt(t0);
    if (t0 < 1.0) continue;
    const pattern = [0, 1, 2, 1, 2, 0, 2, 1], m = chord[pattern[i % 8]] + 24;
    const o = ac.createOscillator(); o.type = mood === 'calm' ? 'sine' : 'triangle'; o.frequency.value = hz(m);
    const v = ac.createGain(), peak = mood === 'calm' ? 0.05 : mood === 'epic' ? 0.06 : 0.045;
    v.gain.setValueAtTime(0, t0); v.gain.linearRampToValueAtTime(peak, t0 + 0.005); v.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.22);
    o.connect(v); v.connect(arpBus); o.start(t0); o.stop(t0 + 0.25);
  }
  // 鼓和贝斯（calm 段不加）
  const kick = (t0: number, amp: number) => {
    const o = ac.createOscillator(), v = ac.createGain(); o.frequency.setValueAtTime(130, t0); o.frequency.exponentialRampToValueAtTime(42, t0 + 0.16);
    v.gain.setValueAtTime(amp, t0); v.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42); o.connect(v); v.connect(master); o.start(t0); o.stop(t0 + 0.45);
  };
  for (let i = 0; i * BEAT < end; i++) {
    const t0 = i * BEAT, mood = moodAt(t0);
    if (mood === 'calm' || t0 < 1.0) continue;
    kick(t0, mood === 'epic' ? 0.7 : 0.55);
    const bar = Math.floor(t0 / BAR), root = CHORDS[bar % CHORDS.length][0] - 24;
    for (const off of [0.5]) {
      const tb = t0 + off * BEAT, o = ac.createOscillator(), v = ac.createGain(), lp = ac.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = hz(root); lp.type = 'lowpass'; lp.frequency.value = 380;
      v.gain.setValueAtTime(0, tb); v.gain.linearRampToValueAtTime(0.16, tb + 0.01); v.gain.exponentialRampToValueAtTime(0.001, tb + BEAT * 0.45);
      o.connect(lp); lp.connect(v); v.connect(master); o.start(tb); o.stop(tb + BEAT * 0.5);
    }
    if (mood === 'epic' || i % 2 === 1) {
      const hat = ac.createBufferSource(); hat.buffer = noise(0.08); const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const v = ac.createGain(), th = t0 + BEAT * 0.5; v.gain.setValueAtTime(0.08, th); v.gain.exponentialRampToValueAtTime(0.001, th + 0.07);
      hat.connect(hp); hp.connect(v); send(v, 0.15); hat.start(th);
    }
  }
  // 转场：切点前的上升噪声 + 切点上的低频冲击
  cuts.forEach((c, i) => {
    if (i === 0) return;
    const at = c.at, strong = c.cut === 'flash' || c.cut === 'glitch' || c.mood === 'epic';
    const rs = ac.createBufferSource(); rs.buffer = noise(1.4); const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(300, at - 1.3); bp.frequency.exponentialRampToValueAtTime(7000, at);
    const rv = ac.createGain(); rv.gain.setValueAtTime(0.0001, at - 1.3); rv.gain.exponentialRampToValueAtTime(strong ? 0.22 : 0.12, at - 0.02); rv.gain.linearRampToValueAtTime(0, at + 0.03);
    rs.connect(bp); bp.connect(rv); send(rv, 0.4); rs.start(Math.max(0, at - 1.3));
    const o = ac.createOscillator(), v = ac.createGain(); o.frequency.setValueAtTime(75, at); o.frequency.exponentialRampToValueAtTime(28, at + 1.2);
    v.gain.setValueAtTime(strong ? 0.8 : 0.5, at); v.gain.exponentialRampToValueAtTime(0.001, at + 1.4); o.connect(v); send(v, 0.3); o.start(at); o.stop(at + 1.5);
    const sn = ac.createBufferSource(); sn.buffer = noise(0.6); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const sv = ac.createGain(); sv.gain.setValueAtTime(strong ? 0.35 : 0.18, at); sv.gain.exponentialRampToValueAtTime(0.001, at + 0.5); sn.connect(lp); lp.connect(sv); send(sv, 0.7); sn.start(at);
  });
  // 片尾和弦长音
  const last = cuts[cuts.length - 1];
  if (last) {
    const t0 = last.at + 0.05, env = ac.createGain(); env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(0.09, t0 + 0.08); env.gain.exponentialRampToValueAtTime(0.001, total);
    send(env, 0.8);
    for (const m of [38, 50, 57, 62, 65, 69]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; o.connect(lp); lp.connect(env); o.start(t0); o.stop(total); }
  }
  return ac.startRendering();
}
