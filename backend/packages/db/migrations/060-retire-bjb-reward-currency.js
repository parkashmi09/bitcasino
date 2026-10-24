'use strict';

/**
 * Retire BJB as a reward currency; rewards are paid in USDT.
 *
 * BJB was a bonus-only coin. VIP level-ups and rank-ups, the affiliate
 * programme (register / joining bonus, tier unlocks), club rewards and — by
 * default — the periodic VIP bonus now pay in USDT (`REWARD_CURRENCY` in
 * @ibitplay/common), and the wallet refuses to credit a retired coin.
 *
 * This migration makes the stored settings agree:
 *
 *   - column defaults → 'USDT' for siteconfig.bonus_currency,
 *     register_bonus_currency, affiliate_bonus_currency,
 *     club_earnings_log.currency, and unlocked_rewards.cointype (was 'sbc', a
 *     coin with no wallet column at all; the service always sets it).
 *   - siteconfig values that still name BJB → 'USDT' (register, affiliate,
 *     bonus and rakeback currency). Any other value is the operator's choice
 *     and is left alone.
 *
 * It does NOT touch balances: `credits.bjb`, `bank.bjb` and the `siteconfig.bjb`
 * flag column stay, so an existing BJB balance is still readable and can be
 * spent or swapped out. Nor does it rewrite reward rows already recorded in
 * BJB — they are history; the service pays an unclaimed one in USDT.
 *
 * Idempotent: each step checks the column exists and only rewrites BJB values.
 * `down` restores the previous column defaults only — it cannot know which
 * rows were BJB before, and putting BJB back into a setting would make every
 * claim fail now that the wallet refuses it.
 */

const DEFAULTS = [
  { table: 'siteconfig', column: 'bonus_currency', previous: "'BJB'::text" },
  { table: 'siteconfig', column: 'register_bonus_currency', previous: "'BJB'::text" },
  { table: 'siteconfig', column: 'affiliate_bonus_currency', previous: "'BJB'::text" },
  { table: 'club_earnings_log', column: 'currency', previous: "'BJB'::character varying" },
  { table: 'unlocked_rewards', column: 'cointype', previous: "'sbc'::text" },
];

const SITECONFIG_VALUES = [
  'bonus_currency',
  'rakeback_currency',
  'register_bonus_currency',
  'affiliate_bonus_currency',
];

async function columnExists(sequelize, transaction, table, column) {
  const { QueryTypes } = require('sequelize');
  const rows = await sequelize.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = :table
        AND column_name = :column`,
    { transaction, type: QueryTypes.SELECT, replacements: { table, column } }
  );
  return rows.length > 0;
}

async function up({ sequelize, transaction, logger }) {
  for (const { table, column } of DEFAULTS) {
    if (!(await columnExists(sequelize, transaction, table, column))) {
      logger?.info(`${table}.${column} not present — skipped`);
      continue;
    }
    // Identifiers come from the constant list above, never from input.
    await sequelize.query(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT 'USDT'`, { transaction });
    logger?.info(`${table}.${column} now defaults to USDT`);
  }

  for (const column of SITECONFIG_VALUES) {
    if (!(await columnExists(sequelize, transaction, 'siteconfig', column))) continue;
    const [, meta] = await sequelize.query(
      `UPDATE siteconfig SET ${column} = 'USDT' WHERE UPPER(TRIM(${column})) = 'BJB'`,
      { transaction }
    );
    const rows = meta?.rowCount ?? 0;
    if (rows) logger?.info({ rows }, `siteconfig.${column}: BJB → USDT`);
  }
}

async function down({ sequelize, transaction, logger }) {
  for (const { table, column, previous } of DEFAULTS) {
    if (!(await columnExists(sequelize, transaction, table, column))) continue;
    await sequelize.query(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${previous}`, { transaction });
  }
  logger?.warn('Restored the pre-060 column defaults (BJB / sbc); stored values left as USDT');
}

module.exports = { up, down };
