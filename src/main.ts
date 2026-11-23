import './style.css';
import titleLogo from './assets/title.webp';
import kemezodiaImg from './assets/kemezodia.webp';
import kemenineImg from './assets/kemenine.webp';
import { Card, SUIT_MARK, SUITS, Suit, cardFromId, rankLabel, sortHand } from './core/cards';
import { CardMove, Place, PlayerView, rankTitle } from './core/game';
import { analyzePlay, canBeat, isForbiddenFinish, isInverted, legalPlays, nextValue } from './core/plays';
import { Controller, hostRoom, joinRoom, localRoom } from './net/peer';
import { HostMsg, MAX_PLAYERS } from './net/room';
import { THEMES, showActivate } from './activate';
import { Sfx, isBgmOn, isMuted, setBgmOn, setMuted, sfx, tryPlayBgm, unlockAudio, wantBgm } from './sound';

const app = document.getElementById('app')!;

// 企画者の絵：src/assets/cards/ に S1.png 〜 C13.png、JK.png、back.png を置くと 自動で使う
const ART = import.meta.glob('./assets/cards/*.{png,webp,jpg,jpeg}', { eager: true, import: 'default' }) as Record<string, string>;
const art = (name: string): string | undefined => {
  for (const ext of ['png', 'webp', 'jpg', 'jpeg']) {
    const u = ART[`./assets/cards/${name}.${ext}`];
    if (u) return u;
  }
  return undefined;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function cardHtml(c: Card, cls = '', attrs = ''): string {
  if (c.rank === 0) {
    const a = art('JK');
    if (a) return `<div class="card has-img ${cls}" ${attrs}><img class="art" src="${a}" alt="JOKER"></div>`;
    return `<div class="card joker ${cls}" ${attrs}>${a ? `<img class="art" src="${a}">` : '<div class="jk"><b>★</b>JOKER</div>'}</div>`;
  }
  const red = c.suit === 'H' || c.suit === 'D';
  const a = art(c.id);
  const m = SUIT_MARK[c.suit!];
  const court = c.rank >= 11 || c.rank === 1;
  if (a) return `<div class="card has-img ${cls}" ${attrs}><img class="art" src="${a}" alt="${rankLabel(c.rank)}"></div>`;
  const inner = a
    ? `<img class="art" src="${a}">`
    : `<div class="c1">${rankLabel(c.rank)}<i>${m}</i></div><div class="mid">${court ? (c.rank === 1 ? m : rankLabel(c.rank)) : m}</div>`;
  return `<div class="card ${red ? 'red' : ''} ${court ? 'face-court' : ''} ${cls}" ${attrs}>${inner}</div>`;
}
function backHtml(cls = '', attrs = ''): string {
  const a = art('back');
  return `<div class="card back ${a ? 'has-art' : ''} ${cls}" ${attrs}>${a ? `<img class="art" src="${a}">` : ''}</div>`;
}

// ---------- 状態 ----------
let ctrl: Controller | null = null;
let view: PlayerView | null = null;
let lobby: Extract<HostMsg, { t: 'lobby' }> | null = null;
let selected = new Set<string>();
let lastSeq = 0;
type Fx =
  | { t: 'banner'; text: string }
  | { t: 'act'; title: string; cards: string[] }
  | { t: 'move'; move: CardMove }
  | { t: 'reveal'; card: string; caption: string }
  | { t: 'exodia'; name: string }
  | { t: 'nine'; name: string };
let fxQ: Fx[] = [];
let fxBusy = false;
/** ケメゾディアの登場が 終わるまで 結果を出さない（2026-11-22 依頼者） */
let holdResult = false;
/** ドロー3で 選んでいるカード */
let drawSel = new Set<string>();
/** トレード4で 選んでいる 伏せたカード */
let tradeSel = new Set<number>();
/** もらったばかりの カード（手札で 光らせる） */
const newCards = new Map<string, number>();
let toast = '';
let showRules = false;
let showMenu = false;

const store = {
  get name() {
    try {
      return localStorage.getItem('dfg-name') ?? '';
    } catch {
      return '';
    }
  },
  set name(v: string) {
    try {
      localStorage.setItem('dfg-name', v);
    } catch {
      /* 保存できなくてもよい */
    }
  },
};

function onMsg(m: HostMsg) {
  if (m.t === 'lobby') {
    lobby = m;
    if (!view) render();
  } else if (m.t === 'view') {
    const v = m.view;
    // 新しい出来事 → 大きな文字
    let sound: Sfx | null = null;
    let cards = 1;
    const rank: Record<Sfx, number> = { pass: 1, play: 2, flow: 3, effect: 4, myturn: 0, finish: 5, big: 6 };
    const want = (k: Sfx, n = 1) => {
      if (!sound || rank[k] > rank[sound]) {
        sound = k;
        cards = n;
      }
    };
    let lastPlayCards: string[] = v.field ? v.field.cards.map((c) => c.id) : [];
    for (const e of v.events) {
      if (e.kind === 'play' && e.cards) lastPlayCards = e.cards;
      if (e.seq <= lastSeq) continue;
      if (e.kind === 'exodia') holdResult = true;
      if (e.title === 'リビングデッドのケメナイン' && e.player !== undefined) fxQ.push({ t: 'nine', name: e.player === v.me ? 'あなた' : v.players[e.player].name });
      else if (e.kind === 'exodia' && e.player !== undefined) fxQ.push({ t: 'exodia', name: e.player === v.me ? 'あなた' : v.players[e.player].name });
      else if (e.reveal) fxQ.push({ t: 'reveal', card: e.reveal.card, caption: e.reveal.caption });
      else if (e.title && THEMES[e.title]) fxQ.push({ t: 'act', title: e.title, cards: e.title === '当たり！' || e.title === 'はずれ…' ? [] : lastPlayCards });
      else if (e.title) fxQ.push({ t: 'banner', text: e.title });
      if (e.move) {
        fxQ.push({ t: 'move', move: e.move });
        if (e.move.to === v.me && e.move.cards) for (const id of e.move.cards) newCards.set(id, Date.now() + 6000);
        want('play', e.move.count);
      }
      if (e.kind === 'play') want('play', e.cards?.length ?? 1);
      else if (e.kind === 'pass') want('pass');
      else if (e.kind === 'flow') want('flow');
      else if (e.kind === 'finish') want('finish');
      else if (e.kind === 'revolution' || e.kind === 'exodia') want('big');
      else if (e.title) want('effect');
    }
    const myTurnNow = !v.over && v.waiting === v.me && (!view || view.waiting !== v.me);
    if (sound) {
      // カードの音のあとに 効果の音
      if (sound !== 'play' && v.events.some((e) => e.seq > lastSeq && e.kind === 'play')) {
        sfx('play', v.events.find((e) => e.seq > lastSeq && e.kind === 'play')?.cards?.length ?? 1);
        const later = sound;
        setTimeout(() => sfx(later), 180);
      } else sfx(sound, cards);
    } else if (myTurnNow) sfx('myturn');
    if (v.events.length) lastSeq = Math.max(lastSeq, v.events[v.events.length - 1].seq);
    // 手札にないカードは 選択から外す
    const ids = new Set(v.hand.map((c) => c.id));
    selected = new Set([...selected].filter((id) => ids.has(id)));
    if (view && view.pending?.type !== v.pending?.type) selected.clear();
    if (v.pending?.type !== 'draw3' || v.pending.asking) drawSel = new Set();
    if (v.pending?.type !== 'trade' || v.pending.player !== v.me || (view?.pending?.type === 'trade' && view.pending.player !== v.pending.player)) tradeSel = new Set();
    if (view && view.waiting !== v.waiting) selected.clear();
    view = v;
    wantBgm(true);
    render();
    runFx();
  } else if (m.t === 'err') {
    toast = m.msg;
    render();
    setTimeout(() => {
      toast = '';
      render();
    }, 2200);
  } else if (m.t === 'closed') {
    const msg = m.msg;
    resetAll();
    renderTitle(msg);
  }
}

function resetAll() {
  document.body.classList.remove('deciding');
  wantBgm(false);
  ctrl = null;
  view = null;
  lobby = null;
  selected.clear();
  lastSeq = 0;
  fxQ = [];
  holdResult = false;
  newCards.clear();
  showMenu = false;
}

// ---------- 演出（大きな文字・カードの移動・めくり）を 順番に ----------
function fxLayer(): HTMLElement {
  let el = document.getElementById('fx');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fx';
    document.body.appendChild(el);
  }
  return el;
}

