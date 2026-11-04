// sockets/boardPush — the exchange lobby's sport boards over the socket instead of every viewer
// polling POST /cricket/all-data every 5 s (rainbet; the same shape as oddsPush.mjs next to it).
//
//   page → 'subscribeSport' {sid}    joins board_<sid> (a socket may watch up to MAX_BOARDS sports:
//                                    the lobby's "all" view shows four at once)
//   page → 'unsubscribeSport' {sid}  leaves it
//   one ticker per watched sport reads the REST-identical reply every TICK_MS (CricketService keeps
//   the board 2 s, so REST callers and this share one upstream answer)
//   server → 'sportBoard' {sid, status, body, at}   when the board changed
//   server → 'sportBoard' {sid, at}                 every tick while it did not (heartbeat)
//   a new viewer gets the last board at once; the ticker stops when its room is empty
// shortcut: in-process ticker like oddsPush (one sports process); under a cluster add a Redis lease.
import crypto from "node:crypto";

var TICK_MS = 2e3;
var MAX_BOARDS = 8;
var watchers = /* @__PURE__ */ new Map(); // room → { sid, timer, inFlight, hash, last }

var roomOf = (sid) => `board_${sid}`;
var cleanSid = (sid) => (/^\d{1,4}$/.test(String(sid)) ? String(sid) : null);

async function tick(io, room, w, read) {
  if (!io.sockets.adapter.rooms.get(room)?.size) {
    clearInterval(w.timer);
    watchers.delete(room);
    return;
  }
  if (w.inFlight) return;
  w.inFlight = true;
  try {
    const reply = await read(w.sid);
    const hash = crypto.createHash("sha1").update(JSON.stringify(reply)).digest("base64");
    const at = new Date().toISOString();
    if (hash !== w.hash) {
      w.hash = hash;
      w.last = { sid: w.sid, ...reply, at };
      io.to(room).emit("sportBoard", w.last);
    } else {
      io.to(room).emit("sportBoard", { sid: w.sid, at });
    }
  } catch (err) {
    console.error("[boardPush] tick error:", err.message);
  } finally {
    w.inFlight = false;
  }
}

function subscribe(io, socket, data, read) {
  const sid = cleanSid(data?.sid);
  if (!sid) return;
  const rooms = (socket.data.boardRooms ??= new Set());
  const room = roomOf(sid);
  if (!rooms.has(room) && rooms.size >= MAX_BOARDS) return;
  rooms.add(room);
  socket.join(room);
  const w = watchers.get(room);
  if (w) {
    if (w.last) socket.emit("sportBoard", w.last);
    return;
  }
  const fresh = { sid, timer: null, inFlight: false, hash: null, last: null };
  watchers.set(room, fresh);
  fresh.timer = setInterval(() => tick(io, room, fresh, read), TICK_MS);
  tick(io, room, fresh, read);
}

function unsubscribe(socket, data) {
  const sid = cleanSid(data?.sid);
  if (!sid || !socket.data.boardRooms) return;
  const room = roomOf(sid);
  socket.data.boardRooms.delete(room);
  socket.leave(room);
}

/** @param read (sid) => Promise<{ status, body }> — cricketController sportBoardReply */
var setupBoardPush = (io, { read }) => {
  io.on("connection", (socket) => {
    socket.on("subscribeSport", (data) => subscribe(io, socket, data, read));
    socket.on("unsubscribeSport", (data) => unsubscribe(socket, data));
  });
};

export { setupBoardPush, roomOf };
