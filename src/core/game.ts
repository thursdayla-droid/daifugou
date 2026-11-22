// 大富豪のゲーム進行（親＝部屋を作った人の端末で動かす）
import { Card, Suit, SUITS, SUIT_MARK, cardLabel, makeDeck, mulberry32Step, rankLabel } from './cards';
import { Play, analyzePlay, canBeat, causesRevolution, isForbiddenFinish, legalPlays, makesBind, makesSeqBind } from './plays';

export interface PlayerState {
  name: string;
  cpu: boolean;
  hand: Card[];
  out: boolean; // 上がった・反則・ケメゾディアで抜けた
}

export type Pending =
  | { type: 'draw3'; player: number; options: Card[] | null; count: number } // null＝やるか聞いている。count：出した3の枚数（2026-11-22：2枚なら6枚見て2枚）
  | { type: 'trade'; a: number; b: number; step: 'a' | 'b'; orderB: string[]; orderA: string[]; pickA: string[]; count: number } // count：4を2枚なら2枚（2026-11-22）
  | { type: 'counter'; player: number; giver: number; count: number; max: number }
  | { type: 'counterGive'; player: number; to: number; count: number; rest: number }
  | { type: 'give7'; player: number; to: number; count: number }
  | { type: 'nine'; player: number; options: { cardId: string; from: 'grave' | number }[]; picked: number }
  | { type: 'ten'; player: number; count: number }
  | { type: 'king'; player: number }
  | { type: 'kingDiscard'; player: number; count: number };

export interface GameEvent {
  seq: number;
  kind: string; // 'play' 'pass' 'flow' 'effect' 'finish' 'foul' 'revolution' 'exodia' 'over' 'info'
  player?: number;
  title?: string; // 大きく出す文字
  text: string;
  cards?: string[];
  /** この人にだけ見せる */
  only?: number;
  /** カードの移動（画面で 動きを見せる） */
  move?: CardMove;
  /** 1枚を 大きく見せる（キングチャレンジの めくり） */
  reveal?: { card: string; caption: string };
}

/** 'grave'＝墓地、数字＝その人の手札 */
export type Place = 'grave' | number;
export interface CardMove {
  from: Place;
  to: Place;
  count: number;
  label: string;
  /** 見える人だけに 中身を見せる（なしなら 全員に見せる） */
  cards?: string[];
  vis?: number[];
}

export interface AfterPlay {
  actor: number;
  skip: number;
  cut: boolean;
  /** これから出す効果（階段は 弱い順に 1枚ずつ） */
  queue: EffectItem[];
}

export interface EffectItem {
  rank: number;
  count: number;
  suits: Suit[];
}

export interface GameState {
  rng: number;
  players: PlayerState[];
  turn: number;
  direction: 1 | -1;
  field: Play | null;
  fieldOwner: number | null;
  fieldPile: Card[];
  passed: boolean[];
  bind: Suit[] | null;
  seqBind: boolean;
  revolution: boolean;
  elevenBack: boolean;
  graveyard: Card[];
  pending: Pending | null;
  after: AfterPlay | null;
  finishOrder: number[];
  fouls: number[];
  over: boolean;
  ranking: number[] | null;
  exodia: number | null;
  events: GameEvent[];
  seq: number;
}

export type Action =
  | { type: 'play'; cards: string[] }
  | { type: 'pass' }
  | { type: 'pick'; cardId: string | null } // draw3 / nine
  | { type: 'decide'; use: boolean } // draw3 をやるか
  | { type: 'tradePick'; index?: number; indices?: number[] }
  | { type: 'counter'; use: boolean; n?: number } // n：使うエースの枚数（7と同じ枚数まで。2026-11-22）
  | { type: 'cards'; cards: string[] } // give7 / counterGive / ten / kingDiscard
  | { type: 'guess'; suit: Suit };

export const RANK_TITLES = ['大富豪', '富豪', '平民', '貧民', '大貧民'];
export function rankTitle(place: number, total: number): string {
  if (place === 0) return '大富豪';
  if (place === total - 1) return '大貧民';
  if (total >= 4 && place === 1) return '富豪';
  if (total >= 4 && place === total - 2) return '貧民';
  return '平民';
}