function placeName(v: PlayerView, p: Place): string {
  if (p === 'grave') return '墓地';
  return p === v.me ? 'あなた' : v.players[p].name;
}

function placeRect(v: PlayerView, p: Place): DOMRect | null {
  const sel = p === 'grave' ? '#grave' : p === v.me ? '.hand' : `.opp[data-p="${p}"]`;
  return document.querySelector(sel)?.getBoundingClientRect() ?? null;
}

function runFx() {
  if (fxBusy || fxQ.length === 0) return;
  fxBusy = true;
  // たまりすぎたら 速く
  const fast = fxQ.length > 5 ? 0.5 : 1;
  const f = fxQ.shift()!;
  const done = (ms: number) =>
    setTimeout(() => {
      fxBusy = false;
      runFx();
    }, ms * fast);
  const layer = fxLayer();
  if (f.t === 'banner') {
    const el = document.createElement('div');
    el.className = 'banner';
    el.innerHTML = `<div><span class="gold-text">${esc(f.text)}</span></div>`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 800 * fast);
    return done(800);
  }
  if (f.t === 'exodia') {
    // ケメゾディア：依頼者の絵（2026-11-22）
    const el = document.createElement('div');
    el.className = 'fx-exodia';
    el.innerHTML = `<div class="ex-flash"></div><img src="${kemezodiaImg}" alt=""><div class="ex-title"><span class="gold-text">ケメゾディア！</span></div><div class="ex-sub">${esc(f.name)} の手札に 6が4枚！</div>`;
    layer.appendChild(el);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.remove();
      holdResult = false;
      fxBusy = false;
      if (view) renderGame(view);
      runFx();
    };
    // 出てすぐは 閉じない（うっかり タップで 見のがさないように）
    setTimeout(() => el.addEventListener('click', close), 1200);
    setTimeout(close, 3600);
    return;
  }
  if (f.t === 'act') {
    const ch = f.cards.length ? f.cards.slice(0, 4).map((id) => cardHtml(cardFromId(id))).join('') : '';
    showActivate(layer, f.title, ch, () => {
      fxBusy = false;
      runFx();
    }, Math.round(1300 * fast)); // 2026-11-22 軽めに → 2026-11-23 依頼者「もう少し長く。一瞬でわかりづらい」
    return;
  }
  if (f.t === 'nine') {
    // リビングデッドのケメナイン：依頼者の絵（2026-11-22）。タップで すぐ閉じる
    const el = document.createElement('div');
    el.className = 'fx-exodia fx-nine';
    el.innerHTML = `<div class="ex-flash"></div><img src="${kemenineImg}" alt=""><div class="ex-title"><span class="gold-text">リビングデッドの<br>ケメナイン</span></div><div class="ex-sub">${esc(f.name)} は 6 を 回収できる！</div>`;
    layer.appendChild(el);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.remove();
      fxBusy = false;
      runFx();
    };
    el.addEventListener('click', close);
    setTimeout(close, 2800);
    return;
  }
  if (f.t === 'reveal') {
    const el = document.createElement('div');
    el.className = 'fx-reveal';
    el.innerHTML = `<div class="fx-cap">${esc(f.caption)}</div>${cardHtml(cardFromId(f.card))}`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2000 * fast);
    return done(2000);
  }
  const v = view;
  const mv = f.move;
  const a = v && placeRect(v, mv.from);
  const b = v && placeRect(v, mv.to);
  if (!v || !a || !b) return done(0);
  const cap = document.createElement('div');
  cap.className = 'fx-move-cap';
  cap.innerHTML = `<b>${esc(mv.label)}</b><span>${esc(placeName(v, mv.from))} <i>→</i> ${esc(placeName(v, mv.to))}</span><small>${mv.count}枚</small>`;
  // 場のカードに かぶらないよう、上のボタンの すぐ下に 出す
  const top = document.querySelector('.badges')?.getBoundingClientRect().bottom;
  if (top) cap.style.top = `${top + 6}px`;
  layer.appendChild(cap);
  // 2026-11-22 依頼者「もらうカード もう少し ゆっくり」：真ん中で 大きく止めてから 届ける
  const faceUp = !!mv.cards?.length;
  const dur = (faceUp ? 1600 : 1000) * fast;
  const n = Math.min(mv.count, 4);
  const midX = window.innerWidth / 2 - 28;
  const midY = window.innerHeight * 0.45 - 42;
  for (let k = 0; k < n; k++) {
    const wrap = document.createElement('div');
    wrap.className = 'fx-card';
    const id = mv.cards?.[k];
    wrap.innerHTML = id ? cardHtml(cardFromId(id)) : backHtml();
    layer.appendChild(wrap);
    const off = (k - (n - 1) / 2) * 18;
    const spread = (k - (n - 1) / 2) * 92;
    const ax = a.left + a.width / 2 - 28 + off;
    const ay = a.top + a.height / 2 - 42;
    const bx = b.left + b.width / 2 - 28 + off;
    const by = b.top + b.height / 2 - 42;
    wrap.animate(
      [
        { transform: `translate(${ax}px, ${ay}px) scale(.6)`, opacity: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
        { transform: `translate(${midX + spread}px, ${midY}px) scale(1.6)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${midX + spread}px, ${midY}px) scale(1.6)`, opacity: 1, offset: 0.65, easing: 'cubic-bezier(.5,0,.3,1)' },
        { transform: `translate(${bx}px, ${by}px) scale(.85)`, opacity: 1, offset: 0.93 },
        { transform: `translate(${bx}px, ${by}px) scale(.7)`, opacity: 0 },
      ],
      { duration: dur, delay: k * 120 * fast, fill: 'both' },
    );
    setTimeout(() => wrap.remove(), dur + k * 120 * fast + 50);
  }
  setTimeout(() => cap.remove(), (dur + 500) * fast);
  return done(dur / fast + 500);
}

