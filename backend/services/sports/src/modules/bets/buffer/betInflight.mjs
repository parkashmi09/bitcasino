// sportsbet/betInflight.js — mssports core, moved unchanged

var OUTCOME_TTL_MS = Number(process.env.BET_OUTCOME_TTL_MS) || 5 * 60 * 1e3;
var REF_RE = /^[A-Za-z0-9-]{8,64}$/;
var entries = /* @__PURE__ */ new Map();
var keyOf = (userId, ref) => `${userId}:${ref}`;
var cleanRef = (ref) => typeof ref === "string" && REF_RE.test(ref) ? ref : null;
function sweep() {
  const now = Date.now();
  for (const [k, e] of entries) {
    if (now - e.at > OUTCOME_TTL_MS) entries.delete(k);
  }
}
setInterval(sweep, 60 * 1e3).unref();
function begin(userId, ref) {
  const k = keyOf(userId, ref);
  const existing = entries.get(k);
  if (existing) return existing;
  entries.set(k, { state: "pending", status: null, body: null, at: Date.now() });
  return null;
}
function finish(userId, ref, body, status) {
  entries.set(keyOf(userId, ref), {
    state: body?.success ? "accepted" : "rejected",
    status,
    body,
    at: Date.now()
  });
}
function get(userId, ref) {
  return entries.get(keyOf(userId, ref)) || null;
}
var betInflight_default = { cleanRef, begin, finish, get };

export { cleanRef, betInflight_default };
