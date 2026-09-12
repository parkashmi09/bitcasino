'use strict';

const { money } = require('@ibitplay/common');
const { Op, fn, col } = require('@ibitplay/db');

const errors = require('./vault.errors');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');

/**
 * Vault Pro — fixed-term, interest-bearing deposits.
 *
 * A player moves funds out of their spendable balance into a vault deposit for
 * a fixed term at a fixed rate. The funds are unavailable until maturity, then
 * withdrawable back to the wallet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this replaces
 *
 * `legacy/vaultpro/controller.js` carried the THIRD SQL injection into the
 * balance table:
 *
 *   `SELECT ${coin} FROM credits WHERE uid=$1`
 *   `UPDATE credits SET ${coin} = ${coin} + $1 WHERE uid = $2`
 *
 * with `coin` taken from `req.body` on an unauthenticated route — the same
 * shape as the swap and fiat-withdraw controllers. Here the currency goes
 * through the allow-list in `wallet.constants.resolveColumn` and the uid comes
 * from the token.
 *
 * It also compared money as JavaScript numbers (`if (amount <= 0)` against a
 * NUMERIC read as a string) and moved balances with raw UPDATEs that wrote no
 * ledger row — so a vault transfer left no trace in the player's statement.
 * Every movement here goes through `WalletService`.
 * ─────────────────────────────────────────────────────────────────────────
 */
class VaultService {
  constructor(deps) {
    const { models, db, config, logger } = deps;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = new WalletService(deps);
    this.minimum = config.VAULT_MINIMUM ?? '1';
  }

  /** @legacy GET /vaultpro/lock-options */
  async listLockOptions() {
    const rows = await this.models.VaultLockRate.findAll({
      where: { is_active: true },
      order: [['days', 'ASC']],
      raw: true,
    });

    return rows.map((r) => ({
      value: r.lock_period,
      label: r.label,
      days: r.days,
      rate: String(r.rate),
    }));
  }