// ---------- タイトル ----------
function renderTitle(err = '') {
  app.innerHTML = `
  <div class="screen">
    <img class="title-logo" src="${titleLogo}" alt="大富豪 GOLD">
    <div class="panel">
      <input id="name" maxlength="10" placeholder="なまえ" value="${esc(store.name)}">
      <button id="host">部屋を作る</button>
      <div class="row"><input id="code" inputmode="numeric" maxlength="4" placeholder="部屋番号"><button id="join" class="ghost" style="flex:.7">入る</button></div>
      <button id="cpu" class="ghost">CPUと練習</button>
      <button id="rules" class="ghost">ルール</button>
      <div class="err" id="err">${esc(err)}</div>
    </div>
  </div>`;
  const nameEl = document.getElementById('name') as HTMLInputElement;
  const errEl = document.getElementById('err')!;
  const getName = () => {
    const n = nameEl.value.trim();
    if (!n) {
      errEl.textContent = 'なまえを入れてください';
      return null;
    }
    store.name = n;
    return n;
  };
  document.getElementById('host')!.onclick = async () => {
    const n = getName();
    if (!n) return;
    errEl.textContent = '部屋を作っています…';
    ctrl = await hostRoom(n, onMsg, (e) => (errEl.textContent = e));
    render();
  };
  document.getElementById('join')!.onclick = () => {
    const n = getName();
    if (!n) return;
    const code = (document.getElementById('code') as HTMLInputElement).value.trim();
    if (!/^\d{4}$/.test(code)) {
      errEl.textContent = '4けたの部屋番号を入れてください';
      return;
    }
    errEl.textContent = 'つないでいます…';
    ctrl = joinRoom(code, n, onMsg, (e) => {
      ctrl?.leave();
      resetAll();
      renderTitle(e);
    });
  };
  document.getElementById('cpu')!.onclick = () => {
    const n = getName();
    if (!n) return;
    renderCpuSetup(n);
  };
  document.getElementById('rules')!.onclick = () => {
    showRules = true;
    renderRulesOver(app);
  };
}

