'use strict';

const { Op, QueryTypes, fn, col, literal, where: sqlWhere } = require('sequelize');
const { money, resolveVipLadder, rewardCurrencyOf } = require('@ibitplay/common');
const { canManagePromotions, AGENT_TREE_LEVELS } = require('@ibitplay/auth');

const errors = require('./reports.errors');
const csv = require('./csv');
const {
  CURRENCY_COLUMNS,
  CURRENCY_SYNONYMS,
  PROVIDER_CURRENCY_ALIASES,
  SPORTS_LEDGER_REASONS,
  MAX_EXPORT_ROWS,
  RISK_LOGIN_ROWS,
  RISK_IP_ROWS,
  RISK_BET_ROWS,
  SHARED_IP_USERS,
  RISK_SHARED_ACCOUNTS,
  GEO_TOP_N,
} = require('./reports.constants');
const { isPrivateIp, deviceFromUA } = require('./ipTracker');
const { playerScope, statsWindow } = require('./audienceStats.helpers');
const { playsSql } = require('./playerStats.service');
const S = require('./stats.shared');
const { realDepositsSql } = require('./depositRails');
const { wagerValuer } = require('./reportingCurrency');
const { DIRECT_WALLET_LEDGER } = require('../dashboard/dashboard.constants');
const { WITHDRAWAL_DONE: STATS_WITHDRAWAL_DONE } = require('./audienceStats.constants');
const { visibleStaffIds } = require('../staff-directory/staffDirectory.service');
// transfer, refill, issuance, adjust — money handed over; never 'gt'/'casino'.
const { PLAYER_FUNDING_TYPES, TRANSFER_TYPE } = require('../lords/lords.constants');

/** staff_transfers types that fund an agent-tree player (DIRECT is counted from owner_direct_ledger). */
const AGENT_FUNDING_TYPES = [TRANSFER_TYPE.TRANSFER, TRANSFER_TYPE.REFILL, TRANSFER_TYPE.ISSUANCE, TRANSFER_TYPE.ADJUST];
const { gisMagnitude } = require('../statements/statements.constants');
const { casinoRoundsSql, INHOUSE_UNLEDGERED } = require('../statements/casinoRounds');
const { marketName, rateText } = require('../exchange-market/betLabels');
// The one "withdrawn" rule (bank Approved or Paid) — see dashboard.constants.js.
const { WITHDRAWAL_DONE } = require('../dashboard/dashboard.constants');

/** Withdrawals above this share of deposits flag a player (the legacy risk dialog's 0.8). */
const HIGH_WITHDRAWAL_RATIO = 0.8;

const safeMinor = (v) => {
  try { return money.toMinorQuantised(String(v ?? '0') || '0'); } catch { return 0n; }
};
/** withdrawn > 80% of deposited, in integer minor units; false when nothing was deposited. */
const overRatio = (deposited, withdrawn) => deposited > 0n && withdrawn * 10n > deposited * 8n;
const ratioOf = (deposited, withdrawn) =>
  deposited > 0n ? Math.round((Number(withdrawn) / Number(deposited)) * 1000) / 1000 : null;

/**
 * Player reports.
 *
 * Everything here is scoped to the caller's own tree. Legacy scoped none of it:
 * three of these routes had no authentication at all and the fourth reasoned
 * that ids outside a caller's downline were unobtainable.
 */

/** `credits_ledger` reasons the balance sheet reads in section 6d, with the category shown. */
/** Every user-service claim credits BONUS except the race prize and rakeback, which have their own reason. */
const OTHER_LEDGER = Object.freeze({
  credit: ['BONUS', 'TIP_RECEIVED', 'ADMIN_CREDIT', 'race_reward_claim', 'rakeback_claim'],
  debit: ['BONUS_REVERSAL', 'TIP_SENT', 'ADMIN_DEBIT'],
  category: {
    BONUS: 'Bonus', BONUS_REVERSAL: 'Bonus', TIP_RECEIVED: 'Tip', TIP_SENT: 'Tip', ADMIN_CREDIT: 'Adjustment', ADMIN_DEBIT: 'Adjustment',
    race_reward_claim: 'Race', rakeback_claim: 'Rakeback',
  },
});

