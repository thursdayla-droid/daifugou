// PeerJS で 端末どうしを つなぐ（無料の つなぎ役サーバーを使う。登録なし）
import Peer, { DataConnection } from 'peerjs';
import { Action } from '../core/game';
import { ClientMsg, HostMsg, Room } from './room';

const PREFIX = 'daifugo-gold-v1-';

/** 確認用：?peer=127.0.0.1:9000 で 手元の つなぎ役サーバーを使う */
function peerOptions(): any {
  const q = new URLSearchParams(location.search).get('peer');
  if (!q) return {};
  const [host, port] = q.split(':');
  return { host, port: Number(port), path: '/', secure: false };
}

export interface Controller {
  isHost: boolean;
  send(a: Action): void;
  again(): void;
  setTotal?(n: number): void;
  start?(): void;
  leave(): void;
}

function randomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** 部屋を作る（オンライン） */
export function hostRoom(name: string, onMsg: (m: HostMsg) => void, onError: (msg: string) => void, tries = 0): Promise<Controller> {
  return new Promise((resolve) => {
    const code = randomCode();
    const peer = new Peer(PREFIX + code, peerOptions());
    const room = new Room(code, name);
    room.onHostView = onMsg;
    let opened = false;
    peer.on('open', () => {
      opened = true;
      room.pushLobby();
      resolve(makeHostController(room, () => peer.destroy()));
    });
    peer.on('error', (e: any) => {
      if (!opened && e?.type === 'unavailable-id' && tries < 5) {
        peer.destroy();
        hostRoom(name, onMsg, onError, tries + 1).then(resolve);
        return;
      }
      if (!opened) onError('部屋を作れませんでした。通信を確認してください');
    });
    peer.on('connection', (conn: DataConnection) => {
      conn.on('data', (raw) => {
        const m = raw as ClientMsg;
        if (m.t === 'hello') {
          const err = room.join(conn.peer, m.name, (hm) => conn.open && conn.send(hm));
          if (err) {
            conn.send({ t: 'closed', msg: err } satisfies HostMsg);
            setTimeout(() => conn.close(), 500);
          } else if (room.game) room.broadcast();
        } else if (m.t === 'act') room.act(conn.peer, m.action);
        else if (m.t === 'again') room.again();
      });
      conn.on('close', () => room.leave(conn.peer));
    });
    peer.on('disconnected', () => {
      try {
        peer.reconnect();
      } catch {
        /* 何もしない */
      }
    });
  });
}

/** CPU とだけ遊ぶ（通信なし） */
export function localRoom(name: string, total: number, onMsg: (m: HostMsg) => void): Controller {
  const room = new Room('----', name);
  room.onHostView = onMsg;
  room.total = total;
  const c = makeHostController(room, () => {});
  // 画面側が ctrl を受け取ってから 始める（先に始めると 最初の画面が出ない）
  setTimeout(() => room.start(), 0);
  return c;
}

function makeHostController(room: Room, destroy: () => void): Controller {
  return {
    isHost: true,
    send: (a) => room.act('host', a),
    again: () => room.again(),
    setTotal: (n) => room.setTotal(n),
    start: () => room.start(),
    leave: () => {
      room.close();
      setTimeout(destroy, 300);
    },
  };
}

/** 部屋に入る */
export function joinRoom(code: string, name: string, onMsg: (m: HostMsg) => void, onError: (msg: string) => void): Controller {
  const peer = new Peer(peerOptions());
  let conn: DataConnection | null = null;
  let closedByMe = false;
  let gotHello = false;
  const timer = setTimeout(() => {
    if (!gotHello) onError('部屋が見つかりません。番号を確認してください');
  }, 12000);
  peer.on('open', () => {
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => conn!.send({ t: 'hello', name } satisfies ClientMsg));
    conn.on('data', (raw) => {
      gotHello = true;
      clearTimeout(timer);
      onMsg(raw as HostMsg);
    });
    conn.on('close', () => {
      if (!closedByMe) onMsg({ t: 'closed', msg: '部屋との通信が切れました' });
    });
  });
  peer.on('error', (e: any) => {
    if (e?.type === 'peer-unavailable') {
      clearTimeout(timer);
      onError('部屋が見つかりません。番号を確認してください');
    } else if (!gotHello) onError('つながりませんでした。通信を確認してください');
  });
  return {
    isHost: false,
    send: (a) => conn?.open && conn.send({ t: 'act', action: a } satisfies ClientMsg),
    again: () => conn?.open && conn.send({ t: 'again' } satisfies ClientMsg),
    leave: () => {
      closedByMe = true;
      clearTimeout(timer);
      conn?.close();
      setTimeout(() => peer.destroy(), 300);
    },
  };
}
