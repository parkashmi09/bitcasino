'use strict';

const crypto = require('node:crypto');
const { Op, QueryTypes } = require('sequelize');
const { money, sitePolicy } = require('@ibitplay/common');
const { hashPassword, verifyPassword, TokenService, TOKEN_TYPES } = require('@ibitplay/auth');

const errors = require('./branches.errors');
const { DashboardStatsService } = require('../dashboard/dashboardStats.service');
const { StatementsService } = require('../statements/statements.service');
const { ledgerRow } = require('../exchange-reports/directBetHistory');
const { COIN_COLUMNS } = require('../direct-wallet/directWallet.service');
const { PLAYER_ROLE_ID, PASSWORD_ROUNDS, WALLET_SEED } = require('../players/players.constants');

const MONEY_KEYS = ['deposits', 'withdrawals', 'net', 'casinoWagered', 'casinoWon', 'casinoGgr', 'sportsStaked', 'sportsGgr'];
const COUNT_KEYS = ['registrations', 'depositCount', 'withdrawalCount', 'casinoBets', 'sportsBets'];

const publicBranch = (b) => ({
  id: Number(b.id),
  name: b.name,
  username: b.username,
  status: b.status,
  createdAt: b.created_at,
  lastLoginAt: b.last_login_at ?? null,
});

/** A branch's players: direct users it created. A player with a parent is never one, whatever its column says. */
const BRANCH_PLAYERS = 'SELECT u.id FROM users u WHERE u.branch_id = :branchId AND u.parent_staff_id IS NULL';

/** Which casino rounds (statements `casinoRoundsSql` sources) each bet report shows. */
const BET_SOURCES = Object.freeze({ originals: ['inhouse', 'og'], casino: ['gis', 'jsgamesv2', 'seamless'] });

/**
 * Branches (owner policy `branch_management`, migration 159).
 *
 * A branch is a login the Super Admin makes, outside the staff tree. It creates players — DIRECT
 * users (`parent_staff_id` NULL) with `users.branch_id` set — and sees only those: their list, their
 * ledger (`mssports.point_ledger_direct`: deposits, withdrawals, sports, casino, originals) and their
 * totals, which are the Dashboard's own figures (`DashboardStatsService` scoped to the branch), so a
 * branch report and the Dashboard never disagree on the same players. A branch moves no money.
 */
class BranchesService {
  constructor({ models, db, logger, config, clients }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.clients = clients;
    this.sequelize = models.Users.sequelize;
    this.tokens = new TokenService(config);
    this.statements = new StatementsService({ models, db, logger, config });
  }

