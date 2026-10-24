'use strict';

const { reportingCurrency } = require('./reportingCurrency');

const { resolveVipLadder } = require('@ibitplay/common');
const { canManagePromotions } = require('@ibitplay/auth');

const errors = require('./reports.errors');
const { DIRECT_WALLET_LEDGER, SPORT_NAMES, SPORTS_REFUNDED_RESULTS } = require('../dashboard/dashboard.constants');

/** staff_transfers types that fund a player (agent refill / transfer / adjust). INR, no currency column. */
const AGENT_FUNDING = ['transfer', 'refill', 'issuance', 'adjust'];
const { TOP_N, PLAY_REASONS, WITHDRAWAL_DONE } = require('./audienceStats.constants');
const {
  playerScope,
  statsWindow,
  bucketSql,
  rangeSql,
  select,
  loadRates,
  createValuer,
  byBucket,
  seriesRow,
  percent,
  rangeBlock,
  decimal,
} = require('./audienceStats.helpers');
const { CASINO_SOURCES, SPORTS_TURNOVER } = require('./wagerStats.service');
const { SPORTS_LEDGER_REASONS, LEDGER_PNL } = require('../dashboard/dashboardStats.service');
const { realDepositsSql } = require('./depositRails');
const { INHOUSE_UNLEDGERED, INHOUSE_PAYOUT } = require('../statements/casinoRounds');

const HOUSE_ONLY_NOTE =
  'VIP, vault, rakeback and bonus figures are house-only, as on the Rewards pages and the P&L. ' +
  'This view shows the player\'s deposits, withdrawals, play and tips.';

/**
 * Player statistics for the site admin's charts.
 *
 *   overview   GET /reports/player-stats              the player base, over time
 *   forPlayer  GET /reports/players/:userId/stats     one player, over time
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────
 * Both answer only for the players the caller may see, by the SAME rule as the
 * `reports/players` listing and the player detail (`playerScope`, which mirrors
 * `ReportsService.#visibleUserScope`). `forPlayer` refuses a player outside the
 * tree with the detail route's own error — 404 `REPORTS_PLAYER_NOT_FOUND`, the
 * same answer as an id that does not exist.
 *
 * ── AMOUNTS ──────────────────────────────────────────────────────────────
 * Deposits are the dashboard's four tables and success statuses
 * (`DEPOSIT_SUCCESS`); withdrawals are the dashboard's two plus the gateway's,
 * as on the player report's lifetime totals. Play is `credits_ledger` (stakes,
 * payouts, refunds, rollbacks — the statement's source). With a `currency`
 * filter only that currency's rows count and figures are native; without one
 * every row is valued in USD at today's rate and a currency with no rate is
 * named under `unconverted` instead of being counted as zero. The player base's
 * "Wagered" is the wager reports' turnover (casino + sports, `#wagerRows`),
 * valued the same way; `wagerCurrency` says which currency it is in.
 */
