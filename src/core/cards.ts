// カードの基本。Phaser や画面には依存しない。
export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const SUIT_MARK: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'スペード', H: 'ハート', D: 'ダイヤ', C: 'クローバー' };

/** rank: 1〜13。0 はジョーカー。 */
export interface Card {
  id: string;
  rank: number;
  suit: Suit | null;
}

/** 【仮】ジョーカーは 2枚 */
export const JOKER_COUNT = 2;

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r++) deck.push({ id: `${s}${r}`, rank: r, suit: s });
  for (let j = 1; j <= JOKER_COUNT; j++) deck.push({ id: `JK${j}`, rank: 0, suit: null });
  return deck;
}

export function cardFromId(id: string): Card {
  if (id.startsWith('JK')) return { id, rank: 0, suit: null };
  return { id, rank: Number(id.slice(1)), suit: id[0] as Suit };
}

/** 強さの値（ふつうの時）。3 が 3、K が 13、A が 14、2 が 15。ジョーカーは 16。 */
export function rankValue(rank: number): number {
  if (rank === 0) return 16;
  if (rank === 1) return 14;
  if (rank === 2) return 15;
  return rank;
}

export function rankLabel(rank: number): string {
  if (rank === 0) return 'JOKER';
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

export function cardLabel(c: Card): string {
  return c.suit ? `${SUIT_MARK[c.suit]}${rankLabel(c.rank)}` : 'JOKER';
}

export function isJoker(c: Card): boolean {
  return c.rank === 0;
}

/** 手札の並び（ふつうの強さ順。ジョーカーは右端） */
export function sortHand(cards: Card[], inverted = false): Card[] {
  const so: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };
  return [...cards].sort((a, b) => {
    const va = a.rank === 0 ? 99 : inverted ? 18 - rankValue(a.rank) : rankValue(a.rank);
    const vb = b.rank === 0 ? 99 : inverted ? 18 - rankValue(b.rank) : rankValue(b.rank);
    if (va !== vb) return va - vb;
    return (a.suit ? so[a.suit] : 9) - (b.suit ? so[b.suit] : 9) || a.id.localeCompare(b.id);
  });
}

// 種から再現できる乱数
export function mulberry32Step(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}
