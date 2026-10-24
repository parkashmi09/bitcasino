'use strict';

/**
 * What can be locked, and the column that holds it.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * TWO OF LEGACY'S THREE COLUMN NAMES DO NOT EXIST
 *
 * `locksystem/controller.js` reads exactly these three fields off the body and
 * builds its SET clause from their names:
 *
 *     const { user_id, staff_id,
 *             all_system_blocked, casino_blocked, sports_betlocked } = req.body
 *
 *     let updateObject = {
 *       ...(all_system_blocked !== undefined && { all_system_blocked }),
 *       ...(casino_blocked     !== undefined && { casino_blocked }),
 *       ...(sports_betlocked   !== undefined && { sports_betlocked })
 *     }
 *     const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
 *     …
 *     `UPDATE users SET ${setClause} WHERE id = $N`
 *
 * The columns on `users` are `system_locked`, `casino_locked` and
 * `sports_betlocked`. On `staff` they are `system_locked`, `casino_locked` and
 * `sports_betlocked`. There is no `all_system_blocked` and no `casino_blocked`
 * on either table.
 *
 * So the ONLY field of the three that ever worked is `sports_betlocked`. A
 * request naming either of the others produced
 *
 *     column "all_system_blocked" of relation "users" does not exist
 *
 * which the handler caught, rolled back and answered as a generic 500 — and
 * because the three are combined into ONE statement, a request that set the
 * sports lock ALONGSIDE either of the others failed entirely and locked
 * nothing at all.
 *
 * The names below are the columns that are actually there. The legacy body
 * field names are accepted as aliases so an existing caller keeps working —
 * and now does something.
 * ═════════════════════════════════════════════════════════════════════════
 */
const LOCK_FIELDS = Object.freeze({
  /** Out of the platform entirely. Legacy called this `all_system_blocked`. */
  system: 'system_locked',
  /** Legacy called this `casino_blocked`. */
  casino: 'casino_locked',
  /** The one legacy name that matched a real column. */
  sports: 'sports_betlocked',
});

/**
 * The legacy body field names, mapped to the ones above.
 *
 * Accepted so a client written against the old API keeps working. Two of the
 * three did nothing before; they do the obvious thing now.
 */
const LEGACY_FIELD_ALIASES = Object.freeze({
  all_system_blocked: 'system',
  casino_blocked: 'casino',
  sports_betlocked: 'sports',
});

module.exports = { LOCK_FIELDS, LEGACY_FIELD_ALIASES };
