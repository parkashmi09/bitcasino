'use strict';

/**
 * Original Games lock: an operator lock on the Original Games aggregator
 * (casino-service `modules/original-games` — Arrow Bow, Diamonds, Keno, Limbo,
 * Mines, Plinko), separate from the casino lock.
 *
 *   users.originals_locked, staff.originals_locked   BOOLEAN NOT NULL DEFAULT false
 *
 * A fifth lock column beside `system_locked`, `casino_locked`,
 * `sports_betlocked` and `withdraw_locked` (migration 091), set through the same
 * route (`POST /admin/locks`, `originals: true|false`), cascaded to an agent's
 * subtree and recorded in `lock_sources` like the others — `lockSources.js`
 * reads its column list from `LOCK_FIELDS`.
 *
 * From here `casino_locked` covers provider casino only; Original Games launch
 * and bets refuse `originals_locked` (or `system_locked`) instead.
 *
 * Also re-creates the `realtime_account_changed` trigger (migration 113) so a
 * change of the new column pushes `account_changed` like the other locks.
 *
 * Idempotent. `down` restores the 113 trigger, drops both columns and the
 * `originals_locked` key from `lock_sources`.
 */

const TABLES = ['users', 'staff'];
const LOCK_COLUMNS = ['system_locked', 'casino_locked', 'sports_betlocked', 'withdraw_locked'];

/** The 113 trigger, watching `columns` (constants above, never input). */
async function accountTrigger(sequelize, transaction, columns) {
  await sequelize.query('DROP TRIGGER IF EXISTS realtime_account_changed ON public.users', { transaction });
  await sequelize.query(
    `CREATE TRIGGER realtime_account_changed
       AFTER UPDATE OF status, ${columns.join(', ')} ON public.users
       FOR EACH ROW
       WHEN (OLD.status IS DISTINCT FROM NEW.status
          ${columns.map((c) => `OR OLD.${c} IS DISTINCT FROM NEW.${c}`).join('\n          ')})
       EXECUTE FUNCTION realtime_account_changed()`,
    { transaction }
  );
}

async function up({ sequelize, transaction, logger }) {
  for (const table of TABLES) {
    // Identifiers come from the constant list above, never from input.
    await sequelize.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS originals_locked BOOLEAN NOT NULL DEFAULT false`,
      { transaction }
    );
    logger?.info(`${table}.originals_locked present`);
  }
  await accountTrigger(sequelize, transaction, [...LOCK_COLUMNS, 'originals_locked']);
}

async function down({ sequelize, transaction, logger }) {
  await accountTrigger(sequelize, transaction, LOCK_COLUMNS);
  for (const table of TABLES) {
    await sequelize.query(
      `UPDATE ${table} SET lock_sources = lock_sources - 'originals_locked' WHERE jsonb_exists(lock_sources, 'originals_locked')`,
      { transaction }
    );
    await sequelize.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS originals_locked`, { transaction });
  }
  logger?.warn('Dropped users.originals_locked and staff.originals_locked');
}

module.exports = { up, down };
