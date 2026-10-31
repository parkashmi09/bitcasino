import { useEffect, useState } from 'react';

/* Live cricket score — ported from TENEXCH (tenexch-new/frontend/src/hooks/useCricketScore.js).
 *
 * The provider runs Socket.IO v2 (Engine.IO v3, `?EIO=3`); socket.io-client v4 cannot talk to it,
 * so the few packets needed are framed by hand:
 *   "0{…}" engine open · "40" connect → subscribe · "2" ping → "3" · "42[ev,payload]" event
 * We send '42["subscribe_event",{eventId:<gmid>,providerId:"1"}]' and a "2" every 20s.
 *
 * One socket per gmid, shared by every subscriber, closed CLOSE_GRACE_MS after the last one leaves.
 * A socket silent for DEAD_AFTER_MS is rebuilt on the next ping tick (a phone that dropped TCP in
 * the background keeps readyState 1 and never fires onclose). The last summary survives a rebuild.
 *
 * Returns the latest `summary.data` (spnnation1, score1, balls, …) or null.
 */
const SCORE_SOCKET_URL = import.meta.env.VITE_SCORE_SOCKET_URL || '';
const CLOSE_GRACE_MS = 1500;
const DEAD_AFTER_MS = 45000;
const connections = new Map();

function resolveSocketBase() {
  const raw = String(SCORE_SOCKET_URL).trim().replace(/\/+$/, '');
  if (!raw) return { error: 'NEXT_PUBLIC_SCORE_SOCKET_URL is not set' };
  if (/^wss?:\/\//i.test(raw)) return { base: raw };
  if (/^https:\/\//i.test(raw)) return { base: `wss://${raw.slice(8)}` };
  if (/^http:\/\//i.test(raw)) return { base: `ws://${raw.slice(7)}` };
  return { error: `NEXT_PUBLIC_SCORE_SOCKET_URL must be ws:// or wss:// (got "${raw}")` };
}

function openConnection(gmid, base) {
  const entry = { ws: null, listeners: new Set(), last: null, lastFrameAt: 0, closeTimer: null, retryTimer: null, pingTimer: null, closedByUs: false };
  const SUB = '42' + JSON.stringify(['subscribe_event', { eventId: String(gmid), providerId: '1' }]);
  const stopPing = () => { if (entry.pingTimer) { clearInterval(entry.pingTimer); entry.pingTimer = null; } };
  const scheduleRetry = () => { if (!entry.closedByUs) entry.retryTimer = setTimeout(connect, 2000); };

  function connect() {
    let ws;
    try { ws = new WebSocket(`${base}/socket.io/?EIO=3&transport=websocket`); } catch { scheduleRetry(); return; }
    entry.ws = ws;
    entry.lastFrameAt = Date.now();
    let subscribed = false;
    const subscribe = () => { if (!subscribed && ws.readyState === 1) { subscribed = true; ws.send(SUB); } };

    ws.onopen = () => {
      entry.lastFrameAt = Date.now();
      // Some deployments never send "40" — subscribe on a short delay too.
      setTimeout(subscribe, 300);
      entry.pingTimer = setInterval(() => {
        if (Date.now() - entry.lastFrameAt > DEAD_AFTER_MS) { entry.reconnect(); return; }
        if (ws.readyState === 1) ws.send('2');
      }, 20000);
    };
    ws.onmessage = (e) => {
      entry.lastFrameAt = Date.now();
      const m = typeof e.data === 'string' ? e.data : '';
      if (!m || m === '3' || m[0] === '0') return;
      if (m === '2') { ws.send('3'); return; }
      if (m.startsWith('40')) { subscribe(); return; }
      if (m.startsWith('42')) {
        try {
          const d = JSON.parse(m.slice(2))[1]?.summary?.data;
          if (d && typeof d === 'object') { entry.last = d; entry.listeners.forEach((fn) => fn(d)); }
        } catch { /* malformed frame */ }
      }
    };
    ws.onclose = () => { stopPing(); scheduleRetry(); };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  }

  // Detach the old socket's handlers first, or its onclose schedules a second connect.
  entry.reconnect = () => {
    if (entry.closedByUs) return;
    if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null; }
    stopPing();
    const old = entry.ws;
    if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; try { old.close(); } catch { /* noop */ } }
    connect();
  };
  entry.destroy = () => {
    entry.closedByUs = true;
    stopPing();
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    if (entry.ws) { try { entry.ws.close(); } catch { /* noop */ } }
  };

  connect();
  return entry;
}

function subscribeToEvent(gmid, base, onData) {
  let entry = connections.get(gmid);
  if (!entry) { entry = openConnection(gmid, base); connections.set(gmid, entry); }
  if (entry.closeTimer) { clearTimeout(entry.closeTimer); entry.closeTimer = null; }
  entry.listeners.add(onData);
  if (entry.last) onData(entry.last);
  return () => {
    entry.listeners.delete(onData);
    if (entry.listeners.size > 0) return;
    entry.closeTimer = setTimeout(() => {
      if (entry.listeners.size > 0) return;
      entry.destroy();
      connections.delete(gmid);
    }, CLOSE_GRACE_MS);
  };
}

export function useCricketScore(gmid, { enabled = true } = {}) {
  // Keyed by gmid, so a match change never shows the previous match's score.
  const [state, setState] = useState({ gmid: null, data: null });
  useEffect(() => {
    if (!enabled || !gmid) return undefined;
    const { base, error } = resolveSocketBase();
    if (error) {
      console.error(`[cricket-score] live scorecard disabled: ${error}`);
      return undefined;
    }
    const key = String(gmid);
    return subscribeToEvent(key, base, (data) => setState({ gmid: key, data }));
  }, [gmid, enabled]);
  return enabled && state.gmid === String(gmid) ? state.data : null;
}
