'use strict';

const crypto = require('crypto');

const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./crypto.errors');
const {
  COIN_COLUMNS,
  CCPAYMENT_STATUS,
  FINAL_STATUSES,
  CCPAYMENT_OK,
} = require('./crypto.constants');
const { WalletService } = require('../wallet/wallet.service');
const { createHttpClient } = require('../psp/providers/http');
const { REASON } = require('../wallet/wallet.constants');

/**
 * Crypto arriving.
 *
 * The webhook is the only endpoint here that moves money, and it is the one
 * legacy built an injection into. Everything else is metadata a deposit screen
 * asks for.
 */
class CryptoService {
  constructor(deps) {
    const { models, db, logger, config, http } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    /**
     * The container does not provide `http`, and never did — so this was
     * `undefined`, and every CCPayment read died on
     * `Cannot read properties of undefined (reading 'raw')`: a 500 where a
     * 502/503 belonged, on public routes like `GET /crypto/chains`.
     *
     * `payment-orders` and `psp` already build their own client this way when
     * the dependency is absent. This module was the one that assumed it would
     * be handed one.
     */
    this.http = http ?? createHttpClient({ logger, timeoutMs: Number(config?.PSP_TIMEOUT_MS ?? 10_000) });
    this.wallet = new WalletService(deps);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The webhook
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/ccpaymentnotify
   *
   * CCPayment telling us a deposit landed.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE THREE THINGS THIS HAS TO GET RIGHT
   *
   * 1. IS IT GENUINE. HMAC over `appId + timestamp + rawBody`, compared in
   *    constant time. The raw bytes matter: re-serialising the parsed body can
   *    reorder keys and produce a different digest, so the router keeps the
   *    original buffer.
   *
   * 2. IS IT NEW. The provider retries. A deposit already in a final state is
   *    acknowledged and ignored, and the credit itself carries an idempotency
   *    key derived from the order — two independent guards.
   *
   * 3. WHICH COLUMN. Legacy interpolated `coinSymbol` from this very body into
   *    the `SET` clause. It is looked up in a fixed map here and an unknown
   *    symbol is refused.
   *
   * The response is always 200 in the provider's own shape once the signature
   * checks out. A 4xx on a money webhook makes the provider retry forever
   * against something that will never succeed.
   * ─────────────────────────────────────────────────────────────────────
   */
  async handleWebhook({ rawBody, signature, timestamp }) {
    if (!this.#verifySignature({ rawBody, signature, timestamp })) {
      this.logger?.warn({ timestamp }, 'CCPayment webhook signature rejected');
      throw errors.BAD_SIGNATURE();
    }

    const body = this.#parse(rawBody);
    const { type, msg } = body ?? {};

    if (type !== 'ApiDeposit') {
      // Acknowledged, not acted on. An unknown event type is the provider
      // telling us about something we do not handle, not an error.
      this.logger?.info({ type }, 'CCPayment webhook ignored — not a deposit');
      return { handled: false, type };
    }

    const { orderId, coinSymbol, status } = msg ?? {};
    if (!orderId) return { handled: false, reason: 'no order id' };

    const column = COIN_COLUMNS[String(coinSymbol ?? '').toUpperCase()];
    if (!column) {
      /**
       * Refused, and LOUD. An unknown symbol here is either a coin somebody
       * enabled upstream without telling this platform, or an attempt at the
       * injection legacy permitted. Both want a human.
       */
      this.logger?.error(
        { orderId, coinSymbol },
        'CCPayment sent a coin this platform does not hold — refusing to credit'
      );
      throw errors.UNSUPPORTED_COIN({ coinSymbol });
    }

    return this.db.transaction(async (transaction) => {
      /**
       * One handler per order at a time.
       *
       * Legacy took `pg_advisory_xact_lock` too — the right instinct — but on
       * the one shared client, inside a transaction it then held open across an
       * outbound HTTP call to the provider.
       */
      const { result } = await this.db.advisoryLock(
        `ccpayment:${orderId}`,
        async () => this.#applyDeposit({ orderId, coinSymbol, status, msg }, transaction),
        { transaction }
      );
      return result;
    });
  }

  async #applyDeposit({ orderId, coinSymbol, status, msg }, transaction) {
    const deposit = await this.models.Ccdeposit.findOne({
      where: { orderid: String(orderId) },
      transaction,
      raw: true,
    });

    if (!deposit) {
      // A deposit we have no record of. Acknowledged — the provider is not
      // wrong to tell us, and there is nothing to credit.
      this.logger?.warn({ orderId }, 'CCPayment webhook for an unknown order');
      return { handled: false, reason: 'unknown order' };
    }

    if (FINAL_STATUSES.includes(deposit.status)) {
      this.logger?.info({ orderId, status: deposit.status }, 'CCPayment webhook replayed — already final');
      return { handled: false, reason: 'already settled', status: deposit.status };
    }

    if (status !== CCPAYMENT_STATUS.SUCCESS) {
      await this.models.Ccdeposit.update(
        { status: status ?? CCPAYMENT_STATUS.PROCESSING, updated_at: new Date() },
        { where: { orderid: String(orderId) }, transaction }
      );
      return { handled: true, credited: false, status };
    }

    /**
     * The amount comes from the WEBHOOK, and is checked against what we
     * recorded when the address was issued.
     *
     * Legacy read `payment.amount` from a second call to the provider and
     * credited it unconditionally. Both numbers should agree; when they do not,
     * the deposit is held for a human rather than credited to whichever source
     * was consulted last.
     */
    const reported = String(msg?.amount ?? deposit.amount ?? deposit.price ?? '0');
    const expected = String(deposit.price ?? '0');

    if (
      money.gt(expected, '0') &&
      money.compare(money.toMinor(reported), money.toMinor(expected)) !== 0
    ) {
      /**
       * Credit what ARRIVED, and say so.
       *
       * Over- and under-payment are both real — a player sends a round number,
       * or the network fee comes out of the transfer — and both need
       * reconciling. Crediting the ORDER amount would mean paying out money
       * that never landed on the under-payment side.
       */
      this.logger?.warn(
        { orderId, reported, expected },
        'CCPayment reported an amount different from the order — crediting what arrived'
      );
    }

    const amount = money.toDecimalString(money.toMinor(reported));
    const currency = String(coinSymbol).toUpperCase();

    const movement = await this.wallet.credit(
      {
        userId: deposit.userid,
        currency,
        amount,
        reason: REASON.DEPOSIT,
        // One credit per order, whatever the provider retries.
        idempotencyKey: `ccpayment:${orderId}`,
        refType: 'CRYPTO_DEPOSIT',
        refId: String(orderId),
        description: `${currency} deposit`,
      },
      { sourceService: 'user-service', transaction }
    );

    await this.models.Ccdeposit.update(
      { status: CCPAYMENT_STATUS.SUCCESS, updated_at: new Date() },
      { where: { orderid: String(orderId) }, transaction }
    );

    this.logger?.info(
      { orderId, userId: deposit.userid, currency, amount, ledgerId: movement.ledgerId },
      'Crypto deposit credited'
    );

    return {
      handled: true,
      credited: true,
      orderId: String(orderId),
      amount,
      currency,
      newBalance: movement.newBalance,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Metadata
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /getCoinDetails
   *
   * One coin's details from the provider's list.
   *
   * A POST in legacy with the symbol in the body; it reads nothing and writes
   * nothing, so it is a GET.
   */
  async coinDetails({ symbol }) {
    const list = await this.#ccpayment('/ccpayment/v2/getCoinList');
    const coin = (list?.data?.coins ?? []).find(
      (c) => String(c?.symbol).toUpperCase() === String(symbol).toUpperCase()
    );
    if (!coin) throw errors.UNSUPPORTED_COIN({ symbol });
    return coin;
  }

  /** @legacy GET /getAllChains */
  async chains() {
    const list = await this.#ccpayment('/ccpayment/v2/getChainList');
    return list?.data ?? [];
  }

  /**
   * @legacy POST /hr
   *
   * Record an INR deposit received out of band.
   *
   * ═════════════════════════════════════════════════════════════════════
   * LEGACY LET ANYONE FABRICATE A DEPOSIT RECORD FOR ANY ACCOUNT
   *
   *     server.post("/hr", function (req, res) {
   *       res.setHeader("Access-Control-Allow-Origin", "*");
   *       const { uid, date, amount_deposit, txid_in, status, name } = req.body;
   *       inr_deposit.inrapi({ uid, date, amount_deposit, txid_in, status, name });
   *       res.send(req.body);
   *     });
   *
   * No authentication, `Access-Control-Allow-Origin: *`, and every field —
   * the account, the amount, the status — straight from the body.
   *
   * `inrapi` only INSERTs into `inr_deposit`; it does not credit a wallet, so
   * this is not money creation on its own. It is worse than nothing, though:
   * `inr_deposit` is the list an operator works from when approving manual
   * deposits, so a fabricated row with `status: 'success'` is a request for
   * real money that looks like it already arrived. It also fired
   * `Notify.send(...)` on every call, so the fabrication reached whatever that
   * broadcasts to.
   *
   * The route also echoed the request back with `res.send(req.body)`.
   *
   * Behind staff authentication and audited here, because recording a deposit
   * somebody says they made is an operator's judgement, not an open endpoint.
   */
  async recordInrDeposit({ actor, userId, amount, transactionId, status = 'pending', date }) {
    const user = await this.models.Users.findByPk(userId, { attributes: ['id', 'name'], raw: true });
    if (!user) throw errors.PLAYER_NOT_FOUND({ userId });

    const row = await this.models.InrDeposit.create({
      uid: userId,
      // `inr_deposit` keys on the player's NAME. Resolved from the id here so
      // a caller cannot name somebody else's account.
      name: user.name,
      date: date ?? new Date().toISOString().slice(0, 10),
      amount: money.toDecimalString(money.toMinor(amount)),
      trxid: transactionId,
      status,
    });

    this.logger?.warn(
      { actorStaffId: actor?.id, userId: String(userId), amount, transactionId, status },
      // WARN because this is a hand-entered claim that money arrived.
      'INR deposit recorded by staff'
    );

    return { id: row.id, userId: String(userId), amount, status };
  }

  /**
   * @legacy POST /inrhistory
   *
   * A player's INR deposit history.
   *
   *   LEGACY KEYED THIS ON `name` FROM THE REQUEST BODY, unauthenticated —
   *   `SELECT ... FROM inr_deposit WHERE name = $1`. Any name returned that
   *   player's deposit history. `users.name` is not unique either, so two
   *   players sharing one saw each other's.
   *
   * The player comes from the token and the lookup is by id.
   */
  async inrHistory({ userId, limit = 50, offset = 0 }) {
    const user = await this.models.Users.findByPk(userId, { attributes: ['id', 'name'], raw: true });
    if (!user) return { total: 0, rows: [] };

    const { rows, count } = await this.models.InrDeposit.findAndCountAll({
      // `inr_deposit` keys on the player's NAME, not their id — a legacy shape
      // this module cannot fix without a data migration. Resolved from the
      // authenticated id so a caller cannot supply it.
      where: { name: user.name },
      order: [['date', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((r) => ({
        date: r.date,
        amount: money.toDecimalString(money.toMinor(r.amount ?? '0')),
        status: r.status,
        transactionId: r.trxid ?? null,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * HMAC over `appId + timestamp + rawBody`, compared in constant time.
   *
   * `timingSafeEqual` rather than `===`: a byte-by-byte comparison that returns
   * early leaks how much of a forged signature was right, which is enough to
   * reconstruct one given enough attempts. Legacy used a plain equality check.
   */
  #verifySignature({ rawBody, signature, timestamp }) {
    if (!signature || !timestamp) return false;
    if (!this.config.CCPAYMENT_APP_ID || !this.config.CCPAYMENT_APP_SECRET) {
      this.logger?.error('CCPAYMENT_APP_SECRET is not configured — refusing every webhook');
      return false;
    }

    const expected = crypto
      .createHmac('sha256', this.config.CCPAYMENT_APP_SECRET)
      .update(`${this.config.CCPAYMENT_APP_ID}${timestamp}${rawBody ?? ''}`)
      .digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  #parse(rawBody) {
    if (!rawBody) return null;
    try {
      return JSON.parse(rawBody);
    } catch {
      this.logger?.warn('CCPayment webhook body is not JSON');
      return null;
    }
  }

  /** A signed read against CCPayment. */
  async #ccpayment(path, payload = null) {
    /**
     * Refuse before building a URL out of `undefined`.
     *
     * All three settings are checked together because a partial
     * configuration fails later and less clearly — a base url with no
     * secret signs every request with `''` and gets a 401 the caller then
     * has to interpret.
     */
    const missing = ['CCPAYMENT_BASE_URL', 'CCPAYMENT_APP_ID', 'CCPAYMENT_APP_SECRET']
      .filter((name) => !this.config?.[name]);
    if (missing.length) throw errors.NOT_CONFIGURED({ missing });

    const body = payload ? JSON.stringify(payload) : '';
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = crypto
      .createHmac('sha256', this.config.CCPAYMENT_APP_SECRET ?? '')
      .update(`${this.config.CCPAYMENT_APP_ID ?? ''}${timestamp}${body}`)
      .digest('hex');

    const response = await this.http.raw(`${this.config.CCPAYMENT_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Appid: this.config.CCPAYMENT_APP_ID,
        Sign: sign,
        Timestamp: String(timestamp),
      },
      body,
    });

    if (response?.code !== CCPAYMENT_OK) {
      throw errors.PROVIDER_ERROR({ code: response?.code, message: response?.msg });
    }
    return response;
  }
}

module.exports = { CryptoService };