// ---------- 乱数 ----------
function rand(s: GameState): number {
  const [v, n] = mulberry32Step(s.rng);
  s.rng = n;
  return v;
}
function shuffle<T>(s: GameState, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 開始 ----------
export function newGame(players: { name: string; cpu: boolean }[], seed: number): GameState {
  const s: GameState = {
    rng: seed >>> 0,
    players: players.map((p) => ({ ...p, hand: [], out: false })),
    turn: 0,
    direction: 1,
    field: null,
    fieldOwner: null,
    fieldPile: [],
    passed: players.map(() => false),
    bind: null,
    seqBind: false,
    revolution: false,
    elevenBack: false,
    graveyard: [],
    pending: null,
    after: null,
    finishOrder: [],
    fouls: [],
    over: false,
    ranking: null,
    exodia: null,
    events: [],
    seq: 0,
  };
  const deck = shuffle(s, makeDeck());
  deck.forEach((c, i) => s.players[i % players.length].hand.push(c));
  const first = s.players.findIndex((p) => p.hand.some((c) => c.id === 'D3'));
  s.turn = first;
  log(s, { kind: 'info', player: first, text: `${s.players[first].name} が ♦3 を持っているので 先に出します` });
  checkExodia(s);
  if (!s.over) beginTurn(s);
  return s;
}

function log(s: GameState, e: Omit<GameEvent, 'seq'>) {
  s.seq++;
  s.events.push({ ...e, seq: s.seq });
  if (s.events.length > 60) s.events.splice(0, s.events.length - 60);
}

const nm = (s: GameState, i: number) => s.players[i].name;

export function activeCount(s: GameState): number {
  return s.players.filter((p) => !p.out).length;
}

export function nextActive(s: GameState, from: number, dir: 1 | -1 = s.direction): number {
  const n = s.players.length;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n;
    if (!s.players[i].out) return i;
  }
  return from;
}

function removeCards(hand: Card[], ids: string[]): Card[] {
  const taken: Card[] = [];
  for (const id of ids) {
    const k = hand.findIndex((c) => c.id === id);
    if (k >= 0) taken.push(...hand.splice(k, 1));
  }
  return taken;
}

function hasAll(hand: Card[], ids: string[]): boolean {
  return new Set(ids).size === ids.length && ids.every((id) => hand.some((c) => c.id === id));
}

// ---------- ケメゾディア（6が4枚） ----------
function checkExodia(s: GameState): boolean {
  if (s.over) return true;
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (p.out) continue;
    const sixes = p.hand.filter((c) => c.rank === 6).length;
    if (sixes >= 4) {
      s.exodia = i;
      log(s, { kind: 'exodia', player: i, title: 'ケメゾディア！', text: `${nm(s, i)} の手札に 6 が4枚そろった！`, cards: ['S6', 'H6', 'D6', 'C6'] });
      const rest = s.players
        .map((_, k) => k)
        .filter((k) => k !== i && !s.players[k].out)
        .sort((a, b) => s.players[a].hand.length - s.players[b].hand.length);
      endGame(s, [i, ...s.finishOrder, ...rest, ...[...s.fouls].reverse()]);
      return true;
    }
  }
  return false;
}

function endGame(s: GameState, ranking: number[]) {
  s.over = true;
  s.pending = null;
  s.after = null;
  s.ranking = ranking;
  log(s, { kind: 'over', text: 'ゲーム終了' });
}

function checkFinishes(s: GameState, first: number) {
  const order = [first, ...s.players.map((_, i) => i).filter((i) => i !== first)];
  for (const i of order) {
    const p = s.players[i];
    if (!p.out && p.hand.length === 0) {
      p.out = true;
      s.finishOrder.push(i);
      log(s, { kind: 'finish', player: i, title: `${s.finishOrder.length}位 上がり！`, text: `${nm(s, i)} が 上がり！（${s.finishOrder.length}位）` });
    }
  }
  if (activeCount(s) <= 1 && !s.over) {
    const last = s.players.findIndex((p) => !p.out);
    if (last >= 0) {
      s.players[last].out = true;
    }
    endGame(s, [...s.finishOrder, ...(last >= 0 ? [last] : []), ...[...s.fouls].reverse()]);
  }
}

