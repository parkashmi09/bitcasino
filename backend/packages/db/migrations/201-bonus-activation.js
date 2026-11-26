'use strict';

/**
 * `player_bonuses.activated_at` — when a bonus became usable (user, 2026-11-24).
 *
 * Loss bonus with "Requires a new deposit" on (Limits and policy → Loss bonus): it is granted with
 * `activated_at = NULL` and the stakes skip it until the player's next deposit credited after the
 * grant sets it (`PlayerBonusService.activateOnDeposit`). Every other grant gets the default
 * (usable at once), and every existing row is backfilled with its `granted_at`, so nothing that
 * exists today changes.
 *
 * `unlock_mode` is TEXT (migration 136); the new 'stake_share' value needs no schema change.
 */
async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('ALTER TABLE player_bonuses ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ DEFAULT NOW()');
  await q('UPDATE player_bonuses SET activated_at = granted_at WHERE activated_at IS NULL');
  await q(
    'CREATE INDEX IF NOT EXISTS player_bonuses_waiting_deposit ON player_bonuses (user_id) WHERE activated_at IS NULL AND status = \'active\''
  );
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('DROP INDEX IF EXISTS player_bonuses_waiting_deposit');
  await q('ALTER TABLE player_bonuses DROP COLUMN IF EXISTS activated_at');
}

module.exports = { up, down };
