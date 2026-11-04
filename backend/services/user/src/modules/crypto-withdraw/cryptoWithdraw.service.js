'use strict';

const crypto = require('node:crypto');
const { Op, fn, col } = require('sequelize');
const { money, sitePolicy, currencyRegistry, assertCurrencySupportedFor, withdrawBlock } = require('@ibitplay/common');
const { assertPlayerCapability } = require('@ibitplay/auth');

const errors = require('./cryptoWithdraw.errors');
const {
  STATUS, TRANSITIONS, SENDABLE, REFUNDING_STATUSES, COIN_COLUMNS, BLOCKED_COINS, normaliseCoin,
} = require('./cryptoWithdraw.constants');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { notifyPlayer } = require('../notifications/notifyPlayer');
const { withdrawalNotice } = require('../notifications/notices');
const { networksFor } = require('../crypto/crypto.networks');
const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
const { createWithdrawRequirements } = require('../withdraw-requirements/withdrawRequirements');
const { withChannel } = require('../directory/playerScope');
const { ccpaymentCall, plainAmount, withdrawalOutcome } = require('../crypto/ccpaymentApi');
const { ccpaymentCoinId, ccpaymentChain, refreshCcpaymentCoinIds } = require('../payment-orders/gateways');
const { createHttpClient } = require('../psp/providers/http');
const { callParent } = require('../wl-hub/hubCredentials');
const { withdrawalChargePct } = require('../wl-hub/hubGateway');
const companyWallet = require('../wl-hub/companyWallet');

/** Thrown inside the request transaction to roll back a double submit's row. */
class ReplayedRequest extends Error {}

/**
 * The crypto withdrawal queue.
 *
 * The money is already gone from the player's balance by the time a row exists
 * here — `legacy/Users/Rule.js` inserts the request and then calls
 * `reduceBalance`. So every state this service can move a row into is a
 * decision about money that has already moved, and exactly one of them has to
 * give it back.
 */
