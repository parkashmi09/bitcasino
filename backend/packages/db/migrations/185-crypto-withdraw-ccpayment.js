'use strict';

/**
 * Crypto withdrawals paid through CCPayment (user-service crypto-withdraw `sendViaGateway`).
 *
 *   gateway            'ccpayment' once staff sent it through the gateway; NULL = paid by hand
 *   gateway_order_id   OUR orderId at CCPayment (unique: CCPayment refuses a repeat, so a retry never pays twice)
 *   gateway_record_id  CCPayment's recordId for it
 *
 * Status `Sending` (no CHECK on the column) = handed to CCPayment, waiting for its
 * `ApiWithdrawal` webhook: Success → Sent (with the on-chain txid), Failed / Rejected → Rejected + refund.
 *
 * Whitelabel orders (migration 184) for CCPayment: `utr` widened to hold an on-chain hash, and
 * `settled_amount` = what actually arrived on a CCPayment deposit (it can be paid in parts, or
 * more or less than ordered); the copy is credited that, not the ordered amount.
 */

async function up({ sequelize, transaction, logger }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS gateway VARCHAR(20)`);
  await q(`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS gateway_order_id VARCHAR(64)`);
  await q(`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS gateway_record_id VARCHAR(64)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawals_gateway_order ON withdrawals (gateway_order_id) WHERE gateway_order_id IS NOT NULL`);
  await q(`ALTER TABLE whitelabel_gateway_orders ALTER COLUMN utr TYPE VARCHAR(128)`);
  await q(`ALTER TABLE whitelabel_gateway_orders ADD COLUMN IF NOT EXISTS settled_amount NUMERIC(30,8)`);
  logger?.info('Added withdrawals.gateway, gateway_order_id, gateway_record_id; whitelabel_gateway_orders.settled_amount');
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(`ALTER TABLE whitelabel_gateway_orders DROP COLUMN IF EXISTS settled_amount`);
  await q(`DROP INDEX IF EXISTS uq_withdrawals_gateway_order`);
  await q(`ALTER TABLE withdrawals DROP COLUMN IF EXISTS gateway_record_id`);
  await q(`ALTER TABLE withdrawals DROP COLUMN IF EXISTS gateway_order_id`);
  await q(`ALTER TABLE withdrawals DROP COLUMN IF EXISTS gateway`);
}

module.exports = { up, down };
