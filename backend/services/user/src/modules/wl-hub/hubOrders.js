'use strict';

const { QueryTypes } = require('sequelize');
const { AppError, money } = require('@ibitplay/common');

/**
 * Parent side: `whitelabel_gateway_orders` — every gateway order a whitelabel copy opened on this
 * site's account. psp settles them like its own (`forCallback`), and `modules/wl-hub/delivery`
 * tells the copy the outcome until it has heard it (`delivered`).
 */

const duplicate = () => new AppError('An order with this reference already exists', 409, 'HUB_DUPLICATE_ORDER');
const chargeChanged = () => new AppError('The gateway charge for this whitelabel changed — try again', 409, 'HUB_CHARGE_CHANGED');

const select = (db, sql, replacements, transaction) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

/** Record a new pending order. 409 HUB_DUPLICATE_ORDER when the copy already sent this reference. */
async function open(db, { whitelabelId, provider, flow, reference, copyReference, currency, amount, chargePct }) {
  const [row] = await select(
    db,
    `INSERT INTO whitelabel_gateway_orders (whitelabel_id, provider, flow, reference, copy_reference, currency, amount, charge_pct)
     VALUES (:whitelabelId, :provider, :flow, :reference, :copyReference, :currency, :amount, :chargePct)
     ON CONFLICT (whitelabel_id, flow, copy_reference) DO NOTHING
     RETURNING id`,
    { whitelabelId, provider, flow, reference, copyReference, currency: String(currency).toUpperCase(), amount, chargePct }
  );
  if (!row) throw duplicate();
  return { id: Number(row.id) };
}

async function attach(db, id, providerReference) {
  if (!providerReference) return;
  await select(db, 'UPDATE whitelabel_gateway_orders SET provider_reference = :ref, updated_at = NOW() WHERE id = :id RETURNING id', { id, ref: String(providerReference).slice(0, 128) });
}

/** The gateway refused the order at once: the copy hears it in the answer, not by delivery. */
async function failNow(db, id, reason) {
  await select(
    db,
    `UPDATE whitelabel_gateway_orders SET status = 'failed', delivered = true, delivery_error = :reason, updated_at = NOW()
      WHERE id = :id AND status = 'pending' RETURNING id`,
    { id, reason: reason ? String(reason).slice(0, 500) : null }
  );
}

/**
 * psp's record shape for an order of this site's own (`#findTransaction` / `#findPayout`), or null.
 * `wl` marks it: psp credits nobody here and hands the outcome to the copy instead.
 */
async function forCallback(db, provider, flow, reference) {
  const [row] = await select(db, 'SELECT * FROM whitelabel_gateway_orders WHERE provider = :provider AND flow = :flow AND reference = :reference', { provider, flow, reference });
  if (!row) return null;
  return {
    wl: { id: Number(row.id), whitelabelId: Number(row.whitelabel_id) },
    reference,
    userId: null,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    settled: row.status !== 'pending',
    // A payout order settled either way has nothing left to refund here: the copy refunds.
    refunded: row.status === 'failed',
    createdAt: row.created_at,
  };
}

/** Settle once: pending → success / failed. False = it was already settled (a retry). */
async function settle(db, id, status, { utr = null, transaction } = {}) {
  const rows = await select(
    db,
    `UPDATE whitelabel_gateway_orders SET status = :status, utr = COALESCE(:utr, utr), updated_at = NOW()
      WHERE id = :id AND status = 'pending' RETURNING id`,
    { id, status, utr: utr ? String(utr).slice(0, 64) : null },
    transaction
  );
  return rows.length > 0;
}

/**
 * A CCPayment deposit: `received` (all that has arrived so far) is what the copy credits. Raised
 * only, and each raise is delivered again (the copy credits the difference). False = no change.
 */
async function receive(db, id, received) {
  const rows = await select(
    db,
    `UPDATE whitelabel_gateway_orders
        SET status = 'success', settled_amount = :received, delivered = false, updated_at = NOW()
      WHERE id = :id AND status <> 'failed' AND (settled_amount IS NULL OR settled_amount < :received)
      RETURNING id`,
    { id, received }
  );
  return rows.length > 0;
}

/** The copy asks what became of one of its orders (an answer it never got). Null = never opened. */
async function byCopyReference(db, whitelabelId, flow, copyReference) {
  const [row] = await select(
    db,
    'SELECT status, reference, provider_reference, amount, currency FROM whitelabel_gateway_orders WHERE whitelabel_id = :whitelabelId AND flow = :flow AND copy_reference = :copyReference',
    { whitelabelId, flow, copyReference }
  );
  return row ? { status: row.status, reference: row.reference, providerReference: row.provider_reference, amount: money.fromStored(row.amount), currency: row.currency } : null;
}

module.exports = { open, attach, failNow, forCallback, settle, receive, byCopyReference, chargeChanged };
