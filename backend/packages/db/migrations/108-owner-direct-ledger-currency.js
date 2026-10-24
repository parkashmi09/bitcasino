'use strict';

/**
 * Direct User Wallet (admin-structure.zip jaisa): owner direct user ko kisi bhi currency me
 * deposit / withdraw karta hai, owner ke wallet (`staff_balances`, INR) se rate ke hisaab se
 * INR katta / aata hai. Ledger me ab ye bhi:
 *   currency         user ko kis currency me gaya / liya (INR wale purane rows me NULL)
 *   currency_amount  us currency me kitna
 *   rate             1 <currency> = kitne INR (usi waqt ka)
 * `amount` hamesha INR hi rehta hai (owner ke wallet ka badlav). Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `ALTER TABLE owner_direct_ledger
       ADD COLUMN IF NOT EXISTS currency        VARCHAR(10),
       ADD COLUMN IF NOT EXISTS currency_amount NUMERIC(30,8),
       ADD COLUMN IF NOT EXISTS rate            NUMERIC(30,8)`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query(
    `ALTER TABLE owner_direct_ledger
       DROP COLUMN IF EXISTS currency,
       DROP COLUMN IF EXISTS currency_amount,
       DROP COLUMN IF EXISTS rate`,
    { transaction }
  );
}

module.exports = { up, down };
