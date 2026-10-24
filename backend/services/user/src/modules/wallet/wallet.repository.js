'use strict';

const { Op, literal, col, fn, lockRow } = require('@ibitplay/db');

const errors = require('./wallet.errors');
const {
  resolveColumn, assertCreditable, isCustomCurrency, OPERATION, IDEMPOTENCY_WINDOW_HOURS,
} = require('./wallet.constants');

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
 *
 * CUSTOM COINS (migration 065). A coin the owner created has no `credits`
 * column; its balance is the `wallet_balances (uid, currency)` row. The rules
 * above hold for it unchanged: the player's `credits` row is still THE lock
 * (taken first, so every movement of one player serialises whatever the coin),
 * the balance row is then read `FOR UPDATE`, a credit is `balance + :amount`
 * in SQL (an upsert), a debit is the same guarded `balance >= :amount` UPDATE.
 * The code travels as a bound parameter, never as an identifier, and must name
 * a `currencies` row with `builtin = false` (else `WALLET_UNSUPPORTED_CURRENCY`).
 */
/** The Transaction pane's Bill types as `credits_ledger` filters (`meta.refType` is the writer's). */
const LEDGER_CATEGORY_SQL = Object.freeze({
  game: "reason IN ('BET_STAKE', 'BET_PAYOUT', 'BET_REFUND', 'BET_ROLLBACK')",
  bonus: "reason IN ('BONUS', 'BONUS_REVERSAL', 'rakeback_claim')",
  affiliate: "meta->>'refType' LIKE 'AFFILIATE%'",
  vault: "meta->>'refType' = 'VAULT'",
  swap: "meta->>'swap' = 'true'",
});

/**
 * A direct user's sports stake holds and exposure releases (a BACK after a LAY on one runner), as
 * the `point_ledger_direct` trigger wrote them: the real move (`delta`) and the exact wallet after
 * it. A release has no `debit_ledger` row, so that ledger alone loses it and the next row looks off.
 * `debit_ledger` keeps only the bets this ledger has no row for (agent users, before migration 117).
 */
const DIRECT_SPORTS_MOVES = `mssports.point_ledger_direct
  WHERE user_id = :uid AND source = 'sports-service' AND event_type IN ('BET_PLACED', 'BET_RELEASED') AND currency = 'INR'`;
