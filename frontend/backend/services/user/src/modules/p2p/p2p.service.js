'use strict';

const crypto = require('node:crypto');

const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const { WalletService } = require('../wallet/wallet.service');

const errors = require('./p2p.errors');
const { inspect } = require('./p2p.upload');
const {
  ORDER_STATUS,
  SELL_STATUS,
  OPEN_ORDER_STATUSES,
  OPEN_SELL_STATUSES,
  OFFER_STATUS,
  DISPUTE_STATUS,
  DISPUTE_ORDER_TYPE,
  DEFAULT_PAYMENT_MINUTES,
  REASON,
  DEFAULT_PAGE_SIZE,
} = require('./p2p.constants');

/**
 * Peer-to-peer trading — the player's side.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NEVER MOUNTED. TWENTY-ONE ROUTES, NOT ONE GUARD.
 *
 * `legacy/peerTrade/routes.js` registers 21 handlers, thirteen of them under
 * `/admin/p2p/`, and `legacy/index.js` never requires the file. That is the
 * only thing that stopped the following from being live:
 *
 *   POST /admin/p2p/release/:orderId       credits crypto to a wallet
 *   POST /admin/p2p/sell-release/:orderId  completes a fiat payout
 *   POST /admin/p2p/cancel/:orderId        refunds
 *   DELETE /admin/p2p/order/:orderId       destroys the record of a trade
 *
 * — all four unauthenticated, on a router anyone reaching the port could call.
 *
 * ── THE FIVE DEFECTS THAT COST MONEY ─────────────────────────────────────
 *
 * 1. COLUMN-NAME INJECTION INTO THE BALANCE TABLE.
 *
 *        UPDATE credits SET ${order.coin} = ${order.coin} + $1 WHERE uid = $2
 *
 *    `order.coin` is copied from `p2p_offers.coin`, which is copied from the
 *    body of `POST /admin/p2p/create-offer`. A caller's string, interpolated
 *    into SQL as a column name. Fourth instance of this pattern in the platform.
 *
 * 2. RELEASE HAD NO LOCK. `releaseOrder` did SELECT → check `status === 'PAID'`
 *    → UPDATE credits → UPDATE status, with nothing held between the read and
 *    the write. Two concurrent calls both saw PAID and both credited.
 *
 * 3. CANCEL REFUNDED WITHOUT CHECKING IT HAD NOT ALREADY. `cancelSellOrder`
 *    tested only `status === 'RELEASED'`, so cancelling a CANCELLED order
 *    refunded the crypto a second time.
 *
 * 4. THE SELL BALANCE CHECK WAS A READ, THEN A WRITE.
 *
 *        if (wallet.rows[0][offer.coin] < crypto_amount) throw …
 *        UPDATE credits SET … = … - $1
 *
 *    In floats, in two statements. Two concurrent sell orders both passed.
 *
 * 5. NO LEDGER ROW ANYWHERE. Every movement was a bare UPDATE to `credits`.
 *    Nothing in the player's statement, nothing to reconcile against.
 *
 * ── AND THE REST ─────────────────────────────────────────────────────────
 *
 *   `available_amount` on an offer was written once and never decremented, so
 *   an offer for 100 USDT backed an unlimited number of orders.
 *
 *   `generateOrderNo` = `'P2P' + Date.now() + Math.floor(Math.random()*1000)`
 *   against a UNIQUE column — a collision is a 500.
 *
 *   `payment_account_id` was stored from the body without checking it belonged
 *   to the offer.
 *
 *   `createDispute` INSERTed unconditionally: a retry filed a second dispute.
 *
 *   `updateOrderStatus` wrote any string to `status`, including `RELEASED` —
 *   which every guard in this file reads — without moving any money.
 *
 *   Uploads used `multer.diskStorage` with no `fileFilter` at all
 *   (`middleware.js` is nine lines), storing `req.file.filename`. A payment
 *   proof is the evidence in a dispute; it was on one server's disk.
 *
 * ── HOW MONEY MOVES HERE ─────────────────────────────────────────────────
 *
 * Through `wallet.debit` / `wallet.credit`, which take a currency CODE, hold
 * the row lock, guard the debit at `>= amount`, write a ledger row, and honour
 * an idempotency key. The key is derived from the ORDER, so a retried release
 * returns the original movement instead of paying twice.
 * ═════════════════════════════════════════════════════════════════════════
 */
