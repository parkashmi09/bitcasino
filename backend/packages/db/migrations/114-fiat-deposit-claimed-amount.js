'use strict';

/**
 * Manual (fiat) deposits keep what the player CLAIMED apart from what was CREDITED.
 *
 * `amount` was the claimed figure even after an operator approved a different one, so every
 * reader that sums approved deposits (the wager / rollover target, the withdrawal cap, reports)
 * counted the claim, not the money received. From here:
 *   amount          what was credited once approved (the claim while pending / rejected)
 *   claimed_amount  what the player entered, always
 * Existing rows: claimed_amount = amount; approved rows whose ledger credit differs take the
 * ledger figure as `amount` (the credit is `credits_ledger.idempotency_key = 'fiat-deposit:<id>'`).
 * Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE fiat_deposits ADD COLUMN IF NOT EXISTS claimed_amount NUMERIC', { transaction });
  await sequelize.query('UPDATE fiat_deposits SET claimed_amount = amount WHERE claimed_amount IS NULL', { transaction });
  await sequelize.query(
    `UPDATE fiat_deposits fd
        SET amount = l.amount
       FROM credits_ledger l
      WHERE fd.status = 'approved'
        AND l.idempotency_key = 'fiat-deposit:' || fd.deposit_id
        AND l.amount > 0
        AND l.amount <> fd.amount`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('UPDATE fiat_deposits SET amount = claimed_amount WHERE claimed_amount IS NOT NULL', { transaction });
  await sequelize.query('ALTER TABLE fiat_deposits DROP COLUMN IF EXISTS claimed_amount', { transaction });
}

module.exports = { up, down };
