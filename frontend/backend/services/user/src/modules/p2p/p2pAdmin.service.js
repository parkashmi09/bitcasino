'use strict';

const { money } = require('@ibitplay/common');

const { WalletService } = require('../wallet/wallet.service');

const errors = require('./p2p.errors');
const { inspect } = require('./p2p.upload');
const {
  ORDER_STATUS,
  SELL_STATUS,
  OFFER_STATUS,
  SEGMENT,
  DISPUTE_STATUS,
  DISPUTE_ORDER_TYPE,
  REASON,
  DEFAULT_PAGE_SIZE,
} = require('./p2p.constants');

/**
 * Peer-to-peer trading — the operator's side.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THREE OF THESE METHODS MOVE REAL MONEY, AND ALL THREE WERE UNAUTHENTICATED
 *
 *     POST /admin/p2p/release/:orderId       credits the buyer's crypto
 *     POST /admin/p2p/sell-release/:orderId  completes a fiat payout
 *     POST /admin/p2p/cancel/:orderId        refunds a seller's crypto
 *
 * `legacy/peerTrade/routes.js` puts no middleware on any route in the file, and
 * `legacy/index.js` never mounts it. Anyone reaching the port could have
 * released crypto on any order.
 *
 * The two that cost the most:
 *
 * ── RELEASE HAD NO LOCK ──────────────────────────────────────────────────
 *
 *     SELECT * FROM p2p_orders WHERE id=$1        -- read
 *     if (order.status !== 'PAID') throw          -- check
 *     UPDATE credits SET ${coin} = ${coin} + $1   -- pay
 *     UPDATE p2p_orders SET status='RELEASED'     -- mark
 *
 * Inside a BEGIN, but with no row lock. Postgres's default READ COMMITTED lets
 * two concurrent transactions both read PAID, both credit, and both mark. The
 * `BEGIN` made it look transactional; it was not.
 *
 * ── CANCEL DID NOT CHECK IT HAD NOT ALREADY REFUNDED ─────────────────────
 *
 *     if (order.status === 'RELEASED') throw new Error('Cannot cancel released order');
 *     UPDATE credits SET ${coin} = ${coin} + $1   -- refund
 *
 * CANCELLED is not RELEASED, so cancelling a cancelled order refunded again.
 * As many times as it was called.
 *
 * Both are closed the same way: `SELECT … FOR UPDATE`, a check that the status
 * is exactly the one the operation starts from, and a wallet movement carrying
 * an idempotency key derived from the order number.
 * ═════════════════════════════════════════════════════════════════════════
 */
class P2pAdminService {
  constructor(deps) {
    const { models, db, logger, config } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    /**
     * The wallet is constructed here rather than injected, matching every
     * other money-moving module in this service. It resolves the balance
     * COLUMN from a currency code through its own allow-list — which is the
     * thing legacy did not have when it wrote `SET ${order.coin} = ...`.
     */
    this.wallet = deps.wallet ?? new WalletService(deps);
  }

  // ── Payment rails ─────────────────────────────────────────────────────

  /** @legacy POST /admin/p2p/payment-type */
  async createPaymentType({ staff, name, code }) {
    const existing = await this.models.P2pPaymentType.findOne({ where: { code }, raw: true });
    // Legacy let the UNIQUE constraint fire and returned the Postgres message
    // in a 500.
    if (existing) throw errors.PAYMENT_TYPE_EXISTS({ code });

    const row = await this.models.P2pPaymentType.create({ name, code, is_active: true });
    this.logger?.info({ id: row.id, code, staffId: staff?.id }, 'P2P payment type created');
    return row.get({ plain: true });
  }

  /** @legacy GET /admin/p2p/payment-types */
  async paymentTypes() {
    return this.models.P2pPaymentType.findAll({ order: [['id', 'ASC']], raw: true });
  }

