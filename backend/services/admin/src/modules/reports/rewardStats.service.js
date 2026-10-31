'use strict';

const { reportingCurrency } = require('./reportingCurrency');

const { resolveVipLadder } = require('@ibitplay/common');

const { TOP_N, BONUS_LOST_STATUSES, VAULT_IN_TYPE, VAULT_OUT_PREFIX } = require('./audienceStats.constants');
const {
  playerScope,
  statsWindow,
  bucketSql,
  rangeSql,
  select,
  loadRates,
  createValuer,
  byCurrency,
  byBucket,
  seriesRow,
  percent,
  rangeBlock,
  minor,
  decimal,
} = require('./audienceStats.helpers');

/**
 * Reward statistics for the site admin's Rewards pages, one section per page:
 *
 *   tips            the tips report          (tree-scoped, like `admin/user/tip/list`)
 *   bonus-balances  locked player bonuses     (tree-scoped, like `admin/user/bonus-balance`)
 *   vault           vault locks and interest  (house only, like `admin/user/vault/*`)
 *   vip             VIP rewards, rakeback, tiers, clubs (house only)
 *   bonus           bonuses paid to wallets, periodic awards (house only)
 *   affiliate       commission accrued / claimed / voided (house only)
 *
 * Every section is scoped to the caller's players by the `reports/players`
 * rule (`playerScope`); the house-only ones are additionally refused to agent
 * accounts at the route, as their sibling routes are.
 *
 * ── REWARD CURRENCY ──────────────────────────────────────────────────────
 * Rewards are paid in the owner's reward currency and every row keeps the coin
 * it was actually paid in (`rewards.coin`, `player_bonuses.currency`, the
 * ledger's `currency`). Nothing is re-denominated here: each section returns
 * `byCurrency` in the paid coins, and its headline figures are either that
 * one coin (`?currency=`) or a USD valuation at today's rate. Accruals that
 * are USD by design (rakeback accruals, periodic VIP bonuses in
 * `bonus_history`) are reported as USD and named `…Usd`.
 */
/** `player_bonuses.source` as the Bonus balances legend says it (the list's own labels). */
const BONUS_SOURCE_LABEL = Object.freeze({ first_deposit: 'First deposit', monthly_deposit: 'Monthly deposit', spin_wheel: 'Spin wheel' });

class RewardStatsService {
  constructor({ models, logger, config }) {
    this.models = models;
    this.logger = logger;
    this.config = config;
  }

