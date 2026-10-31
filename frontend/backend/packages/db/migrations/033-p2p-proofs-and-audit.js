'use strict';

/**
 * P2P — proof images in the row, and who released the money.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * TWO GAPS IN THE RECONSTRUCTED SCHEMA (migration 009)
 *
 * 009 rebuilt the p2p tables from the INSERT column lists in
 * `legacy/peerTrade/controler.js`, because none of them existed in the
 * baseline or in either live database. It got the columns right — they are
 * written out in the queries — but it inherited two of legacy's choices that
 * do not survive contact with this port.
 *
 * ── 1. THE PROOF IMAGES ARE FILENAMES ────────────────────────────────────
 *
 *     payment_proof       VARCHAR(255)   -- p2p_orders
 *     admin_payment_proof VARCHAR(255)   -- p2p_orders_sell
 *     screenshot          VARCHAR(255)   -- p2p_disputes
 *     qr_image            BYTEA          -- p2p_orders_sell  ← already right
 *
 * `req.file.filename`, from `multer.diskStorage`. Local disk is not shared
 * between replicas, so a proof uploaded on one server is a 404 from the next,
 * and the whole directory is lost on a container restart.
 *
 * That matters more here than it did for banners. A payment proof is the
 * EVIDENCE in a dispute over real money: the screenshot a buyer uploads to show
 * they paid, and the one an operator uploads to show they released. Losing it
 * on a restart means losing the only record of who is telling the truth.
 *
 * `qr_image` was already BYTEA in 009 — the legacy handler stored the buffer
 * for that one and the filename for the other three. The three catch up here.
 *
 * ── 2. NOBODY IS RECORDED AS RELEASING THE MONEY ─────────────────────────
 *
 *     POST /admin/p2p/release/:orderId       credits the buyer's wallet
 *     POST /admin/p2p/sell-release/:orderId  completes a sell
 *     POST /admin/p2p/cancel/:orderId        refunds
 *
 * All three had NO AUTHENTICATION — no middleware anywhere in
 * `legacy/peerTrade/routes.js` — so there was no operator identity to record,
 * and none of the tables has a column for one. The first question after a
 * wrongful release is who authorised it, and legacy could not answer it even in
 * principle.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  // ── Buy orders: the buyer's payment proof ────────────────────────────
  await sequelize.query(
    `ALTER TABLE p2p_orders
       ADD COLUMN IF NOT EXISTS payment_proof_data BYTEA,
       ADD COLUMN IF NOT EXISTS payment_proof_type VARCHAR(60),
       ADD COLUMN IF NOT EXISTS payment_proof_size INTEGER,
       -- The staff member who released or cancelled. Legacy had no
       -- authentication on either route, so there was nobody to record.
       ADD COLUMN IF NOT EXISTS released_by BIGINT,
       ADD COLUMN IF NOT EXISTS cancelled_by BIGINT,
       ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS admin_note TEXT`,
    { transaction }
  );

  // ── Sell orders: the operator's proof of payment out ─────────────────
  await sequelize.query(
    `ALTER TABLE p2p_orders_sell
       ADD COLUMN IF NOT EXISTS admin_proof_data BYTEA,
       ADD COLUMN IF NOT EXISTS admin_proof_type VARCHAR(60),
       ADD COLUMN IF NOT EXISTS admin_proof_size INTEGER,
       ADD COLUMN IF NOT EXISTS qr_image_type VARCHAR(60),
       ADD COLUMN IF NOT EXISTS released_by BIGINT,
       ADD COLUMN IF NOT EXISTS cancelled_by BIGINT,
       ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`,
    { transaction }
  );

  // ── Disputes: the screenshot ─────────────────────────────────────────
  await sequelize.query(
    `ALTER TABLE p2p_disputes
       ADD COLUMN IF NOT EXISTS screenshot_data BYTEA,
       ADD COLUMN IF NOT EXISTS screenshot_type VARCHAR(60),
       ADD COLUMN IF NOT EXISTS screenshot_size INTEGER,
       ADD COLUMN IF NOT EXISTS resolved_by BIGINT`,
    { transaction }
  );

  /**
   * "My orders", which is the query every P2P screen opens with.
   *
   * `getUserOrders` and `getUserSellOrders` filter on `user_id` and order by
   * `created_at DESC`, and 009 indexed neither table for it.
   */
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS ix_p2p_orders_user ON p2p_orders (user_id, created_at DESC)',
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS ix_p2p_orders_sell_user ON p2p_orders_sell (user_id, created_at DESC)',
    { transaction }
  );

  /**
   * A sell order expiring is a refund waiting to happen.
   *
   * `p2p_orders` has a partial index on `expires_at WHERE status = 'PENDING'`
   * from 009; the sell table has nothing equivalent, and its expiry is the more
   * urgent of the two — the crypto is already debited.
   */
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_p2p_orders_sell_expiry
       ON p2p_orders_sell (expires_at)
       WHERE status = 'PENDING'`,
    { transaction }
  );

  /**
   * One dispute per order.
   *
   * `createDispute` INSERTed unconditionally, so a client that retried filed a
   * second dispute on the same order and an operator resolving one left the
   * other open forever.
   */
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_p2p_disputes_order
       ON p2p_disputes (order_id, order_type)`,
    { transaction }
  );

  logger?.info('p2p: proof images, operator attribution and the missing indexes added');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS uq_p2p_disputes_order', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS ix_p2p_orders_sell_expiry', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS ix_p2p_orders_sell_user', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS ix_p2p_orders_user', { transaction });

  await sequelize.query(
    `ALTER TABLE p2p_disputes
       DROP COLUMN IF EXISTS screenshot_data,
       DROP COLUMN IF EXISTS screenshot_type,
       DROP COLUMN IF EXISTS screenshot_size,
       DROP COLUMN IF EXISTS resolved_by`,
    { transaction }
  );

  await sequelize.query(
    `ALTER TABLE p2p_orders_sell
       DROP COLUMN IF EXISTS admin_proof_data,
       DROP COLUMN IF EXISTS admin_proof_type,
       DROP COLUMN IF EXISTS admin_proof_size,
       DROP COLUMN IF EXISTS qr_image_type,
       DROP COLUMN IF EXISTS released_by,
       DROP COLUMN IF EXISTS cancelled_by,
       DROP COLUMN IF EXISTS cancelled_at`,
    { transaction }
  );

  await sequelize.query(
    `ALTER TABLE p2p_orders
       DROP COLUMN IF EXISTS payment_proof_data,
       DROP COLUMN IF EXISTS payment_proof_type,
       DROP COLUMN IF EXISTS payment_proof_size,
       DROP COLUMN IF EXISTS released_by,
       DROP COLUMN IF EXISTS cancelled_by,
       DROP COLUMN IF EXISTS cancelled_at,
       DROP COLUMN IF EXISTS admin_note`,
    { transaction }
  );
}

module.exports = { up, down };