function clearField(s: GameState, why: string) {
  const cards = [...s.fieldPile, ...(s.field ? s.field.cards : [])];
  s.graveyard.push(...cards);
  s.field = null;
  s.fieldOwner = null;
  s.fieldPile = [];
  s.bind = null;
  s.seqBind = false;
  s.passed = s.players.map(() => false);
  log(s, { kind: 'flow', text: why });
  // イレブンバックは 場が流れたら終わり（2026-11-22 決定）
  if (s.elevenBack) {
    s.elevenBack = false;
    log(s, { kind: 'effect', text: 'イレブンバック終了。数字の強さが 元に戻りました' });
  }
}

/** 親番で 出せるカードが1つもない（8・ジョーカーしかない等）なら 反則負け */
function beginTurn(s: GameState) {
  for (let guard = 0; guard < 20 && !s.over; guard++) {
    if (s.field) return;
    const p = s.players[s.turn];
    if (p.out) {
      s.turn = nextActive(s, s.turn);
      continue;
    }
    if (legalPlays(fieldCtx(s), p.hand).length > 0) return;
    // 反則負け
    p.out = true;
    s.fouls.push(s.turn);
    log(s, { kind: 'foul', player: s.turn, title: '反則負け', text: `${p.name} は 8・ジョーカーでしか上がれないので 反則負け` });
    s.graveyard.push(...p.hand.splice(0));
    if (activeCount(s) <= 1) {
      const last = s.players.findIndex((q) => !q.out);
      if (last >= 0) s.players[last].out = true;
      endGame(s, [...s.finishOrder, ...(last >= 0 ? [last] : []), ...[...s.fouls].reverse()]);
      return;
    }
    s.turn = nextActive(s, s.turn);
  }
}

export function fieldCtx(s: GameState) {
  return { field: s.field, bind: s.bind, seqBind: s.seqBind, revolution: s.revolution, elevenBack: s.elevenBack };
}

/** いま 誰の入力を待っているか */
export function waitingFor(s: GameState): number | null {
  if (s.over) return null;
  const p = s.pending;
  if (!p) return s.turn;
  if (p.type === 'trade') return p.step === 'a' ? p.a : p.b;
  return p.player;
}

// ---------- 入力 ----------
export function apply(s: GameState, who: number, a: Action): string | null {
  if (s.over) return 'ゲームは終わっています';
  if (waitingFor(s) !== who) return 'あなたの番ではありません';
  if (s.pending) return applyPending(s, who, a);
  if (a.type === 'pass') return doPass(s, who);
  if (a.type === 'play') return doPlay(s, who, a.cards);
  return '今はできません';
}

function doPass(s: GameState, who: number): string | null {
  if (!s.field) return '場が空のときはパスできません';
  s.passed[who] = true;
  log(s, { kind: 'pass', player: who, text: `${nm(s, who)} パス` });
  const owner = s.fieldOwner!;
  const others = s.players.map((_, i) => i).filter((i) => !s.players[i].out && i !== owner);
  if (others.every((i) => s.passed[i])) {
    clearField(s, '全員パス。場が流れました');
    s.turn = s.players[owner].out ? nextActive(s, owner) : owner;
    beginTurn(s);
  } else {
    s.turn = nextActive(s, who);
  }
  return null;
}

