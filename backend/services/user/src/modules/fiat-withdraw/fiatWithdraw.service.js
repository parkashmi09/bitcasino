'use strict';

const { money } = require('@ibitplay/common');
const { Op } = require('@ibitplay/db');

const errors = require('./fiatWithdraw.errors');
const { WITHDRAW_STATUS, REFUNDING_STATUSES } = require('./fiatWithdraw.constants');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');

/**
 * Fiat withdrawals.
 *
 * The money leaves the wallet when the request is CREATED, not when it is paid.
 * That is deliberate and matches legacy: funds a player has asked to withdraw
 * must not also be available to bet with while the request sits in the queue.
 * A rejected request refunds them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `legacy/fiatwithdraw/controller.js` carried the same SQL injection as the
 * swap controller:
 *
 *   const currencyLower = currency.toLowerCase();
 *   const balanceQuery = `SELECT ${currencyLower} FROM credits WHERE uid = $1`;
 *   const updateQuery  = `UPDATE credits SET ${currencyLower} = ${currencyLower} - $1 ...`;
 *
 * `currency` came from `req.body`, unvalidated, on an unauthenticated route.
 * This is the second of the two injection sites into the balance table.
 *
 * It also read the balance, compared it in JavaScript (`currentBalance < amount`
 * — a float comparison against a NUMERIC read as a string), and then wrote. Two
 * concurrent withdrawal requests could both pass that check.
 * ─────────────────────────────────────────────────────────────────────────
 */
class FiatWithdrawService {
  constructor(deps) {
    const { models, db, config, logger } = deps;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = new WalletService(deps);
    this.minimum = config.WITHDRAW_MINIMUM ?? '1';
    this.requireKyc = config.WITHDRAW_REQUIRE_KYC !== false;
  }

