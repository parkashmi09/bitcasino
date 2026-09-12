'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./betAdmin.errors');
const { BET_STATUS } = require('../bets/bets.constants');
const { worstCase } = require('../bets/exposure');

/**
 * Reporting on the book, and locking accounts out of it.
 *
 * Everything here is scoped to the staff member's own tree, resolved from a
 * verified token. Legacy resolved it from `req.headers['x-staff-id']` — a
 * value the caller sets — in five separate handlers, and not at all in the two
 * that change a lock.
 */
class BetAdminService {
  constructor({ models, db, clients, logger, config }) {
    this.models = models;
    this.db = db;
    this.clients = clients;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reports
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/sportsmain/admin/bet-list
   * @legacy GET /sportsbetting/admin/bets
   * @legacy GET /admin/bets
   * @legacy GET /betHistory/admin/bet-history
   * @legacy GET /betHistory/user/bet-history
   *
   * Open and settled bets across the caller's tree.
   *
   * FIVE legacy endpoints over the same table, with five different shapes and
   * five different scoping stories — one used the header, one had none at all,
   * one read from `sports_bets` (a table that does not exist), and the two
   * `/betHistory` ones lived under a router that is otherwise casino.
   *
   * ── WHY THE `/betHistory` PAIR IS HERE AND NOT IN casino-service ────────
   *
   * They read `"SportsBet"`, which sports-service owns. casino-service does
   * not load the `sports` model domain, and giving it one so that a casino
   * module could read another service's table is precisely the coupling this
   * port exists to undo. Same table, same visibility rules, one implementation.
   *
   * ── AND WHAT THOSE TWO DID ──────────────────────────────────────────────
   *
   * `/betHistory/user/bet-history` took `user_id` from the QUERY STRING on a
   * router with no middleware — any player's full bet history by typing an id.
   * It also counted like this:
   *
   *     const statsQuery = `SELECT * FROM "SportsBet" WHERE user_id=$1`;
   *     const totalCount = Number(stats?.length);
   *
   * every bet the player has ever placed, read into the process, to produce
   * one number, on every page request.
   *
   * `/betHistory/admin/bet-history` scoped itself from `req.headers
   * ['x-staff-id']` — and when the header was ABSENT the `if` never fired, so
   * there was no filter at all and it returned every sports bet on the
   * platform. `findAndCountAll` and a token-derived tree here.
   */
  async listBets({ staff, status, userId, matchId, gameType, from, to, limit = 50, offset = 0 }) {
    const visible = await this.#visibleUserIds(staff);

    const where = {
      user_id: userId ? [String(userId)] : visible.map(String),
      ...(status ? { status } : {}),
      ...(matchId ? { match_id: String(matchId) } : {}),
      ...(gameType ? { game_type: gameType } : {}),
      ...this.#dateRange(from, to),
    };

    // Asking about one player outside the tree must not answer.
    if (userId && !visible.map(String).includes(String(userId))) {
      throw errors.NOT_IN_YOUR_TREE({ userId });
    }

    const { rows, count } = await this.models.SportsBet.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.user_id));

