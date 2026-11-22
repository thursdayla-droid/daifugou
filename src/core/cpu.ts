// CPU の考え方（かんたん）
import { Card, SUITS, rankValue } from './cards';
import { Action, PlayerView } from './game';
import { Play, isInverted, legalPlays } from './plays';

function strength(c: Card, inv: boolean): number {
  if (c.rank === 0) return 20;
  const v = rankValue(c.rank);
  return inv ? 18 - v : v;
}

function playStrength(p: Play, inv: boolean): number {
  if (p.jokerOnly) return 20;
  const v = p.value;
  return inv ? 18 - v : v;
}

function weakest(hand: Card[], n: number, inv: boolean): string[] {
  return [...hand].sort((a, b) => strength(a, inv) - strength(b, inv)).slice(0, n).map((c) => c.id);
}

export function cpuAction(v: PlayerView, rnd: () => number): Action {
  const inv = isInverted(v);
  const hand = v.hand;
  const pd = v.pending;
  if (pd) {
    switch (pd.type) {
      case 'draw3': {
        const opts = pd.options ?? [];
        if (opts.length === 0) return { type: 'pick', cardId: null };
        const sixes = hand.filter((c) => c.rank === 6).length;
        const six = opts.find((c) => c.rank === 6);
        if (six && sixes >= 2) return { type: 'pick', cardId: six.id };
        const best = [...opts].sort((a, b) => strength(b, inv) - strength(a, inv))[0];
        return { type: 'pick', cardId: best.id };
      }
      case 'trade':
        return { type: 'tradePick', index: Math.floor(rnd() * pd.count) };
      case 'counter':
        return { type: 'counter', use: true };
      case 'counterGive':
        return { type: 'cards', cards: weakest(hand, 1, inv) };
      case 'give7':
      case 'ten':
      case 'kingDiscard':
        return { type: 'cards', cards: weakest(hand, Math.min(pd.count, hand.length), inv) };
      case 'nine':
        return { type: 'pick', cardId: pd.options[0]?.cardId ?? null };
      case 'king':
        return { type: 'guess', suit: SUITS[Math.floor(rnd() * 4)] };
    }
  }
  const plays = legalPlays(v, hand);
  if (plays.length === 0) return { type: 'pass' };
  const score = (p: Play) => {
    let s = playStrength(p, inv) * 10 - p.count * 6;
    if (p.hasJoker) s += 60;
    if (p.kind !== 'stair' && p.rank === 6) s += 25; // 6はエクゾディア用にとっておく
    if (p.count >= 4) s += hand.length > 8 ? 30 : -30; // 革命は 状況しだい
    return s;
  };
  // 上がれるなら上がる
  const finish = plays.find((p) => p.count === hand.length);
  if (finish) return { type: 'play', cards: finish.cards.map((c) => c.id) };
  const sorted = [...plays].sort((a, b) => score(a) - score(b));
  const pick = sorted[0];
  if (v.field) {
    // 強いカードは 序盤は あまり使わない
    const st = playStrength(pick, inv);
    if (hand.length > 5 && (pick.hasJoker || st >= 15) && rnd() < 0.6) return { type: 'pass' };
  }
  return { type: 'play', cards: pick.cards.map((c) => c.id) };
}