  /**
   * Request a withdrawal, holding the funds.
   *
   * @legacy POST /createFiatWithdrawal
   */
  async create({ userId, details }) {
    if (money.lt(details.amount, this.minimum)) {
      throw errors.BELOW_MINIMUM({ minimum: this.minimum, amount: details.amount });
    }

    if (this.requireKyc) await this.#assertVerified(userId);

    return this.db.transaction(async (transaction) => {
      // The debit takes the row lock and carries its own `>= amount` guard, so
      // two concurrent requests cannot both pass. It also writes the ledger row,
      // which legacy's raw UPDATE did not.
      let movement;
      try {
        movement = await this.wallet.debit(
          {
            userId,
            currency: details.currency,
            amount: details.amount,
            reason: REASON.WITHDRAWAL,
            // Derived from the request itself, so a double-submitted form
            // within the same minute collapses onto one hold.
            idempotencyKey: `fiat-withdraw:${userId}:${details.currency}:${details.amount}:${Math.floor(Date.now() / 60_000)}`,
            refType: 'FIAT_WITHDRAWAL',
            refId: String(userId),
            description: 'Fiat withdrawal requested',
          },
          { sourceService: 'user-service', transaction }
        );
      } catch (error) {
        if (error.code === 'WALLET_INSUFFICIENT_FUNDS') {
          throw errors.INSUFFICIENT_BALANCE({
            currency: details.currency,
            requested: details.amount,
            available: error.details?.available,
          });
        }
        throw error;
      }

      const row = await this.models.FiatWithdrawals.create(
        {
          uid: userId,
          amount: details.amount,
          currency: details.currency,
          bank_name: details.bankName ?? null,
          account_number: details.accountNumber ?? null,
          account_holder_name: details.accountHolderName,
          ifsc_code: details.ifscCode ?? null,
          upi_id: details.upiId ?? null,
          status: WITHDRAW_STATUS.IN_QUEUE,
          date: new Date(),
        },
        { transaction }
      );

      this.logger?.info(
        { userId, withdrawalId: row.id, amount: details.amount, currency: details.currency, ledgerId: movement.ledgerId },
        'Fiat withdrawal requested, funds held'
      );

      return { ...this.#present(row.get({ plain: true })), heldLedgerId: movement.ledgerId };
    });
  }

  /** A player's own withdrawal requests. */
  async listForUser({ userId, status, limit, offset }) {
    const result = await this.models.FiatWithdrawals.findAndCountAll({
      where: { uid: userId, ...(status ? { status } : {}) },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { count: result.count, rows: result.rows.map((r) => this.#present(r)) };
  }

  /** @legacy GET /getFiatWithdrawData */
  async listAll({ status, userId, limit, offset }) {
    const result = await this.models.FiatWithdrawals.findAndCountAll({
      where: { ...(status ? { status } : {}), ...(userId ? { uid: userId } : {}) },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const ids = [...new Set(result.rows.map((r) => String(r.uid)))];
    const users = ids.length
      ? await this.models.Users.findAll({
          attributes: ['id', 'name'],
          where: { id: { [Op.in]: ids } },
          raw: true,
        })
      : [];
    const names = new Map(users.map((u) => [String(u.id), u.name]));

    return {
      count: result.count,
      rows: result.rows.map((r) => ({
        ...this.#present(r, { forStaff: true }),
        username: names.get(String(r.uid)) || r.name || String(r.uid),
      })),
    };
  }

  /**
   * Move a request through the queue.
   *
   * @legacy POST /updateFiatWithdrawStatus
   *
   * Rejecting refunds the held funds. Legacy changed the status and did not —
   * so a rejected withdrawal left the player's money debited with nothing paid
   * out and nothing returned.
   */
  async updateStatus({ withdrawalId, status, comment }, staff) {
    return this.db.transaction(async (transaction) => {
      const row = await this.models.FiatWithdrawals.findOne({
        where: { id: withdrawalId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!row) throw errors.NOT_FOUND({ withdrawalId });
      if (row.status !== WITHDRAW_STATUS.IN_QUEUE) {
        throw errors.ALREADY_PROCESSED({ withdrawalId, status: row.status });
      }

      let refund = null;
      if (REFUNDING_STATUSES.includes(status)) {
        refund = await this.wallet.credit(
          {
            userId: row.uid,
            currency: row.currency,
            amount: money.toDecimalString(money.toMinor(row.amount)),
            reason: REASON.WITHDRAWAL_REVERSAL,
            idempotencyKey: `fiat-withdraw-refund:${withdrawalId}`,
            refType: 'FIAT_WITHDRAWAL',
            refId: String(withdrawalId),
            description: `Withdrawal #${withdrawalId} rejected — funds returned`,
          },
          { sourceService: 'user-service', transaction }
        );
      }

      await row.update({ status }, { transaction });

      this.logger?.info(
        { withdrawalId, status, staffId: staff?.id, refundLedgerId: refund?.ledgerId ?? null },
        'Fiat withdrawal status updated'
      );

      return {
        withdrawalId,
        status,
        comment: comment ?? null,
        refunded: Boolean(refund),
        newBalance: refund?.newBalance ?? null,
      };
    });
  }

  /**
   * A payout must go to a verified identity.
   *
   * This is a compliance control, not a product decision: paying out to an
   * unverified account is what money-laundering rules exist to prevent, and
   * legacy performed no check at all.
   */
  async #assertVerified(userId) {
    const kyc = await this.models.UserKyc.findOne({
      // user_kyc.user_id is VARCHAR(50) in the legacy schema, not an integer —
      // comparing it against a number is a Postgres type error, not a miss.
      where: { user_id: String(userId) },
      order: [['id', 'DESC']],
      attributes: ['status'],
      raw: true,
    });

    if (kyc?.status !== 'Verified') {
      throw errors.KYC_REQUIRED({ userId, kycStatus: kyc?.status ?? 'NotSubmitted' });
    }
  }

  #present(row, { forStaff = false } = {}) {
    return {
      withdrawalId: row.id,
      userId: row.uid,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      currency: row.currency,
      accountHolderName: row.account_holder_name,
      bankName: row.bank_name,
      upiId: row.upi_id,
      status: row.status,
      requestedAt: row.date,
      ...(forStaff ? { accountNumber: row.account_number, ifscCode: row.ifsc_code } : {}),
    };
  }
}

module.exports = { FiatWithdrawService };