  /**
   * Move funds from the wallet into a new vault deposit.
   *
   * @legacy POST /vaultpro/transfer-in
   */
  async transferIn({ userId, coin, amount, lockPeriod }) {
    if (money.lt(amount, this.minimum)) {
      throw errors.BELOW_MINIMUM({ minimum: this.minimum, amount });
    }

    const term = await this.models.VaultLockRate.findOne({
      where: { lock_period: lockPeriod, is_active: true },
      raw: true,
    });
    if (!term) throw errors.LOCK_PERIOD_NOT_FOUND({ lockPeriod });

    return this.db.transaction(async (transaction) => {
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + term.days * 24 * 3600 * 1000);

      // The debit takes the row lock, guards at >= amount, and writes the
      // ledger row that legacy's raw UPDATE omitted.
      let movement;
      try {
        movement = await this.wallet.debit(
          {
            userId,
            currency: coin,
            amount,
            reason: REASON.TRANSFER_OUT,
            idempotencyKey: `vault-in:${userId}:${coin}:${amount}:${Math.floor(Date.now() / 60_000)}`,
            refType: 'VAULT',
            refId: lockPeriod,
            description: `Vault deposit — ${term.label}`,
          },
          { sourceService: 'user-service', transaction }
        );
      } catch (error) {
        if (error.code === 'WALLET_INSUFFICIENT_FUNDS') {
          throw errors.INSUFFICIENT_BALANCE({ coin, requested: amount, available: error.details?.available });
        }
        throw error;
      }

      const deposit = await this.models.VaultPro.create(
        {
          userid: userId,
          coin,
          vaultBalance: amount,
          lock_period: lockPeriod,
          interest_rate: term.rate,
          startTime,
          endTime,
          status: 'active',
          incomeDate: startTime,
        },
        { transaction }
      );

      await this.models.VaultTransaction.create(
        { userid: userId, coin, amount, type: 'transfer_in', deposit_id: deposit.id },
        { transaction }
      );

      this.logger?.info(
        { userId, depositId: deposit.id, coin, amount, lockPeriod, ledgerId: movement.ledgerId },
        'Vault deposit opened'
      );

      return {
        depositId: deposit.id,
        coin,
        amount: money.toDecimalString(money.toMinor(amount)),
        lockPeriod,
        interestRate: String(term.rate),
        startTime,
        endTime,
        days: term.days,
      };
    });
  }

  /**
   * Withdraw a matured deposit back to the wallet.
   *
   * @legacy POST /vaultpro/transfer-out
   */
  async transferOut({ userId, depositId, coin }) {
    return this.db.transaction(async (transaction) => {
      const deposit = await this.models.VaultPro.findOne({
        where: { id: depositId, userid: userId, coin },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!deposit) throw errors.DEPOSIT_NOT_FOUND({ depositId });
      if (deposit.status === 'withdrawn') throw errors.ALREADY_WITHDRAWN({ depositId });

      const remaining = this.#timeRemaining(deposit.endTime);
      if (remaining.locked) {
        throw errors.STILL_LOCKED({ depositId, endTime: deposit.endTime, ...remaining });
      }

      const amount = money.toDecimalString(money.toMinor(deposit.vaultBalance ?? '0'));
      if (money.lte(amount, '0')) throw errors.NOTHING_TO_WITHDRAW({ depositId });

      await deposit.update({ vaultBalance: 0, status: 'withdrawn' }, { transaction });

      const movement = await this.wallet.credit(
        {
          userId,
          currency: coin,
          amount,
          reason: REASON.TRANSFER_IN,
          // Derived from the deposit, so a double-click returns the original
          // movement instead of paying the principal out twice.
          idempotencyKey: `vault-out:${depositId}`,
          refType: 'VAULT',
          refId: String(depositId),
          description: `Vault withdrawal — deposit #${depositId}`,
        },
        { sourceService: 'user-service', transaction }
      );

      await this.models.VaultTransaction.create(
        { userid: userId, coin, amount, type: 'transfer_out', deposit_id: depositId },
        { transaction }
      );

      this.logger?.info({ userId, depositId, coin, amount }, 'Vault deposit withdrawn');

      return { depositId, coin, amount, newBalance: movement.newBalance };
    });
  }

  /** @legacy POST /vaultpro/vault-data */
  async getVaultData({ userId, coin }) {
    const deposits = await this.models.VaultPro.findAll({
      where: { userid: userId, ...(coin ? { coin } : {}), status: { [Op.ne]: 'withdrawn' } },
      order: [['id', 'DESC']],
      raw: true,
    });

    const totals = {};
    for (const d of deposits) {
      const current = totals[d.coin] ?? 0n;
      totals[d.coin] = current + money.toMinor(d.vaultBalance ?? '0');
    }

    return {
      totals: Object.fromEntries(
        Object.entries(totals).map(([c, v]) => [c, money.toDecimalString(v)])
      ),
      deposits: deposits.map((d) => ({
        depositId: d.id,
        coin: d.coin,
        balance: money.toDecimalString(money.toMinor(d.vaultBalance ?? '0')),
        lockPeriod: d.lock_period,
        interestRate: d.interest_rate != null ? String(d.interest_rate) : null,
        startTime: d.startTime,
        endTime: d.endTime,
        status: d.status,
        ...this.#timeRemaining(d.endTime),
      })),
    };
  }

  /** @legacy POST /vaultpro/history */
  async listInterest({ userId, limit, offset }) {
    return this.models.VaultInterestHistory.findAndCountAll({
      where: { userid: userId },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  /** @legacy POST /vaultpro/transactions */
  async listTransactions({ userId, limit, offset }) {
    return this.models.VaultTransaction.findAndCountAll({
      where: { userid: userId },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  // ══ Staff ═══════════════════════════════════════════════════════════

  /** @legacy POST /vaultpro/admin/add-lock-period */
  async addLockPeriod({ lockPeriod, label, days, rate }) {
    const existing = await this.models.VaultLockRate.findOne({ where: { lock_period: lockPeriod }, raw: true });
    if (existing) throw errors.LOCK_PERIOD_EXISTS({ lockPeriod });

    const row = await this.models.VaultLockRate.create({
      lock_period: lockPeriod, label, days, rate, is_active: true,
    });

    this.logger?.info({ lockPeriod, days, rate }, 'Vault lock period added');
    return { lockPeriod, label, days, rate: String(row.rate) };
  }

  /** @legacy POST /vaultpro/admin/update-interest */
  async updateRate({ lockPeriod, rate }) {
    const row = await this.models.VaultLockRate.findOne({ where: { lock_period: lockPeriod } });
    if (!row) throw errors.LOCK_PERIOD_NOT_FOUND({ lockPeriod });

    const previous = String(row.rate);
    await row.update({ rate });

    // A rate change applies to NEW deposits only. Open deposits keep the rate
    // they were opened at — it is stored on the deposit row, not looked up.
    this.logger?.info({ lockPeriod, previous, rate }, 'Vault rate updated (applies to new deposits)');
    return { lockPeriod, rate, previousRate: previous, appliesTo: 'new deposits only' };
  }

  /** @legacy POST /vaultpro/admin/delete-lock-period */
  async deleteLockPeriod({ lockPeriod }) {
    const row = await this.models.VaultLockRate.findOne({ where: { lock_period: lockPeriod } });
    if (!row) throw errors.LOCK_PERIOD_NOT_FOUND({ lockPeriod });

    const open = await this.models.VaultPro.count({
      where: { lock_period: lockPeriod, status: { [Op.ne]: 'withdrawn' } },
    });
    if (open > 0) throw errors.LOCK_PERIOD_IN_USE({ lockPeriod, openDeposits: open });

    // Deactivated, not deleted: a withdrawn deposit still references it, and a
    // statement that cannot name its own term is not much of a statement.
    await row.update({ is_active: false });

    this.logger?.warn({ lockPeriod, label: row.label }, 'Vault lock period deactivated');
    return { lockPeriod, label: row.label, deactivated: true };
  }

  /** @legacy GET /vaultpro/admin/vault/users */
  async listVaultUsers({ limit, offset }) {
    return this.models.VaultPro.findAndCountAll({
      where: { status: { [Op.ne]: 'withdrawn' } },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  /** @legacy GET /vaultpro/admin/vault/stats */
  async stats() {
    const [totals, todayRows] = await Promise.all([
      this.models.VaultPro.findAll({
        attributes: [
          'coin',
          [fn('COUNT', fn('DISTINCT', col('userid'))), 'total_users'],
          [fn('COALESCE', fn('SUM', col('vaultBalance')), 0), 'total_balance'],
        ],
        where: { status: { [Op.ne]: 'withdrawn' } },
        group: ['coin'],
        raw: true,
      }),
      // Half-open range rather than `DATE("createdAt") = CURRENT_DATE`: the
      // function form cannot use an index, and casting timestamptz to date is
      // not immutable anyway — see migration 010.
      this.models.VaultInterestHistory.findAll({
        attributes: ['coin', [fn('COALESCE', fn('SUM', col('interest')), 0), 'today_interest']],
        where: { createdAt: { [Op.gte]: startOfToday(), [Op.lt]: startOfTomorrow() } },
        group: ['coin'],
        raw: true,
      }),
    ]);

    const todayByCoin = new Map(todayRows.map((r) => [r.coin, r.today_interest]));

    return totals.map((r) => ({
      coin: r.coin,
      totalUsers: Number.parseInt(r.total_users, 10) || 0,
      totalBalance: money.toDecimalString(money.toMinor(r.total_balance ?? '0')),
      todayInterest: money.toDecimalString(money.toMinor(todayByCoin.get(r.coin) ?? '0')),
    }));
  }

  /** @legacy GET /vaultpro/admin/vault/interest-history */
  async listAllInterest({ limit, offset }) {
    return this.models.VaultInterestHistory.findAndCountAll({
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  /** Whether a deposit is still locked, and by how long. */
  #timeRemaining(endTime) {
    if (!endTime) return { locked: false, msRemaining: 0, daysRemaining: 0 };

    const ms = new Date(endTime).getTime() - Date.now();
    if (ms <= 0) return { locked: false, msRemaining: 0, daysRemaining: 0 };

    return {
      locked: true,
      msRemaining: ms,
      daysRemaining: Math.ceil(ms / (24 * 3600 * 1000)),
    };
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfTomorrow() {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

module.exports = { VaultService };
