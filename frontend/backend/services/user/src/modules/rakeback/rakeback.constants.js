'use strict';

/**
 * Rakeback constants.
 *
 * ── WHY `users.rakeamount` AND NOT `users.rakeback` ──────────────────────
 *
 * The table has both, and legacy read only the first:
 *
 *     SELECT rakeamount FROM users WHERE id = $1
 *
 * `rakeamount` is the ACCRUED, claimable balance — it is what the claim
 * credits and then resets to zero. `rakeback` is the player's rate, written by
 * the VIP path and never read here. They are one letter apart on two columns
 * that mean completely different things, which is worth naming once rather
 * than rediscovering at a support desk.
 */

/** The claimable balance. Credited and zeroed by a claim. */
const ACCRUED_COLUMN = 'rakeamount';

/**
 * Rakeback is denominated in USDT.
 *
 * Legacy hardcoded the column: `UPDATE credits SET usdt = usdt + $2`. Named
 * here because the wallet takes a currency code, and "which balance does a
 * rakeback claim land in" is a product decision that should be visible.
 */
const RAKEBACK_CURRENCY = 'USDT';

/**
 * The smallest claim worth making.
 *
 * Legacy's guard was `if (rakebackNum)` — a JavaScript truthiness test on a
 * number parsed from a NUMERIC column. `0.00000001` passes it, so a player
 * could claim a hundred-millionth of a tether, and each claim wrote four rows.
 */
const MIN_CLAIM = '0.01';

/** The ledger reason. It appears in the player's statement. */
const REASON = Object.freeze({ CLAIM: 'rakeback_claim' });

module.exports = { ACCRUED_COLUMN, RAKEBACK_CURRENCY, MIN_CLAIM, REASON };
