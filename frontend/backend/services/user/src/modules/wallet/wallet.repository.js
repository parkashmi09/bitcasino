'use strict';

const { Op, literal, col, fn, lockRow } = require('@ibitplay/db');

const { resolveColumn, OPERATION, IDEMPOTENCY_WINDOW_HOURS } = require('./wallet.constants');

/**
 * Every database access the wallet makes.
 *
 * This is the only file in the platform permitted to change a balance, and the
 * rules it encodes are the ones the whole money model rests on:
 *
 *   - a balance is read under `SELECT … FOR UPDATE`, never with a bare SELECT
 *   - a balance is written with `SET col = col ± :amount`, never with a value
 *     computed in JavaScript
 *   - a debit carries its own `col >= :amount` guard IN THE SQL, so the check
 *     and the write are one statement and cannot be raced
 *   - the ledger row and the balance change are in the same transaction
 *
 * The currency never reaches SQL as text. `resolveColumn` maps it through a
 * fixed allow-list first, and only the resulting column name is interpolated.
 */
class WalletRepository {
  constructor({ models, db }) {
    this.models = models;
    this.db = db;
    this.sequelize = db.sequelize;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /** Whole wallet row — every currency column. */
  async findWallet(uid, transaction) {
    return this.models.Credits.findOne({ where: { uid }, transaction, raw: true });
  }

  /**
   * One page of PLAYERS, with the wallet row each of them has.
   *
   * `parentStaffIds` of `null` means "every player" — the platform owner —
   * rather than "no players"; an empty array really is nobody, and is answered
   * without touching the database.
   *
   * TWO queries rather than a join: `credits` is one row per player and a
   * missing row is normal (a player who has never held a balance), so the page
   * is taken from `users` and the wallets are fetched for the ids on it. That
   * also keeps the page size honest — a join with no wallet row would still
   * return the player, but LEFT JOIN paging is where "50 rows" quietly becomes
   * something else the moment a second one-to-many is added.
   */
  async listPlayerWallets({ parentStaffIds, search, limit, offset }) {
    if (Array.isArray(parentStaffIds) && parentStaffIds.length === 0) {
      return { rows: [], total: 0 };
    }

    const where = {};
    if (Array.isArray(parentStaffIds)) where.parent_staff_id = { [Op.in]: parentStaffIds };

    if (search) {
      // A UID is what an operator has in front of them when a player is on the
      // phone, so an all-digits term matches the id as well as the name. `id`
      // is an integer column: an ILIKE against it is a type error in Postgres,
      // hence the exact match rather than a pattern.
      const byName = { name: { [Op.iLike]: `%${search}%` } };
      where[Op.or] = /^\d+$/.test(search) ? [byName, { id: Number(search) }] : [byName];
    }

    const { rows: players, count } = await this.models.Users.findAndCountAll({
      where,
      // The listing is a money screen: an id, a name, and nothing else that
      // would turn a wallet page into a player-data export.
      attributes: ['id', 'name'],
      order: [['name', 'ASC']],
      limit,
      offset,
      raw: true,
    });

    if (!players.length) return { rows: [], total: count };

    const wallets = await this.models.Credits.findAll({
      where: { uid: { [Op.in]: players.map((p) => Number(p.id)) } },
      raw: true,
    });
    const walletOf = new Map(wallets.map((w) => [Number(w.uid), w]));

    return {
      rows: players.map((p) => ({
        uid: Number(p.id),
        name: p.name,
        // `null` for a player with no wallet row — the service turns that into
        // zeros, which is what a wallet that has never been funded holds.
        wallet: walletOf.get(Number(p.id)) ?? null,
      })),
      total: count,
    };
  }

  /**
   * Lock the player's wallet row and return the balance in one currency.
   *
   * This is THE lock. Two simultaneous bets that both read a balance of 100
   * and both debit 80 succeed without it; with it, the second waits for the
   * first to commit and then sees 20.
   *
   * Returns `null` when the player has no wallet row at all, which the service
   * distinguishes from a zero balance.
   */
  async lockBalance(uid, currency, transaction) {
    const column = resolveColumn(currency);

    const row = await lockRow(this.models.Credits, { uid }, transaction, {
      attributes: ['uid', column],
    });

    if (!row) return null;
    return { uid: row.uid, column, balance: String(row[column] ?? '0') };
  }

  /** Create the wallet row for a player who has never held a balance. */
  async createWallet(uid, transaction) {
    const [row] = await this.models.Credits.findOrCreate({
      where: { uid },
      defaults: { uid },
      transaction,
    });
    return row.get({ plain: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Balance changes
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Add to a balance, atomically.
   *
   * `SET col = col + :amount` is evaluated by Postgres against the row's
   * current value, so it is correct even without the lock. The lock is still
   * taken by the caller, because the LEDGER needs a balance it can trust — see
   * `debit` for why that matters.
   *
   * @returns {string} the new balance
   */
  async credit(uid, currency, amount, transaction) {
    const column = resolveColumn(currency);

    // QueryTypes.SELECT so RETURNING comes back as a plain row array; the
    // UPDATE type wraps it in driver metadata that differs between dialects.
    const rows = await this.sequelize.query(
      `UPDATE credits
          SET "${column}" = COALESCE("${column}", 0) + :amount
        WHERE uid = :uid
        RETURNING "${column}" AS balance`,
      {
        replacements: { uid, amount },
        transaction,
        type: this.sequelize.QueryTypes.SELECT,
      }
    );

    return rows?.[0]?.balance != null ? String(rows[0].balance) : null;
  }

  /**
   * Subtract from a balance, refusing to go below zero.
   *
   * The `>= :amount` guard is part of the UPDATE. That is the difference
   * between this and the legacy code, which read the balance, compared it in
   * JavaScript, then wrote — and which additionally clamped the number written
   * to *history* at zero while decrementing the column unclamped, so history
   * recorded 0 while the balance said -50.
   *
   * @returns {{ok: boolean, balance: string|null}} ok=false means the guard
   *          rejected it and NOTHING was written.
   */
  async debit(uid, currency, amount, transaction) {
    const column = resolveColumn(currency);

    const rows = await this.sequelize.query(
      `UPDATE credits
          SET "${column}" = "${column}" - :amount
        WHERE uid = :uid
          AND COALESCE("${column}", 0) >= :amount
        RETURNING "${column}" AS balance`,
      {
        replacements: { uid, amount },
        transaction,
        type: this.sequelize.QueryTypes.SELECT,
      }
    );

    // Zero rows means the guard rejected it. Nothing was written — this is the
    // insufficient-funds signal, and it is decided by Postgres, not by JS.
    if (!rows?.length) return { ok: false, balance: null };
    return { ok: true, balance: String(rows[0].balance) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Idempotency
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Has this movement already been applied?
   *
   * Checked before doing anything, and checked AGAIN by the unique index when
   * the row is inserted. Both are necessary: the lookup handles the common
   * case cheaply, and the index handles two concurrent retries that both pass
   * the lookup before either inserts.
   */
  async findByIdempotencyKey(idempotencyKey, transaction) {
    return this.models.CreditsLedger.findOne({
      where: {
        idempotency_key: idempotencyKey,
        created_at: { [Op.gte]: new Date(Date.now() - IDEMPOTENCY_WINDOW_HOURS * 3600 * 1000) },
      },
      transaction,
      raw: true,
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Audit trail
  // ══════════════════════════════════════════════════════════════════════

  /** The double-entry record. Written in the same transaction as the balance change. */
  async writeLedger(entry, transaction) {
    const row = await this.models.CreditsLedger.create(
      {
        netamount: 0,
        profit: 0,
        loss: 0,
        commission: 0,
        closing: 0,
        ...entry,
      },
      { transaction }
    );
    return row.get({ plain: true });
  }

  /**
   * The human-readable movement log the admin UI reads.
   *
   * Kept alongside `credits_ledger` because the legacy admin screens query it
   * directly. `previous_balance` and `new_balance` are only meaningful because
   * the caller holds the row lock while computing them.
   */
  async writeHistory(entry, transaction) {
    const row = await this.models.WalletHistory.create(
      { transaction_time: new Date(), ...entry },
      { transaction }
    );
    return row.get({ plain: true });
  }

  /**
   * Has this entry already been reversed?
   *
   * A rollback row carries `meta.rollbackOf = <original id>`, so the reversal
   * itself is the record — there is no separate flag on the original that could
   * drift out of step with whether the money actually moved back.
   */
  async findRollbackOf(ledgerId, transaction) {
    return this.models.CreditsLedger.findOne({
      where: literal(`meta->>'rollbackOf' = '${Number(ledgerId)}'`),
      transaction,
      raw: true,
    });
  }

  async findLedgerEntry(ledgerId, transaction) {
    return this.models.CreditsLedger.findOne({
      where: { id: ledgerId },
      transaction,
      lock: transaction?.LOCK?.UPDATE,
      raw: true,
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Statements
  // ══════════════════════════════════════════════════════════════════════

  async listLedger({ userId, currency, reason, limit, offset }) {
    return this.models.CreditsLedger.findAndCountAll({
      where: {
        // credits_ledger.user_id is TEXT in the legacy schema.
        user_id: String(userId),
        ...(currency ? { currency } : {}),
        ...(reason ? { reason } : {}),
      },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  async listHistory({ userId, currency, limit, offset }) {
    return this.models.WalletHistory.findAndCountAll({
      where: {
        uid: userId,
        ...(currency ? { coin: currency } : {}),
      },
      order: [['transaction_time', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  /**
   * Sum the ledger for one currency — used to reconcile a wallet against its
   * own history. A mismatch means something wrote a balance without a ledger
   * row, which is the failure this whole module exists to make impossible.
   */
  async sumLedger({ userId, currency }) {
    const [row] = await this.models.CreditsLedger.findAll({
      attributes: [[fn('COALESCE', fn('SUM', col('amount')), 0), 'total']],
      where: { user_id: String(userId), currency },
      raw: true,
    });
    return String(row?.total ?? '0');
  }
}

module.exports = { WalletRepository, OPERATION };
