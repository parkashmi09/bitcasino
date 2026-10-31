'use strict';

/**
 * F2Pay takes crypto too (user, 2026-10-24: "f2pay ka code bss inr and crypto ke liye hi rakho"): its
 * crypto payin (`/payin/crypto/order/create`) collects USDT on TRON with method `PI_USDT_TRX`. Seeded
 * as a `payment_methods` row like 153's INR UpiMixed; the owner switches it (flag `f2pay_usdt`).
 * Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `INSERT INTO payment_methods (gateway, currency, code, updated_by)
     VALUES ('f2pay', 'USDT', 'PI_USDT_TRX', 'migration:155')
     ON CONFLICT (gateway, currency, code) DO NOTHING`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query("DELETE FROM payment_methods WHERE gateway = 'f2pay' AND currency = 'USDT' AND code = 'PI_USDT_TRX'", { transaction });
}

module.exports = { up, down };
