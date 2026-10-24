'use strict';

const { QueryTypes } = require('sequelize');
const { money, AppError, directLedgerContext } = require('@ibitplay/common');

const { assertTransactionPassword } = require('../staff-auth/transactionPassword');
const {
  debitOwnerDirectBalance,
  creditOwnerDirectBalance,
  readOwnerDirectBalance,
  insufficientDirectBalance,
  LEDGER_TYPE,
} = require('../lords/ownerWallet');

/**
 * `credits` ke currency columns. SQL me column naam isi list se aata hai (whitelist),
 * body se kabhi seedha nahi. Sirf wahi dikhte hain jinka `exchangerate` me rate hai.
 */
const COIN_COLUMNS = [
  'inr', 'usdt', 'btc', 'eth', 'npr', 'pkr', 'bdt', 'ltc', 'bch', 'trx', 'doge', 'ada', 'xrp',
  'bnb', 'usdp', 'nexo', 'mkr', 'tusd', 'usdc', 'busd', 'shib', 'matic', 'mvr', 'aed', 'eur',
];

const SCALE = 10n ** BigInt(money.SCALE);
const PAISA = SCALE / 100n;

const onlyOwner = () => new AppError('Only the Super Admin can use the Direct User Wallet', 403, 'DIRECT_WALLET_OWNER_ONLY');
const notDirectUser = () => new AppError('This user is not a direct user', 403, 'DIRECT_WALLET_NOT_DIRECT_USER');
const unknownCurrency = (currency) =>
  new AppError(`${currency} is not available in the Direct User Wallet`, 422, 'DIRECT_WALLET_UNKNOWN_CURRENCY', { currency });
const tooSmall = () => new AppError('The amount is too small: it is worth less than ₹0.01', 422, 'DIRECT_WALLET_AMOUNT_TOO_SMALL');
const userShort = (details) =>
  new AppError('The user does not have that much in this currency', 422, 'INSUFFICIENT_FUNDS', { party: 'user', ...details });

/**
 * Direct User Wallet — admin-structure.zip ka "Wallet" (WalletUpdate) page.
 *
 * Super Admin direct user (koi parent nahi) ko KISI BHI currency me credit / debit karta hai.
 * Paisa Super Admin ke Direct User wallet (`staff_balances`, INR) se aata / usi me jaata hai:
 * currency amount ko `exchangerate` ke rate se INR me badal ke utna kat-ta / judta hai.
 * Sports agent ke users yahan nahi aate (unka paisa points / `credits.inr` se).
 * Har badlav: owner ledger (`owner_direct_ledger`, currency ke saath), user ka
 * `credits_ledger` + `wallet_history`.
 */
class DirectWalletService {
  constructor({ models, db, logger }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.sequelize = models.StaffBalances.sequelize;
  }

