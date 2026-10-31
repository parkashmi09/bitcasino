import { io } from 'socket.io-client';
import { SOCKET_BASE } from './site';
import { SPORTS_SOCKET_PATH } from './balanceSocket';

/**
 * ─── Live odds push (sports socket) ──────────────────────────────────────────────────────
 *
 * sports-service pushes a match page's board (backend modules/odds-events/sockets/oddsPush.mjs —
 * TENEXCH's odds push), through the gateway at `/ws/sports/socket.io`:
 *
 *   client → 'subscribeMatch' {gmid, sid}                 join the match's room (again on every reconnect)
 *   server → 'matchOdds' {gmid, sid, status, body, at}    the REST get-match-private-data reply, when it changed
 *   server → 'matchOdds' {gmid, sid, at}                  heartbeat (~2 s) while it did not
 *
 * No login: the board is the same for every viewer. WebSocket only, like balanceSocket.js.
 *
 * @param {{ gmid:number|string, sid:number|string,
 *   onOdds:(m:{ status?:number, body?:object, at:string }) => void,
 *   onStatus?:(connected:boolean) => void }} p
 * @returns {() => void} disconnect
 */
export function connectOddsSocket({ gmid, sid, onOdds, onStatus }) {
  const socket = io(SOCKET_BASE || undefined, {
    path: SPORTS_SOCKET_PATH,
    transports: ['websocket'],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    socket.emit('subscribeMatch', { gmid, sid });
    onStatus?.(true);
  });
  socket.on('disconnect', () => onStatus?.(false));
  socket.on('connect_error', () => onStatus?.(false));
  socket.on('matchOdds', (m) => {
    if (!m || String(m.gmid) !== String(gmid) || String(m.sid) !== String(sid)) return;
    onOdds(m);
  });

  return () => socket.disconnect();
}
