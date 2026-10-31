'use strict';

/**
 * The vault's lock terms.
 *
 * ── WHY THIS SEEDER EXISTS ───────────────────────────────────────────────
 *
 * `migrations/010-vault-schema.js` creates `vault_lock_rates` and inserts
 * nothing, and no other seeder fills it. With the table empty:
 *
 *   `GET  /user/vault/lock-options`  answers `200 []`
 *   `POST /user/vault/transfer-in`   throws `LOCK_PERIOD_NOT_FOUND` for every
 *                                    `lockPeriod` a caller can name
 *
 * So the vault reads fine and cannot accept a single deposit — which looks
 * like a broken endpoint rather than an unconfigured product. The wallet's
 * vault modal says so instead of posting into nothing, but a developer running
 * this platform has no way to exercise transfer-in at all.
 *
 * ── THESE ARE DEVELOPMENT DEFAULTS, NOT A PRODUCT DECISION ───────────────
 *
 * Terms and rates are operator configuration: `POST /admin/vault/lock-periods`
 * (CONFIG_WRITE) adds one and `PUT /admin/vault/lock-periods/rate` changes a
 * rate, both audited. An operator setting up a real deployment should use
 * those. What is seeded here is the smallest ladder that makes every path
 * reachable — a no-notice term so a player can move money in and straight back
 * out, and three fixed terms so the matured/immature branches in
 * `transfer-out` can both be hit.
 *
 * The rates are plausible, not researched. They exist so `vault_interest_history`
 * has something to accrue against.
 *
 * `lock_period` is the key the API passes around, and it is UNIQUE — so this is
 * idempotent on it and a term an operator has since edited is left alone.
 */

const LOCK_TERMS = [
  { lock_period: 'flexible', label: 'Flexible', days: 0, rate: '1.0000' },
  { lock_period: '7d', label: '7 Days', days: 7, rate: '3.5000' },
  { lock_period: '30d', label: '30 Days', days: 30, rate: '7.5000' },
  { lock_period: '90d', label: '90 Days', days: 90, rate: '12.0000' },
];

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  for (const term of LOCK_TERMS) {
    const [existing] = await sequelize.query(
      'SELECT id FROM vault_lock_rates WHERE lock_period = :lock_period LIMIT 1',
      { replacements: term, type: QueryTypes.SELECT, transaction }
    );

    if (existing) {
      logger?.info(`Vault term "${term.lock_period}" already configured (id ${existing.id})`);
      continue;
    }

    const [inserted] = await sequelize.query(
      `INSERT INTO vault_lock_rates (lock_period, label, days, rate, is_active, "createdAt", "updatedAt")
       VALUES (:lock_period, :label, :days, :rate, true, now(), now())
       RETURNING id`,
      { replacements: term, type: QueryTypes.SELECT, transaction }
    );

    logger?.info(`Configured vault term "${term.lock_period}" at ${term.rate}% (id ${inserted.id})`);
  }

  // Sample principal deductions for dev (early exit is always available).
  await sequelize.query(
    `UPDATE vault_lock_rates
        SET early_penalty_rate = CASE lock_period
              WHEN '30d' THEN 5
              WHEN '90d' THEN 8
              ELSE COALESCE(early_penalty_rate, 0)
            END
      WHERE lock_period IN ('30d', '90d')`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DELETE FROM vault_lock_rates WHERE lock_period IN (:periods)', {
    replacements: { periods: LOCK_TERMS.map((t) => t.lock_period) },
    transaction,
  });
}

module.exports = { up, down, LOCK_TERMS };
