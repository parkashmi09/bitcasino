'use strict';

const { QueryTypes } = require('sequelize');
const { money } = require('@ibitplay/common');

const { whitelabelById, callCopy } = require('./hubCredentials');

/**
 * Parent side: tell a copy the outcome of a gateway order it opened here (psp settled it), until
 * the copy confirms. The copy applies it once whatever the number of tries (its credit, refund and
 * company movement are each keyed on the order), so resending is always safe.
 *
 * Sent right after psp settles, and again by the `wl-hub:deliver` job for anything the copy did
 * not confirm (down, restarting, maintenance does not block it — the copy's route is a callback).
 */

const BATCH = 50;
const MAX_ATTEMPTS = 2000; // ~ a few days at the job's pace; then it needs a person (delivery_error says why)

const select = (db, sql, replacements) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

async function deliver(deps, orderId) {
  const { db, logger } = deps;
  const [order] = await select(db, `SELECT * FROM whitelabel_gateway_orders WHERE id = :orderId AND status <> 'pending' AND delivered = false`, { orderId });
  if (!order) return { delivered: false, skipped: true };
  try {
    const wl = await whitelabelById(deps, order.whitelabel_id);
    if (!wl || wl.status !== 'live') throw new Error(`whitelabel ${order.whitelabel_id} is not live`);
    await callCopy(wl, 'POST', '/in/payments', {
      provider: order.provider,
      flow: order.flow,
      reference: order.copy_reference,
      parentReference: order.reference,
      status: order.status,
      // A CCPayment deposit: what arrived, which can differ from what was ordered.
      amount: money.fromStored(order.settled_amount ?? order.amount),
      currency: order.currency,
      chargePct: money.fromStored(order.charge_pct),
      utr: order.utr ?? undefined,
    });
    // Only what was sent: a CCPayment payment that raised the total meanwhile is sent again.
    await select(
      db,
      `UPDATE whitelabel_gateway_orders SET delivered = true, delivery_error = NULL, updated_at = NOW()
        WHERE id = :orderId AND status = :status AND settled_amount IS NOT DISTINCT FROM :settled RETURNING id`,
      { orderId, status: order.status, settled: order.settled_amount ?? null }
    );
    logger?.info({ orderId, whitelabelId: order.whitelabel_id, status: order.status }, 'Whitelabel told the outcome of its gateway order');
    return { delivered: true };
  } catch (error) {
    await select(
      db,
      `UPDATE whitelabel_gateway_orders SET delivery_attempts = delivery_attempts + 1, delivery_error = :error, updated_at = NOW() WHERE id = :orderId RETURNING id`,
      { orderId, error: String(error.message).slice(0, 500) }
    );
    logger?.warn({ err: error.message, orderId, whitelabelId: order.whitelabel_id }, 'Could not tell the whitelabel its gateway order outcome — will retry');
    return { delivered: false };
  }
}

/** The job: every settled order the copy has not confirmed yet, oldest first. */
async function deliverPending(deps) {
  if (deps.config.WHITELABEL_MODE) return { sent: 0 };
  const rows = await select(
    deps.db,
    `SELECT id FROM whitelabel_gateway_orders WHERE status <> 'pending' AND delivered = false AND delivery_attempts < :max ORDER BY id LIMIT :limit`,
    { max: MAX_ATTEMPTS, limit: BATCH }
  ).catch(() => []); // table absent before migration 170
  let sent = 0;
  for (const { id } of rows) if ((await deliver(deps, Number(id))).delivered) sent += 1;
  return { sent, pending: rows.length - sent };
}

module.exports = { deliver, deliverPending };
