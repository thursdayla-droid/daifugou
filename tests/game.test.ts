import { describe, expect, it } from 'vitest';
import { cardFromId as c } from '../src/core/cards';
import { analyzePlay, canBeat, enumeratePlays, isForbiddenFinish } from '../src/core/plays';
import { GameState, apply, newGame, viewFor, waitingFor } from '../src/core/game';
import { cpuAction } from '../src/core/cpu';

const P = (...ids: string[]) => analyzePlay(ids.map(c))!;
const ctx = (field: string[] | null, o: Partial<{ revolution: boolean; elevenBack: boolean; bind: any }> = {}) => ({
  field: field ? P(...field) : null,
  bind: o.bind ?? null,
  revolution: !!o.revolution,
  elevenBack: !!o.elevenBack,
});

describe('出し方', () => {
  it('ペア・ジョーカー・階段', () => {
    expect(P('S5', 'H5').kind).toBe('set');
    expect(P('S5', 'JK1').kind).toBe('set');
    expect(analyzePlay([c('S9'), c('JK1')])).toBeNull(); // 9にはなれない
    expect(P('S3', 'S4', 'S5').kind).toBe('stair');
    expect(analyzePlay([c('S3'), c('H4'), c('S5')])).toBeNull();
    expect(P('S13', 'S1', 'S2').kind).toBe('stair');
  });
  it('強さ', () => {
    expect(canBeat(ctx(['S4']), P('H5'))).toBe(true);
    expect(canBeat(ctx(['S2']), P('H1'))).toBe(false);
    expect(canBeat(ctx(['S2']), P('JK1'))).toBe(true);
    expect(canBeat(ctx(['JK1']), P('S3'))).toBe(true); // スペ3
    expect(canBeat(ctx(['JK1']), P('H3'))).toBe(false);
    expect(canBeat(ctx(['S5'], { elevenBack: true }), P('H4'))).toBe(true);
    expect(canBeat(ctx(['S5'], { elevenBack: true, revolution: true }), P('H4'))).toBe(false);
    expect(canBeat(ctx(['S5'], { bind: ['S'] }), P('H6'))).toBe(false);
    expect(canBeat(ctx(['S5'], { bind: ['S'] }), P('S6'))).toBe(true);
  });
  it('上がり禁止', () => {
    expect(isForbiddenFinish(P('S8'), 1)).toBe(true);
    expect(isForbiddenFinish(P('JK1'), 1)).toBe(true);
    expect(isForbiddenFinish(P('S8'), 2)).toBe(false);
    expect(isForbiddenFinish(P('S7', 'S8', 'S9'), 3)).toBe(false);
  });
  it('列挙', () => {
    const ps = enumeratePlays(['S3', 'S4', 'S5', 'H5', 'JK1'].map(c));
    expect(ps.some((p) => p.kind === 'stair' && p.count === 3)).toBe(true);
    expect(ps.some((p) => p.kind === 'set' && p.rank === 5 && p.count === 3)).toBe(true);
  });
});

function setup(hands: string[][], turn = 0): GameState {
  const s = newGame(hands.map((_, i) => ({ name: `P${i}`, cpu: false })), 1);
  s.players.forEach((p, i) => (p.hand = hands[i].map(c)));
  s.turn = turn;
  s.events = [];
  s.over = false;
  return s;
}

describe('効果', () => {
  it('8切り：同じ人がもう一度', () => {
    const s = setup([['S8', 'S4'], ['H5', 'H6'], ['D5', 'D6']]);
    expect(apply(s, 0, { type: 'play', cards: ['S8'] })).toBeNull();
    expect(s.field).toBeNull();
    expect(s.turn).toBe(0);
  });
  it('5飛び', () => {
    const s = setup([['S5', 'S4'], ['H5', 'H6'], ['D5', 'D6']]);
    apply(s, 0, { type: 'play', cards: ['S5'] });
    expect(s.turn).toBe(2);
  });
  it('Qリバース', () => {
    const s = setup([['S12', 'S4'], ['H5', 'H6'], ['D5', 'D6']]);
    apply(s, 0, { type: 'play', cards: ['S12'] });
    expect(s.turn).toBe(2);
  });
  it('7渡しとエースカウンター', () => {
    const s = setup([['S7', 'S4', 'S9'], ['H1', 'H6'], ['D5', 'D6']]);
    apply(s, 0, { type: 'play', cards: ['S7'] });
    expect(waitingFor(s)).toBe(1);
    apply(s, 1, { type: 'counter', use: true });
    apply(s, 1, { type: 'cards', cards: ['H6'] });
    expect(s.players[1].hand.length).toBe(0);
    expect(s.players[0].hand.map((x) => x.id)).toContain('H6');
  });
  it('エクゾディア', () => {
    const s = setup([['S9', 'H6', 'D6', 'C6'], ['S6', 'H2'], ['H4', 'D5']]);
    apply(s, 0, { type: 'play', cards: ['S9'] });
    apply(s, 0, { type: 'pick', cardId: 'S6' });
    expect(s.over).toBe(true);
    expect(s.ranking![0]).toBe(0);
  });
  it('11バックはずっと続く', () => {
    const s = setup([['S11', 'S8', 'S4', 'S3'], ['H5', 'H6'], ['D5', 'D6']]);
    apply(s, 0, { type: 'play', cards: ['S11'] });
    apply(s, 1, { type: 'pass' });
    apply(s, 2, { type: 'pass' });
    expect(s.field).toBeNull();
    expect(s.elevenBack).toBe(true);
  });
  it('トレード', () => {
    const s = setup([['S4', 'S3'], ['H5', 'H6'], ['D5', 'D6']]);
    apply(s, 0, { type: 'play', cards: ['S4'] });
    apply(s, 0, { type: 'tradePick', index: 0 });
    apply(s, 1, { type: 'tradePick', index: 0 });
    expect(s.players[0].hand.length).toBe(1);
    expect(s.players[0].hand[0].id.startsWith('H')).toBe(true);
    expect(s.players[1].hand.map((x) => x.id)).toContain('S3');
  });
});

describe('CPUだけで最後まで', () => {
  it('たくさんの対戦が止まらずに終わる', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const n = 2 + (seed % 5);
      const s = newGame(Array.from({ length: n }, (_, i) => ({ name: `C${i}`, cpu: true })), seed);
      let r = seed;
      const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
      let steps = 0;
      while (!s.over && steps < 5000) {
        const w = waitingFor(s)!;
        const err = apply(s, w, cpuAction(viewFor(s, w), rnd));
        if (err) throw new Error(`seed ${seed}: ${err}`);
        steps++;
      }
      expect(s.over).toBe(true);
      expect(new Set(s.ranking).size).toBe(n);
      const total = s.players.reduce((a, p) => a + p.hand.length, 0) + s.graveyard.length + s.fieldPile.length + (s.field?.cards.length ?? 0);
      if (s.exodia === null) expect(total).toBe(54);
    }
  });
});
