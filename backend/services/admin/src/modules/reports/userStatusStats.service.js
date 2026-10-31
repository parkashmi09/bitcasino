'use strict';

const { resolveVipLadder } = require('@ibitplay/common');
const { canManagePromotions } = require('@ibitplay/auth');

const errors = require('./reports.errors');
const { playerScope, statsWindow, bucketSql, rangeSql, select, byBucket, seriesRow, percent, rangeBlock, decimal } = require('./audienceStats.helpers');
const { wagerValuer } = require('./reportingCurrency');

/**
 * Account status for the site admin's charts.
 *
 *   overview   GET /reports/user-status-stats              every account the caller may see
 *   forPlayer  GET /reports/players/:userId/status-stats   one player's standing and activity
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────
 * The SAME rule as the `reports/players` listing and the player detail
 * (`playerScope`, which mirrors `ReportsService.#visibleUserScope`). A player
 * outside the caller's tree is a 404 `REPORTS_PLAYER_NOT_FOUND`, exactly like
 * the detail route and `players/:id/stats`. The VIP figures are house-only, as
 * on the users table and `reward-stats/vip`: an agent-tree caller gets `null`.
 *
 * ── WHAT A STATUS IS ─────────────────────────────────────────────────────
 * Only what the tables hold — there is no self-exclusion, no email/phone
 * verification and no presence column on this platform:
 *
 *   closed      users.status = 'closed' (the close route; anonymised)
 *   locked      system_locked or is_locked — sign-in and everything else refused
 *   restricted  a product lock (casino_locked, sports_betlocked, withdraw_locked,
 *               originals_locked)
 *               or bet_status other than 'active'
 *   active      none of the above
 *   <other>     any other users.status value, as written
 *
 * KYC is `user_kyc.status`, lower-cased; no row or `Unverified` is `none`.
 *
 * ── STATUS CHANGES OVER TIME ─────────────────────────────────────────────
 * Signups are `users.created`. Locks, closures and KYC decisions have no
 * timestamp on the account itself: they are counted from the audit trail
 * (`admin_activity_logs`, successful `account.lock` / `user.close` /
 * `kyc.review` rows on a USER target), which every such route writes.
 * Activity is a login (`user_login_history`) or a counted bet (`wager_activity`).
 */

const EFFECTIVE_STATUS = (u) => `CASE
    WHEN LOWER(COALESCE(${u}.status, 'active')) = 'closed' THEN 'closed'
    WHEN ${u}.system_locked IS TRUE OR ${u}.is_locked IS TRUE THEN 'locked'
    WHEN ${u}.casino_locked IS TRUE OR ${u}.sports_betlocked IS TRUE OR ${u}.withdraw_locked IS TRUE
      OR ${u}.originals_locked IS TRUE
      OR LOWER(COALESCE(NULLIF(${u}.bet_status, ''), 'active')) <> 'active' THEN 'restricted'
    WHEN LOWER(COALESCE(NULLIF(${u}.status, ''), 'active')) = 'active' THEN 'active'
    ELSE LOWER(${u}.status) END`;

const KYC_STATUS = (k) => `CASE
    WHEN ${k}.id IS NULL OR LOWER(COALESCE(${k}.status, '')) IN ('', 'unverified') THEN 'none'
    ELSE LOWER(${k}.status) END`;

/** `users.id` from an audit row's text `target_id`, or NULL when it is not one. */
const TARGET_USER = `(CASE WHEN a.target_id ~ '^[0-9]{1,18}$' THEN a.target_id::bigint END)`;

const EVENT_ACTIONS = Object.freeze(['account.lock', 'user.close', 'kyc.review']);

const STATUS_LABELS = Object.freeze({ active: 'Active', restricted: 'Product-restricted', locked: 'Locked', closed: 'Closed' });
const STATUS_ORDER = ['active', 'restricted', 'locked', 'closed'];
const KYC_LABELS = Object.freeze({ none: 'Not submitted', pending: 'Pending', verified: 'Verified', rejected: 'Rejected' });
const KYC_ORDER = ['none', 'pending', 'verified', 'rejected'];

const titleCase = (s) => String(s ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Known keys first in their order, then anything else the table holds, largest first. */
function ordered(rows, order, labels) {
  const map = new Map(rows.map((r) => [r.key, Number(r.n)]));
  const known = order.map((key) => ({ key, label: labels[key], value: map.get(key) ?? 0 }));
  const rest = [...map]
    .filter(([key]) => !order.includes(key))
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: titleCase(key), value }));
  return [...known, ...rest];
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

