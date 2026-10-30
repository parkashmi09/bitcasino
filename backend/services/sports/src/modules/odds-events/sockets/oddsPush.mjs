// sockets/oddsPush — a match page's live odds over the socket instead of every viewer polling
// get-match-private-data every second. TENEXCH services/oddsPushService.js (its plan:
// docs/plans/2026-10-21-odds-push.md), on this service's one process.
//
//   page → 'subscribeMatch' {gmid, sid}   joins odds_<sid>_<gmid> (one match room per socket)
//   one ticker per watched match fetches the REST-identical reply every TICK_MS (the shared
//   private-data cache in CricketService serves REST callers from the same upstream answer)
//   server → 'matchOdds' {gmid, sid, status, body, at}   when the board changed
//   server → 'matchOdds' {gmid, sid, at}                 every HEARTBEAT_MS while it did not, so the
//                                                        page can tell "unchanged" from "push died"
//   a new viewer gets the last board at once; the ticker stops when its room is empty
//
// Data only: whether a match is gone or between rounds stays the page's decision
// (frontend hooks/exchange/useMatchMarkets.js), made from the same body it would have fetched.
// shortcut: sports-svc runs as one process, so the ticker is in-process; under pm2 cluster add
// TENEXCH's feed-Redis lease so one copy fetches per tick.
import crypto from "node:crypto";

var TICK_MS = 1e3; // the page's own poll (useMatchMarkets POLL_MS)
var HEARTBEAT_MS = 2e3;
var watchers = /* @__PURE__ */ new Map(); // room → { gmid, sid, timer, inFlight, hash, sentAt, last }

var roomOf = (sid, gmid) => `odds_${sid}_${gmid}`;
// Ids are digits; anything else is not a match and must not reach the provider.
var cleanIds = (gmid, sid) => /^\d{1,12}$/.test(String(gmid)) && /^\d{1,4}$/.test(String(sid)) ? { gmid: String(gmid), sid: String(sid) } : null;

async function tick(io, room, w, read) {
  if (!io.sockets.adapter.rooms.get(room)?.size) {
    clearInterval(w.timer);
    watchers.delete(room);
    return;
  }
  if (w.inFlight) return;
  w.inFlight = true;
  try {
    const reply = await read(w.gmid, w.sid);
    const hash = crypto.createHash("sha1").update(JSON.stringify(reply)).digest("base64");
    const now = Date.now();
    const at = new Date(now).toISOString();
    if (hash !== w.hash) {
      w.hash = hash;
      w.last = { gmid: w.gmid, sid: w.sid, ...reply, at };
      w.sentAt = now;
      io.to(room).emit("matchOdds", w.last);
    } else if (now - w.sentAt >= HEARTBEAT_MS) {
      w.sentAt = now;
      io.to(room).emit("matchOdds", { gmid: w.gmid, sid: w.sid, at });
    }
  } catch (err) {
    console.error("[oddsPush] tick error:", err.message);
  } finally {
    w.inFlight = false;
  }
}

function leave(socket) {
  if (!socket.data.oddsRoom) return;
  socket.leave(socket.data.oddsRoom);
  socket.data.oddsRoom = null;
}

function subscribe(io, socket, data, read) {
  const ids = cleanIds(data?.gmid, data?.sid);
  if (!ids) return;
  const room = roomOf(ids.sid, ids.gmid);
  if (socket.data.oddsRoom !== room) leave(socket);
  socket.join(room);
  socket.data.oddsRoom = room;
  const w = watchers.get(room);
  if (w) {
    if (w.last) socket.emit("matchOdds", w.last);
    return;
  }
  const fresh = { ...ids, timer: null, inFlight: false, hash: null, sentAt: 0, last: null };
  watchers.set(room, fresh);
  fresh.timer = setInterval(() => tick(io, room, fresh, read), TICK_MS);
  tick(io, room, fresh, read);
}

/** @param read (gmid, sid) => Promise<{ status, body }> — cricketController matchPrivateDataReply */
var setupOddsPush = (io, { read }) => {
  io.on("connection", (socket) => {
    socket.on("subscribeMatch", (data) => subscribe(io, socket, data, read));
    socket.on("unsubscribeMatch", () => leave(socket));
  });
};

export { setupOddsPush, cleanIds, roomOf };
