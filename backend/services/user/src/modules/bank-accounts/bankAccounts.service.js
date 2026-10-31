'use strict';

const errors = require('./bankAccounts.errors');

/** One account cannot fill the table. A player has a handful, not dozens. */
const MAX_ACCOUNTS = 10;

/**
 * A player's saved payout accounts.
 *
 * Every method takes the id from the CALLER — the controller passes
 * `req.user.id` — and every query carries `user_id`, so another player's row
 * answers exactly like a missing one.
 *
 * ── THE FULL ACCOUNT NUMBER NEVER LEAVES THIS SERVICE ────────────────────
 *
 * Lists show the last four digits. The withdraw form does not need the full
 * number either: it sends `bankAccountId` and `resolveForWithdrawal` copies the
 * details server-side. A stolen session can therefore see that an account
 * exists, but cannot read the number back out of it.
 */
class BankAccountsService {
  constructor({ models, db, logger }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
  }

  /** The default first, then newest. */
  async list(userId) {
    const rows = await this.models.UserBankAccount.findAll({
      where: { user_id: userId },
      order: [['is_default', 'DESC'], ['created_at', 'DESC'], ['id', 'DESC']],
      raw: true,
    });
    return rows.map((r) => present(r));
  }

  /**
   * Save one. The player's first account becomes the default by itself, so a
   * player with accounts always has one pre-picked on the withdraw form.
   */
  async add(userId, body) {
    const count = await this.models.UserBankAccount.count({ where: { user_id: userId } });
    if (count >= MAX_ACCOUNTS) throw errors.TOO_MANY({ max: MAX_ACCOUNTS });

    const makeDefault = count === 0 || body.makeDefault === true;
    const now = new Date();
    const values = {
      user_id: userId,
      method: body.method,
      account_holder_name: body.accountHolderName,
      bank_name: body.method === 'bank' ? body.bankName || null : null,
      account_number: body.method === 'bank' ? body.accountNumber : null,
      ifsc_code: body.method === 'bank' ? body.ifscCode : null,
      upi_id: body.method === 'upi' ? body.upiId : null,
      is_default: makeDefault,
      created_at: now,
      updated_at: now,
    };

    try {
      const row = await this.db.transaction(async (transaction) => {
        if (makeDefault) await this.#clearDefault(userId, transaction);
        return this.models.UserBankAccount.create(values, { transaction });
      });
      this.logger?.info(
        { userId: String(userId), accountId: String(row.id), method: body.method },
        'Payout account saved'
      );
      return present(row.get({ plain: true }));
    } catch (error) {
      /* The unique indexes are the guarantee; checked on the error rather than
         with a read-then-insert, which two simultaneous saves would both pass. */
      if (error?.name === 'SequelizeUniqueConstraintError') {
        // `one_default` can only collide under a concurrent set-default; the
        // others are a genuine duplicate.
        const index = error?.parent?.constraint || error?.original?.constraint;
        if (index !== 'user_bank_accounts_one_default') throw errors.ALREADY_SAVED({ method: body.method });
      }
      throw error;
    }
  }

  /** Make one the default. Clearing the old one and setting the new one is one transaction. */
  async setDefault(userId, id) {
    await this.db.transaction(async (transaction) => {
      const row = await this.models.UserBankAccount.findOne({
        where: { id, user_id: userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!row) throw errors.NOT_FOUND({ id: String(id) });
      if (row.is_default) return;
      await this.#clearDefault(userId, transaction);
      await row.update({ is_default: true, updated_at: new Date() }, { transaction });
    });
    return this.list(userId);
  }

  /**
   * Delete one. Deleting the default promotes the newest remaining account, so
   * "has accounts but none pre-picked" never happens.
   *
   * A hard delete: past withdrawals copied the details into their own row when
   * they were made, so nothing references this one.
   */
  async remove(userId, id) {
    await this.db.transaction(async (transaction) => {
      const row = await this.models.UserBankAccount.findOne({
        where: { id, user_id: userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!row) throw errors.NOT_FOUND({ id: String(id) });
      const wasDefault = row.is_default;
      await row.destroy({ transaction });

      if (wasDefault) {
        const next = await this.models.UserBankAccount.findOne({
          where: { user_id: userId },
          order: [['created_at', 'DESC'], ['id', 'DESC']],
          transaction,
        });
        if (next) await next.update({ is_default: true, updated_at: new Date() }, { transaction });
      }
    });
    this.logger?.info({ userId: String(userId), accountId: String(id) }, 'Payout account removed');
    return this.list(userId);
  }

  /**
   * The full details of one saved account, for the withdraw rail to copy onto
   * the withdrawal row. The one method meant for another module.
   */
  async resolveForWithdrawal(userId, id) {
    const row = await this.models.UserBankAccount.findOne({ where: { id, user_id: userId }, raw: true });
    if (!row) throw errors.NOT_FOUND({ id: String(id) });
    return {
      accountHolderName: row.account_holder_name,
      ...(row.method === 'bank'
        ? {
            accountNumber: row.account_number,
            ifscCode: row.ifsc_code,
            ...(row.bank_name ? { bankName: row.bank_name } : {}),
          }
        : { upiId: row.upi_id }),
    };
  }

  async #clearDefault(userId, transaction) {
    await this.models.UserBankAccount.update(
      { is_default: false, updated_at: new Date() },
      { where: { user_id: userId, is_default: true }, transaction }
    );
  }
}

/** "••••1234" — the last four digits, and nothing about the length. */
function maskAccountNumber(number) {
  if (!number) return null;
  return `••••${String(number).slice(-4)}`;
}

function present(row) {
  return {
    id: String(row.id),
    method: row.method,
    accountHolderName: row.account_holder_name,
    bankName: row.bank_name,
    accountNumberMasked: maskAccountNumber(row.account_number),
    ifscCode: row.ifsc_code,
    upiId: row.upi_id,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
  };
}

module.exports = { BankAccountsService, MAX_ACCOUNTS, maskAccountNumber };