  async section(section, { staff, from, to, granularity, currency }) {
    const window = statsWindow({ from, to, granularity });
    const scope = await playerScope(this.models, staff, { logger: this.logger });
    const rates = await loadRates(this.models);
    const valuer = createValuer(rates, currency, currency ? null : await reportingCurrency(this.models, staff));
    const ctx = {
      window,
      scope,
      valuer,
      currency,
      base: { ...window.replacements, ...scope.replacements, ...(currency ? { currency } : {}) },
      cur: (column) => (currency ? ` AND UPPER(${column}) = :currency` : ''),
      /** `EXISTS` a visible player with this id. */
      visible: (column) => `EXISTS (SELECT 1 FROM users u WHERE u.id = ${column} AND ${scope.sql})`,
    };

    const handlers = {
      tips: () => this.#tips(ctx),
      vault: () => this.#vault(ctx),
      vip: () => this.#vip(ctx),
      bonus: () => this.#bonus(ctx),
      'bonus-balances': () => this.#bonusBalances(ctx),
      affiliate: () => this.#affiliate(ctx),
    };

    const body = scope.empty ? { kpis: {}, series: [], breakdown: {} } : await handlers[section]();
    return {
      section,
      range: rangeBlock(window, valuer.currency),
      ...body,
      unconverted: [...valuer.unconverted],
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  /** A tip shows when its sender OR its receiver is visible — the tips report's rule. */
  async #tips({ base, cur, visible, valuer }) {
    const where = `${rangeSql('t.created_at')} AND (${visible('t.from_user_id')} OR ${visible('t.to_user_id')})${cur('t.currency')}`;

    const [rows, totals, senders] = await Promise.all([
      select(
        this.models,
        `SELECT ${bucketSql('t.created_at')} AS bucket, UPPER(t.currency) AS currency,
                COUNT(*)::int AS n, ROUND(SUM(t.amount), 8)::text AS amount
           FROM tips t WHERE ${where} GROUP BY 1, 2`,
        base
      ),
      select(
        this.models,
        `SELECT COUNT(DISTINCT t.from_user_id)::int AS senders, COUNT(DISTINCT t.to_user_id)::int AS receivers
           FROM tips t WHERE ${where}`,
        base
      ),
      select(
        this.models,
        `SELECT t.from_user_id AS id, MAX(su.name) AS name, UPPER(t.currency) AS currency,
                COUNT(*)::int AS n, ROUND(SUM(t.amount), 8)::text AS amount
           FROM tips t LEFT JOIN users su ON su.id = t.from_user_id
          WHERE ${where} GROUP BY 1, 3`,
        base
      ),
    ]);

    const series = new Map();
    let count = 0;
    let volume = 0n;
    for (const row of rows) {
      const s = seriesRow(series, row.bucket, { count: 0, volume: 0n });
      const v = valuer.value(row.amount, row.currency);
      s.count += row.n;
      s.volume += v;
      count += row.n;
      volume += v;
    }

    const top = new Map();
    for (const row of senders) {
      const entry = top.get(String(row.id)) ?? { key: String(row.id), label: row.name ?? `#${row.id}`, count: 0, volume: 0n };
      entry.count += row.n;
      entry.volume += valuer.value(row.amount, row.currency);
      top.set(String(row.id), entry);
    }

    return {
      kpis: {
        tips: count,
        volume: decimal(volume),
        averageTip: count ? decimal(volume / BigInt(count)) : '0.00000000',
        senders: Number(totals[0]?.senders ?? 0),
        receivers: Number(totals[0]?.receivers ?? 0),
      },
      series: byBucket(series).map((s) => ({ bucket: s.bucket, count: s.count, volume: decimal(s.volume) })),
      breakdown: {
        byCurrency: byCurrency(rows),
        topSenders: [...top.values()]
          .sort((a, b) => (b.volume > a.volume ? 1 : b.volume < a.volume ? -1 : 0))
          .slice(0, TOP_N)
          .map((e) => ({ ...e, volume: decimal(e.volume) })),
      },
    };
  }

  async #vault({ base, cur, visible, valuer }) {
    const replacements = { ...base, vaultIn: VAULT_IN_TYPE, vaultOut: VAULT_OUT_PREFIX };

    const [moves, interest, locked] = await Promise.all([
      select(
        this.models,
        `SELECT ${bucketSql('v."createdAt"')} AS bucket, UPPER(v.coin) AS currency,
                CASE WHEN v.type = :vaultIn THEN 'in' WHEN v.type LIKE :vaultOut THEN 'out' ELSE 'other' END AS side,
                COUNT(*)::int AS n, ROUND(SUM(v.amount), 8)::text AS amount
           FROM vault_transactions v
          WHERE ${rangeSql('v."createdAt"')} AND ${visible('v.userid')}${cur('v.coin')}
          GROUP BY 1, 2, 3`,
        replacements
      ),
      select(
        this.models,
        `SELECT ${bucketSql('i."createdAt"')} AS bucket, UPPER(i.coin) AS currency, ROUND(SUM(i.interest), 8)::text AS amount
           FROM vault_interest_history i
          WHERE ${rangeSql('i."createdAt"')} AND ${visible('i.userid')}${cur('i.coin')}
          GROUP BY 1, 2`,
        replacements
      ),
      select(
        this.models,
        `SELECT COALESCE(NULLIF(p.lock_period, ''), 'flexible') AS period, UPPER(p.coin) AS currency,
                COUNT(*)::int AS n, COUNT(DISTINCT p.userid)::int AS players,
                ROUND(COALESCE(SUM(COALESCE(p.principal, p."vaultBalance")), 0), 8)::text AS amount
           FROM vault_pro p
          WHERE p.status = 'active' AND ${visible('p.userid')}${cur('p.coin')}
          GROUP BY 1, 2`,
        replacements
      ),
    ]);

    const series = new Map();
    const zero = { in: 0n, out: 0n, interest: 0n };
    const totals = { ...zero, inCount: 0, outCount: 0 };
    for (const row of moves) {
      if (row.side === 'other') continue;
      const v = valuer.value(row.amount, row.currency);
      seriesRow(series, row.bucket, zero)[row.side] += v;
      totals[row.side] += v;
      totals[`${row.side}Count`] += row.n;
    }
    for (const row of interest) {
      const v = valuer.value(row.amount, row.currency);
      seriesRow(series, row.bucket, zero).interest += v;
      totals.interest += v;
    }

    const periods = new Map();
    let lockedTotal = 0n;
    let activeLocks = 0;
    for (const row of locked) {
      const v = valuer.value(row.amount, row.currency);
      const entry = periods.get(row.period) ?? { key: row.period, label: row.period, value: 0n, locks: 0 };
      entry.value += v;
      entry.locks += row.n;
      periods.set(row.period, entry);
      lockedTotal += v;
      activeLocks += row.n;
    }

    return {
      kpis: {
        vaultIn: decimal(totals.in),
        deposits: totals.inCount,
        vaultOut: decimal(totals.out),
        withdrawals: totals.outCount,
        net: decimal(totals.in - totals.out),
        interestPaid: decimal(totals.interest),
        lockedNow: decimal(lockedTotal),
        activeLocks,
      },
      series: byBucket(series).map((s) => ({
        bucket: s.bucket, vaultIn: decimal(s.in), vaultOut: decimal(s.out), interest: decimal(s.interest),
      })),
      breakdown: {
        lockedByPeriod: [...periods.values()].map((e) => ({ ...e, value: decimal(e.value) })),
        lockedByCurrency: byCurrency(locked),
      },
    };
  }