const NOT_IN_DIRECT_LEDGER = `NOT EXISTS (SELECT 1 FROM mssports.point_ledger_direct p
  WHERE p.bet_id::text = d.meta->>'bet_id' AND p.event_type = 'BET_PLACED' AND p.source = 'sports-service')`;

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
  async listPlayerWallets({ parentStaffIds, search, heldCurrency, limit, offset }) {
    if (Array.isArray(parentStaffIds) && parentStaffIds.length === 0) {
      return { rows: [], total: 0 };
    }

    const where = {};
    if (Array.isArray(parentStaffIds)) where.parent_staff_id = { [Op.in]: parentStaffIds };

    // Only players holding a positive balance in this coin (the site admin's
    // Wallets currency filter). The column comes from the allow-list, never
    // from the request; a custom coin's code is a bound replacement.
    if (heldCurrency) {
      const holders = isCustomCurrency(heldCurrency)
        ? `SELECT uid FROM wallet_balances WHERE currency = ${this.sequelize.escape(String(heldCurrency).toUpperCase())} AND balance > 0`
        : `SELECT uid FROM credits WHERE "${resolveColumn(heldCurrency)}" > 0`;
      where.id = { [Op.in]: literal(`(${holders})`) };
    }

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
    if (isCustomCurrency(currency)) return this.#lockCustomBalance(uid, currency, transaction);
    const column = resolveColumn(currency);

    const row = await lockRow(this.models.Credits, { uid }, transaction, {
      attributes: ['uid', column],
    });

    if (!row) return null;
    return { uid: row.uid, column, balance: String(row[column] ?? '0') };
  }

  /**
   * The custom-coin twin of `lockBalance`: the `credits` row lock first (the
   * same lock every other movement of this player takes), then the coin's own
   * balance row `FOR UPDATE`. A player with no `credits` row is `null`, as
   * above; a missing balance row is a zero balance.
   */
  async #lockCustomBalance(uid, currency, transaction) {
    const code = await this.requireCustomCoin(currency, transaction);
    const row = await lockRow(this.models.Credits, { uid }, transaction, { attributes: ['uid'] });
    if (!row) return null;
    const rows = await this.sequelize.query(
      'SELECT balance FROM wallet_balances WHERE uid = :uid AND currency = :code FOR UPDATE',
      { replacements: { uid, code }, transaction, type: this.sequelize.QueryTypes.SELECT }
    );
    return { uid: row.uid, column: null, currency: code, balance: String(rows?.[0]?.balance ?? '0') };
  }

  /**
   * The custom coin a code names, upper-cased — or `WALLET_UNSUPPORTED_CURRENCY`
   * when the registry has no owner-created coin by that code. (A built-in code
   * never reaches here: it has a column.)
   */
  async requireCustomCoin(currency, transaction) {
    const code = String(currency ?? '').trim().toUpperCase();
    const rows = await this.sequelize.query(
      'SELECT code FROM currencies WHERE code = :code AND builtin = false',
      { replacements: { code }, transaction, type: this.sequelize.QueryTypes.SELECT }
    );
    if (!rows?.length) throw errors.UNSUPPORTED_CURRENCY({ currency: code });
    return code;
  }

  /**
   * Every custom coin, with this player's balance in it (0 when none) and
   * whether players may use it now. For the balance reads.
   */
  async listCustomBalances(uid) {
    return this.sequelize.query(
      `SELECT c.code,
              COALESCE(wb.balance, 0) AS balance,
              (c.owner_enabled AND c.site_enabled AND NOT c.retired) AS enabled
         FROM currencies c
         LEFT JOIN wallet_balances wb ON wb.currency = c.code AND wb.uid = :uid
        WHERE c.builtin = false
        ORDER BY c.sort_order ASC, c.code ASC`,
      { replacements: { uid }, type: this.sequelize.QueryTypes.SELECT }
    );
  }

  /** Every custom coin code (any state), for the staff listing's columns. */
  async listCustomCodes() {
    const rows = await this.sequelize.query(
      'SELECT code FROM currencies WHERE builtin = false ORDER BY sort_order ASC, code ASC',
      { type: this.sequelize.QueryTypes.SELECT }
    );
    return rows.map((r) => r.code);
  }

  /** Custom-coin balance rows for a page of players: `[{ uid, currency, balance }]`. */
  async listCustomBalancesFor(uids) {
    if (!uids.length) return [];
    return this.sequelize.query(
      'SELECT uid, currency, balance FROM wallet_balances WHERE uid IN (:uids)',
      { replacements: { uids }, type: this.sequelize.QueryTypes.SELECT }
    );
  }

  /** One custom-coin balance (unlocked read), '0' when the player holds none. */
  async customBalance(uid, currency) {
    const code = await this.requireCustomCoin(currency);
    const rows = await this.sequelize.query(
      'SELECT balance FROM wallet_balances WHERE uid = :uid AND currency = :code',
      { replacements: { uid, code }, type: this.sequelize.QueryTypes.SELECT }
    );
    return String(rows?.[0]?.balance ?? '0');
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
   * A retired coin (BJB) is refused with `WALLET_CURRENCY_RETIRED` unless
   * `options.restore` is set — only `rollback` sets it, to give back money an
   * earlier debit took out of a balance that already existed.
   *
   * @returns {string} the new balance
   */
  async credit(uid, currency, amount, transaction, { restore = false } = {}) {
    if (!restore) assertCreditable(currency);
    if (isCustomCurrency(currency)) {
      const code = await this.requireCustomCoin(currency, transaction);
      // An upsert: the first credit of a coin creates the player's row. Still
      // `balance + :amount` in SQL, never a value computed here.
      const rows = await this.sequelize.query(
        `INSERT INTO wallet_balances (uid, currency, balance)
              VALUES (:uid, :code, :amount)
         ON CONFLICT (uid, currency)
         DO UPDATE SET balance = wallet_balances.balance + EXCLUDED.balance, updated_at = CURRENT_TIMESTAMP
         RETURNING balance`,
        { replacements: { uid, code, amount }, transaction, type: this.sequelize.QueryTypes.SELECT }
      );
      return rows?.[0]?.balance != null ? String(rows[0].balance) : null;
    }
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
    if (isCustomCurrency(currency)) {
      const code = await this.requireCustomCoin(currency, transaction);
      const rows = await this.sequelize.query(
        `UPDATE wallet_balances
            SET balance = balance - :amount, updated_at = CURRENT_TIMESTAMP
          WHERE uid = :uid
            AND currency = :code
            AND balance >= :amount
          RETURNING balance`,
        { replacements: { uid, code, amount }, transaction, type: this.sequelize.QueryTypes.SELECT }
      );
      if (!rows?.length) return { ok: false, balance: null };
      return { ok: true, balance: String(rows[0].balance) };
    }
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

  /**
   * The player's statement. `category` is the Transaction pane's Bill type (LEDGER_CATEGORY_SQL).
   * Unless a reason or another category narrows it, the sports exchange's own INR rows are merged
   * in: its stake holds and exposure releases (DIRECT_SPORTS_MOVES) and settlements (`mssports.credits_ledger`) never
   * reach this wallet's `credits_ledger`, and the player still has to see where the money went.
   */
  async listLedger({ userId, currency, reason, category, limit, offset }) {
    // credits_ledger.user_id is TEXT in the legacy schema.
    const replacements = { uid: String(userId), currency, limit, offset };
    const where = ['user_id = :uid'];
    if (currency) where.push('currency = :currency');
    // One reason or a list (`REWARDS` expands to several — see the validator).
    if (reason) {
      replacements.reasons = [].concat(reason);
      where.push('reason IN (:reasons)');
    }
    if (category) where.push(LEDGER_CATEGORY_SQL[category]);
    const parts = [
      `SELECT id::text AS id, id AS seq, user_id, currency, amount, reason, description, balance, created_at::timestamptz AS created_at, meta
         FROM public.credits_ledger WHERE ${where.join(' AND ')}`,
    ];
    if (!reason && (!category || category === 'game') && (!currency || currency === 'INR')) {
      parts.push(
        `SELECT 'sd' || id, id, user_id, currency, -amount, 'SPORTS_STAKE', description, balance, created_at::timestamptz, NULL::jsonb
           FROM mssports.debit_ledger d WHERE user_id = :uid AND reason = 'bet_placed' AND ${NOT_IN_DIRECT_LEDGER}`,
        `SELECT 'sp' || id, id, user_id::text, currency, delta,
                CASE event_type WHEN 'BET_PLACED' THEN 'SPORTS_STAKE' ELSE 'SPORTS_RELEASE' END,
                remark, balance_after, created_at, NULL::jsonb
           FROM ${DIRECT_SPORTS_MOVES}`,
        `SELECT 'sc' || id, id, user_id, currency, amount,
                CASE reason WHEN 'refund' THEN 'SPORTS_REFUND' WHEN 'settlement_void' THEN 'SPORTS_VOID' ELSE 'SPORTS_SETTLEMENT' END,
                description, closing, created_at::timestamptz, NULL::jsonb
           FROM mssports.credits_ledger WHERE user_id = :uid AND reason IN ('settlement', 'refund', 'settlement_void')`
      );
    }
    const union = parts.join(' UNION ALL ');
    const rows = await this.sequelize.query(
      `SELECT * FROM (${union}) l ORDER BY created_at DESC, seq DESC LIMIT :limit OFFSET :offset`,
      { replacements, type: 'SELECT' }
    );
    const [{ count }] = await this.sequelize.query(`SELECT COUNT(*)::int AS count FROM (${union}) l`, { replacements, type: 'SELECT' });
    await this.#nameOriginalGames(rows);
    await this.#nameGisGames(rows);
    return { rows: rows.map(({ seq, ...row }) => row), count };
  }

  /**
   * A Slotegrator row reads "bet <tx>": the game is read back from gis_transactions →
   * gisgamesnew (or its parked copy) as "Aviator bet". Never the transaction id on screen.
   */
  async #nameGisGames(rows) {
    const GIS = /^(bet|win|refund|rollback) (\S+)$/;
    const gis = rows.filter((r) => r.meta?.refType === 'GIS' && GIS.test(r.description || ''));
    if (!gis.length) return;
    const found = await this.sequelize.query(
      `SELECT t.transaction_id AS tx, COALESCE(g.name, p.name) AS name
         FROM gis_transactions t
         LEFT JOIN gisgamesnew g ON g.uuid = t.game_uuid
         LEFT JOIN gisgamesnew_parked p ON p.uuid = t.game_uuid
        WHERE t.transaction_id IN (:refs)`,
      { replacements: { refs: gis.map((r) => r.description.match(GIS)[2]) }, type: 'SELECT' }
    ).catch(() => []);
    const names = new Map(found.map((f) => [String(f.tx), f.name]));
    for (const r of gis) {
      const [, kind, tx] = r.description.match(GIS);
      r.description = `${names.get(tx) || 'Casino game'} ${kind}`;
    }
  }

  /**
   * An Original Games row written before casino-service named the game reads "original-games bet
   * <tx>": the game is read back from og_transactions → og_games ("Arrow Bow bet"), as the admin
   * balance sheet does. No og tables in a deployment: the stored text stays.
   */
  async #nameOriginalGames(rows) {
    const OG = /^original-games (bet|win|rollback) (\S+)/;
    const og = rows.filter((r) => OG.test(r.description || ''));
    if (!og.length) return;
    const found = await this.sequelize.query(
      `SELECT o.transaction_id AS tx, COALESCE(g.name, o.game_code) AS name
         FROM og_transactions o LEFT JOIN og_games g ON g.code = o.game_code
        WHERE o.transaction_id IN (:refs)`,
      { replacements: { refs: og.map((r) => r.description.match(OG)[2]) }, type: 'SELECT' }
    ).catch(() => []);
    const names = new Map(found.map((f) => [String(f.tx), f.name]));
    for (const r of og) {
      const [, kind, tx] = r.description.match(OG);
      r.description = `${names.get(tx) || 'Original game'} ${kind}`;
    }
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
   * The staff Ledger tab: `wallet_history` plus the moves that never write it — a swap's two
   * `credits_ledger` legs (`meta.swap`) and the Sports Exchange's own ledgers (mssports bet placed /
   * exposure released / settlement / refund / void, INR) — newest first, one page. Same row shape as `listHistory`.
   */
  async listStaffHistory({ userId, currency, limit, offset }) {
    const { sequelize } = this;
    const cur = String(currency ?? '').toUpperCase();
    const replacements = { uid: String(userId), limit, offset, ...(currency ? { cur } : {}) };
    const sports = !currency || cur === 'INR';
    const parts = [
      `SELECT h.id::text AS id, h.transaction_time, h.coin, h.operation, h.amount::text AS amount,
              h.previous_balance::text AS previous_balance, h.new_balance::text AS new_balance, h.description
         FROM wallet_history h WHERE h.uid::text = :uid${currency ? ' AND UPPER(h.coin) = :cur' : ''}`,
      `SELECT 'swap-' || l.id, l.created_at, UPPER(l.currency), CASE WHEN l.amount < 0 THEN 'debit' ELSE 'credit' END,
              ABS(l.amount)::text, l.meta->>'previousBalance', l.balance::text, l.description
         FROM credits_ledger l
        WHERE l.user_id = :uid AND l.meta->>'swap' = 'true'${currency ? ' AND UPPER(l.currency) = :cur' : ''}`,
      ...(sports
        ? [
            `SELECT 'sports-bet-' || d.id, d.created_at, 'INR', 'debit', ABS(d.amount)::text, NULL, d.balance::text,
                    TRIM('Sports bet placed — ' || COALESCE(d.description, ''))
               FROM mssports.debit_ledger d
              WHERE d.user_id = :uid AND d.reason = 'bet_placed' AND UPPER(COALESCE(d.currency, 'INR')) = 'INR' AND ${NOT_IN_DIRECT_LEDGER}`,
            `SELECT 'sports-move-' || id, created_at, 'INR', CASE WHEN delta < 0 THEN 'debit' ELSE 'credit' END, ABS(delta)::text,
                    (balance_after - delta)::text, balance_after::text,
                    TRIM(CASE event_type WHEN 'BET_PLACED' THEN 'Sports bet placed — ' ELSE 'Sports exposure released — ' END || COALESCE(remark, ''))
               FROM ${DIRECT_SPORTS_MOVES}`,
            `SELECT 'sports-' || c.id, c.created_at, 'INR', 'credit', ABS(c.amount)::text, NULL, c.closing::text,
                    TRIM('Sports ' || REPLACE(c.reason, '_', ' ') || ' — ' || COALESCE(c.description, ''))
               FROM mssports.credits_ledger c
              WHERE c.user_id = :uid AND c.reason IN ('settlement', 'refund', 'settlement_void') AND UPPER(COALESCE(c.currency, 'INR')) = 'INR'`,
          ]
        : []),
    ].join('\n UNION ALL \n');
    const [rows, [{ count }]] = await Promise.all([
      sequelize.query(`SELECT * FROM (${parts}) x ORDER BY transaction_time DESC NULLS LAST, id DESC LIMIT :limit OFFSET :offset`, {
        replacements,
        type: sequelize.QueryTypes.SELECT,
      }),
      sequelize.query(`SELECT COUNT(*)::int AS count FROM (${parts}) x`, { replacements, type: sequelize.QueryTypes.SELECT }),
    ]);
    return { rows, count };
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

  /** Every currency this player has a ledger row in, so a reconcile sees a coin the balance read hides. */
  async ledgerCurrencies(userId) {
    const rows = await this.models.CreditsLedger.findAll({
      attributes: [[fn('DISTINCT', col('currency')), 'currency']],
      where: { user_id: String(userId) },
      raw: true,
    });
    return rows.map((row) => String(row.currency).toUpperCase());
  }
}

module.exports = { WalletRepository, OPERATION };