class PlayerStatsService {
  constructor({ models, logger, config }) {
    this.models = models;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The player base
  // ══════════════════════════════════════════════════════════════════════

  async overview({ staff, from, to, granularity, currency, channel = 'all' }) {
    const window = statsWindow({ from, to, granularity });
    const scope = await playerScope(this.models, staff, { channel, logger: this.logger });
    const rates = await loadRates(this.models);
    const valuer = createValuer(rates, currency, currency ? null : await reportingCurrency(this.models, staff));

    const empty = this.#emptyOverview(window, valuer.currency);
    if (scope.empty) return empty;

    const base = { ...window.replacements, ...scope.replacements };
    const deposits = this.#depositsSql({ currency });
    const depositReplacements = { ...base, ...deposits.replacements, ...(currency ? { currency } : {}) };

    const [signups, signupCountries, totalPlayers, wagerRows, activity, activeTotals, depositRows, depositorRows, depositTotals] = await Promise.all([
      select(
        this.models,
        `SELECT ${bucketSql('u.created')} AS bucket,
                COUNT(*)::int AS players,
                COUNT(*) FILTER (WHERE u.parent_staff_id IS NULL)::int AS direct
           FROM users u
          WHERE ${rangeSql('u.created')} AND ${scope.sql}
          GROUP BY 1`,
        base
      ),
      select(
        this.models,
        `SELECT COALESCE(NULLIF(TRIM(u.country), ''), 'Unknown') AS country, COUNT(*)::int AS players
           FROM users u
          WHERE ${rangeSql('u.created')} AND ${scope.sql}
          GROUP BY 1 ORDER BY 2 DESC LIMIT ${TOP_N}`,
        base
      ),
      select(this.models, `SELECT COUNT(*)::int AS players FROM users u WHERE ${scope.sql}`, base),
      this.#wagerRows({ scope, base, currency }),
      this.#activeRows({ scope, base, totals: false }),
      this.#activeRows({ scope, base, totals: true }),
      select(
        this.models,
        `WITH dep AS (${deposits.sql}),
              mine AS (SELECT dep.* FROM dep JOIN users u ON u.id = dep.uid WHERE ${scope.sql})
         SELECT ${bucketSql('m.at')} AS bucket, m.cur AS currency,
                ROUND(SUM(m.amt), 8)::text AS amount,
                COUNT(*)::int AS deposits
           FROM mine m
          GROUP BY 1, 2`,
        depositReplacements
      ),
      // Depositors and first-time depositors per bucket, counted ACROSS
      // currencies in one place. Both used to come from the per-currency rows:
      // FTD summed over them, depositors the largest of them — so a bucket whose
      // first deposits were split over INR and USDT could show more FTD than
      // depositors (Aug: 25 vs 13). One grouping, the same player set: every FTD
      // is a depositor of that bucket, so FTD ≤ depositors by construction.
      select(
        this.models,
        `WITH dep AS (${deposits.sql}),
              mine AS (SELECT dep.* FROM dep JOIN users u ON u.id = dep.uid WHERE ${scope.sql}),
              firsts AS (SELECT uid, MIN(at) AS first_at FROM mine GROUP BY uid),
              prior AS (${this.#priorDepositorsSql()})
         SELECT ${bucketSql('m.at')} AS bucket,
                COUNT(DISTINCT m.uid)::int AS depositors,
                COUNT(DISTINCT m.uid) FILTER (
                  WHERE m.at = f.first_at AND NOT EXISTS (SELECT 1 FROM prior p WHERE p.uid = m.uid)
                )::int AS ftd
           FROM mine m JOIN firsts f ON f.uid = m.uid
          GROUP BY 1`,
        depositReplacements
      ),
      select(
        this.models,
        `WITH dep AS (${deposits.sql}),
              mine AS (SELECT dep.*, u.created AS registered FROM dep JOIN users u ON u.id = dep.uid WHERE ${scope.sql}),
              prior AS (${this.#priorDepositorsSql()})
         SELECT COUNT(DISTINCT uid)::int AS depositors,
                COUNT(DISTINCT uid) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior p WHERE p.uid = mine.uid))::int AS ftd,
                COUNT(DISTINCT uid) FILTER (
                  WHERE registered >= CAST(:rangeFrom AS timestamptz) AND registered < CAST(:rangeTo AS timestamptz)
                )::int AS new_depositors
           FROM mine`,
        depositReplacements
      ),
    ]);

    // ── Series ────────────────────────────────────────────────────────────
    const zero = { newPlayers: 0, activePlayers: 0, originalsPlayers: 0, depositors: 0, firstTimeDepositors: 0, deposits: 0, depositAmount: 0n, wagerUsd: '0.00000000' };
    const series = new Map();
    let newPlayers = 0;
    let direct = 0;
    for (const row of signups) {
      seriesRow(series, row.bucket, zero).newPlayers = row.players;
      newPlayers += row.players;
      direct += row.direct;
    }
    for (const row of activity) {
      const s = seriesRow(series, row.bucket, zero);
      s.activePlayers = row.active;
      s.originalsPlayers = row.originals;
    }
    // Wagered: the wager reports' own sources and rules, valued like every
    // other amount here (native with a currency filter, today's USD without).
    const wagerPerBucket = new Map();
    let wagerTotal = 0n;
    for (const row of wagerRows) {
      const value = valuer.value(row.wagered, row.currency);
      wagerPerBucket.set(row.bucket, (wagerPerBucket.get(row.bucket) ?? 0n) + value);
      wagerTotal += value;
    }
    for (const [bucket, value] of wagerPerBucket) seriesRow(series, bucket, zero).wagerUsd = decimal(value);
    let depositAmount = 0n;
    let depositCount = 0;
    for (const row of depositRows) {
      const s = seriesRow(series, row.bucket, zero);
      const value = valuer.value(row.amount, row.currency);
      s.depositAmount += value;
      s.deposits += row.deposits;
      depositAmount += value;
      depositCount += row.deposits;
    }
    for (const row of depositorRows) {
      const s = seriesRow(series, row.bucket, zero);
      s.depositors = row.depositors;
      s.firstTimeDepositors = row.ftd;
    }

    const totals = depositTotals[0] ?? {};
    const active = activeTotals[0] ?? {};
    const depositors = Number(totals.depositors ?? 0);

    return {
      range: rangeBlock(window, valuer.currency),
      channel,
      kpis: {
        totalPlayers: Number(totalPlayers[0]?.players ?? 0),
        newPlayers,
        activePlayers: Number(active.active ?? 0),
        depositors,
        firstTimeDepositors: Number(totals.ftd ?? 0),
        newDepositors: Number(totals.new_depositors ?? 0),
        /** New players in the window who also deposited in it, as a % of new players. */
        conversionRate: percent(totals.new_depositors ?? 0, newPlayers),
        deposits: depositCount,
        depositAmount: decimal(depositAmount),
        averageDeposit: depositCount ? decimal(depositAmount / BigInt(depositCount)) : '0.00000000',
        wagerUsd: decimal(wagerTotal),
        wagerCurrency: valuer.currency,
      },
      series: byBucket(series).map((s) => ({ ...s, depositAmount: decimal(s.depositAmount) })),
      breakdown: {
        channel: [
          { key: 'direct', label: 'Direct signups', value: direct },
          { key: 'agent', label: 'Agent players', value: newPlayers - direct },
        ],
        countries: signupCountries.map((row) => ({ key: row.country, label: row.country, value: row.players })),
        activeByProduct: [
          { key: 'casino', label: 'Casino', value: Number(active.casino ?? 0) },
          { key: 'originals', label: 'Originals', value: Number(active.originals ?? 0) },
          { key: 'sports', label: 'Sports', value: Number(active.sports ?? 0) },
        ],
      },
      unconverted: [...valuer.unconverted],
    };
  }

  #emptyOverview(window, currency) {
    return {
      range: rangeBlock(window, currency),
      kpis: {
        totalPlayers: 0, newPlayers: 0, activePlayers: 0, depositors: 0, firstTimeDepositors: 0,
        newDepositors: 0, conversionRate: null, deposits: 0, depositAmount: '0.00000000',
        averageDeposit: '0.00000000', wagerUsd: '0.00000000', wagerCurrency: currency,
      },
      series: [],
      breakdown: { channel: [], countries: [], activeByProduct: [] },
      unconverted: [],
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  One player
  // ══════════════════════════════════════════════════════════════════════

  async forPlayer({ staff, userId, from, to, granularity, currency }) {
    const user = await this.#assertVisible(staff, userId);
    // VIP, vault, rakeback and bonus/VIP credits are house-only (the
    // `reward-stats/vip|vault|bonus` routes are `denyAgentTree`, the P&L costs
    // null): an agent-tree caller gets them as null, and they are not queried.
    const house = canManagePromotions(staff);
    const houseOnly = (query) => (house ? query() : []);
    const window = statsWindow({ from, to, granularity });
    const rates = await loadRates(this.models);
    const valuer = createValuer(rates, currency, currency ? null : await reportingCurrency(this.models, staff));
    const uid = String(user.id);

    const base = { ...window.replacements, uid, uidNum: user.id, ...(currency ? { currency } : {}) };
    const deposits = this.#depositsSql({ currency, single: true });
    const withdrawals = this.#withdrawalsSql({ currency, single: true });
    const cur = (column) => (currency ? ` AND UPPER(${column}) = :currency` : '');

    const [
      depositRows, withdrawalRows, playRows, sportsRows, bonusRows, ledgerRewardRows, periodicRows,
      tipRows, vaultMoves, vaultBalance, vaultInterest, wager, activity, adminRows,
    ] = await Promise.all([
      select(this.models, `WITH dep AS (${deposits.sql}) SELECT ${bucketSql('at')} AS bucket, cur AS currency, ROUND(SUM(amt), 8)::text AS amount, COUNT(*)::int AS n FROM dep GROUP BY 1, 2`, { ...base, ...deposits.replacements }),
      select(this.models, `WITH wd AS (${withdrawals.sql}) SELECT ${bucketSql('at')} AS bucket, cur AS currency, ROUND(SUM(amt), 8)::text AS amount, COUNT(*)::int AS n FROM wd GROUP BY 1, 2`, { ...base, ...withdrawals.replacements }),
      select(
        this.models,
        `SELECT ${bucketSql('l.created_at')} AS bucket,
                ${this.#productSql('l')} AS product,
                COALESCE(NULLIF(l.meta->>'refType', ''), NULLIF(l.source_service, ''), 'other') AS provider,
                UPPER(l.currency) AS currency, l.reason,
                ROUND(SUM(l.amount), 8)::text AS amount, COUNT(*)::int AS n
           FROM credits_ledger l
          WHERE l.user_id = :uid AND ${rangeSql('l.created_at')}
            AND l.reason IN (:playReasons)${cur('l.currency')}
          GROUP BY 1, 2, 3, 4, 5
         /* In-house rounds from before the engine wrote ledger rows — read from
            \`bets\` (casinoRounds.js INHOUSE_UNLEDGERED), the stake as a BET_STAKE and
            what it paid as a BET_PAYOUT, so a round is counted once either way. */
         UNION ALL
         SELECT ${bucketSql('b.created')}, 'casino', 'INHOUSE', UPPER(b.coin), 'BET_STAKE',
                ROUND(-SUM(b.amount), 8)::text, COUNT(*)::int
           FROM bets b
          WHERE b.uid = :uidNum AND ${rangeSql('b.created')} AND ${INHOUSE_UNLEDGERED('b')}${cur('b.coin')}
          GROUP BY 1, 4
         UNION ALL
         SELECT ${bucketSql('b.created')}, 'casino', 'INHOUSE', UPPER(b.coin), 'BET_PAYOUT',
                ROUND(SUM(${INHOUSE_PAYOUT('b')}), 8)::text, COUNT(*)::int
           FROM bets b
          WHERE b.uid = :uidNum AND ${rangeSql('b.created')} AND ${INHOUSE_UNLEDGERED('b')}
            AND b.result IS NOT NULL AND b.amount + b.profit > 0${cur('b.coin')}
          GROUP BY 1, 4
         UNION ALL
         /* Sports Exchange (mssports): settled stakes from the bets (wager report rule, SPORTS_TURNOVER),
            and won = those stakes back plus the player's P/L on the settlement ledger (LEDGER_PNL:
            settlement / void / commission), so GGR = −P/L. The cash a settlement credits is not a
            payout here: on a hedged market it is the exposure released, far below the stakes. */
         SELECT ${bucketSql('created_at')}, 'sports', 'SPORTS_EXCHANGE', ${SPORTS_TURNOVER.currency}, 'BET_STAKE',
                ROUND(-SUM(${SPORTS_TURNOVER.stake}), 8)::text, COUNT(*)::int
           FROM mssports."SportsBet"
          WHERE user_id = :uidNum AND ${rangeSql('created_at')} AND ${SPORTS_TURNOVER.settled}${cur(SPORTS_TURNOVER.currency)}
          GROUP BY 1, 4
         UNION ALL
         SELECT ${bucketSql('created_at')}, 'sports', 'SPORTS_EXCHANGE', ${SPORTS_TURNOVER.currency}, 'BET_PAYOUT',
                ROUND(SUM(${SPORTS_TURNOVER.stake}), 8)::text, 0
           FROM mssports."SportsBet"
          WHERE user_id = :uidNum AND ${rangeSql('created_at')} AND ${SPORTS_TURNOVER.settled}${cur(SPORTS_TURNOVER.currency)}
          GROUP BY 1, 4
         UNION ALL
         SELECT ${bucketSql('sl.created_at')}, 'sports', 'SPORTS_EXCHANGE', UPPER(sl.currency), 'BET_PAYOUT',
                ROUND(SUM(${LEDGER_PNL('sl')}), 8)::text, 0
           FROM mssports.credits_ledger sl
          WHERE sl.user_id = :uid AND sl.reason IN (:ledgerReasons)
            AND ${rangeSql('sl.created_at')}${cur('sl.currency')}
          GROUP BY 1, 4`,
        { ...base, playReasons: PLAY_REASONS, ledgerReasons: SPORTS_LEDGER_REASONS }
      ),
      select(
        this.models,
        // By the feed's sport id: `category` holds a code ('01' on every bet), not a
        // sport. Refunded and voided stakes were never risked, so they are not "stakes".
        `SELECT COALESCE(NULLIF(TRIM(b.sport_id), ''), 'other') AS sport,
                COUNT(*)::int AS bets, ROUND(COALESCE(SUM(b.usd_amount), 0), 8)::text AS usd
           FROM mssports."SportsBet" b
          WHERE b.user_id = :uidNum AND ${rangeSql('b.created_at')}
            AND LOWER(COALESCE(b.result_status, '')) NOT IN (:refundedResults)
          GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT ${TOP_N}`,
        { ...base, refundedResults: SPORTS_REFUNDED_RESULTS }
      ),
      houseOnly(() =>
        select(
          this.models,
          `SELECT UPPER(currency) AS currency,
                  ROUND(COALESCE(SUM(amount) FILTER (WHERE ${rangeSql('granted_at')}), 0), 8)::text AS granted,
                  COUNT(*) FILTER (WHERE ${rangeSql('granted_at')})::int AS granted_count,
                  ROUND(COALESCE(SUM(amount) FILTER (WHERE status = 'completed' AND ${rangeSql('completed_at')}), 0), 8)::text AS converted,
                  ROUND(COALESCE(SUM(amount) FILTER (WHERE status = 'active'), 0), 8)::text AS active
             FROM player_bonuses
            WHERE user_id = :uidNum${cur('currency')}
            GROUP BY 1`,
          base
        )
      ),
      houseOnly(() =>
        select(
          this.models,
          `SELECT l.reason, UPPER(l.currency) AS currency, ROUND(SUM(l.amount), 8)::text AS amount, COUNT(*)::int AS n
             FROM credits_ledger l
            WHERE l.user_id = :uid AND ${rangeSql('l.created_at')}
              AND l.reason IN ('BONUS', 'rakeback_claim')${cur('l.currency')}
            GROUP BY 1, 2`,
          base
        )
      ),
      houseOnly(() =>
        select(
          this.models,
          `SELECT ROUND(COALESCE(SUM(bonus_amount), 0), 8)::text AS usd, COUNT(*)::int AS n
             FROM bonus_history
            WHERE userid = :uidNum AND is_claimed IS TRUE AND ${rangeSql('claimed_at')}`,
          base
        )
      ),
      select(
        this.models,
        `SELECT CASE WHEN t.from_user_id = :uidNum THEN 'sent' ELSE 'received' END AS side,
                UPPER(t.currency) AS currency, ROUND(SUM(t.amount), 8)::text AS amount, COUNT(*)::int AS n
           FROM tips t
          WHERE (t.from_user_id = :uidNum OR t.to_user_id = :uidNum) AND ${rangeSql('t.created_at')}${cur('t.currency')}
          GROUP BY 1, 2`,
        base
      ),
      houseOnly(() =>
        select(
          this.models,
          `SELECT CASE WHEN v.type = 'transfer_in' THEN 'in' ELSE 'out' END AS side,
                  UPPER(v.coin) AS currency, ROUND(SUM(v.amount), 8)::text AS amount, COUNT(*)::int AS n
             FROM vault_transactions v
            WHERE v.userid = :uidNum AND ${rangeSql('v."createdAt"')}${cur('v.coin')}
            GROUP BY 1, 2`,
          base
        )
      ),
      houseOnly(() =>
        select(
          this.models,
          `SELECT UPPER(p.coin) AS currency, ROUND(COALESCE(SUM(COALESCE(p.principal, p."vaultBalance")), 0), 8)::text AS amount
             FROM vault_pro p
            WHERE p.userid = :uidNum AND p.status = 'active'${cur('p.coin')}
            GROUP BY 1`,
          base
        )
      ),
      houseOnly(() =>
        select(
          this.models,
          `SELECT UPPER(i.coin) AS currency, ROUND(SUM(i.interest), 8)::text AS amount
             FROM vault_interest_history i
            WHERE i.userid = :uidNum AND ${rangeSql('i."createdAt"')}${cur('i.coin')}
            GROUP BY 1`,
          base
        )
      ),
      this.models.Userwager.findOne({ where: { uid: user.id }, attributes: ['wager'], raw: true }),
      select(
        this.models,
        `SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM credits_ledger WHERE user_id = :uid`,
        base
      ),
      // The Super Admin's Direct User Wallet credit / debit: its own line, never a deposit / withdrawal.
      select(
        this.models,
        `SELECT UPPER(l.currency) AS currency, l.reason, ROUND(SUM(ABS(l.amount)), 8)::text AS amount
           FROM credits_ledger l
          WHERE l.user_id = :uid AND l.reason IN (:dwIn, :dwOut) AND l.meta->>'refType' = :dwRef
            AND ${rangeSql('l.created_at')}${cur('l.currency')}
          GROUP BY 1, 2`,
        { ...base, dwIn: DIRECT_WALLET_LEDGER.deposit, dwOut: DIRECT_WALLET_LEDGER.withdrawal, dwRef: DIRECT_WALLET_LEDGER.refType }
      ),
    ]);

    // ── Money in and out ──────────────────────────────────────────────────
    const zeroMoney = { deposits: 0n, withdrawals: 0n, wagered: 0n, won: 0n, ggr: 0n };
    const series = new Map();
    let deposited = 0n;
    let withdrawn = 0n;
    let depositCount = 0;
    let withdrawalCount = 0;
    for (const row of depositRows) {
      const v = valuer.value(row.amount, row.currency);
      seriesRow(series, row.bucket, zeroMoney).deposits += v;
      deposited += v;
      depositCount += row.n;
    }
    for (const row of withdrawalRows) {
      const v = valuer.value(row.amount, row.currency);
      seriesRow(series, row.bucket, zeroMoney).withdrawals += v;
      withdrawn += v;
      withdrawalCount += row.n;
    }

    // ── Play ──────────────────────────────────────────────────────────────
    const products = { casino: { ...zeroMoney, bets: 0 }, sports: { ...zeroMoney, bets: 0 } };
    const providers = new Map();
    for (const row of playRows) {
      const v = valuer.value(row.amount, row.currency);
      const s = seriesRow(series, row.bucket, zeroMoney);
      const p = products[row.product] ?? products.casino;
      const provider = providers.get(row.provider) ?? { wagered: 0n, won: 0n, bets: 0 };
      if (row.reason === 'BET_STAKE') {
        // Stakes are written negative.
        s.wagered -= v;
        p.wagered -= v;
        provider.wagered -= v;
        p.bets += row.n;
        provider.bets += row.n;
      } else if (row.reason === 'BET_PAYOUT') {
        s.won += v;
        p.won += v;
        provider.won += v;
      } else if (v < 0n) {
        // A rollback that took a win (or refund) back — a debit. Off the wins,
        // as `statements.constants.js` gisKindSql books it; GGR is the same.
        s.won += v;
        p.won += v;
        provider.won += v;
      } else {
        // A refund, or a rollback of a stake: it returns the stake, which was
        // never wagered. GIS writes these too, so Slotegrator is netted here.
        s.wagered -= v;
        p.wagered -= v;
        provider.wagered -= v;
      }
      providers.set(row.provider, provider);
    }
    for (const s of series.values()) s.ggr = s.wagered - s.won;
    for (const p of Object.values(products)) p.ggr = p.wagered - p.won;
    const wagered = products.casino.wagered + products.sports.wagered;
    const won = products.casino.won + products.sports.won;

    // ── Rewards ───────────────────────────────────────────────────────────
    let bonusGranted = 0n;
    let bonusConverted = 0n;
    let bonusActive = 0n;
    let bonusGrantedCount = 0;
    for (const row of bonusRows) {
      bonusGranted += valuer.value(row.granted, row.currency);
      bonusConverted += valuer.value(row.converted, row.currency);
      bonusActive += valuer.value(row.active, row.currency);
      bonusGrantedCount += row.granted_count;
    }
    let rewardsCredited = 0n;
    let rakeback = 0n;
    for (const row of ledgerRewardRows) {
      const v = valuer.value(row.amount, row.currency);
      if (row.reason === 'rakeback_claim') rakeback += v;
      else rewardsCredited += v;
    }

    const sum = (rows, pick = () => true) =>
      rows.filter(pick).reduce((acc, row) => acc + valuer.value(row.amount, row.currency), 0n);
    const count = (rows, pick) => rows.filter(pick).reduce((acc, row) => acc + row.n, 0);

    const lifetimeWager = String(wager?.wager ?? '0').replace(/,/g, '') || '0';
    const ladder = house ? await resolveVipLadder(this.models, { logger: this.logger }) : null;
    const vip = ladder ? ladder.levelFor(lifetimeWager) : null;

    const out = (v) => decimal(v);
    /** A house-only figure: the value for house staff, null for the agent tree. */
    const h = (v) => (house ? v : null);
    return {
      range: rangeBlock(window, valuer.currency),
      player: { id: uid, name: user.name ?? null, registeredAt: user.created ?? null },
      house,
      note: house ? null : HOUSE_ONLY_NOTE,
      kpis: {
        deposited: out(deposited),
        deposits: depositCount,
        withdrawn: out(withdrawn),
        withdrawals: withdrawalCount,
        netDeposit: out(deposited - withdrawn),
        adminCredited: out(sum(adminRows, (r) => r.reason === DIRECT_WALLET_LEDGER.deposit)),
        adminDebited: out(sum(adminRows, (r) => r.reason === DIRECT_WALLET_LEDGER.withdrawal)),
        wagered: out(wagered),
        casinoWagered: out(products.casino.wagered),
        sportsWagered: out(products.sports.wagered),
        won: out(won),
        ggr: out(wagered - won),
        bets: products.casino.bets + products.sports.bets,
        bonusGranted: h(out(bonusGranted)),
        bonusGrantedCount: h(bonusGrantedCount),
        bonusConverted: h(out(bonusConverted)),
        bonusActive: h(out(bonusActive)),
        rakebackClaimed: h(out(rakeback)),
        rewardsCredited: h(out(rewardsCredited)),
        /** Daily/weekly/monthly VIP bonuses claimed — designed and recorded in USD. */
        vipPeriodicClaimedUsd: h(decimal(periodicRows[0]?.usd ?? '0')),
        tipsSent: out(sum(tipRows, (r) => r.side === 'sent')),
        tipsSentCount: count(tipRows, (r) => r.side === 'sent'),
        tipsReceived: out(sum(tipRows, (r) => r.side === 'received')),
        tipsReceivedCount: count(tipRows, (r) => r.side === 'received'),
        vaultIn: h(out(sum(vaultMoves, (r) => r.side === 'in'))),
        vaultOut: h(out(sum(vaultMoves, (r) => r.side === 'out'))),
        vaultBalance: h(out(sum(vaultBalance))),
        vaultInterest: h(out(sum(vaultInterest))),
        lifetimeWagerUsd: vip ? vip.wager : lifetimeWager,
        vip: vip && { level: vip.level, name: vip.name, card: vip.card, nextName: vip.nextName, progressPct: vip.progressPct },
        firstActivityAt: activity[0]?.first_at ?? null,
        lastActivityAt: activity[0]?.last_at ?? null,
      },
      series: byBucket(series).map((s) => ({
        bucket: s.bucket,
        deposits: out(s.deposits),
        withdrawals: out(s.withdrawals),
        wagered: out(s.wagered),
        won: out(s.won),
        ggr: out(s.ggr),
      })),
      breakdown: {
        products: ['casino', 'sports'].map((key) => ({
          key,
          label: key === 'casino' ? 'Casino' : 'Sports',
          wagered: out(products[key].wagered),
          won: out(products[key].won),
          ggr: out(products[key].ggr),
          bets: products[key].bets,
        })),
        providers: [...providers]
          .map(([key, p]) => ({ key, label: key, wagered: out(p.wagered), won: out(p.won), ggr: out(p.wagered - p.won), bets: p.bets }))
          .sort((a, b) => Number(b.wagered) - Number(a.wagered))
          .slice(0, TOP_N),
        sports: sportsRows.map((row) => ({
          key: row.sport,
          label: row.sport === 'other' ? 'Other' : SPORT_NAMES[row.sport] ?? `Sport ${row.sport}`,
          bets: row.bets,
          wagerUsd: decimal(row.usd),
        })),
      },
      unconverted: [...valuer.unconverted],
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Turnover per bucket and currency from the wager reports' sources
   * (`wagerStats.service` CASINO_SOURCES and SPORTS_TURNOVER): the four casino
   * tables with their stake rules (bot rounds out, GIS refunds netted, PKR
   * folded into INR) and settled sports stakes. So "Wagered" here is the
   * casino plus the sports wager report for the same window and players.
   *
   * It used to be `wager_activity`, the wager FEED: it also carries
   * `demo_seed` rows (the seeded VIP cast's feed-only wagers, with no game
   * row behind them), values each row at the rate of the day it was written,
   * and does not net GIS refunds the way the reports do.
   */
  #wagerRows({ scope, base, currency }) {
    const inScope = (owner) => `${owner} IN (SELECT u.id FROM users u WHERE ${scope.sql})`;
    const parts = CASINO_SOURCES.map(
      (s) => `SELECT ${bucketSql(s.time)} AS bucket, ${s.currencySql} AS currency, (${s.wagered})::text AS wagered
                FROM ${s.table}
               WHERE ${rangeSql(s.time)} AND ${inScope(s.owner)}${s.where}${currency ? ` AND ${s.currencySql} = :currency` : ''}
               GROUP BY 1, 2`
    );
    parts.push(
      `SELECT ${bucketSql('created_at')} AS bucket, ${SPORTS_TURNOVER.currency} AS currency,
              COALESCE(SUM(${SPORTS_TURNOVER.stake}) FILTER (WHERE ${SPORTS_TURNOVER.settled}), 0)::text AS wagered
         FROM mssports."SportsBet"
        WHERE ${rangeSql('created_at')} AND ${inScope('user_id')}${currency ? ` AND ${SPORTS_TURNOVER.currency} = :currency` : ''}
        GROUP BY 1, 2`
    );
    return select(this.models, parts.join('\n UNION ALL \n'), { ...base, ...(currency ? { currency } : {}) });
  }

  /**
   * Players with play in the window — any row in the wager reports' sources
   * (their `uniqueUsers` rule) — per bucket, or as totals split by product.
   */
  #activeRows({ scope, base, totals }) {
    const plays = playsSql((owner) => `${owner} IN (SELECT u.id FROM users u WHERE ${scope.sql})`);
    const sql = totals
      ? `SELECT COUNT(DISTINCT owner)::int AS active,
                COUNT(DISTINCT owner) FILTER (WHERE product = 'sports')::int AS sports,
                COUNT(DISTINCT owner) FILTER (WHERE product = 'casino')::int AS casino,
                COUNT(DISTINCT owner) FILTER (WHERE product = 'originals')::int AS originals
           FROM (${plays}) AS p`
      : `SELECT bucket, COUNT(DISTINCT owner)::int AS active,
                COUNT(DISTINCT owner) FILTER (WHERE product = 'originals')::int AS originals
           FROM (${plays}) AS p GROUP BY 1`;
    return select(this.models, sql, base);
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * The player, if the caller may see them — the player detail's own check
   * (`ReportsService.#assertVisible`): the listing's scope plus the id, and one
   * error for "no such player" and "not yours".
   */
  async #assertVisible(staff, userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) throw errors.PLAYER_NOT_FOUND({ userId });

    const scope = await playerScope(this.models, staff, { channel: 'all', logger: this.logger });
    if (scope.empty) throw errors.PLAYER_NOT_FOUND({ userId });

    const [user] = await select(
      this.models,
      `SELECT u.id, u.name, u.created FROM users u WHERE u.id = :id AND ${scope.sql}`,
      { id, ...scope.replacements }
    );
    if (!user) throw errors.PLAYER_NOT_FOUND({ userId });
    return { ...user, id: Number(user.id) };
  }

  /**
   * casino-service rows (Original Games, in-house, aggregators) are casino even with a `bet_id` — Original
   * Games writes the round's og_transactions id there. Otherwise sports rows carry a bet/match/sport id or
   * come from sports-service; everything else is casino.
   */
  #productSql(alias) {
    return `CASE WHEN ${alias}.source_service ILIKE '%casino%' OR ${alias}.meta->>'refType' = 'OG' THEN 'casino'
                 WHEN ${alias}.bet_id IS NOT NULL OR ${alias}.sport_id IS NOT NULL OR ${alias}.match_id IS NOT NULL
                   OR ${alias}.source_service ILIKE '%sport%' THEN 'sports' ELSE 'casino' END`;
  }

  /**
   * Successful deposits in the window as `(uid, at, cur, amt)` rows — the
   * dashboard's four tables. `single` narrows to `:uid` (indexed on every
   * table but `ccdeposit`).
   */
  #depositsSql({ currency, single = false } = {}) {
    const real = realDepositsSql({
      range: (column) => ` AND ${rangeSql(column)}`,
      who: (column) => (single ? ` AND ${column}::text = :uid` : ''),
      currency: Boolean(currency),
    });
    const replacements = { ...real.replacements, agentFunding: AGENT_FUNDING };
    const sql = [
      real.sql,
      // An agent funding its player. (The Super Admin's Direct User Wallet credit is NOT a deposit — owner, 19 Oct 2026.)
      `SELECT t.to_id, t.created_at, 'INR', t.amount, 'agent'
         FROM staff_transfers t
        WHERE t.to_type = 'user' AND t.transfer_type IN (:agentFunding) AND ${rangeSql('t.created_at')}${single ? ' AND t.to_id = :uidNum' : ''}${currency ? " AND 'INR' = :currency" : ''}`,
    ].join('\n UNION ALL \n');

    return { sql, replacements };
  }