  async #vip({ base, cur, visible, valuer, scope }) {
    const replacements = { ...base, vipRefs: ['VIP_LEVEL_UP', 'VIP_RANK_UP'] };

    const [paid, accrued, periodic, wagers, clubs, clubEarnings] = await Promise.all([
      select(
        this.models,
        `SELECT ${bucketSql('l.created_at')} AS bucket, UPPER(l.currency) AS currency,
                CASE WHEN l.reason = 'rakeback_claim' THEN 'rakeback' ELSE l.meta->>'refType' END AS kind,
                COUNT(*)::int AS n, ROUND(SUM(l.amount), 8)::text AS amount
           FROM credits_ledger l
          WHERE ${rangeSql('l.created_at')}
            AND (l.reason = 'rakeback_claim' OR (l.reason = 'BONUS' AND l.meta->>'refType' IN (:vipRefs)))
            AND l.user_id ~ '^[0-9]{1,18}$' AND ${visible('l.user_id::bigint')}${cur('l.currency')}
          GROUP BY 1, 2, 3`,
        replacements
      ),
      select(
        this.models,
        `SELECT ${bucketSql('r.created_at')} AS bucket,
                ROUND(SUM(r.amount * (1 - LEAST(COALESCE(r.reversed_amount, 0) / NULLIF(r.amount, 0), 1))), 8)::text AS usd,
                COUNT(DISTINCT r.user_id)::int AS players
           FROM rakeback_accruals r
          WHERE ${rangeSql('r.created_at')} AND ${visible('r.user_id')}
          GROUP BY 1`,
        replacements
      ),
      select(
        this.models,
        `SELECT b.bonus_type AS type,
                COUNT(*) FILTER (WHERE ${rangeSql('b.created_at')})::int AS awarded,
                ROUND(COALESCE(SUM(b.bonus_amount) FILTER (WHERE ${rangeSql('b.created_at')}), 0), 8)::text AS awarded_usd,
                COUNT(*) FILTER (WHERE b.is_claimed IS TRUE AND ${rangeSql('b.claimed_at')})::int AS claimed,
                ROUND(COALESCE(SUM(b.bonus_amount) FILTER (WHERE b.is_claimed IS TRUE AND ${rangeSql('b.claimed_at')}), 0), 8)::text AS claimed_usd
           FROM bonus_history b
          WHERE ((${rangeSql('b.created_at')}) OR (${rangeSql('b.claimed_at')})) AND ${visible('b.userid')}
          GROUP BY 1`,
        replacements
      ),
      select(
        this.models,
        `SELECT u.id, COALESCE(w.wager, '0') AS wager FROM users u LEFT JOIN userwager w ON w.uid = u.id WHERE ${scope.sql}`,
        replacements
      ),
      select(
        this.models,
        `SELECT COUNT(DISTINCT c.id)::int AS clubs,
                COUNT(DISTINCT c.id) FILTER (WHERE c.is_active IS TRUE)::int AS active,
                (SELECT COUNT(*)::int FROM club_memberships m WHERE ${visible('m.user_id')}) AS members
           FROM clubs c WHERE ${visible('c.owner_id')}`,
        replacements
      ),
      select(
        this.models,
        `SELECT UPPER(e.currency) AS currency, ROUND(SUM(e.amount), 8)::text AS amount
           FROM club_earnings_log e
          WHERE ${rangeSql('e.created_at')} AND ${visible('e.beneficiary_id')}${cur('e.currency')}
          GROUP BY 1`,
        replacements
      ),
    ]);

