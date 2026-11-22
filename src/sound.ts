// 効果音【仮】：音のファイルを使わず その場で作る。本番の音が届いたら差しかえる。
let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem('dfg-mute') === '1';
} catch {
  /* 保存できなくてもよい */
}

export function isMuted() {
  return muted;
}
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('dfg-mute', m ? '1' : '0');
  } catch {
    /* 保存できなくてもよい */
  }
}

/** iPhone は 画面を触ったあとでないと 音が出ないので、最初のタッチで 準備する */
export function unlockAudio() {
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(ctx.destination);
  s.start(0);
}

function ready(): AudioContext | null {
  if (muted || !ctx || ctx.state !== 'running') return null;
  return ctx;
}

/** カードを 場に置く「パシッ」 */
function snap(c: AudioContext, t: number, vol = 0.5) {
  const len = 0.09;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2200;
  f.Q.value = 0.8;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

function tone(c: AudioContext, freq: number, t: number, dur: number, vol = 0.18, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export type Sfx = 'play' | 'pass' | 'effect' | 'flow' | 'finish' | 'big' | 'myturn';

export function sfx(kind: Sfx, count = 1) {
  const c = ready();
  if (!c) return;
  const t = c.currentTime + 0.01;
  switch (kind) {
    case 'play':
      for (let i = 0; i < Math.min(count, 4); i++) snap(c, t + i * 0.06);
      break;
    case 'pass':
      tone(c, 330, t, 0.12, 0.08, 'triangle');
      break;
    case 'effect': // キラーン
      [988, 1319, 1760].forEach((f, i) => tone(c, f, t + i * 0.07, 0.35, 0.12, 'triangle'));
      break;
    case 'flow': {
      // シュッ
      const len = 0.3;
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / d.length) * 0.5;
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(600, t);
      f.frequency.exponentialRampToValueAtTime(4000, t + len);
      src.connect(f).connect(c.destination);
      src.start(t);
      break;
    }
    case 'finish':
      [523, 659, 784, 1047].forEach((f, i) => tone(c, f, t + i * 0.1, 0.4, 0.15, 'triangle'));
      break;
    case 'big': // 革命・ケメゾディア
      [392, 523, 659, 784, 1047].forEach((f, i) => tone(c, f, t + i * 0.08, 0.6, 0.16, 'sawtooth'));
      break;
    case 'myturn':
      tone(c, 880, t, 0.15, 0.08);
      tone(c, 1175, t + 0.1, 0.2, 0.08);
      break;
  }
}

// ---------- BGM（試合中だけ。依頼者の曲 public/bgm/game.mp3） ----------
let bgmOff = false;
try {
  bgmOff = localStorage.getItem('dfg-bgm') === '0';
} catch {
  /* 保存できなくてもよい */
}
let bgm: HTMLAudioElement | null = null;
let bgmWanted = false;

export function isBgmOn() {
  return !bgmOff;
}
export function setBgmOn(on: boolean) {
  bgmOff = !on;
  try {
    localStorage.setItem('dfg-bgm', on ? '1' : '0');
  } catch {
    /* 保存できなくてもよい */
  }
  if (on) tryPlayBgm();
  else bgm?.pause();
}

/** 試合が始まったら true、タイトルに戻ったら false */
export function wantBgm(on: boolean) {
  bgmWanted = on;
  if (on) tryPlayBgm();
  else if (bgm) {
    bgm.pause();
    bgm.currentTime = 0;
  }
}

/** iPhone は タッチのあとでないと 鳴らないので、タッチのたびにも呼ぶ */
export function tryPlayBgm() {
  if (!bgmWanted || bgmOff) return;
  if (!bgm) {
    bgm = new Audio(`${import.meta.env.BASE_URL}bgm/game.mp3`);
    bgm.loop = true;
    bgm.preload = 'auto';
    bgm.volume = 0.4;
  }
  if (bgm.paused) bgm.play().catch(() => {});
}

// ほかのアプリに切りかえたら 止める
document.addEventListener('visibilitychange', () => {
  if (document.hidden) bgm?.pause();
  else tryPlayBgm();
});
