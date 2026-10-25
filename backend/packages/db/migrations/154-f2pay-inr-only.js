'use strict';

/**
 * F2Pay is INR only (user, 2026-10-24: "f2pay bss inr ke liye hi hai bhai to idr hata do"): the IDR
 * methods migration 153 seeded (QRIS, DANA, CIMB, BRI, MANDIRI, BNI) leave `payment_methods`.
 * The IDR wallet currency itself (151 / 152) stays. Idempotent.
 */
const IDR_METHODS = ['QRIS', 'DANA', 'CIMB', 'BRI', 'MANDIRI', 'BNI'];

async function up({ sequelize, transaction }) {
  await sequelize.query("DELETE FROM payment_methods WHERE gateway = 'f2pay' AND currency = 'IDR'", { transaction });
}

async function down({ sequelize, transaction }) {
  for (const code of IDR_METHODS) {
    await sequelize.query(
      `INSERT INTO payment_methods (gateway, currency, code, updated_by)
       VALUES ('f2pay', 'IDR', :code, 'migration:154')
       ON CONFLICT (gateway, currency, code) DO NOTHING`,
      { transaction, replacements: { code } }
    );
  }
}

module.exports = { up, down };