function doPlay(s: GameState, who: number, ids: string[]): string | null {
  const p = s.players[who];
  if (!hasAll(p.hand, ids)) return 'そのカードは持っていません';
  const cards = ids.map((id) => p.hand.find((c) => c.id === id)!);
  const play = analyzePlay(cards);
  if (!play) return 'その組み合わせは出せません';
  if (!canBeat(fieldCtx(s), play)) return '場のカードより強くないと出せません';
  if (isForbiddenFinish(play, p.hand.length)) return '8・ジョーカーでは上がれません';
  removeCards(p.hand, ids);
  const prev = s.field;
  if (prev) s.fieldPile.push(...prev.cards);
  s.field = play;
  s.fieldOwner = who;
  s.passed = s.players.map(() => false);
  log(s, { kind: 'play', player: who, text: `${nm(s, who)}：${cards.map(cardLabel).join(' ')}`, cards: ids });
  if (prev && !s.seqBind && makesSeqBind(s, prev, play)) {
    s.seqBind = true;
    log(s, { kind: 'effect', title: '階段しばり', text: '階段しばり！ 次は 続きの数字しか 出せません' });
  }
  if (prev && !s.bind) {
    const b = makesBind(prev, play);
    if (b) {
      s.bind = b;
      log(s, { kind: 'effect', title: 'マークしばり', text: `マークしばり（${b.map((x) => SUIT_MARK[x]).join('')}）` });
    }
  }
  if (causesRevolution(play)) {
    s.revolution = !s.revolution;
    log(s, { kind: 'revolution', player: who, title: s.revolution ? '革命！' : '革命返し！', text: s.revolution ? '革命！ 強さが逆になります' : '革命返し！' });
  }
  s.after = { actor: who, skip: 0, cut: false, queue: effectQueue(play) };
  runEffects(s);
  return null;
}

/** 効果の順番。ジョーカーだけの時は なし【仮】。階段は 弱い順に 1枚ずつ（2026-11-22 決定：階段も効果あり） */
function effectQueue(play: Play): EffectItem[] {
  if (play.jokerOnly) return [];
  // 階段（革命の4枚）は 効果なし（2026-11-22 依頼者）
  if (play.kind === 'stair') return [];
  // キングチャレンジは 出した枚数ぶん チャレンジ（2026-11-22 決定）
  if (play.rank === 13) return play.cards.map(() => ({ rank: 13, count: 1, suits: [] }));
  return [{ rank: play.rank, count: play.count, suits: play.suits }];
}

function runEffects(s: GameState) {
  const a = s.after;
  while (a && a.queue.length && !s.pending && !s.over) {
    startEffects(s, a.actor, a.queue.shift()!);
  }
  if (!s.pending && !s.over) finishAfter(s);
}

