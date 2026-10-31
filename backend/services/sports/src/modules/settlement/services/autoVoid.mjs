// sportsbet/betresult/autoVoid.js — mssports core, moved unchanged
import { init_db } from "../../../lib/config/db.mjs";

init_db();
var CONFIG_TTL_MS = +(process.env.AUTO_VOID_CONFIG_TTL_MS || 1e4);
function voidDueAt(anchorSeenAt, c) {
  const seen = new Date(anchorSeenAt).getTime();
  const on = c?.enabled_at ? new Date(c.enabled_at).getTime() : 0;
  const delayMs = Math.max(0, Number(c?.delay_seconds) || 0) * 1e3;
  return new Date(Math.max(seen, on) + delayMs);
}

export { voidDueAt };