  /** Rates: { BTC: { usd: '65000…' }, … } sirf COIN_COLUMNS wali currencies. */
  async #rates({ transaction } = {}) {
    const rows = await this.sequelize.query('SELECT currency, usd_rate FROM exchangerate', {
      type: QueryTypes.SELECT,
      transaction,
    });
    const map = new Map();
    for (const r of rows) {
      const code = String(r.currency).toUpperCase();
      if (COIN_COLUMNS.includes(code.toLowerCase()) && r.usd_rate != null && Number(r.usd_rate) > 0) {
        map.set(code, money.toMinorQuantised(r.usd_rate));
      }
    }
    return map;
  }

  /**
   * `amount` <currency> = kitne INR, paise tak (half-up). Rate = currency ka USD rate / INR ka USD rate.
   * @returns {{ inrMinor: bigint, rateMinor: bigint }}
   */
  static toInr(amountMinor, coinUsdMinor, inrUsdMinor) {
    const raw = (amountMinor * coinUsdMinor + inrUsdMinor / 2n) / inrUsdMinor;
    const inrMinor = ((raw + PAISA / 2n) / PAISA) * PAISA;
    const rateMinor = (coinUsdMinor * SCALE + inrUsdMinor / 2n) / inrUsdMinor;
    return { inrMinor, rateMinor };
  }

  /** `amountMinor` <code> = kitne INR + rate, abhi ke `exchangerate` se (owner ka Direct balance top-up). */
  async inrValue(code, amountMinor, { transaction } = {}) {
    const rates = await this.#rates({ transaction });
    if (!rates.has(code) || !rates.has('INR')) throw unknownCurrency(code);
    const result = DirectWalletService.toInr(amountMinor, rates.get(code), rates.get('INR'));
    if (result.inrMinor <= 0n) throw tooSmall();
    return result;
  }

  /** Dropdown ke liye currencies + 1 unit = kitne INR. INR pehle. */
  async currencies({ actor }) {
    if (!actor.canIssueFunds) throw onlyOwner();
    const rates = await this.#rates();
    const inrUsd = rates.get('INR');
    if (!inrUsd) return [{ code: 'INR', inrRate: '1.00000000' }];

    return COIN_COLUMNS.map((c) => c.toUpperCase())
      .filter((code) => rates.has(code))
      .map((code) => ({
        code,
        inrRate: money.toDecimalString(DirectWalletService.toInr(SCALE, rates.get(code), inrUsd).rateMinor),
      }));
  }

  /** Direct users (parent nahi) + har currency ka balance. Search = naam ya UID. */
  async listUsers({ actor, search, limit = 20, offset = 0 }) {
    if (!actor.canIssueFunds) throw onlyOwner();

    const where = ['u.parent_staff_id IS NULL'];
    const replacements = { limit, offset };
    if (search) {
      where.push("(u.name ILIKE :term OR u.id::text LIKE :idTerm)");
      replacements.term = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
      replacements.idTerm = `${search.replace(/\D/g, '') || '-'}%`;
    }
    const filter = where.join(' AND ');
    const coins = COIN_COLUMNS.map((c) => `COALESCE(c.${c}, 0) AS ${c}`).join(', ');

    const rows = await this.sequelize.query(
      `SELECT u.id, u.name, u.avatar, u.status, ${coins}
         FROM users u
         LEFT JOIN credits c ON c.uid = u.id
        WHERE ${filter}
        ORDER BY u.id DESC
        LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );
    const [{ total }] = await this.sequelize.query(`SELECT COUNT(*)::int AS total FROM users u WHERE ${filter}`, {
      replacements,
      type: QueryTypes.SELECT,
    });

    return {
      total,
      rows: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        avatar: r.avatar ?? null,
        status: r.status ?? null,
        balances: Object.fromEntries(COIN_COLUMNS.map((c) => [c.toUpperCase(), money.fromStored(r[c] ?? '0')])),
      })),
    };
  }

  /** User direct hai? Nahi to 403, na mile to 404. */
  async #assertDirectUser(userId, { transaction } = {}) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'name', 'parent_staff_id'],
      transaction,
      raw: true,
    });
    if (!user) throw new AppError('User not found', 404, 'DIRECT_WALLET_USER_NOT_FOUND');
    if (user.parent_staff_id != null) throw notDirectUser();
    return user;
  }

  /**
   * Credit = owner ke wallet se (INR value) kat ke user ko <currency> me do.
   * Debit  = user se <currency> lo, INR value owner ke wallet me wapas.
   * Sab ek transaction me: kuch bhi fail ho to kuch nahi badalta.
   */
  async adjust({ actor, userId, currency, amount, operation, note, transactionPassword }) {
    if (!actor.canIssueFunds) throw onlyOwner();
    await assertTransactionPassword(this.models, actor.id, transactionPassword, { required: true });

    const code = String(currency).toUpperCase();
    const column = code.toLowerCase();
    if (!COIN_COLUMNS.includes(column)) throw unknownCurrency(code);

    const user = await this.#assertDirectUser(userId);
    const isCredit = operation === 'credit';
    const amountMinor = money.toMinor(amount);
    const decimal = money.toDecimalString(amountMinor);

    return this.db.transaction(async (transaction) => {
      const rates = await this.#rates({ transaction });
      if (!rates.has(code) || !rates.has('INR')) throw unknownCurrency(code);
      const { inrMinor, rateMinor } = DirectWalletService.toInr(amountMinor, rates.get(code), rates.get('INR'));
      if (inrMinor <= 0n) throw tooSmall();
      const inrValue = money.toDecimalString(inrMinor);
      const rate = money.toDecimalString(rateMinor);

      const entry = {
        type: isCredit ? LEDGER_TYPE.USER_DEPOSIT : LEDGER_TYPE.USER_WITHDRAW,
        userId,
        note: note || (isCredit ? 'Direct User Wallet credit' : 'Direct User Wallet debit'),
        currency: code,
        currencyAmount: decimal,
        rate,
      };

      // User ka wallet row lock karo (na ho to banao), taaki pehle / baad ka balance sach ho.
      await this.models.Credits.findOrCreate({ where: { uid: userId }, defaults: { uid: userId }, transaction });
      const [wallet] = await this.sequelize.query(`SELECT COALESCE(${column}, 0) AS bal FROM credits WHERE uid = :userId FOR UPDATE`, {
        replacements: { userId },
        type: QueryTypes.SELECT,
        transaction,
      });
      const previousMinor = money.toMinorQuantised(wallet.bal);

      // Names the user's balance update for the direct-ledger trigger (the owner's own row is not labelled).
      await directLedgerContext(this.sequelize, transaction, {
        userId,
        eventType: isCredit ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        category: 'ADMIN',
        source: 'direct-wallet',
        ref: `staff:${actor.id}`,
        remark: entry.note,
      });

      if (isCredit) {
        // Pehle owner ka wallet (guarded): kam ho to kuch nahi badlega.
        if (!(await debitOwnerDirectBalance(this.models, actor.id, inrValue, { transaction, entry }))) {
          throw insufficientDirectBalance({
            requested: inrValue,
            available: await readOwnerDirectBalance(this.models, actor.id, { transaction }),
          });
        }
        await this.sequelize.query(`UPDATE credits SET ${column} = COALESCE(${column}, 0) + :amount WHERE uid = :userId`, {
          replacements: { amount: decimal, userId },
          transaction,
        });
      } else {
        const rows = await this.sequelize.query(
          `UPDATE credits SET ${column} = ${column} - :amount WHERE uid = :userId AND ${column} >= :amount RETURNING ${column}`,
          { replacements: { amount: decimal, userId }, type: QueryTypes.SELECT, transaction }
        );
        if (!rows.length) throw userShort({ currency: code, requested: decimal, available: money.toDecimalString(previousMinor) });
        await creditOwnerDirectBalance(this.models, actor.id, inrValue, { transaction, entry });
      }

      const newMinor = isCredit ? previousMinor + amountMinor : previousMinor - amountMinor;
      const previousBalance = money.toDecimalString(previousMinor);
      const newBalance = money.toDecimalString(newMinor);
      const description = `${entry.note} (₹${Number(inrValue).toFixed(2)} ${isCredit ? 'from' : 'back to'} Super Admin wallet)`.slice(0, 255);

      // User ki taraf ka record — statement aur history isi se.
      await this.models.CreditsLedger.create(
        {
          user_id: String(userId),
          currency: code,
          amount: isCredit ? decimal : `-${decimal}`,
          reason: isCredit ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
          description,
          balance: newBalance,
          closing: newBalance,
          netamount: 0,
          profit: 0,
          loss: 0,
          commission: 0,
          source_service: 'admin-service',
          meta: { refType: 'DIRECT_WALLET', staffId: String(actor.id), previousBalance, inrValue, rate },
        },
        { transaction }
      );
      await this.models.WalletHistory.create(
        {
          uid: userId,
          username: user.name || String(userId),
          coin: code,
          operation: isCredit ? 'credit' : 'debit',
          amount: decimal,
          previous_balance: previousBalance,
          new_balance: newBalance,
          description,
          transaction_time: new Date(),
        },
        { transaction }
      );

      const directBalance = await readOwnerDirectBalance(this.models, actor.id, { transaction });
      this.logger?.info(
        { actorStaffId: actor.id, userId, currency: code, amount: decimal, inrValue, operation },
        'Direct User Wallet adjustment'
      );

      return {
        userId: String(userId),
        currency: code,
        amount: decimal,
        operation,
        previousBalance,
        newBalance,
        inrValue,
        rate,
        directBalance,
      };
    });
  }

  /** Ek direct user ki wallet history (zip `/wallethistory/:uid`), currency filter optional. */
  async history({ actor, userId, currency, limit = 20, offset = 0 }) {
    if (!actor.canIssueFunds) throw onlyOwner();
    await this.#assertDirectUser(userId);

    const where = { uid: userId, ...(currency ? { coin: String(currency).toUpperCase() } : {}) };
    const { rows, count } = await this.models.WalletHistory.findAndCountAll({
      where,
      order: [['transaction_time', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((r) => ({
        id: String(r.id),
        coin: r.coin,
        operation: r.operation,
        amount: money.fromStored(r.amount ?? '0'),
        previousBalance: money.fromStored(r.previous_balance ?? '0'),
        newBalance: money.fromStored(r.new_balance ?? '0'),
        description: r.description ?? null,
        createdAt: r.transaction_time,
      })),
    };
  }
}

module.exports = { DirectWalletService, COIN_COLUMNS };
