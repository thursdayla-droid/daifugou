// 大富豪のゲーム進行（親＝部屋を作った人の端末で動かす）
import { Card, Suit, SUITS, SUIT_MARK, cardLabel, makeDeck, mulberry32Step, rankLabel } from './cards';
import { Play, analyzePlay, canBeat, causesRevolution, isForbiddenFinish, legalPlays, makesBind } from './plays';

export interface PlayerState {
  name: string;
  cpu: boolean;
  hand: Card[];
  out: boolean; // 上がった・反則・エクゾディアで抜けた
}

export type Pending =
  | { type: 'draw3'; player: number; options: Card[] }
  | { type: 'trade'; a: number; b: number; step: 'a' | 'b'; orderB: string[]; orderA: string[]; pickA: string | null }
  | { type: 'counter'; player: number; giver: number; count: number }
  | { type: 'counterGive'; player: number; to: number }
  | { type: 'give7'; player: number; to: number; count: number }
  | { type: 'nine'; player: number; options: { cardId: string; from: 'grave' | number }[] }
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
}

export interface AfterPlay {
  actor: number;
  skip: number;
  cut: boolean;
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
  | { type: 'tradePick'; index: number }
  | { type: 'counter'; use: boolean }
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

// ---------- エクゾディア（6が4枚） ----------
function checkExodia(s: GameState): boolean {
  if (s.over) return true;
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (p.out) continue;
    const sixes = p.hand.filter((c) => c.rank === 6).length;
    if (sixes >= 4) {
      s.exodia = i;
      log(s, { kind: 'exodia', player: i, title: 'エクゾディア！', text: `${nm(s, i)} の手札に 6 が4枚そろった！`, cards: ['S6', 'H6', 'D6', 'C6'] });
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
  s.passed = s.players.map(() => false);
  log(s, { kind: 'flow', text: why });
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
  return { field: s.field, bind: s.bind, revolution: s.revolution, elevenBack: s.elevenBack };
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
  if (prev && !s.bind) {
    const b = makesBind(prev, play);
    if (b) {
      s.bind = b;
      log(s, { kind: 'effect', title: 'しばり', text: `マークしばり（${b.map((x) => SUIT_MARK[x]).join('')}）` });
    }
  }
  if (causesRevolution(play)) {
    s.revolution = !s.revolution;
    log(s, { kind: 'revolution', player: who, title: s.revolution ? '革命！' : '革命返し！', text: s.revolution ? '革命！ 強さが逆になります' : '革命返し！' });
  }
  s.after = { actor: who, skip: 0, cut: false };
  startEffects(s, who, play);
  if (!s.pending) finishAfter(s);
  return null;
}

function startEffects(s: GameState, who: number, play: Play) {
  if (play.kind === 'stair' || play.jokerOnly) return; // 【仮】階段・ジョーカーだけは 効果なし
  const n = play.count;
  const me = s.players[who];
  const after = s.after!;
  switch (play.rank) {
    case 3: {
      if (s.graveyard.length === 0 || me.out) return;
      const options = shuffle(s, s.graveyard).slice(0, 3);
      log(s, { kind: 'effect', player: who, title: 'ドロースリー', text: `${nm(s, who)} は 墓地から3枚 見ています` });
      s.pending = { type: 'draw3', player: who, options };
      return;
    }
    case 4: {
      const b = nextActive(s, who);
      if (me.hand.length === 0 || b === who || s.players[b].hand.length === 0) return;
      log(s, { kind: 'effect', player: who, title: 'トレードフォー', text: `${nm(s, who)} と ${nm(s, b)} が 1枚ずつ交換` });
      s.pending = { type: 'trade', a: who, b, step: 'a', orderB: shuffle(s, s.players[b].hand.map((c) => c.id)), orderA: [], pickA: null };
      return;
    }
    case 5:
      after.skip = n;
      log(s, { kind: 'effect', player: who, title: 'ゴ飛び', text: `次の ${n}人 を とばします` });
      return;
    case 7: {
      const to = nextActive(s, who);
      const count = Math.min(n, me.hand.length);
      if (count === 0 || to === who) return;
      log(s, { kind: 'effect', player: who, title: 'ナナ渡し', text: `${nm(s, who)} が ${nm(s, to)} に ${count}枚 渡します` });
      const hasAce = s.players[to].hand.some((c) => c.rank === 1);
      s.pending = hasAce ? { type: 'counter', player: to, giver: who, count } : { type: 'give7', player: who, to, count };
      return;
    }
    case 8:
      after.cut = true;
      log(s, { kind: 'effect', player: who, title: 'ヤ切り', text: '場が流れます' });
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
      log(s, { kind: 'effect', player: who, title: 'リビングデッドのエクナイン', text: `${nm(s, who)} は 6 を回収できます` });
      s.pending = { type: 'nine', player: who, options };
      return;
    }
    case 10: {
      const count = Math.min(n, me.hand.length);
      if (count === 0) return;
      log(s, { kind: 'effect', player: who, title: 'ジュ捨て', text: `${nm(s, who)} が ${count}枚 捨てます` });
      s.pending = { type: 'ten', player: who, count };
      return;
    }
    case 11:
      s.elevenBack = !s.elevenBack;
      log(s, { kind: 'effect', player: who, title: 'イレブンバック', text: s.elevenBack ? '数字の強さが逆に！（3が一番強い）' : '数字の強さが 元に戻りました' });
      return;
    case 12:
      s.direction = s.direction === 1 ? -1 : 1;
      log(s, { kind: 'effect', player: who, title: 'クイーンリバース', text: '回る向きが 逆になりました' });
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
    clearField(s, 'ヤ切りで 場が流れました');
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
      if (a.type !== 'pick') return '選んでください';
      if (a.cardId) {
        const k = s.graveyard.findIndex((c) => c.id === a.cardId);
        if (k < 0 || !pd.options.some((c) => c.id === a.cardId)) return 'そのカードは選べません';
        me.hand.push(...s.graveyard.splice(k, 1));
        log(s, { kind: 'effect', player: who, text: `${nm(s, who)} は 墓地から1枚 手札に加えました` });
        log(s, { kind: 'info', only: who, text: `手札に加えた：${cardLabel(cardOf(a.cardId))}`, cards: [a.cardId] });
      } else log(s, { kind: 'effect', player: who, text: `${nm(s, who)} は 何も取りませんでした` });
      break;
    }
    case 'trade': {
      if (a.type !== 'tradePick') return '選んでください';
      if (pd.step === 'a') {
        const id = pd.orderB[a.index];
        if (!id) return '選んでください';
        pd.pickA = id;
        pd.step = 'b';
        pd.orderA = shuffle(s, s.players[pd.a].hand.map((c) => c.id));
        return null;
      }
      const idB = pd.orderA[a.index];
      if (!idB) return '選んでください';
      const fromB = removeCards(s.players[pd.b].hand, [pd.pickA!]);
      const fromA = removeCards(s.players[pd.a].hand, [idB]);
      s.players[pd.a].hand.push(...fromB);
      s.players[pd.b].hand.push(...fromA);
      log(s, { kind: 'effect', text: `${nm(s, pd.a)} と ${nm(s, pd.b)} が 1枚ずつ 交換しました` });
      log(s, { kind: 'info', only: pd.a, text: `もらったカード：${cardLabel(fromB[0])}（渡したカード：${cardLabel(fromA[0])}）`, cards: [fromB[0].id] });
      log(s, { kind: 'info', only: pd.b, text: `もらったカード：${cardLabel(fromA[0])}（渡したカード：${cardLabel(fromB[0])}）`, cards: [fromA[0].id] });
      break;
    }
    case 'counter': {
      if (a.type !== 'counter') return '選んでください';
      if (a.use) {
        const ace = me.hand.find((c) => c.rank === 1);
        if (!ace) return 'エースがありません';
        removeCards(me.hand, [ace.id]);
        s.graveyard.push(ace);
        log(s, { kind: 'effect', player: who, title: 'エースカウンター', text: `${nm(s, who)} が エースカウンター！ ${cardLabel(ace)} を捨てて 逆に1枚 渡します`, cards: [ace.id] });
        if (me.hand.length > 0) {
          s.pending = { type: 'counterGive', player: who, to: pd.giver };
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
      const need = pd.type === 'counterGive' ? 1 : pd.count;
      if (a.cards.length !== Math.min(need, me.hand.length)) return `${need}枚 選んでください`;
      if (!hasAll(me.hand, a.cards)) return 'そのカードは持っていません';
      const taken = removeCards(me.hand, a.cards);
      if (pd.type === 'give7' || pd.type === 'counterGive') {
        s.players[pd.to].hand.push(...taken);
        log(s, { kind: 'effect', player: who, text: `${nm(s, who)} が ${nm(s, pd.to)} に ${taken.length}枚 渡しました` });
        log(s, { kind: 'info', only: pd.to, text: `${nm(s, who)} から もらった：${taken.map(cardLabel).join(' ')}`, cards: taken.map((c) => c.id) });
      } else {
        s.graveyard.push(...taken);
        log(s, { kind: 'effect', player: who, text: `${nm(s, who)} が ${taken.map(cardLabel).join(' ')} を 捨てました`, cards: taken.map((c) => c.id) });
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
        }
      } else log(s, { kind: 'effect', player: who, text: `${nm(s, who)} は 回収しませんでした` });
      break;
    }
    case 'king': {
      if (a.type !== 'guess' || !SUITS.includes(a.suit)) return 'マークを選んでください';
      s.graveyard = shuffle(s, s.graveyard);
      const top = s.graveyard[s.graveyard.length - 1];
      const hit = top.suit === a.suit;
      log(s, {
        kind: 'effect',
        player: who,
        title: hit ? '当たり！' : 'はずれ…',
        text: `${nm(s, who)} の予想 ${SUIT_MARK[a.suit]} → 一番上は ${cardLabel(top)}。${hit ? '当たり！ 2枚捨てられます' : 'はずれ'}`,
        cards: [top.id],
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
  finishAfter(s);
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
  | { type: 'draw3'; player: number; options: Card[] | null }
  | { type: 'trade'; player: number; other: number; count: number }
  | { type: 'counter'; player: number; giver: number; count: number }
  | { type: 'counterGive'; player: number; to: number }
  | { type: 'give7'; player: number; to: number; count: number }
  | { type: 'nine'; player: number; options: { cardId: string; from: 'grave' | number }[] }
  | { type: 'ten'; player: number; count: number }
  | { type: 'king'; player: number }
  | { type: 'kingDiscard'; player: number; count: number };

export function viewFor(s: GameState, me: number): PlayerView {
  let pending: ViewPending | null = null;
  const pd = s.pending;
  if (pd) {
    if (pd.type === 'draw3') pending = { type: 'draw3', player: pd.player, options: pd.player === me ? pd.options : null };
    else if (pd.type === 'trade') {
      const player = pd.step === 'a' ? pd.a : pd.b;
      const other = pd.step === 'a' ? pd.b : pd.a;
      pending = { type: 'trade', player, other, count: pd.step === 'a' ? pd.orderB.length : pd.orderA.length };
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
    revolution: s.revolution,
    elevenBack: s.elevenBack,
    graveyardCount: s.graveyard.length,
    pending,
    over: s.over,
    ranking: s.ranking,
    exodia: s.exodia,
    events: s.events
      .filter((e) => e.only === undefined || e.only === me)
      .slice(-30),
  };
}

export { rankLabel };
