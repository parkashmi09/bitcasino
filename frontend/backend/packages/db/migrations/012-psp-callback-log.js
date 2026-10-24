'use strict';

/**
 * `psp_callback_log` — every provider callback we have ever accepted.
 *
 * Two jobs, one table.
 *
 * ── 1. A REPLAY GUARD THAT IS NOT PER-TRANSACTION ────────────────────────
 *
 * The wallet's idempotency key (`psp:<provider>:<reference>`) stops the same
 * transaction being credited twice. It does NOT stop a captured callback being
 * replayed against a DIFFERENT transaction, and CricPay's scheme makes that a
 * live attack:
 *
 *   POST /cricpay/payment-callback
 *   { transaction_code: "<which transaction>",   ← plaintext, unauthenticated
 *     data:             "<encrypted blob>" }     ← authenticated, but says
 *                                                  nothing about WHICH one
 *
 * The decrypted payload carries `transaction_status`, `transaction_amount`,
 * `transaction_fee` and `remark` — no transaction identity. So a player who
 * deposits ₹100 once, captures that blob, then opens a second pending ₹100
 * deposit can replay the old blob against the new `transaction_code` and be
 * credited again, indefinitely, for free.
 *
 * The amount check narrows it (the blob only settles a transaction of exactly
 * the amount it names) but does not close it. Refusing a payload digest we have
 * already accepted does close it: one blob settles one transaction, ever.
 *
 * ── 2. AN AUDIT TRAIL ────────────────────────────────────────────────────
 *
 * The legacy handlers logged callbacks to stdout, which means that when a
 * player disputes a deposit the evidence is a rotated container log. A
 * money-moving message from a third party is worth keeping.
 *
 * Rejected callbacks are recorded too (`accepted = FALSE`) — a burst of
 * signature failures against one reference is what an attack looks like from
 * the inside, and it is invisible if only successes are stored.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS psp_callback_log (
       id              BIGSERIAL PRIMARY KEY,
       provider        VARCHAR(30)  NOT NULL,
       reference       VARCHAR(255),

       -- SHA-256 over the exact bytes the provider signed. For CricPay that is
       -- the encrypted blob; for the others the canonical signed string. Hex,
       -- so 64 chars.
       payload_digest  CHAR(64)     NOT NULL,

       -- Did this callback move money? The audit answer.
       accepted        BOOLEAN      NOT NULL DEFAULT FALSE,

       -- Did this callback SPEND its digest? A different question, and keeping
       -- them apart matters.
       --
       -- A digest is only meaningful evidence when the provider's signature
       -- covers the transaction id — then one payload settles one transaction
       -- and a repeat is a replay. CricPay's does not, and its encryption is
       -- deterministic, so two honest deposits of the same amount produce
       -- identical bytes; reserving that digest would reject the second real
       -- payment. Those callbacks are accepted (via out-of-band confirmation)
       -- without reserving anything.
       --
       -- Folding this into "accepted" would have forced one of two lies in the
       -- audit trail: a settled payment recorded as not accepted, or a
       -- deterministic digest reserved and honest traffic refused.
       digest_reserved BOOLEAN      NOT NULL DEFAULT FALSE,

       -- Why it was refused, when it was. Null on the happy path.
       rejection_code  VARCHAR(60),

       amount          NUMERIC(30,8),
       currency        VARCHAR(10),
       user_id         BIGINT,
       source_ip       VARCHAR(64),

       -- The body as received. jsonb rather than text so a support query can
       -- reach into it without parsing.
       payload         JSONB,

       created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  // THE replay guard. Partial, so only callbacks that actually reserved their
  // digest constrain anything — a rejected one must not stop the genuine retry
  // that follows it from landing.
  //
  // This is a database constraint rather than an application check on purpose:
  // two concurrent replays both read "not seen" before either writes, and only
  // a unique index decides between them.
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_psp_callback_digest
       ON psp_callback_log (provider, payload_digest)
       WHERE digest_reserved`,
    { transaction }
  );

  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_psp_callback_reference ON psp_callback_log (provider, reference)',
    'CREATE INDEX IF NOT EXISTS idx_psp_callback_created ON psp_callback_log (created_at)',
    // Finding the failures: "show me every refused callback in the last hour".
    `CREATE INDEX IF NOT EXISTS idx_psp_callback_rejected
       ON psp_callback_log (created_at) WHERE NOT accepted`,
  ]) {
    await sequelize.query(sql, { transaction });
  }

  logger?.info('Created psp_callback_log with the accepted-digest replay guard');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping psp_callback_log removes the replay guard AND the audit trail for every ' +
        'payment callback received. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS psp_callback_log', { transaction });
  logger?.warn('Dropped psp_callback_log — replay protection is gone');
}

module.exports = { up, down };
