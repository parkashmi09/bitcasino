'use strict';

/**
 * Welcome bonuses — the registration bonus switch and the first-deposit bonus.
 *
 * All on `siteconfig`, next to `registerbonus`, because they are platform
 * settings the site admin edits on the Site config screen and user-service
 * reads over the internal admin API (it never loads the `admin` model domain).
 *
 * ── register_bonus_enabled ───────────────────────────────────────────────
 *
 * The amount alone used to be the switch: anything above zero was paid. An
 * explicit switch lets the operator keep an amount stored and still pay nobody.
 * Backfilled ON where an amount above zero is already stored, so a site that
 * pays a registration bonus today keeps paying it after this migration.
 *
 * ── first_deposit_bonus_* ────────────────────────────────────────────────
 *
 *   enabled           off by default — nothing is paid until the operator turns it on
 *   tiers             JSONB list of { minDeposit, percent, maxBonus }, all in USD.
 *                     The highest tier whose minDeposit <= the deposit (converted
 *                     to USD through `exchangerate`) applies; the bonus is
 *                     min(deposit × percent / 100, maxBonus), credited in USDT
 *                     (REWARD_CURRENCY). maxBonus 0 = no cap.
 *   wager_multiplier  optional rollover on the bonus (null = none). See
 *                     firstDepositBonus.service.js in user-service.
 *
 * "Exactly once per player" is not stored here: the bonus credit carries the
 * idempotency key `first-deposit-bonus:<userId>`, and `credits_ledger` has a
 * UNIQUE index on `idempotency_key` with no time window, so a second payment
 * to the same player cannot be inserted.
 */

const COLUMNS = [
  { column: 'register_bonus_enabled', ddl: 'boolean DEFAULT false NOT NULL' },
  { column: 'first_deposit_bonus_enabled', ddl: 'boolean DEFAULT false NOT NULL' },
  { column: 'first_deposit_bonus_tiers', ddl: "jsonb DEFAULT '[]'::jsonb NOT NULL" },
  { column: 'first_deposit_bonus_wager_multiplier', ddl: 'numeric(10,2)' },
];

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  let addedSwitch = false;
  for (const { column, ddl } of COLUMNS) {
    const [existing] = await sequelize.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'siteconfig'
          AND column_name = :column`,
      { transaction, type: QueryTypes.SELECT, replacements: { column } }
    );
    if (existing) {
      logger?.info(`siteconfig.${column} already present — nothing to do`);
      continue;
    }
    await sequelize.query(`ALTER TABLE siteconfig ADD COLUMN ${column} ${ddl}`, { transaction });
    if (column === 'register_bonus_enabled') addedSwitch = true;
    logger?.info(`Added siteconfig.${column}`);
  }

  // Keep today's behaviour: a stored amount above zero was being paid.
  if (addedSwitch) {
    await sequelize.query(
      'UPDATE siteconfig SET register_bonus_enabled = true WHERE COALESCE(registerbonus, 0) > 0',
      { transaction }
    );
  }
}

async function down({ sequelize, transaction, logger }) {
  for (const { column } of COLUMNS) {
    await sequelize.query(`ALTER TABLE siteconfig DROP COLUMN IF EXISTS ${column}`, { transaction });
  }
  logger?.warn('Dropped the welcome bonus columns from siteconfig');
}

module.exports = { up, down };
