// 部屋（親の端末で動く）。ゲームを進め、みんなに「見えていい情報」だけ送る。
import { cpuAction } from '../core/cpu';
import { Action, GameState, PlayerView, apply, newGame, viewFor, waitingFor } from '../core/game';

export interface Seat {
  name: string;
  kind: 'host' | 'remote' | 'cpu';
  send?: (msg: HostMsg) => void;
  id: string;
}

export type HostMsg =
  | { t: 'lobby'; seats: { name: string; kind: Seat['kind'] }[]; you: number; code: string; total: number }
  | { t: 'view'; view: PlayerView }
  | { t: 'err'; msg: string }
  | { t: 'closed'; msg: string };

export type ClientMsg = { t: 'hello'; name: string } | { t: 'act'; action: Action } | { t: 'again' };

export const MAX_PLAYERS = 6;
export const CPU_NAMES = ['CPU アリス', 'CPU ボブ', 'CPU キング', 'CPU クイーン', 'CPU ジャック'];

export class Room {
  seats: Seat[] = [];
  total = 4;
  game: GameState | null = null;
  /** 親の画面 */
  onHostView: (msg: HostMsg) => void = () => {};
  private cpuTimer: ReturnType<typeof setTimeout> | null = null;
  private seatOfGame: number[] = []; // ゲーム内の番号 → seats の番号

  constructor(public code: string, hostName: string) {
    this.seats.push({ name: hostName, kind: 'host', id: 'host' });
  }

  join(id: string, name: string, send: (m: HostMsg) => void): string | null {
    if (this.game) return 'もう ゲームが始まっています';
    if (this.seats.length >= MAX_PLAYERS) return '部屋が いっぱいです';
    this.seats.push({ name: name.slice(0, 10) || 'ゲスト', kind: 'remote', id, send });
    if (this.total < this.seats.length) this.total = this.seats.length;
    this.pushLobby();
    return null;
  }

  leave(id: string) {
    const k = this.seats.findIndex((s) => s.id === id);
    if (k < 0) return;
    const seat = this.seats[k];
    if (!this.game) {
      this.seats.splice(k, 1);
      this.pushLobby();
      return;
    }
    // 【仮】ゲーム中に抜けたら CPU が代わりに打つ
    seat.kind = 'cpu';
    seat.send = undefined;
    seat.name = `${seat.name}（CPU）`;
    const gi = this.seatOfGame.indexOf(k);
    if (gi >= 0) {
      this.game.players[gi].cpu = true;
      this.game.players[gi].name = seat.name;
    }
    this.broadcast();
  }

  setTotal(n: number) {
    this.total = Math.max(2, Math.min(MAX_PLAYERS, Math.max(n, this.seats.length)));
    this.pushLobby();
  }

  lobbyMsg(you: number): HostMsg {
    return { t: 'lobby', seats: this.seats.map((s) => ({ name: s.name, kind: s.kind })), you, code: this.code, total: this.total };
  }

  pushLobby() {
    this.seats.forEach((s, i) => {
      const m = this.lobbyMsg(i);
      if (s.kind === 'host') this.onHostView(m);
      else s.send?.(m);
    });
  }

  start(seed = (Math.random() * 2 ** 32) >>> 0) {
    // 足りない分は CPU
    let ci = 0;
    this.seats = this.seats.filter((s) => s.kind !== 'cpu' || !s.name.startsWith('CPU '));
    while (this.seats.length < this.total) {
      this.seats.push({ name: CPU_NAMES[ci++ % CPU_NAMES.length], kind: 'cpu', id: `cpu${ci}` });
    }
    // 席はランダム
    const order = this.seats.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.seatOfGame = order;
    this.game = newGame(
      order.map((k) => ({ name: this.seats[k].name, cpu: this.seats[k].kind === 'cpu' })),
      seed,
    );
    this.broadcast();
  }

  /** seats の番号から ゲーム内の番号 */
  gameIndexOf(seatIdx: number) {
    return this.seatOfGame.indexOf(seatIdx);
  }

  act(seatId: string, action: Action) {
    const g = this.game;
    if (!g) return;
    const k = this.seats.findIndex((s) => s.id === seatId);
    const gi = this.gameIndexOf(k);
    const err = apply(g, gi, action);
    if (err) {
      const m: HostMsg = { t: 'err', msg: err };
      if (this.seats[k].kind === 'host') this.onHostView(m);
      else this.seats[k].send?.(m);
      return;
    }
    this.broadcast();
  }

  again() {
    if (!this.game?.over) return;
    this.game = null;
    this.start();
  }

  broadcast() {
    const g = this.game;
    if (!g) return;
    this.seatOfGame.forEach((k, gi) => {
      const seat = this.seats[k];
      if (seat.kind === 'cpu') return;
      const m: HostMsg = { t: 'view', view: viewFor(g, gi) };
      if (seat.kind === 'host') this.onHostView(m);
      else seat.send?.(m);
    });
    this.scheduleCpu();
  }

  private scheduleCpu() {
    if (this.cpuTimer) clearTimeout(this.cpuTimer);
    const g = this.game;
    if (!g || g.over) return;
    const w = waitingFor(g);
    if (w === null || !g.players[w].cpu) return;
    const delay = g.pending ? 900 : 1000 + Math.random() * 500;
    this.cpuTimer = setTimeout(() => {
      this.cpuTimer = null;
      const gg = this.game;
      if (!gg || gg.over || waitingFor(gg) !== w) return;
      const a = cpuAction(viewFor(gg, w), Math.random);
      const err = apply(gg, w, a);
      if (err) apply(gg, w, gg.field && !gg.pending ? { type: 'pass' } : a);
      this.broadcast();
    }, delay);
  }

  close() {
    if (this.cpuTimer) clearTimeout(this.cpuTimer);
    for (const s of this.seats) s.send?.({ t: 'closed', msg: '部屋が閉じられました' });
  }
}
