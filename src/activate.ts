// 効果の発動演出（2026-11-22 依頼者「役に合ったエフェクト」）。カードゲームの「発動！」のような 一瞬の 見せ場。
// 絵は使わず、形と色だけで 役ごとに 変える（既存作品の絵・ロゴは 使わない）。

export interface Theme {
  color: string; // メインの色
  color2: string; // 光の色
  glyph: string; // 後ろの 大きな記号（SVG）
  anim: string; // 記号の 動き方
}

const svg = (body: string, vb = '0 0 100 100') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const G = {
  cards: svg('<rect x="18" y="22" width="34" height="50" rx="5" transform="rotate(-18 35 47)"/><rect x="33" y="18" width="34" height="50" rx="5"/><rect x="48" y="22" width="34" height="50" rx="5" transform="rotate(18 65 47)"/>'),
  swap: svg('<path d="M15 35 H80 M65 20 L80 35 L65 50"/><path d="M85 65 H20 M35 50 L20 65 L35 80"/>'),
  skip: svg('<path d="M15 20 L45 50 L15 80"/><path d="M40 20 L70 50 L40 80"/><path d="M65 20 L95 50 L65 80"/>'),
  give: svg('<path d="M10 50 H80 M60 28 L84 50 L60 72"/><rect x="12" y="20" width="22" height="30" rx="4"/>'),
  slash: svg('<path d="M10 90 L90 10" stroke-width="9"/><path d="M22 92 L92 22" stroke-width="3"/>'),
  fire: svg('<path d="M50 92 C22 88 18 60 32 44 C34 58 42 60 44 54 C40 36 50 22 58 8 C60 30 82 40 80 64 C79 82 66 92 50 92 Z"/><path d="M50 90 C40 86 38 74 46 64 C48 72 54 72 56 66 C64 74 62 86 50 90 Z"/>'),
  back: svg('<path d="M80 30 A32 32 0 1 0 82 62"/><path d="M80 12 V32 H60"/><path d="M50 30 V70 M36 56 L50 70 L64 56"/>'),
  reverse: svg('<path d="M80 40 A32 32 0 0 0 22 38"/><path d="M20 22 V40 H38"/><path d="M20 60 A32 32 0 0 0 78 62"/><path d="M80 78 V60 H62"/>'),
  crown: svg('<path d="M12 74 L18 30 L36 52 L50 22 L64 52 L82 30 L88 74 Z"/><path d="M14 86 H86"/><circle cx="18" cy="26" r="4"/><circle cx="50" cy="18" r="4"/><circle cx="82" cy="26" r="4"/>'),
  shield: svg('<path d="M50 8 L86 22 V48 C86 72 68 86 50 94 C32 86 14 72 14 48 V22 Z"/><path d="M50 30 L62 62 M50 30 L38 62 M42 52 H58"/>'),
  chain: svg('<rect x="6" y="36" width="34" height="28" rx="14"/><rect x="33" y="36" width="34" height="28" rx="14"/><rect x="60" y="36" width="34" height="28" rx="14"/>'),
  stairs: svg('<path d="M10 85 H30 V65 H50 V45 H70 V25 H90"/><path d="M70 10 L90 25 L70 40" stroke-width="5"/>'),
  revolution: svg('<path d="M50 6 L58 40 L94 40 L64 60 L76 94 L50 72 L24 94 L36 60 L6 40 L42 40 Z"/>'),
  hit: svg('<circle cx="50" cy="50" r="38"/><path d="M30 52 L45 66 L72 36"/>'),
  miss: svg('<path d="M25 25 L75 75 M75 25 L25 75"/>'),
};

export const THEMES: Record<string, Theme> = {
  'ドロー3': { color: '#2e7dff', color2: '#9fd1ff', glyph: G.cards, anim: 'fan' },
  'トレード4': { color: '#18a86b', color2: '#a6ffd8', glyph: G.swap, anim: 'swap' },
  '5飛び': { color: '#ff8a00', color2: '#ffe0a0', glyph: G.skip, anim: 'dash' },
  '7渡し': { color: '#00a6b4', color2: '#a8f6ff', glyph: G.give, anim: 'dash' },
  '8切り': { color: '#e01b2f', color2: '#ffb3b3', glyph: G.slash, anim: 'slash' },
  '10捨て': { color: '#ff4a12', color2: '#ffd08a', glyph: G.fire, anim: 'burn' },
  'イレブンバック': { color: '#3949ff', color2: '#c3c9ff', glyph: G.back, anim: 'flip' },
  'クイーンリバース': { color: '#e8368f', color2: '#ffc2e0', glyph: G.reverse, anim: 'spin' },
  'キングチャレンジ': { color: '#d4a017', color2: '#fff0a8', glyph: G.crown, anim: 'drop' },
  'エースカウンター': { color: '#c9d4e8', color2: '#ffffff', glyph: G.shield, anim: 'drop' },
  '階段しばり': { color: '#8a5cff', color2: '#e0d2ff', glyph: G.stairs, anim: 'dash' },
  'マークしばり': { color: '#7a7f99', color2: '#e6e8f5', glyph: G.chain, anim: 'drop' },
  '革命！': { color: '#ff2a2a', color2: '#ffd700', glyph: G.revolution, anim: 'spin' },
  '革命返し！': { color: '#ffb300', color2: '#fff3b0', glyph: G.revolution, anim: 'spin' },
  '当たり！': { color: '#1fbf4a', color2: '#c4ffd2', glyph: G.hit, anim: 'drop' },
  'はずれ…': { color: '#55606e', color2: '#c9d0d8', glyph: G.miss, anim: 'drop' },
};

/** 発動演出を出す。終わったら done */
export function showActivate(layer: HTMLElement, title: string, cardHtml: string, done: () => void, ms = 1500) {
  const th = THEMES[title];
  const el = document.createElement('div');
  el.className = `act act-${th.anim}`;
  el.style.setProperty('--ac', th.color);
  el.style.setProperty('--ac2', th.color2);
  el.innerHTML = `
    <div class="act-bg"></div>
    <div class="act-rays"></div>
    <div class="act-ring r1"></div><div class="act-ring r2"></div>
    <div class="act-glyph">${th.glyph}</div>
    <div class="act-card">${cardHtml}</div>
    <div class="act-name"><span>${title.replace(/[！…]$/, '')}</span></div>
    <div class="act-flash"></div>`;
  layer.appendChild(el);
  el.style.setProperty('--dur', `${ms}ms`);
  setTimeout(() => {
    el.remove();
    done();
  }, ms);
}
