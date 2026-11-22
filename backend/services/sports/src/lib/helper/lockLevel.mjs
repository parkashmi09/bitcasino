// A sports lock remembers the staff level that set it (`locked_level`, migration 192); only that level
// or one above (smaller number: 1 Super Admin … 6 Agent) may lift it. A lock with no level stored (set
// before 192) is not blocked. Same rule as admin-service locks/lockSources.js `upheldAbove`.
import auth from "@ibitplay/auth";

var LOCKED_BY_UPLINE = "This lock was set by an account above you";

// The platform staff level the caller acts with (an executive acts with its parent's), or null.
var actorLevel = (req) => {
  const level = auth.effectiveStaffLevel(req?.staff ?? {});
  return Number.isInteger(level) ? level : null;
};

// Fails closed: a recorded level blocks a caller whose own level is unknown.
var heldAbove = (lock, level) => Boolean(lock?.is_locked) && Number.isInteger(lock?.locked_level) && !(Number.isInteger(level) && level <= lock.locked_level);

// The level to store when (re)locking: an existing higher one is kept, so a lower agent cannot take its upline's lock over.
var levelToRecord = (lock, level) => {
  const held = lock?.is_locked && Number.isInteger(lock?.locked_level) ? lock.locked_level : null;
  if (!Number.isInteger(level)) return held;
  return held == null ? level : Math.min(held, level);
};

export { LOCKED_BY_UPLINE, actorLevel, heldAbove, levelToRecord };
