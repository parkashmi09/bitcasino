'use strict';

/**
 * Withdrawal block: an operator lock on money leaving an account.
 *
 *   users.withdraw_locked, staff.withdraw_locked   BOOLEAN NOT NULL DEFAULT false
 *
 * A fourth lock column beside `system_locked`, `casino_locked` and
 * `sports_betlocked`, set through the same route (`POST /admin/locks`,
 * `withdraw: true|false`). Locking an agent cascades to its whole subtree and
 * `lock_sources` (migration 062) records why each row is locked, exactly as for
 * the other three — `lockSources.js` reads its column list from `LOCK_FIELDS`,
 * so the JSONB needs no change: `{ "withdraw_locked": { own, by } }` is just
 * another key.
 *
 * NOT `users.withdraw_locked_until` (migration 044): that is the timed cooldown
 * after a password or 2FA change, which expires on its own. This one stays
 * until an operator lifts it.
 *
 * Every player payout path refuses a blocked account with WITHDRAW_BLOCKED
 * (403) before any money moves — `packages/common/src/withdrawBlock.js`.
 *
 * Idempotent (`ADD COLUMN IF NOT EXISTS`). `down` drops both columns and the
 * `withdraw_locked` key from `lock_sources`.
 */

const TABLES = ['users', 'staff'];

async function up({ sequelize, transaction, logger }) {
  for (const table of TABLES) {
    // Identifiers come from the constant list above, never from input.
    await sequelize.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS withdraw_locked BOOLEAN NOT NULL DEFAULT false`,
      { transaction }
    );
    logger?.info(`${table}.withdraw_locked present`);
  }
}

async function down({ sequelize, transaction, logger }) {
  for (const table of TABLES) {
    await sequelize.query(
      `UPDATE ${table} SET lock_sources = lock_sources - 'withdraw_locked' WHERE jsonb_exists(lock_sources, 'withdraw_locked')`,
      { transaction }
    );
    await sequelize.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS withdraw_locked`, { transaction });
  }
  logger?.warn('Dropped users.withdraw_locked and staff.withdraw_locked');
}

module.exports = { up, down };