function renderCpuSetup(name: string) {
  let total = 4;
  const draw = () => {
    app.innerHTML = `
    <div class="screen">
      <div class="logo gold-text" style="font-size:34px">CPUと練習</div>
      <div class="panel">
        <h3>人数（あなたをふくむ）</h3>
        <div class="counter"><button id="m">−</button><span>${total}人</span><button id="p">＋</button></div>
        <button id="go">はじめる</button>
        <button id="back" class="ghost">もどる</button>
      </div>
    </div>`;
    document.getElementById('m')!.onclick = () => ((total = Math.max(2, total - 1)), draw());
    document.getElementById('p')!.onclick = () => ((total = Math.min(MAX_PLAYERS, total + 1)), draw());
    document.getElementById('back')!.onclick = () => renderTitle();
    document.getElementById('go')!.onclick = () => {
      ctrl = localRoom(name, total, onMsg);
    };
  };
  draw();
}

// ---------- 待合室 ----------
function renderLobby() {
  const l = lobby!;
  const isHost = ctrl?.isHost;
  app.innerHTML = `
  <div class="screen">
    <div class="note">部屋番号</div>
    <div class="code gold-text">${l.code}</div>
    <div class="note">友だちに この番号を 伝えてください</div>
    <div class="panel">
      <h3>参加者 ${l.seats.length}人</h3>
      <div class="seats">${l.seats.map((s, i) => `<div class="seat"><span>${esc(s.name)}${i === l.you ? '（あなた）' : ''}</span><span class="k">${s.kind === 'host' ? '親' : ''}</span></div>`).join('')}</div>
      ${
        isHost
          ? `<h3 style="margin-top:6px">遊ぶ人数（足りない分は CPU）</h3>
        <div class="counter"><button id="m">−</button><span>${l.total}人</span><button id="p">＋</button></div>
        <button id="start" ${l.seats.length + (l.total - l.seats.length) < 2 ? 'disabled' : ''}>スタート</button>`
          : `<div class="note">親が スタートするのを 待っています…<br>（${l.total}人で遊びます。足りない分は CPU）</div>`
      }
      <button id="leave" class="ghost">部屋を出る</button>
    </div>
  </div>`;
  if (isHost) {
    document.getElementById('m')!.onclick = () => ctrl!.setTotal!(l.total - 1);
    document.getElementById('p')!.onclick = () => ctrl!.setTotal!(l.total + 1);
    document.getElementById('start')!.onclick = () => ctrl!.start!();
  }
  document.getElementById('leave')!.onclick = () => {
    ctrl?.leave();
    resetAll();
    renderTitle();
  };
}

// ---------- 対戦 ----------
function myTurnPlay(v: PlayerView) {
  return !v.over && !v.pending && v.waiting === v.me;
}

function selectionMode(v: PlayerView): { need: number; label: string } | null {
  const p = v.pending;
  if (!p || p.player !== v.me) return null;
  if (p.type === 'give7') return { need: Math.min(p.count, v.hand.length), label: `${v.players[p.to].name} に 渡す` };
  if (p.type === 'counterGive') return { need: Math.min(p.count, v.hand.length), label: `${v.players[p.to].name} に 渡す` };
  if (p.type === 'ten') return { need: Math.min(p.count, v.hand.length), label: '墓地に 捨てる' };
  if (p.type === 'kingDiscard') return { need: Math.min(p.count, v.hand.length), label: '墓地に 捨てる' };
  return null;
}

function selectedPlayOk(v: PlayerView): boolean {
  if (!myTurnPlay(v) || selected.size === 0) return false;
  const cards = v.hand.filter((c) => selected.has(c.id));
  const p = analyzePlay(cards);
  return !!p && canBeat(v, p) && !isForbiddenFinish(p, v.hand.length);
}

function render() {
  if (!ctrl) return renderTitle();
  if (!view) {
    if (lobby) return renderLobby();
    return;
  }
  renderGame(view);
}

function statusOf(v: PlayerView, i: number): string {
  const p = v.players[i];
  if (p.out) {
    const k = v.ranking ? v.ranking.indexOf(i) : -1;
    return k >= 0 ? `${k + 1}位` : '上がり';
  }
  if (v.field && p.passed) return 'パス';
  return '';
}

function turnText(v: PlayerView): { text: string; mine: boolean } {
  if (v.over) return { text: 'ゲーム終了', mine: false };
  const w = v.waiting;
  if (w === null) return { text: '', mine: false };
  const nm = v.players[w].name;
  const p = v.pending;
  if (w === v.me) {
    if (!p) return { text: v.field ? 'あなたの番です' : 'あなたの番（好きなカードを出せます）', mine: true };
    return { text: 'えらんでください', mine: true };
  }
  if (p) {
    const what: Record<string, string> = {
      draw3: 'ドロー3を 使っています',
      trade: '交換するカードを選んでいます',
      counter: 'エースカウンターするか 考えています',
      counterGive: '渡すカードを選んでいます',
      give7: '渡すカードを選んでいます',
      nine: '6を回収するか 考えています',
      ten: '捨てるカードを選んでいます',
      king: 'マークを予想しています',
      kingDiscard: '捨てるカードを選んでいます',
    };
    return { text: `${nm} が ${what[p.type]}…`, mine: false };
  }
  return { text: `${nm} の番`, mine: false };
}