function startEffects(s: GameState, who: number, play: EffectItem) {
  const n = play.count;
  const me = s.players[who];
  const after = s.after!;
  switch (play.rank) {
    case 3: {
      if (s.graveyard.length === 0 || me.out) return;
      log(s, { kind: 'effect', player: who, title: 'ドロー3', text: `${nm(s, who)} が ドロー3を 使うか 選んでいます` });
      s.pending = { type: 'draw3', player: who, options: null, count: n };
      return;
    }
    case 4: {
      const b = nextActive(s, who);
      if (me.hand.length === 0 || b === who || s.players[b].hand.length === 0) return;
      const tn = Math.min(n, me.hand.length, s.players[b].hand.length);
      log(s, { kind: 'effect', player: who, title: 'トレード4', text: `${nm(s, who)} と ${nm(s, b)} が ${tn}枚ずつ交換` });
      s.pending = { type: 'trade', a: who, b, step: 'a', orderB: shuffle(s, s.players[b].hand.map((c) => c.id)), orderA: [], pickA: [], count: tn };
      return;
    }
    case 5:
      after.skip = n;
      log(s, { kind: 'effect', player: who, title: '5飛び', text: `次の ${n}人 を とばします` });
      return;
    case 7: {
      const to = nextActive(s, who);
      const count = Math.min(n, me.hand.length);
      if (count === 0 || to === who) return;
      log(s, { kind: 'effect', player: who, title: '7渡し', text: `${nm(s, who)} が ${nm(s, to)} に ${count}枚 渡します` });
      const hasAce = s.players[to].hand.some((c) => c.rank === 1);
      const aces = s.players[to].hand.filter((c) => c.rank === 1).length;
      s.pending = hasAce ? { type: 'counter', player: to, giver: who, count, max: Math.min(aces, count) } : { type: 'give7', player: who, to, count };
      return;
    }
    case 8:
      after.cut = true;
      log(s, { kind: 'effect', player: who, title: '8切り', text: '場が流れます' });
      return;
    case 9: {
      const suits = [...new Set(play.suits)];
      const options: { cardId: string; from: 'grave' | number }[] = [];
      for (const su of suits) {
        const id = `${su}6`;
        if (s.graveyard.some((c) => c.id === id)) options.push({ cardId: id, from: 'grave' });
        else {
          const holder = s.players.findIndex((pp, i) => i !== who && pp.hand.some((c) => c.id === id));
          if (holder >= 0) options.push({ cardId: id, from: holder });
        }
      }
      if (options.length === 0) return;
      log(s, { kind: 'effect', player: who, title: 'リビングデッドのケメナイン', text: `${nm(s, who)} は 6 を回収できます` });
      s.pending = { type: 'nine', player: who, options, picked: 0 };
      return;
    }
    case 10: {
      const count = Math.min(n, me.hand.length);
      if (count === 0) return;
      log(s, { kind: 'effect', player: who, title: '10捨て', text: `${nm(s, who)} が ${count}枚 捨てます` });
      s.pending = { type: 'ten', player: who, count };
      return;
    }
    case 11:
      s.elevenBack = !s.elevenBack;
      log(s, { kind: 'effect', player: who, title: 'イレブンバック', text: s.elevenBack ? '数字の強さが逆に！（3が一番強い）' : '数字の強さが 元に戻りました' });
      return;
    case 12:
      // 2枚なら リバースのリバースで そのまま（2026-11-22 決定）
      if (n % 2 === 1) s.direction = s.direction === 1 ? -1 : 1;
      log(s, { kind: 'effect', player: who, title: 'クイーンリバース', text: n % 2 === 1 ? '回る向きが 逆になりました' : 'リバースのリバースで 向きは そのまま' });
      return;
    case 13: {
      if (s.graveyard.length === 0 || me.hand.length === 0) return;
      log(s, { kind: 'effect', player: who, title: 'キングチャレンジ', text: `${nm(s, who)} が 墓地の一番上のマークを当てます` });
      s.pending = { type: 'king', player: who };
      return;
    }
  }
}

function finishAfter(s: GameState) {
  const a = s.after;
  s.after = null;
  if (!a || s.over) return;
  if (checkExodia(s)) return;
  checkFinishes(s, a.actor);
  if (s.over) return;
  if (a.cut) {
    clearField(s, '8切りで 場が流れました');
    s.turn = s.players[a.actor].out ? nextActive(s, a.actor) : a.actor;
    beginTurn(s);
    return;
  }
  let t = a.actor;
  for (let k = 0; k <= a.skip; k++) {
    t = nextActive(s, t);
    if (k < a.skip && t !== a.actor && !s.players[t].out) log(s, { kind: 'info', player: t, text: `${nm(s, t)} は とばされました` });
  }
  if (t === s.fieldOwner && !s.players[t].out) {
    clearField(s, '場が流れました');
    s.turn = t;
    beginTurn(s);
    return;
  }
  // 場を出した人が上がっていて、ほかの全員がもう回った場合
  s.turn = t;
}

