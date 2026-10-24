'use strict';

/**
 * `seamless_transactions` — every money instruction the casino provider sends.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THERE WAS NO DUPLICATE DETECTION AT ALL
 *
 * The legacy seamless handlers called this before every bet and every win:
 *
 *     const checkDuplicateTransaction = async (transaction_id) => {
 *       // Implement your logic to check for duplicate transactions in the database
 *       return false; // Mock response
 *     };
 *
 * A stub that always says "not a duplicate". Casino providers retry hard — a
 * timeout on our side, a slow response, a network blip — and every retry of a
 * win was paid again, of a bet charged again. Nothing anywhere recorded that a
 * transaction id had been seen.
 *
 * This table is that record, and the unique index is what enforces it. Not an
 * application check: two retries arriving together both read "not seen" before
 * either writes, and only a constraint decides between them.
 *
 * ── IT IS ALSO THE REPLAY DEFENCE ────────────────────────────────────────
 *
 * The provider's signature is `md5(operator_code + request_time + action +
 * SECRET_KEY)` — it covers the ACTION and nothing else. Not the member, not the
 * amount, not the transaction list. So a captured signature is valid for any
 * request of that action, and `request_time` is a caller-supplied field.
 *
 * Two things narrow that, and neither needs the provider to change anything:
 *
 *   A FRESHNESS WINDOW on `request_time` (in the service), so a captured
 *   signature stops working after a few minutes rather than never.
 *
 *   THIS TABLE, so a captured transaction id cannot be spent twice — an
 *   attacker replaying a signature has to invent transaction ids, and those
 *   carry no prior bet to settle against.
 *
 * The signature itself is the provider's design and cannot be fixed from here.
 * ─────────────────────────────────────────────────────────────────────────
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS seamless_transactions (
       id                BIGSERIAL PRIMARY KEY,

       -- The provider's own id for this movement. THE idempotency key.
       transaction_id    VARCHAR(190) NOT NULL,
       -- withdraw | deposit | transfer | rollback | cancel | pushbet
       action            VARCHAR(20)  NOT NULL,

       member_account    VARCHAR(120) NOT NULL,
       user_id           BIGINT,
       operator_code     VARCHAR(60),
       product_code      VARCHAR(60),
       game_code         VARCHAR(120),
       round_id          VARCHAR(190),

       -- As the provider quoted it, before any scaling.
       currency          VARCHAR(10)  NOT NULL,
       provider_amount   NUMERIC(30,8) NOT NULL DEFAULT 0,
       -- What actually moved, in the settlement currency.
       amount            NUMERIC(30,8) NOT NULL DEFAULT 0,

       -- The ledger row this produced, so a movement can be traced both ways.
       ledger_id         BIGINT,

       -- For a rollback or cancel: which transaction it reverses.
       reverses_id       VARCHAR(190),

       payload           JSONB,
       created_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * ONE row per provider transaction id, per action.
   *
   * Keyed on the action too, because a provider legitimately sends the same
   * round id for a bet and its win. The transaction id alone is unique in the
   * provider's documentation, but the pair costs nothing and does not depend
   * on that being true.
   */
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_seamless_transaction
       ON seamless_transactions (transaction_id, action)`,
    { transaction }
  );

  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_seamless_member ON seamless_transactions (member_account, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_seamless_user ON seamless_transactions (user_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_seamless_round ON seamless_transactions (round_id)',
    // "Which transaction does this rollback reverse" has to be fast: it runs
    // inside the rollback path, which the provider retries.
    'CREATE INDEX IF NOT EXISTS idx_seamless_reverses ON seamless_transactions (reverses_id)',
  ]) {
    await sequelize.query(sql, { transaction });
  }

  logger?.info('Created seamless_transactions — the casino integration had NO duplicate detection');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping seamless_transactions removes the ONLY duplicate detection on casino money movements. ' +
        'Every provider retry would be paid again. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS seamless_transactions', { transaction });
  logger?.warn('Dropped seamless_transactions — casino retries will be double-paid');
}

module.exports = { up, down };