function renderGame(v: PlayerView) {
  const n = v.players.length;
  const opps: number[] = [];
  for (let k = 1; k < n; k++) opps.push((v.me + k) % n);
  const inv = isInverted(v);
  const hand = sortHand(v.hand, inv);
  const mode = selectionMode(v);
  const playing = myTurnPlay(v);
  // 出せるカードを明るく
  const playable = new Set<string>();
  if (playing) for (const p of legalPlays(v, v.hand)) for (const c of p.cards) playable.add(c.id);
  const rows = hand.length > 13 ? 2 : 1;
  const perRow = Math.ceil(hand.length / rows);
  const width = Math.min(window.innerWidth, 520) - 16;
  const cw = 56;
  const step = perRow > 1 ? Math.min(cw + 4, (width - cw) / (perRow - 1)) : cw;
  let handHtml = '';
  for (let r = 0; r < rows; r++) {
    const part = hand.slice(r * perRow, (r + 1) * perRow);
    handHtml += `<div class="hrow">${part
      .map((c, i) => {
        const isNew = (newCards.get(c.id) ?? 0) > Date.now();
        const cls = ['tap', selected.has(c.id) ? 'sel' : '', playing && !playable.has(c.id) ? 'dim' : '', isNew ? 'new' : ''].join(' ');
        return cardHtml(c, cls, `data-card="${c.id}" style="margin-left:${i === 0 ? 0 : step - cw}px;z-index:${i}"`);
      })
      .join('')}</div>`;
  }
  const t = turnText(v);
  const badges: string[] = [];
  // 発生中のものは 色つき（2026-11-23 依頼者）。色は 発動演出と そろえる
  badges.push(`<span class="badge ${v.direction === 1 ? '' : 'on-q'}">${v.direction === 1 ? '↻ 時計回り' : '↺ 逆回り'}</span>`);
  if (v.revolution) badges.push('<span class="badge on-rev">革命中</span>');
  if (v.elevenBack) badges.push('<span class="badge on-j">イレブンバック中</span>');
  if (v.seqBind && v.field) {
    const nv = nextValue(v, v.field.value);
    const lbl = nv >= 3 && nv <= 13 ? rankLabel(nv) : nv === 14 ? 'A' : nv === 15 ? '2' : 'なし';
    badges.push(`<span class="badge on-seq">階段しばり 次は ${lbl}</span>`);
  }
  if (v.bind) badges.push(`<span class="badge on-bind">マークしばり ${v.bind.map((s) => `<b class="${s === 'H' || s === 'D' ? 'sr' : 'sb'}">${SUIT_MARK[s]}</b>`).join('')}</span>`);

  badges.push(`<span class="badge" id="menu" style="cursor:pointer">≡</span>`);
  const logLines = v.events.filter((e) => e.text && (e.kind !== 'info' || e.only === v.me)).slice(-3);
  const fieldCards = v.field ? v.field.cards : [];
  app.innerHTML = `
  <div class="game">
    <div class="top">
      <div class="opps">${opps
        .map((i) => {
          const p = v.players[i];
          const st = statusOf(v, i);
          return `<div class="opp ${v.waiting === i && !v.over ? 'turn' : ''} ${p.out ? 'out' : ''}" data-p="${i}">
            <div class="on">${esc(p.name)}</div>
            <div class="oc">${p.count}<small> 枚</small></div>
            <div class="os ${st === 'パス' ? 'pass' : ''}">${st}</div></div>`;
        })
        .join('')}</div>
      <div class="badges">${badges.join('')}</div>
    </div>
    <div class="center">${
      mode
        ? pickPanel(v, mode)
        : `
      <div class="field-row">${graveHtml(v.graveyardCount)}<div class="field ${fieldCards.length > 3 ? 'many' : ''}">${
        fieldCards.length ? fieldCards.map((c) => cardHtml(c)).join('') : '<div class="field-empty">場は 空です</div>'
      }</div><div class="grave-spacer"></div></div>
      <div class="fieldby">${v.field && v.fieldOwner !== null ? `${esc(v.players[v.fieldOwner].name)} が 出しました` : ''}</div>
      <div class="turnmsg ${t.mine ? 'mine' : ''}">${esc(toast || t.text)}</div>`
    }</div>
    <div class="bottom">
      ${mode ? '' : `<div class="log">${logLines.map((e) => `<div>${esc(e.text)}</div>`).join('')}</div>`}
      <div class="actions">${
        playing
          ? `<button id="pass" class="ghost" ${v.field ? '' : 'disabled'}>パス</button><button id="play" ${selectedPlayOk(v) ? '' : 'disabled'}>出す</button>`
          : mode
            ? `<button id="give" class="big" ${selected.size === mode.need ? '' : 'disabled'}>${selected.size === mode.need ? mode.label : `あと ${mode.need - selected.size}枚 選ぶ`}</button>`
            : ''
      }</div>
      <div class="hand">${handHtml || '<div class="note">手札は ありません</div>'}</div>
      <div class="me-name"><b>${esc(v.players[v.me].name)}</b>（あなた）・${v.hand.length}枚 ${v.players[v.me].out ? '・' + statusOf(v, v.me) : ''}</div>
    </div>
    ${sheetHtml(v)}
  </div>`;
  // 自分が選ぶ画面を出している間は 演出を隠す（選ぶ画面に かぶらないように）
  const p0 = v.pending;
  document.body.classList.toggle('deciding', !v.over && !!p0 && p0.player === v.me);
  bindGame(v, mode);
  if (showRules) renderRulesOver(document.querySelector('.game')!);
  if (showMenu) renderMenu();
}

