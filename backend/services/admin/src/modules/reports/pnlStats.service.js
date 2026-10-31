'use strict';

const { reportingCurrency } = require('./reportingCurrency');
const { marketLabel } = require('../exchange-market/betLabels');

const { canManagePromotions } = require('@ibitplay/auth');
const { INHOUSE_PAYOUT, V2_STAKE, V2_PAYOUT, OG_PLAYED } = require('../statements/casinoRounds');

/**
 * Sports Exchange ka house side (mssports), dashboard jaisa: GGR = −Σ (profit + loss) of the settlement
 * ledger (`LEDGER_PNL`, settlement / void / commission) — the market's P/L, back and lay netted.
 */
const { DashboardStatsService, SPORTS_LEDGER_REASONS, SPORTS_NOT_TURNOVER, LEDGER_PNL } = require('../dashboard/dashboardStats.service');
const dashboardConstants = require('../dashboard/dashboard.constants');
const { gisKindSql, gisSideAmountSql, gisBetCountSql, gisPlayFilterSql } = require('../statements/statements.constants');
const { playerScope, statsWindow, bucketSql, rangeSql, select, loadRates, createValuer, minor, decimal } = require('./audienceStats.helpers');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROFIT & LOSS — what the house made, what it gave back, what is left
 *
 *   GET /reports/pnl-stats/summary     the waterfall, the KPIs, per-bucket series
 *   GET /reports/pnl-stats/breakdown   casino by provider / category / game, sports
 *                                      by sport / market / event, originals, players
 *
 * Nothing here is a new definition. Each figure is one an existing report
 * already shows, so the P&L page and those pages agree for the same filter:
 *
 *   Casino GGR      the DASHBOARD's figure, read by calling
 *                   `DashboardStatsService.series` itself: stakes − wins over
 *                   the four casino sources (in-house `bets` minus bot rounds,
 *                   Slotegrator bets by ABS(amount) less refunds and rollbacks —
 *                   `statements.constants.js` gisKindSql — jsGames v1 and v2). A Slotegrator
 *                   game whose catalogue type says "sport" is the partner
 *                   sportsbook and counts under SPORTS.
 *   Sports GGR      the dashboard's figure too: the house side of the sports
 *                   settlement ledger (−SUM(profit + loss) over the statements
 *                   module's reasons, by ledger time) + the partner sportsbook's
 *                   stakes − wins.
 *                   Plus the Original Games aggregator (`og_transactions`). The
 *                   waterfall splits casino into third-party and Original Games
 *                   (in-house + aggregator, the dashboard's `originals*`).
 *   Gross gaming revenue (GGR) = Casino GGR + Sports GGR.
 *   Player costs    money the house put in players' wallets that no bet paid
 *                   for — read from the wallet ledger (`credits_ledger`), the
 *                   place every reward path credits (see the reward-currency
 *                   skill): `BONUS` rows by `meta.refType`, `rakeback_claim`,
 *                   `race_reward_claim`, less any `BONUS_REVERSAL` that undid one;
 *                   plus vault interest (`vault_interest_history`). The same rows
 *                   `reward-stats/vip|bonus|affiliate|vault` count.
 *   Net profit      GGR − player costs.
 *   Cash flow       the dashboard's deposits − withdrawals. Shown, never added
 *                   in: a deposit is the player's money, not revenue.
 *
 * The breakdown re-reads the casino and sports rows per game / sport / event
 * with the dashboard's exact filters (copied below, one place), so its rows sum
 * back to the summary's GGR. `pnlStats.test.js` holds the two side by side.
 *
 * ── WHOSE FIGURES ────────────────────────────────────────────────────────
 * The caller's tree. The GGR and cash-flow totals come from the dashboard,
 * which scopes by `visibleStaffIds`; the costs, breakdowns and players use
 * `playerScope` — the `reports/players` rule built on the same
 * `visibleStaffIds`, so both cover the same players.
 *
 * Player costs are HOUSE-ONLY, like `reward-stats/vip|bonus|affiliate|vault`
 * (`denyAgentTree` there): an agent-tree caller gets the GGR of their tree and
 * `costs: null`, `netProfit: null`, with a note saying why.
 *
 * ── CURRENCY ─────────────────────────────────────────────────────────────
 * With `currency`, only rows in that coin, unconverted. Without it, USD at
 * TODAY's rate (`VALUATION_NOTE`); a coin with no rate is left out and listed
 * under `unconverted`, never counted as zero.
 *
 * ── SQL ──────────────────────────────────────────────────────────────────
 * Every value is a replacement. The only text spliced in is fixed column and
 * table names from this file. Each window is `col >= from AND col < to` on the
 * raw column; buckets are UTC `date_trunc` keys ('YYYY-MM-DD', weeks from
 * Monday), every bucket of the window present and zero-filled.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Bot / QA in-house rounds carry `result.fake` — not play (the casino service's rule). */
const NOT_FAKE = `(b.result->>'fake') IS DISTINCT FROM 'true'`;

/** A settled sports bet whose result is a refund never risked its stake (the dashboard's list). */
const SPORTS_REFUNDED_RESULTS = dashboardConstants.SPORTS_REFUNDED_RESULTS ?? ['refund', 'refunded', 'voided_after_settlement'];
const SPORT_NAMES = dashboardConstants.SPORT_NAMES ?? {};
const VALUATION_NOTE = dashboardConstants.VALUATION_NOTE;

/** 'Cricket' for '4', "Sport 99" for an unknown id, 'Other' for none — the dashboard's naming. */
const sportName = (id) => (id === 'other' ? 'Other' : SPORT_NAMES[id] ?? `Sport ${id}`);

/** `gis_transactions.currency` says PKR for this platform's INR wallet (statements.constants). */
const GIS_CURRENCY = `(CASE WHEN UPPER(g.currency) = 'PKR' THEN 'INR' ELSE UPPER(COALESCE(g.currency, '')) END)`;
// A Slotegrator round's game, as `gg`: the lobby's catalogue first (gisgamesnew, or parked when the other aggregator is live), the legacy gis_games after.
const GIS_GAME_JOIN = `LEFT JOIN LATERAL (
            SELECT name, provider, type FROM (
              SELECT 1 AS o, name, provider, type FROM gisgamesnew WHERE uuid = g.game_uuid
              UNION ALL SELECT 2, name, provider, type FROM gisgamesnew_parked WHERE uuid = g.game_uuid
              UNION ALL SELECT 3, name, provider, type FROM gis_games WHERE uuid = g.game_uuid
            ) c ORDER BY o LIMIT 1
          ) gg ON true`;
const SPORTS_CURRENCY = (alias) => `UPPER(COALESCE(NULLIF(${alias}.original_currency, ''), 'INR'))`;

/** Ledger reasons that are a reward paid to a wallet. */
const REWARD_REASONS = Object.freeze(['BONUS', 'rakeback_claim', 'race_reward_claim']);

/**
 * The cost lines, in waterfall order. A ledger row belongs to the first line
 * whose `reason` / `refTypes` match; any other `BONUS` lands in `otherBonus`.
 * The refTypes are the strings user-service writes (grep `refType:`).
 */
const COST_LINES = Object.freeze([
  { key: 'rakeback', label: 'Rakeback paid', reason: 'rakeback_claim' },
  { key: 'vip', label: 'VIP level-up & rank-up', refTypes: ['VIP_LEVEL_UP', 'VIP_RANK_UP'] },
  { key: 'periodic', label: 'Daily / weekly / monthly bonus', refTypes: ['BONUS_AWARD'] },
  { key: 'depositBonus', label: 'Deposit bonuses converted', refTypes: ['FIRST_DEPOSIT_BONUS', 'PLAYER_BONUS'] },
  { key: 'spinWheel', label: 'Spin wheel', refTypes: ['SPIN_WHEEL_BONUS'] },
  { key: 'affiliate', label: 'Affiliate commission', refTypes: ['AFFILIATE_COMMISSION'] },
  { key: 'affiliateTiers', label: 'Affiliate tier rewards', refTypes: ['AFFILIATE_REWARD'] },
  { key: 'welcome', label: 'Welcome / register bonus', refTypes: ['AFFILIATE_REGISTER_BONUS'] },
  { key: 'races', label: 'Race prizes', reason: 'race_reward_claim' },
  { key: 'redeemCodes', label: 'Redeem codes', refTypes: ['REDEEM_CODE'] },
  { key: 'giftCards', label: 'Gift cards', refTypes: ['GIFT_CARD'] },
  { key: 'staffGrants', label: 'Staff bonus grants', refTypes: ['BONUS_GRANT'] },
  { key: 'vaultInterest', label: 'Vault interest', reason: 'VAULT_INTEREST' },
  { key: 'otherBonus', label: 'Other bonuses', reason: 'BONUS' },
]);
const COST_KEYS = COST_LINES.map((l) => l.key);

/** The cost line a ledger `(reason, refType)` belongs to. */
function costLineOf(reason, refType) {
  for (const line of COST_LINES) {
    if (line.refTypes && reason === 'BONUS' && line.refTypes.includes(refType)) return line.key;
    if (line.reason && line.reason === reason) return line.key;
  }
  return 'otherBonus';
}

const STEP = Object.freeze({ day: '1 day', week: '1 week', month: '1 month' });

/** How many rows each top / worst list returns, and the ceiling on a dimension list. */
const TOP_N = 10;
const MAX_DIMENSION_ROWS = 50;

/** Per currency, how many players the ranking query keeps at each end. */
const PLAYERS_PER_CURRENCY = 200;

const HOUSE_ONLY_NOTE =
  'Player costs (bonuses, rakeback, VIP, affiliate, vault) are house-only figures, as on the Rewards pages. ' +
  'This view shows the gaming revenue of your tree; net profit needs the costs and is not shown.';

const cmp = (a, b) => (a > b ? 1 : a < b ? -1 : 0);

class PnlStatsService {
  constructor(deps) {
    this.deps = deps;
    this.models = deps.models;
    this.logger = deps.logger;
    this.config = deps.config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Summary
  // ══════════════════════════════════════════════════════════════════════

  async summary({ staff, from, to, granularity = 'day', currency, channel }) {
    const window = statsWindow({ from, to, granularity });
    const house = canManagePromotions(staff);
    const [scope, rates, buckets] = await Promise.all([
      playerScope(this.models, staff, { channel, logger: this.logger }),
      loadRates(this.models),
      this.#buckets(window),
    ]);
    const valuer = createValuer(rates, currency, currency ? null : await reportingCurrency(this.models, staff));
    const ctx = this.#ctx(window, scope, currency);

    const [gaming, costRows] = await Promise.all([
      // The same Direct / Agent tab as the breakdown below, or the tile and its section disagree.
      this.#dashboard(channel).series({
        actor: staff,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        granularity,
        currency,
      }),
      house && !scope.empty ? this.#costRows(ctx) : [],
    ]);

    // ── Revenue and cash flow, per bucket, exactly as the dashboard sends them ──
    const zero = () => ({
      casinoGgr: 0n, originalsGgr: 0n, sportsGgr: 0n, casinoWagered: 0n, casinoWon: 0n, sportsStaked: 0n,
      deposits: 0n, withdrawals: 0n, costs: 0n, ...Object.fromEntries(COST_KEYS.map((k) => [k, 0n])),
    });
    const rows = new Map(buckets.map((b) => [b, zero()]));
    const rowOf = (b) => rows.get(b) ?? rows.set(b, zero()).get(b);
    for (const b of gaming.buckets) {
      const r = rowOf(b.bucket);
      for (const k of ['casinoGgr', 'originalsGgr', 'sportsGgr', 'casinoWagered', 'casinoWon', 'sportsStaked', 'deposits', 'withdrawals']) r[k] += minor(b[k]);
    }

    // ── Player costs (house only) ──
    const lineTotals = new Map(COST_KEYS.map((k) => [k, { value: 0n, count: 0 }]));
    for (const c of costRows) {
      const key = costLineOf(c.reason, c.ref);
      const v = valuer.value(c.amount, c.currency);
      const r = rowOf(c.bucket);
      r[key] += v;
      r.costs += v;
      const t = lineTotals.get(key);
      t.value += v;
      t.count += Number(c.n) || 0;
    }

    const T = gaming.totals;
    const casinoGgr = minor(T.casinoGgr);
    const originalsGgr = minor(T.originalsGgr);
    const sportsGgr = minor(T.sportsGgr);
    const ggr = casinoGgr + sportsGgr;
    const costs = [...lineTotals.values()].reduce((s, t) => s + t.value, 0n);
    const turnover = minor(T.casinoWagered) + minor(T.sportsStaked);

    const costLines = house
      ? COST_LINES.map((l) => ({ key: l.key, label: l.label, value: decimal(lineTotals.get(l.key).value), count: lineTotals.get(l.key).count }))
      : null;

    const waterfall = [
      { key: 'thirdPartyGgr', label: 'Casino GGR (third-party)', kind: 'revenue', value: decimal(casinoGgr - originalsGgr) },
      { key: 'originalsGgr', label: 'Original Games GGR', kind: 'revenue', value: decimal(originalsGgr) },
      { key: 'sportsGgr', label: 'Sports GGR', kind: 'revenue', value: decimal(sportsGgr) },
      { key: 'ggr', label: 'Gross gaming revenue', kind: 'total', value: decimal(ggr) },
      ...(house
        ? [
            ...costLines.filter((l) => l.value !== decimal(0n) || l.count > 0).map((l) => ({ key: l.key, label: l.label, kind: 'cost', value: decimal(-minor(l.value)) })),
            { key: 'netProfit', label: 'Net profit', kind: 'total', value: decimal(ggr - costs) },
          ]
        : []),
    ];

    const unconverted = new Set([...valuer.unconverted, ...gaming.unconverted.map((u) => u.currency || 'UNKNOWN')]);

    return {
      range: this.#range(window, valuer.currency),
      converted: !currency,
      valuation: currency ? null : { note: VALUATION_NOTE },
      house,
      kpis: {
        casinoGgr: decimal(casinoGgr),
        thirdPartyGgr: decimal(casinoGgr - originalsGgr),
        originalsGgr: decimal(originalsGgr),
        originalsWagered: T.originalsWagered,
        originalsWon: T.originalsWon,
        originalsBets: T.originalsBets,
        sportsGgr: decimal(sportsGgr),
        ggr: decimal(ggr),
        costs: house ? decimal(costs) : null,
        netProfit: house ? decimal(ggr - costs) : null,
        casinoWagered: T.casinoWagered,
        casinoWon: T.casinoWon,
        casinoBets: T.casinoBets,
        sportsStaked: T.sportsStaked,
        sportsBets: T.sportsBets,
        /** GGR over turnover, %. */
        holdPercent: turnover ? Math.round((Number(decimal(ggr)) / Number(decimal(turnover))) * 10_000) / 100 : null,
        deposits: T.deposits,
        withdrawals: T.withdrawals,
        netCashflow: T.net,
      },
      costLines,
      waterfall,
      series: [...rows.entries()]
        .sort(([a], [b]) => cmp(a, b))
        .map(([bucket, r]) => ({
          bucket,
          casinoGgr: decimal(r.casinoGgr),
          originalsGgr: decimal(r.originalsGgr),
          sportsGgr: decimal(r.sportsGgr),
          ggr: decimal(r.casinoGgr + r.sportsGgr),
          costs: house ? decimal(r.costs) : null,
          netProfit: house ? decimal(r.casinoGgr + r.sportsGgr - r.costs) : null,
          deposits: decimal(r.deposits),
          withdrawals: decimal(r.withdrawals),
          netCashflow: decimal(r.deposits - r.withdrawals),
          ...(house ? Object.fromEntries(COST_KEYS.map((k) => [k, decimal(r[k])])) : {}),
        })),
      notes: { costs: house ? null : HOUSE_ONLY_NOTE },
      unconverted: [...unconverted],
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Breakdown
  // ══════════════════════════════════════════════════════════════════════

  async breakdown({ staff, from, to, granularity = 'day', currency, channel }) {
    const window = statsWindow({ from, to, granularity });
    const [scope, rates] = await Promise.all([playerScope(this.models, staff, { channel, logger: this.logger }), loadRates(this.models)]);
    const valuer = createValuer(rates, currency, currency ? null : await reportingCurrency(this.models, staff));
    const ctx = this.#ctx(window, scope, currency);

    const [gameRows, sportRows, playerRows] = scope.empty
      ? [[], [], []]
      : await Promise.all([this.#gameRows(ctx), this.#sportRows(ctx), this.#playerRows(ctx)]);

    const acc = () => ({ wagered: 0n, won: 0n, ggr: 0n, bets: 0 });
    const bump = (map, key, meta) => map.get(key) ?? map.set(key, { key, ...meta, ...acc() }).get(key);

    // ── Casino: stakes − wins per game ──
    const providers = new Map();
    const categories = new Map();
    const sources = new Map();
    const games = new Map();
    let casino = acc();
    for (const r of gameRows) {
      const wagered = valuer.value(r.wagered, r.currency);
      const won = valuer.value(r.won, r.currency);
      const add = (t) => {
        t.wagered += wagered;
        t.won += won;
        t.ggr += wagered - won;
        t.bets += Number(r.bets) || 0;
      };
      add(casino);
      add(bump(providers, r.provider, { label: r.provider }));
      add(bump(categories, r.category, { label: r.category }));
      add(bump(sources, r.source, { label: SOURCE_LABEL[r.source] ?? r.source }));
      add(bump(games, r.game_key, { label: r.name || r.game_key, provider: r.provider, category: r.category, source: r.source }));
    }

    // ── Sports: stake by placement, GGR by settlement (the dashboard's two clocks) ──
    const sports = new Map();
    const markets = new Map();
    const events = new Map();
    let sportsTotal = acc();
    for (const r of sportRows) {
      const v = valuer.value(r.total, r.currency);
      const delta = { wagered: 0n, won: 0n, ggr: 0n, bets: Number(r.n) || 0 };
      if (r.kind === 'stake') {
        delta.wagered = v;
        if (r.src === 'partner') delta.ggr = v;
      } else if (r.kind === 'win') {
        delta.won = v;
        delta.ggr = -v;
      } else {
        delta.ggr = v;
      }
      const add = (t) => {
        t.wagered += delta.wagered;
        t.won += delta.won;
        t.ggr += delta.ggr;
        t.bets += delta.bets;
      };
      const sport = r.src === 'partner' ? 'Partner sportsbook' : sportName(r.sport);
      add(sportsTotal);
      add(bump(sports, sport, { label: sport }));
      add(bump(markets, r.market, { label: marketLabel(r.market) || r.market }));
      add(bump(events, `${sport}|${r.event}`, { label: r.event, sport }));
    }

    // ── Players: casino + sports GGR per player ──
    const players = new Map();
    for (const r of playerRows) {
      if (r.uid == null) continue;
      const v = valuer.value(r.total, r.currency);
      const p = bump(players, String(r.uid), { id: String(r.uid) });
      if (r.kind === 'stake') {
        p.wagered += v;
        p.bets += Number(r.n) || 0;
        if (r.section === 'casino' || r.src === 'partner') p.ggr += v;
      } else if (r.kind === 'win') {
        p.won += v;
        p.ggr -= v;
      } else {
        p.ggr += v;
      }
    }
    const ranked = [...players.values()].sort((a, b) => cmp(b.ggr, a.ggr));
    const houseWon = ranked.filter((p) => p.ggr > 0n).slice(0, TOP_N);
    const houseLost = ranked.filter((p) => p.ggr < 0n).reverse().slice(0, TOP_N);
    const names = await this.#names([...houseWon, ...houseLost].map((p) => p.id));

    const out = (e) => ({
      ...e,
      wagered: decimal(e.wagered),
      won: decimal(e.won),
      ggr: decimal(e.ggr),
      /** GGR over stakes, %; null with no stakes in the window. */
      holdPercent: e.wagered ? Math.round((Number(decimal(e.ggr)) / Number(decimal(e.wagered))) * 10_000) / 100 : null,
    });
    const byGgr = (map) => [...map.values()].sort((a, b) => cmp(b.ggr, a.ggr) || b.bets - a.bets);
    const list = (map) => byGgr(map).slice(0, MAX_DIMENSION_ROWS).map(out);
    const best = (map) => byGgr(map).filter((e) => e.ggr > 0n).slice(0, TOP_N).map(out);
    const worst = (map) => byGgr(map).filter((e) => e.ggr < 0n).reverse().slice(0, TOP_N).map(out);

    // Only the Original Games aggregator's games; the old in-house bets stay in the casino lists.
    const originals = new Map([...games].filter(([, g]) => g.source === 'og'));

    return {
      range: this.#range(window, valuer.currency),
      converted: !currency,
      valuation: currency ? null : { note: VALUATION_NOTE },
      totals: { casino: out({ key: 'casino', label: 'Casino', ...casino }), sports: out({ key: 'sports', label: 'Sports', ...sportsTotal }) },
      casino: {
        bySource: list(sources),
        byProvider: list(providers),
        byCategory: list(categories),
        topGames: best(games),
        worstGames: worst(games),
        gameCount: games.size,
      },
      originals: list(originals),
      sports: {
        bySport: list(sports),
        byMarket: list(markets),
        topEvents: best(events),
        worstEvents: worst(events),
        eventCount: events.size,
      },
      players: {
        houseWon: houseWon.map((p) => out({ ...p, label: names.get(p.id) ?? `#${p.id}` })),
        houseLost: houseLost.map((p) => out({ ...p, label: names.get(p.id) ?? `#${p.id}` })),
      },
      unconverted: [...valuer.unconverted],
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Queries
  // ══════════════════════════════════════════════════════════════════════

  /** Ledger rewards (less reversals) and vault interest, per bucket / currency / kind. */
  #costRows(ctx) {
    const { replacements, cur, ledgerOwned } = ctx;
    return select(
      this.models,
      `SELECT ${bucketSql('l.created_at')} AS bucket, UPPER(l.currency) AS currency, l.reason,
              COALESCE(l.meta->>'refType', '') AS ref, COUNT(*)::int AS n, SUM(l.amount)::text AS amount
         FROM credits_ledger l
        WHERE l.reason IN (:rewardReasons) AND ${rangeSql('l.created_at')}${ledgerOwned('l.user_id')}${cur('l.currency')}
        GROUP BY 1, 2, 3, 4
       UNION ALL
       SELECT ${bucketSql('l.created_at')}, UPPER(l.currency), o.reason, COALESCE(o.meta->>'refType', ''), 0, (-SUM(ABS(l.amount)))::text
         FROM credits_ledger l
         JOIN credits_ledger o
           ON o.id = (CASE WHEN l.meta->>'rollbackOf' ~ '^[0-9]{1,18}$' THEN (l.meta->>'rollbackOf')::bigint END)
        WHERE l.reason = 'BONUS_REVERSAL' AND o.reason IN (:rewardReasons)
          AND ${rangeSql('l.created_at')}${ledgerOwned('l.user_id')}${cur('l.currency')}
        GROUP BY 1, 2, 3, 4
       UNION ALL
       SELECT ${bucketSql('i."createdAt"')}, UPPER(i.coin), 'VAULT_INTEREST', '', COUNT(*)::int, SUM(i.interest)::text
         FROM vault_interest_history i
        WHERE ${rangeSql('i."createdAt"')}${ctx.owned('i.userid')}${cur('i.coin')}
        GROUP BY 1, 2`,
      { ...replacements, rewardReasons: REWARD_REASONS }
    );
  }

  /**
   * Casino stakes and wins per game and currency — the dashboard's
   * `#gamingRows` casino filters, grouped by game instead of by bucket.
   */
  #gameRows(ctx) {
    const { replacements, cur, owned } = ctx;
    const sql = `
      SELECT source, provider, category, game_key, MAX(name) AS name, currency,
             COALESCE(SUM(amount) FILTER (WHERE kind = 'stake'), 0)::text AS wagered,
             COALESCE(SUM(amount) FILTER (WHERE kind = 'win'), 0)::text AS won,
             COALESCE(SUM(n), 0)::int AS bets
        FROM (
          SELECT 'inhouse' AS source, 'Originals' AS provider, 'Originals' AS category, 'inhouse:' || b.game AS game_key,
                 b.game AS name, UPPER(b.coin) AS currency, 'stake' AS kind, b.amount AS amount, 1 AS n
            FROM bets b
           WHERE b.amount > 0 AND (b.result IS NULL OR b.result::text <> '"refunded"') AND ${NOT_FAKE}
             AND ${rangeSql('b.created')}${cur('b.coin')}${owned('b.uid')}
          UNION ALL
          -- What was PAID: stake + profit on every settled round (a push or a
          -- partial return pays too), not only on rounds with profit > 0.
          SELECT 'inhouse', 'Originals', 'Originals', 'inhouse:' || b.game, b.game, UPPER(b.coin), 'win', ${INHOUSE_PAYOUT('b')}, 0
            FROM bets b
           WHERE b.result IS NOT NULL AND b.result::text <> '"refunded"' AND b.amount + b.profit > 0 AND ${NOT_FAKE}
             AND ${rangeSql('b.created')}${cur('b.coin')}${owned('b.uid')}
          UNION ALL
          SELECT 'gis', COALESCE(NULLIF(gg.provider, ''), 'Casino'), COALESCE(NULLIF(gg.type, ''), 'Other'),
                 'gis:' || COALESCE(g.game_uuid, ''), COALESCE(gg.name, g.game_uuid), ${GIS_CURRENCY},
                 ${gisKindSql('g')}, ${gisSideAmountSql('g')}, ${gisBetCountSql('g')}
            FROM gis_transactions g
            ${GIS_GAME_JOIN}
           WHERE ${gisPlayFilterSql('g')} AND LOWER(COALESCE(gg.type, '')) NOT LIKE '%sport%'
             AND ${rangeSql('g.created_at')}${ctx.currency ? ` AND ${GIS_CURRENCY} = :currency` : ''}${owned('g.user_id')}
          UNION ALL
          SELECT 'jsgames', COALESCE(NULLIF(jg.vendor, ''), 'Casino'), COALESCE(NULLIF(jg.game_type, ''), 'Other'),
                 'js:' || COALESCE(j.game_uid, ''), COALESCE(jg.game_name, j.game_uid), UPPER(j.currency),
                 CASE WHEN LOWER(j.transaction_type) = 'win' THEN 'win' ELSE 'stake' END, ABS(j.amount),
                 CASE WHEN LOWER(j.transaction_type) = 'win' THEN 0 ELSE 1 END
            FROM js_game_transactions j
            LEFT JOIN js_games jg ON jg.game_uid = j.game_uid
           WHERE j.amount <> 0 AND LOWER(j.transaction_type) IN ('bet', 'settle', 'win') AND LOWER(j.transaction_status) = 'completed'
             AND ${rangeSql('j."timestamp"')}${cur('j.currency')}${owned('j.user_id')}
          UNION ALL
          -- jsGames v2: 'amount' is win − bet, so the stake and the payout come
          -- from the callback's own bet_amount / win_amount (one row may carry
          -- both; a negative bet_amount is a correction and nets the stake off).
          SELECT 'jsgamesv2', COALESCE(NULLIF(jg2.vendor, ''), 'Casino'), COALESCE(NULLIF(jg2.game_type, ''), 'Other'),
                 'js:' || COALESCE(v.game_uid, ''), COALESCE(jg2.game_name, v.game_name, v.game_uid), UPPER(v.currency),
                 k.kind, k.amount, k.n
            FROM game_transactions v
            LEFT JOIN js_games jg2 ON jg2.game_uid = v.game_uid
            CROSS JOIN LATERAL (VALUES ('stake', ${V2_STAKE('v')}, CASE WHEN ${V2_STAKE('v')} > 0 THEN 1 ELSE 0 END),
                                       ('win', ${V2_PAYOUT('v')}, 0)) AS k(kind, amount, n)
           WHERE k.amount <> 0
             AND ${rangeSql('v.created_at')}${cur('v.currency')}${owned('v.user_id')}
          UNION ALL
          SELECT 'og', 'Original Games', 'Originals', 'og:' || COALESCE(o.game_code, ''), COALESCE(og.name, INITCAP(o.game_code)),
                 UPPER(o.currency), CASE WHEN o.kind = 'bet' THEN 'stake' ELSE 'win' END, o.amount,
                 CASE WHEN o.kind = 'bet' THEN 1 ELSE 0 END
            FROM og_transactions o
            LEFT JOIN og_games og ON og.code = o.game_code
           WHERE ${OG_PLAYED('o')} AND ${rangeSql('o.created_at')}${cur('o.currency')}${owned('o.user_id')}
        ) x
       GROUP BY source, provider, category, game_key, currency`;
    return select(this.models, sql, replacements);
  }

  /**
   * Sports per sport / market / event and currency — the dashboard's sports
   * filters: in-house stakes (turnover only), the settlement ledger's house
   * side (GGR), the partner sportsbook's stakes and wins.
   */
  #sportRows(ctx) {
    const { replacements, cur, owned, ledgerOwned } = ctx;
    const sql = `
      SELECT kind, src, sport, market, event, currency, SUM(amount)::text AS total, SUM(n)::int AS n FROM (
        SELECT 'stake' AS kind, 'house' AS src, COALESCE(NULLIF(s.sport_id, ''), 'other') AS sport,
               COALESCE(NULLIF(UPPER(s.game_type), ''), NULLIF(UPPER(s.market_type), ''), 'OTHER') AS market,
               COALESCE(NULLIF(s.event_name, ''), NULLIF(s.match_title, ''), NULLIF(s.match_id, ''), 'Unknown event') AS event,
               ${SPORTS_CURRENCY('s')} AS currency, s.stake_amount AS amount, 1 AS n
          FROM mssports."SportsBet" s
         WHERE s.stake_amount > 0 AND LOWER(COALESCE(s.status, '')) NOT IN (:notTurnover)
           AND LOWER(COALESCE(s.result_status, '')) NOT IN (:refundedResults)
           AND ${rangeSql('s.created_at')}${ctx.currency ? ` AND ${SPORTS_CURRENCY('s')} = :currency` : ''}${owned('s.user_id')}
        UNION ALL
        SELECT 'house', 'house', COALESCE(NULLIF(b.sport_id, ''), NULLIF(l.sport_id, ''), 'other'),
               COALESCE(NULLIF(UPPER(b.game_type), ''), NULLIF(UPPER(l.market_type), ''), 'OTHER'),
               COALESCE(NULLIF(b.event_name, ''), NULLIF(b.match_title, ''), NULLIF(b.match_id, ''), NULLIF(l.match_id, ''), 'Unknown event'),
               UPPER(l.currency), -${LEDGER_PNL('l')}, 0
          FROM mssports.credits_ledger l
          LEFT JOIN mssports."SportsBet" b ON b.id = l.bet_id
         WHERE l.reason IN (:ledgerReasons)
           AND ${rangeSql('l.created_at')}${cur('l.currency')}${ledgerOwned('l.user_id')}
        UNION ALL
        SELECT ${gisKindSql('g')}, 'partner', 'partner',
               UPPER(COALESCE(NULLIF(gg.provider, ''), 'Partner')), COALESCE(gg.name, g.game_uuid, 'Partner sportsbook'),
               ${GIS_CURRENCY}, ${gisSideAmountSql('g')}, ${gisBetCountSql('g')}
          FROM gis_transactions g
          ${GIS_GAME_JOIN}
         WHERE ${gisPlayFilterSql('g')} AND LOWER(COALESCE(gg.type, '')) LIKE '%sport%'
           AND ${rangeSql('g.created_at')}${ctx.currency ? ` AND ${GIS_CURRENCY} = :currency` : ''}${owned('g.user_id')}
      ) x
      GROUP BY 1, 2, 3, 4, 5, 6`;
    return select(this.models, sql, {
      ...replacements,
      notTurnover: SPORTS_NOT_TURNOVER,
      refundedResults: SPORTS_REFUNDED_RESULTS,
      ledgerReasons: SPORTS_LEDGER_REASONS,
    });
  }

  /**
   * Every casino and sports movement per player and currency, the
   * `PLAYERS_PER_CURRENCY` biggest winners and losers of each currency kept.
   */
  #playerRows(ctx) {
    const { replacements, cur, owned, ledgerOwned } = ctx;
    const sql = `
      WITH moves AS (
        SELECT b.uid AS uid, 'casino' AS section, 'stake' AS kind, 'house' AS src, UPPER(b.coin) AS currency, b.amount AS amount, 1 AS n
          FROM bets b
         WHERE b.amount > 0 AND (b.result IS NULL OR b.result::text <> '"refunded"') AND ${NOT_FAKE}
           AND ${rangeSql('b.created')}${cur('b.coin')}${owned('b.uid')}
        UNION ALL
        SELECT b.uid, 'casino', 'win', 'house', UPPER(b.coin), ${INHOUSE_PAYOUT('b')}, 0
          FROM bets b
         WHERE b.result IS NOT NULL AND b.result::text <> '"refunded"' AND b.amount + b.profit > 0 AND ${NOT_FAKE} AND ${rangeSql('b.created')}${cur('b.coin')}${owned('b.uid')}
        UNION ALL
        SELECT g.user_id, CASE WHEN LOWER(COALESCE(gg.type, '')) LIKE '%sport%' THEN 'sports' ELSE 'casino' END,
               ${gisKindSql('g')}, 'partner', ${GIS_CURRENCY}, ${gisSideAmountSql('g')}, ${gisBetCountSql('g')}
          FROM gis_transactions g
          ${GIS_GAME_JOIN}
         WHERE ${gisPlayFilterSql('g')}
           AND ${rangeSql('g.created_at')}${ctx.currency ? ` AND ${GIS_CURRENCY} = :currency` : ''}${owned('g.user_id')}
        UNION ALL
        SELECT j.user_id, 'casino', CASE WHEN LOWER(j.transaction_type) = 'win' THEN 'win' ELSE 'stake' END, 'house',
               UPPER(j.currency), ABS(j.amount), CASE WHEN LOWER(j.transaction_type) = 'win' THEN 0 ELSE 1 END
          FROM js_game_transactions j
         WHERE j.amount <> 0 AND LOWER(j.transaction_type) IN ('bet', 'settle', 'win') AND LOWER(j.transaction_status) = 'completed'
           AND ${rangeSql('j."timestamp"')}${cur('j.currency')}${owned('j.user_id')}
        UNION ALL
        SELECT v.user_id, 'casino', k.kind, 'house', UPPER(v.currency), k.amount, k.n
          FROM game_transactions v
          CROSS JOIN LATERAL (VALUES ('stake', ${V2_STAKE('v')}, CASE WHEN ${V2_STAKE('v')} > 0 THEN 1 ELSE 0 END),
                                     ('win', ${V2_PAYOUT('v')}, 0)) AS k(kind, amount, n)
         WHERE k.amount <> 0
           AND ${rangeSql('v.created_at')}${cur('v.currency')}${owned('v.user_id')}
        UNION ALL
        SELECT o.user_id, 'casino', CASE WHEN o.kind = 'bet' THEN 'stake' ELSE 'win' END, 'house', UPPER(o.currency), o.amount,
               CASE WHEN o.kind = 'bet' THEN 1 ELSE 0 END
          FROM og_transactions o
         WHERE ${OG_PLAYED('o')} AND ${rangeSql('o.created_at')}${cur('o.currency')}${owned('o.user_id')}
        UNION ALL
        SELECT s.user_id, 'sports', 'stake', 'house', ${SPORTS_CURRENCY('s')}, s.stake_amount, 1
          FROM mssports."SportsBet" s
         WHERE s.stake_amount > 0 AND LOWER(COALESCE(s.status, '')) NOT IN (:notTurnover)
           AND LOWER(COALESCE(s.result_status, '')) NOT IN (:refundedResults)
           AND ${rangeSql('s.created_at')}${ctx.currency ? ` AND ${SPORTS_CURRENCY('s')} = :currency` : ''}${owned('s.user_id')}
        UNION ALL
        SELECT CASE WHEN l.user_id ~ '^[0-9]{1,18}$' THEN l.user_id::bigint END, 'sports', 'house', 'house',
               UPPER(l.currency), -${LEDGER_PNL('l')}, 0
          FROM mssports.credits_ledger l
         WHERE l.reason IN (:ledgerReasons) AND ${rangeSql('l.created_at')}${cur('l.currency')}${ledgerOwned('l.user_id')}
      ),
      per_player AS (
        SELECT uid, currency,
               SUM(CASE WHEN kind = 'win' THEN -amount
                        WHEN kind = 'stake' AND section = 'sports' AND src = 'house' THEN 0
                        ELSE amount END) AS ggr
          FROM moves GROUP BY 1, 2
      ),
      ranked AS (
        SELECT uid, currency,
               ROW_NUMBER() OVER (PARTITION BY currency ORDER BY ggr DESC) AS top_rank,
               ROW_NUMBER() OVER (PARTITION BY currency ORDER BY ggr ASC) AS bottom_rank
          FROM per_player
      )
      SELECT m.uid, m.section, m.kind, m.src, m.currency, SUM(m.amount)::text AS total, SUM(m.n)::int AS n
        FROM moves m
        JOIN ranked r ON r.uid = m.uid AND r.currency = m.currency
       WHERE r.top_rank <= :perCurrency OR r.bottom_rank <= :perCurrency
       GROUP BY 1, 2, 3, 4, 5`;
    return select(this.models, sql, {
      ...replacements,
      perCurrency: PLAYERS_PER_CURRENCY,
      notTurnover: SPORTS_NOT_TURNOVER,
      refundedResults: SPORTS_REFUNDED_RESULTS,
      ledgerReasons: SPORTS_LEDGER_REASONS,
    });
  }

  async #names(ids) {
    if (!ids.length) return new Map();
    const rows = await select(this.models, 'SELECT id::text AS id, name FROM users WHERE id IN (:ids)', { ids: ids.map(Number) });
    return new Map(rows.map((r) => [String(r.id), r.name]));
  }

  /** Every bucket key of the window, so a quiet day is a zero rather than a gap. */
  async #buckets(window) {
    const rows = await select(
      this.models,
      `SELECT to_char(gs, 'YYYY-MM-DD') AS bucket
         FROM generate_series(
                date_trunc(:gran, CAST(:rangeFrom AS timestamptz) AT TIME ZONE 'UTC'),
                (CAST(:rangeTo AS timestamptz) AT TIME ZONE 'UTC') - interval '1 microsecond',
                CAST(:step AS interval)
              ) AS gs`,
      { ...window.replacements, step: STEP[window.granularity] }
    );
    return rows.map((r) => r.bucket);
  }

  // ══════════════════════════════════════════════════════════════════════

  #ctx(window, scope, currency) {
    return {
      currency: currency || null,
      replacements: { ...window.replacements, ...scope.replacements, ...(currency ? { currency } : {}) },
      cur: (column) => (currency ? ` AND UPPER(${column}) = :currency` : ''),
      /** The owner is a visible player (bigint owner column). */
      owned: (column) => ` AND ${column} IN (SELECT u.id FROM users u WHERE ${scope.sql})`,
      /** The same for the ledger's text `user_id`. */
      ledgerOwned: (column) => ` AND ${column} IN (SELECT u.id::text FROM users u WHERE ${scope.sql})`,
    };
  }

  #range(window, currency) {
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      granularity: window.granularity,
      timezone: 'UTC',
      currency: currency || 'USD',
    };
  }

  #dashboard(channel) {
    const db = this.deps.db?.sequelize?.query
      ? this.deps.db
      : { sequelize: this.models.Users.sequelize, QueryTypes: this.models.Users.sequelize.constructor.QueryTypes };
    return new DashboardStatsService({ ...this.deps, db, directOnly: channel === 'direct', agentOnly: channel === 'agent' });
  }
}

const SOURCE_LABEL = Object.freeze({ inhouse: 'Originals', og: 'Original Games', gis: 'Casino feed 1', jsgames: 'Casino feed 2', jsgamesv2: 'Casino feed 2' });

module.exports = { PnlStatsService, COST_LINES, costLineOf };