  /**
   * Depositors in the window who had ALSO deposited before it — so a
   * first-time depositor is one who is not in this set. Probed per depositor
   * on the owner indexes, never a scan of the whole history.
   */
  #priorDepositorsSql() {
    const prior = realDepositsSql({
      range: (column) => ` AND ${column} < CAST(:rangeFrom AS timestamptz)`,
      who: (column) => ` AND ${column}::text = f.uid::text`,
    });
    return `SELECT DISTINCT f.uid FROM (SELECT DISTINCT uid FROM mine) f
             WHERE EXISTS (${prior.sql.replace(/\n UNION ALL \n/g, ') OR EXISTS (')})
                OR EXISTS (SELECT 1 FROM staff_transfers t WHERE t.to_type = 'user' AND t.to_id = f.uid AND t.transfer_type IN (:agentFunding) AND t.created_at < CAST(:rangeFrom AS timestamptz))`;
  }

  /** Completed withdrawals in the window: crypto, bank and gateway (not refunded). */
  #withdrawalsSql({ currency, single = false } = {}) {
    const replacements = {
      okCrypto: WITHDRAWAL_DONE.withdrawals,
      okBank: WITHDRAWAL_DONE.fiat_withdrawals,
      okGateway: WITHDRAWAL_DONE.apaywithdrawals,
      agentFunding: AGENT_FUNDING,
    };
    const cur = (expr) => (currency ? ` AND UPPER(${expr}) = :currency` : '');
    const who = (column, text = false) => (single ? ` AND ${column} = ${text ? ':uid' : ':uidNum'}` : '');

    const sql = [
      `SELECT w.uid::bigint AS uid, w.date AS at, UPPER(w.coin) AS cur, w.amount AS amt
         FROM withdrawals w
        WHERE LOWER(w.status) IN (:okCrypto) AND ${rangeSql('w.date')}${who('w.uid')}${cur('w.coin')}`,
      `SELECT f.uid::bigint, f.date, UPPER(f.currency), f.amount
         FROM fiat_withdrawals f
        WHERE LOWER(f.status) IN (:okBank) AND ${rangeSql('f.date')}${who('f.uid')}${cur('f.currency')}`,
      `SELECT CASE WHEN g.user_id ~ '^[0-9]{1,18}$' THEN g.user_id::bigint END, g.created_at, UPPER(g.currency), g.amount
         FROM apaywithdrawals g
        WHERE LOWER(g.status) IN (:okGateway) AND (g.refunded IS NOT TRUE)
          AND ${rangeSql('g.created_at')}${who('g.user_id', true)}${cur('g.currency')}`,
      // An agent collecting from its player. (A Direct User Wallet debit is not a withdrawal — owner, 19 Oct 2026.)
      `SELECT t.from_id, t.created_at, 'INR', t.amount
         FROM staff_transfers t
        WHERE t.from_type = 'user' AND t.transfer_type IN (:agentFunding) AND ${rangeSql('t.created_at')}${who('t.from_id')}${cur("'INR'")}`,
    ].join('\n UNION ALL \n');

    return { sql, replacements };
  }
}

/**
 * Every play row in [:rangeFrom, :rangeTo) as (bucket, owner, product) — the wager reports' sources
 * (their `uniqueUsers` rule). `inScope(ownerColumn)` limits the players. "Active players" here and
 * the Users page's "Active users" both count its distinct owners.
 */
function playsSql(inScope) {
  return [
    ...CASINO_SOURCES.map(
      (s) => `SELECT ${bucketSql(s.time)} AS bucket, ${s.owner}::bigint AS owner, '${s.category === 'originals' ? 'originals' : 'casino'}' AS product
                FROM ${s.table} WHERE ${rangeSql(s.time)} AND ${inScope(s.owner)}${s.where}`
    ),
    `SELECT ${bucketSql('created_at')} AS bucket, user_id::bigint AS owner, 'sports' AS product
       FROM mssports."SportsBet" WHERE ${rangeSql('created_at')} AND ${inScope('user_id')}`,
  ].join('\n UNION ALL \n');
}

module.exports = { PlayerStatsService, playsSql };