    return {
      total: count,
      rows: rows.map((r) => ({
        ...this.#shapeBet(r),
        username: names.get(String(r.user_id)) ?? null,
      })),
    };
  }

  /**
   * @legacy GET /api/sportsmain/admin/bet-ticker
   *
   * The last N bets, newest first — the live feed an operator watches.
   * Bounded, because "the ticker" on an unbounded query is the whole table.
   */
  async ticker({ staff, limit = 50 }) {
    const visible = await this.#visibleUserIds(staff);

    const rows = await this.models.SportsBet.findAll({
      where: { user_id: visible.map(String) },
      order: [['created_at', 'DESC']],
      limit,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.user_id));
    return rows.map((r) => ({ ...this.#shapeBet(r), username: names.get(String(r.user_id)) ?? null }));
  }

  /**
   * @legacy GET /api/sportsmain/admin/bet-list-by-user
   *
   * Totals per player, so an operator can see who is betting how much.
   */
  async betsByUser({ staff, from, to, limit = 50, offset = 0 }) {
    const visible = await this.#visibleUserIds(staff);

    const rows = await this.models.SportsBet.findAll({
      attributes: [
        'user_id',
        [fn('COUNT', col('id')), 'bets'],
        [fn('SUM', col('stake_amount')), 'staked'],
        [fn('SUM', col('liability')), 'liability'],
      ],
      where: { user_id: visible.map(String), ...this.#dateRange(from, to) },
      group: ['user_id'],
      order: [[fn('SUM', col('stake_amount')), 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.user_id));

    return rows.map((r) => ({
      userId: r.user_id,
      username: names.get(String(r.user_id)) ?? null,
      bets: Number(r.bets),
      staked: money.toDecimalString(money.toMinor(r.staked ?? '0')),
      liability: money.toDecimalString(money.toMinor(r.liability ?? '0')),
    }));
  }

  /**
   * @legacy GET /api/sportsmain/admin/net-exposure
   *
   * What the platform stands to lose per match.
   *
   * Summed from `user_exposures`, which is the position each player actually
   * holds — the sum of the WORST case per player per match, which is the
   * number that has been funded.
   */
  async netExposure({ staff, limit = 50, offset = 0 }) {
    const visible = await this.#visibleUserIds(staff);

    const rows = await this.models.UserExposures.findAll({
      where: { user_id: visible.map(String) },
      raw: true,
    });

    /**
     * Group to (match, player) first, take each player's worst case, then sum
     * per match.
     *
     * Legacy summed `exposure_amount` directly, which adds a player's winning
     * outcomes to their losing ones and reports a net near zero for a fully
     * hedged book. The platform's exposure is the sum of what it would pay if
     * each player's worst outcome happened, not the sum of every number in the
     * table.
     */
    const perPlayer = new Map();
    const titles = new Map();

    for (const row of rows) {
      const matchId = String(row.match_id);
      const key = `${matchId}|${row.user_id}`;
      if (!perPlayer.has(key)) perPlayer.set(key, {});
      perPlayer.get(key)[row.team_name] = money.toDecimalString(
        money.toMinor(row.exposure_amount ?? '0')
      );
      if (row.match_title) titles.set(matchId, row.match_title);
    }

    const perMatch = new Map();
    for (const [key, position] of perPlayer) {
      const matchId = key.split('|')[0];
      const current = perMatch.get(matchId) ?? { liability: '0', players: 0 };
      perMatch.set(matchId, {
        liability: money.toDecimalString(
          money.add(money.toMinor(current.liability), money.toMinor(worstCase(position)))
        ),
        players: current.players + 1,
      });
    }

    const all = [...perMatch.entries()]
      .map(([matchId, v]) => ({ matchId, matchTitle: titles.get(matchId) ?? null, ...v }))
      .sort((a, b) => money.compare(money.toMinor(b.liability), money.toMinor(a.liability)));

    return { total: all.length, rows: all.slice(offset, offset + limit) };
  }

  /**
   * @legacy GET /api/sportsmain/admin/net-exposure/market-book/:matchId
   *
   * Per-outcome book on one match: what the platform pays if each result
   * happens.
   */
  async marketBook({ staff, matchId }) {
    const visible = await this.#visibleUserIds(staff);

    const rows = await this.models.UserExposures.findAll({
      where: { user_id: visible.map(String), match_id: String(matchId) },
      raw: true,
    });

    const byOutcome = {};
    for (const row of rows) {
      const before = byOutcome[row.team_name] ?? '0';
      byOutcome[row.team_name] = money.toDecimalString(
        money.add(money.toMinor(before), money.toMinor(row.exposure_amount ?? '0'))
      );
    }

    return {
      matchId: String(matchId),
      matchTitle: rows[0]?.match_title ?? null,
      players: new Set(rows.map((r) => r.user_id)).size,
      // Positive is what the platform pays out on that outcome; negative is
      // what it keeps. Signed from the PLAYER's side throughout, consistently
      // — legacy flipped the sign in two of the four screens that read this.
      outcomes: byOutcome,
      worstCase: worstCase(
        Object.fromEntries(Object.entries(byOutcome).map(([k, v]) => [k, `-${v}`.replace('--', '')]))
      ),
    };
  }

  /**
   * @legacy POST /api/sportsmain/admin/game-report
   *
   * Staked, won and net per market over a period.
   */
  async gameReport({ staff, from, to, gameType, username, limit = 100, offset = 0 }) {
    const visible = await this.#visibleUserIds(staff);
    let scope = visible.map(String);

    if (username) {
      const user = await this.models.Users.findOne({
        where: { name: username },
        attributes: ['id'],
        raw: true,
      });
      if (!user) throw errors.USER_NOT_FOUND({ username });
      if (!scope.includes(String(user.id))) throw errors.NOT_IN_YOUR_TREE({ username });
      scope = [String(user.id)];
    }

    const rows = await this.models.SportsBet.findAll({
      attributes: [
        'game_type',
        'match_id',
        'match_title',
        [fn('COUNT', col('id')), 'bets'],
        [fn('SUM', col('stake_amount')), 'staked'],
        [fn('COUNT', literal("CASE WHEN result_status = 'won' THEN 1 END")), 'won'],
        [fn('COUNT', literal("CASE WHEN result_status = 'lost' THEN 1 END")), 'lost'],
      ],
      where: {
        user_id: scope,
        ...(gameType ? { game_type: gameType } : {}),
        ...this.#dateRange(from, to),
      },
      group: ['game_type', 'match_id', 'match_title'],
      order: [[fn('SUM', col('stake_amount')), 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return rows.map((r) => ({
      gameType: r.game_type,
      matchId: r.match_id,
      matchTitle: r.match_title,
      bets: Number(r.bets),
      staked: money.toDecimalString(money.toMinor(r.staked ?? '0')),
      won: Number(r.won),
      lost: Number(r.lost),
    }));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Locks
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /api/sportsmain/admin/betlock/users */
  async lockedUsers({ staff, lockedOnly, limit = 100, offset = 0 }) {
    const visible = await this.#visibleUserIds(staff);

    const { rows, count } = await this.models.Users.findAndCountAll({
      where: {
        id: visible,
        ...(lockedOnly ? { sports_betlocked: true } : {}),
      },
      attributes: ['id', 'name', 'sports_betlocked', 'system_locked', 'parent_staff_id'],
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((u) => ({
        userId: u.id,
        username: u.name,
        sportsLocked: Boolean(u.sports_betlocked),
        accountLocked: Boolean(u.system_locked),
        staffId: u.parent_staff_id ?? null,
      })),
    };
  }

  /**
   * @legacy POST /api/sportsmain/admin/betlock/user/toggle
   *
   * Lock or unlock one player's sports betting.
   *
   *   THE LEGACY VERSION HAD NO SCOPING AND NO AUTHENTICATION:
   *
   *       const { user_id, locked } = req.body;
   *       UPDATE users SET sports_betlocked = $1 WHERE id = $2
   *
   *   Anyone could unlock any player. The interesting direction is the unlock:
   *   a lock is what the risk team applies to an account they believe is
   *   arbitraging, and lifting it silently is how that account keeps going.
   *
   *   The player must be inside the caller's tree, and the change is audited by
   *   the route.
   */
  async setUserLock({ staff, userId, locked }) {
    const visible = await this.#visibleUserIds(staff);
    if (!visible.map(String).includes(String(userId))) throw errors.NOT_IN_YOUR_TREE({ userId });

    const [affected] = await this.models.Users.update(
      { sports_betlocked: locked },
      { where: { id: userId } }
    );
    if (!affected) throw errors.USER_NOT_FOUND({ userId });

    this.logger?.warn(
      { userId, locked, staffId: staff?.id },
      locked ? 'Player locked out of sports betting' : 'Player UNLOCKED for sports betting'
    );

    return { userId, sportsLocked: locked };
  }

  /**
   * @legacy GET /api/sportsmain/admin/betlock/staff
   * @legacy POST /api/sportsmain/admin/betlock/staff/toggle
   *
   * Staff locks live in admin-service, which owns the `staff` table. Both are
   * proxied there rather than reaching across — legacy ran
   * `UPDATE staff SET sports_betlocked = $1 WHERE id = $2` directly, with no
   * check that the target was in the caller's tree, so anyone could lock or
   * unlock an entire downline.
   */
  async staffLocks({ staff }) {
    /**
     * `/betlock/list`, not `/betlock`.
     *
     * The singular route answers ONE account's effective state
     * (`{staffId, locked, found, ...}`) — it is what the bet path consults
     * before accepting a wager. This route is the operator's LIST of the staff
     * accounts they may lock, which is `/betlock/list`. Pointing it at the
     * singular one returned a single state object where the panel expected
     * rows, so the Bet Lock screen's staff tab was permanently empty.
     */
    const result = await this.clients.admin.get(
      `/internal/admin/staff-directory/staff/${staff.id}/betlock/list`
    );
    return result?.data ?? result;
  }

  async setStaffLock({ staff, staffId, locked }) {
    const result = await this.clients.admin.post(
      `/internal/admin/staff-directory/staff/${staffId}/betlock`,
      { locked, actorStaffId: staff.id }
    );

    this.logger?.warn(
      { targetStaffId: staffId, locked, staffId: staff?.id },
      locked ? 'Staff subtree locked out of sports betting' : 'Staff subtree UNLOCKED for sports betting'
    );

    return result?.data ?? result;
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Which players this caller may see.
   *
   * The staff tree is admin-service's, resolved over the internal API from a
   * VERIFIED staff id. Legacy read the id from `req.headers['x-staff-id']`, so
   * `x-staff-id: 1` — the platform owner — returned the whole book.
   */
  async #visibleUserIds(staff) {
    let staffIds;
    try {
      const result = await this.clients.admin.get(
        `/internal/admin/staff-directory/staff/${staff.id}/descendants`
      );
      staffIds = result?.ids ?? result?.data?.ids;
    } catch (error) {
      this.logger?.error({ err: error, staffId: staff?.id }, 'Could not resolve the staff reporting scope');
      throw errors.VISIBILITY_UNAVAILABLE();
    }

    if (!Array.isArray(staffIds) || !staffIds.length) throw errors.VISIBILITY_UNAVAILABLE();

    // The platform owner also sees players with no assigned staff, which is
    // what the legacy `isSuperAdmin` branch did.
    const includeUnassigned = staffIds.map(Number).includes(1);

    const users = await this.models.Users.findAll({
      where: includeUnassigned
        ? { [Op.or]: [{ parent_staff_id: staffIds }, { parent_staff_id: null }] }
        : { parent_staff_id: staffIds },
      attributes: ['id'],
      raw: true,
    });

    return users.map((u) => u.id);
  }

  async #namesFor(ids) {
    if (!ids.length) return new Map();
    const rows = await this.models.Users.findAll({
      where: { id: { [Op.in]: [...new Set(ids.map(Number))].filter(Number.isFinite) } },
      attributes: ['id', 'name'],
      raw: true,
    });
    return new Map(rows.map((u) => [String(u.id), u.name]));
  }

  #dateRange(from, to) {
    if (!from && !to) return {};
    return {
      created_at: {
        ...(from ? { [Op.gte]: from } : {}),
        ...(to ? { [Op.lte]: to } : {}),
      },
    };
  }

  #shapeBet(row) {
    return {
      id: row.id,
      userId: row.user_id,
      matchId: row.match_id,
      matchTitle: row.match_title,
      gameType: row.game_type,
      selection: row.selection_name,
      side: row.bet_type,
      odds: String(row.odds ?? '0'),
      stake: money.toDecimalString(money.toMinor(row.stake_amount ?? '0')),
      liability: money.toDecimalString(money.toMinor(row.liability ?? '0')),
      status: row.status,
      resultStatus: row.result_status ?? null,
      // Staff see this; players do not. It is here for fraud review.
      ipAddress: row.ip_address ?? null,
      createdAt: row.created_at,
    };
  }
}

module.exports = { BetAdminService };
