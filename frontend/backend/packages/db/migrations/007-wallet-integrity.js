'use strict';

/**
 * Make the wallet safe to write concurrently.
 *
 * Three problems in the baseline schema, all of which cost real money:
 *
 * 1. `credits` has NO PRIMARY KEY and no unique constraint on `uid`.
 *    The generated model says so in its own header. Two rows for one player
 *    means `UPDATE credits SET inr = inr - 100 WHERE uid = 5` debits BOTH, and
 *    `SELECT ... FOR UPDATE` locks whichever the planner happens to return —
 *    so the row lock that makes concurrent betting safe is locking a row that
 *    may not be the one the next query reads.
 *
 * 2. `credits_ledger` has no idempotency key. Casino and sports retry on
 *    timeout, and a retried "settle bet 123" pays out twice. The key has to be
 *    enforced by a UNIQUE INDEX rather than an application check, because two
 *    concurrent retries can both pass a SELECT before either INSERTs.
 *
 * 3. `credits_ledger` has no index supporting `WHERE user_id = ? ORDER BY
 *    created_at DESC` — the query behind every player statement and every
 *    agent report.
 *
 * Every step is conditional so the migration is safe to re-run and safe on a
 * database that was partially fixed by hand.
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  // ══ 1. credits.uid must be unique ═══════════════════════════════════
  const [creditsUnique] = await sequelize.query(
    `SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'credits' AND indexname = 'credits_uid_key'`,
    { type: QueryTypes.SELECT, transaction }
  );

  if (creditsUnique) {
    logger?.info('credits.uid is already unique — skipping');
  } else {
    const duplicates = await sequelize.query(
      'SELECT uid, COUNT(*)::int AS count FROM credits GROUP BY uid HAVING COUNT(*) > 1 LIMIT 10',
      { type: QueryTypes.SELECT, transaction }
    );

    if (duplicates.length) {
      // Merging duplicate wallets is a decision about whose money is whose.
      // That is not something a migration gets to guess at.
      throw new Error(
        `Cannot make credits.uid unique: ${duplicates.length}+ player(s) have more than one wallet row ` +
          `(e.g. ${duplicates.map((d) => `uid ${d.uid} x${d.count}`).join(', ')}). ` +
          `Each duplicate holds a separate balance — reconcile them by hand before migrating, ` +
          `because merging them is a decision about whose money is whose.`
      );
    }

    const [nullUid] = await sequelize.query(
      'SELECT COUNT(*)::int AS count FROM credits WHERE uid IS NULL',
      { type: QueryTypes.SELECT, transaction }
    );
    if (nullUid.count > 0) {
      throw new Error(`credits contains ${nullUid.count} row(s) with a null uid — an unownable balance.`);
    }

    await sequelize.query('ALTER TABLE credits ADD CONSTRAINT credits_uid_key UNIQUE (uid)', { transaction });
    logger?.info('credits.uid is now unique — one wallet row per player');
  }

  // ══ 2. Idempotency on the ledger ════════════════════════════════════
  const columns = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'credits_ledger'`,
    { type: QueryTypes.SELECT, transaction }
  );
  const existing = new Set(columns.map((c) => c.column_name));

  if (!existing.has('idempotency_key')) {
    await sequelize.query('ALTER TABLE credits_ledger ADD COLUMN idempotency_key VARCHAR(120)', { transaction });
    logger?.info('Added credits_ledger.idempotency_key');
  }

  if (!existing.has('source_service')) {
    await sequelize.query('ALTER TABLE credits_ledger ADD COLUMN source_service VARCHAR(50)', { transaction });
    logger?.info('Added credits_ledger.source_service');
  }

  // PARTIAL unique index: historical rows have a null key and must stay
  // insertable. In Postgres nulls are distinct anyway, but `WHERE ... IS NOT
  // NULL` keeps the index small — it only ever covers rows that use a key.
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS credits_ledger_idempotency_key_uq
       ON credits_ledger (idempotency_key)
       WHERE idempotency_key IS NOT NULL`,
    { transaction }
  );

  // ══ 3. The indexes the statement queries actually need ══════════════
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS credits_ledger_user_created_idx
       ON credits_ledger (user_id, created_at DESC)`,
    { transaction }
  );

  // Settlement void looks up by (match_id, market_type); see the settlement
  // module. Without this it is a sequential scan of the whole ledger.
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS credits_ledger_match_market_idx
       ON credits_ledger (match_id, market_type)
       WHERE bet_id IS NOT NULL`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS wallet_history_uid_time_idx
       ON wallet_history (uid, transaction_time DESC)`,
    { transaction }
  );

  logger?.info('Wallet integrity constraints and indexes are in place');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP INDEX IF EXISTS credits_ledger_idempotency_key_uq', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS credits_ledger_user_created_idx', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS credits_ledger_match_market_idx', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS wallet_history_uid_time_idx', { transaction });

  // The columns are left in place: dropping them destroys the idempotency
  // record, and a re-run of `up` would then happily replay every movement that
  // was already applied.
  logger?.warn(
    'Dropped wallet indexes. credits_ledger.idempotency_key and .source_service were KEPT — ' +
      'dropping them would erase the record of which movements have already been applied.'
  );

  // credits_uid_key is also kept: removing it re-opens the duplicate-wallet
  // hole, and nothing depends on its absence.
}

module.exports = { up, down };
