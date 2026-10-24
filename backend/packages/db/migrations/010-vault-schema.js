'use strict';

/**
 * The Vault Pro schema — fixed-term interest-bearing deposits.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PART RECONSTRUCTED, PART CORRECTIVE.
 *
 * `vault_pro` exists in the baseline, but with only six columns:
 * `userid, vaultBalance, coin, createdAt, updatedAt, incomeDate`.
 * `legacy/vaultpro/controller.js` additionally reads and writes `id`,
 * `lock_period`, `interest_rate`, `startTime`, `endTime` and `status`, and
 * queries three tables that do not exist anywhere: `vault_lock_rates`,
 * `vault_transactions` and `vault_interest_history`.
 *
 * Two corrections are made rather than reproduced:
 *
 *   1. `vault_pro.vaultBalance` is BIGINT in the baseline. A vault balance is
 *      money, and BIGINT cannot hold 0.5 USDT — every fractional deposit would
 *      truncate to zero. It is widened to NUMERIC(30,8), matching `credits`
 *      and `credits_ledger`. Widening is lossless for any value already stored.
 *
 *   2. `vault_pro` has no primary key, yet the legacy code selects
 *      `WHERE id=$1`. A `id` column is added with a sequence and made the
 *      primary key, the same treatment migration 003 gave `bets`.
 *
 * The three new tables are reconstructed from the queries. Column names are
 * reliable (they are written out); types and constraints are inferred. The
 * camelCase quoted names (`"createdAt"`, `"startTime"`) are kept because the
 * legacy queries quote them exactly that way and `vault_pro` already does.
 * ─────────────────────────────────────────────────────────────────────────
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  // ══ 1. Correct vault_pro ════════════════════════════════════════════
  const existing = await sequelize.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vault_pro'`,
    { type: QueryTypes.SELECT, transaction }
  );
  const columns = new Map(existing.map((c) => [c.column_name, c.data_type]));

  if (columns.get('vaultBalance') === 'bigint') {
    await sequelize.query(
      'ALTER TABLE vault_pro ALTER COLUMN "vaultBalance" TYPE NUMERIC(30,8)',
      { transaction }
    );
    logger?.info('Widened vault_pro."vaultBalance" from BIGINT to NUMERIC(30,8)');
  }

  const additions = [
    ['id', 'BIGINT'],
    ['lock_period', 'VARCHAR(50)'],
    ['interest_rate', 'NUMERIC(10,4)'],
    ['startTime', 'TIMESTAMPTZ'],
    ['endTime', 'TIMESTAMPTZ'],
    ['status', "VARCHAR(20) DEFAULT 'active'"],
  ];

  for (const [name, type] of additions) {
    if (columns.has(name)) continue;
    await sequelize.query(`ALTER TABLE vault_pro ADD COLUMN "${name}" ${type}`, { transaction });
    logger?.info(`Added vault_pro."${name}"`);
  }

  // Give `id` a sequence and make it the key, so `WHERE id=$1` resolves a row.
  if (!columns.has('id')) {
    await sequelize.query('CREATE SEQUENCE IF NOT EXISTS vault_pro_id_seq', { transaction });
    await sequelize.query(
      `ALTER TABLE vault_pro ALTER COLUMN id SET DEFAULT nextval('vault_pro_id_seq')`,
      { transaction }
    );
    await sequelize.query("UPDATE vault_pro SET id = nextval('vault_pro_id_seq') WHERE id IS NULL", { transaction });
    await sequelize.query('ALTER TABLE vault_pro ALTER COLUMN id SET NOT NULL', { transaction });

    const [pk] = await sequelize.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'vault_pro_pkey'`,
      { type: QueryTypes.SELECT, transaction }
    );
    if (!pk) {
      await sequelize.query('ALTER TABLE vault_pro ADD CONSTRAINT vault_pro_pkey PRIMARY KEY (id)', { transaction });
      logger?.info('Added primary key vault_pro_pkey');
    }
  }

  // ══ 2. Lock terms on offer ══════════════════════════════════════════
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS vault_lock_rates (
       id           SERIAL PRIMARY KEY,
       -- The key the UI and the deposit path pass around, e.g. '30d'.
       lock_period  VARCHAR(50)  NOT NULL UNIQUE,
       label        VARCHAR(100) NOT NULL,
       days         INTEGER      NOT NULL,
       -- Annual rate as a percentage: 7.5 means 7.5%.
       rate         NUMERIC(10,4) NOT NULL,
       is_active    BOOLEAN      NOT NULL DEFAULT true,
       "createdAt"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       "updatedAt"  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  // ══ 3. Movements in and out of the vault ════════════════════════════
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS vault_transactions (
       id          BIGSERIAL PRIMARY KEY,
       userid      BIGINT       NOT NULL,
       coin        VARCHAR(20)  NOT NULL,
       amount      NUMERIC(30,8) NOT NULL,
       -- 'transfer_in' | 'transfer_out', as written by the legacy handlers.
       type        VARCHAR(30)  NOT NULL,
       deposit_id  BIGINT,
       "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  // ══ 4. Interest paid, per accrual ═══════════════════════════════════
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS vault_interest_history (
       id          BIGSERIAL PRIMARY KEY,
       userid      BIGINT       NOT NULL,
       coin        VARCHAR(20)  NOT NULL,
       deposit_id  BIGINT,
       -- The admin stats query sums this column by name.
       interest    NUMERIC(30,8) NOT NULL,
       rate        NUMERIC(10,4),
       "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  const indexes = [
    'CREATE INDEX IF NOT EXISTS vault_pro_user_idx ON vault_pro (userid, coin)',
    `CREATE INDEX IF NOT EXISTS vault_pro_maturity_idx ON vault_pro ("endTime") WHERE status = 'active'`,
    'CREATE INDEX IF NOT EXISTS vault_transactions_user_idx ON vault_transactions (userid, "createdAt" DESC)',
    'CREATE INDEX IF NOT EXISTS vault_interest_user_idx ON vault_interest_history (userid, "createdAt" DESC)',
    // Plain column, not an expression index on `"createdAt"::date`.
    //
    // Casting a TIMESTAMPTZ to DATE is not IMMUTABLE — the result depends on
    // the session time zone — so Postgres refuses it in an index. The legacy
    // daily-total query was `WHERE DATE("createdAt") = CURRENT_DATE`, which
    // could not have used such an index anyway. A half-open range
    // (`>= start AND < start + 1 day`) uses this one and is sargable.
    'CREATE INDEX IF NOT EXISTS vault_interest_date_idx ON vault_interest_history ("createdAt")',
  ];
  for (const sql of indexes) await sequelize.query(sql, { transaction });

  logger?.info('Vault schema is in place (vault_pro corrected, 3 tables RECONSTRUCTED)');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping the vault tables destroys every locked deposit and interest record. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if that is really intended.'
    );
  }

  for (const table of ['vault_interest_history', 'vault_transactions', 'vault_lock_rates']) {
    await sequelize.query(`DROP TABLE IF EXISTS ${table}`, { transaction });
  }

  // vault_pro is NOT reverted: narrowing `vaultBalance` back to BIGINT would
  // round every fractional balance to zero, and dropping the added columns
  // would discard the lock terms of every open deposit.
  logger?.warn('Dropped the vault side tables. vault_pro was left corrected on purpose.');
}

module.exports = { up, down };