class UserStatusStatsService {
  constructor({ models, logger, config }) {
    this.models = models;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Every account
  // ══════════════════════════════════════════════════════════════════════

  async overview({ staff, from, to, granularity, channel = 'all' }) {
    const window = statsWindow({ from, to, granularity });
    const scope = await playerScope(this.models, staff, { channel, logger: this.logger });
    const house = canManagePromotions(staff);
    if (scope.empty) return this.#emptyOverview(window, channel, house);

    const base = { ...window.replacements, ...scope.replacements };
    const ladder = house ? await resolveVipLadder(this.models, { logger: this.logger }) : null;

    const [totals, statusRows, kycRows, signups, events, activity, activeTotal, vipRows] = await Promise.all([
      select(
        this.models,
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE u.parent_staff_id IS NULL)::int AS direct,
                COUNT(*) FILTER (WHERE u.system_locked IS TRUE OR u.is_locked IS TRUE)::int AS system_locked,
                COUNT(*) FILTER (WHERE u.casino_locked IS TRUE)::int AS casino_locked,
                COUNT(*) FILTER (WHERE u.sports_betlocked IS TRUE)::int AS sports_locked,
                COUNT(*) FILTER (WHERE u.withdraw_locked IS TRUE)::int AS withdraw_locked,
                COUNT(*) FILTER (WHERE u.originals_locked IS TRUE)::int AS originals_locked,
                COUNT(*) FILTER (WHERE LOWER(COALESCE(NULLIF(u.bet_status, ''), 'active')) <> 'active')::int AS bet_suspended,
                COUNT(*) FILTER (WHERE u.muted IS TRUE)::int AS muted,
                COUNT(*) FILTER (WHERE u.withdraw_locked_until > now())::int AS withdraw_hold,
                COUNT(*) FILTER (WHERE u.two_fa_status IS TRUE)::int AS two_fa,
                COUNT(*) FILTER (WHERE NULLIF(TRIM(u.email), '') IS NOT NULL)::int AS with_email,
                COUNT(*) FILTER (WHERE NULLIF(TRIM(u.phone), '') IS NOT NULL)::int AS with_phone,
                COUNT(*) FILTER (WHERE u.last_login_at >= now() - INTERVAL '24 hours')::int AS seen_24h
           FROM users u
          WHERE ${scope.sql}`,
        base
      ),
      select(this.models, `SELECT ${EFFECTIVE_STATUS('u')} AS key, COUNT(*)::int AS n FROM users u WHERE ${scope.sql} GROUP BY 1`, base),
      select(
        this.models,
        `SELECT ${KYC_STATUS('k')} AS key, COUNT(*)::int AS n
           FROM users u LEFT JOIN user_kyc k ON k.user_id = u.id::text
          WHERE ${scope.sql}
          GROUP BY 1`,
        base
      ),
      select(
        this.models,
        `SELECT ${bucketSql('u.created')} AS bucket, COUNT(*)::int AS n
           FROM users u
          WHERE ${rangeSql('u.created')} AND ${scope.sql}
          GROUP BY 1`,
        base
      ),
      select(
        this.models,
        `SELECT ${bucketSql('a.created_at')} AS bucket,
                COUNT(*) FILTER (WHERE a.action = 'account.lock' AND a.details->'locks'->>'system' = 'true')::int AS blocks,
                COUNT(*) FILTER (WHERE a.action = 'account.lock' AND a.details->'locks'->>'system' = 'false')::int AS unblocks,
                COUNT(*) FILTER (WHERE a.action = 'account.lock'
                                   AND (a.details->'locks'->>'casino' = 'true' OR a.details->'locks'->>'sports' = 'true'
                                        OR a.details->'locks'->>'withdraw' = 'true'))::int AS product_locks,
                COUNT(*) FILTER (WHERE a.action = 'user.close')::int AS closures,
                COUNT(*) FILTER (WHERE a.action = 'kyc.review' AND LOWER(a.details->>'status') = 'verified')::int AS kyc_approvals,
                COUNT(*) FILTER (WHERE a.action = 'kyc.review' AND LOWER(a.details->>'status') = 'rejected')::int AS kyc_rejections
           FROM admin_activity_logs a
           JOIN users u ON u.id = ${TARGET_USER}
          WHERE a.action IN (:eventActions) AND a.target_type = 'USER' AND a.status = 'success'
            AND ${rangeSql('a.created_at')} AND ${scope.sql}
          GROUP BY 1`,
        { ...base, eventActions: EVENT_ACTIONS }
      ),
      select(
        this.models,
        `WITH ev AS (${this.#activitySql()})
         SELECT ${bucketSql('ev.at')} AS bucket, COUNT(DISTINCT ev.uid)::int AS active
           FROM ev JOIN users u ON u.id = ev.uid
          WHERE ${scope.sql}
          GROUP BY 1`,
        base
      ),
      select(
        this.models,
        `WITH ev AS (${this.#activitySql()})
         SELECT COUNT(DISTINCT ev.uid)::int AS active FROM ev JOIN users u ON u.id = ev.uid WHERE ${scope.sql}`,
        base
      ),
      ladder ? this.#vipTiers(ladder, scope, base) : [],
    ]);

    const t = totals[0] ?? {};
    const total = Number(t.total ?? 0);
    const status = ordered(statusRows, STATUS_ORDER, STATUS_LABELS);
    const kyc = ordered(kycRows, KYC_ORDER, KYC_LABELS);
    const count = (rows, key) => rows.find((r) => r.key === key)?.value ?? 0;

    const zero = { signups: 0, activeUsers: 0, blocks: 0, unblocks: 0, productLocks: 0, closures: 0, kycApprovals: 0, kycRejections: 0 };
    const series = new Map();
    let newUsers = 0;
    for (const row of signups) {
      seriesRow(series, row.bucket, zero).signups = row.n;
      newUsers += row.n;
    }
    const eventTotals = { blocks: 0, unblocks: 0, productLocks: 0, closures: 0, kycApprovals: 0, kycRejections: 0 };
    for (const row of events) {
      const s = seriesRow(series, row.bucket, zero);
      s.blocks = row.blocks;
      s.unblocks = row.unblocks;
      s.productLocks = row.product_locks;
      s.closures = row.closures;
      s.kycApprovals = row.kyc_approvals;
      s.kycRejections = row.kyc_rejections;
      for (const key of Object.keys(eventTotals)) eventTotals[key] += s[key];
    }
    for (const row of activity) seriesRow(series, row.bucket, zero).activeUsers = row.active;

    const kycVerified = count(kyc, 'verified');
    const twoFa = Number(t.two_fa ?? 0);
    const withEmail = Number(t.with_email ?? 0);
    const withPhone = Number(t.with_phone ?? 0);
    const seen24h = Number(t.seen_24h ?? 0);
    const direct = Number(t.direct ?? 0);

    return {
      range: rangeBlock(window, null),
      channel,
      kpis: {
        totalUsers: total,
        newUsers,
        activeUsers: Number(activeTotal[0]?.active ?? 0),
        activeUsersPct: percent(activeTotal[0]?.active ?? 0, total),
        active: count(status, 'active'),
        restricted: count(status, 'restricted'),
        locked: count(status, 'locked'),
        closed: count(status, 'closed'),
        kycVerified,
        kycPending: count(kyc, 'pending'),
        kycVerifiedPct: percent(kycVerified, total),
        twoFa,
        twoFaPct: percent(twoFa, total),
        withEmail,
        withPhone,
        seen24h,
        ...eventTotals,
      },
      series: byBucket(series),
      breakdown: {
        status,
        kyc,
        locks: [
          { key: 'system', label: 'System lock', value: Number(t.system_locked ?? 0) },
          { key: 'casino', label: 'Casino lock', value: Number(t.casino_locked ?? 0) },
          { key: 'sports', label: 'Sports lock', value: Number(t.sports_locked ?? 0) },
          { key: 'withdraw', label: 'Withdrawals blocked', value: Number(t.withdraw_locked ?? 0) },
          { key: 'originals', label: 'Original Games lock', value: Number(t.originals_locked ?? 0) },
          { key: 'betSuspended', label: 'Betting suspended', value: Number(t.bet_suspended ?? 0) },
          { key: 'withdrawHold', label: 'Withdrawal hold', value: Number(t.withdraw_hold ?? 0) },
          { key: 'muted', label: 'Chat muted', value: Number(t.muted ?? 0) },
        ],
        security: [
          { key: 'email', label: 'Email on file', value: withEmail, total, pct: percent(withEmail, total) },
          { key: 'phone', label: 'Phone on file', value: withPhone, total, pct: percent(withPhone, total) },
          { key: 'twoFa', label: '2FA on', value: twoFa, total, pct: percent(twoFa, total) },
          { key: 'seen24h', label: 'Signed in, last 24h', value: seen24h, total, pct: percent(seen24h, total) },
        ],
        channel: [
          { key: 'direct', label: 'Direct signups', value: direct },
          { key: 'agent', label: 'Agent players', value: total - direct },
        ],
        vip: ladder ? vipRows : null,
      },
    };
  }

  #emptyOverview(window, channel, house) {
    return {
      range: rangeBlock(window, null),
      channel,
      kpis: {
        totalUsers: 0, newUsers: 0, activeUsers: 0, activeUsersPct: null, active: 0, restricted: 0, locked: 0, closed: 0,
        kycVerified: 0, kycPending: 0, kycVerifiedPct: null, twoFa: 0, twoFaPct: null, withEmail: 0, withPhone: 0, seen24h: 0,
        blocks: 0, unblocks: 0, productLocks: 0, closures: 0, kycApprovals: 0, kycRejections: 0,
      },
      series: [],
      breakdown: { status: [], kyc: [], locks: [], security: [], channel: [], vip: house ? [] : null },
    };
  }

  /**
   * Accounts per VIP tier (the ladder's `card`), on the ladder THIS site runs.
   * The band is the highest one whose floor the lifetime wager reaches — the
   * same answer as `ladder.levelFor`, without pulling every row into memory.
   */
  async #vipTiers(ladder, scope, base) {
    const replacements = { ...base };
    const values = ladder.levels
      .map((band, i) => {
        replacements[`vipMin${i}`] = String(band.minXp);
        replacements[`vipCard${i}`] = String(band.card);
        return `(CAST(:vipMin${i} AS numeric), CAST(:vipCard${i} AS text), ${i})`;
      })
      .join(', ');

    const rows = await select(
      this.models,
      `WITH bands(min_xp, card, ord) AS (VALUES ${values}),
            w AS (
              SELECT CASE WHEN REPLACE(uw.wager, ',', '') ~ '^[0-9]+(\\.[0-9]+)?$' THEN REPLACE(uw.wager, ',', '')::numeric ELSE 0 END AS wager
                FROM users u LEFT JOIN userwager uw ON uw.uid = u.id
               WHERE ${scope.sql}
            )
       SELECT b.card, MIN(b.ord) AS ord, COUNT(*)::int AS n
         FROM w
         LEFT JOIN LATERAL (SELECT card, ord FROM bands WHERE bands.min_xp <= w.wager ORDER BY bands.min_xp DESC LIMIT 1) b ON TRUE
        GROUP BY b.card
        ORDER BY MIN(b.ord) NULLS FIRST`,
      replacements
    );

    const tiers = [];
    const seen = new Set();
    // Every tier on the ladder appears, so the bar reads as the ladder.
    for (const band of ladder.levels) {
      if (seen.has(band.card)) continue;
      seen.add(band.card);
      tiers.push({ key: band.card, label: titleCase(band.card), value: 0 });
    }
    const unranked = { key: 'unranked', label: 'Unranked', value: 0 };
    for (const row of rows) {
      if (row.card == null) unranked.value += row.n;
      else tiers.find((x) => x.key === row.card).value += row.n;
    }
    return [unranked, ...tiers];
  }

  /** `(uid, at)` for every login and counted bet in the window. */
  #activitySql() {
    return `SELECT h.user_id::bigint AS uid, h.created_at AS at
              FROM user_login_history h
             WHERE ${rangeSql('h.created_at')}
            UNION ALL
            SELECT w.user_id::bigint, w.created_at
              FROM wager_activity w
             WHERE ${rangeSql('w.created_at')}`;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  One player
  // ══════════════════════════════════════════════════════════════════════

  async forPlayer({ staff, userId, from, to, granularity }) {
    const user = await this.#assertVisible(staff, userId);
    const window = statsWindow({ from, to, granularity });
    const house = canManagePromotions(staff);
    const base = { ...window.replacements, uid: String(user.id), uidNum: user.id };

    const [[account], [kyc], bonuses, loginDays, betDays, [geo], [last], wager] = await Promise.all([
      select(
        this.models,
        `SELECT u.id, u.name, u.created, u.status, u.bet_status, u.system_locked, u.is_locked, u.casino_locked,
                u.sports_betlocked, u.withdraw_locked, u.originals_locked, u.muted, u.two_fa_status, u.withdraw_locked_until, u.country, u.parent_staff_id,
                NULLIF(TRIM(u.email), '') IS NOT NULL AS has_email,
                NULLIF(TRIM(u.phone), '') IS NOT NULL AS has_phone,
                u.last_login_at,
                ${EFFECTIVE_STATUS('u')} AS effective_status
           FROM users u WHERE u.id = :uidNum`,
        base
      ),
      select(
        this.models,
        `SELECT ${KYC_STATUS('k')} AS status, k.status AS raw_status, k.document_type, k.created_at, k.updated_at
           FROM (SELECT 1) one LEFT JOIN user_kyc k ON k.user_id = :uid`,
        base
      ),
      select(
        this.models,
        `SELECT id, source, description, amount::text AS amount, UPPER(currency) AS currency,
                wager_multiplier::text AS wager_multiplier, required_wager::text AS required_wager,
                wagered::text AS wagered, granted_at, expires_at
           FROM player_bonuses
          WHERE user_id = :uidNum AND status = 'active'
          ORDER BY granted_at DESC
          LIMIT 20`,
        base
      ),
      select(
        this.models,
        `SELECT to_char(h.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
           FROM user_login_history h
          WHERE h.user_id = :uidNum AND ${rangeSql('h.created_at')}
          GROUP BY 1`,
        base
      ),
      select(
        this.models,
        `SELECT to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
           FROM credits_ledger l
          WHERE l.user_id = :uid AND l.reason = 'BET_STAKE' AND ${rangeSql('l.created_at')}
          GROUP BY 1`,
        base
      ),
      select(
        this.models,
        `SELECT COUNT(DISTINCT h.ip_address)::int AS ips,
                COUNT(DISTINCT h.country_code)::int AS countries,
                COALESCE(BOOL_OR(h.is_proxy IS TRUE OR h.is_hosting IS TRUE), FALSE) AS proxy,
                COUNT(*)::int AS logins
           FROM user_login_history h
          WHERE h.user_id = :uidNum`,
        base
      ),
      select(this.models, `SELECT MAX(created_at) AS at FROM credits_ledger WHERE user_id = :uid`, base),
      house ? this.models.Userwager.findOne({ where: { uid: user.id }, attributes: ['wager'], raw: true }) : null,
    ]);

    // ── Active days ───────────────────────────────────────────────────────
    const days = new Map();
    const day = (key) => {
      if (!days.has(key)) days.set(key, { day: key, logins: 0, bets: 0 });
      return days.get(key);
    };
    for (const row of loginDays) day(row.day).logins = row.n;
    for (const row of betDays) day(row.day).bets = row.n;
    const dayRows = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

    // The same days, folded into the chosen buckets (computed in SQL so the
    // week/month boundaries match every other chart).
    const series = await this.#activeDaySeries(dayRows, window);

    // ── VIP ───────────────────────────────────────────────────────────────
    let vip = null;
    if (house) {
      const [ladder, wagerIn] = await Promise.all([resolveVipLadder(this.models, { logger: this.logger }), wagerValuer(this.models, staff)]);
      const v = ladder.levelFor(String(wager?.wager ?? '0').replace(/,/g, '') || '0');
      vip = {
        level: v.level,
        name: v.name,
        card: v.card,
        nextName: v.nextName,
        progressPct: v.progressPct,
        // The ladder is in USD; the figures are shown in the site's default coin.
        wager: wagerIn.of(v.wager),
        wagerToNextLevel: wagerIn.of(v.wagerToNextLevel),
        wagerCurrency: wagerIn.currency,
        topLevel: ladder.top.level,
      };
    }

    const twoFa = Boolean(account.two_fa_status);
    const ips = Number(geo?.ips ?? 0);
    const countries = Number(geo?.countries ?? 0);

    return {
      range: rangeBlock(window, null),
      player: { id: String(user.id), name: account.name ?? null, registeredAt: iso(account.created) },
      account: {
        status: account.effective_status,
        rawStatus: account.status ?? null,
        betStatus: account.bet_status ?? null,
        channel: account.parent_staff_id == null ? 'direct' : 'agent',
        locks: {
          system: Boolean(account.system_locked || account.is_locked),
          casino: Boolean(account.casino_locked),
          sports: Boolean(account.sports_betlocked),
          withdraw: Boolean(account.withdraw_locked),
          originals: Boolean(account.originals_locked),
          muted: Boolean(account.muted),
          withdrawHoldUntil:
            account.withdraw_locked_until && new Date(account.withdraw_locked_until) > new Date() ? iso(account.withdraw_locked_until) : null,
        },
        twoFa,
        hasEmail: Boolean(account.has_email),
        hasPhone: Boolean(account.has_phone),
        country: account.country ?? null,
        lastLoginAt: iso(account.last_login_at),
        lastActivityAt: iso(last?.at),
      },
      kyc: {
        status: kyc?.status ?? 'none',
        rawStatus: kyc?.raw_status ?? null,
        documentType: kyc?.document_type ?? null,
        submittedAt: iso(kyc?.created_at),
        updatedAt: iso(kyc?.updated_at),
      },
      vip,
      bonuses: bonuses.map((b) => {
        const required = Number(b.required_wager);
        const done = Number(b.wagered);
        return {
          id: String(b.id),
          source: b.source,
          description: b.description ?? null,
          amount: decimal(b.amount),
          currency: b.currency,
          wagerMultiplier: b.wager_multiplier,
          requiredWager: decimal(b.required_wager),
          wagered: decimal(b.wagered),
          // Display only: the ratio of two decimal strings, capped at 100.
          progressPct: required > 0 ? Math.min(100, Math.round((done / required) * 10_000) / 100) : 100,
          grantedAt: iso(b.granted_at),
          expiresAt: iso(b.expires_at),
        };
      }),
      risk: {
        distinctIps: ips,
        distinctCountries: countries,
        logins: Number(geo?.logins ?? 0),
        flags: {
          multipleIps: ips > 1,
          multipleCountries: countries > 1,
          proxyOrHosting: Boolean(geo?.proxy),
          twoFaDisabled: !twoFa,
          locked: account.effective_status === 'locked' || account.effective_status === 'closed',
        },
      },
      kpis: {
        activeDays: dayRows.filter((d) => d.logins > 0 || d.bets > 0).length,
        loginDays: dayRows.filter((d) => d.logins > 0).length,
        betDays: dayRows.filter((d) => d.bets > 0).length,
        logins: dayRows.reduce((s, d) => s + d.logins, 0),
        bets: dayRows.reduce((s, d) => s + d.bets, 0),
        periodDays: Math.max(1, Math.round((window.to - window.from) / 86_400_000)),
      },
      days: dayRows,
      series,
    };
  }

  /** `[{ day }]` → `[{ bucket, activeDays, logins, bets }]`, bucketed by Postgres. */
  async #activeDaySeries(dayRows, window) {
    if (!dayRows.length) return [];
    const rows = await select(
      this.models,
      `SELECT ${bucketSql('d.day::timestamp', { naive: true })} AS bucket, d.day
         FROM unnest(ARRAY[:days]::text[]) AS d(day)`,
      { gran: window.granularity, days: dayRows.map((d) => d.day) }
    );
    const byDay = new Map(dayRows.map((d) => [d.day, d]));
    const out = new Map();
    for (const row of rows) {
      const d = byDay.get(row.day);
      const s = seriesRow(out, row.bucket, { activeDays: 0, logins: 0, bets: 0 });
      if (d.logins > 0 || d.bets > 0) s.activeDays += 1;
      s.logins += d.logins;
      s.bets += d.bets;
    }
    return byBucket(out);
  }

  /**
   * The player, if the caller may see them — the player detail's own check
   * (`ReportsService.#assertVisible`, `PlayerStatsService.#assertVisible`): the
   * listing's scope plus the id, one error for "no such player" and "not yours".
   */
  async #assertVisible(staff, userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) throw errors.PLAYER_NOT_FOUND({ userId });

    const scope = await playerScope(this.models, staff, { channel: 'all', logger: this.logger });
    if (scope.empty) throw errors.PLAYER_NOT_FOUND({ userId });

    const [user] = await select(this.models, `SELECT u.id FROM users u WHERE u.id = :id AND ${scope.sql}`, {
      id,
      ...scope.replacements,
    });
    if (!user) throw errors.PLAYER_NOT_FOUND({ userId });
    return { id: Number(user.id) };
  }
}

module.exports = { UserStatusStatsService, EFFECTIVE_STATUS, KYC_STATUS };
