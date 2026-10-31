'use strict';

/**
 * What kind of account an operator action targets.
 *
 * Legacy spelled these `'STAFF'` and anything-else-means-player, checked with
 * `if (userType === 'STAFF')` in five places. Named, and validated against the
 * pair rather than falling through.
 */
const ACCOUNT_TYPE = Object.freeze({ STAFF: 'staff', USER: 'user' });
const ACCOUNT_TYPES = Object.freeze(Object.values(ACCOUNT_TYPE));

/** Account states, matching what `staff.status` and `users.status` hold. */
const ACCOUNT_STATUS = Object.freeze(['active', 'suspended', 'inactive']);
const BET_STATUS = Object.freeze(['active', 'suspended']);

const PASSWORD_ROUNDS = 12;

/**
 * `staff_transfers.transfer_type`.
 *
 *   transfer  — a staff transfer (`POST /admin/staff/transfer`), and every
 *               refill written before refills had their own type
 *   refill    — `POST /admin/accounts/refill` by an operator, from their float
 *   issuance  — the same by the platform owner: new money, no float debited
 *   adjust    — an agent-tree "adjust balance" (`/admin/user/wallet/adjust`),
 *               which is a transfer between the agent's float and the player
 *   direct    — owner ↔ DIRECT user (no parent). Paid from / back into the
 *               owner's Direct User balance (`staff_balances.inr`), never the
 *               owner's Agent System balance (`credits`)
 *   owner_topup — the owner adding to their Agent System balance (`credits`, from 'system')
 *   owner_direct_topup — the owner adding to their Direct User balance (`staff_balances`, from 'system')
 *   whitelabel_topup — the parent site's transfer into a whitelabel company's Direct User balance
 *   direct_to_agent — a whitelabel company moving its Direct User balance to its Agent System balance
 *   to_whitelabel — the parent Super Admin's Direct User balance sent to a whitelabel company
 *   whitelabel_refund — that transfer given back, when the copy refused it
 *   points_settle — zip ka points settlement: parent ↔ direct child ka P/L cash me barabar
 *   gt/casino — historical settlement rows; P&L, never money handed over
 */
const TRANSFER_TYPE = Object.freeze({
  TRANSFER: 'transfer',
  REFILL: 'refill',
  ISSUANCE: 'issuance',
  ADJUST: 'adjust',
  DIRECT: 'direct',
  OWNER_TOPUP: 'owner_topup',
  OWNER_DIRECT_TOPUP: 'owner_direct_topup',
  WHITELABEL_TOPUP: 'whitelabel_topup',
  DIRECT_TO_AGENT: 'direct_to_agent',
  TO_WHITELABEL: 'to_whitelabel',
  WHITELABEL_REFUND: 'whitelabel_refund',
  POINTS_SETTLE: 'points_settle',
});

/**
 * The types that are money actually handed to or taken from a PLAYER, and so
 * belong on a statement's deposit/withdraw lines. Settlement types stay out —
 * they would double-count against the per-bet rows.
 */
const PLAYER_FUNDING_TYPES = Object.freeze([
  TRANSFER_TYPE.TRANSFER,
  TRANSFER_TYPE.REFILL,
  TRANSFER_TYPE.ISSUANCE,
  TRANSFER_TYPE.ADJUST,
  TRANSFER_TYPE.DIRECT,
  TRANSFER_TYPE.POINTS_SETTLE, // player ka cash sach me badla, isliye statement me aata hai
]);

module.exports = {
  ACCOUNT_TYPE, ACCOUNT_TYPES, ACCOUNT_STATUS, BET_STATUS, PASSWORD_ROUNDS, TRANSFER_TYPE, PLAYER_FUNDING_TYPES,
};
