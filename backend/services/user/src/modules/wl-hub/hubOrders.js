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
async function open(db, { whitelabelId, provider, flow, reference, copyReference, currency, amount, chargePct }, transaction) {
  const [row] = await select(
    db,
    `INSERT INTO whitelabel_gateway_orders (whitelabel_id, provider, flow, reference, copy_reference, currency, amount, charge_pct)
     VALUES (:whitelabelId, :provider, :flow, :reference, :copyReference, :currency, :amount, :chargePct)
     ON CONFLICT (whitelabel_id, flow, copy_reference) DO NOTHING
     RETURNING id`,
    { whitelabelId, provider, flow, reference, copyReference, currency: String(currency).toUpperCase(), amount, chargePct },
    transaction
  );
  if (!row) throw duplicate();
  return { id: Number(row.id) };
}

const balanceLow = (details) =>
  new AppError('The whitelabel balance held here cannot cover this payout and its charge', 409, 'HUB_BALANCE_LOW', details);

/* What this site holds for the copy, in INR (audit M2): transfers delivered to it, plus gateway
   deposits it was credited (net of charge), minus every payout not failed (gross of charge). Coins
   are counted at today's rates; a deposit without a rate counts nothing, a payout without one
   fails closed. */
const HELD_SQL = `
  WITH r AS (SELECT UPPER(currency) AS currency, usd_rate FROM exchangerate),
       inr AS (SELECT usd_rate FROM r WHERE currency = 'INR'),
       o AS (
         SELECT o.flow, o.status, COALESCE(o.settled_amount, o.amount) AS amount, o.charge_pct,
                CASE WHEN o.currency = 'INR' THEN 1 ELSE r.usd_rate / NULLIF((SELECT usd_rate FROM inr), 0) END AS to_inr
           FROM whitelabel_gateway_orders o LEFT JOIN r ON r.currency = o.currency
          WHERE o.whitelabel_id = :whitelabelId)
  SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM whitelabel_transfers WHERE whitelabel_id = :whitelabelId AND status = 'done')
    + COALESCE((SELECT SUM(amount * to_inr * (1 - charge_pct / 100)) FROM o WHERE flow = 'deposit' AND status = 'success'), 0)
    - COALESCE((SELECT SUM(amount * to_inr * (1 + charge_pct / 100)) FROM o WHERE flow = 'payout' AND status <> 'failed'), 0) AS held,
    (SELECT COUNT(*) FROM o WHERE flow = 'payout' AND status <> 'failed' AND to_inr IS NULL) AS unpriced,
    (SELECT CASE WHEN UPPER(:currency) = 'INR' THEN 1 ELSE (SELECT usd_rate FROM r WHERE currency = UPPER(:currency)) / NULLIF((SELECT usd_rate FROM inr), 0) END) AS this_to_inr`;

/**
 * A payout order, opened only when what this site holds for the copy covers it (audit M2): the
 * copy's own word that its company balance was debited is not enough. The whitelabel row is locked
 * for the check and the insert, so two payouts at once cannot both spend the same balance.
 */
async function openPayout(db, order) {
  return db.transaction(async (transaction) => {
    const [wl] = await select(db, 'SELECT id FROM whitelabels WHERE id = :id FOR UPDATE', { id: order.whitelabelId }, transaction);
    if (!wl) throw balanceLow({ whitelabelId: order.whitelabelId });
    const [row] = await select(db, HELD_SQL, { whitelabelId: order.whitelabelId, currency: order.currency }, transaction);
    if (!row || Number(row.unpriced) > 0 || row.this_to_inr == null) throw balanceLow({ reason: 'unpriced' });
    const needed = Number(order.amount) * Number(row.this_to_inr) * (1 + Number(order.chargePct ?? 0) / 100);
    // shortcut: float compare of NUMERIC sums, fine at paisa scale; move to money.* if amounts reach 1e12.
    if (!(Number(row.held) + 1e-6 >= needed)) throw balanceLow({ held: String(row.held), needed: needed.toFixed(2) });
    return open(db, { ...order, flow: 'payout' }, transaction);
  });
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

module.exports = { open, openPayout, attach, failNow, forCallback, settle, receive, byCopyReference, chargeChanged };
