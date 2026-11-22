// 出し方（1枚・同じ数字の複数枚・階段）の判定
import { Card, Suit, rankValue, isJoker } from './cards';

export type PlayKind = 'single' | 'set' | 'stair';

export interface Play {
  kind: PlayKind;
  cards: Card[];
  count: number;
  /** 出した数字（single/set）。階段は いちばん弱い数字。ジョーカーだけの時は 0 */
  rank: number;
  /** 比べる値（階段は いちばん下の値）。ジョーカーだけの時は 16 */
  value: number;
  /** ジョーカー以外のマーク */
  suits: Suit[];
  hasJoker: boolean;
  jokerOnly: boolean;
}

export interface FieldCtx {
  field: Play | null;
  bind: Suit[] | null;
  revolution: boolean;
  elevenBack: boolean;
}

export function isInverted(ctx: { revolution: boolean; elevenBack: boolean }): boolean {
  return ctx.revolution !== ctx.elevenBack;
}

export function analyzePlay(cards: Card[]): Play | null {
  const n = cards.length;
  if (n === 0) return null;
  const naturals = cards.filter((c) => !isJoker(c));
  const jokers = n - naturals.length;
  const suits = naturals.map((c) => c.suit!) as Suit[];
  const base = { cards, count: n, suits, hasJoker: jokers > 0, jokerOnly: naturals.length === 0 };
  if (n === 1) {
    const c = cards[0];
    return { ...base, kind: 'single', rank: c.rank, value: rankValue(c.rank) };
  }
  // 同じ数字（ジョーカーは なりかわれる。9 には なれない）
  if (naturals.length === 0) return { ...base, kind: 'set', rank: 0, value: 16 };
  const r = naturals[0].rank;
  if (naturals.every((c) => c.rank === r)) {
    if (r === 9 && jokers > 0) return null;
    if (new Set(suits).size !== suits.length) return null;
    return { ...base, kind: 'set', rank: r, value: rankValue(r) };
  }
  // 階段：同じマーク3枚以上の続き数字。【仮】ジョーカーは 階段に 使えない
  if (n >= 3 && jokers === 0 && new Set(suits).size === 1) {
    const vals = naturals.map((c) => rankValue(c.rank)).sort((a, b) => a - b);
    for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1] + 1) return null;
    const low = naturals.find((c) => rankValue(c.rank) === vals[0])!;
    return { ...base, kind: 'stair', rank: low.rank, value: vals[0] };
  }
  return null;
}

/** 場に出せるか（上がり禁止は別に見る） */
export function canBeat(ctx: FieldCtx, play: Play): boolean {
  const f = ctx.field;
  if (!f) return true;
  if (f.kind !== play.kind || f.count !== play.count) return false;
  if (ctx.bind) {
    const nat = play.suits;
    if (!nat.every((s) => ctx.bind!.includes(s))) return false;
  }
  // スペードの3は ジョーカー1枚より強い
  if (f.kind === 'single' && f.jokerOnly) return play.kind === 'single' && play.rank === 3 && play.suits[0] === 'S';
  if (f.value === 16) return false;
  if (play.value === 16) return true;
  if (play.kind === 'single' && play.hasJoker) return true;
  return isInverted(ctx) ? play.value < f.value : play.value > f.value;
}

/** 8・ジョーカーで 上がれない */
export function isForbiddenFinish(play: Play, handSize: number): boolean {
  if (play.count !== handSize) return false;
  if (play.hasJoker) return true;
  if (play.kind !== 'stair' && play.rank === 8) return true;
  return false;
}

/** 縛りが かかるか（片縛なし・ジョーカー入りは かからない【仮】） */
export function makesBind(prev: Play, next: Play): Suit[] | null {
  if (prev.hasJoker || next.hasJoker) return null;
  const a = [...prev.suits].sort().join('');
  const b = [...next.suits].sort().join('');
  if (a !== b) return null;
  return [...prev.suits].sort() as Suit[];
}

/** 革命：同じ数字4枚以上、またはマークのそろった階段4枚以上 */
export function causesRevolution(play: Play): boolean {
  return (play.kind === 'set' || play.kind === 'stair') && play.count >= 4;
}

function combos<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

/** 手札から作れる出し方をすべて */
export function enumeratePlays(hand: Card[]): Play[] {
  const out: Play[] = [];
  const jokers = hand.filter(isJoker);
  const byRank = new Map<number, Card[]>();
  for (const c of hand) if (!isJoker(c)) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);
  for (const c of hand) out.push(analyzePlay([c])!);
  // 同じ数字
  for (const [r, cs] of byRank) {
    const maxJ = r === 9 ? 0 : jokers.length;
    for (let nNat = 1; nNat <= cs.length; nNat++) {
      for (const nat of combos(cs, nNat)) {
        for (let j = 0; j <= maxJ; j++) {
          if (nNat + j < 2) continue;
          const p = analyzePlay([...nat, ...jokers.slice(0, j)]);
          if (p) out.push(p);
        }
      }
    }
  }
  if (jokers.length >= 2) out.push(analyzePlay(jokers.slice(0, 2))!);
  // 階段
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  for (const s of suits) {
    const byVal = new Map<number, Card>();
    for (const c of hand) if (c.suit === s) byVal.set(rankValue(c.rank), c);
    for (let start = 3; start <= 15; start++) {
      const run: Card[] = [];
      for (let v = start; v <= 15 && byVal.has(v); v++) {
        run.push(byVal.get(v)!);
        if (run.length >= 3) out.push(analyzePlay([...run])!);
      }
    }
  }
  return out;
}

export function legalPlays(ctx: FieldCtx, hand: Card[]): Play[] {
  return enumeratePlays(hand).filter((p) => canBeat(ctx, p) && !isForbiddenFinish(p, hand.length));
}