const safeJson = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};
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
    // VIP standing is house-only (as on `reward-stats/vip` and the P&L costs):
    // an agent-tree caller gets `vip: null`, and the ladder is not even read.
    const house = canManagePromotions(staff);
    const [credits, wagers, totals, ladder, bets, agentParents, wagerIn] = await Promise.all([
      this.#creditsFor(ids),
      this.#wagersFor(ids),
      this.#lifetimeTotalsFor(ids),
      house ? resolveVipLadder(this.models, { logger: this.logger }) : null,
      this.#betCountsFor(ids),
      this.#agentTreeParents(rows.map((r) => r.parent_staff_id)),
      wagerValuer(this.models, staff),
    ]);

    return {
      total: count,
      rows: rows.map((user) =>
        this.#describePlayer(
          user,
          credits.get(String(user.id)),
          wagers.get(String(user.id)),
          {
            totals: totals.get(String(user.id)),
            ladder,
            bets: bets.get(String(user.id)) ?? 0,
            agentTree: agentParents.has(Number(user.parent_staff_id)),
            wagerIn,
          }
        )
      ),
    };
  }

  /**
   * GET /reports/user-list — Users page (Direct Users / Agent System / Financial) ki table.
   *
   * `listPlayers` jaisa hi (wahi scope, wahi totals), bas har row me email, phone, country,
   * parent staff aur locks bhi; search email / phone pe bhi; `withdrawLocked` filter (Financial).
   * Alag endpoint taaki `/reports/players` waisa hi rahe.
   */
  async userList({ staff, channel = 'all', search, withdrawLocked, limit = 25, offset = 0 }) {
    const scope = await this.#visibleUserScope(staff, channel);
    if (scope.empty) return { total: 0, rows: [] };

    const where = { ...scope.where };
    // Users → Financial: sirf withdrawal-locked users.
    if (withdrawLocked) where.withdraw_locked = true;

    if (search) {
      const term = `%${this.#escapeLike(String(search).trim())}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: term } },
        { referalcode: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        { phone: { [Op.iLike]: term } },
        ...(/^\d+$/.test(search.trim()) ? [{ id: Number(search.trim()) }] : []),
      ];
    }

    const { rows, count } = await this.models.Users.findAndCountAll({
      where,
      attributes: [
        'id', 'name', 'avatar', 'level', 'games_played', 'referalcode', 'parent_staff_id', 'status',
        // Users page: email, phone, country aur locks (Status / Financial).
        'email', 'phone', 'country', 'system_locked', 'is_locked', 'casino_locked', 'sports_betlocked', 'withdraw_locked',
        'originals_locked',
      ],
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const ids = rows.map((r) => r.id);
    // VIP standing is house-only (as on `reward-stats/vip` and the P&L costs):
    // an agent-tree caller gets `vip: null`, and the ladder is not even read.
    const house = canManagePromotions(staff);
    const [credits, wagers, totals, ladder, bets, agentParents, parents, wagerIn] = await Promise.all([
      this.#creditsFor(ids),
      this.#wagersFor(ids),
      this.#lifetimeTotalsFor(ids),
      house ? resolveVipLadder(this.models, { logger: this.logger }) : null,
      this.#betCountsFor(ids),
      this.#agentTreeParents(rows.map((r) => r.parent_staff_id)),
      this.#parentStaff(rows.map((r) => r.parent_staff_id)),
      wagerValuer(this.models, staff),
    ]);

    return {
      total: count,
      rows: rows.map((user) => ({
        ...this.#describePlayer(
          user,
          credits.get(String(user.id)),
          wagers.get(String(user.id)),
          {
            totals: totals.get(String(user.id)),
            ladder,
            bets: bets.get(String(user.id)) ?? 0,
            agentTree: agentParents.has(Number(user.parent_staff_id)),
            wagerIn,
          }
        ),
        email: user.email ?? null,
        phone: user.phone ?? null,
        country: user.country ?? null,
        // Agent System table ka "Parent Staff".
        parentStaff: parents.get(Number(user.parent_staff_id)) ?? null,
        locks: {
          system: Boolean(user.system_locked || user.is_locked),
          casino: Boolean(user.casino_locked),
          sports: Boolean(user.sports_betlocked),
          withdraw: Boolean(user.withdraw_locked),
          originals: Boolean(user.originals_locked),
        },
      })),
    };
  }

  /**
   * "Arrow Bow bet" for an Original Games ledger row (no transaction id: user, 2026-10-22), keyed by its ref id (the aggregator's
   * transaction id). The ledger only stores "original-games bet <tx>", so the game is read back
   * from og_transactions → og_games in one query.
   */
  async #originalGameNames(rows) {
    const refs = [];
    for (const row of rows) {
      const meta = typeof row.meta === 'string' ? safeJson(row.meta) : row.meta;
      if (meta?.refType === 'OG' && meta.refId) refs.push(String(meta.refId));
    }
    if (!refs.length) return new Map();
    const found = await this.db.sequelize.query(
      `SELECT o.transaction_id AS tx, o.kind, COALESCE(g.name, o.game_code) AS name
         FROM og_transactions o LEFT JOIN og_games g ON g.code = o.game_code
        WHERE o.transaction_id IN (:refs)`,
      { replacements: { refs }, type: QueryTypes.SELECT }
    ).catch(() => []); // no og tables in this deployment: keep the stored description
    return new Map(found.map((r) => [String(r.tx), `${r.name} ${r.kind}`]));
  }

  /** Parent staff ka naam / email (Agent System table). */
  async #parentStaff(parentIds) {
    const ids = [...new Set(parentIds.filter((id) => id != null).map(Number))].filter(Number.isSafeInteger);
    if (!ids.length) return new Map();
    const rows = await this.models.Staff.findAll({ where: { id: ids }, attributes: ['id', 'name', 'email'], raw: true });
    return new Map(rows.map((r) => [Number(r.id), { id: String(r.id), name: r.name ?? null, email: r.email ?? null }]));
  }

  /**
   * Users page ke upar ke cards — ek channel ke saare users
   * (direct = parent nahi, agent = parent hai, all = dono). Reference admin jaisa:
   *   activeUsers = played casino or sports in the last 30 days (User reports' "Active players",
   *   same sources and default window), lockedUsers = account lock,
   *   withdrawLocked = withdrawal block, totalDeposits / totalWithdrawals = lifetime (list wale hi).
   */
  async playersSummary({ staff, channel = 'all' }) {
    const zero = '0.00000000';
    const empty = { totalUsers: 0, activeUsers: 0, lockedUsers: 0, withdrawLocked: 0, totalDeposits: zero, totalWithdrawals: zero };

    const scope = await this.#visibleUserScope(staff, channel);
    if (scope.empty) return empty;

    const users = await this.models.Users.findAll({
      where: scope.where,
      attributes: ['id', 'system_locked', 'is_locked', 'withdraw_locked'],
      raw: true,
    });
    if (!users.length) return empty;

    const totals = await this.#lifetimeTotalsFor(users.map((u) => u.id));
    let deposits = 0n;
    let withdrawals = 0n;
    for (const t of totals.values()) {
      deposits += money.toMinor(t.deposited);
      withdrawals += money.toMinor(t.withdrawn);
    }
    const window = statsWindow({});
    const [{ active }] = await this.models.Users.sequelize.query(
      `SELECT COUNT(DISTINCT owner)::int AS active FROM (${playsSql((owner) => `${owner} IN (:ids)`)}) p`,
      { replacements: { ...window.replacements, ids: users.map((u) => Number(u.id)) }, type: QueryTypes.SELECT }
    );

    return {
      totalUsers: users.length,
      activeUsers: active,
      lockedUsers: users.filter((u) => u.system_locked || u.is_locked).length,
      withdrawLocked: users.filter((u) => u.withdraw_locked).length,
      totalDeposits: money.toDecimalString(deposits),
      totalWithdrawals: money.toDecimalString(withdrawals),
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

    const house = canManagePromotions(staff);
    const [credits, wagers, totals, ladder, bets, lockRow, agentParents, wagerIn] = await Promise.all([
      this.#creditsFor([user.id]),
      this.#wagersFor([user.id]),
      this.#lifetimeTotalsFor([user.id]),
      house ? resolveVipLadder(this.models, { logger: this.logger }) : null,
      this.#betCountsFor([user.id]),
      this.models.Users.findByPk(user.id, {
        attributes: ['system_locked', 'casino_locked', 'sports_betlocked', 'withdraw_locked', 'originals_locked'],
        raw: true,
      }),
      this.#agentTreeParents([user.parent_staff_id]),
      wagerValuer(this.models, staff),
    ]);

    const report = this.#describePlayer(user, credits.get(String(user.id)), wagers.get(String(user.id)), {
      verbose: true,
      totals: totals.get(String(user.id)),
      ladder,
      bets: bets.get(String(user.id)) ?? 0,
      agentTree: agentParents.has(Number(user.parent_staff_id)),
      wagerIn,
    });
    return {
      ...report,
      referredBy: await this.#referrerOf(user),
      // The lock columns `POST /admin/locks` sets, so the detail screen shows the current state.
      locks: {
        system: Boolean(lockRow?.system_locked),
        casino: Boolean(lockRow?.casino_locked),
        sports: Boolean(lockRow?.sports_betlocked),
        withdraw: Boolean(lockRow?.withdraw_locked),
        originals: Boolean(lockRow?.originals_locked),
      },
    };
  }

  /**
   * Who referred this player — `{ id, name }` or null.
   *
   * The team row is the record (it is what commission is paid on); its
   * referral code is matched first because names are mutable, the owner name
   * second. A best-effort read: a failure answers null, never a 500.
   */
  async #referrerOf(user) {
    try {
      const team = await this.models.Team.findOne({ where: { membername: user.name }, raw: true });
      if (!team) return null;
      let owner = null;
      if (team.referalCode) {
        owner = await this.models.Users.findOne({ where: { referalcode: team.referalCode }, attributes: ['id', 'name'], raw: true });
      }
      if (!owner && team.ownername) {
        owner = await this.models.Users.findOne({ where: { name: team.ownername }, attributes: ['id', 'name'], raw: true });
      }
      return owner ? { id: String(owner.id), name: owner.name ?? team.ownername } : { id: null, name: team.ownername };
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(user.id) }, 'referrer lookup failed');
      return null;
    }
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

    // The VIP columns are house-only: an agent-tree caller's file has none.
    const house = canManagePromotions(staff);
    const headers = [
      'ID', 'Name', 'Referral Code', 'Channel', 'Bets', 'Level',
      'Balance (INR)', 'Total Deposited (INR)', 'Total Withdrawn (INR)',
      'Wager',
      ...(house ? ['VIP Level', 'Card Type'] : []),
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
      ...(house ? [r.vip?.level, r.vip?.card] : []),
    ]);

    return { csv: csv.build(headers, body), rows: rows.length };
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
    const { sequelize } = this.models.UserLoginHistory;
    const { QueryTypes } = sequelize.constructor;
    const one = { replacements: { uid: user.id }, type: QueryTypes.SELECT };

    const [full, agent, totals, logins, ipRows, [ipCounts], countryRows, firstLogin, bets, casinoBets, reward, shared] = await Promise.all([
      this.models.Users.findByPk(user.id, {
        attributes: [
          'id', 'name', 'email', 'country', 'phone', 'created', 'updated_at',
          'level', 'games_played', 'two_fa_status', 'parent_staff_id',
          'system_locked', 'lock_targetx', 'sports_betlocked', 'casino_locked',
          'withdraw_locked', 'originals_locked', 'status', 'bet_status',
          // migration 058-login-geo (+ signup_region, 084)
          'last_country_code', 'last_country', 'last_city', 'last_isp',
          'signup_ip', 'signup_country_code', 'signup_country', 'signup_region', 'signup_city', 'signup_isp',
        ],
        raw: true,
      }),
      user.parent_staff_id
        ? this.models.Staff.findByPk(user.parent_staff_id, { attributes: ['id', 'name', 'email'], raw: true })
        : null,
      this.#lifetimeTotalsFor([user.id]),
      this.models.UserLoginHistory.findAll({
        where: { user_id: user.id },
        attributes: [
          'id', 'ip_address', 'user_agent', 'created_at', 'source',
          'country_code', 'country', 'region', 'city', 'isp', 'org', 'asn', 'is_proxy', 'is_hosting',
        ],
        order: [['created_at', 'DESC']],
        limit: RISK_LOGIN_ROWS,
        raw: true,
      }),
      /**
       * The rows shown, grouped in the database. Capped at RISK_IP_ROWS — the
       * COUNTS come from the next query, over all of history. They used to be
       * `ipRows.length`, so a player with 40 addresses showed 25.
       */
      this.models.UserLoginHistory.findAll({
        where: { user_id: user.id, ip_address: { [Op.ne]: null } },
        attributes: [
          'ip_address',
          [fn('COUNT', col('id')), 'uses'],
          [fn('MIN', col('created_at')), 'first_seen'],
          [fn('MAX', col('created_at')), 'last_seen'],
          // One IP sits in one place; MAX just picks the non-null lookup.
          [fn('MAX', col('country_code')), 'country_code'],
          [fn('MAX', col('country')), 'country'],
          [fn('MAX', col('region')), 'region'],
          [fn('MAX', col('city')), 'city'],
          [fn('MAX', col('isp')), 'isp'],
          [fn('MAX', col('asn')), 'asn'],
          [fn('BOOL_OR', col('is_proxy')), 'is_proxy'],
          [fn('BOOL_OR', col('is_hosting')), 'is_hosting'],
        ],
        group: ['ip_address'],
        order: [[literal('MAX(created_at)'), 'DESC']],
        limit: RISK_IP_ROWS,
        raw: true,
      }),
      sequelize.query(
        `SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT ip_address), NULL) AS ips,
                COUNT(DISTINCT country_code)::int AS countries,
                COALESCE(BOOL_OR(is_proxy IS TRUE OR is_hosting IS TRUE), FALSE) AS proxy
           FROM user_login_history WHERE user_id = :uid`,
        one
      ),
      sequelize.query(
        `SELECT country_code, MAX(country) AS country, COUNT(*)::int AS logins
           FROM user_login_history
          WHERE user_id = :uid AND country_code IS NOT NULL
          GROUP BY country_code ORDER BY logins DESC`,
        one
      ),
      // The registration fallback for accounts older than the signup columns,
      // and for players an agent created (they never passed the signup form).
      // The earliest PUBLIC address wins over a loopback one (a local test
      // login before the real one); only if there is none is a private one shown.
      this.models.UserLoginHistory.findAll({
        where: { user_id: user.id, ip_address: { [Op.ne]: null } },
        attributes: ['ip_address', 'source', 'country_code', 'country', 'region', 'city', 'isp', 'created_at'],
        order: [['created_at', 'ASC'], ['id', 'ASC']],
        limit: RISK_LOGIN_ROWS,
        raw: true,
      }).then((rows) => rows.find((r) => !isPrivateIp(r.ip_address)) ?? rows[0] ?? null),
      // Only the in-house sports book records a bet's IP (`SportsBet.ip_address`);
      // casino rounds (credits_ledger, provider tables) carry none.
      this.models.SportsBet.findAll({
        where: { user_id: user.id },
        attributes: [
          'id', 'ip_address', 'created_at', 'stake_amount', 'original_currency', 'status', 'result_status',
          'event_name', 'match_title', 'market_type', 'game_type', 'selection_name', 'fancy_name', 'bet_type', 'odds', 'size',
        ],
        order: [['created_at', 'DESC']],
        limit: RISK_BET_ROWS,
        raw: true,
      }),
      this.#recentCasinoBets(user.id),
      this.#rewardTotalsFor(user.id),
      this.#sharedWith(staff, user.id),
    ]);

    const lifetime = totals.get(String(user.id)) ?? { deposited: '0.00000000', withdrawn: '0.00000000' };
    const deposited = money.toMinor(lifetime.deposited);
    const withdrawn = money.toMinor(lifetime.withdrawn);
    const rewardDeposited = safeMinor(reward.totalDeposit);
    const rewardWithdrawn = safeMinor(reward.totalWithdrawal);
    const lastLogin = logins[0] ?? null;
    const ips = ipRows.map((r) => r.ip_address);
    const allIps = ipCounts?.ips ?? [];
    // Loopback / private addresses (a dev box, an office NAT) say nothing about
    // where a player is; they are listed, never counted toward "multiple IPs".
    const publicIps = allIps.filter((ip) => !isPrivateIp(ip));

    const registration = full.signup_ip
      ? {
          ip: full.signup_ip,
          source: 'signup',
          countryCode: full.signup_country_code ?? null,
          country: full.signup_country ?? null,
          region: full.signup_region ?? null,
          city: full.signup_city ?? null,
          isp: full.signup_isp ?? null,
        }
      : firstLogin
        ? {
            ip: firstLogin.ip_address,
            source: 'first_login',
            countryCode: firstLogin.country_code ?? null,
            country: firstLogin.country ?? null,
            region: firstLogin.region ?? null,
            city: firstLogin.city ?? null,
            isp: firstLogin.isp ?? null,
          }
        : { ip: null, source: null, countryCode: null, country: null, region: null, city: null, isp: null };
    registration.isPrivate = isPrivateIp(registration.ip);
    registration.registeredAt = full.created ?? null;
    registration.declaredCountry = full.country || null;

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
        // A direct (house) player: no parent staff, or a house account above it
        // (Super Admin / Admin / Sub Admin). The same whoever is looking — it
        // used to mean "the caller's own player", so an Agent saw its own
        // agent player labelled "Direct player".
        isDirect: !(await this.#agentTreeParents([full.parent_staff_id])).has(Number(full.parent_staff_id)),
        // The caller's own player (its direct child), which is what `isDirect` used to say.
        isOwnPlayer: full.parent_staff_id != null && Number(full.parent_staff_id) === Number(staff.id),
        lastIp: lastLogin?.ip_address ?? null,
        lastLoginAt: lastLogin?.created_at ?? null,
        lastLocation: {
          countryCode: full.last_country_code ?? null,
          country: full.last_country ?? null,
          city: full.last_city ?? null,
          isp: full.last_isp ?? null,
        },
        signup: {
          ip: full.signup_ip ?? null,
          countryCode: full.signup_country_code ?? null,
          country: full.signup_country ?? null,
          region: full.signup_region ?? null,
          city: full.signup_city ?? null,
          isp: full.signup_isp ?? null,
        },
      },
      registration,
      locks: {
        isLocked: Boolean(full.system_locked),
        lockTargetx: Boolean(full.lock_targetx),
        sportsBetlocked: Boolean(full.sports_betlocked),
        casinoLocked: Boolean(full.casino_locked),
        withdrawLocked: Boolean(full.withdraw_locked),
        originalsLocked: Boolean(full.originals_locked),
        status: full.status ?? null,
        betStatus: full.bet_status ?? null,
      },
      financials: {
        totalDeposit: lifetime.deposited,
        totalWithdrawal: lifetime.withdrawn,
        adminCredited: lifetime.adminCredited ?? '0.00000000',
        adminDebited: lifetime.adminDebited ?? '0.00000000',
        net: money.toDecimalString(deposited - withdrawn),
        // Every deposit and withdrawal (fiat, gateway, crypto) in the site's
        // reward currency at today's rates; the figures above are the same lifetime
        // totals valued in INR. A currency with no rate is named, never counted as 0.
        reward,
      },
      activity: {
        distinctIpCount: allIps.length,
        publicIpCount: publicIps.length,
        distinctIps: ips,
        countries: countryRows.map((r) => ({ countryCode: r.country_code, country: r.country ?? null, logins: Number(r.logins) })),
        ipBreakdown: ipRows.map((r) => ({
          ipAddress: r.ip_address,
          isPrivate: isPrivateIp(r.ip_address),
          uses: Number(r.uses),
          country: r.country ?? null,
          city: r.city ?? null,
          countryCode: r.country_code ?? null,
          region: r.region ?? null,
          isp: r.isp ?? null,
          asn: r.asn ?? null,
          isProxy: r.is_proxy ?? null,
          isHosting: r.is_hosting ?? null,
          firstSeen: r.first_seen,
          lastSeen: r.last_seen,
        })),
        recentLogins: logins.map((r) => ({
          id: r.id,
          ipAddress: r.ip_address ?? null,
          isPrivate: isPrivateIp(r.ip_address),
          city: r.city ?? null,
          region: r.region ?? null,
          country: r.country ?? null,
          countryCode: r.country_code ?? null,
          isp: r.isp ?? null,
          org: r.org ?? null,
          asn: r.asn ?? null,
          isProxy: r.is_proxy ?? null,
          isHosting: r.is_hosting ?? null,
          source: r.source ?? null,
          userAgent: r.user_agent ?? null,
          device: deviceFromUA(r.user_agent),
          createdAt: r.created_at,
        })),
        betIpSource: 'sports',
        recentBets: bets.map((b) => ({
          id: b.id,
          ipAddress: b.ip_address ?? null,
          createdAt: b.created_at,
          stakeAmount: b.stake_amount != null ? String(b.stake_amount) : '0',
          currency: b.original_currency ?? 'INR',
          status: b.status,
          resultStatus: b.result_status,
          event: b.event_name || b.match_title || null,
          market: marketName(b),
          selection: b.selection_name || null,
          betType: b.bet_type || null,
          odds: rateText(b),
        })),
        // Casino rounds across the four casino tables (no IP is recorded on them).
        recentCasinoBets: casinoBets,
      },
      sharedIps: shared,
      withdrawalRatio: {
        // withdrawn ÷ deposited, as a plain number for display; null when nothing was deposited.
        reward: ratioOf(rewardDeposited, rewardWithdrawn),
        inr: ratioOf(deposited, withdrawn),
        threshold: HIGH_WITHDRAWAL_RATIO,
      },
      riskFlags: {
        multipleIps: publicIps.length > 1,
        // From the geo lookup on each login (migration 058-login-geo), over all of history.
        proxyOrHosting: Boolean(ipCounts?.proxy),
        multipleCountries: Number(ipCounts?.countries ?? 0) > 1,
        sharedIp: shared.total > 0,
        twoFaDisabled: !full.two_fa_status,
        // Withdrawing most of what was deposited (> 80%) is the shape of a
        // pass-through account. Measured on every coin (the reward-currency
        // totals) and on bank + gateway INR; either one trips it. Guarded on a
        // non-zero deposit — 0/0 is not a ratio.
        highWithdrawalRatio: overRatio(deposited, withdrawn) || overRatio(rewardDeposited, rewardWithdrawn),
        // No bets or games of any kind — logins alone are not activity.
        noActivity: bets.length === 0 && casinoBets.length === 0 && Number(full.games_played ?? 0) === 0,
      },
    };
  }

  /**
   * A player's last casino rounds across the four tables the wager reports
   * read (in-house `bets`, Slotegrator `gis_transactions`, jsGames
   * `js_game_transactions` and `game_transactions`) — stake rows only, newest
   * first. Each branch is capped before the union so a busy account is four
   * index reads, not a scan. Game names are joined from the catalogues where
   * one exists; otherwise the provider's game id is shown.
   */
  async #recentCasinoBets(userId) {
    const { sequelize } = this.models.UserLoginHistory;
    const { QueryTypes } = sequelize.constructor;
    const rows = await sequelize.query(
      `SELECT * FROM (
         -- In-house rounds, jsGames v2 stake callbacks and seamless stakes — the
         -- per-player views' shared reading (statements/casinoRounds.js): a
         -- refunded round is left out, an open one shows as 'open', the v2 stake
         -- is the callback's bet_amount.
         (SELECT r.source, r.id, r.ts AS created_at, r.game, r.stake::text AS stake,
                 COALESCE(NULLIF(r.currency, ''), '?') AS currency,
                 r.status AS result,
                 CASE WHEN r.source = 'inhouse' AND r.status = 'open' THEN NULL ELSE r.net::text END AS profit
            FROM (${casinoRoundsSql()}) r
           WHERE r.n = 1
           ORDER BY r.ts DESC LIMIT :n)
         UNION ALL
         (SELECT 'gis', g.id::text, COALESCE(g.transaction_datetime, g.created_at),
                 COALESCE(gg.name, g.game_uuid), ABS(g.amount)::text,
                 CASE WHEN UPPER(g.currency) = 'PKR' THEN 'INR' ELSE UPPER(COALESCE(NULLIF(g.currency, ''), '?')) END,
                 'bet', NULL
            FROM gis_transactions g
            LEFT JOIN LATERAL (SELECT name FROM gisgamesnew WHERE uuid = g.game_uuid LIMIT 1) gg ON TRUE
           WHERE g.user_id = :uid AND LOWER(g.action) = 'bet'
           ORDER BY g.id DESC LIMIT :n)
         UNION ALL
         (SELECT 'jsgames', j.id::text, j."timestamp", COALESCE(jg.game_name, j.game_uid), ABS(j.amount)::text,
                 UPPER(COALESCE(NULLIF(j.currency, ''), '?')), LOWER(j.transaction_type), NULL
            FROM js_game_transactions j
            LEFT JOIN LATERAL (SELECT game_name FROM js_games WHERE game_uid = j.game_uid LIMIT 1) jg ON TRUE
           WHERE j.user_id = :uid AND LOWER(j.transaction_type) IN ('bet', 'loss', 'settle')
           ORDER BY j."timestamp" DESC NULLS LAST LIMIT :n)
       ) x ORDER BY created_at DESC NULLS LAST LIMIT :n`,
      { replacements: { uid: Number(userId), ids: [Number(userId)], n: RISK_BET_ROWS }, type: QueryTypes.SELECT }
    );
    return rows.map((r) => ({
      id: `${r.source}:${r.id}`,
      source: r.source,
      createdAt: r.created_at,
      game: r.game ?? null,
      stakeAmount: money.toDecimalString(money.toMinorQuantised(String(r.stake ?? '0'))),
      currency: r.currency,
      result: r.result ?? null,
      profit: r.profit == null ? null : money.toDecimalString(money.toMinorQuantised(String(r.profit))),
    }));
  }

  /**
   * Other players IN THE CALLER'S TREE who logged in from one of this player's
   * public addresses. Private and loopback addresses are left out — everyone
   * on a dev box or an office NAT would "share" them. Counted inside the tree
   * only, for the same reason as `sharedIps`.
   */
  async #sharedWith(staff, userId) {
    const scope = await this.#ipTrackerWhere(staff, {});
    if (!scope) return { total: 0, accounts: [] };
    const { sequelize } = this.models.UserLoginHistory;
    const { QueryTypes } = sequelize.constructor;

    const mine = await sequelize.query(
      'SELECT DISTINCT ip_address FROM user_login_history WHERE user_id = :uid AND ip_address IS NOT NULL',
      { replacements: { uid: userId }, type: QueryTypes.SELECT }
    );
    const ips = mine.map((r) => r.ip_address).filter((ip) => !isPrivateIp(ip));
    if (!ips.length) return { total: 0, accounts: [] };

    const rows = await sequelize.query(
      `SELECT h.user_id, u.name AS user_name,
              ARRAY_AGG(DISTINCT h.ip_address) AS ips, MAX(h.created_at) AS last_seen,
              COUNT(*) OVER ()::int AS total
         FROM user_login_history h
         JOIN users u ON u.id = h.user_id
        WHERE ${scope.sql} AND h.ip_address IN (:ips) AND h.user_id <> :uid
        GROUP BY h.user_id, u.name
        ORDER BY last_seen DESC
        LIMIT :max`,
      { replacements: { ...scope.replacements, ips, uid: userId, max: RISK_SHARED_ACCOUNTS }, type: QueryTypes.SELECT }
    );
    return {
      total: rows[0]?.total ?? 0,
      accounts: rows.map((r) => ({ id: String(r.user_id), name: r.user_name ?? '', ips: r.ips ?? [], lastSeen: r.last_seen })),
    };
  }

  /**
   * A player's lifetime deposits and withdrawals across every table and coin,
   * valued in the site's reward currency (owner policy `reward_currency`) at
   * today's `exchangerate` rates: amount × USD-per-unit ÷ reward USD-per-unit.
   * USD and USDT are 1:1 without a lookup, as everywhere else.
   */
  async #rewardTotalsFor(userId) {
    const { sequelize } = this.models.UserLoginHistory;
    const { QueryTypes } = sequelize.constructor;
    const replacements = {
      uid: String(userId),
      uidNum: Number(userId),
      okCrypto: STATS_WITHDRAWAL_DONE.withdrawals,
      okBank: STATS_WITHDRAWAL_DONE.fiat_withdrawals,
      okGateway: STATS_WITHDRAWAL_DONE.apaywithdrawals,
    };
    // Deposits: the shared real-deposit rails (no Direct User Wallet credit).
    const real = realDepositsSql({ who: (column) => ` AND ${column}::text = :uid` });
    Object.assign(replacements, real.replacements);

    const [rows, rateRows, rewardRow] = await Promise.all([
      sequelize.query(
        `SELECT side, cur, ROUND(SUM(amt), 8)::text AS amount, COUNT(*)::int AS n FROM (
           SELECT 'deposit' AS side, r.cur, r.amt FROM (${real.sql}) r
           UNION ALL
           SELECT 'withdraw', UPPER(w.coin), w.amount FROM withdrawals w
            WHERE w.uid = :uidNum AND LOWER(w.status) IN (:okCrypto)
           UNION ALL
           SELECT 'withdraw', UPPER(f.currency), f.amount FROM fiat_withdrawals f
            WHERE f.uid = :uidNum AND LOWER(f.status) IN (:okBank)
           UNION ALL
           SELECT 'withdraw', UPPER(g.currency), g.amount FROM apaywithdrawals g
            WHERE g.user_id = :uid AND LOWER(g.status) IN (:okGateway) AND g.refunded IS NOT TRUE
         ) m GROUP BY side, cur`,
        { replacements, type: QueryTypes.SELECT }
      ),
      this.models.Exchangerate.findAll({ attributes: ['currency', 'usd_rate'], raw: true }),
      this.models.SiteFeature?.findByPk
        ? this.models.SiteFeature.findByPk('reward_currency', { attributes: ['variant'], raw: true }).catch(() => null)
        : null,
    ]);

    const currency = rewardCurrencyOf(rewardRow?.variant);
    const rates = new Map(rateRows.map((r) => [String(r.currency ?? '').toUpperCase(), r.usd_rate]));
    rates.set('USD', '1');
    if (!rates.has('USDT')) rates.set('USDT', '1');
    const toMinor = (v) => {
      try { return money.toMinorQuantised(String(v ?? '0') || '0'); } catch { return 0n; }
    };
    const target = toMinor(rates.get(currency));

    const sums = { deposit: 0n, withdraw: 0n };
    const counts = { deposit: 0, withdraw: 0 };
    const unconverted = new Set();
    for (const row of rows) {
      counts[row.side] += Number(row.n);
      const amount = toMinor(row.amount);
      if (row.cur === currency) { sums[row.side] += amount; continue; }
      const rate = rates.get(String(row.cur ?? ''));
      if (rate == null || target === 0n) {
        if (amount !== 0n) unconverted.add(row.cur || 'UNKNOWN');
        continue;
      }
      sums[row.side] += (amount * toMinor(rate)) / target;
    }

    return {
      currency,
      totalDeposit: money.toDecimalString(sums.deposit),
      totalWithdrawal: money.toDecimalString(sums.withdraw),
      net: money.toDecimalString(sums.deposit - sums.withdraw),
      depositCount: counts.deposit,
      withdrawalCount: counts.withdraw,
      unconverted: [...unconverted].sort(),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Geo stats
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Where the caller's players come from: registration country and city, and
   * login country — each a count of PLAYERS, not of events, so a player who
   * logged in 300 times from India is one Indian player, and the register row
   * and the first login are never counted twice.
   *
   * Registration geo is the signup lookup (`users.signup_*`), falling back to
   * the player's earliest located login for accounts older than the signup
   * columns or created by an agent — the same fallback as the risk view.
   * Players with no located address at all (only loopback/private logins, or
   * none) are counted under `unknown`, never as a country.
   */
  async geoStats({ staff }) {
    const scope = await playerScope(this.models, staff, { logger: this.logger });
    const empty = {
      totalPlayers: 0,
      registration: { located: 0, unknown: 0, bySource: { signup: 0, firstLogin: 0 }, countries: [], cities: [] },
      login: { players: 0, countries: [] },
    };
    if (scope.empty) return empty;

    const { sequelize } = this.models.UserLoginHistory;
    const { QueryTypes } = sequelize.constructor;
    const q = (sql) => sequelize.query(sql, { replacements: { ...scope.replacements, top: GEO_TOP_N }, type: QueryTypes.SELECT });

    const regGeo = `
      SELECT u.id,
             CASE WHEN u.signup_country_code IS NOT NULL THEN 'signup'
                  WHEN f.country_code IS NOT NULL THEN 'first_login' END AS source,
             COALESCE(u.signup_country_code, f.country_code) AS country_code,
             CASE WHEN u.signup_country_code IS NOT NULL THEN u.signup_country ELSE f.country END AS country,
             CASE WHEN u.signup_country_code IS NOT NULL THEN u.signup_city ELSE f.city END AS city
        FROM users u
        LEFT JOIN LATERAL (
          SELECT h.country_code, h.country, h.city
            FROM user_login_history h
           WHERE h.user_id = u.id AND h.country_code IS NOT NULL
           ORDER BY h.created_at ASC, h.id ASC
           LIMIT 1
        ) f ON u.signup_country_code IS NULL
       WHERE ${scope.sql}`;

    const [[totals], countries, cities, [loginTotals], loginCountries] = await Promise.all([
      q(`SELECT COUNT(*)::int AS players,
                COUNT(*) FILTER (WHERE source = 'signup')::int AS signup,
                COUNT(*) FILTER (WHERE source = 'first_login')::int AS first_login
           FROM (${regGeo}) r`),
      q(`SELECT country_code, MAX(country) AS country, COUNT(*)::int AS players
           FROM (${regGeo}) r WHERE country_code IS NOT NULL
          GROUP BY country_code ORDER BY players DESC, country_code LIMIT :top`),
      q(`SELECT city, country_code, MAX(country) AS country, COUNT(*)::int AS players
           FROM (${regGeo}) r WHERE country_code IS NOT NULL AND city IS NOT NULL
          GROUP BY city, country_code ORDER BY players DESC, city LIMIT :top`),
      q(`SELECT COUNT(DISTINCT h.user_id)::int AS players
           FROM user_login_history h JOIN users u ON u.id = h.user_id
          WHERE ${scope.sql} AND h.country_code IS NOT NULL`),
      q(`SELECT h.country_code, MAX(h.country) AS country,
                COUNT(DISTINCT h.user_id)::int AS players, COUNT(*)::int AS logins
           FROM user_login_history h JOIN users u ON u.id = h.user_id
          WHERE ${scope.sql} AND h.country_code IS NOT NULL
          GROUP BY h.country_code ORDER BY players DESC, logins DESC, h.country_code LIMIT :top`),
    ]);

    const located = Number(totals?.signup ?? 0) + Number(totals?.first_login ?? 0);
    return {
      totalPlayers: Number(totals?.players ?? 0),
      registration: {
        located,
        unknown: Number(totals?.players ?? 0) - located,
        bySource: { signup: Number(totals?.signup ?? 0), firstLogin: Number(totals?.first_login ?? 0) },
        countries: countries.map((r) => ({ countryCode: r.country_code, country: r.country ?? r.country_code, players: Number(r.players) })),
        cities: cities.map((r) => ({ city: r.city, countryCode: r.country_code, country: r.country ?? r.country_code, players: Number(r.players) })),
      },
      login: {
        players: Number(loginTotals?.players ?? 0),
        countries: loginCountries.map((r) => ({
          countryCode: r.country_code,
          country: r.country ?? r.country_code,
          players: Number(r.players),
          logins: Number(r.logins),
        })),
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  IP tracker
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Every login event the caller may see, newest first.
   *
   * The same columns as a player's own Logins tab (`userRisk`), across every
   * player in the caller's tree — nothing the per-player view does not already
   * show. Players outside the tree are filtered in SQL, so they are neither
   * listed nor counted.
   */
  async ipTracker({ staff, limit = 25, offset = 0, ...filters }) {
    const scope = await this.#ipTrackerWhere(staff, filters);
    if (!scope) return { total: 0, rows: [] };

    const { sequelize } = this.models.UserLoginHistory;
    const { QueryTypes } = sequelize.constructor;
    const replacements = { ...scope.replacements, limit, offset };

    const [rows, [{ total }]] = await Promise.all([
      sequelize.query(
        `SELECT h.id, h.user_id, u.name AS user_name, h.ip_address, h.user_agent, h.created_at, h.source,
                h.country_code, h.country, h.region, h.city, h.isp, h.org, h.asn, h.is_proxy, h.is_hosting
           FROM user_login_history h
           JOIN users u ON u.id = h.user_id
          WHERE ${scope.sql}
          ORDER BY h.created_at DESC, h.id DESC
          LIMIT :limit OFFSET :offset`,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*)::int AS total
           FROM user_login_history h
           JOIN users u ON u.id = h.user_id
          WHERE ${scope.sql}`,
        { replacements, type: QueryTypes.SELECT }
      ),
    ]);

    return {
      total,
      rows: rows.map((r) => ({
        id: String(r.id),
        user: { id: String(r.user_id), name: r.user_name ?? '' },
        ipAddress: r.ip_address ?? null,
        isPrivate: isPrivateIp(r.ip_address),
        countryCode: r.country_code ?? null,
        country: r.country ?? null,
        region: r.region ?? null,
        city: r.city ?? null,
        isp: r.isp ?? null,
        org: r.org ?? null,
        asn: r.asn ?? null,
        isProxy: r.is_proxy ?? null,
        isHosting: r.is_hosting ?? null,
        source: r.source ?? null,
        userAgent: r.user_agent ?? null,
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * The multi-account check: addresses two or more of the caller's players
   * have logged in from.
   *
   * Counted inside the caller's tree only. An agent must not learn that an IP
   * is shared with a rival's players — that would leak the size and the
   * whereabouts of a downline they cannot see. The filters narrow the login
   * events first, so "shared IPs in the last week" means accounts that met on
   * that address in that week. A user search keeps the IPs where ANY of the
   * accounts matches, so searching one player shows who they share with.
   */
  async sharedIps({ staff, limit = 25, offset = 0, search, ...filters }) {
    const scope = await this.#ipTrackerWhere(staff, filters);
    if (!scope) return { total: 0, rows: [] };

    const { sequelize } = this.models.UserLoginHistory;
    const { QueryTypes } = sequelize.constructor;
    const replacements = { ...scope.replacements, limit, offset, maxUsers: SHARED_IP_USERS };

    let having = 'COUNT(DISTINCT h.user_id) >= 2';
    if (search) {
      const match = this.#userSearchSql(search, replacements);
      having += ` AND BOOL_OR(${match})`;
    }

    const grouped = `
      SELECT h.ip_address,
             COUNT(DISTINCT h.user_id)::int AS accounts,
             COUNT(*)::int AS logins,
             MIN(h.created_at) AS first_seen,
             MAX(h.created_at) AS last_seen,
             BOOL_OR(COALESCE(h.is_proxy, false) OR COALESCE(h.is_hosting, false)) AS proxy_or_hosting,
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT h.country_code), NULL) AS country_codes,
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT h.country), NULL) AS countries,
             MAX(h.isp) AS isp
        FROM user_login_history h
        JOIN users u ON u.id = h.user_id
       WHERE ${scope.sql} AND h.ip_address IS NOT NULL
       GROUP BY h.ip_address
      HAVING ${having}`;

    const [groups, [{ total }]] = await Promise.all([
      sequelize.query(`${grouped} ORDER BY accounts DESC, last_seen DESC LIMIT :limit OFFSET :offset`, {
        replacements,
        type: QueryTypes.SELECT,
      }),
      sequelize.query(`SELECT COUNT(*)::int AS total FROM (${grouped}) g`, {
        replacements,
        type: QueryTypes.SELECT,
      }),
    ]);

    if (!groups.length) return { total, rows: [] };

    // The accounts behind each address on this page, under the same filters.
    const users = await sequelize.query(
      `SELECT ip_address, user_id, user_name, logins, last_seen
         FROM (
           SELECT h.ip_address, h.user_id, u.name AS user_name,
                  COUNT(*)::int AS logins, MAX(h.created_at) AS last_seen,
                  ROW_NUMBER() OVER (PARTITION BY h.ip_address ORDER BY MAX(h.created_at) DESC) AS n
             FROM user_login_history h
             JOIN users u ON u.id = h.user_id
            WHERE ${scope.sql} AND h.ip_address IN (:pageIps)
            GROUP BY h.ip_address, h.user_id, u.name
         ) x
        WHERE n <= :maxUsers
        ORDER BY last_seen DESC`,
      {
        replacements: { ...replacements, pageIps: groups.map((g) => g.ip_address) },
        type: QueryTypes.SELECT,
      }
    );

    const byIp = new Map();
    for (const u of users) {
      if (!byIp.has(u.ip_address)) byIp.set(u.ip_address, []);
      byIp.get(u.ip_address).push({
        id: String(u.user_id),
        name: u.user_name ?? '',
        logins: Number(u.logins),
        lastSeen: u.last_seen,
      });
    }

    return {
      total,
      rows: groups.map((g) => ({
        ipAddress: g.ip_address,
        isPrivate: isPrivateIp(g.ip_address),
        accounts: Number(g.accounts),
        logins: Number(g.logins),
        firstSeen: g.first_seen,
        lastSeen: g.last_seen,
        proxyOrHosting: Boolean(g.proxy_or_hosting),
        countryCodes: g.country_codes ?? [],
        countries: g.countries ?? [],
        isp: g.isp ?? null,
        users: byIp.get(g.ip_address) ?? [],
      })),
    };
  }

  /**
   * The WHERE clause shared by both IP-tracker reads: the caller's tree, then
   * the filters. `null` when the caller can see no players at all.
   *
   * Every value is a bound replacement; the only text spliced into the SQL is
   * fixed column names chosen here.
   */
  async #ipTrackerWhere(staff, { search, ip, country, source, from, to, proxyOnly, channel } = {}) {
    const staffIds = (await visibleStaffIds(this.models, staff.id, { logger: this.logger })).map(Number);
    if (!staffIds.length) return null;

    // Staff 1 is the owner, who also sees direct signups — see #visibleUserScope.
    const seesUnassigned = staffIds.includes(1);
    const replacements = { staffIds };
    const parts = [
      seesUnassigned
        ? '(u.parent_staff_id IN (:staffIds) OR u.parent_staff_id IS NULL)'
        : 'u.parent_staff_id IN (:staffIds)',
    ];
    // Direct Users | Agent Users tab: direct = koi parent nahi, agent = agent ke neeche.
    if (channel === 'direct') parts.push('u.parent_staff_id IS NULL');
    if (channel === 'agent') parts.push('u.parent_staff_id IS NOT NULL');

    if (search) parts.push(this.#userSearchSql(search, replacements));

    if (ip) {
      const trimmed = String(ip).trim();
      if (trimmed.endsWith('*') || trimmed.endsWith('.') || trimmed.endsWith(':')) {
        // The validator admits only address characters, so there is no `%`
        // or `_` of the caller's to escape.
        replacements.ipPrefix = `${trimmed.replace(/\*$/, '')}%`;
        parts.push('h.ip_address LIKE :ipPrefix');
      } else {
        replacements.ip = trimmed;
        parts.push('h.ip_address = :ip');
      }
    }

    if (country) {
      const value = String(country).trim();
      if (/^[A-Za-z]{2}$/.test(value)) {
        replacements.countryCode = value.toUpperCase();
        parts.push('h.country_code = :countryCode');
      } else {
        replacements.country = `%${this.#escapeLike(value)}%`;
        parts.push('h.country ILIKE :country');
      }
    }

    if (source) {
      replacements.source = source;
      parts.push('h.source = :source');
    }

    if (from) {
      replacements.from = from;
      parts.push('h.created_at >= CAST(:from AS date)');
    }
    if (to) {
      // Inclusive of the whole `to` day.
      replacements.to = to;
      parts.push("h.created_at < CAST(:to AS date) + INTERVAL '1 day'");
    }

    if (proxyOnly) parts.push('(h.is_proxy IS TRUE OR h.is_hosting IS TRUE)');

    return { sql: parts.join(' AND '), replacements };
  }

  /** Name, referral code or exact id — the same search as the player list. */
  #userSearchSql(search, replacements) {
    const term = String(search).trim();
    replacements.userTerm = `%${this.#escapeLike(term)}%`;
    const clauses = ['u.name ILIKE :userTerm', 'u.referalcode ILIKE :userTerm'];
    if (/^\d+$/.test(term) && term.length < 16) {
      replacements.userId = term;
      clauses.push('u.id = CAST(:userId AS bigint)');
    }
    return `(${clauses.join(' OR ')})`;
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

    const events = await this.#collectEvents(user.id, resolved, column, user.parent_staff_id == null);

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

    const moved = [];
    for (const event of events) {
      const minor = money.toMinor(event.amount);
      delete event.seq;
      running += minor;
      event.amount = money.toDecimalString(minor);
      event.type = minor >= 0n ? 'CREDIT' : 'DEBIT';
      event.balance = money.toDecimalString(running);
      if (minor >= 0n) credited += minor;
      else debited += minor;
      moved.push(event);
    }

    /**
     * What open bets hold out of the wallet (the exchange's exposure, stored negative). The sheet
     * lists sports only as settled P/L, so `unexplained` adds it back. Sports betting is INR-only.
     */
    let openExposure = '0.00000000';
    if (column === 'inr') {
      const [open] = await this.models.Users.sequelize.query(
        'SELECT COALESCE(-SUM(total_exposure), 0) AS held FROM mssports.total_exposures WHERE user_id = :uid',
        { replacements: { uid: user.id }, type: QueryTypes.SELECT }
      );
      openExposure = money.fromStored(open?.held ?? '0');
    }

    const ledgerClose = money.toDecimalString(running);

    // Newest first for display, page after the running balance is computed —
    // a balance that depends on the page is not a balance.
    const ordered = moved.reverse();

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
         * `live + openExposure - ledger`. Non-zero means money moved through a path this sheet
         * does not read — historical GT settlements, or a direct wallet write.
         * Surfacing it is the point: legacy showed a running balance that
         * silently disagreed with the wallet and gave the reader no way to tell.
         */
        unexplained: money.toDecimalString(money.toMinor(live) + money.toMinor(openExposure) - running),
        credited: money.toDecimalString(credited),
        debited: money.toDecimalString(debited),
      },
      total: ordered.length,
      rows: ordered.slice(offset, offset + limit),
    };
  }

  /**
   * GET /reports/client-balance-sheet/:userId — client user (parent wala, Agent System) ki
   * balance sheet, `mssports.point_ledger` se (direct user wali `/balance-sheet` waisi hi rahi),
   * user ki apni wallet (`credits.id`) ki entries. INR only (points = INR).
   *
   *   Credit / Debit / User creation → "Agent" (parent ne diya / liya)
   *   Bank Deposite / Bank Withdraw   → "Deposit" / "Withdrawal" (D/W settlement)
   *   casino (category CASINO, JS games)  → "Casino"
   *   original games (category ORIGINAL_GAME) → "Original Games"
   *   bet wali entries (BET_SETTLEMENT, COMMISSION, REVERSAL) → "Sports"
   *
   * `points`: wallet ke point buckets — total (all_point), sports (sports_pts), casino
   * (thirdparty_pts, third-party games), upper / down point.
   *
   * Row ka balance = `all_point_after` (ledger ka running total). Shape direct user wali sheet jaisi,
   * taaki admin ka ek hi dialog dono dikhaye; `source: 'point_ledger'`.
   */
  async clientBalanceSheet({ staff, userId, limit = 50, offset = 0 }) {
    const user = await this.#assertVisible(staff, userId);
    // Raw SQL: the generated Credits model has no id or point columns (all_point, *_pts).
    const [creditsRow] = await this.models.Credits.sequelize.query('SELECT * FROM credits WHERE uid = :uid LIMIT 1', {
      replacements: { uid: user.id },
      type: QueryTypes.SELECT,
    });
    return this.#pointLedgerSheet(user, creditsRow, { limit, offset });
  }

  async #pointLedgerSheet(user, creditsRow, { limit, offset }) {
    const sequelize = this.models.Credits.sequelize;
    const show = (v) => money.fromStored(v ?? '0');
    const subject = { id: String(user.id), name: user.name, email: user.email ?? null, agent: null };
    if (user.parent_staff_id != null) {
      const parent = await this.models.Staff.findByPk(user.parent_staff_id, { attributes: ['name'], raw: true });
      subject.agent = parent?.name ?? null;
    }

    const walletId = creditsRow?.id;
    const zero = show(0);
    const points = {
      total: show(creditsRow?.all_point), sports: show(creditsRow?.sports_pts), casino: show(creditsRow?.thirdparty_pts),
      original: show(creditsRow?.original_game_pts),
      upper: show(creditsRow?.upper_point), down: show(creditsRow?.down_point),
      balance: show(creditsRow?.inr), credit: show(creditsRow?.credit),
    };
    if (!walletId) {
      return {
        subject, currency: 'INR', source: 'point_ledger', points,
        balance: { live: zero, ledger: zero, openExposure: zero, unexplained: zero, credited: zero, debited: zero },
        total: 0, rows: [],
      };
    }

    const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
    const [[agg], rows] = await Promise.all([
      select(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0) AS credited,
                COALESCE(SUM(delta) FILTER (WHERE delta < 0), 0) AS debited,
                COALESCE(SUM(delta), 0) AS net
           FROM mssports.point_ledger WHERE wallet_id = :walletId`,
        { walletId }
      ),
      select(
        `SELECT id, created_at, event_type, category, remark, delta, all_point_after, bet_id, entry_ref
           FROM mssports.point_ledger WHERE wallet_id = :walletId
          ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset`,
        { walletId, limit, offset }
      ),
    ]);

    const categoryOf = (r) => {
      if (r.category === 'CASINO') return 'Casino';
      if (r.category === 'ORIGINAL_GAME') return 'Original Games';
      if (r.bet_id != null || ['BET_SETTLEMENT', 'COMMISSION', 'REVERSAL'].includes(r.event_type)) return 'Sports';
      if (r.event_type === 'Bank Deposite') return 'Deposit';
      if (r.event_type === 'Bank Withdraw') return 'Withdrawal';
      return 'Agent';
    };

    // Ledger ka jod wallet ke all_point se match hona chahiye (points settle wala hi check).
    const ledger = show(agg.net);
    const unexplained = money.toDecimalString(money.toMinorQuantised(String(creditsRow.all_point ?? '0')) - money.toMinorQuantised(String(agg.net)));

    return {
      subject,
      currency: 'INR',
      source: 'point_ledger',
      points,
      balance: {
        live: show(creditsRow.inr),
        ledger,
        openExposure: zero,
        unexplained,
        credited: show(agg.credited),
        debited: show(agg.debited),
      },
      total: agg.total,
      rows: rows.map((r) => ({
        ts: r.created_at,
        category: categoryOf(r),
        type: Number(r.delta) >= 0 ? 'CREDIT' : 'DEBIT',
        description: r.remark || r.event_type,
        amount: show(r.delta),
        balance: show(r.all_point_after),
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Gathering
  // ══════════════════════════════════════════════════════════════════════

  /** Every source that moves a wallet, normalised to a signed amount. */
  async #collectEvents(userId, currency, column, direct) {
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
          transfer_type: PLAYER_FUNDING_TYPES,
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
      const via = row.network ? `Crypto deposit ${String(row.currency).toUpperCase()}·${row.network}` : 'Bank deposit';
      push(row.created_at, 'Deposit', 'CREDIT', `${via}${row.transaction_id ? ` (${row.transaction_id})` : ''}`, row.amount, Number(row.id) || 0);
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
    const ogNames = await this.#originalGameNames(settlements);
    for (const row of settlements) {
      /**
       * casino-service writes these reasons too (originals, js-games, aggregators, in-house) with
       * the signed move in `amount` and `netamount` 0 — reading netamount listed every round as an
       * empty "Sports" line. GIS rounds are read from gis_transactions in section 7.
       */
      if (row.source_service === 'casino-service') {
        const meta = typeof row.meta === 'string' ? safeJson(row.meta) : row.meta;
        if (meta?.refType === 'GIS') continue;
        const signed = money.toDecimalString(money.toMinorQuantised(String(row.amount ?? '0')));
        if (money.toMinor(signed) === 0n) continue;
        const label = (meta?.refType === 'OG' && ogNames.get(String(meta.refId ?? ''))) || row.description || row.reason;
        push(row.created_at, meta?.refType === 'OG' ? 'Original Games' : 'Casino', money.toMinor(signed) >= 0n ? 'CREDIT' : 'DEBIT', label, signed, Number(row.id) || 0);
        continue;
      }
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
     * 6b. Sports Exchange (mssports), INR: the user's bets, then each bet's P/L (`delta`) from the
     *     point ledger — `point_ledger_direct` for a direct user, `point_ledger` (the player's own
     *     wallet row) for an agent-tree user. One row per settlement / reversal, as the player's
     *     statement shows it; the stake an open bet holds is `openExposure`, not a row.
     */
    if (column === 'inr') {
      const { sequelize } = this.models.Users;
      const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
      const betIds = (await select(`SELECT id FROM mssports."SportsBet" WHERE user_id = :uid`, { uid })).map((b) => b.id);
      if (betIds.length) {
        const ledger = direct
          ? `mssports.point_ledger_direct WHERE user_id = :uid AND currency = 'INR'`
          : `mssports.point_ledger WHERE wallet_id = (SELECT id FROM public.credits WHERE uid = :uid)`;
        const rows = await select(
          `SELECT id, delta, remark, event_type, created_at FROM ${ledger}
              AND bet_id IN (:betIds) AND category = 'SPORTS' AND delta <> 0`,
          { uid, betIds }
        );
        for (const row of rows) {
          const signed = money.fromStored(row.delta);
          push(row.created_at, 'Sports', money.toMinor(signed) >= 0n ? 'CREDIT' : 'DEBIT', row.remark || row.event_type, signed, Number(row.id) || 0);
        }
      }
    }

    // 6c. Super Admin's Direct User Wallet (ADMIN_CREDIT / ADMIN_DEBIT, refType DIRECT_WALLET; debit stored negative).
    const directMoves = await this.models.CreditsLedger.findAll({
      where: {
        user_id: uid,
        currency: { [Op.iLike]: currency },
        reason: { [Op.in]: [DIRECT_WALLET_LEDGER.deposit, DIRECT_WALLET_LEDGER.withdrawal] },
        [Op.and]: [sqlWhere(literal("meta->>'refType'"), DIRECT_WALLET_LEDGER.refType)],
      },
      raw: true,
    });
    for (const row of directMoves) {
      const credit = row.reason === DIRECT_WALLET_LEDGER.deposit;
      const abs = money.toDecimalString(money.toMinorQuantised(String(row.amount ?? '0').replace(/^-/, '')));
      push(row.created_at, credit ? 'Deposit' : 'Withdrawal Taken', credit ? 'CREDIT' : 'DEBIT', row.description || (credit ? 'Admin deposit' : 'Admin withdrawal'), credit ? abs : `-${abs}`, Number(row.id) || 0);
    }

    /**
     * 6d. Promotions, tips and operator adjustments: `credits_ledger` rows no section above reads
     *     (first-deposit / VIP / claimed bonuses, their reversals, tips, staff adjustments that are
     *     not the Direct User Wallet). Without them every bonus showed as an "unexplained" mismatch.
     *     The sign comes from the reason, as in 6c — stored signs differ by writer.
     */
    const otherMoves = await this.models.CreditsLedger.findAll({
      where: {
        user_id: uid,
        currency: { [Op.iLike]: currency },
        reason: { [Op.in]: [...OTHER_LEDGER.credit, ...OTHER_LEDGER.debit] },
      },
      raw: true,
    });
    for (const row of otherMoves) {
      const meta = typeof row.meta === 'string' ? safeJson(row.meta) : row.meta;
      if (meta?.refType === DIRECT_WALLET_LEDGER.refType) continue; // read in 6c
      const credit = OTHER_LEDGER.credit.includes(row.reason);
      const abs = money.toDecimalString(money.toMinorQuantised(String(row.amount ?? '0').replace(/^-/, '')));
      push(row.created_at, OTHER_LEDGER.category[row.reason], credit ? 'CREDIT' : 'DEBIT', row.description || row.reason, credit ? abs : `-${abs}`, Number(row.id) || 0);
    }

    /**
     * 6e. Swaps (user-service swap module): one `credits_ledger` leg per currency, both reason
     *     TRANSFER_OUT / TRANSFER_IN with `meta.swap`, amount signed (out negative). Without them a
     *     player who swapped showed a mismatch on the coin swapped out, and the coin swapped in
     *     credited the next sports bet's balance jump as "Bet placed".
     *     The vault writes the same two reasons with `meta.refType` VAULT (OUT = into the vault).
     */
    const swaps = await this.models.CreditsLedger.findAll({
      where: {
        user_id: uid,
        currency: { [Op.iLike]: currency },
        reason: { [Op.in]: ['TRANSFER_IN', 'TRANSFER_OUT'] },
        [Op.or]: [sqlWhere(literal("meta->>'swap'"), 'true'), sqlWhere(literal("meta->>'refType'"), 'VAULT')],
      },
      raw: true,
    });
    for (const row of swaps) {
      const meta = typeof row.meta === 'string' ? safeJson(row.meta) : row.meta;
      const category = meta?.refType === 'VAULT' ? 'Vault' : 'Swap';
      const credit = row.reason === 'TRANSFER_IN';
      const abs = money.toDecimalString(money.toMinorQuantised(String(row.amount ?? '0').replace(/^-/, '')));
      push(row.created_at, category, credit ? 'CREDIT' : 'DEBIT', row.description || category, credit ? abs : `-${abs}`, Number(row.id) || 0);
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
        const minor = gisMagnitude(row.action, money.toMinorQuantised(row.amount ?? '0'));
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
    const staffIds = await visibleStaffIds(this.models, staff.id, { logger: this.logger });

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
   * DEPOSITED is every real deposit rail in every currency (`depositRails.js`, the definition the
   * Dashboard and User reports use) plus agent funding, valued in INR at today's rates, matching
   * the balance column beside it. WITHDRAWN: bank and gateway INR, plus agent collections.
   * The Super Admin's Direct User Wallet credit / debit is NEITHER (owner, 19 Oct 2026): it is
   * `adminCredited` / `adminDebited`, its own line, also in INR.
   * ─────────────────────────────────────────────────────────────────────
   */
  async #lifetimeTotalsFor(ids) {
    if (!ids.length) return new Map();

    const asText = ids.map(String);
    const sum = [[fn('COALESCE', fn('SUM', col('amount')), 0), 'total']];

    const { sequelize } = this.models.FiatDeposits;
    const real = realDepositsSql({ who: (column) => ` AND ${column}::text IN (:ids)` });

    const [realIn, bankOut, gatewayOut, directMoves, agentMoves, otherOut, rates] = await Promise.all([
      sequelize.query(
        `SELECT uid::text AS user_id, cur, SUM(amt)::text AS total FROM (${real.sql}) d GROUP BY 1, 2`,
        { replacements: { ...real.replacements, ids: asText }, type: QueryTypes.SELECT }
      ),
      this.models.FiatWithdrawals.findAll({
        where: {
          uid: asText,
          currency: { [Op.iLike]: 'INR' },
          // Withdrawn: Approved or Paid (WITHDRAWAL_DONE), in any case. A
          // rejected withdrawal is not a withdrawal. Paid used to be missing,
          // so a withdrawal dropped out of these totals once it was paid.
          [Op.and]: [sqlWhere(fn('LOWER', col('status')), { [Op.in]: WITHDRAWAL_DONE.fiat_withdrawals })],
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

      // Super Admin ka Direct User Wallet credit / debit (credits_ledger, debit stored negative), per currency.
      sequelize.query(
        `SELECT user_id, UPPER(currency) AS cur,
                COALESCE(SUM(ABS(amount)) FILTER (WHERE reason = :dwIn), 0)::text AS credited,
                COALESCE(SUM(ABS(amount)) FILTER (WHERE reason = :dwOut), 0)::text AS debited
           FROM credits_ledger
          WHERE user_id IN (:ids) AND reason IN (:dwIn, :dwOut) AND meta->>'refType' = :dwRef
          GROUP BY 1, 2`,
        {
          replacements: { ids: asText, dwIn: DIRECT_WALLET_LEDGER.deposit, dwOut: DIRECT_WALLET_LEDGER.withdrawal, dwRef: DIRECT_WALLET_LEDGER.refType },
          type: QueryTypes.SELECT,
        }
      ),

      // Agent → player deposit / withdraw (points settlement is P&L, not funding).
      sequelize.query(
        `SELECT CASE WHEN to_type = 'user' THEN to_id ELSE from_id END::text AS user_id,
                COALESCE(SUM(amount) FILTER (WHERE to_type = 'user'), 0) AS deposited,
                COALESCE(SUM(amount) FILTER (WHERE from_type = 'user'), 0) AS withdrawn
           FROM staff_transfers
          WHERE transfer_type IN (:types)
            AND ((to_type = 'user' AND to_id::text IN (:ids)) OR (from_type = 'user' AND from_id::text IN (:ids)))
          GROUP BY 1`,
        { replacements: { ids: asText, types: AGENT_FUNDING_TYPES }, type: QueryTypes.SELECT }
      ),

      // The WayPay payouts (same statuses as packages/common withdrawalCapFigures).
      sequelize.query(
        `SELECT user_id::text AS user_id, SUM(amount) AS withdrawn FROM pay_out_transactions
          WHERE user_id::text IN (:ids) AND upper(currency) = 'INR' AND status = 1
          GROUP BY 1`,
        { replacements: { ids: asText }, type: QueryTypes.SELECT }
      ),
      S.loadRates(this.models),
    ]);

    // Native amounts → INR at today's rate; a coin with no rate is left out (never counted as INR).
    const inr = S.createConverter(rates, null, 'INR');
    const toInr = (amount, cur) => inr.convert(S.minor(amount), cur) ?? 0n;

    const totals = new Map(asText.map((id) => [id, { deposited: 0n, withdrawn: 0n, adminCredited: 0n, adminDebited: 0n }]));
    const bump = (id, side, minor) => {
      const entry = totals.get(String(id));
      if (entry) entry[side] += minor;
    };

    for (const r of realIn) bump(r.user_id, 'deposited', toInr(r.total, r.cur));
    for (const r of bankOut) bump(r.uid, 'withdrawn', money.toMinor(r.total ?? '0'));
    for (const r of gatewayOut) bump(r.user_id, 'withdrawn', money.toMinor(r.total ?? '0'));
    for (const r of agentMoves) {
      bump(r.user_id, 'deposited', money.toMinor(r.deposited ?? '0'));
      bump(r.user_id, 'withdrawn', money.toMinor(r.withdrawn ?? '0'));
    }
    for (const r of otherOut) bump(r.user_id, 'withdrawn', money.toMinor(r.withdrawn ?? '0'));
    for (const r of directMoves) {
      bump(r.user_id, 'adminCredited', toInr(r.credited, r.cur));
      bump(r.user_id, 'adminDebited', toInr(r.debited, r.cur));
    }

    return new Map(
      [...totals].map(([id, value]) => [
        id,
        Object.fromEntries(Object.entries(value).map(([k, v]) => [k, money.toDecimalString(v)])),
      ])
    );
  }

  /**
   * Lifetime bets per player: the stake rows on `credits_ledger`, every
   * product — the count the player's Stats tab shows (`kpis.bets`).
   * `users.games_played` is only bumped by one casino path and is stale for
   * everything else, so it is not read.
   */
  async #betCountsFor(ids) {
    if (!ids.length) return new Map();
    const { sequelize } = this.models.Users;
    const rows = await sequelize.query(
      `SELECT user_id, SUM(n)::int AS n FROM (
         SELECT user_id, COUNT(*) AS n FROM credits_ledger
          WHERE user_id IN (:ids) AND reason = 'BET_STAKE' GROUP BY user_id
         UNION ALL
         -- In-house rounds with no ledger stake row (played before the engine wrote them).
         SELECT b.uid::text, COUNT(*) FROM bets b
          WHERE b.uid IN (:numIds) AND ${INHOUSE_UNLEDGERED('b')} GROUP BY b.uid
         UNION ALL
         -- Sports Exchange bets: mssports writes its own ledger, never a platform BET_STAKE row.
         SELECT s.user_id::text, COUNT(*) FROM mssports."SportsBet" s
          WHERE s.user_id IN (:numIds) GROUP BY s.user_id
       ) x GROUP BY user_id`,
      { replacements: { ids: ids.map(String), numIds: ids.map(Number) }, type: sequelize.constructor.QueryTypes.SELECT }
    );
    return new Map(rows.map((r) => [String(r.user_id), Number(r.n)]));
  }

  /**
   * Which of these parent staff ids sit in the agent tree (Super Master,
   * Master, Agent). A player under one of them is an AGENT player; a player
   * with no parent, or under a house account (Super Admin, Admin, Sub Admin),
   * is a direct / house player — whoever is looking.
   *
   * @returns {Promise<Set<number>>}
   */
  async #agentTreeParents(parentIds) {
    const ids = [...new Set(parentIds.filter((id) => id != null).map(Number))].filter(Number.isSafeInteger);
    if (!ids.length) return new Set();
    const rows = await this.models.Staff.findAll({
      where: { id: ids },
      attributes: ['id', 'role_id'],
      raw: true,
    });
    const roleIds = [...new Set(rows.map((r) => r.role_id).filter((r) => r != null))];
    const roles = roleIds.length
      ? await this.models.Roles.findAll({ where: { id: roleIds }, attributes: ['id', 'level'], raw: true })
      : [];
    const levelOf = new Map(roles.map((r) => [Number(r.id), Number(r.level)]));
    return new Set(rows.filter((r) => AGENT_TREE_LEVELS.includes(levelOf.get(Number(r.role_id)))).map((r) => Number(r.id)));
  }

  #describePlayer(user, credits, wager, { verbose = false, totals, ladder, bets = 0, agentTree = user.parent_staff_id != null, wagerIn = null } = {}) {
    // `fromStored`, not `toMinor`: `credits` is bare `numeric`, and real rows
    // carry more than eight decimal places. `toMinor` refuses those, which
    // turned one over-precise balance into a 400 for the whole listing.
    const amount = (value) => money.fromStored(value ?? '0');
    // The site's ladder, resolved once by the caller — the same one the player
    // is shown on `GET /user/vip`, so support and player never disagree.
    // No ladder means an agent-tree caller: VIP standing is house-only.
    const vip = ladder ? ladder.levelFor(wager ?? '0') : null;

    return {
      id: String(user.id),
      name: user.name ?? null,
      avatar: user.avatar ?? null,
      level: user.level ?? 0,
      status: user.status ?? null,
      // Lifetime bets from the ledger (see #betCountsFor), not `users.games_played`.
      gamesPlayed: bets,
      referralCode: user.referalcode ?? null,
      // From the parent's LEVEL, not from "has a parent": a player created by a
      // house account (e.g. the Super Admin) is a direct player, not an agent's.
      channel: agentTree ? 'agent' : 'direct',
      agentId: agentTree ? user.parent_staff_id ?? null : null,
      ownerStaffId: user.parent_staff_id ?? null,

      /**
       * All four of these were zero in legacy. `credits` has no `balance`,
       * `depositbalance`, `totaldeposited` or `totalwithdrawed` column —
       * `SELECT *` simply returned rows without those keys and `|| 0` did the
       * rest. See EXPORT_TOTALS_WERE_MISSING.
       */
      balance: amount(credits?.inr),
      totalDeposited: totals?.deposited ?? '0.00000000',
      totalWithdrawn: totals?.withdrawn ?? '0.00000000',
      /** Direct User Wallet credit / debit (INR) — its own line, never inside the deposits. */
      adminCredited: totals?.adminCredited ?? '0.00000000',
      adminDebited: totals?.adminDebited ?? '0.00000000',
      // `userwager` is counted in USD; shown in the site's default coin (`wagerValuer`).
      wager: wagerIn ? wagerIn.of(wager ?? '0') : wager ?? '0',
      wagerCurrency: wagerIn ? wagerIn.currency : 'USD',

      /**
       * The level the player HOLDS.
       *
       * Legacy put the next level in the field called `vipLevel` and the real
       * one in `previousVipLevel`, so every report showed every player a tier
       * high. `nextLevel` is named for what it is.
       */
      vip: vip && {
        level: vip.level,
        // The rank as a person reads it — "Bronze 5", "Unranked". An operator
        // looking at a report should not have to know that level 6 is Bronze 5,
        // and the number alone stopped being self-explanatory when the ladder
        // gained named tiers.
        name: vip.name,
        card: vip.card,
        nextLevel: vip.nextLevel,
        nextName: vip.nextName,
        wagerToNextLevel: wagerIn ? wagerIn.of(vip.wagerToNextLevel) : vip.wagerToNextLevel,
        wagerCurrency: wagerIn ? wagerIn.currency : 'USD',
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