function sheetHtml(v: PlayerView): string {
  if (v.over) return holdResult ? '' : resultHtml(v);
  const p = v.pending;
  if (!p || p.player !== v.me) return '';
  switch (p.type) {
    case 'draw3':
      if (p.asking)
        return `<div class="sheet-wrap"><div class="sheet">
        <h2 class="gold-text">ドロー3</h2>
        <p>墓地からランダムで${3 * p.count}枚 見て、${p.count}枚 手札に加えます。<br>使うと 必ず${p.count}枚 取ります。使いますか？</p>
        <div class="row"><button class="ghost" data-decide="0">使わない</button><button data-decide="1">使う</button></div></div></div>`;
      return `<div class="sheet-wrap"><div class="sheet">
        <h2 class="gold-text">ドロー3</h2>
        <p>墓地から出た ${p.options?.length ?? 0}枚。<br>${p.count}枚 選んで 手札に加えてください</p>
        <div class="cards ${(p.options?.length ?? 0) > 3 ? '' : 'big'}">${(p.options ?? []).map((c) => cardHtml(c, `tap ${drawSel.has(c.id) ? 'sel' : ''}`, `data-draw="${c.id}"`)).join('')}</div>
        <button id="draw-ok" ${drawSel.size === p.count ? '' : 'disabled'}>${drawSel.size === p.count ? '手札に 加える' : `あと ${p.count - drawSel.size}枚 選ぶ`}</button></div></div>`;
    case 'trade':
      return `<div class="sheet-wrap"><div class="sheet">
        <h2 class="gold-text">トレード4</h2>
        <p>${esc(v.players[p.other].name)} の手札から ${p.need}枚 選んでください</p>
        <div class="cards">${Array.from({ length: p.count }, (_, i) => backHtml(`tap ${tradeSel.has(i) ? 'sel' : ''}`, `data-trade="${i}"`)).join('')}</div>
        ${p.need > 1 ? `<button id="trade-ok" ${tradeSel.size === p.need ? '' : 'disabled'}>${tradeSel.size === p.need ? 'この カードと 交換' : `あと ${p.need - tradeSel.size}枚 選ぶ`}</button>` : ''}</div></div>`;
    case 'counter':
      return `<div class="sheet-wrap"><div class="sheet">
        <h2 class="gold-text">エースカウンター</h2>
        <p>${esc(v.players[p.giver].name)} から 7渡し（${p.count}枚）が来ます。<br>エースを捨てた枚数だけ、逆に 渡し返せます。</p>
        <div class="row"><button class="ghost" data-counter="0">しない</button>${Array.from({ length: p.max }, (_, i) => `<button data-counter="${i + 1}">${p.max > 1 ? `エース${i + 1}枚で する` : 'する'}</button>`).join('')}</div>
        ${p.count > 1 ? `<p class="note">カウンターしなかった分は ${esc(v.players[p.giver].name)} から 受け取ります</p>` : ''}</div></div>`;
    case 'nine':
      return `<div class="sheet-wrap"><div class="sheet">
        <h2 class="gold-text">リビングデッドのケメナイン</h2>
        <p>${p.picked > 0 ? 'ほかのマークの 6 も 回収できます' : '出した9と 同じマークの 6 を 回収できます'}</p>
        <div class="cards big">${p.options
          .map((o) => `<div style="text-align:center">${cardHtml(cardFromId(o.cardId), 'tap', `data-pick="${o.cardId}"`)}<div class="note">${o.from === 'grave' ? '墓地' : esc(v.players[o.from].name)}</div></div>`)
          .join('')}</div>
        <button class="ghost" data-pick="">${p.picked > 0 ? 'もう いらない' : '回収しない'}</button></div></div>`;
    case 'king':
      return `<div class="sheet-wrap"><div class="sheet">
        <h2 class="gold-text">キングチャレンジ</h2>
        <p>墓地をシャッフルしました。<br>一番上のカードの マークは？</p>
        <div class="suitbtns">${SUITS.map((s) => `<button class="${s === 'H' || s === 'D' ? 'r' : ''}" data-guess="${s}">${SUIT_MARK[s]}</button>`).join('')}</div></div></div>`;
  }
  return '';
}

/** 墓地：裏のカードを 枚数ぶん 重ねて見せる（2026-11-22 依頼者） */
function graveHtml(n: number): string {
  const layers = Math.min(n, 54);
  let stack = '';
  for (let i = 0; i < layers - 1; i++) stack += `<i style="transform:translate(${-i * 0.35}px,${-i * 1.1}px)"></i>`;
  const top = layers > 0 ? `<div class="g-top" style="transform:translate(${-(layers - 1) * 0.35}px,${-(layers - 1) * 1.1}px)">${backHtml()}</div>` : '<div class="g-empty"></div>';
  return `<div class="grave" id="grave"><div class="g-stack">${stack}${top}</div><div class="g-label">墓地 <b>${n}</b>枚</div></div>`;
}

/** 手札からカードを選ぶ時（7渡し・エースカウンター・10捨て・キングチャレンジ成功）：
 *  真ん中に 何をするかと 選んだカードを 大きく出す（ほかの文字は 出さない） */
function pickPanel(v: PlayerView, mode: { need: number; label: string }): string {
  const p = v.pending!;
  const who = (i: number) => esc(v.players[i].name);
  const info: Record<string, [string, string]> = {
    give7: ['7渡し', p.type === 'give7' ? `${who(p.to)} に 渡す<br>カードを ${mode.need}枚 選んでください` : ''],
    counterGive: ['エースカウンター', p.type === 'counterGive' ? `${who(p.to)} に 渡す<br>カードを ${mode.need}枚 選んでください` : ''],
    ten: ['10捨て', `墓地に 捨てる<br>カードを ${mode.need}枚 選んでください`],
    kingDiscard: ['キングチャレンジ 成功！', `墓地に 捨てる<br>カードを ${mode.need}枚 選んでください`],
  };
  const [title, desc] = info[p.type];
  const chosen = v.hand.filter((c) => selected.has(c.id));
  const slots = Array.from({ length: mode.need }, (_, i) =>
    chosen[i] ? cardHtml(chosen[i], 'tap', `data-unpick="${chosen[i].id}"`) : '<div class="slot"></div>',
  ).join('');
  return `<div class="pick">
    <div class="pick-t gold-text">${title}</div>
    <div class="pick-d">${desc}</div>
    <div class="pick-slots">${slots}</div>
    <div class="pick-h">下の手札を タップして 選ぶ（もう一度 タップで 戻す）</div>
  </div>`;
}