    const series = new Map();
    const zero = { vipRewards: 0n, rakebackClaimed: 0n, rakebackAccruedUsd: '0.00000000' };
    const kinds = new Map();
    let vipRewards = 0n;
    let rakeback = 0n;
    for (const row of paid) {
      const v = valuer.value(row.amount, row.currency);
      const s = seriesRow(series, row.bucket, zero);
      if (row.kind === 'rakeback') {
        s.rakebackClaimed += v;
        rakeback += v;
      } else {
        s.vipRewards += v;
        vipRewards += v;
      }
      kinds.set(row.kind, (kinds.get(row.kind) ?? 0n) + v);
    }
    // Accruals are USD by design: summed as USD whatever the currency filter.
    let accruedUsd = 0n;
    for (const row of accrued) {
      seriesRow(series, row.bucket, zero).rakebackAccruedUsd = decimal(row.usd);
      accruedUsd += minor(row.usd);
    }

    // ── Tier distribution: every visible player on the site's ladder, now ──
    const ladder = await resolveVipLadder(this.models, { logger: this.logger });
    const tiers = new Map();
    for (const row of wagers) {
      const vip = ladder.levelFor(String(row.wager ?? '0').replace(/,/g, '') || '0');
      const key = vip.card ?? 'unranked';
      const entry = tiers.get(key) ?? { key, label: (vip.name ?? key).replace(/\s+\d+$/, ''), value: 0, minLevel: vip.level };
      entry.value += 1;
      entry.minLevel = Math.min(entry.minLevel, vip.level);
      tiers.set(key, entry);
    }

    const periodicTotals = periodic.reduce(
      (acc, row) => ({
        awarded: acc.awarded + row.awarded,
        claimed: acc.claimed + row.claimed,
        awardedUsd: acc.awardedUsd + Number(row.awarded_usd),
        claimedUsd: acc.claimedUsd + Number(row.claimed_usd),
      }),
      { awarded: 0, claimed: 0, awardedUsd: 0, claimedUsd: 0 }
    );