function applyPending(s: GameState, who: number, a: Action): string | null {
  const pd = s.pending!;
  const me = s.players[who];
  switch (pd.type) {
    case 'draw3': {
      // まず やるか やらないか。やるなら 必ず1枚 取る（2026-11-22 決定）
      if (!pd.options) {
        if (a.type !== 'decide') return 'やるか 選んでください';
        if (!a.use) {
          log(s, { kind: 'effect', player: who, text: `${nm(s, who)} は ドロー3を 使いませんでした` });
          break;
        }
        pd.options = shuffle(s, s.graveyard).slice(0, 3 * pd.count);
        log(s, { kind: 'effect', player: who, text: `${nm(s, who)} は 墓地から${pd.options.length}枚 見ています` });
        return null;
      }
      const need = Math.min(pd.count, pd.options.length);
      const ids = a.type === 'pick' && a.cardId ? [a.cardId] : a.type === 'cards' ? a.cards : [];
      if (ids.length !== need || new Set(ids).size !== need) return `${need}枚 選んでください`;
      if (!ids.every((id) => pd.options!.some((c) => c.id === id) && s.graveyard.some((c) => c.id === id))) return 'そのカードは選べません';
      const got = removeCards(s.graveyard, ids);
      me.hand.push(...got);
      log(s, { kind: 'effect', player: who, text: `${nm(s, who)} は 墓地から${got.length}枚 手札に加えました` });
      log(s, { kind: 'info', only: who, text: `手札に加えた：${got.map(cardLabel).join(' ')}`, cards: ids });
      log(s, { kind: 'move', text: '', move: { from: 'grave', to: who, count: got.length, label: 'ドロー3', cards: ids, vis: [who] } });
      break;
    }
    case 'trade': {
      if (a.type !== 'tradePick') return '選んでください';
      const idx = a.indices ?? (a.index !== undefined ? [a.index] : []);
      if (idx.length !== pd.count || new Set(idx).size !== pd.count) return `${pd.count}枚 選んでください`;
      const order = pd.step === 'a' ? pd.orderB : pd.orderA;
      const ids = idx.map((i) => order[i]);
      if (ids.some((id) => !id)) return '選んでください';
      if (pd.step === 'a') {
        pd.pickA = ids;
        pd.step = 'b';
        pd.orderA = shuffle(s, s.players[pd.a].hand.map((c) => c.id));
        return null;
      }
      const fromB = removeCards(s.players[pd.b].hand, pd.pickA);
      const fromA = removeCards(s.players[pd.a].hand, ids);
      s.players[pd.a].hand.push(...fromB);
      s.players[pd.b].hand.push(...fromA);
      const L = (cs: Card[]) => cs.map(cardLabel).join(' ');
      log(s, { kind: 'effect', text: `${nm(s, pd.a)} と ${nm(s, pd.b)} が ${fromB.length}枚ずつ 交換しました` });
      log(s, { kind: 'info', only: pd.a, text: `もらったカード：${L(fromB)}（渡したカード：${L(fromA)}）`, cards: fromB.map((c) => c.id) });
      log(s, { kind: 'info', only: pd.b, text: `もらったカード：${L(fromA)}（渡したカード：${L(fromB)}）`, cards: fromA.map((c) => c.id) });
      log(s, { kind: 'move', text: '', move: { from: pd.b, to: pd.a, count: fromB.length, label: 'トレード4', cards: fromB.map((c) => c.id), vis: [pd.a, pd.b] } });
      log(s, { kind: 'move', text: '', move: { from: pd.a, to: pd.b, count: fromA.length, label: 'トレード4', cards: fromA.map((c) => c.id), vis: [pd.a, pd.b] } });
      break;
    }
    case 'counter': {
      if (a.type !== 'counter') return '選んでください';
      const n = a.use ? Math.max(1, Math.min(a.n ?? 1, pd.max)) : 0;
      if (n > 0) {
        // 7を2枚なら エース2枚で 2枚カウンター。エースが足りない分は 7を出した人から そのまま受け取る
        const aces = me.hand.filter((c) => c.rank === 1).slice(0, n);
        if (aces.length < n) return 'エースが足りません';
        removeCards(me.hand, aces.map((c) => c.id));
        s.graveyard.push(...aces);
        log(s, { kind: 'effect', player: who, title: 'エースカウンター', text: `${nm(s, who)} が エースカウンター！ ${aces.map(cardLabel).join(' ')} を捨てて 逆に${n}枚 渡します`, cards: aces.map((c) => c.id) });
        log(s, { kind: 'move', text: '', move: { from: who, to: 'grave', count: n, label: 'エースカウンター', cards: aces.map((c) => c.id) } });
        const rest = pd.count - n;
        if (me.hand.length > 0) {
          s.pending = { type: 'counterGive', player: who, to: pd.giver, count: Math.min(n, me.hand.length), rest };
          return null;
        }
        if (rest > 0 && s.players[pd.giver].hand.length > 0) {
          s.pending = { type: 'give7', player: pd.giver, to: who, count: Math.min(rest, s.players[pd.giver].hand.length) };
          return null;
        }
        break;
      }
      s.pending = { type: 'give7', player: pd.giver, to: who, count: pd.count };
      return null;
    }
    case 'counterGive':
    case 'give7':
    case 'ten':
    case 'kingDiscard': {
      if (a.type !== 'cards') return 'カードを選んでください';
      const need = pd.count;
      if (a.cards.length !== Math.min(need, me.hand.length)) return `${need}枚 選んでください`;
      if (!hasAll(me.hand, a.cards)) return 'そのカードは持っていません';
      const taken = removeCards(me.hand, a.cards);
      if (pd.type === 'give7' || pd.type === 'counterGive') {
        s.players[pd.to].hand.push(...taken);
        log(s, { kind: 'effect', player: who, text: `${nm(s, who)} が ${nm(s, pd.to)} に ${taken.length}枚 渡しました` });
        log(s, { kind: 'info', only: pd.to, text: `${nm(s, who)} から もらった：${taken.map(cardLabel).join(' ')}`, cards: taken.map((c) => c.id) });
        log(s, { kind: 'move', text: '', move: { from: who, to: pd.to, count: taken.length, label: pd.type === 'give7' ? '7渡し' : 'エースカウンター', cards: taken.map((c) => c.id), vis: [who, pd.to] } });
        // カウンターで 返しきれなかった分は 7を出した人から 受け取る
        if (pd.type === 'counterGive' && pd.rest > 0 && me.hand.length > 0 && s.players[pd.to].hand.length > 0) {
          s.pending = { type: 'give7', player: pd.to, to: who, count: Math.min(pd.rest, s.players[pd.to].hand.length) };
          return null;
        }
      } else {
        s.graveyard.push(...taken);
        log(s, { kind: 'effect', player: who, text: `${nm(s, who)} が ${taken.map(cardLabel).join(' ')} を 捨てました`, cards: taken.map((c) => c.id) });
        log(s, { kind: 'move', text: '', move: { from: who, to: 'grave', count: taken.length, label: pd.type === 'ten' ? '10捨て' : 'キングチャレンジ', cards: taken.map((c) => c.id) } });
      }
      break;
    }
    case 'nine': {
      if (a.type !== 'pick') return '選んでください';
      if (a.cardId) {
        const opt = pd.options.find((o) => o.cardId === a.cardId);
        if (!opt) return 'そのカードは選べません';
        const src = opt.from === 'grave' ? s.graveyard : s.players[opt.from].hand;
        const k = src.findIndex((c) => c.id === a.cardId);
        if (k >= 0) {
          me.hand.push(...src.splice(k, 1));
          const fromTxt = opt.from === 'grave' ? '墓地' : `${nm(s, opt.from)} の手札`;
          log(s, { kind: 'effect', player: who, text: `${nm(s, who)} が ${fromTxt} から ${cardLabel(cardOf(a.cardId))} を 回収！`, cards: [a.cardId] });
          log(s, { kind: 'move', text: '', move: { from: opt.from, to: who, count: 1, label: 'ケメナイン', cards: [a.cardId] } });
        }
        // 9を2枚以上なら 残りのマークの6も 続けて回収できる（1枚だけでもよい）
        pd.options = pd.options.filter((o) => o.cardId !== a.cardId);
        pd.picked++;
        if (checkExodia(s)) return null;
        if (pd.options.length > 0) return null;
      } else if (pd.picked === 0) log(s, { kind: 'effect', player: who, text: `${nm(s, who)} は 回収しませんでした` });
      break;
    }
    case 'king': {
      if (a.type !== 'guess' || !SUITS.includes(a.suit)) return 'マークを選んでください';
      s.graveyard = shuffle(s, s.graveyard);
      const top = s.graveyard[s.graveyard.length - 1];
      // ジョーカーが一番上なら 当たり扱い（2026-11-22 依頼者）
      const hit = top.suit === a.suit || top.rank === 0;
      log(s, {
        kind: 'effect',
        player: who,
        title: hit ? '当たり！' : 'はずれ…',
        text: `${nm(s, who)} の予想 ${SUIT_MARK[a.suit]} → 一番上は ${cardLabel(top)}。${hit ? '当たり！ 2枚捨てられます' : 'はずれ'}`,
        cards: [top.id],
        reveal: { card: top.id, caption: `${nm(s, who)} の予想 ${SUIT_MARK[a.suit]}　→　${hit ? '当たり！' : 'はずれ…'}` },
      });
      if (hit && me.hand.length > 0) {
        s.pending = { type: 'kingDiscard', player: who, count: Math.min(2, me.hand.length) };
        return null;
      }
      break;
    }
  }
  s.pending = null;
  if (checkExodia(s)) return null;
  runEffects(s);
  return null;
}

