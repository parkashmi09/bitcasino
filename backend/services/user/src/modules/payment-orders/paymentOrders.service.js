'use strict';

const crypto = require('crypto');

const { money, sitePolicy, operatorSettings, withdrawBlock, currencyRegistry, entitlements } = require('@ibitplay/common');

const errors = require('./paymentOrders.errors');
const { FLOW, userIdFor, APAY_DEPOSIT_SYSTEMS, APAY_WITHDRAWAL_SYSTEMS, APAY_SYSTEM_LABELS } = require('./paymentOrders.constants');

/** A-Pay payment-systems list cache (Payment Methods page) — 5 min, `fresh` skips it. */
const PAYMENT_SYSTEMS_TTL_MS = 5 * 60 * 1000;
const PAYMENT_SYSTEMS_CURRENCY_ORDER = ['INR', 'PKR', 'NPR', 'BDT'];
let paymentSystemsCache = null;
const { getGateway } = require('./gateways');
const { validatePayoutDetails } = require('./payoutDetails');
const { createHttpClient } = require('../psp/providers/http');
const { ccpaymentCoinId, ccpaymentTicker, refreshCcpaymentCoinIds, formatEkqrDate } = require('./gateways');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
const { createWithdrawRequirements } = require('../withdraw-requirements/withdrawRequirements');
const { hubGateway, withdrawalChargePct } = require('../wl-hub/hubGateway');
const companyWallet = require('../wl-hub/companyWallet');
const hubOrders = require('../wl-hub/hubOrders');
const { ccpaymentCall, plainAmount } = require('../crypto/ccpaymentApi');
const { ccpaymentChain } = require('./gateways');

/**
 * Starting a payment — asking a provider to collect money from a player, or to
 * send money to one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG THIS MODULE EXISTS TO REMOVE
 *
 * Every legacy payout endpoint took the user id from the REQUEST BODY, and
 * none of them was behind authentication:
 *
 *   POST /remotes/create-withdrawal   { custom_user_id, amount, currency, data }
 *   POST /cricpay/payout-request      { userId, amount, accountHolder, … }
 *   POST /api/payments/payout/initiate{ userId, money, account, userName }
 *
 * The first deducts the named user's balance and sends a real bank transfer to
 * the account in the request. Anyone who could guess a user id could drain that
 * account into their own bank.
 *
 * The other two are worse in a different way: neither checks a balance or
 * deducts anything at all. They send a payout instruction straight to the
 * provider, so the money leaves the MERCHANT float and no player is debited.
 * There is no upper bound and no record that ties the payout to anyone.
 *
 * Here, the user id comes from the verified token and nowhere else. There is no
 * parameter for it — the routers do not accept one, so a future caller cannot
 * reintroduce this by passing an extra field.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The order of operations for a payout is the part worth being careful about:
 *
 *   1. Validate the destination.  Before any money moves — a malformed IFSC
 *                                 must not hold a player's balance hostage
 *                                 while a doomed request goes to the gateway.
 *   2. Debit.                     Through the wallet, so it is atomic, guarded
 *                                 against overdraft by the database, and lands
 *                                 on the player's statement.
 *   3. Call the gateway.
 *   4. Refund on ANY failure.     Rejection, timeout, or an exception on the
 *                                 way. A held balance with no payout behind it
 *                                 is money the player cannot see or spend.
 *
 * Steps 2 and 4 use derived idempotency keys, so a retry of the same order
 * neither debits twice nor refunds twice.
 */
class PaymentOrdersService {
  constructor(deps) {
    const { models, db, config, logger, http } = deps;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.deps = deps;
    this.wallet = new WalletService(deps);
    this.settings = operatorSettings(deps);
    this.http = http ?? createHttpClient({ logger, timeoutMs: Number(config?.PSP_TIMEOUT_MS ?? 10_000) });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Deposits
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Ask a provider to collect money from the player.
   *
   * @legacy POST /createorderupi
   * @legacy POST /createDeposit
   *
   * Nothing is credited here — the balance moves only when the provider's
   * callback is verified. This writes a PENDING row so that when the callback
   * arrives there is a record to check its amount against, which is the whole
   * basis of the inbound amount check.
   *
   * ─────────────────────────────────────────────────────────────────────
   * BOTH LEGACY ENTRY POINTS NAMED THE PLAYER IN THE BODY
   *
   *     POST /createorderupi  { uid, amount }
   *     POST /createDeposit   { userid, coinId, price, orderId, chain }
   *
   * Unauthenticated, both of them. `userId` here is the authenticated caller
   * and there is no parameter for it — the same rule the other three providers
   * already follow.
   *
   * `/createDeposit` also let the caller choose `orderId`, which is the key
   * `/api/ccpaymentnotify` resolves an incoming crypto payment against.
   * References are generated below.
   *
   * NEITHER CHECKED THE AMOUNT. `amount` and `price` went to the provider as
   * given; `#assertWithinLimits` is what stops a 0.00000001 order or a
   * 10,000,000 one now.
   * ─────────────────────────────────────────────────────────────────────
   */
  async createDeposit({ userId, provider: providerName, currency, amount, method, returnUrl, phone, userName, chain, ip }) {
    await sitePolicy.assertAllowed(this.models, 'deposit_mode', 'automatic', this.logger);
    // The coin registry (061): a coin the owner or the site switched off takes
    // no new deposits (CURRENCY_DISABLED). A registry outage fails open.
    await currencyRegistry.assertCurrencyEnabled(currency);
    const gateway = this.#gateway(providerName);
    await this.#assertOwnerAllows(providerName);
    // CCPayment's coin ids come from its live coin list (cached) — see `ccpaymentCoinId`.
    if (providerName === 'ccpayment') await refreshCcpaymentCoinIds(this.config, this.http);

    if (!gateway.supports(currency, FLOW.PAY_IN, this.config)) {
      throw errors.CURRENCY_NOT_SUPPORTED({ provider: providerName, currency });
    }

    // The deployment's min / max is an INR figure (1 / 10L), so a ccpayment coin deposit has none.
    if (providerName !== 'ccpayment') await this.#assertWithinLimits(amount, currency, FLOW.PAY_IN);

    // F2Pay: an on method in an on currency (`#methods`), checked before the order is recorded.
    // No conversion: F2Pay collects what the wallet is credited.
    let payIn = null;
    if (gateway.methodsInDb) {
      const methods = await this.#methods(providerName, gateway);
      if (!methods.some((m) => m.currency === currency)) throw errors.CURRENCY_NOT_SUPPORTED({ provider: providerName, currency });
      payIn = gateway.payIn(currency, method, methods);
      if (!payIn) throw errors.METHOD_NOT_SUPPORTED({ provider: providerName, method });
    }

    const reference = this.#reference('DEP');

    // The pending row goes in FIRST. If the gateway call succeeds and the row
    // write then fails, the player pays money we have no record of — so the
    // record has to exist before the player can possibly pay.
    await this.#recordPendingDeposit(providerName, {
      reference, userId, currency, amount, method, chain,
    });

