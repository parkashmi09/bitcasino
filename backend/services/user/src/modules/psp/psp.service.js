'use strict';

const crypto = require('crypto');

const { money } = require('@ibitplay/common');

const errors = require('./psp.errors');
const { PSP_STATUS, SETTLED_STATUSES } = require('./psp.constants');
const { getProvider } = require('./providers');
const { createHttpClient } = require('./providers/http');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { FirstDepositBonusService } = require('../bonus/firstDepositBonus.service');
const { notifyPlayer } = require('../notifications/notifyPlayer');
const hubOrders = require('../wl-hub/hubOrders');
const companyWallet = require('../wl-hub/companyWallet');
const { deliver } = require('../wl-hub/delivery');
const { CCPAYMENT_STATUS } = require('../crypto/crypto.constants');
const { ccpaymentCoinId } = require('../payment-orders/gateways');

/**
 * Payment-provider callbacks — the one place on the platform where an
 * unauthenticated stranger's HTTP request can increase a balance.
 *
 * Four rules, applied identically to every provider. The legacy code applied
 * some of them to some providers and none of them to UPI.
 *
 *   1. VERIFY FIRST. The adapter proves the callback came from the provider
 *      before anything else happens. A failure is logged and returns a vague
 *      rejection — an attacker probing the endpoint learns nothing.
 *
 *   2. THE AMOUNT COMES FROM OUR RECORD, NOT THE CALLBACK. The stored deposit
 *      is what we credit. The callback's figure is only compared against it,
 *      and a mismatch is refused. Legacy credited `parseFloat(req.body.amount)`
 *      directly — so even a provider bug, let alone a forgery, could mint money.
 *
 *   3. IDEMPOTENT. Providers retry callbacks, often for hours, and often after
 *      already succeeding. The key is derived from the transaction, so a repeat
 *      returns the original movement instead of crediting twice.
 *
 *   4. ONE TERMINAL STATE. A transaction that has already settled is not
 *      re-settled, whatever the callback says.
 *
 *   5. ONE PAYLOAD SETTLES ONE TRANSACTION. Rules 3 and 4 are both keyed on the
 *      transaction, which leaves a gap: a correctly-signed payload replayed
 *      against a DIFFERENT transaction passes both. CricPay's scheme makes that
 *      reachable — see `providers/index.js`. Every accepted payload's digest is
 *      recorded under a unique index, so the second use of one is refused.
 */
class PspService {
  constructor(deps) {
    const { models, db, config, logger, http } = deps;
    this.deps = deps;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = new WalletService(deps);
    this.firstDepositBonus = deps.firstDepositBonus ?? new FirstDepositBonusService(deps);

    // Outbound calls to providers. Injectable so a test can confirm a payment
    // without a network, and so the timeout is one decision in one place rather
    // than a default buried in each adapter.
    this.http = http ?? createHttpClient({ logger, timeoutMs: Number(config?.PSP_TIMEOUT_MS ?? 10_000) });
  }

