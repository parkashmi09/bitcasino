'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { money, vipLevelFor } = require('@ibitplay/common');

const errors = require('./reports.errors');
const csv = require('./csv');
const {
  CURRENCY_COLUMNS,
  CURRENCY_SYNONYMS,
  PROVIDER_CURRENCY_ALIASES,
  SPORTS_LEDGER_REASONS,
  OPEN_BET_STATUSES,
  MAX_EXPORT_ROWS,
  MAX_PAGE_SIZE,
  RISK_LOGIN_ROWS,
  RISK_IP_ROWS,
  RISK_BET_ROWS,
} = require('./reports.constants');
const { descendantIds } = require('../staff-directory/staffDirectory.service');

/**
 * Player reports.
 *
 * Everything here is scoped to the caller's own tree. Legacy scoped none of it:
 * three of these routes had no authentication at all and the fourth reasoned
 * that ids outside a caller's downline were unobtainable.
 */
class ReportsService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The directory
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /reports/users
   *
   * The customer list, with balance and VIP standing.
   *
   * ── WHAT CHANGED, BEYOND THE AUTHENTICATION ───────────────────────────
   *
   * Legacy ran this shape:
   *
   *     users.map(async (user) => {
   *       await pg.query('SELECT * FROM credits WHERE uid = $1', [user.id]);
   *       await pg.query('SELECT wager FROM userwager WHERE uid = $1', [user.id]);
   *     })
   *
   * Two queries per user, with `limit` straight off the query string. On the
   * single shared `pg.Client` legacy used, `?limit=100000` is 200,001 queries
   * running one after another on the only connection the process has — every
   * other request on the platform waits behind it. One request, whole platform.
   *
   * Three queries total now, and the page size is capped by the validator.
   *
   * Legacy also filtered `WHERE u.parent_staff_id IS NULL`, which means the
   * "all users report" showed only DIRECT signups and silently omitted every
   * agent-managed player. That is preserved as an explicit `channel` filter
   * rather than a hidden default — an operator asking for all users gets all
   * the users they are entitled to see.
   */
  async listPlayers({ staff, channel = 'all', search, limit = 25, offset = 0 }) {
    const scope = await this.#visibleUserScope(staff, channel);
    if (scope.empty) return { total: 0, rows: [] };

    const where = { ...scope.where };

    if (search) {
      const term = `%${this.#escapeLike(String(search).trim())}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: term } },
        { referalcode: { [Op.iLike]: term } },
        ...(/^\d+$/.test(search.trim()) ? [{ id: Number(search.trim()) }] : []),
      ];
    }

    const { rows, count } = await this.models.Users.findAndCountAll({
      where,
      attributes: ['id', 'name', 'avatar', 'level', 'games_played', 'referalcode', 'parent_staff_id', 'status'],
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const ids = rows.map((r) => r.id);
    const [credits, wagers, totals] = await Promise.all([
      this.#creditsFor(ids),
      this.#wagersFor(ids),
      this.#lifetimeTotalsFor(ids),
    ]);

    return {
      total: count,
      rows: rows.map((user) =>
        this.#describePlayer(
          user,
          credits.get(String(user.id)),
          wagers.get(String(user.id)),
          { totals: totals.get(String(user.id)) }
        )
      ),
    };
  }

  /**
   * @legacy GET /reports/user/:userId
   *
   * One player's standing.
   *
   * Legacy returned `SELECT * FROM credits` — every currency column, whatever
   * they happen to be — for any id, to anybody.
   */
  async playerReport({ staff, userId }) {
    const user = await this.#assertVisible(staff, userId);

    const [credits, wagers, totals] = await Promise.all([
      this.#creditsFor([user.id]),
      this.#wagersFor([user.id]),
      this.#lifetimeTotalsFor([user.id]),
    ]);

    return this.#describePlayer(user, credits.get(String(user.id)), wagers.get(String(user.id)), {
      verbose: true,
      totals: totals.get(String(user.id)),
    });
  }

  /**
   * @legacy GET /reports/export
   *
   * The same list, as a CSV.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THIS IS THE ONE THAT LEAKED THE CUSTOMER DATABASE
   *
   * Unauthenticated, no range, no limit, no scoping: id, name, referral code,
   * balance, deposit balance, total deposited and total withdrawn for every
   * direct player on the platform, in a single GET, as a file download.
   * ─────────────────────────────────────────────────────────────────────
   *
   * Every value goes through `csv.cell` — see `csv.js` for why quoting alone
   * was not enough.
   */
  async exportPlayers({ staff, channel = 'all', search }) {
    const scope = await this.#visibleUserScope(staff, channel);

    if (!scope.empty) {
      const total = await this.models.Users.count({ where: scope.where });
      if (total > MAX_EXPORT_ROWS) throw errors.EXPORT_TOO_LARGE({ rows: total, max: MAX_EXPORT_ROWS });
    }

    // One page, but the cap above has already bounded it.
    const { rows } = scope.empty
      ? { rows: [] }
      : await this.listPlayers({ staff, channel, search, limit: MAX_EXPORT_ROWS, offset: 0 });

    this.logger?.warn(
      { staffId: staff?.id, rows: rows.length, channel },
      // An export of the customer list is worth a line at WARN whoever runs it.
      'Player CSV export generated'
    );

    const headers = [
      'ID', 'Name', 'Referral Code', 'Channel', 'Games Played', 'Level',
      'Balance (INR)', 'Total Deposited (INR)', 'Total Withdrawn (INR)',
      'Wager', 'VIP Level', 'Card Type',
    ];

    const body = rows.map((r) => [
      r.id,
      r.name,
      r.referralCode,
      r.channel,
      r.gamesPlayed,
      r.level,
      r.balance,
      r.totalDeposited,
      r.totalWithdrawn,
      r.wager,
      r.vip.level,
      r.vip.card,
    ]);

    return { csv: csv.build(headers, body), rows: rows.length };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The agent system
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/admin/agent-users
   *
   * The caller's agent tree in one read: the players anchored to a staff
   * account somewhere at or below the caller, and the staff accounts below the
   * caller who anchor them.
   *
   * ── WHY DEPOSITS ARE NOT JUST THE BANK RAIL ───────────────────────────
   *
   * An agent-system player is normally funded by their agent through
   * `staff_transfers`, not by a bank transfer of their own. Counting only
   * `fiat_deposits` and `apaydeposits` reports every one of them as having
   * deposited nothing. Agent funding is added to the two payment rails, which
   * is what legacy did here and what the balance sheet does.
   *
   * ── AND PNL IS NOT DEPOSITS MINUS WITHDRAWALS ─────────────────────────
   *
   * Those are funding. PNL is the betting result: the sports ledger plus the
   * casino ledger.
   *
   * ── ONE THING THIS DOES DIFFERENTLY FROM LEGACY ───────────────────────
   *
   * Legacy summed EVERY row of `credits_ledger` as sports PNL, because in
   * legacy the settlement worker was the only writer. In this platform
   * deposits, bonuses and swaps write there too, so a deposit counted as a bet
   * won. The reason filter is the same one the balance sheet uses — see
   * SPORTS_LEDGER_REASONS. Figures here will therefore disagree with the old
   * screen for any player who has ever been credited outside a bet, and the
   * new figure is the correct one.
   *
   * Legacy also capped the player list at a bare `LIMIT 1000` with no total, so
   * an agent with a larger book saw a truncated page presented as the whole
   * book. This pages properly and reports the count.
   */
  async agentUsers({ staff, search, limit = MAX_PAGE_SIZE, offset = 0 }) {
    /**
     * `channel: 'agent'` — an agent-system listing is by definition the players
     * with a `parent_staff_id`. Unassigned direct signups belong to the
     * customer report, not to this one, and legacy excluded them here too
     * (`WHERE u.parent_staff_id IS NOT NULL`).
     */
    const scope = await this.#visibleUserScope(staff, 'agent');
    const staffIds = (await descendantIds(this.models, staff.id, { logger: this.logger })).map(Number);

    const where = { ...scope.where };
    if (search) {
      const term = `%${this.#escapeLike(String(search).trim())}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        ...(/^\d+$/.test(search.trim()) ? [{ id: Number(search.trim()) }] : []),
      ];
    }

    const { rows: users, count } = await this.models.Users.findAndCountAll({
      where,
      attributes: [
        'id', 'name', 'email', 'country', 'phone',
        'parent_staff_id', 'system_locked', 'sports_betlocked',
      ],
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const ids = users.map((u) => u.id);

    // Four set-based reads for the page, not four per player.
    const [funding, totals, pnl, staffRows] = await Promise.all([
      this.#agentFundingFor(ids),
      this.#lifetimeTotalsFor(ids),
      this.#tradingPnlFor(ids),
      this.models.Staff.findAll({
        where: { id: staffIds },
        attributes: [
          'id', 'name', 'email', 'country', 'phone', 'role_id', 'parent_id',
          'system_locked', 'sports_betlocked', 'created_at',
        ],
        order: [['id', 'ASC']],
        raw: true,
      }),
    ]);

    const roles = await this.models.Roles.findAll({
      where: { id: [...new Set(staffRows.map((s) => s.role_id))] },
      attributes: ['id', 'name', 'level'],
      raw: true,
    });
    const roleById = new Map(roles.map((r) => [Number(r.id), r]));
    const staffById = new Map(staffRows.map((s) => [Number(s.id), s]));

    return {
      currency: 'INR',
      scope: {
        // Legacy read this off `req.staff.level === 0`. The level still says who
        // sits at the root; it is not what grants the read — the permission is.
        isSuperAdmin: Number(staff.level) === 0,
        staffId: Number(staff.id),
      },
      total: count,
      users: users.map((u) => {
        const agent = staffById.get(Number(u.parent_staff_id)) ?? null;
        const funded = funding.get(String(u.id)) ?? { in: '0.00000000', out: '0.00000000' };
        const lifetime = totals.get(String(u.id)) ?? { deposited: '0.00000000', withdrawn: '0.00000000' };
        const result = pnl.get(String(u.id)) ?? { sports: '0.00000000', casino: '0.00000000' };

        return {
          id: String(u.id),
          name: u.name ?? null,
          email: u.email ?? null,
          country: u.country ?? null,
          phone: u.phone ?? null,
          isLocked: Boolean(u.system_locked),
          sportsBetlocked: Boolean(u.sports_betlocked),
          staffId: u.parent_staff_id != null ? String(u.parent_staff_id) : null,
          staffName: agent?.name ?? null,
          staffEmail: agent?.email ?? null,
          totalDeposit: money.toDecimalString(
            money.toMinor(funded.in) + money.toMinor(lifetime.deposited)
          ),
          totalWithdrawal: money.toDecimalString(
            money.toMinor(funded.out) + money.toMinor(lifetime.withdrawn)
          ),
          sportsPnl: result.sports,
          casinoPnl: result.casino,
          pnl: money.toDecimalString(money.toMinor(result.sports) + money.toMinor(result.casino)),
        };
      }),
      /**
       * The downline, WITHOUT the caller.
       *
       * `descendantIds` includes the account it is asked about, and an operator
       * listing their downline does not mean themselves.
       */
      staff: staffRows
        .filter((s) => Number(s.id) !== Number(staff.id))
        .map((s) => {
          const role = roleById.get(Number(s.role_id)) ?? null;
          const parent = staffById.get(Number(s.parent_id)) ?? null;
          return {
            id: String(s.id),
            name: s.name ?? null,
            email: s.email ?? null,
            country: s.country ?? null,
            phone: s.phone ?? null,
            roleId: s.role_id,
            roleName: role?.name ?? null,
            roleLevel: role?.level ?? null,
            parentId: s.parent_id != null ? String(s.parent_id) : null,
            parentName: parent?.name ?? null,
            systemLocked: Boolean(s.system_locked),
            sportsBetlocked: Boolean(s.sports_betlocked),
            createdAt: s.created_at ?? null,
          };
        })
        // Seniors first, as the old screen ordered them.
        .sort((a, b) => (a.roleLevel ?? 99) - (b.roleLevel ?? 99) || Number(a.id) - Number(b.id)),
    };
  }

  /**
   * What each player's agent has put in and taken back out.
   *
   * INR only, because `staff_transfers` has no currency column — see
   * `#collectEvents`.
   */
  async #agentFundingFor(ids) {
    if (!ids.length) return new Map();

    const rows = await this.models.StaffTransfers.findAll({
      where: {
        transfer_type: 'transfer',
        [Op.or]: [
          { to_type: 'user', to_id: ids },
          { from_type: 'user', from_id: ids },
        ],
      },
      attributes: ['to_type', 'to_id', 'from_type', 'from_id', 'amount'],
      raw: true,
    });

    const totals = new Map(ids.map((id) => [String(id), { in: 0n, out: 0n }]));
    for (const row of rows) {
      // A transfer BETWEEN two players in the page counts on both sides, so
      // this is two independent checks rather than an if/else.
      if (row.to_type === 'user') {
        const entry = totals.get(String(row.to_id));
        if (entry) entry.in += money.toMinorQuantised(row.amount ?? '0');
      }
      if (row.from_type === 'user') {
        const entry = totals.get(String(row.from_id));
        if (entry) entry.out += money.toMinorQuantised(row.amount ?? '0');
      }
    }

    return new Map(
      [...totals].map(([id, value]) => [
        id,
        { in: money.toDecimalString(value.in), out: money.toDecimalString(value.out) },
      ])
    );
  }

  /**
   * Betting result per player — sports settlement plus casino, in INR.
   *
   * Both halves are grouped in the database. The casino half groups by action
   * as well, because a bet is money out and everything else is money in, and
   * `gis_transactions` records the magnitude rather than a signed amount.
   */
  async #tradingPnlFor(ids) {
    if (!ids.length) return new Map();

    const [sports, casino] = await Promise.all([
      this.models.CreditsLedger.findAll({
        where: {
          user_id: ids.map(String),
          currency: { [Op.iLike]: 'INR' },
          // See SPORTS_LEDGER_REASONS — this table is no longer sports-only.
          reason: { [Op.in]: SPORTS_LEDGER_REASONS },
        },
        attributes: [
          'user_id',
          // `netamount` is the settled result; `amount` is the fallback for
          // rows written before that column was populated.
          [fn('COALESCE', fn('SUM', fn('COALESCE', col('netamount'), col('amount'))), 0), 'total'],
        ],
        group: ['user_id'],
        raw: true,
      }),
      this.models.GisTransactions.findAll({
        where: {
          user_id: ids,
          // The provider labels this platform's INR wallet 'PKR'. Asking for
          // 'INR' alone drops every casino round ever played.
          currency: { [Op.in]: PROVIDER_CURRENCY_ALIASES.inr },
        },
        attributes: ['user_id', 'action', [fn('COALESCE', fn('SUM', col('amount')), 0), 'total']],
        group: ['user_id', 'action'],
        raw: true,
      }),
    ]);

    const result = new Map(ids.map((id) => [String(id), { sports: 0n, casino: 0n }]));

    for (const row of sports) {
      const entry = result.get(String(row.user_id));
      if (entry) entry.sports += money.toMinorQuantised(row.total ?? '0');
    }

    for (const row of casino) {
      const entry = result.get(String(row.user_id));
      if (!entry) continue;
      const total = money.toMinorQuantised(row.total ?? '0');
      entry.casino += row.action === 'bet' ? -total : total;
    }

    return new Map(
      [...result].map(([id, value]) => [
        id,
        { sports: money.toDecimalString(value.sports), casino: money.toDecimalString(value.casino) },
      ])
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Risk
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/admin/user-risk/:userId
   *
   * One player, as a risk reviewer needs to see them: who they are, what is
   * locked, what has moved, and where they have logged in from.
   *
   * The hierarchy check is `#assertVisible`, so a player outside the caller's
   * tree reads as missing rather than forbidden — "forbidden" confirms the id
   * exists, and ids are sequential.
   */
  async userRisk({ staff, userId }) {
    const user = await this.#assertVisible(staff, userId);

    const [full, agent, totals, logins, ipRows, bets] = await Promise.all([
      this.models.Users.findByPk(user.id, {
        attributes: [
          'id', 'name', 'email', 'country', 'phone', 'created', 'updated_at',
          'level', 'games_played', 'two_fa_status', 'parent_staff_id',
          'system_locked', 'lock_targetx', 'sports_betlocked', 'casino_locked',
        ],
        raw: true,
      }),
      user.parent_staff_id
        ? this.models.Staff.findByPk(user.parent_staff_id, { attributes: ['id', 'name', 'email'], raw: true })
        : null,
      this.#lifetimeTotalsFor([user.id]),
      this.models.UserLoginHistory.findAll({
        where: { user_id: user.id },
        attributes: ['id', 'ip_address', 'user_agent', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: RISK_LOGIN_ROWS,
        raw: true,
      }),
      /**
       * Grouped in the database, over ALL of a player's history.
       *
       * The distinct-IP count is a risk signal, and computing it from the last
       * fifteen logins answers a different question than the one asked — a
       * shared account looks single-IP for as long as one person is using it.
       */
      this.models.UserLoginHistory.findAll({
        where: { user_id: user.id, ip_address: { [Op.ne]: null } },
        attributes: [
          'ip_address',
          [fn('COUNT', col('id')), 'uses'],
          [fn('MIN', col('created_at')), 'first_seen'],
          [fn('MAX', col('created_at')), 'last_seen'],
        ],
        group: ['ip_address'],
        order: [[literal('MAX(created_at)'), 'DESC']],
        limit: RISK_IP_ROWS,
        raw: true,
      }),
      this.models.SportsBet.findAll({
        where: { user_id: user.id },
        attributes: ['id', 'ip_address', 'created_at', 'stake_amount', 'original_currency', 'status', 'result_status'],
        order: [['created_at', 'DESC']],
        limit: RISK_BET_ROWS,
        raw: true,
      }),
    ]);

    const lifetime = totals.get(String(user.id)) ?? { deposited: '0.00000000', withdrawn: '0.00000000' };
    const deposited = money.toMinor(lifetime.deposited);
    const withdrawn = money.toMinor(lifetime.withdrawn);
    const lastLogin = logins[0] ?? null;
    const ips = ipRows.map((r) => r.ip_address);

    return {
      currency: 'INR',
      user: {
        id: String(full.id),
        name: full.name ?? '',
        email: full.email ?? '',
        country: full.country ?? '',
        phone: full.phone ?? '',
        created: full.created ?? null,
        updatedAt: full.updated_at ?? null,
        level: Number(full.level ?? 0),
        gamesPlayed: Number(full.games_played ?? 0),
        twoFaEnabled: Boolean(full.two_fa_status),
        staffId: full.parent_staff_id != null ? String(full.parent_staff_id) : null,
        staffName: agent?.name ?? null,
        staffEmail: agent?.email ?? null,
        // Anchored to the CALLER, not merely to some agent.
        isDirect: full.parent_staff_id != null && Number(full.parent_staff_id) === Number(staff.id),
        lastIp: lastLogin?.ip_address ?? null,
        lastLoginAt: lastLogin?.created_at ?? null,
      },
      locks: {
        isLocked: Boolean(full.system_locked),
        lockTargetx: Boolean(full.lock_targetx),
        sportsBetlocked: Boolean(full.sports_betlocked),
        casinoLocked: Boolean(full.casino_locked),
      },
      financials: {
        totalDeposit: lifetime.deposited,
        totalWithdrawal: lifetime.withdrawn,
        net: money.toDecimalString(deposited - withdrawn),
      },
      activity: {
        distinctIpCount: ips.length,
        distinctIps: ips,
        ipBreakdown: ipRows.map((r) => ({
          ipAddress: r.ip_address,
          uses: Number(r.uses),
          firstSeen: r.first_seen,
          lastSeen: r.last_seen,
        })),
        recentLogins: logins.map((r) => ({
          id: r.id,
          ipAddress: r.ip_address ?? null,
          userAgent: r.user_agent ?? null,
          createdAt: r.created_at,
        })),
        recentBets: bets.map((b) => ({
          id: b.id,
          ipAddress: b.ip_address ?? null,
          createdAt: b.created_at,
          stakeAmount: b.stake_amount != null ? String(b.stake_amount) : '0',
          currency: b.original_currency ?? 'INR',
          status: b.status,
          resultStatus: b.result_status,
        })),
      },
      riskFlags: {
        multipleIps: ips.length > 1,
        twoFaDisabled: !full.two_fa_status,
        // Withdrawing nearly everything deposited is the shape of a pass-through
        // account. Guarded on a non-zero deposit — 0/0 is not a ratio.
        highWithdrawalRatio: deposited > 0n && withdrawn * 100n > deposited * 90n,
        noActivity: ips.length === 0 && bets.length === 0,
      },
    };
  }

  /**
   * An agent, as a risk reviewer needs to see them.
   *
   * There was never a legacy route for this — the screen was written against
   * one that did not exist, on either side of the port.
   */
  async staffRisk({ staff, staffId }) {
    const visible = (await descendantIds(this.models, staff.id, { logger: this.logger })).map(Number);
    if (!visible.includes(Number(staffId))) throw errors.AGENT_NOT_FOUND({ staffId });

    const subject = await this.models.Staff.findByPk(staffId, {
      attributes: [
        'id', 'name', 'email', 'country', 'phone', 'role_id', 'parent_id',
        'percentage', 'first_login', 'system_locked', 'sports_betlocked', 'created_at',
      ],
      raw: true,
    });
    if (!subject) throw errors.AGENT_NOT_FOUND({ staffId });

    // Everyone at or below the subject, and everyone above them up to the root.
    const [subtree, ancestors] = await Promise.all([
      descendantIds(this.models, staffId, { logger: this.logger }),
      this.models.StaffHierarchy.findAll({
        where: { descendant_id: staffId },
        attributes: ['ancestor_id', 'depth'],
        order: [['depth', 'DESC']],
        raw: true,
      }),
    ]);

    const subtreeIds = subtree.map(Number);
    const chainIds = ancestors.map((a) => Number(a.ancestor_id)).filter((id) => id !== Number(staffId));

    const [chainRows, roles, balance, directCount, players] = await Promise.all([
      chainIds.length
        ? this.models.Staff.findAll({ where: { id: chainIds }, attributes: ['id', 'name', 'email', 'role_id'], raw: true })
        : [],
      this.models.Roles.findAll({ attributes: ['id', 'name', 'level'], raw: true }),
      this.models.StaffBalances.findOne({ where: { staff_id: staffId }, raw: true }),
      this.models.Staff.count({ where: { parent_id: staffId } }),
      this.models.Users.findAll({
        where: { parent_staff_id: subtreeIds },
        attributes: ['id', 'system_locked'],
        raw: true,
      }),
    ]);

    const roleById = new Map(roles.map((r) => [Number(r.id), r]));
    const role = roleById.get(Number(subject.role_id)) ?? null;
    const chainById = new Map(chainRows.map((s) => [Number(s.id), s]));
    const parent = subject.parent_id != null ? chainById.get(Number(subject.parent_id)) ?? null : null;

    const playerIds = players.map((p) => p.id);
    const totals = await this.#lifetimeTotalsFor(playerIds);

    let deposited = 0n;
    let withdrawn = 0n;
    for (const id of playerIds) {
      const entry = totals.get(String(id));
      if (!entry) continue;
      deposited += money.toMinor(entry.deposited);
      withdrawn += money.toMinor(entry.withdrawn);
    }

    return {
      currency: 'INR',
      staff: {
        id: String(subject.id),
        name: subject.name ?? '',
        email: subject.email ?? '',
        country: subject.country ?? '',
        phone: subject.phone ?? '',
        roleId: subject.role_id,
        roleName: role?.name ?? null,
        roleLevel: role?.level ?? null,
        parentId: subject.parent_id != null ? String(subject.parent_id) : null,
        parentName: parent?.name ?? null,
        parentEmail: parent?.email ?? null,
        // A commission share, as a string — it multiplies money.
        percentage: subject.percentage != null ? String(subject.percentage) : null,
        // `true` means the account has never signed in and still holds the
        // password it was created with.
        firstLoginPending: Boolean(subject.first_login),
        createdAt: subject.created_at ?? null,
        // `fromStored` — `staff_balances.inr` is a bare numeric and real rows
        // carry more than eight places.
        balance: money.fromStored(balance?.inr ?? '0'),
      },
      locks: {
        systemLocked: Boolean(subject.system_locked),
        sportsBetlocked: Boolean(subject.sports_betlocked),
      },
      parentChain: ancestors
        .map((a) => ({ row: chainById.get(Number(a.ancestor_id)), depth: a.depth }))
        .filter((entry) => entry.row)
        .map(({ row, depth }) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          roleName: roleById.get(Number(row.role_id))?.name ?? null,
          depth,
        })),
      downline: {
        directStaffCount: directCount,
        // `descendantIds` includes the subject, who is not their own downline.
        subtreeStaffCount: Math.max(subtreeIds.length - 1, 0),
        playersCount: players.length,
        lockedPlayers: players.filter((p) => p.system_locked).length,
        totalDeposits: money.toDecimalString(deposited),
        totalWithdrawals: money.toDecimalString(withdrawn),
        net: money.toDecimalString(deposited - withdrawn),
      },
      riskFlags: {
        firstLoginPending: Boolean(subject.first_login),
        locked: Boolean(subject.system_locked),
        noDownline: subtreeIds.length <= 1 && players.length === 0,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The balance sheet
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/admin/balance-sheet/:userId
   *
   * Every balance-affecting event for one player, in time order, with a running
   * balance.
   *
   * The hierarchy check that legacy left out is the first thing that happens.
   */
  async balanceSheet({ staff, userId, currency = 'INR', limit = 50, offset = 0 }) {
    const asked = String(currency).toUpperCase();
    /**
     * `USD` was in legacy's whitelist and there is no `credits.usd` column, so
     * it passed the check and then 500'd on `COALESCE(c.usd, 0)`. It means the
     * dollar wallet, which is `usdt`.
     */
    const resolved = CURRENCY_SYNONYMS[asked] ?? asked;
    const column = CURRENCY_COLUMNS[resolved];
    if (!column) throw errors.UNSUPPORTED_CURRENCY({ currency: asked });

    const user = await this.#assertVisible(staff, userId);

    const [creditsRow] = await Promise.all([
      this.models.Credits.findOne({ where: { uid: user.id }, raw: true }),
    ]);

    const live = money.fromStored(creditsRow?.[column] ?? '0');

    const events = await this.#collectEvents(user.id, resolved, column);

    /**
     * Sort oldest-first, tie-broken on a source sequence.
     *
     * Casino rows share a timestamp when the provider sends none, and without
     * the tie-break the running balance for a burst of rounds comes out in an
     * arbitrary order — the totals are right, every intermediate line is wrong.
     */
    events.sort((a, b) => {
      const byTime = new Date(a.ts).getTime() - new Date(b.ts).getTime();
      return byTime || (a.seq ?? 0) - (b.seq ?? 0);
    });

    /**
     * The running balance, in exact minor units.
     *
     * Legacy carried it in a JS double and called `Math.round(n * 100) / 100`
     * after every step. Over a few thousand rows those roundings accumulate,
     * and the closing figure disagrees with the wallet by a few paise for no
     * reason a human can trace.
     */
    let running = 0n;
    let credited = 0n;
    let debited = 0n;

    for (const event of events) {
      const minor = money.toMinor(event.amount);
      running += minor;
      event.amount = money.toDecimalString(minor);
      event.balance = money.toDecimalString(running);
      if (minor >= 0n) credited += minor;
      else debited += minor;
      delete event.seq;
    }

    /**
     * Stakes on unsettled bets have left the wallet and have no settlement row
     * yet, so the wallet legitimately sits below the ledger by exactly this.
     * Sports betting is INR-only.
     */
    let openExposure = '0.00000000';
    if (column === 'inr') {
      const [open] = await this.models.SportsBet.findAll({
        where: { user_id: user.id, status: OPEN_BET_STATUSES },
        attributes: [[fn('COALESCE', fn('SUM', col('stake_amount')), 0), 'total']],
        raw: true,
      });
      openExposure = money.fromStored(open?.total ?? '0');
    }

    const ledgerClose = money.toDecimalString(running);

    // Newest first for display, page after the running balance is computed —
    // a balance that depends on the page is not a balance.
    const ordered = events.slice().reverse();

    return {
      subject: {
        id: String(user.id),
        name: user.name,
        email: user.email ?? null,
        agent: user.staff_name ?? null,
      },
      currency: resolved,
      balance: {
        live,
        ledger: ledgerClose,
        openExposure,
        /**
         * What the ledger cannot account for.
         *
         * `live + openExposure - ledger`. Non-zero means money moved through a
         * path this sheet does not read — historical GT settlements, or a
         * direct wallet write. Surfacing it is the point: legacy showed a
         * running balance that silently disagreed with the wallet and gave the
         * reader no way to tell.
         */
        unexplained: money.toDecimalString(
          money.toMinor(live) + money.toMinor(openExposure) - running
        ),
        credited: money.toDecimalString(credited),
        debited: money.toDecimalString(debited),
      },
      total: ordered.length,
      rows: ordered.slice(offset, offset + limit),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Gathering
  // ══════════════════════════════════════════════════════════════════════

  /** Every source that moves a wallet, normalised to a signed amount. */
  async #collectEvents(userId, currency, column) {
    const events = [];
    const push = (ts, category, type, description, amount, seq) =>
      events.push({ ts: ts ?? new Date(), category, type, description, amount: String(amount ?? '0'), seq });

    const uid = String(userId);

    /**
     * 1. Agent transfers. INR only — `staff_transfers` has no currency column,
     *    which is itself worth knowing: a platform that pays out in six
     *    currencies records agent movements in one.
     */
    if (column === 'inr') {
      const transfers = await this.models.StaffTransfers.findAll({
        where: {
          transfer_type: 'transfer',
          [Op.or]: [
            { to_type: 'user', to_id: userId },
            { from_type: 'user', from_id: userId },
          ],
        },
        raw: true,
      });

      for (const row of transfers) {
        const isCredit = row.to_type === 'user' && String(row.to_id) === uid;
        push(
          row.created_at,
          'Agent',
          isCredit ? 'CREDIT' : 'DEBIT',
          [isCredit ? 'Credited by agent' : 'Collected by agent', row.note].filter(Boolean).join(' — '),
          isCredit ? row.amount : `-${row.amount}`,
          Number(row.id) || 0
        );
      }
    }

    // 2. Bank deposits.
    const fiatDeposits = await this.models.FiatDeposits.findAll({
      where: {
        user_id: uid,
        currency: { [Op.iLike]: currency },
        status: { [Op.in]: ['approved', 'success', 'done', 'completed', 'Approved', 'Success'] },
      },
      raw: true,
    });
    for (const row of fiatDeposits) {
      push(row.created_at, 'Deposit', 'CREDIT', `Bank deposit${row.transaction_id ? ` (${row.transaction_id})` : ''}`, row.amount, Number(row.id) || 0);
    }

    // 3. Gateway deposits.
    const gatewayDeposits = await this.models.Apaydeposits.findAll({
      where: { user_id: uid, currency: { [Op.iLike]: currency }, status: 'Success' },
      raw: true,
    });
    for (const row of gatewayDeposits) {
      push(row.created_at, 'Deposit', 'CREDIT', `Gateway deposit${row.order_id ? ` (${row.order_id})` : ''}`, row.amount, Number(row.id) || 0);
    }

    // 4. Bank withdrawals. Anything not rejected still holds the money out.
    const fiatWithdrawals = await this.models.FiatWithdrawals.findAll({
      where: {
        uid,
        currency: { [Op.iLike]: currency },
        status: { [Op.notIn]: ['rejected', 'failed', 'Rejected', 'Failed'] },
      },
      raw: true,
    });
    for (const row of fiatWithdrawals) {
      push(row.date, 'Withdrawal', 'DEBIT', `Bank withdrawal (${row.status})`, `-${row.amount}`, Number(row.id) || 0);
    }

    // 5. Gateway withdrawals.
    const gatewayWithdrawals = await this.models.Apaywithdrawals.findAll({
      where: {
        user_id: uid,
        currency: { [Op.iLike]: currency },
        status: { [Op.in]: ['Success', 'Pending'] },
        [Op.or]: [{ refunded: false }, { refunded: null }],
      },
      raw: true,
    });
    for (const row of gatewayWithdrawals) {
      push(row.created_at, 'Withdrawal', 'DEBIT', `Gateway withdrawal (${row.status})`, `-${row.amount}`, Number(row.id) || 0);
    }

    /**
     * 6. Sports settlement.
     *
     * FILTERED BY REASON. Legacy read every row of `credits_ledger` and called
     * all of it sports, because in legacy the settlement worker was the only
     * writer. This port's deposits, bonuses and swaps write here too — reading
     * the table wholesale would count a deposit as a bet won. See
     * SPORTS_LEDGER_REASONS.
     */
    const settlements = await this.models.CreditsLedger.findAll({
      where: {
        user_id: uid,
        currency: { [Op.iLike]: currency },
        reason: { [Op.in]: SPORTS_LEDGER_REASONS },
      },
      raw: true,
    });
    for (const row of settlements) {
      const net = row.netamount != null ? row.netamount : row.amount;
      push(
        row.created_at,
        'Sports',
        money.toMinor(net) >= 0n ? 'CREDIT' : 'DEBIT',
        row.description || `Sports settlement (${row.reason || ''})`.trim(),
        net,
        Number(row.id) || 0
      );
    }

    /**
     * 7. Casino.
     *
     * The provider labels this platform's INR wallet 'PKR' and its USDT wallet
     * 'USD', so asking for currency='INR' alone silently drops every casino
     * round the player has ever played.
     */
    const providerCurrencies = PROVIDER_CURRENCY_ALIASES[column];
    if (providerCurrencies) {
      const casino = await this.models.GisTransactions.findAll({
        where: { user_id: userId, currency: { [Op.in]: providerCurrencies } },
        order: [['id', 'ASC']],
        raw: true,
      });
      for (const row of casino) {
        const isBet = row.action === 'bet';
        const minor = money.toMinor(row.amount ?? '0');
        // Zero-value win/refund rows move nothing; listing them is noise.
        if (minor === 0n) continue;
        push(
          row.transaction_datetime || row.created_at,
          'Casino',
          isBet ? 'DEBIT' : 'CREDIT',
          `Casino ${row.action}${row.round_id ? ` · round ${row.round_id}` : ''}`,
          isBet ? `-${money.toDecimalString(minor)}` : money.toDecimalString(minor),
          Number(row.id) || 0
        );
      }
    }

    return events;
  }

  // ══════════════════════════════════════════════════════════════════════

  /** The staff ids at or below the caller, and whether they see unassigned players. */
  async #visibleUserScope(staff, channel = 'all') {
    const staffIds = await descendantIds(this.models, staff.id, { logger: this.logger });

    /**
     * Staff id 1 is the platform owner and also the sentinel this codebase uses
     * for "no agent" — a direct signup has `parent_staff_id` NULL, and the
     * owner is the one who sees those.
     */
    const seesUnassigned = staffIds.map(Number).includes(1);

    if (channel === 'direct') {
      if (!seesUnassigned) return { empty: true, where: {} };
      return { empty: false, where: { parent_staff_id: null } };
    }

    if (channel === 'agent') return { empty: false, where: { parent_staff_id: staffIds } };

    return {
      empty: false,
      where: seesUnassigned
        ? { [Op.or]: [{ parent_staff_id: staffIds }, { parent_staff_id: null }] }
        : { parent_staff_id: staffIds },
    };
  }

  /**
   * Resolve a player id the caller is entitled to see, or refuse.
   *
   * One error for "no such player" and "not yours" — see the error catalogue.
   */
  async #assertVisible(staff, userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) throw errors.PLAYER_NOT_FOUND({ userId });

    const scope = await this.#visibleUserScope(staff, 'all');
    if (scope.empty) throw errors.PLAYER_NOT_FOUND({ userId });

    const user = await this.models.Users.findOne({
      where: { id, ...scope.where },
      attributes: [
        'id', 'name', 'email', 'avatar', 'level', 'games_played',
        'referalcode', 'parent_staff_id', 'status', 'created',
      ],
      raw: true,
    });

    if (!user) throw errors.PLAYER_NOT_FOUND({ userId });
    return user;
  }

  async #creditsFor(ids) {
    if (!ids.length) return new Map();
    const rows = await this.models.Credits.findAll({ where: { uid: ids }, raw: true });
    return new Map(rows.map((r) => [String(r.uid), r]));
  }

  /**
   * Lifetime wager.
   *
   * Stored as a STRING with thousands separators — `"1,234.56"`. Legacy did
   * `parseFloat(wagerString.replace(/,/g, ""))` and compared the double against
   * band boundaries that run to eleven digits, which puts a large player on the
   * wrong side of a boundary. The separators are stripped and the value is
   * carried as a decimal string into `vipLevelFor`, which is built for it.
   */
  async #wagersFor(ids) {
    if (!ids.length) return new Map();
    const rows = await this.models.Userwager.findAll({ where: { uid: ids }, raw: true });
    return new Map(rows.map((r) => [String(r.uid), String(r.wager ?? '0').replace(/,/g, '')]));
  }

  /**
   * Lifetime deposited and withdrawn, per player.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THESE ARE THE FIGURES LEGACY REPORTED AS ZERO
   *
   * The export read `credits.totaldeposited` and `credits.totalwithdrawed`.
   * Neither column exists — `credits` is a per-currency wallet and holds no
   * lifetime totals — so `undefined || 0` put a zero in every row of every
   * export the platform has ever produced. See EXPORT_TOTALS_WERE_MISSING.
   *
   * Computed from the tables that actually record the movements: bank and
   * gateway on each side. INR, matching the balance column beside it.
   * ─────────────────────────────────────────────────────────────────────
   */
  async #lifetimeTotalsFor(ids) {
    if (!ids.length) return new Map();

    const asText = ids.map(String);
    const sum = [[fn('COALESCE', fn('SUM', col('amount')), 0), 'total']];

    const [bankIn, gatewayIn, bankOut, gatewayOut] = await Promise.all([
      this.models.FiatDeposits.findAll({
        where: {
          user_id: asText,
          currency: { [Op.iLike]: 'INR' },
          status: { [Op.in]: ['approved', 'success', 'done', 'completed', 'Approved', 'Success'] },
        },
        attributes: ['user_id', ...sum],
        group: ['user_id'],
        raw: true,
      }),
      this.models.Apaydeposits.findAll({
        where: { user_id: asText, currency: { [Op.iLike]: 'INR' }, status: 'Success' },
        attributes: ['user_id', ...sum],
        group: ['user_id'],
        raw: true,
      }),
      this.models.FiatWithdrawals.findAll({
        where: {
          uid: asText,
          currency: { [Op.iLike]: 'INR' },
          // Only what actually left. A rejected withdrawal is not a withdrawal.
          status: { [Op.in]: ['approved', 'success', 'done', 'completed', 'Approved', 'Success'] },
        },
        attributes: ['uid', ...sum],
        group: ['uid'],
        raw: true,
      }),
      this.models.Apaywithdrawals.findAll({
        where: {
          user_id: asText,
          currency: { [Op.iLike]: 'INR' },
          status: 'Success',
          [Op.or]: [{ refunded: false }, { refunded: null }],
        },
        attributes: ['user_id', ...sum],
        group: ['user_id'],
        raw: true,
      }),
    ]);

    const totals = new Map(asText.map((id) => [id, { deposited: 0n, withdrawn: 0n }]));
    const add = (rows, key, side) => {
      for (const row of rows) {
        const entry = totals.get(String(row[key]));
        if (entry) entry[side] += money.toMinor(row.total ?? '0');
      }
    };

    add(bankIn, 'user_id', 'deposited');
    add(gatewayIn, 'user_id', 'deposited');
    add(bankOut, 'uid', 'withdrawn');
    add(gatewayOut, 'user_id', 'withdrawn');

    return new Map(
      [...totals].map(([id, value]) => [
        id,
        {
          deposited: money.toDecimalString(value.deposited),
          withdrawn: money.toDecimalString(value.withdrawn),
        },
      ])
    );
  }

  #describePlayer(user, credits, wager, { verbose = false, totals } = {}) {
    // `fromStored`, not `toMinor`: `credits` is bare `numeric`, and real rows
    // carry more than eight decimal places. `toMinor` refuses those, which
    // turned one over-precise balance into a 400 for the whole listing.
    const amount = (value) => money.fromStored(value ?? '0');
    const vip = vipLevelFor(wager ?? '0');

    return {
      id: String(user.id),
      name: user.name ?? null,
      avatar: user.avatar ?? null,
      level: user.level ?? 0,
      status: user.status ?? null,
      gamesPlayed: user.games_played ?? 0,
      referralCode: user.referalcode ?? null,
      channel: user.parent_staff_id == null ? 'direct' : 'agent',
      agentId: user.parent_staff_id ?? null,

      /**
       * All four of these were zero in legacy. `credits` has no `balance`,
       * `depositbalance`, `totaldeposited` or `totalwithdrawed` column —
       * `SELECT *` simply returned rows without those keys and `|| 0` did the
       * rest. See EXPORT_TOTALS_WERE_MISSING.
       */
      balance: amount(credits?.inr),
      totalDeposited: totals?.deposited ?? '0.00000000',
      totalWithdrawn: totals?.withdrawn ?? '0.00000000',
      wager: wager ?? '0',

      /**
       * The level the player HOLDS.
       *
       * Legacy put the next level in the field called `vipLevel` and the real
       * one in `previousVipLevel`, so every report showed every player a tier
       * high. `nextLevel` is named for what it is.
       */
      vip: {
        level: vip.level,
        card: vip.card,
        nextLevel: vip.nextLevel,
        wagerToNextLevel: vip.wagerToNextLevel,
        progressPct: vip.progressPct,
      },

      ...(verbose && credits
        ? {
            // The full wallet, only on the single-player read, and only the
            // columns that are money. Legacy returned `SELECT *`.
            wallets: Object.fromEntries(
              Object.entries(CURRENCY_COLUMNS)
                .map(([code, column]) => [code, amount(credits[column])])
                .filter(([, value]) => money.toMinor(value) !== 0n)
            ),
            createdAt: user.created ?? null,
          }
        : {}),
    };
  }

  /**
   * `%` and `_` are wildcards to LIKE.
   *
   * Legacy passed the search term straight into `ILIKE $1`, so a search for `_`
   * matched every player and a search for `%` returned the whole table. Not a
   * security hole — the parameter is bound — but it makes the search box lie.
   */
  #escapeLike(term) {
    return term.replace(/[\\%_]/g, (character) => `\\${character}`);
  }
}

module.exports = { ReportsService };