function cardOf(id: string): Card {
  return id.startsWith('JK') ? { id, rank: 0, suit: null } : { id, rank: Number(id.slice(1)), suit: id[0] as Suit };
}

// ---------- 見える情報だけにする（オンライン用） ----------
export interface PlayerView {
  me: number;
  players: { name: string; cpu: boolean; count: number; out: boolean; passed: boolean }[];
  hand: Card[];
  turn: number;
  waiting: number | null;
  direction: 1 | -1;
  field: Play | null;
  fieldOwner: number | null;
  bind: Suit[] | null;
  seqBind: boolean;
  revolution: boolean;
  elevenBack: boolean;
  graveyardCount: number;
  pending: ViewPending | null;
  over: boolean;
  ranking: number[] | null;
  exodia: number | null;
  events: GameEvent[];
}

export type ViewPending =
  | { type: 'draw3'; player: number; asking: boolean; options: Card[] | null; count: number }
  | { type: 'trade'; player: number; other: number; count: number; need: number }
  | { type: 'counter'; player: number; giver: number; count: number; max: number }
  | { type: 'counterGive'; player: number; to: number; count: number; rest: number }
  | { type: 'give7'; player: number; to: number; count: number }
  | { type: 'nine'; player: number; options: { cardId: string; from: 'grave' | number }[]; picked: number }
  | { type: 'ten'; player: number; count: number }
  | { type: 'king'; player: number }
  | { type: 'kingDiscard'; player: number; count: number };

