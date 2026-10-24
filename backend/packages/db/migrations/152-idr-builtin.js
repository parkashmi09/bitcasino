'use strict';

/**
 * IDR is a built-in coin (migration 151, `credits.idr`), but a site may already hold an owner-made
 * CUSTOM IDR (parker567 did: the owner panel defined it on 2026-10-24 while 151 was being written,
 * so 151's insert kept that row). A custom coin's balance lives in `wallet_balances` and every
 * provider rail refuses it, so here it becomes the built-in one:
 *
 *   currencies   builtin = true (the owner's / site admin's switches, name and image are kept)
 *   balances     any `wallet_balances` IDR moves into `credits.idr` (the trigger records it on the
 *                direct ledger), then those rows go
 *   exchangerate an owner-fixed rate becomes site-managed, so the hourly market refresh keeps
 *                IDR current like INR
 *
 * Idempotent.
 */
async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q("UPDATE currencies SET builtin = true, updated_by = 'migration:152', updated_at = now() WHERE code = 'IDR' AND builtin = false");
  await q(
    `UPDATE credits c SET idr = COALESCE(c.idr, 0) + w.balance
       FROM wallet_balances w
      WHERE w.currency = 'IDR' AND w.uid = c.uid AND c.staff_id IS NULL AND w.balance <> 0`
  );
  // Only rows whose balance moved (or was 0) — a balance with no player wallet row stays put.
  await q(
    `DELETE FROM wallet_balances w
      WHERE w.currency = 'IDR'
        AND (w.balance = 0 OR EXISTS (SELECT 1 FROM credits c WHERE c.uid = w.uid AND c.staff_id IS NULL))`
  );
  await q("UPDATE exchangerate SET managed_by = NULL WHERE currency = 'IDR' AND managed_by = 'owner'");
}

/** Nothing to undo safely: a balance once in `credits.idr` stays there. */
async function down() {}

module.exports = { up, down };
