'use strict';

/**
 * The role id a player carries.
 *
 * Legacy hardcoded the literal `6` inside the INSERT's column list, unlabelled:
 *
 *     (… parent_staff_id, role_id, …) VALUES ($1,…,$8, 6, …)
 *
 * Named here so a schema change to `roles` has one place to be reflected.
 */
const PLAYER_ROLE_ID = 6;

/** bcrypt cost. Matches what the rest of this port uses for staff. */
const PASSWORD_ROUNDS = 10;

/** `users.status` for an account that has been closed. */
const CLOSED_STATUS = 'closed';

/**
 * The empty wallet blob a new player starts with.
 *
 * Legacy built three of these — `wallet`, `profit_low`, `profit_high` and
 * `profit` — from module-level `WALLET` and `BALANCE` constants and
 * `JSON.stringify`d each into the INSERT. Only `wallet` has a reader in the
 * ported code; the profit columns are written by nothing and read by nothing,
 * so they are left to their column defaults rather than seeded with a shape
 * this port cannot vouch for.
 */
const WALLET_SEED = JSON.stringify({});

module.exports = { PLAYER_ROLE_ID, PASSWORD_ROUNDS, CLOSED_STATUS, WALLET_SEED };