  #query(sql, replacements = {}, options = {}) {
    return this.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, ...options });
  }

  /** The owner's switch. Off: every branch route, the sign-in included, refuses. */
  async assertEnabled() {
    if ((await sitePolicy.readPolicy(this.models, 'branch_management')) !== 'on') throw errors.DISABLED();
  }

  async #get(branchId) {
    const [branch] = await this.#query('SELECT * FROM branches WHERE id = :branchId', { branchId });
    if (!branch) throw errors.NOT_FOUND({ branchId });
    return branch;
  }

  // ══ Super Admin ═════════════════════════════════════════════════════════

  async list({ search, status, limit = 20, offset = 0 }) {
    const where = ['TRUE'];
    const replacements = { limit, offset };
    if (search) {
      where.push('(b.name ILIKE :term OR b.username ILIKE :term)');
      replacements.term = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
    }
    if (status) {
      where.push('b.status = :status');
      replacements.status = status;
    }
    const filter = where.join(' AND ');
    const [rows, [{ total }]] = await Promise.all([
      this.#query(
        `SELECT b.*, (SELECT COUNT(*)::int FROM users u WHERE u.branch_id = b.id AND u.parent_staff_id IS NULL) AS players
           FROM branches b WHERE ${filter} ORDER BY b.id DESC LIMIT :limit OFFSET :offset`,
        replacements
      ),
      this.#query(`SELECT COUNT(*)::int AS total FROM branches b WHERE ${filter}`, replacements),
    ]);
    return { total, rows: rows.map((b) => ({ ...publicBranch(b), players: b.players })) };
  }

  async create({ actor, name, username, password }) {
    const [taken] = await this.#query('SELECT 1 FROM branches WHERE LOWER(username) = LOWER(:username)', { username });
    if (taken) throw errors.USERNAME_TAKEN();
    try {
      const [branch] = await this.#query(
        `INSERT INTO branches (name, username, password, created_by) VALUES (:name, :username, :hash, :by) RETURNING *`,
        { name, username, hash: await hashPassword(password, PASSWORD_ROUNDS), by: actor.id }
      );
      this.logger?.info({ branchId: branch.id, by: actor.id }, 'Branch created');
      return { ...publicBranch(branch), players: 0 };
    } catch (error) {
      // The unique index is the guarantee; the check above only gives the common case a clean 409.
      if (error?.parent?.code === '23505') throw errors.USERNAME_TAKEN();
      throw error;
    }
  }

  /** Rename and / or activate / deactivate. Deactivating ends the branch's sessions at once. */
  async update({ branchId, name, status }) {
    if (name === undefined && status === undefined) throw errors.NOTHING_TO_UPDATE();
    const [branch] = await this.#query(
      `UPDATE branches
          SET name = COALESCE(:name, name),
              token_version = token_version + CASE WHEN :status = 'inactive' AND status <> 'inactive' THEN 1 ELSE 0 END,
              status = COALESCE(:status, status),
              updated_at = NOW()
        WHERE id = :branchId
        RETURNING *`,
      { branchId, name: name ?? null, status: status ?? null }
    );
    if (!branch) throw errors.NOT_FOUND({ branchId });
    return publicBranch(branch);
  }

  /** A new password ends the branch's sessions. */
  async setPassword({ branchId, password }) {
    const [branch] = await this.#query(
      `UPDATE branches SET password = :hash, token_version = token_version + 1, updated_at = NOW() WHERE id = :branchId RETURNING *`,
      { branchId, hash: await hashPassword(password, PASSWORD_ROUNDS) }
    );
    if (!branch) throw errors.NOT_FOUND({ branchId });
    return publicBranch(branch);
  }

  /** Every branch over one window, side by side, plus their sum. */
  async report({ from, to }) {
    const branches = await this.#query(
      `SELECT b.*, (SELECT COUNT(*)::int FROM users u WHERE u.branch_id = b.id AND u.parent_staff_id IS NULL) AS players
         FROM branches b ORDER BY b.id`
    );
    // shortcut: one dashboard series per branch (≈10 queries each); fine for tens of branches, a GROUP BY branch_id query past that.
    const rows = [];
    for (const b of branches) {
      const figures = await this.#figures(b.id, { from, to });
      rows.push({ branch: publicBranch(b), players: b.players, ...figures });
    }
    const total = { players: 0, ...Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) };
    const sums = Object.fromEntries(MONEY_KEYS.map((k) => [k, 0n]));
    for (const r of rows) {
      total.players += r.players;
      for (const k of COUNT_KEYS) total[k] += r.totals[k];
      for (const k of MONEY_KEYS) sums[k] += money.toMinorQuantised(r.totals[k]);
    }
    for (const k of MONEY_KEYS) total[k] = money.toDecimalString(sums[k]);
    return {
      range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      currency: rows[0]?.currency ?? null,
      rows,
      total,
    };
  }

  // ══ What the branch (and the Super Admin, for any branch) sees ══════════

  /** Players count + the Dashboard's figures for this branch's players over `[from, to)`. */
  async summary({ branchId, from, to }) {
    const branch = await this.#get(branchId);
    const [{ players }] = await this.#query(`SELECT COUNT(*)::int AS players FROM (${BRANCH_PLAYERS}) p`, { branchId });
    return {
      branch: publicBranch(branch),
      players,
      range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      ...(await this.#figures(branchId, { from, to })),
    };
  }

  async #figures(branchId, { from, to }) {
    const stats = new DashboardStatsService({ models: this.models, db: this.db, logger: this.logger, config: this.config, branchId });
    const r = await stats.series({ from, to, granularity: 'month' });
    return {
      currency: r.currency,
      totals: Object.fromEntries([...MONEY_KEYS, ...COUNT_KEYS].map((k) => [k, r.totals[k]])),
      /** Non-empty: amounts in a coin with no rate, left out of the converted totals. */
      unconverted: r.unconverted,
    };
  }

  async players({ branchId, search, limit = 20, offset = 0 }) {
    await this.#get(branchId);
    const where = ['u.branch_id = :branchId', 'u.parent_staff_id IS NULL'];
    const replacements = { branchId, limit, offset };
    if (search) {
      where.push('(u.name ILIKE :term OR u.id::text LIKE :idTerm)');
      replacements.term = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
      replacements.idTerm = `${search.replace(/\D/g, '') || '-'}%`;
    }
    const filter = where.join(' AND ');
    const coins = COIN_COLUMNS.map((c) => `COALESCE(c.${c}, 0) AS ${c}`).join(', ');
    const [rows, [{ total }]] = await Promise.all([
      this.#query(
        `SELECT u.id, u.name, u.email, u.phone, u.status, u.created, ${coins}
           FROM users u LEFT JOIN credits c ON c.uid = u.id
          WHERE ${filter} ORDER BY u.created DESC, u.id DESC LIMIT :limit OFFSET :offset`,
        replacements
      ),
      this.#query(`SELECT COUNT(*)::int AS total FROM users u WHERE ${filter}`, replacements),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        email: r.email ?? null,
        phone: r.phone ?? null,
        status: r.status ?? null,
        createdAt: r.created,
        // Only the coins the player holds.
        balances: Object.fromEntries(
          COIN_COLUMNS.map((c) => [c.toUpperCase(), money.fromStored(r[c] ?? '0')]).filter(([, v]) => Number(v) !== 0)
        ),
      })),
    };
  }

  /**
   * A new player of this branch: the same row a site sign-up makes (user-service `#insertPlayer`) —
   * a direct user with a referral code and a wallet — plus `branch_id`.
   */
  async createPlayer({ branchId, username, password, email, phone }) {
    const branch = await this.#get(branchId);
    const clash = await this.models.Users.findOne({
      where: { [Op.or]: [{ name: { [Op.iLike]: username } }, ...(email ? [{ email: { [Op.iLike]: email } }] : [])] },
      attributes: ['id'],
      raw: true,
    });
    if (clash) throw errors.PLAYER_EXISTS();

    const passwordHash = await hashPassword(password, PASSWORD_ROUNDS);
    const user = await this.db.transaction(async (transaction) => {
      const created = await this.models.Users.create(
        {
          id: await this.#freeUserId(transaction),
          name: username,
          email: email ?? null,
          password: passwordHash,
          phone: phone ?? null,
          parent_staff_id: null,
          role_id: PLAYER_ROLE_ID,
          friends: 'Support,',
          wallet: WALLET_SEED,
          referalcode: await this.#freeReferralCode(username, transaction),
          status: 'active',
        },
        { transaction }
      );
      // Not in the generated model (migration 159), so set beside it.
      await this.sequelize.query('UPDATE users SET branch_id = :branchId WHERE id = :id', {
        replacements: { branchId: branch.id, id: created.id },
        transaction,
      });
      await this.models.Credits.create({ uid: created.id, inr: '0' }, { transaction });
      return created;
    });

    this.logger?.info({ branchId: branch.id, userId: String(user.id) }, 'Branch player created');
    return { id: String(user.id), name: user.name, email: user.email ?? null, branchId: Number(branch.id) };
  }

  /** The ledger of the branch's players, newest first; `userId` narrows it to one of them. */
  async statement({ branchId, userId, category = 'ALL', fromDate, toDate, page = 1, limit = 50 }) {
    await this.#get(branchId);
    const where = [
      `l.user_id IN (${BRANCH_PLAYERS})`,
      'l.created_at >= CAST(:fromDate AS date)',
      'l.created_at < CAST(:toDate AS date) + 1',
    ];
    const replacements = { branchId, fromDate, toDate };
    if (userId) {
      await this.#assertPlayer(branchId, userId);
      where.push('l.user_id = :userId');
      replacements.userId = userId;
    }
    if (category !== 'ALL') {
      where.push('l.category = :category');
      replacements.category = category;
    }
    const sql = where.join(' AND ');

    const [[{ count }], rows] = await Promise.all([
      this.#query(`SELECT COUNT(*)::int AS count FROM mssports.point_ledger_direct l WHERE ${sql}`, replacements),
      this.#query(
        `SELECT l.id, l.user_id, u.name AS user_name, l.entry_ref, l.event_type, l.category, l.currency, l.delta, l.balance_after,
                l.bet_id, l.sport_id, l.game_type, l.remark, l.created_at,
                b.match_title, b.event_name, b.market_type, b.selection_name, b.fancy_name, b.bet_type,
                b.odds, b.stake_amount, b.liability, b.status AS bet_status, b.result_status,
                b.id AS bet_row_id, b.eventid, b.match_id, b.sport_id AS bet_sport_id
           FROM mssports.point_ledger_direct l
           JOIN users u ON u.id = l.user_id
           LEFT JOIN mssports."SportsBet" b ON l.category = 'SPORTS' AND b.id = l.bet_id
          WHERE ${sql}
          ORDER BY l.id DESC
          LIMIT :limit OFFSET :offset`,
        { ...replacements, limit, offset: (page - 1) * limit }
      ),
    ]);

    return {
      rows: rows.map((r) => ({ ...ledgerRow(r), user: { id: String(r.user_id), name: r.user_name } })),
      total: count,
      page,
      totalPages: Math.max(1, Math.ceil(count / limit)),
    };
  }

  /** One of the branch's players: profile and balances. */
  async player({ branchId, userId }) {
    await this.#assertPlayer(branchId, userId);
    const coins = COIN_COLUMNS.map((c) => `COALESCE(c.${c}, 0) AS ${c}`).join(', ');
    const [r] = await this.#query(
      `SELECT u.id, u.name, u.email, u.phone, u.country, u.status, u.created, u.last_ip, ${coins}
         FROM users u LEFT JOIN credits c ON c.uid = u.id WHERE u.id = :userId`,
      { userId }
    );
    return {
      id: String(r.id),
      name: r.name,
      email: r.email ?? null,
      phone: r.phone ?? null,
      country: r.country ?? null,
      status: r.status ?? null,
      createdAt: r.created,
      lastIp: r.last_ip ?? null,
      balances: Object.fromEntries(
        COIN_COLUMNS.map((c) => [c.toUpperCase(), money.fromStored(r[c] ?? '0')]).filter(([, v]) => Number(v) !== 0)
      ),
    };
  }

  /**
   * Deposits or withdrawals of the branch's players, every rail and every status, with the payment
   * method and its details — user-service's own rail list (`/internal/user/history/branch`).
   */
  async money({ branchId, kind, userId, status, fromDate, toDate, page = 1, limit = 50 }) {
    await this.#get(branchId);
    if (userId) await this.#assertPlayer(branchId, userId);
    const result = await this.clients.user.get('/internal/user/history/branch', {
      query: {
        kind,
        branchId,
        userId,
        status,
        from: `${fromDate}T00:00:00.000Z`,
        to: `${toDate}T23:59:59.999Z`,
        limit,
        offset: (page - 1) * limit,
      },
    });
    const names = await this.#names(result.rows.map((r) => r.userId));
    return {
      rows: result.rows.map((r) => ({ ...r, user: { id: String(r.userId), name: names.get(String(r.userId)) ?? null } })),
      total: result.count,
      page,
      totalPages: Math.max(1, Math.ceil(result.count / limit)),
    };
  }

  /** Originals, casino or sports bets of the branch's players — the statements module's lists. */
  async bets({ branchId, kind, userId, fromDate, toDate, page = 1, limit = 50 }) {
    await this.#get(branchId);
    let ids;
    if (userId) {
      await this.#assertPlayer(branchId, userId);
      ids = [Number(userId)];
    } else {
      ids = (await this.#query(BRANCH_PLAYERS, { branchId })).map((r) => Number(r.id));
    }
    // shortcut: the player ids go into the query as a list; fine for thousands of players, a subquery past that.
    const result = await this.statements.betsFor(ids, {
      kind: kind === 'sports' ? 'sports' : 'casino',
      sources: BET_SOURCES[kind],
      from: fromDate,
      to: toDate,
      page,
      limit,
    });
    return { rows: result.rows, total: result.total, page, totalPages: result.pagination.totalPages };
  }

  async #assertPlayer(branchId, userId) {
    const [mine] = await this.#query(`SELECT 1 FROM (${BRANCH_PLAYERS}) p WHERE p.id = :userId`, { branchId, userId });
    if (!mine) throw errors.PLAYER_NOT_FOUND({ userId });
  }

  async #names(ids) {
    const unique = [...new Set(ids.filter((id) => id != null).map(String))];
    if (!unique.length) return new Map();
    const rows = await this.#query('SELECT id::text AS id, name FROM users WHERE id::text IN (:ids)', { ids: unique });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // ══ The branch's sign-in ════════════════════════════════════════════════

  async login({ username, password }) {
    await this.assertEnabled();
    const [branch] = await this.#query('SELECT * FROM branches WHERE LOWER(username) = LOWER(:username)', { username });
    // Compared even with no branch (verifyPassword runs a dummy hash), so the timing names nobody.
    const ok = await verifyPassword(password, branch?.password);
    if (!branch || !ok) {
      this.logger?.warn({ username: String(username).slice(0, 3) + '…' }, 'Branch sign-in refused');
      throw errors.INVALID_CREDENTIALS();
    }
    if (branch.status !== 'active') throw errors.INACTIVE();
    await this.sequelize.query('UPDATE branches SET last_login_at = NOW() WHERE id = :id', { replacements: { id: branch.id } });
    return {
      token: this.tokens.signBranchToken({ branchId: branch.id, tokenVersion: branch.token_version }),
      branch: publicBranch(branch),
    };
  }

  /** The branch behind a Bearer token: active, and the token not ended by logout / password / deactivation. */
  async authenticate(raw) {
    let payload;
    try {
      payload = this.tokens.verify(raw, TOKEN_TYPES.BRANCH);
    } catch {
      throw errors.UNAUTHENTICATED();
    }
    const [branch] = await this.#query('SELECT * FROM branches WHERE id = :id', { id: Number(payload.sub) || 0 });
    if (!branch || branch.status !== 'active' || Number(branch.token_version) !== Number(payload.tv)) throw errors.UNAUTHENTICATED();
    return publicBranch(branch);
  }

  async logout(branchId) {
    await this.sequelize.query('UPDATE branches SET token_version = token_version + 1 WHERE id = :branchId', { replacements: { branchId } });
  }

  // ══ Ids, as the site's sign-up makes them ═══════════════════════════════

  async #freeUserId(transaction) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = crypto.randomInt(1_000_000_000, 9_999_999_999);
      const taken = await this.models.Users.findOne({ where: { id: candidate }, attributes: ['id'], transaction, raw: true });
      if (!taken) return candidate;
    }
    throw new Error('could not allocate an account id');
  }

  async #freeReferralCode(username, transaction) {
    const base = String(username).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'PLAYER';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = `${base}${crypto.randomInt(1000, 999_999)}`;
      const taken = await this.models.Users.findOne({ where: { referalcode: code }, attributes: ['id'], transaction, raw: true });
      if (!taken) return code;
    }
    throw new Error('could not allocate a referral code');
  }
}

module.exports = { BranchesService };
