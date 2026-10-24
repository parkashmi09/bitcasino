'use strict';

const crypto = require('crypto');

const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./crypto.errors');
const {
  COIN_COLUMNS,
  CCPAYMENT_STATUS,
  CCPAYMENT_OK,
} = require('./crypto.constants');
const { WalletService } = require('../wallet/wallet.service');
const { createHttpClient } = require('../psp/providers/http');
const { REASON } = require('../wallet/wallet.constants');
const { FirstDepositBonusService } = require('../bonus/firstDepositBonus.service');
const { notifyPlayer } = require('../notifications/notifyPlayer');

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
    this.firstDepositBonus = deps.firstDepositBonus ?? new FirstDepositBonusService(deps);
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
   * 2. WHAT ARRIVED. The webhook is a hint, not the money: its body carries
   *    no amount and its status is not final (CCPayment's doc). The order's
   *    own record (`getAppOrderInfo`) decides — each payment in its
   *    `paidList` that is `Success` and not `isFlaggedAsRisky` is credited at
   *    the amount RECEIVED, once, keyed on CCPayment's `recordId`.
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

    const orderId = msg?.orderId == null ? '' : String(msg.orderId);
    if (!orderId) return { handled: false, reason: 'no order id' };

    // Not ours (another app on the same CCPayment account): acknowledged, and CCPayment is not asked.
    const known = await this.models.Ccdeposit.findOne({ where: { orderid: orderId }, attributes: ['id'], raw: true });
    if (!known) {
      this.logger?.warn({ orderId }, 'CCPayment webhook for an unknown order');
      return { handled: false, reason: 'unknown order' };
    }

    // Before the transaction, so no lock is held across a call to the provider.
    // If CCPayment cannot answer, this throws, the webhook gets a 5xx and CCPayment retries.
    const { data: order } = await this.#ccpayment('/ccpayment/v2/getAppOrderInfo', { orderId });

    const currency = String(order?.coinSymbol ?? '').toUpperCase();
    if (!COIN_COLUMNS[currency]) {
      /**
       * Refused, and LOUD. A coin this platform does not hold is somebody
       * enabling it upstream without telling us — a human decides.
       */
      this.logger?.error({ orderId, coinSymbol: order?.coinSymbol }, 'CCPayment order is in a coin this platform does not hold — refusing to credit');
      throw errors.UNSUPPORTED_COIN({ coinSymbol: order?.coinSymbol });
    }

    const outcome = await this.db.transaction(async (transaction) => {
      // One handler per order at a time.
      const { result } = await this.db.advisoryLock(
        `ccpayment:${orderId}`,
        async () => this.#applyDeposit({ orderId, currency, paid: order?.paidList }, transaction),
        { transaction }
      );
      return result;
    });

    // After COMMIT, and never able to fail the webhook — see FirstDepositBonusService.
    for (const credit of outcome.credits) {
      await this.firstDepositBonus.onDepositCredited({
        userId: outcome.userId,
        currency,
        amount: credit.amount,
        ledgerId: credit.ledgerId,
        source: 'CRYPTO_DEPOSIT',
        refId: orderId,
      });
      void notifyPlayer(outcome.userId, {
        kind: 'deposit_credited',
        key: `crypto-deposit:credited:${credit.recordId}`,
        title: 'Deposit received',
        body: '{amount} has been credited to your wallet.',
        link: '#transactions',
        meta: { amount: credit.amount, currency, reference: orderId },
      });
    }
    if (outcome.failed) {
      void notifyPlayer(outcome.userId, {
        kind: 'deposit_failed',
        key: `crypto-deposit:failed:${orderId}`,
        title: 'Deposit failed',
        body: 'Your {amount} deposit did not go through. Nothing was credited.',
        link: '#transactions',
        meta: { amount: outcome.ordered, currency, reference: orderId },
      });
    }
    return { ...outcome, credited: outcome.credits.length > 0 };
  }

  async #applyDeposit({ orderId, currency, paid }, transaction) {
    const deposit = await this.models.Ccdeposit.findOne({ where: { orderid: orderId }, transaction, raw: true });
    const payments = Array.isArray(paid) ? paid : [];

    const confirmed = payments.filter((p) => p.status === CCPAYMENT_STATUS.SUCCESS && p.recordId);
    // A risky payment never lands on its own (CCPayment holds it too) — staff review it on the CCPayment dashboard.
    const settled = confirmed.filter((p) => p.isFlaggedAsRisky !== true);
    if (settled.length < confirmed.length) {
      this.logger?.error({ orderId, userId: deposit.userid }, 'CCPayment flagged a payment as risky — held, not credited');
    }

    const credits = [];
    let received = 0n;
    for (const payment of settled) {
      // What ARRIVED, cut (never rounded up) to the wallet's 8 places.
      const minor = money.toMinor(String(payment.amount ?? '0').trim().replace(/(\.\d{8})\d+$/, '$1'));
      if (minor <= 0n) continue;
      received += minor;

      const movement = await this.wallet.credit(
        {
          userId: deposit.userid,
          currency,
          amount: money.toDecimalString(minor),
          reason: REASON.DEPOSIT,
          // One credit per CCPayment record — a retried or repeated webhook is a replay.
          idempotencyKey: `ccpayment:${payment.recordId}`,
          refType: 'CRYPTO_DEPOSIT',
          refId: orderId,
          description: `${currency} deposit`,
        },
        { sourceService: 'user-service', transaction }
      );
      if (!movement.replayed) {
        credits.push({ recordId: String(payment.recordId), amount: money.toDecimalString(minor), ledgerId: movement.ledgerId });
        this.logger?.info({ orderId, userId: deposit.userid, currency, amount: money.toDecimalString(minor), ledgerId: movement.ledgerId }, 'Crypto deposit credited');
      }
    }

    // Under- and over-payment are both real; the player gets what arrived, and staff see the gap here.
    if (credits.length && deposit.price != null && received !== money.toMinorQuantised(deposit.price)) {
      this.logger?.warn({ orderId, received: money.toDecimalString(received), ordered: String(deposit.price) }, 'CCPayment order paid a different amount than ordered');
    }

    let status = CCPAYMENT_STATUS.PROCESSING;
    if (received > 0n) status = CCPAYMENT_STATUS.SUCCESS;
    else if (confirmed.length) status = CCPAYMENT_STATUS.RISKY;
    else if (payments.length && payments.every((p) => p.status === CCPAYMENT_STATUS.FAILED)) status = CCPAYMENT_STATUS.FAILED;

    await this.models.Ccdeposit.update(
      { status, ...(received > 0n ? { amount: money.toDecimalString(received) } : {}), updated_at: new Date() },
      { where: { orderid: orderId }, transaction }
    );

    return {
      handled: true,
      orderId,
      userId: deposit.userid,
      currency,
      status,
      credits,
      // Told to the player once, when the order first turns Failed.
      failed: status === CCPAYMENT_STATUS.FAILED && deposit.status !== CCPAYMENT_STATUS.FAILED,
      ordered: String(deposit.price ?? '0'),
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
    if (!this.http) missing.push('http client');
    if (missing.length) {
      // The names stay in the server log: the public 503 must not tell anyone which config is missing.
      this.logger?.error({ missing }, 'CCPayment is not configured');
      throw errors.NOT_CONFIGURED();
    }

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