class P2pService {
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

  // ── Reads ─────────────────────────────────────────────────────────────

  /**
   * @legacy GET /p2p/offers
   *
   * Only ACTIVE offers with something left. Legacy returned every row of
   * `p2p_offers` regardless of status or remaining amount, so a client could
   * open an order against an exhausted offer and only find out at settlement.
   */
  async offers({ coin, fiat, segment, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
    const where = { status: OFFER_STATUS.ACTIVE, available_amount: { [Op.gt]: 0 } };
    if (coin) where.coin = coin;
    if (fiat) where.fiat = fiat;
    if (segment) where.segment = segment;

    const result = await this.models.P2pOffer.findAndCountAll({
      where,
      order: [
        ['is_featured', 'DESC'],
        ['price', 'ASC'],
        ['id', 'DESC'],
      ],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return { rows: result.rows.map((row) => this.#describeOffer(row)), count: result.count };
  }

  /**
   * @legacy GET /p2p/orders/:userId
   *
   * The player's own buy orders. Legacy took the id from the PATH, so the
   * endpoint returned anyone's trading history to anyone who asked.
   */
  async myOrders({ userId, status, page = 1, limit = DEFAULT_PAGE_SIZE }) {
    const where = { user_id: String(userId) };
    if (status) where.status = status;

    const result = await this.models.P2pOrder.findAndCountAll({
      where,
      // Never the proof bytes in a list.
      attributes: this.#orderColumns(),
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return { rows: result.rows.map((row) => this.#describeOrder(row)), count: result.count };
  }

  /** @legacy GET /p2p/sell-orders/:userId — same, for sells. */
  async mySellOrders({ userId, status, page = 1, limit = DEFAULT_PAGE_SIZE }) {
    const where = { user_id: String(userId) };
    if (status) where.status = status;

    const result = await this.models.P2pOrderSell.findAndCountAll({
      where,
      attributes: this.#sellColumns(),
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return { rows: result.rows.map((row) => this.#describeSell(row)), count: result.count };
  }

  /**
   * @legacy GET /p2p/order/:orderId
   *
   * Legacy had no ownership check: any order id returned the full row,
   * including the counterparty's bank account number and UPI id.
   */
  async orderDetails({ userId, orderId }) {
    const order = await this.models.P2pOrder.findOne({
      where: { id: orderId, user_id: String(userId) },
      attributes: this.#orderColumns(),
      raw: true,
    });

    if (!order) throw errors.ORDER_NOT_FOUND({ orderId });

    /**
     * The account to pay INTO comes with the order, because the buyer needs it
     * — but only for their own order, and only the fields they must see.
     */
    const account = order.payment_account_id
      ? await this.models.P2pPaymentAccount.findByPk(order.payment_account_id, {
          attributes: ['id', 'payment_type_id', 'account_name', 'account_number', 'ifsc_code', 'upi_id'],
          raw: true,
        })
      : null;

    return { ...this.#describeOrder(order), paymentAccount: account };
  }

  // ── Buy: the player sends fiat, the platform releases crypto ──────────

  /**
   * @legacy POST /p2p/create-order
   *
   * No money moves here — the player has not paid yet. What this must get
   * right is the offer's remaining amount, which legacy never touched at all.
   */
  async createOrder({ userId, offerId, cryptoAmount, paymentAccountId }) {
    return this.db.transaction(async (transaction) => {
      const offer = await this.models.P2pOffer.findByPk(offerId, {
        transaction,
        // Held for the duration: two buyers taking the last of an offer must
        // not both succeed. Legacy locked nothing and decremented nothing.
        lock: transaction.LOCK.UPDATE,
      });

      if (!offer) throw errors.OFFER_NOT_FOUND({ offerId });
      if (offer.status !== OFFER_STATUS.ACTIVE) throw errors.OFFER_INACTIVE({ offerId });

      this.#checkLimits(offer, cryptoAmount);

      if (money.lt(offer.available_amount ?? '0', cryptoAmount)) {
        throw errors.OFFER_EXHAUSTED({ offerId, available: String(offer.available_amount ?? '0') });
      }

      /**
       * The account must be one the offer accepts.
       *
       * Legacy stored whatever `payment_account_id` the body named, so a buyer
       * could be shown an account with no relationship to the trade.
       */
      const accepted = await this.models.P2pOfferPayment.findOne({
        where: { offer_id: offerId, payment_account_id: paymentAccountId },
        transaction,
        raw: true,
      });
      if (!accepted) throw errors.ACCOUNT_NOT_ON_OFFER({ offerId, paymentAccountId });

      const minutes = offer.payment_time || DEFAULT_PAYMENT_MINUTES;
      const now = new Date();

      const order = await this.models.P2pOrder.create(
        {
          order_no: this.#orderNo(),
          user_id: String(userId),
          offer_id: offerId,
          payment_account_id: paymentAccountId,
          coin: offer.coin,
          fiat: offer.fiat,
          price: offer.price,
          crypto_amount: cryptoAmount,
          fiat_amount: this.#fiatFor(cryptoAmount, offer.price),
          status: ORDER_STATUS.PENDING,
          expires_at: new Date(now.getTime() + minutes * 60_000),
          created_at: now,
          updated_at: now,
        },
        { transaction }
      );

      /**
       * Hold the amount against the offer.
       *
       * Legacy wrote `available_amount` at offer creation and never changed it,
       * so one offer for 100 USDT could back a hundred orders for 100 USDT and
       * the operator discovered it at release time.
       */
      await offer.update(
        { available_amount: money.toDecimalString(money.subtract(offer.available_amount ?? '0', cryptoAmount)) },
        { transaction }
      );

      this.logger?.info(
        { orderId: order.id, orderNo: order.order_no, userId: String(userId), offerId, cryptoAmount },
        'P2P buy order opened'
      );

      return this.#describeOrder(order.get({ plain: true }));
    });
  }

  /**
   * @legacy POST /p2p/mark-paid/:orderId
   *
   * Legacy read the order id from the path and updated it with no ownership
   * check and no status check — so anyone could mark anyone's order paid, and
   * mark a RELEASED one paid again.
   */
  async markPaid({ userId, orderId, utrNumber, file }) {
    const proof = inspect(file, errors);

    /**
     * The expiry is settled in its OWN transaction, before the one that marks
     * the order paid.
     *
     * ── WHY NOT JUST DO IT INLINE AND THROW ──────────────────────────────
     *
     * Because throwing rolls the transaction back, and the EXPIRED write and
     * the hold release would go with it. The order would stay PENDING and the
     * offer would stay short of the reserved amount — every late payment
     * attempt reporting an expiry that never gets recorded, forever.
     *
     * Two transactions is the price of a refusal that also PERSISTS something.
     * Legacy never compared `expires_at` to the clock at all, so it had neither
     * problem and neither behaviour.
     */
    const expired = await this.#expireIfLate({ userId, orderId });
    if (expired) throw errors.ORDER_EXPIRED({ orderId, expiredAt: expired });

    return this.db.transaction(async (transaction) => {
      const order = await this.models.P2pOrder.findOne({
        where: { id: orderId, user_id: String(userId) },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!order) throw errors.ORDER_NOT_FOUND({ orderId });
      if (order.status !== ORDER_STATUS.PENDING) throw errors.ORDER_NOT_PENDING({ orderId, status: order.status });

      await order.update(
        {
          status: ORDER_STATUS.PAID,
          utr_number: utrNumber,
          payment_proof_data: proof.data,
          payment_proof_type: proof.contentType,
          payment_proof_size: proof.byteSize,
          paid_at: new Date(),
          updated_at: new Date(),
        },
        { transaction }
      );

      this.logger?.info({ orderId, userId: String(userId), bytes: proof.byteSize }, 'P2P buy order marked paid');

      return this.#describeOrder(order.get({ plain: true }));
    });
  }

  /**
   * Mark a PENDING order EXPIRED if its clock has run out, and give the
   * reserved amount back to the offer.
   *
   * Commits on its own so the caller can refuse the request afterwards without
   * discarding this. Returns the expiry time when it acted, null otherwise.
   */
  async #expireIfLate({ userId, orderId }) {
    return this.db.transaction(async (transaction) => {
      const order = await this.models.P2pOrder.findOne({
        where: { id: orderId, user_id: String(userId) },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!order) return null;
      if (order.status !== ORDER_STATUS.PENDING) return null;
      if (!order.expires_at || new Date(order.expires_at) >= new Date()) return null;

      await order.update({ status: ORDER_STATUS.EXPIRED, updated_at: new Date() }, { transaction });
      await this.#releaseHold(order, transaction);

      this.logger?.info({ orderId, userId: String(userId) }, 'P2P buy order expired — hold released');
      return order.expires_at;
    });
  }

  // ── Sell: the platform takes crypto now and pays fiat later ───────────

  /**
   * @legacy POST /p2p/create-sell-order
   *
   * THE CRYPTO LEAVES THE WALLET HERE. Legacy did:
   *
   *     SELECT ${offer.coin} FROM credits WHERE uid=$1     -- read
   *     if (wallet.rows[0][offer.coin] < crypto_amount)    -- compare, in floats
   *     UPDATE credits SET ${offer.coin} = ... - $1        -- write
   *
   * Three statements with nothing held between them, comparing IEEE-754
   * doubles, and interpolating a caller-chosen string as a column name.
   *
   * `wallet.debit` is one guarded UPDATE — `WHERE balance >= amount` — that
   * either moves the money and writes a ledger row, or does not.
   */
  async createSellOrder({ userId, offerId, cryptoAmount, paymentTypeId, accountName, accountNumber, ifscCode, upiId, file }) {
    const qr = file ? inspect(file, errors) : null;

    return this.db.transaction(async (transaction) => {
      const offer = await this.models.P2pOffer.findByPk(offerId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!offer) throw errors.OFFER_NOT_FOUND({ offerId });
      if (offer.status !== OFFER_STATUS.ACTIVE) throw errors.OFFER_INACTIVE({ offerId });

      this.#checkLimits(offer, cryptoAmount);

      const paymentType = await this.models.P2pPaymentType.findByPk(paymentTypeId, { transaction, raw: true });
      if (!paymentType) throw errors.PAYMENT_TYPE_NOT_FOUND({ paymentTypeId });

      const now = new Date();
      const orderNo = this.#orderNo();

      /**
       * The order row is written BEFORE the debit.
       *
       * The debit's idempotency key is derived from `order_no`, so it needs the
       * row to exist. And the failure this ordering produces — a row with no
       * debit — rolls back with the transaction, where the opposite (money gone,
       * no order) would not be recoverable from anything the player can see.
       */
      const order = await this.models.P2pOrderSell.create(
        {
          order_no: orderNo,
          user_id: String(userId),
          offer_id: offerId,
          payment_type_id: paymentTypeId,
          coin: offer.coin,
          fiat: offer.fiat,
          price: offer.price,
          crypto_amount: cryptoAmount,
          fiat_amount: this.#fiatFor(cryptoAmount, offer.price),
          account_name: accountName ?? null,
          account_number: accountNumber ?? null,
          ifsc_code: ifscCode ?? null,
          upi_id: upiId ?? null,
          qr_image: qr?.data ?? null,
          qr_image_type: qr?.contentType ?? null,
          status: SELL_STATUS.PENDING,
          expires_at: new Date(now.getTime() + (offer.payment_time || DEFAULT_PAYMENT_MINUTES) * 60_000),
          created_at: now,
          updated_at: now,
        },
        { transaction }
      );

      try {
        await this.wallet.debit(
          {
            userId,
            currency: offer.coin,
            amount: cryptoAmount,
            reason: REASON.SELL_HOLD,
            // From the order, so a retry cannot debit twice.
            idempotencyKey: `p2p-sell-hold:${orderNo}`,
            refType: 'P2P_SELL',
            refId: String(order.id),
            description: `P2P sell — order ${orderNo}`,
          },
          { sourceService: 'user-service', transaction }
        );
      } catch (error) {
        if (error.code === 'WALLET_INSUFFICIENT_FUNDS') {
          throw errors.INSUFFICIENT_BALANCE({
            coin: offer.coin,
            requested: cryptoAmount,
            available: error.details?.available,
          });
        }
        throw error;
      }

      this.logger?.info(
        { orderId: order.id, orderNo, userId: String(userId), coin: offer.coin, cryptoAmount },
        'P2P sell order opened — crypto held'
      );

      return this.#describeSell(order.get({ plain: true }));
    });
  }

  // ── Disputes ──────────────────────────────────────────────────────────

  /**
   * @legacy POST /p2p/dispute
   *
   * Legacy took `user_id` and `order_id` from the body with no check that the
   * order was the caller's, and INSERTed unconditionally — so a retry filed a
   * second dispute and resolving one left the other open forever.
   */
  async createDispute({ userId, orderId, orderType, reason, message, file }) {
    const shot = file ? inspect(file, errors) : null;

    const model = orderType === DISPUTE_ORDER_TYPE.SELL ? this.models.P2pOrderSell : this.models.P2pOrder;
    const order = await model.findOne({ where: { id: orderId, user_id: String(userId) }, raw: true });

    if (!order) throw errors.ORDER_NOT_FOUND({ orderId, orderType });

    const existing = await this.models.P2pDispute.findOne({
      where: { order_id: orderId, order_type: orderType },
      raw: true,
    });
    if (existing) throw errors.DISPUTE_EXISTS({ orderId, disputeId: existing.id });

    const dispute = await this.models.P2pDispute.create({
      order_id: orderId,
      order_no: order.order_no,
      user_id: String(userId),
      order_type: orderType,
      reason,
      message: message ?? null,
      screenshot_data: shot?.data ?? null,
      screenshot_type: shot?.contentType ?? null,
      screenshot_size: shot?.byteSize ?? null,
      status: DISPUTE_STATUS.OPEN,
      created_at: new Date(),
    });

    /**
     * Flag the order so it cannot be released or cancelled while contested.
     *
     * Legacy left the order in whatever status it was in, so an operator could
     * release it without ever seeing the dispute.
     */
    const openStatuses = orderType === DISPUTE_ORDER_TYPE.SELL ? OPEN_SELL_STATUSES : OPEN_ORDER_STATUSES;
    if (openStatuses.includes(order.status)) {
      await model.update({ status: 'DISPUTED', updated_at: new Date() }, { where: { id: orderId } });
    }

    this.logger?.warn(
      { disputeId: dispute.id, orderId, orderType, userId: String(userId), reason },
      'P2P dispute opened'
    );

    return this.#describeDispute(dispute.get({ plain: true }));
  }

  // ── Images ────────────────────────────────────────────────────────────

  /**
   * A proof image, for the player who owns the record it belongs to.
   *
   * Legacy served these from a static mount by filename — so anyone who could
   * guess or enumerate a filename could read another player's bank details or
   * payment screenshot.
   */
  async proofImage({ userId, kind, id }) {
    const source = {
      order: {
        model: this.models.P2pOrder,
        data: 'payment_proof_data',
        type: 'payment_proof_type',
        size: 'payment_proof_size',
      },
      sell: { model: this.models.P2pOrderSell, data: 'qr_image', type: 'qr_image_type', size: null },
      dispute: {
        model: this.models.P2pDispute,
        data: 'screenshot_data',
        type: 'screenshot_type',
        size: 'screenshot_size',
      },
    }[kind];

    if (!source) throw errors.NO_IMAGE({ kind });

    const row = await source.model.findOne({
      where: { id, user_id: String(userId) },
      attributes: ['id', source.data, source.type, ...(source.size ? [source.size] : [])].filter(Boolean),
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

  /**
   * A unique order number.
   *
   * Legacy: `'P2P' + Date.now() + Math.floor(Math.random() * 1000)` against a
   * UNIQUE column — a thousand possible suffixes per millisecond, and a
   * collision surfaced as a 500 carrying a constraint name. 48 bits of
   * randomness here, which is not a collision anyone will see.
   */
  #orderNo() {
    return `P2P${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  }

  /** `crypto × price`, in exact decimals. Legacy multiplied doubles. */
  #fiatFor(cryptoAmount, price) {
    return money.toDecimalString(money.multiply(money.toMinor(cryptoAmount), money.toMinor(price)));
  }

  #checkLimits(offer, amount) {
    if (offer.min_limit && money.lt(amount, offer.min_limit)) {
      throw errors.BELOW_MIN_LIMIT({ minimum: String(offer.min_limit), amount });
    }
    if (offer.max_limit && money.gt(amount, offer.max_limit)) {
      throw errors.ABOVE_MAX_LIMIT({ maximum: String(offer.max_limit), amount });
    }
  }

  /** Put an expired or cancelled order's amount back on the offer. */
  async #releaseHold(order, transaction) {
    if (!order.offer_id) return;

    const offer = await this.models.P2pOffer.findByPk(order.offer_id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!offer) return;

    await offer.update(
      { available_amount: money.toDecimalString(money.add(offer.available_amount ?? '0', order.crypto_amount)) },
      { transaction }
    );
  }

  /** Order columns without the proof bytes. */
  #orderColumns() {
    return [
      'id',
      'order_no',
      'user_id',
      'offer_id',
      'payment_account_id',
      'coin',
      'fiat',
      'price',
      'crypto_amount',
      'fiat_amount',
      'utr_number',
      'payment_proof_type',
      'payment_proof_size',
      'status',
      'expires_at',
      'paid_at',
      'released_at',
      'cancelled_at',
      'created_at',
      'updated_at',
    ];
  }

  #sellColumns() {
    return [
      'id',
      'order_no',
      'user_id',
      'offer_id',
      'payment_type_id',
      'coin',
      'fiat',
      'price',
      'crypto_amount',
      'fiat_amount',
      'account_name',
      'account_number',
      'ifsc_code',
      'upi_id',
      'qr_image_type',
      'admin_note',
      'admin_proof_type',
      'status',
      'expires_at',
      'released_at',
      'cancelled_at',
      'created_at',
      'updated_at',
    ];
  }

  #describeOffer(row) {
    return {
      id: row.id,
      coin: row.coin,
      fiat: row.fiat,
      segment: row.segment,
      price: String(row.price),
      availableAmount: String(row.available_amount ?? '0'),
      minLimit: row.min_limit === null ? null : String(row.min_limit),
      maxLimit: row.max_limit === null ? null : String(row.max_limit),
      paymentTime: row.payment_time,
      username: row.username ?? null,
      avatarLetter: row.avatar_letter ?? null,
      isVerified: row.is_verified === true,
      isKycVerified: row.is_kyc_verified === true,
      isFeatured: row.is_featured === true,
      status: row.status,
    };
  }

  #describeOrder(row) {
    return {
      id: row.id,
      orderNo: row.order_no,
      coin: row.coin,
      fiat: row.fiat,
      price: String(row.price),
      cryptoAmount: String(row.crypto_amount),
      fiatAmount: String(row.fiat_amount),
      utrNumber: row.utr_number ?? null,
      status: row.status,
      /**
       * The countdown legacy computed and no handler enforced. It is derived
       * here rather than stored, so it cannot disagree with `expires_at`.
       */
      ...this.#timeRemaining(row.expires_at),
      paidAt: row.paid_at ?? null,
      releasedAt: row.released_at ?? null,
      cancelledAt: row.cancelled_at ?? null,
      proofUrl: row.payment_proof_size ? `/api/v1/user/p2p/orders/${row.id}/proof` : null,
      createdAt: row.created_at,
    };
  }

  #describeSell(row) {
    return {
      id: row.id,
      orderNo: row.order_no,
      coin: row.coin,
      fiat: row.fiat,
      price: String(row.price),
      cryptoAmount: String(row.crypto_amount),
      fiatAmount: String(row.fiat_amount),
      accountName: row.account_name ?? null,
      accountNumber: row.account_number ?? null,
      ifscCode: row.ifsc_code ?? null,
      upiId: row.upi_id ?? null,
      qrUrl: row.qr_image_type ? `/api/v1/user/p2p/sell-orders/${row.id}/qr` : null,
      status: row.status,
      adminNote: row.admin_note ?? null,
      ...this.#timeRemaining(row.expires_at),
      releasedAt: row.released_at ?? null,
      cancelledAt: row.cancelled_at ?? null,
      createdAt: row.created_at,
    };
  }

  #describeDispute(row) {
    return {
      id: row.id,
      orderId: row.order_id,
      orderNo: row.order_no ?? null,
      orderType: row.order_type,
      reason: row.reason,
      message: row.message ?? null,
      status: row.status,
      adminNote: row.admin_note ?? null,
      screenshotUrl: row.screenshot_size ? `/api/v1/user/p2p/disputes/${row.id}/screenshot` : null,
      resolvedAt: row.resolved_at ?? null,
      createdAt: row.created_at,
    };
  }

  /**
   * Legacy's `getTimeRemaining`, kept — the client renders this countdown.
   *
   * The difference is that here the SERVER also acts on it: `markPaid` refuses
   * an expired order and releases the hold. Legacy computed the number, sent
   * it, and never compared it to anything.
   */
  #timeRemaining(expiresAt) {
    if (!expiresAt) return { expired: false, remaining: null };

    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return { expired: true, remaining: null };

    return {
      expired: false,
      remaining: {
        minutes: Math.floor(diff / 60_000),
        seconds: Math.floor((diff % 60_000) / 1000),
        total_ms: diff,
      },
    };
  }
}

module.exports = { P2pService };
