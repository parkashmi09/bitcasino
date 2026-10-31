'use strict';

/**
 * `payment_methods` — every deposit method a gateway offers per currency, and who switched it
 * (user, 2026-10-24: F2Pay's methods out of .env, kept in the database, editable by the owner and
 * the Super Admin). Like the `currencies` registry:
 *
 *   owner_enabled  the owner's switch — written from the owner document's `paymentMethods` block
 *   site_enabled   the Super Admin's switch (Settings → Payment Methods, transaction code)
 *   added_by       'owner' | 'site' — who listed it
 *   updated_by     'owner' or 'staff:<id>' — who changed it last
 *
 * A method is offered when both switches are on (and its currency is on for the gateway).
 * Seeded with the methods .env carried (F2PAY_INR_METHODS / F2PAY_IDR_METHODS). Idempotent.
 */
const SEED = [
  ['f2pay', 'INR', 'UpiMixed'],
  ['f2pay', 'IDR', 'QRIS'],
  ['f2pay', 'IDR', 'DANA'],
  ['f2pay', 'IDR', 'CIMB'],
  ['f2pay', 'IDR', 'BRI'],
  ['f2pay', 'IDR', 'MANDIRI'],
  ['f2pay', 'IDR', 'BNI'],
];

async function up({ sequelize, transaction }) {
  const q = (sql, replacements) => sequelize.query(sql, { transaction, replacements });
  await q(
    `CREATE TABLE IF NOT EXISTS payment_methods (
       id             BIGSERIAL PRIMARY KEY,
       gateway        VARCHAR(30)  NOT NULL,
       currency       VARCHAR(10)  NOT NULL,
       code           VARCHAR(40)  NOT NULL,
       owner_enabled  BOOLEAN      NOT NULL DEFAULT true,
       site_enabled   BOOLEAN      NOT NULL DEFAULT true,
       added_by       VARCHAR(10)  NOT NULL DEFAULT 'site',
       updated_by     VARCHAR(190),
       created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
       updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
       UNIQUE (gateway, currency, code)
     )`
  );
  for (const [gateway, currency, code] of SEED) {
    await q(
      `INSERT INTO payment_methods (gateway, currency, code, updated_by)
       VALUES (:gateway, :currency, :code, 'migration:153')
       ON CONFLICT (gateway, currency, code) DO NOTHING`,
      { gateway, currency, code }
    );
  }
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS payment_methods', { transaction });
}

module.exports = { up, down };
