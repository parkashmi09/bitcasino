'use strict';

const { money, currencyRegistry } = require('@ibitplay/common');
const { Op, fn, col } = require('@ibitplay/db');

const errors = require('./vault.errors');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { ownerWhere, withChannel } = require('../directory/playerScope');

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
    const { models, db, config, logger, clients } = deps;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.clients = clients;
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
      earlyPenaltyRate: String(r.early_penalty_rate ?? '0'),
    }));
  }

  /**
   * Move funds from the wallet into a new vault deposit.
   *
   * @legacy POST /vaultpro/transfer-in
   */
  async transferIn({ userId, coin, amount, lockPeriod }) {
    // A coin the owner or the site switched off takes no new vault deposits
    // (CURRENCY_DISABLED); one already locked still matures and comes out.
    await currencyRegistry.assertCurrencyEnabled(coin);
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
          principal: amount,
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
  async transferOut({ userId, depositId, coin, early = false }) {
    return this.db.transaction(async (transaction) => {
      const deposit = await this.models.VaultPro.findOne({
        where: { id: depositId, userid: userId, coin },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!deposit) throw errors.DEPOSIT_NOT_FOUND({ depositId });
      if (deposit.status === 'withdrawn') throw errors.ALREADY_WITHDRAWN({ depositId });

      const remaining = this.#timeRemaining(deposit.endTime);
      const balance = money.toDecimalString(money.toMinor(deposit.vaultBalance ?? '0'));
      if (money.lte(balance, '0')) throw errors.NOTHING_TO_WITHDRAW({ depositId });

      let amount;
      let txType = 'transfer_out';
      let idempotencyKey = `vault-out:${depositId}`;
      let description = `Vault withdrawal — deposit #${depositId}`;
      let penalty;
      let forfeitedInterest;

      if (early) {
        if (!remaining.locked) {
          throw errors.EARLY_WITHDRAWAL_FORBIDDEN({ depositId });
        }

        const term = await this.models.VaultLockRate.findOne({
          where: { lock_period: deposit.lock_period },
          raw: true,
          transaction,
        });

        const quote = this.#earlyWithdrawalQuote(deposit, term, balance);
        if (!quote || money.lte(quote.credit, '0')) {
          throw errors.NOTHING_TO_WITHDRAW({ depositId });
        }

        amount = quote.credit;
        penalty = quote.penalty;
        forfeitedInterest = quote.forfeitedInterest;
        txType = 'transfer_out_early';
        idempotencyKey = `vault-out-early:${depositId}`;
        description = `Vault early withdrawal — deposit #${depositId}`;
      } else {
        if (remaining.locked) {
          throw errors.STILL_LOCKED({ depositId, endTime: deposit.endTime, ...remaining });
        }
        amount = balance;
      }

      await deposit.update({ vaultBalance: 0, status: 'withdrawn' }, { transaction });

      const movement = await this.wallet.credit(
        {
          userId,
          currency: coin,
          amount,
          reason: REASON.TRANSFER_IN,
          idempotencyKey,
          refType: 'VAULT',
          refId: String(depositId),
          description,
        },
        { sourceService: 'user-service', transaction }
      );

      await this.models.VaultTransaction.create(
        { userid: userId, coin, amount, type: txType, deposit_id: depositId },
        { transaction }
      );

      this.logger?.info(
        { userId, depositId, coin, amount, early, penalty, forfeitedInterest },
        early ? 'Vault deposit withdrawn early' : 'Vault deposit withdrawn'
      );

      return {
        depositId,
        coin,
        amount,
        early,
        penalty,
        forfeitedInterest,
        newBalance: movement.newBalance,
      };
    });
  }

  /** @legacy POST /vaultpro/vault-data */
  async getVaultData({ userId, coin }) {
    const normalizedCoin = coin ? String(coin).trim().toUpperCase() : null;
    const rows = await this.models.VaultPro.findAll({
      where: {
        userid: userId,
        [Op.or]: [{ status: { [Op.ne]: 'withdrawn' } }, { status: { [Op.is]: null } }],
      },
      order: [['id', 'DESC']],
      raw: true,
    });

    const deposits = normalizedCoin
      ? rows.filter((d) => String(d.coin ?? '').toUpperCase() === normalizedCoin)
      : rows;

    const terms = await this.models.VaultLockRate.findAll({ raw: true });
    const termByKey = new Map(terms.map((t) => [t.lock_period, t]));

    const totals = {};
    for (const d of deposits) {
      const current = totals[d.coin] ?? 0n;
      totals[d.coin] = current + money.toMinor(d.vaultBalance ?? '0');
    }

    return {
      totals: Object.fromEntries(
        Object.entries(totals).map(([c, v]) => [c, money.toDecimalString(v)])
      ),
      deposits: deposits.map((d) => {
        const balance = money.toDecimalString(money.toMinor(d.vaultBalance ?? '0'));
        const principal = money.toDecimalString(
          money.toMinor(d.principal ?? d.vaultBalance ?? '0')
        );
        const term = termByKey.get(d.lock_period);
        const timing = this.#timeRemaining(d.endTime);
        const earlyQuote = timing.locked ? this.#earlyWithdrawalQuote(d, term, balance) : null;

        return {
          depositId: d.id ?? d.depositId,
          coin: d.coin ? String(d.coin).toUpperCase() : d.coin,
          balance,
          principal,
          lockPeriod: d.lock_period,
          interestRate: d.interest_rate != null ? String(d.interest_rate) : null,
          earlyPenaltyRate: term ? String(term.early_penalty_rate ?? '0') : '0',
          earlyPayout: earlyQuote?.credit ?? null,
          earlyPenalty: earlyQuote?.penalty ?? null,
          forfeitedInterest: earlyQuote?.forfeitedInterest ?? null,
          startTime: d.startTime,
          endTime: d.endTime,
          status: d.status,
          ...timing,
        };
      }),
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
  async addLockPeriod({ lockPeriod, label, days, rate, earlyPenaltyRate }) {
    const existing = await this.models.VaultLockRate.findOne({ where: { lock_period: lockPeriod }, raw: true });
    if (existing) throw errors.LOCK_PERIOD_EXISTS({ lockPeriod });

    const row = await this.models.VaultLockRate.create({
      lock_period: lockPeriod,
      label,
      days,
      rate,
      is_active: true,
      early_penalty_rate: earlyPenaltyRate ?? '0',
    });

    this.logger?.info({ lockPeriod, days, rate }, 'Vault lock period added');
    return {
      lockPeriod,
      label,
      days,
      rate: String(row.rate),
      earlyPenaltyRate: String(row.early_penalty_rate ?? '0'),
    };
  }

  /** @legacy POST /vaultpro/admin/update-interest */
  async updateRate({ lockPeriod, rate, earlyPenaltyRate }) {
    const row = await this.models.VaultLockRate.findOne({ where: { lock_period: lockPeriod } });
    if (!row) throw errors.LOCK_PERIOD_NOT_FOUND({ lockPeriod });

    const patch = {};
    if (rate !== undefined) patch.rate = rate;
    if (earlyPenaltyRate !== undefined) patch.early_penalty_rate = earlyPenaltyRate;

    const previous = String(row.rate);
    await row.update(patch);

    this.logger?.info({ lockPeriod, patch }, 'Vault lock period updated');
    return {
      lockPeriod,
      rate: rate !== undefined ? rate : String(row.rate),
      previousRate: rate !== undefined ? previous : undefined,
      earlyPenaltyRate:
        earlyPenaltyRate !== undefined ? earlyPenaltyRate : String(row.early_penalty_rate ?? '0'),
      appliesTo: rate !== undefined ? 'new deposits only (interest rate)' : 'early exit deduction',
    };
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

  /*
   * The three staff reads below cover the caller's tree only. They were
   * site-wide — every player's vault balance — to anyone with `reports:read`.
   */

  /** @legacy GET /vaultpro/admin/vault/users */
  async listVaultUsers({ staff, channel, limit, offset }) {
    const result = await this.models.VaultPro.findAndCountAll({
      where: withChannel({ status: { [Op.ne]: 'withdrawn' }, ...(await ownerWhere(this, staff?.id, 'userid')) }, 'userid', channel),
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#userNames(result.rows.map((r) => r.userid));
    return {
      count: result.count,
      rows: result.rows.map((row) => this.#presentAdminDeposit(row, names.get(row.userid))),
    };
  }

  /** @legacy GET /vaultpro/admin/vault/stats */
  async stats({ staff } = {}) {
    const dayStart = startOfToday();
    const dayEnd = startOfTomorrow();
    const mine = await ownerWhere(this, staff?.id, 'userid');

    const [userRow, balanceRows, interestRows] = await Promise.all([
      this.models.VaultPro.findAll({
        attributes: [[fn('COUNT', fn('DISTINCT', col('userid'))), 'total_users']],
        where: { status: { [Op.ne]: 'withdrawn' }, ...mine },
        raw: true,
      }),
      this.models.VaultPro.findAll({
        attributes: ['coin', [fn('COALESCE', fn('SUM', col('vaultBalance')), 0), 'total_balance']],
        where: { status: { [Op.ne]: 'withdrawn' }, ...mine },
        group: ['coin'],
        raw: true,
      }),
      this.models.VaultInterestHistory.findAll({
        attributes: [[fn('COALESCE', fn('SUM', col('interest')), 0), 'today_interest']],
        where: { createdAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd }, ...mine },
        raw: true,
      }),
    ]);

    const userCountRaw = userRow[0]?.total_users ?? userRow[0]?.totalUsers;
    const totalUsers = Number.parseInt(String(userCountRaw ?? 0), 10) || 0;

    let totalBalanceMinor = 0n;
    for (const row of balanceRows) {
      totalBalanceMinor += money.toMinor(String(row.total_balance ?? '0'));
    }

    const interestRaw = interestRows[0]?.today_interest ?? interestRows[0]?.todayInterest ?? '0';
    const todayInterestMinor = money.toMinor(String(interestRaw));

    const byCoin = balanceRows.map((r) => ({
      coin: r.coin,
      totalBalance: money.toDecimalString(money.toMinor(String(r.total_balance ?? '0'))),
    }));

    const totalBalance = parseFloat(money.toDecimalString(totalBalanceMinor));
    const todayInterest = parseFloat(money.toDecimalString(todayInterestMinor));

    return {
      totalUsers,
      totalBalance: Number.isFinite(totalBalance) ? totalBalance : 0,
      todayInterest: Number.isFinite(todayInterest) ? todayInterest : 0,
      byCoin,
    };
  }

  /** @legacy GET /vaultpro/admin/vault/interest-history */
  async listAllInterest({ staff, channel, limit, offset }) {
    const result = await this.models.VaultInterestHistory.findAndCountAll({
      where: withChannel(await ownerWhere(this, staff?.id, 'userid'), 'userid', channel),
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#userNames(result.rows.map((r) => r.userid));
    return {
      count: result.count,
      rows: result.rows.map((row) => this.#presentAdminInterest(row, names.get(row.userid))),
    };
  }

  /**
   * Daily compound interest on active deposits. Idempotent per (deposit, calendar day).
   * Annual rate on the deposit row is a percentage; interest = principal × rate / 100 / 365.
   */
  async accrueDailyInterest({ limit = 500 } = {}) {
    const dayStart = startOfToday();
    const dayEnd = startOfTomorrow();

    const deposits = await this.models.VaultPro.findAll({
      where: { status: 'active', vaultBalance: { [Op.gt]: 0 } },
      order: [['id', 'ASC']],
      limit,
      raw: true,
    });

    let accruedDeposits = 0;
    let totalInterestMinor = 0n;

    for (const deposit of deposits) {
      const credited = await this.#accrueDepositForDay(deposit.id, dayStart, dayEnd);
      if (credited) {
        accruedDeposits += 1;
        totalInterestMinor += money.toMinor(credited);
      }
    }

    return {
      scanned: deposits.length,
      accruedDeposits,
      totalInterest: money.toDecimalString(totalInterestMinor),
    };
  }

  async #accrueDepositForDay(depositId, dayStart, dayEnd) {
    return this.db.transaction(async (transaction) => {
      const already = await this.models.VaultInterestHistory.count({
        where: {
          deposit_id: depositId,
          createdAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd },
        },
        transaction,
      });
      if (already > 0) return null;

      const deposit = await this.models.VaultPro.findOne({
        where: { id: depositId, status: 'active' },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!deposit) return null;

      const principal = money.toDecimalString(money.toMinor(deposit.vaultBalance ?? '0'));
      if (money.lte(principal, '0')) return null;

      const rate = deposit.interest_rate != null ? String(deposit.interest_rate) : '0';
      if (money.lte(rate, '0')) return null;

      // `divide` answers in minor units (a BigInt); everything stored or returned is a decimal string.
      const interest = money.toDecimalString(money.divide(money.percentOf(principal, rate), 365));
      if (money.lte(interest, '0')) return null;

      const newBalance = money.toDecimalString(
        money.add(money.toMinor(principal), money.toMinor(interest))
      );

      await deposit.update(
        { vaultBalance: newBalance, incomeDate: new Date() },
        { transaction }
      );

      await this.models.VaultInterestHistory.create(
        {
          userid: deposit.userid,
          coin: deposit.coin,
          deposit_id: deposit.id,
          interest,
          rate,
        },
        { transaction }
      );

      return interest;
    });
  }

  async #userNames(userIds) {
    const ids = [...new Set(userIds.filter((id) => id != null))];
    if (ids.length === 0) return new Map();

    const rows = await this.models.Users.findAll({
      where: { id: ids },
      attributes: ['id', 'name'],
      raw: true,
    });
    return new Map(rows.map((u) => [u.id, u.name]));
  }

  #presentAdminDeposit(row, name) {
    const timing = this.#timeRemaining(row.endTime);
    const balance = money.toDecimalString(money.toMinor(row.vaultBalance ?? '0'));

    return {
      id: row.id,
      userid: row.userid,
      coin: row.coin,
      vaultBalance: Number(balance),
      name: name || `User #${row.userid}`,
      interest_rate: row.interest_rate != null ? Number(row.interest_rate) : 0,
      lock_period: row.lock_period,
      startTime: row.startTime,
      endTime: row.endTime,
      status: row.status,
      locked: timing.locked,
      remaining: timing.remaining,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  #presentAdminInterest(row, name) {
    const interest = money.toDecimalString(money.toMinor(row.interest ?? '0'));
    const rate = row.rate != null ? String(row.rate) : '0';
    const principal =
      money.gt(rate, '0')
        ? money.divide(money.multiply(interest, 36500), rate)
        : '0.00000000';

    return {
      userid: row.userid,
      coin: row.coin,
      principal: Number(principal),
      interest: Number(interest),
      rate: row.rate != null ? Number(row.rate) : 0,
      deposit_id: row.deposit_id,
      createdAt: row.createdAt,
      name: name || `User #${row.userid}`,
    };
  }

  /**
   * Early exit pays principal minus the configured penalty. Accrued interest on
   * the deposit is forfeited and is not credited to the wallet.
   */
  #earlyWithdrawalQuote(deposit, term, balance) {
    const principal = money.toDecimalString(
      money.toMinor(deposit.principal ?? deposit.vaultBalance ?? '0')
    );
    const penaltyRate = String(term?.early_penalty_rate ?? '0');
    const penaltyMinor = money.percentOf(principal, penaltyRate);
    const creditMinor = money.subtract(principal, penaltyMinor);

    const balanceMinor = money.toMinor(balance);
    const principalMinor = money.toMinor(principal);
    const forfeitedInterest = balanceMinor > principalMinor ? balanceMinor - principalMinor : 0n;

    return {
      credit: money.toDecimalString(creditMinor),
      penalty: money.toDecimalString(penaltyMinor),
      forfeitedInterest: money.toDecimalString(forfeitedInterest),
    };
  }

  /** Whether a deposit is still locked, and by how long. */
  #timeRemaining(endTime) {
    if (!endTime) {
      return { locked: false, msRemaining: 0, daysRemaining: 0, remaining: null };
    }

    const ms = new Date(endTime).getTime() - Date.now();
    if (ms <= 0) {
      return { locked: false, msRemaining: 0, daysRemaining: 0, remaining: null };
    }

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
      locked: true,
      msRemaining: ms,
      daysRemaining: Math.ceil(ms / (24 * 3600 * 1000)),
      remaining: { days, hours, minutes, seconds },
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
