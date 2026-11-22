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
        if (pd.asking) return { type: 'decide', use: true };
        const opts = pd.options ?? [];
        const sixes = hand.filter((c) => c.rank === 6).length;
        const rank = (c: Card) => (c.rank === 6 && sixes >= 2 ? 100 : strength(c, inv));
        const best = [...opts].sort((a, b) => rank(b) - rank(a)).slice(0, pd.count);
        return { type: 'cards', cards: best.map((c) => c.id) };
      }
      case 'trade':
      {
        const all = Array.from({ length: pd.count }, (_, i) => i);
        for (let i = all.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [all[i], all[j]] = [all[j], all[i]];
        }
        return { type: 'tradePick', indices: all.slice(0, pd.need) };
      }
      case 'counter':
        return { type: 'counter', use: true, n: pd.max };
      case 'counterGive':
        return { type: 'cards', cards: weakest(hand, Math.min(pd.count, hand.length), inv) };
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
    if (p.kind !== 'stair' && p.rank === 6) s += 25; // 6はケメゾディア用にとっておく
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