    let result;
    try {
      result = await gateway.createDeposit(
        {
          reference,
          userId,
          currency,
          amount,
          method,
          chain,
          returnUrl,
          phone,
          userName,
          notifyUrl: this.#notifyUrl(providerName, FLOW.PAY_IN),
          customerName: userName,
          customerMobile: phone,
          // F2Pay's cashier page wants the payer's own name / email / phone and IP.
          customer: gateway.needsCustomer ? await this.#customer(userId) : null,
          ip,
          payIn,
        },
        this.config,
        { http: this.http }
      );
    } catch (error) {
      await this.#markDepositFailed(providerName, reference, error.message);
      this.logger?.error({ err: error, provider: providerName, reference }, 'Deposit request failed');
      throw error;
    }

    if (!result.ok) {
      await this.#markDepositFailed(providerName, reference, result.message);
      throw errors.PROVIDER_REJECTED({ provider: providerName, reason: result.message });
    }

    await this.#attachProviderReference(providerName, reference, result.providerReference);

    this.logger?.info(
      { provider: providerName, reference, userId, currency, amount },
      'Deposit order created'
    );

    return {
      reference,
      provider: providerName,
      currency,
      amount: money.toDecimalString(money.toMinor(amount)),
      status: 'pending',
      providerReference: result.providerReference ?? null,
      // Where to send the player to pay.
      redirectUrl: result.redirectUrl ?? null,
      // Crypto: the address, memo and confirmation count the player needs.
      // Null for the collect-style providers, which have nothing to show.
      details: result.details ?? null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Withdrawals
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Send money to the player.
   *
   * `userId` is the authenticated player. There is deliberately no way to name
   * a different one — see the note at the top of this file.
   */
  async createWithdrawal({ userId, provider: providerName, currency, amount, method, details, forfeitBonus = false }) {
    // Two gates, and both must be open: the site's chosen mode (the owner panel)
    // and the deployment's kill switch (the backend's own env).
    await sitePolicy.assertAllowed(this.models, 'withdrawal_mode', 'automatic', this.logger);
    // The operator's withdrawal block (migration 091) — WITHDRAW_BLOCKED before anything is held.
    await withdrawBlock.assertWithdrawAllowed(this.models, { userId });
    if (!this.config.AUTO_WITHDRAWALS_ENABLED) {
      // A kill switch that does not require a deploy. Automatic payouts are the
      // single most damaging thing to leave running during an incident.
      throw errors.WITHDRAWALS_DISABLED();
    }
    // A switched-off coin is not paid out, as on the crypto rail (CURRENCY_DISABLED).
    await currencyRegistry.assertCurrencyEnabled(currency);

    const gateway = this.#gateway(providerName);
    await this.#assertOwnerAllows(providerName);

    if (!gateway.supports(currency, FLOW.PAY_OUT, this.config) || !(await this.#currencyOn(gateway, currency))) {
      throw errors.CURRENCY_NOT_SUPPORTED({ provider: providerName, currency });
    }

    await this.#assertWithinLimits(amount, currency, FLOW.PAY_OUT);
    // KYC (PAYORDER_KYC_REQUIRED), wagering (WITHDRAW_WAGER_REQUIRED) and the deposit cap
    // (WITHDRAW_CAP_EXCEEDED), per the owner's policy.
    const applied = await this.#requirements().assertMet(userId, {
      forfeitBonus,
      kycError: (status) => errors.KYC_REQUIRED({ status }),
      amount,
      currency,
    });

    const paymentSystem = method || gateway.systemFor?.(currency, FLOW.PAY_OUT) || method;

    // ── 1. Validate the destination BEFORE holding anything ───────────
    const validation = validatePayoutDetails(paymentSystem, details);
    if (!validation.ok) {
      throw errors.INVALID_PAYOUT_DETAILS({ fields: validation.fields, paymentSystem });
    }

    // Cash only (a bonus is never in the wallet). An active bonus needs the player's confirmation
    // (409 BONUS_FORFEIT_REQUIRED) and is forfeited once the hold below succeeds.
    await this.#playerBonuses().beforeWithdrawal(userId, { forfeitBonus });

    const reference = this.#reference('WD');
    const idempotencyKey = `payout:${providerName}:${reference}`;
    // A copy: the company pays the amount + the parent's charge for this gateway, with the hold.
    const chargePct = this.config.WHITELABEL_MODE ? await withdrawalChargePct(this.deps, providerName) : null;

    // ── 2. Hold the balance ───────────────────────────────────────────
    // One transaction: the deposit cap re-checked under a per-player lock, the hold, and the
    // pending row the cap counts — so two payouts at once cannot both fit under the cap.
    let movement;
    try {
      movement = await this.db.transaction(async (transaction) => {
        await this.#requirements().assertCapInTransaction(userId, { amount, currency, transaction, applied });
        const held = await this.wallet.debit(
          {
            userId,
            currency,
            amount,
            reason: REASON.WITHDRAWAL,
            idempotencyKey,
            refType: `PAYOUT_${providerName.toUpperCase()}`,
            refId: reference,
            description: `${providerName} withdrawal ${reference}`,
          },
          { sourceService: 'user-service', transaction }
        );
        await this.#recordPendingWithdrawal(providerName, {
          reference, userId, currency, amount, paymentSystem, details: validation.value,
        }, { transaction });
        if (chargePct !== null) {
          await companyWallet.onWithdrawal(this.db, { provider: providerName, reference, currency, amount, chargePct }, transaction);
        }
        return held;
      });
    } catch (error) {
      if (error?.code === 'WALLET_INSUFFICIENT_FUNDS') {
        throw errors.INSUFFICIENT_BALANCE({ currency, amount });
      }
      throw error;
    }

    if (forfeitBonus) {
      try {
        await this.#playerBonuses().forfeitForWithdrawal(userId);
      } catch (error) {
        this.logger?.error({ err: error, userId: String(userId), reference }, 'Withdrawal held but the active bonus was not forfeited');
      }
    }

    // ── 3. Ask the gateway to pay ─────────────────────────────────────
    let result;
    try {
      result = await gateway.createWithdrawal(
        {
          reference,
          userId,
          currency,
          amount,
          method: paymentSystem,
          details: validation.value,
          chargePct,
          notifyUrl: this.#notifyUrl(providerName, FLOW.PAY_OUT),
          // F2Pay's payout wants the payee's phone and email.
          customer: gateway.needsCustomer ? await this.#customer(userId) : null,
        },
        this.config,
        { http: this.http }
      );
    } catch (error) {
      // ── 4. Anything went wrong: give the money back ─────────────────
      await this.#refund({ userId, currency, amount, reference, providerName, reason: error.message });
      this.logger?.error({ err: error, provider: providerName, reference, userId }, 'Withdrawal request failed');
      throw error;
    }

    if (!result.ok) {
      await this.#refund({ userId, currency, amount, reference, providerName, reason: result.message });
      throw errors.PROVIDER_REJECTED({ provider: providerName, reason: result.message });
    }

    await this.#attachWithdrawalReference(providerName, reference, result.providerReference);

    this.logger?.info(
      { provider: providerName, reference, userId, currency, amount, ledgerId: movement.ledgerId },
      'Withdrawal sent to provider — balance held pending the callback'
    );

    return {
      reference,
      provider: providerName,
      currency,
      amount: money.toDecimalString(money.toMinor(amount)),
      status: 'pending',
      providerReference: result.providerReference ?? null,
      newBalance: movement.newBalance,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Whitelabel copies (parent only) — modules/wl-hub
  // ══════════════════════════════════════════════════════════════════════

  /**
   * A copy's player deposits by gateway: the order runs on THIS site's gateway account. The copy
   * already checked its own player, limits and method; here: the copy's plan must include the
   * gateway, and this site must have it on and configured. The order is recorded (with the
   * copy's charge rate) before the gateway is asked, so its callback always finds it; psp settles
   * it like any other and modules/wl-hub tells the copy.
   */
  async hubDeposit({ whitelabel, provider: providerName, copyReference, userId, currency, amount, method, chain, returnUrl, customer, ip }) {
    if (!whitelabel.plan?.payments.gateways[providerName]) throw errors.PROVIDER_DISABLED({ provider: providerName });
    const gateway = this.#gateway(providerName);
    await this.#assertOwnerAllows(providerName);
    if (providerName === 'ccpayment') await refreshCcpaymentCoinIds(this.config, this.http);
    if (!gateway.supports(currency, FLOW.PAY_IN, this.config)) throw errors.CURRENCY_NOT_SUPPORTED({ provider: providerName, currency });

    let payIn = null;
    if (gateway.methodsInDb) {
      payIn = gateway.payIn(currency, method, await this.#methods(providerName, gateway));
      if (!payIn) throw errors.METHOD_NOT_SUPPORTED({ provider: providerName, method });
    }

    const reference = this.#reference('DEP');
    const order = await hubOrders.open(this.db, {
      whitelabelId: whitelabel.id,
      provider: providerName,
      flow: 'deposit',
      reference,
      copyReference,
      currency,
      amount,
      chargePct: whitelabel.terms.fees[providerName]?.deposit ?? '0',
    });

    let result;
    try {
      result = await gateway.createDeposit(
        {
          reference,
          userId: `wl${whitelabel.id}-${userId}`,
          currency,
          amount,
          method,
          chain,
          returnUrl,
          phone: customer?.phone,
          userName: customer?.name,
          customerName: customer?.name,
          customerMobile: customer?.phone,
          notifyUrl: this.#notifyUrl(providerName, FLOW.PAY_IN),
          customer: gateway.needsCustomer ? customer ?? {} : null,
          ip,
          payIn,
        },
        this.config,
        { http: this.http }
      );
    } catch (error) {
      await hubOrders.failNow(this.db, order.id, error.message);
      this.logger?.error({ err: error, provider: providerName, reference, whitelabelId: whitelabel.id }, 'Whitelabel deposit request failed');
      throw error;
    }
    if (!result.ok) {
      await hubOrders.failNow(this.db, order.id, result.message);
      return { ok: false, message: result.message };
    }
    await hubOrders.attach(this.db, order.id, result.providerReference);
    this.logger?.info({ provider: providerName, reference, copyReference, whitelabelId: whitelabel.id, currency, amount }, 'Whitelabel deposit order created');
    return { ok: true, reference, providerReference: result.providerReference ?? null, redirectUrl: result.redirectUrl ?? null, details: result.details ?? null };
  }

  /**
   * A copy's player withdraws by gateway: paid from THIS site's gateway account. The copy has
   * already held the player's balance and taken amount + charge from its company at `chargePct`,
   * which must still be the rate here (else 409 HUB_CHARGE_CHANGED and the copy gives both back).
   */
  async hubPayout({ whitelabel, provider: providerName, copyReference, userId, currency, amount, method, details, customer, chargePct }) {
    if (!whitelabel.plan?.payments.gateways[providerName]) throw errors.PROVIDER_DISABLED({ provider: providerName });
    if (providerName === 'ccpayment') return this.#hubCcpaymentPayout({ whitelabel, copyReference, currency, amount, details, chargePct });
    if (!this.config.AUTO_WITHDRAWALS_ENABLED) throw errors.WITHDRAWALS_DISABLED();
    const gateway = this.#gateway(providerName);
    await this.#assertOwnerAllows(providerName);
    if (!gateway.supports(currency, FLOW.PAY_OUT, this.config) || !(await this.#currencyOn(gateway, currency))) {
      throw errors.CURRENCY_NOT_SUPPORTED({ provider: providerName, currency });
    }
    if (money.compare(String(whitelabel.terms.fees[providerName]?.withdraw ?? '0'), String(chargePct)) !== 0) throw hubOrders.chargeChanged();
    const validation = validatePayoutDetails(method, details);
    if (!validation.ok) throw errors.INVALID_PAYOUT_DETAILS({ fields: validation.fields, paymentSystem: method });

    const reference = this.#reference('WD');
    const order = await hubOrders.open(this.db, {
      whitelabelId: whitelabel.id,
      provider: providerName,
      flow: 'payout',
      reference,
      copyReference,
      currency,
      amount,
      chargePct,
    });

    let result;
    try {
      result = await gateway.createWithdrawal(
        {
          reference,
          userId: `wl${whitelabel.id}-${userId}`,
          currency,
          amount,
          method,
          details: validation.value,
          notifyUrl: this.#notifyUrl(providerName, FLOW.PAY_OUT),
          customer: gateway.needsCustomer ? customer ?? {} : null,
        },
        this.config,
        { http: this.http }
      );
    } catch (error) {
      // The same rule as this site's own payouts: a request that threw is treated as not sent.
      await hubOrders.failNow(this.db, order.id, error.message);
      this.logger?.error({ err: error, provider: providerName, reference, whitelabelId: whitelabel.id }, 'Whitelabel payout request failed');
      return { ok: false, message: error.message };
    }
    if (!result.ok) {
      await hubOrders.failNow(this.db, order.id, result.message);
      return { ok: false, message: result.message };
    }
    await hubOrders.attach(this.db, order.id, result.providerReference);
    this.logger?.info({ provider: providerName, reference, copyReference, whitelabelId: whitelabel.id, currency, amount }, 'Whitelabel payout sent to the provider');
    return { ok: true, reference, providerReference: result.providerReference ?? null };
  }

  /**
   * A copy's crypto withdrawal, which its staff sent through CCPayment: paid from THIS site's
   * CCPayment account (`applyAppWithdrawToNetwork`, the order recorded first under our own orderId).
   * The `ApiWithdrawal` webhook settles it (crypto module) and the copy is told.
   */
  async #hubCcpaymentPayout({ whitelabel, copyReference, currency, amount, details, chargePct }) {
    if (money.compare(String(whitelabel.terms.fees.ccpayment?.withdraw ?? '0'), String(chargePct)) !== 0) throw hubOrders.chargeChanged();
    const address = String(details?.address ?? '').trim();
    const chain = String(details?.chain ?? '').trim();
    if (!address || !chain || address.length > 200 || chain.length > 40) {
      throw errors.INVALID_PAYOUT_DETAILS({ fields: ['address', 'chain'], paymentSystem: 'crypto' });
    }
    await this.#assertOwnerAllows('ccpayment');
    await refreshCcpaymentCoinIds(this.config, this.http);
    const coinId = ccpaymentCoinId(currency, this.config);
    if (!coinId) throw errors.CURRENCY_NOT_SUPPORTED({ provider: 'ccpayment', currency });

    const reference = this.#reference('CWD');
    const order = await hubOrders.open(this.db, {
      whitelabelId: whitelabel.id,
      provider: 'ccpayment',
      flow: 'payout',
      reference,
      copyReference,
      currency,
      amount,
      chargePct,
    });
    try {
      const data = await ccpaymentCall(this, '/ccpayment/v2/applyAppWithdrawToNetwork', {
        coinId,
        chain: ccpaymentChain(chain),
        address,
        orderId: reference,
        amount: plainAmount(money.toDecimalString(money.toMinorQuantised(amount))),
        merchantPayNetworkFee: this.config.CCPAYMENT_MERCHANT_PAYS_NETWORK_FEE === true,
      });
      await hubOrders.attach(this.db, order.id, data?.recordId);
      this.logger?.info({ reference, copyReference, whitelabelId: whitelabel.id, currency, amount }, 'Whitelabel crypto withdrawal sent through CCPayment');
      return { ok: true, reference, providerReference: data?.recordId ?? null };
    } catch (error) {
      if (error.refused) {
        await hubOrders.failNow(this.db, order.id, error.message);
        return { ok: false, message: error.message };
      }
      // No answer: the order stays pending here; CCPayment's webhook settles it and the copy is told.
      this.logger?.error({ err: error, reference, whitelabelId: whitelabel.id }, 'No answer from CCPayment for a whitelabel withdrawal — left pending');
      return { ok: true, reference, providerReference: null };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /**
   * A player's own view of one order.
   *
   * Scoped to the caller. The legacy status endpoints took a reference and
   * returned whatever they found, so any player who knew a reference could read
   * another player's payment — amount, bank account and all.
   */
  async getOrder({ userId, provider: providerName, reference }) {
    this.#gateway(providerName, { requireConfig: false });

    const order = await this.#findOrder(providerName, reference);
    if (!order || Number(order.userId) !== Number(userId)) {
      throw errors.ORDER_NOT_FOUND({ reference });
    }
    return order;
  }

  /** Every order the player has started with any provider, newest first. */
  async listOrders({ userId, flow, limit = 50, offset = 0 }) {
    const rows = [];

    // Some of these columns are BIGINT and some are VARCHAR — see USER_ID_IS_TEXT.
    const as = (model) => userIdFor(model, userId);

    if (flow !== FLOW.PAY_OUT) {
      const [upi, apay, cricpay, waypay, cc, f2] = await Promise.all([
        this.models.Upideposit.findAll({ where: { uid: as('Upideposit') }, raw: true }),
        this.models.Apaydeposits.findAll({ where: { user_id: as('Apaydeposits') }, raw: true }),
        this.models.Cricpaytransactions.findAll({ where: { uid: as('Cricpaytransactions') }, raw: true }),
        this.models.PayInTransactions.findAll({ where: { user_id: as('PayInTransactions') }, raw: true }),
        this.models.Ccdeposit.findAll({ where: { userid: as('Ccdeposit') }, raw: true }),
        this.models.F2payDeposits.findAll({ where: { user_id: userId }, raw: true }),
      ]);

      rows.push(
        ...upi.map((r) => this.#shape('upi', FLOW.PAY_IN, r.transactioniduser, r.amount, 'INR', r.status, r.created_at)),
        ...apay.map((r) => this.#shape('apay', FLOW.PAY_IN, r.custom_transaction_id, r.amount, r.currency, r.status, r.created_at)),
        ...cricpay.map((r) => this.#shape('cricpay', FLOW.PAY_IN, r.transaction_code, r.amount, 'INR', r.status, r.created_at)),
        ...waypay.map((r) => this.#shape('waypay', FLOW.PAY_IN, r.out_trade_no, r.amount, r.currency, r.status, r.created_at)),
        ...cc.map((r) => this.#shape('ccpayment', FLOW.PAY_IN, r.orderid, r.price, this.#tickerFor(r.coinid), r.status, r.created_at)),
        ...f2.map((r) => this.#shape('f2pay', FLOW.PAY_IN, r.mch_order_no, r.amount, r.currency, r.status, r.created_at))
      );
    }

    if (flow !== FLOW.PAY_IN) {
      const [apayOut, waypayOut, f2Out] = await Promise.all([
        this.models.Apaywithdrawals.findAll({ where: { user_id: as('Apaywithdrawals') }, raw: true }),
        this.models.PayOutTransactions.findAll({ where: { user_id: as('PayOutTransactions') }, raw: true }),
        this.models.F2payWithdrawals.findAll({ where: { user_id: userId }, raw: true }),
      ]);
      rows.push(
        ...apayOut.map((r) => this.#shape('apay', FLOW.PAY_OUT, r.custom_transaction_id, r.amount, r.currency, r.status, r.created_at)),
        ...waypayOut.map((r) => this.#shape('waypay', FLOW.PAY_OUT, r.out_trade_no, r.amount, r.currency, r.status, r.created_at)),
        ...f2Out.map((r) => this.#shape('f2pay', FLOW.PAY_OUT, r.mch_order_no, r.amount, r.currency, r.status, r.created_at))
      );
    }

    // Sorted in memory because these are six tables with no common key. Bounded
    // by one player's own order history, which is small — if that ever stops
    // being true the answer is a unified orders table, not a cleverer sort.
    rows.sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
    return rows.slice(offset, offset + limit);
  }

  /** Which rails a provider currently has switched on. */
  async getAvailableMethods({ provider: providerName }) {
    const gateway = this.#gateway(providerName);
    await this.#assertOwnerAllows(providerName);
    if (gateway.methodsInDb) {
      return { provider: providerName, methods: await this.#methods(providerName, gateway), payout: await this.#payoutCurrencies(gateway) };
    }
    if (!gateway.getAvailableMethods) return { provider: providerName, methods: null };
    return {
      provider: providerName,
      methods: await gateway.getAvailableMethods(this.config, { http: this.http }),
    };
  }

  /**
   * Payment Methods page (admin-structure.zip jaisa): A-Pay ne is project ke liye kaun se
   * payment systems chalu kiye hain, currency ke hisaab se (INR, PKR, NPR, BDT, phir baaki),
   * limits ke saath — aur hamari site kaunsa use karti hai (`APAY_DEPOSIT_SYSTEMS` /
   * `APAY_WITHDRAWAL_SYSTEMS`). Sirf padhna. A-Pay configure na ho to `configured: false`.
   */
  async paymentSystemsOverview({ fresh = false } = {}) {
    const gateway = getGateway('apay');
    const missing = gateway.requiredConfig.filter((key) => !this.config[key]);
    if (missing.length) return { configured: false, projectId: null, fetchedAt: null, cacheAgeSeconds: null, currencies: [] };

    const now = Date.now();
    if (fresh || !paymentSystemsCache || now - paymentSystemsCache.at > PAYMENT_SYSTEMS_TTL_MS) {
      const systems = await gateway.getPaymentSystems(this.config, { http: this.http });
      paymentSystemsCache = { at: now, systems };
    }
    const { at, systems } = paymentSystemsCache;

    const cur = (ps) => String(ps.currency || '').toUpperCase();
    const extras = [...new Set(systems.map(cur).filter((c) => c && !PAYMENT_SYSTEMS_CURRENCY_ORDER.includes(c)))];
    const currencies = [...PAYMENT_SYSTEMS_CURRENCY_ORDER, ...extras].map((currency) => ({
      currency,
      methods: systems.filter((ps) => cur(ps) === currency).map((ps) => {
        const siteDeposit = APAY_DEPOSIT_SYSTEMS[currency] === ps.name;
        const sitePayout = APAY_WITHDRAWAL_SYSTEMS[currency] === ps.name;
        return {
          name: ps.name,
          label: APAY_SYSTEM_LABELS[ps.name] || ps.name,
          deposit: {
            gatewayEnabled: Boolean(ps.deposit),
            siteOffered: Boolean(ps.deposit) && siteDeposit,
            min: Number(ps.min_deposit) || 0,
            max: Number(ps.max_deposit) || 0,
          },
          withdrawal: {
            gatewayEnabled: Boolean(ps.withdrawal),
            siteUsed: Boolean(ps.withdrawal) && sitePayout,
            min: Number(ps.min_withdrawals) || 0,
            max: Number(ps.max_withdrawals) || 0,
          },
          notes: [
            siteDeposit && !ps.deposit ? 'Site uses this for deposits but the gateway has it off' : null,
            sitePayout && !ps.withdrawal ? 'Site uses this for withdrawals but the gateway has it off' : null,
          ].filter(Boolean),
        };
      }),
    }));

    return {
      configured: true,
      projectId: String(this.config.APAY_PROJECT_ID),
      fetchedAt: new Date(at).toISOString(),
      cacheAgeSeconds: Math.round((now - at) / 1000),
      currencies,
    };
  }

  /**
   * Ask the provider what it thinks, rather than what we recorded.
   *
   * @legacy POST /checkorderstatusupi
   * @legacy POST /getOrder
   *
   * Both legacy versions were unauthenticated proxies: they took a transaction
   * id from the body, forwarded it to the provider, and returned the provider's
   * raw answer. So anyone could read the status of any payment — and EkQR's
   * reply carries the payer's name, email and mobile number.
   *
   * `getOrder` below scopes the lookup to the caller's own order before the
   * provider is contacted at all.
   */
  async refreshStatus({ userId, provider: providerName, reference }) {
    const order = await this.getOrder({ userId, provider: providerName, reference });
    const gateway = this.#gateway(providerName);

    if (!gateway.getStatus && !gateway.getDepositInfo) return order;

    const providerView = gateway.getStatus
      // The order row goes through so a gateway can send back what we recorded
      // at creation — EkQR needs the transaction DATE alongside the id, and
      // legacy took that from the request body.
      ? await gateway.getStatus(reference, this.config, { http: this.http }, order)
      : await gateway.getDepositInfo(order.providerReference ?? reference, this.config, { http: this.http });

    // Reported, never applied. A status read must not be able to move money —
    // that is the callback path's job, and it has verification this does not.
    return { ...order, providerView };
  }

  // ── Staff ─────────────────────────────────────────────────────────────

  /**
   * Patch a missing bank reference onto a WayPay payment.
   *
   * Staff-only. Legacy exposed it unauthenticated, which let anyone attach an
   * arbitrary UTR to any transaction — the number support staff then use to
   * decide a payment is genuine.
   */
  async repairUtr({ reference, utr, staffId }) {
    const gateway = this.#gateway('waypay');
    const result = await gateway.repairUtr({ reference, utr }, this.config, { http: this.http });

    this.logger?.info({ reference, utr, staffId }, 'UTR repair requested');

    if (!result.ok) throw errors.PROVIDER_REJECTED({ reason: result.message });
    return { reference, utr, ok: true };
  }

  // ══════════════════════════════════════════════════════════════════════

  #gateway(name, { requireConfig = true } = {}) {
    const gateway = getGateway(name);
    if (!gateway) throw errors.UNKNOWN_PROVIDER({ provider: name });
    // A whitelabel copy has no gateway keys: every order runs on the parent's account (modules/wl-hub).
    if (this.config.WHITELABEL_MODE) return hubGateway(gateway, name, this.deps);

    if (requireConfig) {
      const missing = (gateway.requiredConfig || []).filter((key) => !this.config[key]);
      if (missing.length) {
        this.logger?.error({ provider: name, missing }, 'Payment gateway is not configured');
        throw errors.PROVIDER_DISABLED({ provider: name });
      }
    }
    return gateway;
  }

  /**
   * The owner panel's gateway switch (`flags.gateway_<name>`, missing = on) AND the Super Admin's
   * (Settings → Payment Methods, `payment_gateways_off`). New orders only: open ones and callbacks still settle.
   */
  async #assertOwnerAllows(name) {
    const off = await this.settings.read('payment_gateways_off', []);
    if (!(await entitlements.isFlagEntitled(`gateway_${name}`)) || (Array.isArray(off) && off.includes(name))) {
      throw errors.PROVIDER_DISABLED({ provider: name });
    }
  }

  /**
   * A gateway's deposit methods that are on — `[{ method, currency }]`: rows of `payment_methods`
   * the owner has on, in currencies the owner has on (flag `f2pay_<code>`, missing = on). The owner
   * alone picks currencies and methods; the Super Admin only switches the whole gateway
   * (user, 2026-10-24). One query, one read of the owner's plan.
   */
  async #methods(providerName, gateway) {
    const [rows, plan] = await Promise.all([
      this.models.PaymentMethod.findAll({
        where: { gateway: providerName, owner_enabled: true },
        attributes: ['currency', 'code'],
        order: [['id', 'ASC']],
        raw: true,
      }),
      entitlements.getEntitlements(),
    ]);
    return rows
      .filter((r) => gateway.supports(r.currency, FLOW.PAY_IN) && plan.flags[gateway.currencySwitch(r.currency)] !== false)
      .map((r) => ({ method: r.code, currency: r.currency }));
  }

  /** The owner's currency switch for this gateway (`f2pay_inr`, missing = on); a gateway without one is always on. */
  async #currencyOn(gateway, currency) {
    if (!gateway.currencySwitch) return true;
    const plan = await entitlements.getEntitlements();
    return plan.flags[gateway.currencySwitch(currency)] !== false;
  }

  /**
   * The currencies this gateway pays out in right now (the player site's Automatic withdraw):
   * none while the deployment's AUTO_WITHDRAWALS_ENABLED or the owner's withdrawal_mode is off.
   */
  async #payoutCurrencies(gateway) {
    if (!this.config.AUTO_WITHDRAWALS_ENABLED) return [];
    if (!(await sitePolicy.allows(this.models, 'withdrawal_mode', 'automatic')).allowed) return [];
    const out = [];
    for (const currency of ['INR']) {
      if (gateway.supports(currency, FLOW.PAY_OUT) && (await this.#currencyOn(gateway, currency))) out.push(currency);
    }
    return out;
  }

  /**
   * Where the provider should report the outcome.
   *
   * Built from OUR configured base url. Legacy read `notify_url` from the
   * request body, so the caller decided where the provider sent the result —
   * pointing it at a host they controlled meant the callback never reached us
   * and the deposit stayed pending forever.
   */
  #notifyUrl(providerName, flow) {
    const base = String(this.config.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    // modules/psp's public routes; the old `/api/v1/payments/callback/<provider>` answered 404.
    return `${base}/api/v1/user/psp/${providerName}/${flow === FLOW.PAY_OUT ? 'payout-callback' : 'callback'}`;
  }

  /** A reference the provider will echo back. Unguessable on purpose. */
  /**
   * The owner's `withdrawal_requirements` (`../withdraw-requirements`), built on first use.
   * KYC: a payout to an unverified identity is what AML rules exist to prevent; legacy checked
   * nothing here. Also gated by `WITHDRAW_REQUIRE_KYC`, which defaults on.
   */
  #requirements() {
    if (!this.withdrawRequirements) {
      this.withdrawRequirements = this.deps.withdrawRequirements ?? createWithdrawRequirements({ ...this.deps, playerBonuses: this.#playerBonuses() });
    }
    return this.withdrawRequirements;
  }

  /** The bonus balance (`../player-bonuses`), built on first use. */
  #playerBonuses() {
    if (!this.playerBonusService) {
      this.playerBonusService = this.deps.playerBonuses ?? new PlayerBonusService({ ...this.deps, walletService: this.wallet });
    }
    return this.playerBonusService;
  }

  /** The player's own name / email / phone, for a cashier page that asks for them. */
  async #customer(userId) {
    return this.models.Users.findByPk(userId, { attributes: ['name', 'email', 'phone'], raw: true });
  }

  #reference(prefix) {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }

  async #assertWithinLimits(amount, currency, flow) {
    // The deployment's min / max for this rail.
    const min = flow === FLOW.PAY_OUT ? this.config.WITHDRAW_MINIMUM : this.config.DEPOSIT_MINIMUM;
    const max = flow === FLOW.PAY_OUT ? this.config.WITHDRAW_MAXIMUM : this.config.DEPOSIT_MAXIMUM;

    if (min && money.lt(amount, String(min))) throw errors.BELOW_MINIMUM({ minimum: String(min), currency });
    if (max && money.gt(amount, String(max))) throw errors.ABOVE_MAXIMUM({ maximum: String(max), currency });
  }


  /**
   * Return a held balance.
   *
   * Never throws. It is called from failure paths, and a refund that throws
   * would replace "the payout failed" with "the payout failed and the money is
   * gone". A failure here is logged at `fatal` because it needs a human: the
   * player has been debited for a payout that was never sent.
   */
  async #refund({ userId, currency, amount, reference, providerName, reason }) {
    try {
      await this.wallet.credit(
        {
          userId,
          currency,
          amount,
          reason: REASON.WITHDRAWAL_REVERSAL,
          // Derived from the payout, so two failure paths firing at once refund
          // once between them.
          idempotencyKey: `payout-refund:${providerName}:${reference}`,
          refType: `PAYOUT_${providerName.toUpperCase()}_REFUND`,
          refId: reference,
          description: `Refund for failed withdrawal ${reference}`,
        },
        { sourceService: 'user-service' }
      );

      await this.#markWithdrawalFailed(providerName, reference, reason, { refunded: true });
      if (this.config.WHITELABEL_MODE) {
        await this.db.transaction((transaction) => companyWallet.onWithdrawalFailed(this.db, { provider: providerName, reference }, transaction));
      }
      this.logger?.info({ provider: providerName, reference, userId, amount }, 'Held balance refunded');
    } catch (error) {
      this.logger?.fatal(
        { err: error, provider: providerName, reference, userId, currency, amount },
        'REFUND FAILED — the player has been debited for a withdrawal that was never sent'
      );
      await this.#markWithdrawalFailed(providerName, reference, reason, { refunded: false });
    }
  }

  // ── Per-provider persistence ──────────────────────────────────────────
  //
  // Four providers, four tables, four shapes. Confined to these methods so the
  // logic above reads as one flow rather than four.

  async #recordPendingDeposit(providerName, { reference, userId, currency, amount, method, chain }) {
    const { Upideposit, Apaydeposits, Cricpaytransactions, PayInTransactions, Ccdeposit } = this.models;

    if (providerName === 'ccpayment') {
      /**
       * `orderid` is OUR generated reference.
       *
       * Legacy took it from the request body. It is the key
       * `/api/ccpaymentnotify` resolves an incoming payment against, so a
       * caller who submitted an `orderId` another player was waiting on
       * redirected that player's deposit — on a route that also took `userid`
       * from the body and had no authentication.
       */
      await Ccdeposit.create({
        userid: userIdFor('Ccdeposit', userId),
        // `coinid` is an INTEGER column because CCPayment identifies coins
        // numerically. The map lives in config — see `ccpaymentCoinId`.
        coinid: ccpaymentCoinId(currency, this.config),
        price: amount,
        orderid: reference,
        chain: chain ?? null,
        status: 'Processing',
        created_at: new Date(),
        updated_at: new Date(),
      });
      return;
    }

    if (providerName === 'upi') {
      /**
       * `transactiondate` is a VARCHAR, not a timestamp.
       *
       * It holds the `dd-mm-yyyy` string EkQR wants echoed back on a status
       * lookup, which is why legacy formatted one at order time. Passing a
       * `Date` here fails Sequelize's own string validation before the
       * statement is ever sent — so the value stored has to be the string, and
       * it has to be the same string the status call will send.
       */
      await Upideposit.create({
        uid: userIdFor('Upideposit', userId),
        transactioniduser: reference,
        transactiondate: formatEkqrDate(new Date(), this.config?.UPI_TIMEZONE),
        amount,
        status: 'pending',
      });
      return;
    }
    if (providerName === 'apay') {
      await Apaydeposits.create({
        order_id: reference, user_id: userId, amount, currency,
        payment_system: method ?? '', custom_transaction_id: reference, status: 'Pending',
      });
      return;
    }
    if (providerName === 'cricpay') {
      await Cricpaytransactions.create({
        uid: userId, transaction_code: reference, amount,
        payment_method: method ?? '', status: 'Pending',
      });
      return;
    }
    if (providerName === 'f2pay') {
      await this.models.F2payDeposits.create({ user_id: userId, mch_order_no: reference, amount, currency, status: 'Pending' });
      return;
    }
    await PayInTransactions.create({
      user_id: userId, transaction_id: reference, out_trade_no: reference,
      currency, amount, status: 0, pay_type: method ?? '',
    });
  }

  async #recordPendingWithdrawal(providerName, { reference, userId, currency, amount, paymentSystem, details }, { transaction } = {}) {
    if (providerName === 'apay') {
      await this.models.Apaywithdrawals.create({
        // VARCHAR on this table, BIGINT on apaydeposits. Same integration.
        order_id: reference, user_id: userIdFor('Apaywithdrawals', userId), amount, currency,
        payment_system: paymentSystem, custom_transaction_id: reference,
        status: 'Pending', payout_details: details,
      }, { transaction });
      return;
    }
    if (providerName === 'f2pay') {
      await this.models.F2payWithdrawals.create({
        user_id: userId, mch_order_no: reference, amount, currency, status: 'Pending',
        account_number: details.account_number, ifsc: details.bank_code, account_holder_name: details.account_name,
      }, { transaction });
      return;
    }
    await this.models.PayOutTransactions.create({
      user_id: userId, transaction_id: reference, out_trade_no: reference,
      currency, amount, status: 0, pay_type: paymentSystem,
      account: details.account_number ?? null,
      account_name: details.account_name ?? null,
      ifsc_code: details.bank_code ?? null,
    }, { transaction });
  }

  /**
   * Record what the provider calls this order, alongside what we call it.
   *
   * Deliberately NOT written to `apaydeposits.order_id` / `apaywithdrawals.
   * order_id`, which is what legacy did. Those columns are UNIQUE, and
   * overwriting our own guaranteed-unique reference with a value the provider
   * chose means a provider that ever reuses or collides an order id causes a
   * constraint violation — thrown after the gateway has already been called and,
   * for a payout, after the player has already been debited. There is no good
   * way to recover from that point.
   *
   * Our reference stays in the unique column; theirs goes in the details blob,
   * which is where support looks anyway.
   */
  async #attachProviderReference(providerName, reference, providerReference) {
    if (!providerReference) return;
    try {
      if (providerName === 'upi') {
        await this.models.Upideposit.update(
          { transactionidgateway: providerReference }, { where: { transactioniduser: reference } }
        );
      } else if (providerName === 'apay') {
        await this.models.Apaydeposits.update(
          { payment_details: { providerReference } }, { where: { custom_transaction_id: reference } }
        );
      } else if (providerName === 'ccpayment') {
        await this.models.Ccdeposit.update(
          { deposit_address: providerReference, updated_at: new Date() },
          { where: { orderid: reference } }
        );
      } else if (providerName === 'waypay') {
        await this.models.PayInTransactions.update(
          { transaction_id: providerReference }, { where: { out_trade_no: reference } }
        );
      } else if (providerName === 'f2pay') {
        await this.models.F2payDeposits.update({ plat_no: providerReference }, { where: { mch_order_no: reference } });
      }
    } catch (error) {
      // The order exists and the gateway has it. Failing to record their id is
      // a support inconvenience, not a reason to error a successful payment.
      this.logger?.warn(
        { err: error, provider: providerName, reference },
        'Could not record the provider reference'
      );
    }
  }

  async #attachWithdrawalReference(providerName, reference, providerReference) {
    if (!providerReference) return;
    try {
      if (providerName === 'apay') {
        await this.models.Apaywithdrawals.update(
          { payment_details: { providerReference } }, { where: { custom_transaction_id: reference } }
        );
      } else if (providerName === 'f2pay') {
        await this.models.F2payWithdrawals.update({ plat_no: providerReference }, { where: { mch_order_no: reference } });
      } else {
        await this.models.PayOutTransactions.update(
          { transaction_id: providerReference }, { where: { out_trade_no: reference } }
        );
      }
    } catch (error) {
      this.logger?.warn(
        { err: error, provider: providerName, reference },
        'Could not record the provider reference'
      );
    }
  }

  async #markDepositFailed(providerName, reference, reason) {
    if (providerName === 'ccpayment') {
      await this.models.Ccdeposit.update(
        { status: 'Failed', updated_at: new Date() },
        { where: { orderid: reference } }
      );
      return;
    }

    try {
      if (providerName === 'upi') {
        await this.models.Upideposit.update({ status: 'failed' }, { where: { transactioniduser: reference } });
      } else if (providerName === 'apay') {
        await this.models.Apaydeposits.update(
          { status: 'Failed', error_reason: String(reason ?? '').slice(0, 500) },
          { where: { custom_transaction_id: reference } }
        );
      } else if (providerName === 'cricpay') {
        await this.models.Cricpaytransactions.update(
          { status: 'Failed' }, { where: { transaction_code: reference } }
        );
      } else if (providerName === 'f2pay') {
        await this.models.F2payDeposits.update(
          { status: 'Failed', error_reason: String(reason ?? '').slice(0, 500) },
          { where: { mch_order_no: reference } }
        );
      } else {
        await this.models.PayInTransactions.update({ status: 2 }, { where: { out_trade_no: reference } });
      }
    } catch (error) {
      this.logger?.error({ err: error, provider: providerName, reference }, 'Could not mark the deposit failed');
    }
  }

  async #markWithdrawalFailed(providerName, reference, reason, { refunded }) {
    try {
      if (providerName === 'apay') {
        await this.models.Apaywithdrawals.update(
          { status: 'Failed', error_reason: String(reason ?? '').slice(0, 500), refunded },
          { where: { custom_transaction_id: reference } }
        );
      } else if (providerName === 'f2pay') {
        await this.models.F2payWithdrawals.update(
          { status: 'Failed', error_reason: String(reason ?? '').slice(0, 500), refunded },
          { where: { mch_order_no: reference } }
        );
      } else {
        await this.models.PayOutTransactions.update({ status: 2 }, { where: { out_trade_no: reference } });
      }
    } catch (error) {
      this.logger?.error({ err: error, provider: providerName, reference }, 'Could not mark the withdrawal failed');
    }
  }

  async #findOrder(providerName, reference) {
    const { Upideposit, Apaydeposits, Cricpaytransactions, PayInTransactions, Apaywithdrawals, PayOutTransactions } =
      this.models;

    if (providerName === 'upi') {
      const r = await Upideposit.findOne({ where: { transactioniduser: reference }, raw: true });
      return (
        r && {
          ...this.#shape('upi', FLOW.PAY_IN, reference, r.amount, 'INR', r.status, r.created_at, r.uid, r.transactionidgateway),
          // The exact `dd-mm-yyyy` string sent when the order was created.
          // EkQR's status call must echo it back, and re-deriving it from a
          // timestamp is how legacy got it wrong.
          transactionDate: r.transactiondate,
        }
      );
    }
    if (providerName === 'ccpayment') {
      const r = await this.models.Ccdeposit.findOne({ where: { orderid: reference }, raw: true });
      return r && this.#shape('ccpayment', FLOW.PAY_IN, reference, r.price, this.#tickerFor(r.coinid), r.status, r.created_at, r.userid, r.deposit_address);
    }
    if (providerName === 'cricpay') {
      const r = await Cricpaytransactions.findOne({ where: { transaction_code: reference }, raw: true });
      return r && this.#shape('cricpay', FLOW.PAY_IN, reference, r.amount, 'INR', r.status, r.created_at, r.uid);
    }
    if (providerName === 'f2pay') {
      const r = await this.models.F2payDeposits.findOne({ where: { mch_order_no: reference }, raw: true });
      if (r) return this.#shape('f2pay', FLOW.PAY_IN, reference, r.amount, r.currency, r.status, r.created_at, r.user_id, r.plat_no);
      const out = await this.models.F2payWithdrawals.findOne({ where: { mch_order_no: reference }, raw: true });
      return out && this.#shape('f2pay', FLOW.PAY_OUT, reference, out.amount, out.currency, out.status, out.created_at, out.user_id, out.plat_no);
    }
    if (providerName === 'apay') {
      const dep = await Apaydeposits.findOne({ where: { custom_transaction_id: reference }, raw: true });
      if (dep) {
        return this.#shape('apay', FLOW.PAY_IN, reference, dep.amount, dep.currency, dep.status, dep.created_at, dep.user_id, dep.order_id);
      }
      const out = await Apaywithdrawals.findOne({ where: { custom_transaction_id: reference }, raw: true });
      return out && this.#shape('apay', FLOW.PAY_OUT, reference, out.amount, out.currency, out.status, out.created_at, out.user_id, out.order_id);
    }

    const payin = await PayInTransactions.findOne({ where: { out_trade_no: reference }, raw: true });
    if (payin) {
      return this.#shape('waypay', FLOW.PAY_IN, reference, payin.amount, payin.currency, payin.status, payin.created_at, payin.user_id, payin.transaction_id);
    }
    // Legacy's `/payin/status/:out_trade_no` read `req.params.type`, which that
    // route never sets — so it always queried the PAYOUT table and a pay-in
    // status lookup returned 404 or someone else's payout. Both are searched
    // here, pay-in first.
    const payout = await PayOutTransactions.findOne({ where: { out_trade_no: reference }, raw: true });
    return payout && this.#shape('waypay', FLOW.PAY_OUT, reference, payout.amount, payout.currency, payout.status, payout.created_at, payout.user_id, payout.transaction_id);
  }

  /**
   * A CCPayment numeric coin id read back as a ticker.
   *
   * `ccdeposit.coinid` is the provider's number, so nothing in that table says
   * which coin a row is for in terms anyone reads. The same configured map that
   * chose the number turns it back.
   */
  #tickerFor(coinId) {
    return ccpaymentTicker(coinId, this.config) ?? String(coinId ?? '');
  }

  /** One shape for six tables. */
  #shape(provider, flow, reference, amount, currency, status, createdAt, userId, providerReference) {
    return {
      provider,
      flow,
      reference,
      amount: money.toDecimalString(money.toMinor(amount ?? '0')),
      currency: currency ?? 'INR',
      status: this.#normaliseStatus(status),
      rawStatus: status,
      providerReference: providerReference ?? null,
      userId,
      createdAt,
    };
  }

  /**
   * One vocabulary for four providers' status words.
   *
   * The raw value is kept alongside so support can still match what the
   * provider's own dashboard shows.
   */
  #normaliseStatus(status) {
    const s = String(status ?? '').toLowerCase();
    if (s === '1' || s === 'success' || s === 'successful' || s === 'completed' || s === 'paid') return 'success';
    if (s === '2' || s === 'failed' || s === 'rejected' || s === 'failure') return 'failed';
    // CCPayment writes 'Processing' while it waits for confirmations.
    if (s === '0' || s === 'pending' || s === '' || s === 'processing') return 'pending';
    return s;
  }
}

module.exports = { PaymentOrdersService };
