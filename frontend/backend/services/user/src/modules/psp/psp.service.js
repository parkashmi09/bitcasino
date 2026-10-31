'use strict';

const crypto = require('crypto');

const { money } = require('@ibitplay/common');

const errors = require('./psp.errors');
const { PSP_STATUS, SETTLED_STATUSES } = require('./psp.constants');
const { getProvider } = require('./providers');
const { createHttpClient } = require('./providers/http');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');

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
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = new WalletService(deps);

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

    // ── 3. A failure is recorded, not credited ────────────────────────
    if (parsed.status !== PSP_STATUS.SUCCESS) {
      await this.#markStatus(providerName, record, PSP_STATUS.FAILED);
      this.logger?.info({ provider: providerName, reference: parsed.reference }, 'Payment reported as failed');
      // Logged, but NOT as an accepted digest: a failure notice must not burn
      // the fingerprint of a payload the provider may resend as a success.
      await this.#record(audit, { accepted: false, rejection: 'REPORTED_FAILED' });
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

    // ── 5. Credit, once — and burn the payload ────────────────────────
    return this.db.transaction(async (transaction) => {
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

    // ── Success: the money already left. Record and stop. ─────────────
    if (parsed.status === PSP_STATUS.SUCCESS) {
      await this.#markPayoutStatus(payout, PSP_STATUS.SUCCESS);
      await this.#record(audit, { accepted: true, amount: payout.amount });
      this.logger?.info(
        { provider: providerName, reference: parsed.reference, userId: payout.userId },
        'Payout confirmed by the provider'
      );
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
    const { Apaywithdrawals, PayOutTransactions } = this.models;

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
    const patch = payout.model === 'Apaywithdrawals'
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
    };

    const patch = {
      status: STATUS_BY_TABLE[record.model] ?? (success ? 'success' : 'failed'),
    };

    if (utr && model.rawAttributes.utr_number) patch.utr_number = utr;

    await model.update(patch, { where: record.key, transaction });
  }
}

module.exports = { PspService };