function resultHtml(v: PlayerView): string {
  const r = v.ranking ?? [];
  return `<div class="sheet-wrap"><div class="sheet">
    <h2 class="gold-text">${v.exodia !== null ? 'ケメゾディア！' : '結果'}</h2>
    ${v.exodia !== null ? `<p>${esc(v.players[v.exodia].name)} が 6を4枚 そろえて 勝ち！</p>` : ''}
    <div class="result">${r
      .map((i, k) => `<div class="rk ${i === v.me ? 'me' : ''}"><span class="t">${rankTitle(k, r.length)}</span><span class="n">${esc(v.players[i].name)}</span><span class="note">${k + 1}位</span></div>`)
      .join('')}</div>
    ${ctrl?.isHost ? '<button id="again">もう一回</button>' : '<p class="note">親が 次のゲームを 始めるのを 待っています</p>'}
    <button id="quit" class="ghost">やめる</button></div></div>`;
}

function bindGame(v: PlayerView, mode: { need: number } | null) {
  document.querySelectorAll<HTMLElement>('.hand [data-card]').forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.card!;
      if (!myTurnPlay(v) && !mode) return;
      if (selected.has(id)) selected.delete(id);
      else {
        if (mode && selected.size >= mode.need) {
          // いっぱいの時は 最初に選んだカードと 入れかえ
          selected.delete([...selected][0]);
        }
        if (myTurnPlay(v)) autoSelect(v, id);
        else selected.add(id);
      }
      renderGame(v);
    };
  });
  const on = (sel: string, fn: (el: HTMLElement) => void) => document.querySelectorAll<HTMLElement>(sel).forEach((el) => (el.onclick = () => fn(el)));
  on('#play', () => {
    ctrl!.send({ type: 'play', cards: [...selected] });
    selected.clear();
  });
  on('#pass', () => {
    ctrl!.send({ type: 'pass' });
    selected.clear();
  });
  on('#give', () => {
    ctrl!.send({ type: 'cards', cards: [...selected] });
    selected.clear();
  });
  on('[data-draw]', (el) => {
    const p = v.pending;
    if (!p || p.type !== 'draw3') return;
    const id = el.dataset.draw!;
    if (drawSel.has(id)) drawSel.delete(id);
    else {
      if (drawSel.size >= p.count) drawSel.delete([...drawSel][0]);
      drawSel.add(id);
    }
    renderGame(v);
  });
  on('#draw-ok', () => {
    ctrl!.send({ type: 'cards', cards: [...drawSel] });
    drawSel = new Set();
  });
  on('[data-unpick]', (el) => {
    selected.delete(el.dataset.unpick!);
    renderGame(v);
  });
  on('[data-pick]', (el) => ctrl!.send({ type: 'pick', cardId: el.dataset.pick || null }));
  on('[data-trade]', (el) => {
    const p = v.pending;
    if (!p || p.type !== 'trade') return;
    const i = Number(el.dataset.trade);
    if (p.need === 1) {
      ctrl!.send({ type: 'tradePick', indices: [i] });
      return;
    }
    if (tradeSel.has(i)) tradeSel.delete(i);
    else {
      if (tradeSel.size >= p.need) tradeSel.delete([...tradeSel][0]);
      tradeSel.add(i);
    }
    renderGame(v);
  });
  on('#trade-ok', () => {
    ctrl!.send({ type: 'tradePick', indices: [...tradeSel] });
    tradeSel = new Set();
  });
  on('[data-decide]', (el) => ctrl!.send({ type: 'decide', use: el.dataset.decide === '1' }));
  on('[data-counter]', (el) => {
    const n = Number(el.dataset.counter);
    ctrl!.send({ type: 'counter', use: n > 0, n });
  });
  on('[data-guess]', (el) => ctrl!.send({ type: 'guess', suit: el.dataset.guess as Suit }));
  on('#again', () => {
    lastSeq = 0;
    ctrl!.again();
  });
  on('#quit', () => leaveGame());
  on('#menu', () => {
    showMenu = true;
    renderMenu();
  });
}

/** 1枚タップしたとき、場に合わせて 同じ数字を まとめて選ぶ */
function autoSelect(v: PlayerView, id: string) {
  selected.add(id);
  if (!v.field || v.field.count === 1) return;
  const cur = v.hand.filter((c) => selected.has(c.id));
  const need = v.field.count;
  if (cur.length !== 1) return;
  // 選んだカードを含む 出せる組み合わせのうち いちばん弱いもの
  const cands = legalPlays(v, v.hand).filter((p) => p.cards.some((c) => c.id === id) && p.count === need && !p.hasJoker);
  if (cands.length === 0) return;
  const inv = isInverted(v);
  cands.sort((a, b) => (inv ? b.value - a.value : a.value - b.value));
  selected = new Set(cands[0].cards.map((c) => c.id));
}

function leaveGame() {
  ctrl?.leave();
  resetAll();
  renderTitle();
}

