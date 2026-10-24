'use strict';

const crypto = require('node:crypto');

const { money, sitePolicy, withdrawBlock, currencyRegistry, manualPayments } = require('@ibitplay/common');
const { Op } = require('@ibitplay/db');

const errors = require('./fiatWithdraw.errors');
const { WITHDRAW_STATUS, REFUNDING_STATUSES, NEXT_STATUSES } = require('./fiatWithdraw.constants');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { BankAccountsService } = require('../bank-accounts/bankAccounts.service');
const { notifyPlayer } = require('../notifications/notifyPlayer');
const { withdrawalNotice } = require('../notifications/notices');
const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
const { createWithdrawRequirements } = require('../withdraw-requirements/withdrawRequirements');
const { withChannel } = require('../directory/playerScope');

/** Thrown inside the request transaction to roll back a double submit's row. */
class ReplayedRequest extends Error {}

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
    this.bankAccounts = new BankAccountsService(deps);
    this.playerBonuses = deps.playerBonuses ?? new PlayerBonusService({ ...deps, walletService: this.wallet });
    this.minimum = config.WITHDRAW_MINIMUM ?? '1';
    // The owner's `withdrawal_requirements` policy (KYC / wagering), with WITHDRAW_REQUIRE_KYC.
    this.requirements = deps.withdrawRequirements ?? createWithdrawRequirements({ ...deps, playerBonuses: this.playerBonuses });
  }

  /**
   * Request a withdrawal, holding the funds.
   *
   * @legacy POST /createFiatWithdrawal
   */
  async create({ userId, details: input }) {
    const { forfeitBonus = false, ...requested } = input ?? {};
    // Reassigned below when the payout account is a saved one (`bankAccountId`).
    let details = requested;
    await sitePolicy.assertAllowed(this.models, 'withdrawal_mode', 'manual', this.logger);
    // Super Admin ka Manual withdrawal switch (Admin → Transactions → Withdraw → Manual).
    await manualPayments.assertManualAllowed(this.models.Users?.sequelize, 'withdraw');
    // The operator's withdrawal block (migration 091) — WITHDRAW_BLOCKED before anything else.
    await withdrawBlock.assertWithdrawAllowed(this.models, { userId });
    // A switched-off coin is not paid out, as on the crypto rail (CURRENCY_DISABLED).
    await currencyRegistry.assertCurrencyEnabled(details.currency);
    if (money.lt(details.amount, this.minimum)) {
      throw errors.BELOW_MINIMUM({ minimum: this.minimum, amount: details.amount });
    }

    /* THE COOLDOWN IS CHECKED BEFORE KYC, and the order is the point rather than an accident.
       An unverified account inside its window fails both tests, and the two refusals are not
       equally useful: "verify your identity" is a thing the player can go and do, and when they
       come back the cooldown is STILL there. Telling them the temporary blocker first means one
       round trip instead of two, and it is also the cheaper read — a primary-key lookup against
       a scan of `user_kyc`. */
    await this.#assertNotCoolingDown(userId);
    // KYC (FIAT_WITHDRAW_KYC_REQUIRED), wagering (WITHDRAW_WAGER_REQUIRED) and the deposit cap
    // (WITHDRAW_CAP_EXCEEDED), as the owner's policy says. A payout to an unverified identity is
    // what AML rules exist to prevent, so the default policy is `kyc`; legacy checked nothing.
    const applied = await this.requirements.assertMet(userId, {
      forfeitBonus,
      kycError: (kycStatus) => errors.KYC_REQUIRED({ userId, kycStatus }),
      amount: details.amount,
      currency: details.currency,
    });

    // A saved payout account: the details are read from the caller's own row
    // (another player's id answers BANK_ACCOUNTS_NOT_FOUND) and copied onto the
    // withdrawal, so a later delete of the saved account leaves this intact.
    if (details.bankAccountId) {
      const { bankAccountId, ...rest } = details;
      details = { ...rest, ...(await this.bankAccounts.resolveForWithdrawal(userId, bankAccountId)) };
      // The validator's per-currency rule could not see these; apply it here.
      if (details.currency !== 'INR' && (!details.bankName || !details.accountNumber || !details.ifscCode)) {
        throw errors.BANK_DETAILS_REQUIRED({ currency: details.currency });
      }
    }

    // Bonus money is never in the cash wallet, so the debit below can only take cash. A player
    // holding an unwagered bonus must confirm that withdrawing forfeits it (409
    // BONUS_FORFEIT_REQUIRED otherwise) — checked before the transaction so a refusal opens none.
    await this.playerBonuses.beforeWithdrawal(userId, { forfeitBonus });

    // Derived from the request itself — the payout account included — so a
    // double-submitted form within the same minute collapses onto one hold.
    // Hashed to fit credits_ledger.idempotency_key VARCHAR(120).
    const amount = money.toDecimalString(money.toMinor(details.amount));
    const fingerprint = crypto
      .createHash('sha256')
      .update(
        [
          details.currency, amount, details.accountHolderName, details.bankName,
          details.accountNumber, details.ifscCode, details.upiId,
        ].map((v) => String(v ?? '').trim()).join('|')
      )
      .digest('hex')
      .slice(0, 32);
    const idempotencyKey = `fiat-withdraw:${userId}:${fingerprint}:${Math.floor(Date.now() / 60_000)}`;

    try {
      return await this.db.transaction(async (transaction) => {
        /* TWO SUBMITS AT ONCE. The wallet's replay check reads the ledger before it locks the
           balance, so two concurrent requests could both miss it. This lock, keyed on the
           idempotency key and released at commit, makes the second wait for the first; under
           READ COMMITTED its replay check then sees the first hold and it answers with the first
           row. Keyed on the request, not the player, so it is taken before the bonus and wallet
           locks without changing their order. */
        await this.db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
          replacements: { key: idempotencyKey },
          transaction,
        });

        // The deposit cap again, under a per-player lock: two requests at once cannot both fit.
        await this.requirements.assertCapInTransaction(userId, {
          amount: details.amount, currency: details.currency, transaction, applied,
        });

        // Confirmed: the active bonuses are forfeited in this transaction, before the debit (lock
        // order bonuses → wallet, as in the wagering path); a failed debit rolls the forfeit back.
        await this.playerBonuses.beforeWithdrawal(userId, { forfeitBonus, transaction });

        // The row first, so the hold can name it: the refund in `updateStatus`
        // carries the same refType/refId pair.
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
              idempotencyKey,
              refType: 'FIAT_WITHDRAWAL',
              refId: String(row.id),
              description: `Withdrawal #${row.id} requested — funds held`,
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

        /* The hold already exists: this is a double submit. Roll this row back and answer
           with the first one — a second row against one debit is a second refund waiting
           for an admin to reject it. */
        if (movement.replayed) throw new ReplayedRequest();

        this.logger?.info(
          { userId, withdrawalId: row.id, amount: details.amount, currency: details.currency, ledgerId: movement.ledgerId },
          'Fiat withdrawal requested, funds held'
        );

        return { ...this.#present(row.get({ plain: true })), heldLedgerId: movement.ledgerId };
      });
    } catch (error) {
      if (!(error instanceof ReplayedRequest)) throw error;
      return this.#replayedRequest(idempotencyKey, userId);
    }
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
  async listAll({ status, userId, currency, channel, limit, offset }) {
    const result = await this.models.FiatWithdrawals.findAndCountAll({
      where: withChannel({ ...(status ? { status } : {}), ...(userId ? { uid: userId } : {}), ...(currency ? { currency } : {}) }, 'uid', channel),
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
    let player = null;
    const result = await this.db.transaction(async (transaction) => {
      const row = await this.models.FiatWithdrawals.findOne({
        where: { id: withdrawalId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!row) throw errors.NOT_FOUND({ withdrawalId });
      // Approved → Paid is the normal second step; only the final statuses are closed.
      if (!(NEXT_STATUSES[row.status] ?? []).includes(status)) {
        throw errors.ALREADY_PROCESSED({ withdrawalId, status: row.status });
      }

      /* ONE WITHDRAWAL, ONE REFUND. Three things hold it: the row lock above serialises two
         staff deciding at once, Rejected is final so the transition check refuses a second
         rejection, and the refund's idempotency key is the withdrawal id — credits_ledger's
         unique index on that key refuses a second refund row even if the status were reset
         by hand. A replayed refund moved no money, so it is not reported as one. */
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
      player = { userId: row.uid, amount: row.amount, currency: row.currency };

      this.logger?.info(
        { withdrawalId, status, staffId: staff?.id, refundLedgerId: refund?.ledgerId ?? null },
        'Fiat withdrawal status updated'
      );

      return {
        withdrawalId,
        status,
        comment: comment ?? null,
        refunded: Boolean(refund) && !refund.replayed,
        newBalance: refund?.newBalance ?? null,
      };
    });
    void notifyPlayer(player.userId, withdrawalNotice('fiat-withdraw', withdrawalId, status, player, comment));
    return result;
  }

  /**
   * The request a replayed hold belongs to: the hold's ledger row names it.
   * Read after the duplicate's transaction rolled back, so it sees the first
   * request's committed row.
   */
  async #replayedRequest(idempotencyKey, userId) {
    const hold = await this.models.CreditsLedger.findOne({
      where: { idempotency_key: idempotencyKey },
      attributes: ['id', 'meta'],
      raw: true,
    });
    const row = hold?.meta?.refId
      ? await this.models.FiatWithdrawals.findOne({ where: { id: hold.meta.refId, uid: userId }, raw: true })
      : null;
    if (!row) throw errors.NOT_FOUND({ idempotencyKey });
    this.logger?.info({ userId, withdrawalId: row.id, ledgerId: hold.id }, 'Fiat withdrawal double submit, first request returned');
    return { ...this.#present(row), heldLedgerId: hold.id };
  }


  /**
   * The 24-hour freeze after a password change — migration 040, written by
   * `AuthService.changePassword`.
   *
   * NOT policy-gated, unlike the KYC check. That one is a
   * configurable compliance control; this one is the platform telling a player
   * something it then has to honour, and an operator switch over it would put
   * the dialog's promise back to being a lie on some deployments.
   *
   * A past timestamp is simply not a lock, which is why nothing has to sweep
   * the column — see the migration's own note.
   */
  async #assertNotCoolingDown(userId) {
    const row = await this.models.Users.findByPk(userId, {
      attributes: ['withdraw_locked_until'],
      raw: true,
    });

    const until = row?.withdraw_locked_until ? new Date(row.withdraw_locked_until) : null;
    if (until && until.getTime() > Date.now()) {
      throw errors.WITHDRAW_COOLDOWN({ retryAfter: until.toISOString() });
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
