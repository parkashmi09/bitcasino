'use strict';

/**
 * Super Admin ke main Direct User wallet (`staff_balances.inr`) ka ledger.
 *
 * Wallet ka har badlav yahan ek row: owner ne khud add kiya, direct user ko diya,
 * direct user se liya, ya points settle. Pehle aur baad ka balance dono save hote
 * hain, taaki owner dekh sake kab, kya aur kitna hua.
 * Row `lords/ownerWallet.js` hi likhta hai (wallet badalne wali transaction ke andar).
 * Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS owner_direct_ledger (
       id              BIGSERIAL PRIMARY KEY,
       owner_id        BIGINT NOT NULL,
       entry_type      VARCHAR(30) NOT NULL,   -- add | user_deposit | user_withdraw | points_settle
       direction       VARCHAR(10) NOT NULL,   -- credit (wallet me aaya) | debit (wallet se gaya)
       amount          NUMERIC(20,8) NOT NULL,
       balance_before  NUMERIC(20,8) NOT NULL,
       balance_after   NUMERIC(20,8) NOT NULL,
       user_id         BIGINT,                 -- direct user (owner ne khud add kiya to NULL)
       note            VARCHAR(255),
       created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS owner_direct_ledger_owner_created ON owner_direct_ledger (owner_id, created_at DESC, id DESC)',
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS owner_direct_ledger', { transaction });
}

module.exports = { up, down };
