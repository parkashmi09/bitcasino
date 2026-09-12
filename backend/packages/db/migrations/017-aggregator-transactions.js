'use strict';

/**
 * `aggregator_transactions` — the three remaining casino wallet callbacks.
 *
 * `/processRequest` (asiaapi.net), `/gold_api` (nexusggreu.com) and
 * `/callback_evo` all move money, and between them they had:
 *
 *   NO AUTHENTICATION OF ANY KIND on any of the three. `/processRequest` in
 *   particular accepted `{cmd:"writeBet", login:<any player>, bet:"0.01",
 *   win:"1000000"}` from anyone who could reach the port, and credited it.
 *
 *   NO DUPLICATE DETECTION. None of the three recorded a provider transaction
 *   id anywhere it could be checked, so every retry settled again.
 *
 *   READ-COMPUTE-OVERWRITE balances (`UPDATE credits SET usdt = $1`), so two
 *   concurrent settlements lost one of themselves.
 *
 * ── WHY A NEW TABLE RATHER THAN THE THREE THAT EXIST ─────────────────────
 *
 * `transaction_live` and `transaction_slot` store money in BIGINT columns:
 *
 *     bet_money     bigint
 *     win_money     bigint
 *     user_balance  bigint
 *
 * Legacy inserted computed decimals into them, so Postgres rounded every value
 * to a whole unit on the way in. A 0.40 stake was recorded as 0, a 0.60 stake
 * as 1, and the "balance after" column was wrong by up to half a unit on every
 * row. Those tables cannot record what actually happened, and widening them in
 * place would reinterpret every historical row.
 *
 * `transactions` (asiaapi) is NUMERIC(12,2) and closer to usable, but it has no
 * unique key on `trade_id` and no user id — it stores `login` as free text.
 *
 * So the three legacy tables stay as the historical record, and this is where
 * settlements are recorded from now on. It is also read as a fifth source by
 * the bet-history module, so nothing disappears from the reports.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS aggregator_transactions (
       id              BIGSERIAL PRIMARY KEY,

       -- asia | nexus | evo
       aggregator      VARCHAR(20)  NOT NULL,
       -- The provider's own id for this movement. THE idempotency key.
       transaction_id  VARCHAR(190) NOT NULL,
       -- bet | win | settle | loss
       action          VARCHAR(20)  NOT NULL,

       user_id         BIGINT       NOT NULL,
       -- How the provider named the player, before we resolved it.
       member_account  VARCHAR(120),

       currency        VARCHAR(10)  NOT NULL,
       -- NUMERIC, not BIGINT. See the note above.
       stake           NUMERIC(30,8) NOT NULL DEFAULT 0,
       payout          NUMERIC(30,8) NOT NULL DEFAULT 0,
       -- Signed net: payout - stake. What actually moved.
       amount          NUMERIC(30,8) NOT NULL DEFAULT 0,

       game_code       VARCHAR(190),
       provider_code   VARCHAR(120),
       round_id        VARCHAR(190),

       -- The ledger row this produced, so a movement traces both ways.
       ledger_id       BIGINT,

       payload         JSONB,
       created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * ONE row per aggregator per transaction id.
   *
   * Keyed on the aggregator too, because three unrelated providers mint their
   * own ids and nothing stops two of them choosing the same string.
   */
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_aggregator_transaction
       ON aggregator_transactions (aggregator, transaction_id)`,
    { transaction }
  );

  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_aggregator_user ON aggregator_transactions (user_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_aggregator_round ON aggregator_transactions (round_id)',
  ]) {
    await sequelize.query(sql, { transaction });
  }

  logger?.info(
    'Created aggregator_transactions — the asia, nexus and evo callbacks had no duplicate detection and no authentication'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping aggregator_transactions removes the ONLY duplicate detection on three casino wallet callbacks. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS aggregator_transactions', { transaction });
  logger?.warn('Dropped aggregator_transactions — aggregator retries will be double-paid');
}

module.exports = { up, down };