  /** @legacy POST /admin/p2p/payment-account */
  async createPaymentAccount({ staff, paymentTypeId, accountName, accountNumber, ifscCode, upiId, extraDetails, file }) {
    const type = await this.models.P2pPaymentType.findByPk(paymentTypeId, { raw: true });
    // Legacy inserted and let the foreign key fail with a 500.
    if (!type) throw errors.PAYMENT_TYPE_NOT_FOUND({ paymentTypeId });

    const qr = file ? inspect(file, errors) : null;

    const row = await this.models.P2pPaymentAccount.create({
      payment_type_id: paymentTypeId,
      account_name: accountName ?? null,
      account_number: accountNumber ?? null,
      ifsc_code: ifscCode ?? null,
      upi_id: upiId ?? null,
      // Legacy stored `req.file.filename`; the column is BYTEA (migration 009).
      qr_image: qr?.data ?? null,
      extra_details: extraDetails ?? null,
    });

    this.logger?.info({ id: row.id, paymentTypeId, staffId: staff?.id }, 'P2P payment account created');
    return this.#describeAccount(row.get({ plain: true }));
  }

  /** @legacy GET /admin/p2p/payment-accounts */
  async paymentAccounts() {
    const rows = await this.models.P2pPaymentAccount.findAll({
      // Never the QR bytes in a list.
      attributes: ['id', 'payment_type_id', 'account_name', 'account_number', 'ifsc_code', 'upi_id', 'extra_details'],
      order: [['id', 'ASC']],
      raw: true,
    });
    return rows.map((row) => this.#describeAccount(row));
  }

  // ── Offers ────────────────────────────────────────────────────────────

  /**
   * @legacy POST /admin/p2p/create-offer
   *
   * `coin` from this body was interpolated into `UPDATE credits SET ${coin}` at
   * release time. It is validated against an enum now and the wallet resolves
   * the column, so the value never reaches SQL.
   */
  async createOffer({ staff, username, coin, fiat, price, minLimit, maxLimit, availableAmount, paymentAccountIds, paymentTime, isFeatured, isVerified, isKycVerified, segment }) {
    return this.db.transaction(async (transaction) => {
      /**
       * Every named account must exist.
       *
       * Legacy looped the ids straight into an INSERT, so a bad one aborted the
       * transaction and returned a foreign-key violation as a 500 — after the
       * offer row had been written and rolled back.
       */
      const accounts = await this.models.P2pPaymentAccount.findAll({
        where: { id: paymentAccountIds },
        attributes: ['id'],
        transaction,
        raw: true,
      });

      if (accounts.length !== new Set(paymentAccountIds).size) {
        const found = new Set(accounts.map((row) => row.id));
        throw errors.PAYMENT_ACCOUNT_NOT_FOUND({ missing: paymentAccountIds.filter((id) => !found.has(id)) });
      }

      const offer = await this.models.P2pOffer.create(
        {
          username,
          // Legacy did `username.charAt(0)` with no check — a missing username
          // was a TypeError and a 500. The validator requires it; this is the
          // same derivation.
          avatar_letter: username.charAt(0).toUpperCase(),
          coin,
          fiat,
          price,
          min_limit: minLimit ?? null,
          max_limit: maxLimit ?? null,
          available_amount: availableAmount,
          payment_time: paymentTime ?? undefined,
          is_featured: isFeatured ?? false,
          is_verified: isVerified ?? false,
          is_kyc_verified: isKycVerified ?? false,
          segment: segment ?? SEGMENT.BUY,
          status: OFFER_STATUS.ACTIVE,
        },
        { transaction }
      );

      await this.models.P2pOfferPayment.bulkCreate(
        [...new Set(paymentAccountIds)].map((accountId) => ({
          offer_id: offer.id,
          payment_account_id: accountId,
        })),
        { transaction }
      );

      this.logger?.info({ offerId: offer.id, coin, fiat, staffId: staff?.id }, 'P2P offer created');

      // Legacy returned `{ message: 'Offer created successfully' }` and not the
      // id, so a client could not then reference what it had just made.
      return { ...offer.get({ plain: true }), paymentAccountIds: [...new Set(paymentAccountIds)] };
    });
  }

  /** @legacy GET /admin/p2p/offers */
  async offers({ page = 1, limit = DEFAULT_PAGE_SIZE, coin } = {}) {
    const where = {};
    if (coin) where.coin = coin;

    const result = await this.models.P2pOffer.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return { rows: result.rows, count: result.count };
  }

  /**
   * Pause or close an offer. Legacy had no way to take one down — `status` was
   * written at creation and no route ever changed it.
   */
  async setOfferStatus({ staff, offerId, status }) {
    const offer = await this.models.P2pOffer.findByPk(offerId);
    if (!offer) throw errors.OFFER_NOT_FOUND({ offerId });

    await offer.update({ status, updated_at: new Date() });
    this.logger?.info({ offerId, status, staffId: staff?.id }, 'P2P offer status changed');

    return offer.get({ plain: true });
  }

  // ── Buy orders ────────────────────────────────────────────────────────

  /** @legacy GET /admin/p2p/orders */
  async orders({ page = 1, limit = DEFAULT_PAGE_SIZE, status, userId, coin } = {}) {
    const where = {};
    if (status) where.status = status;
    if (userId) where.user_id = String(userId);
    if (coin) where.coin = coin;

    const result = await this.models.P2pOrder.findAndCountAll({
      where,
      // The proof bytes have their own endpoint; a list of 100 orders must not
      // drag 100 screenshots through the query.
      attributes: { exclude: ['payment_proof_data'] },
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return { rows: result.rows, count: result.count };
  }

  /**
   * @legacy POST /admin/p2p/release/:orderId
   *
   * The buyer paid fiat off-platform; this credits their crypto.
   *
   * `FOR UPDATE` plus a status check that names exactly PAID, plus an
   * idempotency key on the movement. Any one of the three would stop the
   * double-credit on its own; all three are here because this is the method
   * that pays out.
   */
  async releaseOrder({ staff, orderId, note }) {
    return this.db.transaction(async (transaction) => {
      const order = await this.models.P2pOrder.findByPk(orderId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!order) throw errors.ORDER_NOT_FOUND({ orderId });

      /**
       * Already settled reads differently from not yet paid.
       *
       * Legacy answered both with `throw new Error('Order not paid')` → 500,
       * so an operator whose click was counted twice was told the order had not
       * been paid — the opposite of what happened.
       */
      if (order.status === ORDER_STATUS.RELEASED || order.status === ORDER_STATUS.CANCELLED) {
        throw errors.ORDER_ALREADY_SETTLED({ orderId, status: order.status });
      }
      if (order.status !== ORDER_STATUS.PAID) {
        throw errors.ORDER_NOT_PAID({ orderId, status: order.status });
      }

      const now = new Date();

      await order.update(
        {
          status: ORDER_STATUS.RELEASED,
          released_at: now,
          released_by: staff?.id ?? null,
          admin_note: note ?? order.admin_note ?? null,
          updated_at: now,
        },
        { transaction }
      );

      const movement = await this.wallet.credit(
        {
          userId: order.user_id,
          currency: order.coin,
          amount: String(order.crypto_amount),
          reason: REASON.BUY_RELEASE,
          // From the order number: a retried release returns the original
          // movement rather than crediting a second time.
          idempotencyKey: `p2p-buy-release:${order.order_no}`,
          refType: 'P2P_BUY',
          refId: String(order.id),
          description: `P2P buy — order ${order.order_no}`,
        },
        { sourceService: 'user-service', transaction }
      );

      this.logger?.warn(
        {
          orderId,
          orderNo: order.order_no,
          userId: order.user_id,
          coin: order.coin,
          amount: String(order.crypto_amount),
          staffId: staff?.id,
          ledgerId: movement.ledgerId,
        },
        'P2P buy order released — crypto credited'
      );

      return { orderId, status: ORDER_STATUS.RELEASED, newBalance: movement.newBalance };
    });
  }

  /**
   * @legacy POST /admin/p2p/cancel/:orderId
   *
   * A buy order holds no money — the buyer has not been credited and the
   * platform has taken nothing. What cancelling returns is the OFFER's
   * reserved amount, which legacy never held in the first place.
   */
  async cancelOrder({ staff, orderId, note }) {
    return this.db.transaction(async (transaction) => {
      const order = await this.models.P2pOrder.findByPk(orderId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!order) throw errors.ORDER_NOT_FOUND({ orderId });
      if (order.status === ORDER_STATUS.RELEASED || order.status === ORDER_STATUS.CANCELLED) {
        throw errors.ORDER_ALREADY_SETTLED({ orderId, status: order.status });
      }

      const now = new Date();

      await order.update(
        {
          status: ORDER_STATUS.CANCELLED,
          cancelled_at: now,
          cancelled_by: staff?.id ?? null,
          admin_note: note ?? order.admin_note ?? null,
          updated_at: now,
        },
        { transaction }
      );

      if (order.offer_id) {
        const offer = await this.models.P2pOffer.findByPk(order.offer_id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (offer) {
          await offer.update(
            {
              available_amount: money.toDecimalString(
                money.add(offer.available_amount ?? '0', order.crypto_amount)
              ),
            },
            { transaction }
          );
        }
      }

      this.logger?.info({ orderId, staffId: staff?.id }, 'P2P buy order cancelled');
      return { orderId, status: ORDER_STATUS.CANCELLED };
    });
  }

  /**
   * @legacy PUT /admin/p2p/order/:orderId/status
   *
   * Only to DISPUTED or EXPIRED — see the validator. Legacy wrote any string
   * to the column, which included setting an order to RELEASED without paying
   * anyone, or back to PENDING after a release so it could be released again.
   */
  async setOrderStatus({ staff, orderId, status, note }) {
    return this.db.transaction(async (transaction) => {
      const order = await this.models.P2pOrder.findByPk(orderId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!order) throw errors.ORDER_NOT_FOUND({ orderId });
      if (order.status === ORDER_STATUS.RELEASED || order.status === ORDER_STATUS.CANCELLED) {
        throw errors.ORDER_ALREADY_SETTLED({ orderId, status: order.status });
      }

      await order.update(
        { status, admin_note: note ?? order.admin_note ?? null, updated_at: new Date() },
        { transaction }
      );

      this.logger?.info({ orderId, status, staffId: staff?.id }, 'P2P order status changed');
      return { orderId, status };
    });
  }

  // ── Sell orders ───────────────────────────────────────────────────────

  /** @legacy GET /admin/p2p/sell-orders */
  async sellOrders({ page = 1, limit = DEFAULT_PAGE_SIZE, status, userId, coin } = {}) {
    const where = {};
    if (status) where.status = status;
    if (userId) where.user_id = String(userId);
    if (coin) where.coin = coin;

    const result = await this.models.P2pOrderSell.findAndCountAll({
      where,
      attributes: { exclude: ['qr_image', 'admin_proof_data'] },
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return { rows: result.rows, count: result.count };
  }

  /**
   * @legacy POST /admin/p2p/sell-release/:orderId
   *
   * The seller's crypto was taken when the order opened; the operator has now
   * sent the fiat. Nothing moves in the wallet here — the debit already
   * happened — so this records the proof and closes the order.
   *
   * Legacy registered this route TWICE, once with multer and once without:
   *
   *     router.post('/admin/p2p/sell-release/:orderId', upload.single(...), ctrl.releaseSellOrder);
   *     router.post('/admin/p2p/sell-release/:orderId', ctrl.releaseSellOrder);
   *
   * Express matches the first, so the second was dead — and `releaseSellOrder`
   * also ran its writes with NO transaction at all, unlike its siblings.
   */
  async releaseSellOrder({ staff, orderId, note, file }) {
    const proof = file ? inspect(file, errors) : null;

    return this.db.transaction(async (transaction) => {
      const order = await this.models.P2pOrderSell.findByPk(orderId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!order) throw errors.ORDER_NOT_FOUND({ orderId });
      if (order.status === SELL_STATUS.RELEASED || order.status === SELL_STATUS.CANCELLED) {
        throw errors.ORDER_ALREADY_SETTLED({ orderId, status: order.status });
      }

      const now = new Date();

      await order.update(
        {
          status: SELL_STATUS.RELEASED,
          released_at: now,
          released_by: staff?.id ?? null,
          admin_note: note ?? order.admin_note ?? null,
          admin_proof_data: proof?.data ?? null,
          admin_proof_type: proof?.contentType ?? null,
          admin_proof_size: proof?.byteSize ?? null,
          updated_at: now,
        },
        { transaction }
      );

      this.logger?.warn(
        { orderId, orderNo: order.order_no, userId: order.user_id, staffId: staff?.id },
        'P2P sell order released — fiat paid out'
      );

      return { orderId, status: SELL_STATUS.RELEASED };
    });
  }

  /**
   * @legacy POST /admin/p2p/sell-cancel/:orderId
   *
   * THE DOUBLE-REFUND. Legacy checked only `status === 'RELEASED'`, so
   * cancelling an order that was already CANCELLED refunded the crypto again,
   * as many times as the endpoint was called — on a route with no
   * authentication.
   */
  async cancelSellOrder({ staff, orderId, note }) {
    return this.db.transaction(async (transaction) => {
      const order = await this.models.P2pOrderSell.findByPk(orderId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!order) throw errors.ORDER_NOT_FOUND({ orderId });

      // Both terminal states, not just RELEASED.
      if (order.status === SELL_STATUS.RELEASED || order.status === SELL_STATUS.CANCELLED) {
        throw errors.ORDER_ALREADY_SETTLED({ orderId, status: order.status });
      }

      const now = new Date();

      await order.update(
        {
          status: SELL_STATUS.CANCELLED,
          cancelled_at: now,
          cancelled_by: staff?.id ?? null,
          admin_note: note ?? order.admin_note ?? null,
          updated_at: now,
        },
        { transaction }
      );

      const movement = await this.wallet.credit(
        {
          userId: order.user_id,
          currency: order.coin,
          amount: String(order.crypto_amount),
          reason: REASON.SELL_REFUND,
          /**
           * The second guard against the double refund. Even if two requests
           * somehow both got past the status check, the wallet returns the
           * first movement for the second call.
           */
          idempotencyKey: `p2p-sell-refund:${order.order_no}`,
          refType: 'P2P_SELL',
          refId: String(order.id),
          description: `P2P sell cancelled — order ${order.order_no}`,
        },
        { sourceService: 'user-service', transaction }
      );

      this.logger?.warn(
        {
          orderId,
          orderNo: order.order_no,
          userId: order.user_id,
          coin: order.coin,
          amount: String(order.crypto_amount),
          staffId: staff?.id,
          ledgerId: movement.ledgerId,
        },
        'P2P sell order cancelled — crypto refunded'
      );

      return { orderId, status: SELL_STATUS.CANCELLED, newBalance: movement.newBalance };
    });
  }

  // ── Disputes ──────────────────────────────────────────────────────────

  /** @legacy GET /admin/p2p/disputes */
  async disputes({ page = 1, limit = DEFAULT_PAGE_SIZE, status } = {}) {
    const where = {};
    if (status) where.status = status;

    const result = await this.models.P2pDispute.findAndCountAll({
      where,
      attributes: { exclude: ['screenshot_data'] },
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return { rows: result.rows, count: result.count };
  }

  /**
   * @legacy PUT /admin/p2p/dispute/:disputeId/status
   *
   * Resolving a dispute does NOT move money and does not settle the order — an
   * operator releases or cancels explicitly, through the endpoints that do the
   * wallet movement. What this does is take the order out of DISPUTED so those
   * endpoints can act on it.
   *
   * Legacy updated the dispute row and left the order wherever it was.
   */
  async setDisputeStatus({ staff, disputeId, status, adminNote }) {
    return this.db.transaction(async (transaction) => {
      const dispute = await this.models.P2pDispute.findByPk(disputeId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!dispute) throw errors.DISPUTE_NOT_FOUND({ disputeId });
      if (dispute.status === DISPUTE_STATUS.RESOLVED || dispute.status === DISPUTE_STATUS.REJECTED) {
        throw errors.DISPUTE_CLOSED({ disputeId, status: dispute.status });
      }

      const now = new Date();
      const closing = status === DISPUTE_STATUS.RESOLVED || status === DISPUTE_STATUS.REJECTED;

      await dispute.update(
        {
          status,
          admin_note: adminNote ?? dispute.admin_note ?? null,
          resolved_by: closing ? (staff?.id ?? null) : null,
          resolved_at: closing ? now : null,
        },
        { transaction }
      );

      if (closing) {
        /**
         * Put the order back where it was so it can be settled.
         *
         * A buy order that was PAID when the dispute opened goes back to PAID —
         * not to RELEASED. Deciding a dispute is not the same act as paying
         * out, and conflating them is how a dispute resolution becomes a
         * credit nobody reviewed.
         */
        const model =
          dispute.order_type === DISPUTE_ORDER_TYPE.SELL ? this.models.P2pOrderSell : this.models.P2pOrder;
        const back = dispute.order_type === DISPUTE_ORDER_TYPE.SELL ? SELL_STATUS.PENDING : ORDER_STATUS.PAID;

        await model.update(
          { status: back, updated_at: now },
          { where: { id: dispute.order_id, status: 'DISPUTED' }, transaction }
        );
      }

      this.logger?.info({ disputeId, status, staffId: staff?.id }, 'P2P dispute status changed');
      return dispute.get({ plain: true });
    });
  }

  /** A proof image, for an operator reviewing a trade. */
  async proofImage({ kind, id }) {
    const source = {
      order: {
        model: this.models.P2pOrder,
        data: 'payment_proof_data',
        type: 'payment_proof_type',
        size: 'payment_proof_size',
      },
      sell: {
        model: this.models.P2pOrderSell,
        data: 'admin_proof_data',
        type: 'admin_proof_type',
        size: 'admin_proof_size',
      },
      qr: { model: this.models.P2pOrderSell, data: 'qr_image', type: 'qr_image_type', size: null },
      dispute: {
        model: this.models.P2pDispute,
        data: 'screenshot_data',
        type: 'screenshot_type',
        size: 'screenshot_size',
      },
    }[kind];

    if (!source) throw errors.NO_IMAGE({ kind });

    const row = await source.model.findByPk(id, {
      attributes: ['id', source.data, source.type, ...(source.size ? [source.size] : [])],
      raw: true,
    });

    if (!row) throw errors.ORDER_NOT_FOUND({ id, kind });
    if (!row[source.data]) throw errors.NO_IMAGE({ id, kind });

    const data = Buffer.from(row[source.data]);
    return {
      data,
      contentType: row[source.type] || 'application/octet-stream',
      byteSize: (source.size ? row[source.size] : null) ?? data.length,
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  #describeAccount(row) {
    return {
      id: row.id,
      paymentTypeId: row.payment_type_id,
      accountName: row.account_name ?? null,
      accountNumber: row.account_number ?? null,
      ifscCode: row.ifsc_code ?? null,
      upiId: row.upi_id ?? null,
      extraDetails: row.extra_details ?? null,
    };
  }
}

module.exports = { P2pAdminService };
