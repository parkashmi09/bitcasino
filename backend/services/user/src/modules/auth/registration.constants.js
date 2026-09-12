'use strict';

/**
 * The shape of a newly created player.
 *
 * Duplicated deliberately from `services/admin/src/modules/players` rather than
 * shared: the two services own different halves of the platform and neither
 * should import the other's module. What matters is that they AGREE, which the
 * values below and the comment in each place are for.
 *
 * Legacy had three copies of this INSERT — two commented out, one live — with
 * different column lists.
 */

/** `users.role_id` for a player. Legacy inlined the literal `6`, unlabelled. */
const PLAYER_ROLE_ID = 6;

/**
 * The empty wallet blob.
 *
 * Legacy also seeded `profit`, `profit_low` and `profit_high` from a `BALANCE`
 * constant. Nothing in the ported code reads those three, so they are left to
 * their column defaults rather than seeded with a shape this port cannot vouch
 * for.
 */
const WALLET_SEED = JSON.stringify({});

module.exports = { PLAYER_ROLE_ID, WALLET_SEED };