    const kindLabel = { VIP_LEVEL_UP: 'Level-up', VIP_RANK_UP: 'Rank-up', rakeback: 'Rakeback' };
    const clubEarned = clubEarnings.reduce((acc, row) => acc + valuer.value(row.amount, row.currency), 0n);

    return {
      kpis: {
        vipRewardsPaid: decimal(vipRewards),
        rakebackClaimed: decimal(rakeback),
        rakebackAccruedUsd: decimal(accruedUsd),
        rakebackPlayers: accrued.reduce((acc, row) => Math.max(acc, row.players), 0),
        periodicAwarded: periodicTotals.awarded,
        periodicClaimed: periodicTotals.claimed,
        periodicAwardedUsd: periodicTotals.awardedUsd.toFixed(2),
        periodicClaimedUsd: periodicTotals.claimedUsd.toFixed(2),
        periodicClaimRate: percent(periodicTotals.claimed, periodicTotals.awarded),
        rankedPlayers: wagers.length - (tiers.get('unranked')?.value ?? 0),
        players: wagers.length,
        clubs: Number(clubs[0]?.clubs ?? 0),
        activeClubs: Number(clubs[0]?.active ?? 0),
        clubMembers: Number(clubs[0]?.members ?? 0),
        clubEarnings: decimal(clubEarned),
      },
      series: byBucket(series).map((s) => ({
        bucket: s.bucket,
        vipRewards: decimal(s.vipRewards),
        rakebackClaimed: decimal(s.rakebackClaimed),
        rakebackAccruedUsd: s.rakebackAccruedUsd,
      })),
      breakdown: {
        tiers: [...tiers.values()].sort((a, b) => a.minLevel - b.minLevel).map(({ minLevel, ...e }) => e),
        rewardsByKind: [...kinds].map(([key, v]) => ({ key, label: kindLabel[key] ?? key, value: decimal(v) })),
        periodic: periodic.map((row) => ({
          key: row.type, label: row.type, awarded: row.awarded, claimed: row.claimed,
          awardedUsd: decimal(row.awarded_usd), claimedUsd: decimal(row.claimed_usd),
        })),
      },
    };
  }

  /** Bonuses paid to wallets (ledger `BONUS`, by what paid it) and the periodic awards. */
  async #bonus({ base, cur, visible, valuer }) {
    const [paid, periodic] = await Promise.all([
      select(
        this.models,
        `SELECT ${bucketSql('l.created_at')} AS bucket, UPPER(l.currency) AS currency,
                COALESCE(NULLIF(l.meta->>'refType', ''), 'OTHER') AS kind,
                COUNT(*)::int AS n, COUNT(DISTINCT l.user_id)::int AS players, ROUND(SUM(l.amount), 8)::text AS amount
           FROM credits_ledger l
          WHERE ${rangeSql('l.created_at')} AND l.reason = 'BONUS'
            AND l.user_id ~ '^[0-9]{1,18}$' AND ${visible('l.user_id::bigint')}${cur('l.currency')}
          GROUP BY 1, 2, 3`,
        base
      ),
      select(
        this.models,
        `SELECT ${bucketSql('b.created_at')} AS bucket, b.bonus_type AS type,
                COUNT(*)::int AS awarded, ROUND(SUM(b.bonus_amount), 8)::text AS awarded_usd,
                COUNT(*) FILTER (WHERE b.is_claimed IS TRUE)::int AS claimed,
                ROUND(COALESCE(SUM(b.bonus_amount) FILTER (WHERE b.is_claimed IS TRUE), 0), 8)::text AS claimed_usd
           FROM bonus_history b
          WHERE ${rangeSql('b.created_at')} AND ${visible('b.userid')}
          GROUP BY 1, 2`,
        base
      ),
    ]);

    const series = new Map();
    const zero = { paid: 0n, credits: 0, awardedUsd: 0, claimedUsd: 0 };
    const kinds = new Map();
    let total = 0n;
    let credits = 0;
    for (const row of paid) {
      const v = valuer.value(row.amount, row.currency);
      const s = seriesRow(series, row.bucket, zero);
      s.paid += v;
      s.credits += row.n;
      total += v;
      credits += row.n;
      const k = kinds.get(row.kind) ?? { key: row.kind, label: row.kind, value: 0n, count: 0 };
      k.value += v;
      k.count += row.n;
      kinds.set(row.kind, k);
    }
    const types = new Map();
    let awarded = 0;
    let claimed = 0;
    for (const row of periodic) {
      const s = seriesRow(series, row.bucket, zero);
      s.awardedUsd += Number(row.awarded_usd);
      s.claimedUsd += Number(row.claimed_usd);
      awarded += row.awarded;
      claimed += row.claimed;
      const t = types.get(row.type) ?? { key: row.type, label: row.type, awarded: 0, claimed: 0 };
      t.awarded += row.awarded;
      t.claimed += row.claimed;
      types.set(row.type, t);
    }

    return {
      kpis: {
        bonusPaid: decimal(total),
        bonusCredits: credits,
        periodicAwarded: awarded,
        periodicClaimed: claimed,
        periodicClaimRate: percent(claimed, awarded),
      },
      series: byBucket(series).map((s) => ({
        bucket: s.bucket, paid: decimal(s.paid), credits: s.credits,
        periodicAwardedUsd: s.awardedUsd.toFixed(2), periodicClaimedUsd: s.claimedUsd.toFixed(2),
      })),
      breakdown: {
        paidByKind: [...kinds.values()]
          .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))
          .map((k) => ({ ...k, value: decimal(k.value) })),
        periodicByType: [...types.values()],
        byCurrency: byCurrency(paid),
      },
    };
  }

  /** Locked bonus balances (`player_bonuses`): granted, wagered, converted, forfeited. */
  async #bonusBalances({ base, cur, visible, valuer }) {
    const replacements = { ...base, lost: BONUS_LOST_STATUSES };
    const owned = `${visible('b.user_id')}${cur('b.currency')}`;

    const [granted, converted, lost, open, bySource] = await Promise.all([
      select(
        this.models,
        `SELECT ${bucketSql('b.granted_at')} AS bucket, UPPER(b.currency) AS currency, COUNT(*)::int AS n,
                ROUND(SUM(b.amount), 8)::text AS amount, ROUND(SUM(b.wagered), 8)::text AS wagered,
                ROUND(SUM(b.required_wager), 8)::text AS required
           FROM player_bonuses b WHERE ${rangeSql('b.granted_at')} AND ${owned} GROUP BY 1, 2`,
        replacements
      ),
      select(
        this.models,
        `SELECT ${bucketSql('b.completed_at')} AS bucket, UPPER(b.currency) AS currency, COUNT(*)::int AS n, ROUND(SUM(b.amount), 8)::text AS amount
           FROM player_bonuses b WHERE b.status = 'completed' AND ${rangeSql('b.completed_at')} AND ${owned} GROUP BY 1, 2`,
        replacements
      ),
      select(
        this.models,
        `SELECT ${bucketSql('b.ended_at')} AS bucket, UPPER(b.currency) AS currency, COUNT(*)::int AS n, ROUND(SUM(b.amount), 8)::text AS amount
           FROM player_bonuses b WHERE LOWER(b.status) IN (:lost) AND ${rangeSql('b.ended_at')} AND ${owned} GROUP BY 1, 2`,
        replacements
      ),
      select(
        this.models,
        `SELECT UPPER(b.currency) AS currency, COUNT(*)::int AS n, COUNT(DISTINCT b.user_id)::int AS players,
                ROUND(SUM(b.amount), 8)::text AS amount
           FROM player_bonuses b WHERE b.status = 'active' AND ${owned} GROUP BY 1`,
        replacements
      ),
      select(
        this.models,
        `SELECT b.source, UPPER(b.currency) AS currency, COUNT(*)::int AS n, ROUND(SUM(b.amount), 8)::text AS amount
           FROM player_bonuses b WHERE ${rangeSql('b.granted_at')} AND ${owned} GROUP BY 1, 2`,
        replacements
      ),
    ]);

    const series = new Map();
    const zero = { granted: 0n, converted: 0n, forfeited: 0n };
    const sumInto = (rows, field) => {
      let total = 0n;
      let count = 0;
      for (const row of rows) {
        const v = valuer.value(row.amount, row.currency);
        seriesRow(series, row.bucket, zero)[field] += v;
        total += v;
        count += row.n;
      }
      return { total, count };
    };
    const g = sumInto(granted, 'granted');
    const c = sumInto(converted, 'converted');
    const l = sumInto(lost, 'forfeited');
    const wagered = granted.reduce((acc, row) => acc + valuer.value(row.wagered, row.currency), 0n);
    const required = granted.reduce((acc, row) => acc + valuer.value(row.required, row.currency), 0n);
    const active = open.reduce((acc, row) => acc + valuer.value(row.amount, row.currency), 0n);

    const sources = new Map();
    for (const row of bySource) {
      const e = sources.get(row.source) ?? { key: row.source, label: BONUS_SOURCE_LABEL[row.source] ?? row.source, value: 0n, count: 0 };
      e.value += valuer.value(row.amount, row.currency);
      e.count += row.n;
      sources.set(row.source, e);
    }

    return {
      kpis: {
        granted: decimal(g.total),
        grantedCount: g.count,
        wagered: decimal(wagered),
        requiredWager: decimal(required),
        wageringProgress: percent(Number(decimal(wagered)), Number(decimal(required))),
        converted: decimal(c.total),
        convertedCount: c.count,
        forfeited: decimal(l.total),
        forfeitedCount: l.count,
        conversionRate: percent(c.count, c.count + l.count),
        activeBalance: decimal(active),
        activeBonuses: open.reduce((acc, row) => acc + row.n, 0),
      },
      series: byBucket(series).map((s) => ({
        bucket: s.bucket, granted: decimal(s.granted), converted: decimal(s.converted), forfeited: decimal(s.forfeited),
      })),
      breakdown: {
        bySource: [...sources.values()].map((e) => ({ ...e, value: decimal(e.value) })),
        outcome: [
          { key: 'converted', label: 'Converted', value: c.count },
          { key: 'forfeited', label: 'Forfeited / expired', value: l.count },
          { key: 'active', label: 'Still active', value: open.reduce((acc, row) => acc + row.n, 0) },
        ],
        activeByCurrency: byCurrency(open),
      },
    };
  }

  /**
   * Affiliate commission (`rewards`): accrued when written, claimed when paid,
   * voided by a reversal. A row's owner is `owner_id`, or — on rows from
   * before that column — the owner's name.
   */
  async #affiliate({ base, cur, scope, visible, valuer }) {
    const owner = `EXISTS (SELECT 1 FROM users u WHERE (u.id = r.owner_id OR (r.owner_id IS NULL AND u.name = r.ownername)) AND ${scope.sql})`;
    const where = (extra) => `${extra} AND ${owner}${cur('r.coin')}`;

    const [accrued, claimed, pending, top, tierRewards] = await Promise.all([
      select(
        this.models,
        `SELECT ${bucketSql('r."createdAt"')} AS bucket, UPPER(COALESCE(r.coin, 'USDT')) AS currency,
                COALESCE(NULLIF(r.type, ''), 'commission') AS type, (r.voided IS TRUE) AS voided,
                COUNT(*)::int AS n, ROUND(SUM(r.amount), 8)::text AS amount
           FROM rewards r WHERE ${where(rangeSql('r."createdAt"'))} GROUP BY 1, 2, 3, 4`,
        base
      ),
      select(
        this.models,
        `SELECT ${bucketSql('r.claimed_at')} AS bucket, UPPER(COALESCE(r.coin, 'USDT')) AS currency,
                COUNT(*)::int AS n, ROUND(SUM(r.amount), 8)::text AS amount
           FROM rewards r WHERE ${where(`r.claimed IS TRUE AND ${rangeSql('r.claimed_at')}`)} GROUP BY 1, 2`,
        base
      ),
      select(
        this.models,
        `SELECT UPPER(COALESCE(r.coin, 'USDT')) AS currency, COUNT(*)::int AS n, ROUND(SUM(r.amount), 8)::text AS amount
           FROM rewards r WHERE ${where('r.claimed IS NOT TRUE AND r.voided IS NOT TRUE')} GROUP BY 1`,
        base
      ),
      select(
        this.models,
        `SELECT r.ownername AS owner, UPPER(COALESCE(r.coin, 'USDT')) AS currency, COUNT(DISTINCT r.membername)::int AS members,
                ROUND(SUM(r.amount), 8)::text AS amount
           FROM rewards r WHERE ${where(`r.voided IS NOT TRUE AND ${rangeSql('r."createdAt"')}`)} GROUP BY 1, 2`,
        base
      ),
      select(
        this.models,
        `SELECT UPPER(l.currency) AS currency, COUNT(*)::int AS n, ROUND(SUM(l.amount), 8)::text AS amount
           FROM credits_ledger l
          WHERE ${rangeSql('l.created_at')} AND l.reason = 'BONUS' AND l.meta->>'refType' = 'AFFILIATE_REWARD'
            AND l.user_id ~ '^[0-9]{1,18}$' AND ${visible('l.user_id::bigint')}${cur('l.currency')}
          GROUP BY 1`,
        base
      ),
    ]);

    const series = new Map();
    const zero = { accrued: 0n, claimed: 0n, voided: 0n };
    const totals = { accrued: 0n, claimed: 0n, voided: 0n, accruedCount: 0, claimedCount: 0, voidedCount: 0 };
    const types = new Map();
    for (const row of accrued) {
      const v = valuer.value(row.amount, row.currency);
      const field = row.voided ? 'voided' : 'accrued';
      seriesRow(series, row.bucket, zero)[field] += v;
      totals[field] += v;
      totals[`${field}Count`] += row.n;
      if (!row.voided) types.set(row.type, (types.get(row.type) ?? 0n) + v);
    }
    for (const row of claimed) {
      const v = valuer.value(row.amount, row.currency);
      seriesRow(series, row.bucket, zero).claimed += v;
      totals.claimed += v;
      totals.claimedCount += row.n;
    }
    const owners = new Map();
    for (const row of top) {
      const e = owners.get(row.owner) ?? { key: row.owner, label: row.owner ?? '—', value: 0n, members: 0 };
      e.value += valuer.value(row.amount, row.currency);
      e.members = Math.max(e.members, row.members);
      owners.set(row.owner, e);
    }
    const sum = (rows) => rows.reduce((acc, row) => acc + valuer.value(row.amount, row.currency), 0n);

    return {
      kpis: {
        accrued: decimal(totals.accrued),
        accruedCount: totals.accruedCount,
        claimed: decimal(totals.claimed),
        claimedCount: totals.claimedCount,
        voided: decimal(totals.voided),
        voidedCount: totals.voidedCount,
        unclaimedNow: decimal(sum(pending)),
        tierRewardsPaid: decimal(sum(tierRewards)),
        earningAffiliates: owners.size,
      },
      series: byBucket(series).map((s) => ({
        bucket: s.bucket, accrued: decimal(s.accrued), claimed: decimal(s.claimed), voided: decimal(s.voided),
      })),
      breakdown: {
        byType: [...types].map(([key, v]) => ({ key, label: key, value: decimal(v) })),
        topAffiliates: [...owners.values()]
          .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))
          .slice(0, TOP_N)
          .map((e) => ({ ...e, value: decimal(e.value) })),
        unclaimedByCurrency: byCurrency(pending),
      },
    };
  }
}

module.exports = { RewardStatsService };