class CryptoWithdrawService {
  constructor(deps) {
    const { models, db, logger, config } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.wallet = new WalletService(deps);
    this.playerBonuses = deps.playerBonuses ?? new PlayerBonusService({ ...deps, walletService: this.wallet });
    // The fiat rail's policy, read from the same keys: one minimum, one KYC switch.
    this.minimum = config?.WITHDRAW_MINIMUM ?? '1';
    // The owner's `withdrawal_requirements` policy (KYC / wagering), with WITHDRAW_REQUIRE_KYC.
    this.requirements = deps.withdrawRequirements ?? createWithdrawRequirements({ ...deps, playerBonuses: this.playerBonuses });
    this.deps = deps;
    this.http = deps.http ?? createHttpClient({ logger, timeoutMs: Number(config?.PSP_TIMEOUT_MS ?? 10_000) });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The request
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy SOCKET 7c0b37955cf21c7f2f3773c1268edc08 (`C.SUBMIT_NEW_WITHDRAWL`)
   *
   * Request a payout, holding the funds.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE SOCKET USED TO DO THIS ITSELF, AND GOT TWO THINGS WRONG
   *
   *   It debited `credits` with a raw `UPDATE … SET usdt = usdt - x`, so no
   *   ledger row recorded the hold and `WalletService.reconcile` drifted for
   *   every player who withdrew crypto.
   *
   *   It inserted the row as `'pending'` — a status `TRANSITIONS` does not
   *   know — so `decide()` answered INVALID_TRANSITION and staff could neither
   *   pay nor refund the request.
   *
   * This is the fiat rail's `create`, step for step: site policy, minimum,
   * cooldown, KYC, bonus forfeit, then ONE transaction holding the guarded
   * `WalletService.debit` (row lock, `>= amount`, a WITHDRAWAL ledger row) and
   * the `In Queue` request row. The coin is stored upper-case, as the ledger
   * spells it.
   *
   * A double submit within the minute (same coin, amount and destination)
   * replays the hold and returns the first request rather than making a
   * second row against one debit.
   * ─────────────────────────────────────────────────────────────────────
   */
  async request({ userId, coin, amount, wallet, chain, forfeitBonus = false }) {
    const currency = normaliseCoin(coin);

    // Agent-tree players are paid out by their agent only — no withdrawal rail.
    await assertPlayerCapability(userId, 'withdraw');
    // A crypto payout request is reviewed and sent by the cashier team — the manual route.
    await sitePolicy.assertAllowed(this.models, 'withdrawal_mode', 'manual', this.logger);
    // An owner-created coin has no chain to pay out on: CURRENCY_NOT_SUPPORTED_FOR_WITHDRAWAL.
    assertCurrencySupportedFor('WITHDRAWAL', currency);
    if (BLOCKED_COINS.includes(currency) || !COIN_COLUMNS[currency]) throw errors.UNSUPPORTED_COIN({ coin: currency });

    // The coin registry (migration 061): a coin the site or the owner switched
    // off is not paid out, and a named network must be one of the coin's
    // networks that is on. A registry outage fails open.
    await currencyRegistry.assertRegistryReadable();
    if (!(await currencyRegistry.isEnabled(currency))) throw errors.UNSUPPORTED_COIN({ coin: currency });
    const network = chain ? String(chain) : null;
    if (network) {
      const offered = await networksFor(currency);
      if (!offered.some((n) => n.key === network)) {
        throw errors.NETWORK_UNAVAILABLE({ coin: currency, chain: network.slice(0, 20), offered: offered.map((n) => n.key) });
      }
    }

    let requested;
    try {
      requested = money.toMinor(String(amount ?? '0'));
    } catch {
      throw errors.INVALID_AMOUNT({ amount });
    }
    if (requested <= 0n) throw errors.INVALID_AMOUNT({ amount });
    const decimal = money.toDecimalString(requested);
    if (money.lt(decimal, this.minimum)) throw errors.BELOW_MINIMUM({ minimum: this.minimum, amount: decimal });

    const address = String(wallet ?? '').trim();
    if (!address) throw errors.INVALID_ADDRESS();

    // Cooldown before KYC, as on the fiat rail: the temporary blocker first.
    await this.#assertMayWithdraw(userId);
    // KYC (CRYPTO_WITHDRAW_KYC_REQUIRED), wagering (WITHDRAW_WAGER_REQUIRED) and the deposit
    // cap (WITHDRAW_CAP_EXCEEDED), per the policy.
    const applied = await this.requirements.assertMet(userId, {
      forfeitBonus,
      kycError: (kycStatus) => errors.KYC_REQUIRED({ userId, kycStatus }),
      amount: decimal,
      currency,
    });

    // Cash only; an unwagered bonus needs the player's confirmation (BONUS_FORFEIT_REQUIRED).
    await this.playerBonuses.beforeWithdrawal(userId, { forfeitBonus });

    // Derived from the request itself, so a double-submitted request within the
    // same minute collapses onto one hold. Hashed to fit VARCHAR(120).
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${currency}|${decimal}|${network ?? ''}|${address}`)
      .digest('hex')
      .slice(0, 32);
    const idempotencyKey = `crypto-withdraw:${userId}:${fingerprint}:${Math.floor(Date.now() / 60_000)}`;

    try {
      return await this.db.transaction(async (transaction) => {
        /* TWO SUBMITS AT ONCE: the same lock as the fiat rail. The wallet's replay check reads
           the ledger before it locks the balance, so two concurrent requests could both miss it.
           Keyed on the request and released at commit, it makes the second wait and then see the
           first hold; taken before the bonus and wallet locks, so their order is unchanged. */
        await this.db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
          replacements: { key: idempotencyKey },
          transaction,
        });

        // The deposit cap again, under a per-player lock: two requests at once cannot both fit.
        await this.requirements.assertCapInTransaction(userId, { amount: decimal, currency, transaction, applied });

        // Confirmed: forfeit the active bonuses first (bonuses → wallet lock order).
        await this.playerBonuses.beforeWithdrawal(userId, { forfeitBonus, transaction });

        const row = await this.models.Withdrawals.create(
          {
            uid: userId,
            amount: decimal,
            wallet: address,
            status: STATUS.IN_QUEUE,
            coin: currency,
            chain: network,
            date: new Date(),
          },
          { transaction }
        );

        let movement;
        try {
          movement = await this.wallet.debit(
            {
              userId,
              currency,
              amount: decimal,
              reason: REASON.WITHDRAWAL,
              idempotencyKey,
              // The refund in `decide` carries the same pair.
              refType: 'CRYPTO_WITHDRAWAL',
              refId: String(row.id),
              description: `Withdrawal #${row.id} requested — funds held`,
            },
            { sourceService: 'user-service', transaction }
          );
        } catch (error) {
          if (error.code === 'WALLET_INSUFFICIENT_FUNDS') {
            throw errors.INSUFFICIENT_BALANCE({ coin: currency, requested: decimal, available: error.details?.available });
          }
          throw error;
        }

        // The hold already exists: undo this row and answer with the first one.
        if (movement.replayed) throw new ReplayedRequest();

        this.logger?.warn(
          {
            userId: String(userId),
            amount: decimal,
            coin: currency,
            withdrawalId: String(row.id),
            ledgerId: movement.ledgerId,
            // The address is NOT logged in full — it is a payment destination.
            address: this.#maskWallet(address),
          },
          'Crypto withdrawal requested, funds held'
        );

        return { ...this.#present(row.get({ plain: true })), heldLedgerId: movement.ledgerId, replayed: false };
      });
    } catch (error) {
      if (!(error instanceof ReplayedRequest)) throw error;
      return this.#replayedRequest(idempotencyKey, userId);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /getWithdrawDataUser
   *
   * One player's withdrawals.
   *
   * Legacy took the player from `?uid=` on an unauthenticated route, so anyone
   * could read anyone's withdrawal history — amounts and destination wallet
   * addresses included. The player is the authenticated caller on the user
   * router; on the admin router it is a path parameter behind a permission.
   */
  async listForUser({ userId, status, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.Withdrawals.findAndCountAll({
      where: { uid: userId, ...(status ? { status } : {}) },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#present(r)) };
  }

  /**
   * @legacy GET /getWithdrawData
   * @legacy GET /withdrawals
   *
   * The whole queue, for staff.
   *
   * ─────────────────────────────────────────────────────────────────────
   * BOTH LEGACY VERSIONS WERE UNAUTHENTICATED, AND `/withdrawals` WAS
   * `SELECT * FROM withdrawals`
   *
   * No filter, no paging, no permission. Every withdrawal on the platform —
   * player id, amount, coin, and the destination wallet address of each one —
   * to anyone who could reach the port. The wallet addresses are the part that
   * does not expire: they are on a public chain, so that response links every
   * player on this platform to their on-chain activity, permanently.
   *
   * `/withdrawals` then called `convertToUSDT` once PER ROW — an await each,
   * inside a `Promise.all` over the whole table. On a table of any size that is
   * a rate lookup per withdrawal on every request.
   *
   * The conversion is not done here at all. A USDT equivalent computed at read
   * time is a different number every time the endpoint is called, so it cannot
   * be reconciled against anything and does not belong on a payment record.
   * The amount and the coin are returned; `modules/exchange-rate` converts, and
   * a caller that wants a total in one currency asks it once.
   * ─────────────────────────────────────────────────────────────────────
   */
  async listAll({ status, userId, coin, from, to, channel, limit = 50, offset = 0 }) {
    const where = withChannel({
      ...(status ? { status } : {}),
      ...(userId ? { uid: userId } : {}),
      ...(coin ? { coin } : {}),
      ...(from || to
        ? { date: { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) } }
        : {}),
    }, 'uid', channel);

    const { rows, count } = await this.models.Withdrawals.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.uid));

    return {
      total: count,
      rows: rows.map((r) => ({
        ...this.#present(r, { forStaff: true }),
        username: names.get(String(r.uid)) ?? null,
      })),
    };
  }

  /**
   * @legacy GET /api/withdrawNew
   *
   * A player's own withdrawals, optionally today's only.
   *
   * Legacy's version restricted with `DATE(date) = CURRENT_DATE`, which casts
   * every row before comparing and so cannot use an index on `date`. A
   * half-open range on the raw column can.
   */
  async listMine({ userId, filter, limit = 50, offset = 0 }) {
    return this.listForUser({
      userId,
      limit,
      offset,
      ...(filter === 'today' ? { from: this.#startOfToday() } : {}),
    });
  }

  /** Totals per status, for the queue header. */
  async summary({ userId, coin } = {}) {
    const rows = await this.models.Withdrawals.findAll({
      attributes: ['status', 'coin', [fn('COUNT', col('id')), 'count'], [fn('SUM', col('amount')), 'total']],
      // `coin`: the site admin's currency filter (staff route only; a player's own summary never passes it).
      where: { ...(userId ? { uid: userId } : {}), ...(coin ? { coin } : {}) },
      group: ['status', 'coin'],
      raw: true,
    });

    return rows.map((r) => ({
      status: r.status,
      coin: r.coin,
      count: Number(r.count),
      total: money.toDecimalString(money.toMinor(r.total ?? '0')),
    }));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The decision
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /updateWithdrawStatus
   *
   * Move a withdrawal through the queue, refunding if it is refused.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE LEGACY HANDLER WAS ONE STATEMENT
   *
   *     UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *
   *
   * with `id` and `status` from the body, on an unauthenticated route. Four
   * things follow from that, and all four are fixed here:
   *
   *   REJECTING DID NOT REFUND. The balance was debited when the player asked.
   *   Setting the status to 'rejected' returned nothing — the money simply
   *   stayed gone, with no ledger row anywhere recording that it had.
   *
   *   `status` WAS A FREE STRING. Anything at all could be written. The alert
   *   classifier underneath matched a fixed list, so a near-miss like
   *   'complete' stored fine, fired no alert, and read as settled.
   *
   *   THERE WAS NO STATE MACHINE. A withdrawal already sent could be set back
   *   to pending and approved again — and approval is the instruction to send
   *   coin, so that is a second payout of one request.
   *
   *   THE UPDATE WAS UNCONDITIONAL. Two staff acting at once both succeeded.
   *   The row is locked here and the transition is checked under that lock.
   * ─────────────────────────────────────────────────────────────────────
   */
  async decide({ withdrawalId, status, txid, comment }, staff) {
    let player = null;
    const result = await this.db.transaction(async (transaction) => {
      const row = await this.models.Withdrawals.findOne({
        where: { id: withdrawalId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!row) throw errors.NOT_FOUND({ withdrawalId });

      const current = row.status ?? STATUS.IN_QUEUE;
      const allowed = TRANSITIONS[current];

      // A status the machine has never heard of — an existing row written by
      // legacy's free-string update. Say so rather than guessing.
      if (!allowed) {
        throw errors.INVALID_TRANSITION({
          withdrawalId,
          from: current,
          to: status,
          reason: 'the current status is not one this queue recognises',
        });
      }
      if (!allowed.length) throw errors.TERMINAL({ withdrawalId, status: current });
      if (!allowed.includes(status)) {
        throw errors.INVALID_TRANSITION({ withdrawalId, from: current, to: status, allowed });
      }

      let refund = null;
      if (REFUNDING_STATUSES.includes(status)) {
        refund = await this.wallet.credit(
          {
            userId: row.uid,
            // Upper-case, as the hold was written: a lower-case `'usdt'` row
            // would otherwise refund under a currency `reconcile('USDT')` skips.
            currency: normaliseCoin(row.coin),
            amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
            reason: REASON.WITHDRAWAL_REVERSAL,
            /**
             * Keyed on the withdrawal, so a retried rejection refunds once.
             * The state machine above would normally stop a second attempt —
             * this is the guard that holds if it is ever loosened.
             */
            idempotencyKey: `crypto-withdraw-refund:${withdrawalId}`,
            refType: 'CRYPTO_WITHDRAWAL',
            refId: String(withdrawalId),
            description: `Withdrawal #${withdrawalId} rejected — funds returned`,
          },
          { sourceService: 'user-service', transaction }
        );
      }

      await row.update(
        {
          status,
          // The on-chain hash, once it exists. Legacy had nowhere to put it —
          // migration 022 adds the column, and the note there explains the
          // variable named `txid` that holds the string "In Queue".
          ...(txid ? { txid } : {}),
          ...(comment ? { note: comment } : {}),
          decided_by: staff?.id ?? null,
          decided_at: new Date(),
        },
        { transaction }
      );
      player = { userId: row.uid, amount: row.amount, currency: normaliseCoin(row.coin) };

      this.logger?.info(
        {
          withdrawalId,
          from: current,
          to: status,
          // The real staff id, from a verified token. Legacy read
          // `x-staff-id` off the request headers, so the audit trail recorded
          // whoever the caller said they were.
          staffId: staff?.id ?? null,
          refundLedgerId: refund?.ledgerId ?? null,
        },
        'Crypto withdrawal status changed'
      );

      return {
        withdrawalId,
        from: current,
        status,
        comment: comment ?? null,
        txid: txid ?? null,
        refunded: Boolean(refund),
        newBalance: refund?.newBalance ?? null,
      };
    });
    void notifyPlayer(player.userId, withdrawalNotice('crypto-withdraw', withdrawalId, status, player, comment));
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Sending through CCPayment (owner, 2026-11-01)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Staff send a queued withdrawal through CCPayment instead of by hand. The row moves to
   * `Sending` with OUR orderId first (CCPayment refuses a repeated orderId, so it can never pay one
   * request twice), then CCPayment is asked (`applyAppWithdrawToNetwork`). Its `ApiWithdrawal`
   * webhook — or "Check with CCPayment" — finishes it: Sent with the txid, or Rejected with the
   * player's refund.
   *
   *   CCPayment refused it        back to where it was, nothing sent (the error is shown)
   *   no answer                   stays Sending; the webhook or a check settles it
   *
   * On a whitelabel copy the parent sends it on ITS CCPayment account (modules/wl-hub) and the
   * company pays the amount (in INR) plus the parent's withdrawal charge now — refused with
   * COMPANY_BALANCE_LOW if it cannot.
   */
  async sendViaGateway({ withdrawalId }, staff) {
    const copy = Boolean(this.config.WHITELABEL_MODE);
    const chargePct = copy ? await withdrawalChargePct(this.deps, 'ccpayment') : null;
    const orderId = `CW${withdrawalId}_${crypto.randomBytes(6).toString('hex')}`;

    const claimed = await this.db.transaction(async (transaction) => {
      const row = await this.models.Withdrawals.findOne({ where: { id: withdrawalId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw errors.NOT_FOUND({ withdrawalId });
      const current = row.status ?? STATUS.IN_QUEUE;
      if (!SENDABLE.includes(current)) throw errors.INVALID_TRANSITION({ withdrawalId, from: current, to: STATUS.SENDING, allowed: [] });
      if (!row.chain) throw errors.NEEDS_NETWORK({ withdrawalId });
      const coin = normaliseCoin(row.coin);
      const amount = money.toDecimalString(money.toMinorQuantised(row.amount ?? '0'));
      if (copy) {
        await companyWallet.onWithdrawal(this.db, { provider: 'ccpayment', reference: orderId, currency: coin, amount, chargePct }, transaction);
      }
      await row.update(
        { status: STATUS.SENDING, gateway: 'ccpayment', gateway_order_id: orderId, decided_by: staff?.id ?? null, decided_at: new Date() },
        { transaction }
      );
      return { previous: current, userId: row.uid, coin, amount, chain: row.chain, address: row.wallet };
    });

    let recordId = null;
    try {
      if (copy) {
        const sent = await callParent(this.deps, 'POST', '/payments/payout', {
          provider: 'ccpayment',
          copyReference: orderId,
          userId: String(claimed.userId),
          currency: claimed.coin,
          amount: claimed.amount,
          method: 'crypto',
          details: { address: claimed.address, chain: claimed.chain },
          chargePct,
        });
        if (!sent?.ok) {
          const refused = new Error(sent?.message ?? 'The parent site could not send it');
          refused.refused = true;
          throw refused;
        }
        recordId = sent.providerReference ?? null;
      } else {
        await refreshCcpaymentCoinIds(this.config, this.http);
        const coinId = ccpaymentCoinId(claimed.coin, this.config);
        if (!coinId) {
          const refused = new Error(`CCPayment does not offer ${claimed.coin} on this account`);
          refused.refused = true;
          throw refused;
        }
        const data = await ccpaymentCall(this, '/ccpayment/v2/applyAppWithdrawToNetwork', {
          coinId,
          chain: ccpaymentChain(claimed.chain),
          address: claimed.address,
          orderId,
          amount: plainAmount(claimed.amount),
          // Default: the player's amount pays the network fee (CCPayment's default).
          merchantPayNetworkFee: this.config.CCPAYMENT_MERCHANT_PAYS_NETWORK_FEE === true,
        });
        recordId = data?.recordId ?? null;
      }
    } catch (error) {
      if (error.refused || error.status === 503 || error.code === 'HUB_NOT_LINKED') {
        await this.#unsend(withdrawalId, orderId, claimed.previous);
        this.logger?.warn({ withdrawalId, orderId, err: error.message }, 'CCPayment refused the withdrawal — back in the queue');
        throw error;
      }
      this.logger?.error({ withdrawalId, orderId, err: error.message }, 'No answer from CCPayment — left Sending until its webhook or a check');
      return { withdrawalId, status: STATUS.SENDING, orderId, uncertain: true };
    }

    if (recordId) await this.models.Withdrawals.update({ gateway_record_id: String(recordId).slice(0, 64) }, { where: { id: withdrawalId } });
    this.logger?.warn({ withdrawalId, orderId, recordId, staffId: staff?.id ?? null }, 'Crypto withdrawal sent through CCPayment');
    return { withdrawalId, status: STATUS.SENDING, orderId, uncertain: false };
  }

  /** CCPayment refused: back to the queue as it was; a copy's company gets its money back. */
  async #unsend(withdrawalId, orderId, previous) {
    await this.db.transaction(async (transaction) => {
      const [count] = await this.models.Withdrawals.update(
        { status: previous, gateway: null, gateway_order_id: null, gateway_record_id: null },
        { where: { id: withdrawalId, status: STATUS.SENDING, gateway_order_id: orderId }, transaction }
      );
      if (count && this.config.WHITELABEL_MODE) {
        await companyWallet.onWithdrawalFailed(this.db, { provider: 'ccpayment', reference: orderId }, transaction);
      }
    });
  }

  /**
   * CCPayment's verified outcome for one of our orders (webhook after `getAppWithdrawRecord`, a
   * check, or — on a copy — the parent). Once: a row no longer Sending is a repeat.
   * `outcome` 'success' → Sent (txid); 'failed' → Rejected, player refunded (and the company).
   */
  async applyGatewayOutcome({ orderId, outcome, txId = null }) {
    let player = null;
    const result = await this.db.transaction(async (transaction) => {
      const row = await this.models.Withdrawals.findOne({ where: { gateway_order_id: String(orderId) }, transaction, lock: transaction.LOCK.UPDATE });
      if (!row) return null;
      if (row.status !== STATUS.SENDING) return { withdrawalId: row.id, status: row.status, duplicate: true };
      const withdrawalId = row.id;
      if (outcome === 'success') {
        await row.update({ status: STATUS.SENT, ...(txId ? { txid: String(txId).slice(0, 120) } : {}), note: row.note ?? 'Sent through CCPayment' }, { transaction });
      } else {
        await this.wallet.credit(
          {
            userId: row.uid,
            currency: normaliseCoin(row.coin),
            amount: money.toDecimalString(money.toMinorQuantised(row.amount ?? '0')),
            reason: REASON.WITHDRAWAL_REVERSAL,
            // The same key a staff rejection uses: one refund per withdrawal, whichever path.
            idempotencyKey: `crypto-withdraw-refund:${withdrawalId}`,
            refType: 'CRYPTO_WITHDRAWAL',
            refId: String(withdrawalId),
            description: `Withdrawal #${withdrawalId} failed at CCPayment — funds returned`,
          },
          { sourceService: 'user-service', transaction }
        );
        await row.update({ status: STATUS.REJECTED, note: 'CCPayment could not send it — funds returned' }, { transaction });
        if (this.config.WHITELABEL_MODE) {
          await companyWallet.onWithdrawalFailed(this.db, { provider: 'ccpayment', reference: String(orderId) }, transaction);
        }
      }
      player = { userId: row.uid, amount: row.amount, currency: normaliseCoin(row.coin) };
      return { withdrawalId, status: outcome === 'success' ? STATUS.SENT : STATUS.REJECTED, refunded: outcome !== 'success' };
    });
    if (player) {
      this.logger?.warn({ orderId, ...result }, 'CCPayment withdrawal settled');
      void notifyPlayer(player.userId, withdrawalNotice('crypto-withdraw', result.withdrawalId, result.status, player));
    }
    return result;
  }

  /** "Check with CCPayment" for a withdrawal still Sending (a webhook that never came). */
  async checkGateway({ withdrawalId }) {
    const row = await this.models.Withdrawals.findOne({ where: { id: withdrawalId }, raw: true });
    if (!row) throw errors.NOT_FOUND({ withdrawalId });
    if (row.status !== STATUS.SENDING || !row.gateway_order_id) throw errors.NOT_SENDING({ withdrawalId, status: row.status });
    const orderId = row.gateway_order_id;

    let outcome = null;
    let txId = null;
    if (this.config.WHITELABEL_MODE) {
      try {
        const order = await callParent(this.deps, 'GET', `/payments/order?flow=payout&copyReference=${encodeURIComponent(orderId)}`);
        outcome = order?.status === 'pending' ? null : order?.status ?? null;
      } catch (error) {
        // The parent never opened it: nothing was sent.
        if (error.refused && error.status === 404) outcome = 'failed';
        else throw error;
      }
    } else {
      const data = await ccpaymentCall(this, '/ccpayment/v2/getAppWithdrawRecord', { orderId });
      outcome = withdrawalOutcome(data?.record?.status);
      txId = data?.record?.txId ?? null;
    }
    if (!outcome) return { withdrawalId, status: STATUS.SENDING, pending: true };
    return this.applyGatewayOutcome({ orderId, outcome, txId });
  }

  // ══════════════════════════════════════════════════════════════════════

  /** The request that already holds this key's funds. */
  async #replayedRequest(idempotencyKey, userId) {
    const hold = await this.models.CreditsLedger.findOne({
      where: { idempotency_key: idempotencyKey },
      attributes: ['id', 'meta'],
      raw: true,
    });
    const row = hold?.meta?.refId
      ? await this.models.Withdrawals.findOne({ where: { id: hold.meta.refId, uid: userId }, raw: true })
      : null;
    if (!row) throw errors.NOT_FOUND({ idempotencyKey });
    return { ...this.#present(row), heldLedgerId: hold.id, replayed: true };
  }

  /**
   * The cheap refusals, for a caller that has its own gate to run after them (the socket's
   * password check): an agent-tree player, a locked or withdraw-blocked account, and the
   * site's withdrawal policy. So a blocked player is told they are blocked, not that their
   * password is wrong. `request` asks all of them again; this only puts them first.
   */
  async assertMayRequest(userId) {
    await assertPlayerCapability(userId, 'withdraw');
    await this.#assertAccountOpen(userId);
    await sitePolicy.assertAllowed(this.models, 'withdrawal_mode', 'manual', this.logger);
  }

  /** The account exists and is neither locked nor withdraw-blocked. Answers the row. */
  async #assertAccountOpen(userId) {
    const user = await this.models.Users.findOne({
      where: { id: userId },
      attributes: ['id', 'status', 'system_locked', 'withdraw_locked', 'withdraw_locked_until'],
      raw: true,
    });
    if (!user) throw errors.PLAYER_NOT_FOUND();

    // A lock applied because money was going missing stops the payout too.
    if (user.system_locked || user.status === 'closed') throw errors.ACCOUNT_LOCKED();

    // The operator's withdrawal block (migration 091) — the same refusal every rail gives.
    if (user.withdraw_locked) throw withdrawBlock.errors.BLOCKED({ reason: 'withdraw' });
    // Admin ka Global Withdrawals switch (Users → Financial) — OFF ho to crypto bhi nahi.
    if (!(await withdrawBlock.withdrawalsEnabled(this.models.Users.sequelize))) throw withdrawBlock.errors.DISABLED({ reason: 'global' });
    return user;
  }

  /** The account may withdraw: it exists, is not locked, and is past any cooldown. */
  async #assertMayWithdraw(userId) {
    const user = await this.#assertAccountOpen(userId);

    // The 24-hour freeze after a password change or 2FA removal — migration 040,
    // the same column the fiat rail refuses on.
    const lockedUntil = user.withdraw_locked_until ? new Date(user.withdraw_locked_until) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      throw errors.WITHDRAW_COOLDOWN({ retryAfter: lockedUntil.toISOString() });
    }
  }


  async #namesFor(ids) {
    if (!ids.length) return new Map();
    const rows = await this.models.Users.findAll({
      where: { id: { [Op.in]: [...new Set(ids)] } },
      attributes: ['id', 'name'],
      raw: true,
    });
    return new Map(rows.map((u) => [String(u.id), u.name]));
  }

  #startOfToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }

  /**
   * What a withdrawal looks like on the way out.
   *
   * The destination wallet address is truncated for the player's own view and
   * shown in full only to staff. It is enough to confirm "yes, that is the
   * address I gave" without the response being a convenient place to harvest
   * addresses from if it is ever logged or cached.
   */
  #present(row, { forStaff = false } = {}) {
    return {
      id: row.id,
      userId: row.uid,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      coin: row.coin,
      chain: row.chain ?? null,
      wallet: forStaff ? row.wallet : this.#maskWallet(row.wallet),
      status: row.status,
      txid: row.txid ?? null,
      date: row.date,
      /**
       * `note` IS THE OWNER'S TO READ, and it was staff-only until now.
       *
       * It is the reason a payout was refused, and the person it is about had
       * no route on which it reached them: a player could see `status:
       * "rejected"` and nothing else, while a rejected fiat DEPOSIT explains
       * itself through `adminComment` on its own list. The two halves of the
       * platform handled the same situation opposite ways.
       *
       * `decidedBy` and `decidedAt` stay staff-only. WHO decided and WHEN is
       * internal process; WHY is the answer the player needs to act on, and it
       * is the only one of the three they can do anything with.
       */
      note: row.note ?? null,
      ...(forStaff
        ? { decidedBy: row.decided_by ?? null, decidedAt: row.decided_at ?? null }
        : {}),
    };
  }

  #maskWallet(wallet) {
    const value = String(wallet ?? '');
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
}

module.exports = { CryptoWithdrawService };