  /**
   * Handle an inbound callback.
   *
   * Returns what the provider should be told. Most providers retry until they
   * receive a 2xx, so a genuine-but-duplicate callback returns success rather
   * than an error — otherwise the provider retries forever.
   */
  async handleCallback({ provider: providerName, body, ip }) {
    const provider = getProvider(providerName);
    if (!provider) throw errors.UNKNOWN_PROVIDER({ provider: providerName });

    this.#assertConfigured(provider);

    // The fingerprint of what the provider authenticated. Computed before
    // verification so a rejection can be logged against it too.
    const digest = crypto.createHash('sha256').update(provider.signedPayload(body)).digest('hex');
    const audit = { provider: providerName, digest, ip, body };

    // ── 1. Is this really from the provider? ──────────────────────────
    if (!provider.verify(body, this.config)) {
      this.logger?.error(
        { provider: providerName, ip, reference: body?.out_trade_no ?? body?.client_txn_id ?? null },
        'REJECTED payment callback: signature verification failed'
      );
      await this.#record(audit, { accepted: false, rejection: 'INVALID_SIGNATURE' });
      throw errors.INVALID_SIGNATURE();
    }

    const parsed = provider.parse(body);
    if (!parsed.reference) {
      await this.#record(audit, { accepted: false, rejection: 'NO_REFERENCE' });
      throw errors.TRANSACTION_NOT_FOUND({ provider: providerName });
    }
    audit.reference = parsed.reference;

    // ── 2. Find OUR record of it ──────────────────────────────────────
    const record = await this.#findTransaction(providerName, parsed.reference);
    if (!record) {
      this.logger?.warn(
        { provider: providerName, reference: parsed.reference },
        'Verified callback for a transaction we have no record of'
      );
      await this.#record(audit, { accepted: false, rejection: 'TRANSACTION_NOT_FOUND' });
      throw errors.TRANSACTION_NOT_FOUND({ reference: parsed.reference });
    }
    audit.userId = record.userId;
    audit.currency = record.currency;

    if (record.settled) {
      // Already done. Tell the provider it succeeded so it stops retrying.
      this.logger?.info({ provider: providerName, reference: parsed.reference }, 'Duplicate callback ignored');
      return { status: 'ok', duplicate: true, reference: parsed.reference };
    }

    // An in-between state (F2Pay reports more than paid / failed): nothing to do yet. Kept in the
    // audit log so the state the provider sent can be read later.
    if (parsed.status === PSP_STATUS.PENDING) {
      await this.#record(audit, { accepted: false, rejection: 'NOT_FINAL' });
      return { status: 'ok', settled: false, reference: parsed.reference };
    }

    // ── 3. A failure is recorded, not credited ────────────────────────
    if (parsed.status !== PSP_STATUS.SUCCESS && record.wl) {
      await hubOrders.settle(this.db, record.wl.id, 'failed');
      await this.#record(audit, { accepted: false, rejection: 'REPORTED_FAILED' });
      await this.#deliver(record);
      return { status: 'ok', settled: false, reference: parsed.reference };
    }
    if (parsed.status !== PSP_STATUS.SUCCESS) {
      await this.#markStatus(providerName, record, PSP_STATUS.FAILED);
      this.logger?.info({ provider: providerName, reference: parsed.reference }, 'Payment reported as failed');
      // Logged, but NOT as an accepted digest: a failure notice must not burn
      // the fingerprint of a payload the provider may resend as a success.
      await this.#record(audit, { accepted: false, rejection: 'REPORTED_FAILED' });
      void notifyPlayer(record.userId, {
        kind: 'deposit_failed',
        key: `psp-deposit:failed:${providerName}:${parsed.reference}`,
        title: 'Deposit failed',
        body: 'Your {amount} deposit did not go through. Nothing was credited.',
        link: '#transactions',
        meta: { amount: record.amount, currency: record.currency, reference: String(parsed.reference) },
      });
      return { status: 'ok', settled: false, reference: parsed.reference };
    }

    // ── 3b. If the callback cannot name its own transaction, ask ──────
    //
    // For CricPay the signed blob says "₹100 succeeded" but not WHICH ₹100. So
    // the notification is discarded and the outcome is fetched from the
    // provider over a merchant-authenticated channel that does name it.
    //
    // A confirmation we could not obtain is NOT a settlement. Returning without
    // crediting leaves the transaction pending and lets the provider retry,
    // which is the only safe direction to fail in.
    let outcome = parsed;
    if (!provider.selfIdentifying) {
      const confirmed = await this.#confirm(provider, parsed.reference);

      if (!confirmed) {
        await this.#record(audit, { accepted: false, rejection: 'CONFIRMATION_UNAVAILABLE' });
        throw errors.CONFIRMATION_FAILED({ reference: parsed.reference });
      }

      if (confirmed.status !== PSP_STATUS.SUCCESS) {
        this.logger?.warn(
          { provider: providerName, reference: parsed.reference, claimed: parsed.status },
          'Callback claimed success but the provider does not confirm it — not crediting'
        );
        await this.#record(audit, { accepted: false, rejection: 'NOT_CONFIRMED' });
        return { status: 'ok', settled: false, reference: parsed.reference };
      }

      // The provider's figure supersedes the callback's for the amount check.
      outcome = { ...parsed, amount: confirmed.amount ?? parsed.amount };
    }

    // ── 4. The amount must match what we recorded ─────────────────────
    const expected = money.toDecimalString(money.toMinor(record.amount ?? '0'));
    const reported = money.toDecimalString(money.toMinor(outcome.amount ?? '0'));

    if (money.compare(expected, reported) !== 0) {
      this.logger?.error(
        { provider: providerName, reference: parsed.reference, expected, reported },
        'REJECTED payment callback: amount does not match the recorded transaction'
      );
      await this.#record(audit, { accepted: false, rejection: 'AMOUNT_MISMATCH', amount: reported });
      throw errors.AMOUNT_MISMATCH({ expected, reported });
    }

    // ── 5a. A whitelabel's order: nobody here is credited — its copy is told (modules/wl-hub).
    if (record.wl) {
      await this.db.transaction(async (transaction) => {
        await this.#claimPayload(audit, { amount: expected, transaction, exclusive: provider.selfIdentifying });
        await hubOrders.settle(this.db, record.wl.id, 'success', { utr: parsed.utr, transaction });
      });
      this.logger?.info({ provider: providerName, reference: parsed.reference, whitelabelId: record.wl.whitelabelId, amount: expected }, 'Whitelabel deposit settled');
      await this.#deliver(record);
      return { status: 'ok', settled: true, reference: parsed.reference };
    }

    // ── 5. Credit, once — and burn the payload ────────────────────────
    const settled = await this.db.transaction(async (transaction) => {
      // Claim the digest INSIDE the money transaction. If this payload has
      // already settled something the unique index rejects it here, the
      // transaction rolls back, and nothing was credited. Two concurrent
      // replays both reach this line; exactly one gets past it.
      //
      // Only for providers whose signature names the transaction. CricPay's
      // blob is deterministic — two honest ₹100 deposits produce identical
      // bytes — so claiming its digest would reject the second real payment.
      // Its protection is the confirmation above, not this.
      await this.#claimPayload(audit, {
        amount: expected,
        transaction,
        exclusive: provider.selfIdentifying,
      });

      const movement = await this.wallet.credit(
        {
          userId: record.userId,
          currency: record.currency,
          // OUR figure, not the callback's.
          amount: expected,
          reason: REASON.DEPOSIT,
          idempotencyKey: `psp:${providerName}:${parsed.reference}`,
          refType: `PSP_${providerName.toUpperCase()}`,
          refId: String(parsed.reference),
          description: `${providerName} deposit ${parsed.reference}`,
        },
        { sourceService: 'user-service', transaction }
      );

      await this.#markStatus(providerName, record, PSP_STATUS.SUCCESS, { transaction, utr: parsed.utr });

      this.logger?.info(
        {
          provider: providerName,
          reference: parsed.reference,
          userId: record.userId,
          amount: expected,
          ledgerId: movement.ledgerId,
          replayed: movement.replayed,
        },
        'Payment callback settled'
      );

      return {
        status: 'ok',
        settled: true,
        reference: parsed.reference,
        ledgerId: movement.ledgerId,
        newBalance: movement.newBalance,
      };
    });

    // ── 6. First-deposit bonus, after COMMIT — never fails the callback ──
    await this.firstDepositBonus.onDepositCredited({
      userId: record.userId,
      currency: record.currency,
      amount: expected,
      ledgerId: settled.ledgerId,
      source: `PSP_${providerName.toUpperCase()}`,
      refId: String(parsed.reference),
    });
    void notifyPlayer(record.userId, {
      kind: 'deposit_credited',
      key: `psp-deposit:credited:${providerName}:${parsed.reference}`,
      title: 'Deposit received',
      body: '{amount} has been credited to your wallet.',
      link: '#transactions',
      meta: { amount: expected, currency: record.currency, reference: String(parsed.reference) },
    });
    return settled;
  }

  /**
   * A provider reporting on a PAYOUT.
   *
   * The mirror image of the deposit callback, and it fails in the opposite
   * direction. A deposit callback wrongly accepted credits money that never
   * arrived. A payout callback wrongly IGNORED leaves the player debited for a
   * transfer that failed — their money is simply gone from their point of view,
   * with no error anywhere. So the risk here is inaction, and the code is
   * arranged so that the failure branch is the one that does something.
   *
   * Three rules:
   *
   *   1. VERIFY, as always.
   *   2. SUCCESS IS A NO-OP. The balance was debited when the payout was
   *      requested, so a successful payout has nothing left to do but record it.
   *   3. FAILURE REFUNDS, EXACTLY ONCE. Keyed off the payout reference, so the
   *      provider's inevitable retries do not refund twice.
   */
  async handlePayoutCallback({ provider: providerName, body, ip }) {
    const provider = getProvider(providerName);
    if (!provider) throw errors.UNKNOWN_PROVIDER({ provider: providerName });

    this.#assertConfigured(provider);

    const digest = crypto.createHash('sha256').update(provider.signedPayload(body)).digest('hex');
    const audit = { provider: providerName, digest, ip, body };

    if (!provider.verify(body, this.config)) {
      this.logger?.error({ provider: providerName, ip }, 'REJECTED payout callback: signature verification failed');
      await this.#record(audit, { accepted: false, rejection: 'INVALID_SIGNATURE' });
      throw errors.INVALID_SIGNATURE();
    }

    const parsed = provider.parse(body);
    if (!parsed.reference) throw errors.TRANSACTION_NOT_FOUND({ provider: providerName });
    audit.reference = parsed.reference;

    const payout = await this.#findPayout(providerName, parsed.reference);
    if (!payout) {
      this.logger?.warn(
        { provider: providerName, reference: parsed.reference },
        'Verified payout callback for a payout we have no record of'
      );
      await this.#record(audit, { accepted: false, rejection: 'TRANSACTION_NOT_FOUND' });
      throw errors.TRANSACTION_NOT_FOUND({ reference: parsed.reference });
    }
    audit.userId = payout.userId;
    audit.currency = payout.currency;

    // ── Still in flight (F2Pay's Processing): nothing to do until a final state arrives. ──
    if (parsed.status === PSP_STATUS.PENDING) {
      await this.#record(audit, { accepted: false, rejection: 'NOT_FINAL' });
      return { status: 'ok', settled: false, pending: true, reference: parsed.reference };
    }

    // ── A whitelabel's payout: settle it here, its copy finishes it (refund on failure). ──
    if (payout.wl) {
      const status = parsed.status === PSP_STATUS.SUCCESS ? 'success' : 'failed';
      await hubOrders.settle(this.db, payout.wl.id, status);
      await this.#record(audit, { accepted: true, amount: payout.amount });
      this.logger?.info({ provider: providerName, reference: parsed.reference, whitelabelId: payout.wl.whitelabelId, status }, 'Whitelabel payout settled');
      await this.#deliver(payout);
      return { status: 'ok', settled: status === 'success', reference: parsed.reference };
    }

    // ── Success: the money already left. Record and stop. ─────────────
    if (parsed.status === PSP_STATUS.SUCCESS) {
      await this.#markPayoutStatus(payout, PSP_STATUS.SUCCESS);
      await this.#record(audit, { accepted: true, amount: payout.amount });
      this.logger?.info(
        { provider: providerName, reference: parsed.reference, userId: payout.userId },
        'Payout confirmed by the provider'
      );
      void notifyPlayer(payout.userId, {
        kind: 'withdrawal_paid',
        key: `psp-payout:paid:${providerName}:${payout.reference}`,
        title: 'Withdrawal paid',
        body: 'Your {amount} withdrawal has been sent.',
        link: '#transactions',
        meta: { amount: payout.amount, currency: payout.currency, reference: String(payout.reference) },
      });
      return { status: 'ok', settled: true, reference: parsed.reference };
    }

    // ── Failure: give the money back ──────────────────────────────────
    if (payout.refunded) {
      this.logger?.info({ provider: providerName, reference: parsed.reference }, 'Payout already refunded');
      return { status: 'ok', refunded: true, duplicate: true, reference: parsed.reference };
    }

    // OUR recorded amount, never the callback's — the same rule as deposits,
    // and here a wrong figure would OVERPAY the player.
    const amount = money.toDecimalString(money.toMinor(payout.amount ?? '0'));

    const movement = await this.db.transaction(async (transaction) => {
      const credited = await this.wallet.credit(
        {
          userId: payout.userId,
          currency: payout.currency,
          amount,
          reason: REASON.WITHDRAWAL_REVERSAL,
          // The same key the synchronous failure path in payment-orders uses,
          // so a payout that failed at the gateway AND is later reported failed
          // by callback refunds once between the two.
          idempotencyKey: `payout-refund:${providerName}:${payout.reference}`,
          refType: `PAYOUT_${providerName.toUpperCase()}_REFUND`,
          refId: String(payout.reference),
          description: `Refund for failed withdrawal ${payout.reference}`,
        },
        { sourceService: 'user-service', transaction }
      );

      await this.#markPayoutStatus(payout, PSP_STATUS.FAILED, { transaction, refunded: true });
      return credited;
    });

    await this.#record(audit, { accepted: true, amount });

    this.logger?.info(
      {
        provider: providerName,
        reference: parsed.reference,
        userId: payout.userId,
        amount,
        replayed: movement.replayed,
      },
      'Payout failed — balance refunded'
    );
    void notifyPlayer(payout.userId, {
      kind: 'withdrawal_rejected',
      key: `psp-payout:failed:${providerName}:${payout.reference}`,
      title: 'Withdrawal failed',
      body: 'Your {amount} withdrawal could not be paid out. The funds are back in your wallet.',
      link: '#transactions',
      meta: { amount, currency: payout.currency, reference: String(payout.reference) },
    });

    return {
      status: 'ok',
      settled: false,
      refunded: true,
      reference: parsed.reference,
      newBalance: movement.newBalance,
    };
  }

  /** Read-only status lookup, for a player polling their own deposit. */
  async getStatus({ provider: providerName, reference, userId }) {
    if (!getProvider(providerName)) throw errors.UNKNOWN_PROVIDER({ provider: providerName });

    const record = await this.#findTransaction(providerName, reference);
    if (!record) throw errors.TRANSACTION_NOT_FOUND({ reference });

    // A player may only see their own transactions.
    if (userId != null && Number(record.userId) !== Number(userId)) {
      throw errors.TRANSACTION_NOT_FOUND({ reference });
    }

    return {
      provider: providerName,
      reference,
      status: record.settled ? PSP_STATUS.SUCCESS : record.status,
      amount: money.toDecimalString(money.toMinor(record.amount ?? '0')),
      currency: record.currency,
      createdAt: record.createdAt,
    };
  }

  /** Parent: tell the copy now; the `wl-hub:deliver` job retries whatever it did not confirm. */
  async #deliver(record) {
    try {
      await deliver({ db: this.db, config: this.config, logger: this.logger }, record.wl.id);
    } catch (error) {
      this.logger?.warn({ err: error.message, orderId: record.wl.id }, 'Whitelabel delivery deferred to the job');
    }
  }

  /**
   * Copy side: the parent reports the outcome of a gateway order this copy opened through it
   * (modules/wl-hub; the parent verified the provider's callback and amount). The same effects
   * as a provider callback here, plus the company's balance (wl-hub/companyWallet), each keyed on
   * the order so a resend changes nothing:
   *
   *   deposit success   player +amount (our recorded figure), company +amount − charge
   *   deposit failed    order marked failed
   *   payout success    order marked paid (player and company were debited at request)
   *   payout failed     player refunded, company gets amount + charge back
   */
  async applyHubEvent({ provider: providerName, flow, reference, status, amount, currency, chargePct, utr }) {
    if (!this.config.WHITELABEL_MODE) throw errors.TRANSACTION_NOT_FOUND({ reference });
    if (providerName === 'ccpayment') return this.#applyHubCcpayment({ flow, reference, status, amount, currency, chargePct, utr });
    const audit = { provider: providerName, digest: crypto.createHash('sha256').update(`hub:${flow}:${reference}:${status}`).digest('hex'), ip: 'parent', body: { flow, reference, status, amount, currency, chargePct } };

    if (flow === 'deposit') {
      const record = await this.#findTransaction(providerName, reference);
      if (!record) throw errors.TRANSACTION_NOT_FOUND({ reference });
      if (record.settled) return { status: 'ok', duplicate: true, reference };
      if (status !== 'success') {
        await this.#markStatus(providerName, record, PSP_STATUS.FAILED);
        void notifyPlayer(record.userId, {
          kind: 'deposit_failed',
          key: `psp-deposit:failed:${providerName}:${reference}`,
          title: 'Deposit failed',
          body: 'Your {amount} deposit did not go through. Nothing was credited.',
          link: '#transactions',
          meta: { amount: record.amount, currency: record.currency, reference: String(reference) },
        });
        return { status: 'ok', settled: false, reference };
      }
      const expected = money.toDecimalString(money.toMinor(record.amount ?? '0'));
      if (money.compare(expected, money.toDecimalString(money.toMinorQuantised(amount))) !== 0 || String(record.currency).toUpperCase() !== String(currency).toUpperCase()) {
        this.logger?.error({ provider: providerName, reference, expected, reported: amount }, 'REJECTED hub deposit: amount or coin differs from our record');
        throw errors.AMOUNT_MISMATCH({ expected, reported: amount });
      }
      const settled = await this.db.transaction(async (transaction) => {
        audit.reference = reference;
        audit.userId = record.userId;
        audit.currency = record.currency;
        await this.#claimPayload(audit, { amount: expected, transaction, exclusive: true });
        const movement = await this.wallet.credit(
          {
            userId: record.userId,
            currency: record.currency,
            amount: expected,
            reason: REASON.DEPOSIT,
            idempotencyKey: `psp:${providerName}:${reference}`,
            refType: `PSP_${providerName.toUpperCase()}`,
            refId: String(reference),
            description: `${providerName} deposit ${reference}`,
          },
          { sourceService: 'user-service', transaction }
        );
        await this.#markStatus(providerName, record, PSP_STATUS.SUCCESS, { transaction, utr });
        const company = await companyWallet.onDeposit(this.db, { provider: providerName, reference, currency: record.currency, amount: expected, chargePct }, transaction);
        return { ledgerId: movement.ledgerId, newBalance: movement.newBalance, company };
      });
      this.logger?.info({ provider: providerName, reference, userId: record.userId, amount: expected, company: settled.company }, 'Hub deposit settled');
      await this.firstDepositBonus.onDepositCredited({
        userId: record.userId,
        currency: record.currency,
        amount: expected,
        ledgerId: settled.ledgerId,
        source: `PSP_${providerName.toUpperCase()}`,
        refId: String(reference),
      });
      void notifyPlayer(record.userId, {
        kind: 'deposit_credited',
        key: `psp-deposit:credited:${providerName}:${reference}`,
        title: 'Deposit received',
        body: '{amount} has been credited to your wallet.',
        link: '#transactions',
        meta: { amount: expected, currency: record.currency, reference: String(reference) },
      });
      return { status: 'ok', settled: true, reference };
    }

    const payout = await this.#findPayout(providerName, reference);
    if (!payout) throw errors.TRANSACTION_NOT_FOUND({ reference });
    if (status === 'success') {
      await this.#markPayoutStatus(payout, PSP_STATUS.SUCCESS);
      void notifyPlayer(payout.userId, {
        kind: 'withdrawal_paid',
        key: `psp-payout:paid:${providerName}:${payout.reference}`,
        title: 'Withdrawal paid',
        body: 'Your {amount} withdrawal has been sent.',
        link: '#transactions',
        meta: { amount: payout.amount, currency: payout.currency, reference: String(payout.reference) },
      });
      return { status: 'ok', settled: true, reference };
    }
    const refundAmount = money.toDecimalString(money.toMinor(payout.amount ?? '0'));
    await this.db.transaction(async (transaction) => {
      await this.wallet.credit(
        {
          userId: payout.userId,
          currency: payout.currency,
          amount: refundAmount,
          reason: REASON.WITHDRAWAL_REVERSAL,
          idempotencyKey: `payout-refund:${providerName}:${payout.reference}`,
          refType: `PAYOUT_${providerName.toUpperCase()}_REFUND`,
          refId: String(payout.reference),
          description: `Refund for failed withdrawal ${payout.reference}`,
        },
        { sourceService: 'user-service', transaction }
      );
      await this.#markPayoutStatus(payout, PSP_STATUS.FAILED, { transaction, refunded: true });
      await companyWallet.onWithdrawalFailed(this.db, { provider: providerName, reference }, transaction);
    });
    if (!payout.refunded) {
      void notifyPlayer(payout.userId, {
        kind: 'withdrawal_rejected',
        key: `psp-payout:failed:${providerName}:${payout.reference}`,
        title: 'Withdrawal failed',
        body: 'Your {amount} withdrawal could not be paid out. The funds are back in your wallet.',
        link: '#transactions',
        meta: { amount: refundAmount, currency: payout.currency, reference: String(payout.reference) },
      });
    }
    return { status: 'ok', settled: false, refunded: true, reference };
  }

  /**
   * Copy side, CCPayment. A withdrawal is the crypto withdrawal staff sent through CCPayment
   * (crypto-withdraw applyGatewayOutcome). A deposit carries what has ARRIVED so far (it can come
   * in parts): only the difference from what was already credited is credited — to the player and,
   * less the charge, to the company — keyed on the running total so a resend changes nothing.
   */
  async #applyHubCcpayment({ flow, reference, status, amount, currency, chargePct, utr }) {
    if (flow === 'payout') {
      const { CryptoWithdrawService } = require('../crypto-withdraw/cryptoWithdraw.service');
      const applied = await new CryptoWithdrawService({ ...this.deps, http: this.http }).applyGatewayOutcome({ orderId: reference, outcome: status, txId: utr ?? null });
      if (!applied) throw errors.TRANSACTION_NOT_FOUND({ reference });
      return { status: 'ok', reference, ...applied };
    }

    const coin = String(currency).toUpperCase();
    const outcome = await this.db.transaction(async (transaction) => {
      const deposit = await this.models.Ccdeposit.findOne({ where: { orderid: reference }, transaction, lock: transaction.LOCK.UPDATE });
      if (!deposit) throw errors.TRANSACTION_NOT_FOUND({ reference });
      if (Number(deposit.coinid) !== ccpaymentCoinId(coin, this.config)) throw errors.AMOUNT_MISMATCH({ expected: `coin ${deposit.coinid}`, reported: coin });
      const credited = deposit.status === CCPAYMENT_STATUS.SUCCESS ? money.toMinorQuantised(deposit.amount ?? '0') : 0n;

      if (status !== 'success') {
        if (credited > 0n) return { duplicate: true };
        await deposit.update({ status: CCPAYMENT_STATUS.FAILED, updated_at: new Date() }, { transaction });
        return { failed: true, userId: deposit.userid, ordered: String(deposit.price ?? '0') };
      }

      const total = money.toMinorQuantised(amount);
      if (total <= credited) return { duplicate: true };
      const delta = money.toDecimalString(total - credited);
      const totalDecimal = money.toDecimalString(total);
      const movement = await this.wallet.credit(
        {
          userId: deposit.userid,
          currency: coin,
          amount: delta,
          reason: REASON.DEPOSIT,
          idempotencyKey: `ccpayment-hub:${reference}:${totalDecimal}`,
          refType: 'CRYPTO_DEPOSIT',
          refId: reference,
          description: `${coin} deposit`,
        },
        { sourceService: 'user-service', transaction }
      );
      await deposit.update({ status: CCPAYMENT_STATUS.SUCCESS, amount: totalDecimal, updated_at: new Date() }, { transaction });
      const company = await companyWallet.onDeposit(this.db, { provider: 'ccpayment', reference: `${reference}@${totalDecimal}`, currency: coin, amount: delta, chargePct }, transaction);
      return { userId: deposit.userid, delta, ledgerId: movement.ledgerId, company };
    });

    if (outcome.duplicate) return { status: 'ok', duplicate: true, reference };
    if (outcome.failed) {
      void notifyPlayer(outcome.userId, {
        kind: 'deposit_failed',
        key: `crypto-deposit:failed:${reference}`,
        title: 'Deposit failed',
        body: 'Your {amount} deposit did not go through. Nothing was credited.',
        link: '#transactions',
        meta: { amount: outcome.ordered, currency: coin, reference },
      });
      return { status: 'ok', settled: false, reference };
    }
    this.logger?.info({ reference, userId: outcome.userId, amount: outcome.delta, company: outcome.company }, 'Hub CCPayment deposit credited');
    await this.firstDepositBonus.onDepositCredited({
      userId: outcome.userId,
      currency: coin,
      amount: outcome.delta,
      ledgerId: outcome.ledgerId,
      source: 'CRYPTO_DEPOSIT',
      refId: reference,
    });
    void notifyPlayer(outcome.userId, {
      kind: 'deposit_credited',
      key: `crypto-deposit:credited:${reference}:${outcome.delta}`,
      title: 'Deposit received',
      body: '{amount} has been credited to your wallet.',
      link: '#transactions',
      meta: { amount: outcome.delta, currency: coin, reference },
    });
    return { status: 'ok', settled: true, reference };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Ask a provider what really happened, over a channel the caller cannot touch.
   *
   * Returns null on any failure — unreachable, malformed, a shape the adapter
   * does not recognise. Null means "do not settle", never "assume success":
   * a provider that cannot be reached will retry the callback, and a deposit
   * that lands late is a support ticket, whereas one credited on an unconfirmed
   * notification is a loss.
   */
  async #confirm(provider, reference) {
    try {
      return await provider.confirm(reference, this.config, { http: this.http });
    } catch (error) {
      this.logger?.error(
        { err: error, provider: provider.name, reference },
        'Could not confirm a payment with the provider — refusing to settle on the callback alone'
      );
      return null;
    }
  }

  /**
   * Record a callback we are NOT accepting.
   *
   * Never throws. An audit write that fails must not turn a correctly-refused
   * callback into a 500 — the refusal is the important part, the row is
   * evidence. A failure here is logged at `error` so it is visible.
   */
  async #record(audit, { accepted = false, rejection = null, amount = null } = {}) {
    try {
      await this.models.PspCallbackLog.create({
        provider: audit.provider,
        reference: audit.reference ?? null,
        payload_digest: audit.digest,
        accepted,
        rejection_code: rejection,
        amount,
        currency: audit.currency ?? null,
        user_id: audit.userId ?? null,
        source_ip: audit.ip ?? null,
        payload: this.#redact(audit.body),
      });
    } catch (error) {
      this.logger?.error({ err: error, provider: audit.provider }, 'Could not write the PSP callback audit row');
    }
  }

  /**
   * Claim this payload as having settled something — or refuse it.
   *
   * Unlike `#record`, this one DOES throw: the unique-index violation is the
   * replay guard firing, and swallowing it would credit the replay.
   */
  async #claimPayload(audit, { amount, transaction, exclusive = true }) {
    try {
      await this.models.PspCallbackLog.create(
        {
          provider: audit.provider,
          reference: audit.reference ?? null,
          payload_digest: audit.digest,
          // Money moved either way — that is what `accepted` records.
          accepted: true,
          // Whether the digest is spent is a separate question. A provider
          // whose signature does not name the transaction produces digests that
          // repeat honestly, so reserving one would refuse a real payment.
          digest_reserved: exclusive,
          amount,
          currency: audit.currency ?? null,
          user_id: audit.userId ?? null,
          source_ip: audit.ip ?? null,
          payload: this.#redact(audit.body),
        },
        { transaction }
      );
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') {
        this.logger?.error(
          { provider: audit.provider, reference: audit.reference, ip: audit.ip },
          'REJECTED payment callback: this payload has already settled a transaction (replay)'
        );
        throw errors.PAYLOAD_REPLAYED({ reference: audit.reference });
      }
      throw error;
    }
  }

  /**
   * Strip the parts of a callback body that are secrets in their own right.
   *
   * A provider's access key identifies us to them; storing it in a table that
   * support staff read defeats the point of it being a secret. The signature
   * stays — it is the evidence, and it is worthless without the key.
   */
  #redact(body) {
    if (!body || typeof body !== 'object') return null;
    const { access_key: _a, apikey: _b, api_key: _c, ...rest } = body;
    return rest;
  }

  /** A provider whose secrets are not configured must not accept callbacks. */
  #assertConfigured(provider) {
    const missing = (provider.requiredConfig || []).filter((key) => !this.config[key]);
    if (missing.length) {
      this.logger?.error(
        { provider: provider.name, missing },
        'Payment provider is not configured — refusing callbacks rather than accepting unverified ones'
      );
      throw errors.PROVIDER_DISABLED({ provider: provider.name });
    }
  }

  /**
   * Normalise each provider's table into one shape.
   *
   * Four providers, four tables, four column namings — the alternative is four
   * copies of the settlement logic above, which is how the legacy code ended up
   * with four different levels of care.
   */
  async #findTransaction(providerName, reference) {
    const own = await this.#findOwnTransaction(providerName, reference);
    if (own || this.config.WHITELABEL_MODE) return own;
    return hubOrders.forCallback(this.db, providerName, 'deposit', String(reference));
  }

  async #findOwnTransaction(providerName, reference) {
    const { Upideposit, Apaydeposits, Cricpaytransactions, PayInTransactions } = this.models;

    if (providerName === 'upi') {
      const row = await Upideposit.findOne({ where: { transactioniduser: reference }, raw: true });
      return row && {
        model: 'Upideposit', key: { transactioniduser: reference },
        // UPI Gateway is INR-only and the column is lower-case 'success'.
        userId: row.uid, amount: row.amount, currency: 'INR',
        status: row.status, settled: row.status === 'success', createdAt: row.created_at,
      };
    }

    if (providerName === 'apay') {
      const row = await Apaydeposits.findOne({ where: { custom_transaction_id: reference }, raw: true });
      return row && {
        model: 'Apaydeposits', key: { custom_transaction_id: reference },
        // The column is `user_id`; `custom_user_id` is what A-Pay calls it in
        // the API payload and is not a column on this table.
        userId: row.user_id, amount: row.amount, currency: row.currency ?? 'INR',
        // A-Pay writes 'Pending' / 'Success' / 'Failed' / 'Rejected'.
        status: row.status, settled: SETTLED_STATUSES.has(String(row.status).toLowerCase()),
        createdAt: row.created_at,
      };
    }

    if (providerName === 'cricpay') {
      // `transaction_code`, not `client_txn_id` — the latter does not exist on
      // this table. Every CricPay callback would have failed with an unknown
      // column until this was corrected.
      const row = await Cricpaytransactions.findOne({ where: { transaction_code: reference }, raw: true });
      return row && {
        model: 'Cricpaytransactions', key: { transaction_code: reference },
        userId: row.uid, amount: row.amount, currency: 'INR',
        // Legacy writes 'Pending' / 'Successful' / 'Failed' — capitalised, and
        // "Successful", not "Success". Compared case-insensitively so a row
        // written by the legacy process is read correctly during the cutover.
        status: row.status, settled: SETTLED_STATUSES.has(String(row.status).toLowerCase()),
        createdAt: row.created_at,
      };
    }

    if (providerName === 'f2pay') {
      const row = await this.models.F2payDeposits.findOne({ where: { mch_order_no: reference }, raw: true });
      return row && {
        model: 'F2payDeposits', key: { mch_order_no: reference },
        userId: row.user_id, amount: row.amount, currency: row.currency,
        // 'Pending' / 'Success' / 'Failed'.
        status: row.status, settled: SETTLED_STATUSES.has(String(row.status).toLowerCase()),
        createdAt: row.created_at,
      };
    }

    const row = await PayInTransactions.findOne({ where: { out_trade_no: reference }, raw: true });
    return row && {
      model: 'PayInTransactions', key: { out_trade_no: reference },
      userId: row.user_id, amount: row.amount, currency: row.currency,
      // WayPay stores a numeric status; 1 is settled.
      status: row.status, settled: Number(row.status) === 1, createdAt: row.created_at,
    };
  }

  /**
   * Write the terminal status back, in the spelling that table already uses.
   *
   * Writing one canonical status everywhere would be tidier and wrong: the
   * legacy admin screens, reports and support queries all filter on the
   * existing values, so a row this service settles has to look identical to one
   * the legacy process settled. During a cutover both are writing.
   *
   * The mapping is exhaustive over the four tables and falls back to lower-case
   * — a new provider table gets sane values rather than silence.
   */
  /** The payout side of #findTransaction. Two tables rather than four. */
  async #findPayout(providerName, reference) {
    const own = await this.#findOwnPayout(providerName, reference);
    if (own || this.config.WHITELABEL_MODE) return own;
    return hubOrders.forCallback(this.db, providerName, 'payout', String(reference));
  }

  async #findOwnPayout(providerName, reference) {
    const { Apaywithdrawals, PayOutTransactions } = this.models;

    if (providerName === 'f2pay') {
      const row = await this.models.F2payWithdrawals.findOne({ where: { mch_order_no: reference }, raw: true });
      return row && {
        model: 'F2payWithdrawals', key: { mch_order_no: reference },
        reference, userId: row.user_id, amount: row.amount, currency: row.currency,
        status: row.status, refunded: Boolean(row.refunded),
      };
    }

    if (providerName === 'apay') {
      const row = await Apaywithdrawals.findOne({ where: { custom_transaction_id: reference }, raw: true });
      return row && {
        model: 'Apaywithdrawals', key: { custom_transaction_id: reference },
        reference, userId: row.user_id, amount: row.amount, currency: row.currency,
        status: row.status, refunded: Boolean(row.refunded),
      };
    }

    const row = await PayOutTransactions.findOne({ where: { out_trade_no: reference }, raw: true });
    return row && {
      model: 'PayOutTransactions', key: { out_trade_no: reference },
      reference, userId: row.user_id, amount: row.amount, currency: row.currency,
      // This table has no `refunded` column; status 2 is its terminal failure,
      // and the wallet's idempotency key is the real guard against a double
      // refund either way.
      status: row.status, refunded: Number(row.status) === 2,
    };
  }

  async #markPayoutStatus(payout, status, { transaction, refunded } = {}) {
    const model = this.models[payout.model];
    if (!model) return;

    const success = status === PSP_STATUS.SUCCESS;
    const patch = payout.model === 'Apaywithdrawals' || payout.model === 'F2payWithdrawals'
      ? { status: success ? 'Success' : 'Failed', ...(refunded !== undefined ? { refunded } : {}) }
      : { status: success ? 1 : 2 };

    await model.update(patch, { where: payout.key, transaction });
  }

  async #markStatus(providerName, record, status, { transaction, utr } = {}) {
    const model = this.models[record.model];
    if (!model) return;

    const success = status === PSP_STATUS.SUCCESS;

    const STATUS_BY_TABLE = {
      // Numeric, not a string. 1 = paid, 2 = failed.
      PayInTransactions: success ? 1 : 2,
      Apaydeposits: success ? 'Success' : 'Failed',
      Cricpaytransactions: success ? 'Successful' : 'Failed',
      Upideposit: success ? 'success' : 'failed',
      F2payDeposits: success ? 'Success' : 'Failed',
    };

    const patch = {
      status: STATUS_BY_TABLE[record.model] ?? (success ? 'success' : 'failed'),
    };

    if (utr && model.rawAttributes.utr_number) patch.utr_number = utr;

    await model.update(patch, { where: record.key, transaction });
  }
}

module.exports = { PspService };