export function viewFor(s: GameState, me: number): PlayerView {
  let pending: ViewPending | null = null;
  const pd = s.pending;
  if (pd) {
    if (pd.type === 'draw3') pending = { type: 'draw3', player: pd.player, asking: !pd.options, options: pd.player === me ? pd.options : null, count: Math.min(pd.count, pd.options?.length ?? pd.count) };
    else if (pd.type === 'trade') {
      const player = pd.step === 'a' ? pd.a : pd.b;
      const other = pd.step === 'a' ? pd.b : pd.a;
      pending = { type: 'trade', player, other, count: pd.step === 'a' ? pd.orderB.length : pd.orderA.length, need: pd.count };
    } else pending = pd as ViewPending;
  }
  return {
    me,
    players: s.players.map((p, i) => ({ name: p.name, cpu: p.cpu, count: p.hand.length, out: p.out, passed: s.passed[i] })),
    hand: s.players[me].hand,
    turn: s.turn,
    waiting: waitingFor(s),
    direction: s.direction,
    field: s.field,
    fieldOwner: s.fieldOwner,
    bind: s.bind,
    seqBind: s.seqBind,
    revolution: s.revolution,
    elevenBack: s.elevenBack,
    graveyardCount: s.graveyard.length,
    pending,
    over: s.over,
    ranking: s.ranking,
    exodia: s.exodia,
    events: s.events
      .filter((e) => e.only === undefined || e.only === me)
      .slice(-30)
      .map((e) => (e.move?.vis && !e.move.vis.includes(me) ? { ...e, move: { ...e.move, cards: undefined } } : e)),
  };
}

export { rankLabel };