function renderMenu() {
  const g = document.querySelector('.game');
  if (!g) return;
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet"><h2 class="gold-text">メニュー</h2>
    <button id="m-rules" class="ghost">ルールを見る</button>
    <button id="m-sound" class="ghost">効果音：${isMuted() ? 'オフ' : 'オン'}</button>
    <button id="m-bgm" class="ghost">BGM：${isBgmOn() ? 'オン' : 'オフ'}</button>
    <button id="m-quit" class="ghost">${ctrl?.isHost ? '部屋を閉じる' : '部屋を出る'}</button>
    <button id="m-close">もどる</button></div>`;
  g.appendChild(el);
  (el.querySelector('#m-close') as HTMLElement).onclick = () => {
    showMenu = false;
    el.remove();
  };
  (el.querySelector('#m-sound') as HTMLElement).onclick = (ev) => {
    setMuted(!isMuted());
    (ev.currentTarget as HTMLElement).textContent = `効果音：${isMuted() ? 'オフ' : 'オン'}`;
  };
  (el.querySelector('#m-bgm') as HTMLElement).onclick = (ev) => {
    setBgmOn(!isBgmOn());
    (ev.currentTarget as HTMLElement).textContent = `BGM：${isBgmOn() ? 'オン' : 'オフ'}`;
  };
  (el.querySelector('#m-rules') as HTMLElement).onclick = () => {
    showMenu = false;
    el.remove();
    showRules = true;
    renderRulesOver(g as HTMLElement);
  };
  (el.querySelector('#m-quit') as HTMLElement).onclick = () => {
    showMenu = false;
    leaveGame();
  };
}

const RULES: [string, string][] = [
  ['3 ドロー3（任意）', '使うか 先に選ぶ。使うと 墓地からランダムで3枚 見て、好きな1枚を 必ず 手札に加える（3を2枚なら 6枚見て2枚、3枚なら 9枚見て3枚）'],
  ['4 トレード4（強制）', '次の人と 手札を伏せて、お互いに1枚 選んで 交換する（4を2枚なら 2枚、3枚なら 3枚）'],
  ['5 5飛び（強制）', '次の人を とばす（2枚なら 2人とばして 4番目の人の番）。一周して 自分に戻っても 場は流れず その人の番'],
  ['6 ケメゾディア', '手札に 6 が4枚 そろったら そのゲームの勝者'],
  ['7 7渡し（強制）', 'いらないカードを 次の人に渡す（出した枚数ぶん）'],
  ['8 8切り（強制）', '出した瞬間に 場が流れる。もう一度 出せる'],
  ['9 リビングデッドのケメナイン（任意）', '出したマークと同じ 6 を、墓地か 持っている人の手札から 回収できる（9を2枚なら 2つのマークの6。1枚だけでもよい）'],
  ['10 10捨て（強制）', '手札の好きなカードを 墓地に捨てる（出した枚数ぶん）'],
  ['J イレブンバック（強制）', '数字の強さが逆になり 3が一番強くなる（場が流れたら 元に戻る）'],
  ['Q クイーンリバース（強制）', '回る向きが 逆になる（2枚なら リバースのリバースで そのまま）'],
  ['K キングチャレンジ（強制）', '墓地をシャッフルし、一番上のマークを当てたら 手札を2枚 捨てられる（2枚なら 2回 チャレンジ）。一番上が ジョーカーなら 当たり'],
  ['A エースカウンター（任意）', '7渡しを受ける時、エースを捨てて 逆に相手へ1枚 渡せる。7を2枚出されたら エース2枚で 2枚 返せる（エースが1枚なら 1枚返して、残りの1枚は 受け取る）'],
  ['2', '効果なし'],
  ['ジョーカー（1枚）', '一番強い。2枚以上で出す時は ほかの数字の代わりになれる（9 以外）'],
  ['スペードの3', 'ジョーカー1枚の時は スペードの3だけ 出せる（しばり中でも 出せる）。出したら 場が流れて その人から'],
  ['上がり禁止', '8・ジョーカーだけでは 上がれない（ジョーカーを ほかのカードと 組み合わせれば 上がれる）'],
  ['階段しばり', '前の人の 続きの数字を出すと、場が流れるまで 続きの数字しか出せない（例：5→6 なら 次は 7 だけ）。2枚出しでも起きる。強さが逆の時は 弱い方へ（6→5 なら 次は 4）。ジョーカーは 出せる。同じマークなら マークしばりも かかる'],
  ['しばり', '前の人と 同じマークで出すと、場が流れるまで そのマークしか出せない（片しばりなし）'],
  ['階段', '同じマークの 続き数字 4枚だけ（革命になる）。ジョーカーも使える（9の代わりは だめ）。中のカードの効果は 出ない'],
  ['革命', '同じ数字4枚、または マークのそろった階段4枚で 強さが逆になる。革命を出した時は カードの効果は 出ない'],
  ['はじめ', 'ダイヤの3を 持っている人から'],
];

function renderRulesOver(parent: HTMLElement) {
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.style.zIndex = '40';
  el.innerHTML = `<div class="sheet"><h2 class="gold-text">ルール</h2><dl class="rules">${RULES.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl><button id="r-close">とじる</button></div>`;
  parent.appendChild(el);
  (el.querySelector('#r-close') as HTMLElement).onclick = () => {
    showRules = false;
    el.remove();
  };
}

const onTouch = () => {
  unlockAudio();
  tryPlayBgm();
};
document.addEventListener('pointerdown', onTouch, { passive: true });
document.addEventListener('touchend', onTouch, { passive: true });
// 横向きの時に出す案内（#app の外に置く）
const rotate = document.createElement('div');
rotate.id = 'rotate';
rotate.innerHTML = '<div class="ph"></div><div>スマホを 縦にして 遊んでください</div>';
document.body.appendChild(rotate);
window.addEventListener('resize', () => view && renderGame(view));
renderTitle();

// 確認用：?fxdemo=8切り で 発動演出だけ 出す
const fxDemo = new URLSearchParams(location.search).get('fxdemo');
if (fxDemo && THEMES[fxDemo]) showActivate(fxLayer(), fxDemo, cardHtml(cardFromId('S8')), () => {}, 1500);
