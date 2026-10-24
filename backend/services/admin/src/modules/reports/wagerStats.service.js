'use strict';

const { reportingCurrency } = require('./reportingCurrency');

const S = require('./stats.shared');
const { gisKindSql, gisSideAmountSql, gisPlayFilterSql } = require('../statements/statements.constants');
const { V2_STAKE, V2_PAYOUT, OG_ROLLED_BACK } = require('../statements/casinoRounds');

/**
 * Casino and sports turnover, payouts and GGR over time — the wager reports.
 *
 * GGR = wagered − won, from the house's side: positive is what the house kept.
 *
 * ── CASINO ───────────────────────────────────────────────────────────────
 * The four tables casino-service's bet history reads, classified the way its
 * `statExpressions` classifies them (bet-history/betHistory.constants.js), so
 * this report and the casino screens agree:
 *
 *   in-house  `bets`                  one row is a round: `amount` the stake,
 *                                     `profit` the signed net win. The player got
 *                                     back `amount + profit` when that is > 0.
 *   GIS       `gis_transactions`      stake rows `bet`, payout rows `win`; a
 *                                     refund / rollback nets off the side it
 *                                     reverses (`statements.constants.js`
 *                                     gisKindSql), so GGR is the reports'
 *                                     `#tradingPnlFor` and the dashboard's
 *   jsGames   `js_game_transactions`  `bet`/`loss`/`settle` stake, `win`/`settle` pay
 *   jsGames 2 `game_transactions`     the same vocabulary
 *   originals `og_transactions`       the Original Games aggregator: a `bet` and a
 *                                     `win` leg per round, unsigned; a rolled-back
 *                                     leg is a refund (admin original-games rule)
 *
 * Each source has a `category`: `originals` (the site's own games — in-house
 * `bets` and the Original Games aggregator, casino-service's "original" type)
 * or `casino` (third-party providers). `category` on the query keeps one.
 *
 * Refunds and rollbacks are neither turnover nor payout — a refunded bet was
 * never risked — and are reported on their own line. For GIS, where the bet row
 * and its refund are separate rows, the refund is taken off `wagered` (and a
 * rollback of a win off `won`) so the pair adds nothing; the jsGames tables
 * keep their own vocabulary.
 *
 * ── SPORTS ───────────────────────────────────────────────────────────────
 * Turnover is the stake of SETTLED bets (`won` / `loss` / `lost`) by the time
 * the bet was placed — the definition the wager feed and races use. Payouts are
 * the settlement credits (`credits_ledger` rows carrying a `bet_id`) by the time
 * they were paid. Open stake is reported separately. The two time bases differ
 * on purpose: each is the moment that money moved.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────
 * Players in the caller's tree only; see `stats.shared.resolveScope`.
 */

/**
 * A source's currency code, upper-cased, '?' when blank. `gis_transactions`
 * says 'PKR' for this platform's INR wallet (statements.constants
 * CASINO_INR_CURRENCIES, the dashboard's GIS_CURRENCY_ALIASES), so its rows
 * are folded into INR — otherwise they are valued at the PKR rate and fall
 * out of an INR filter.
 */
const plainCurrencySql = (column) => `UPPER(COALESCE(NULLIF(${column}::text, ''), '?'))`;
const gisCurrencySql = (column) => `(CASE WHEN UPPER(${column}::text) = 'PKR' THEN 'INR' ELSE ${plainCurrencySql(column)} END)`;

/** In-house rounds the bots placed are not turnover — the casino service's rule. */
const NOT_FAKE = `("result"->>'fake') IS DISTINCT FROM 'true'`;

const CASINO_SOURCES = Object.freeze([
  {
    key: 'inhouse',
    label: 'Originals',
    category: 'originals',
    table: 'bets',
    owner: 'uid',
    time: 'created',
    currency: 'coin',
    currencySql: plainCurrencySql('coin'),
    game: 'game',
    // A refunded round never happened; an open one has paid nothing yet.
    where: ` AND ${NOT_FAKE} AND (result IS NULL OR result::text <> '"refunded"')`,
    bets: 'COUNT(*)',
    paidWins: 'COUNT(*) FILTER (WHERE profit > 0)',
    wagered: 'COALESCE(SUM(ABS(amount)), 0)',
    // `profit` is the net actually paid, so stake + profit is the payout.
    won: 'COALESCE(SUM(CASE WHEN result IS NULL THEN 0 ELSE GREATEST(ABS(amount) + profit, 0) END), 0)',
    refunded: '0',
    refunds: '0',
  },
  {
    key: 'gis',
    label: 'Casino feed 1',
    category: 'casino',
    table: 'gis_transactions',
    owner: 'user_id',
    time: 'created_at',
    currency: 'currency',
    currencySql: gisCurrencySql('currency'),
    game: 'game_uuid',
    // The table itself is the alias: these expressions are spliced into
    // `FROM gis_transactions` with no alias of its own.
    where: ` AND ${gisPlayFilterSql('gis_transactions')}`,
    bets: `COUNT(*) FILTER (WHERE LOWER(action) = 'bet')`,
    paidWins: `COUNT(*) FILTER (WHERE LOWER(action) = 'win' AND amount > 0)`,
    wagered: `COALESCE(SUM(${gisSideAmountSql('gis_transactions')}) FILTER (WHERE ${gisKindSql('gis_transactions')} = 'stake'), 0)`,
    won: `COALESCE(SUM(${gisSideAmountSql('gis_transactions')}) FILTER (WHERE ${gisKindSql('gis_transactions')} = 'win'), 0)`,
    refunded: `COALESCE(SUM(ABS(amount)) FILTER (WHERE LOWER(action) IN ('refund', 'rollback')), 0)`,
    refunds: `COUNT(*) FILTER (WHERE LOWER(action) IN ('refund', 'rollback'))`,
  },
  ...[
    { key: 'jsgames', label: 'Casino feed 2', table: 'js_game_transactions', time: '"timestamp"', kind: 'transaction_type', game: 'game_uid' },
    { key: 'jsgamesv2', label: 'jsGames v2', table: 'game_transactions', time: 'created_at', kind: 'transaction_type', game: 'game_uid' },
  ].map((s) => {
    const kind = `LOWER(${s.kind}::text)`;
    const isStake = `${kind} IN ('bet', 'loss', 'settle')`;
    const isWin = `${kind} IN ('win', 'settle')`;
    const isRefund = `${kind} IN ('refund', 'rollback')`;
    return {
      ...s,
      category: 'casino',
      owner: 'user_id',
      currency: 'currency',
      currencySql: plainCurrencySql('currency'),
      where: '',
      bets: `COUNT(*) FILTER (WHERE ${isStake})`,
      paidWins: `COUNT(*) FILTER (WHERE ${isWin} AND amount > 0)`,
      wagered: `COALESCE(SUM(ABS(amount)) FILTER (WHERE ${isStake}), 0)`,
      won: `COALESCE(SUM(ABS(amount)) FILTER (WHERE ${isWin}), 0)`,
      refunded: `COALESCE(SUM(ABS(amount)) FILTER (WHERE ${isRefund}), 0)`,
      refunds: `COUNT(*) FILTER (WHERE ${isRefund})`,
      // v2 stores `amount` = win − bet, so its stake and payout are the
      // callback's own bet_amount / win_amount (a negative bet nets off).
      ...(s.key === 'jsgamesv2'
        ? {
            bets: `COUNT(*) FILTER (WHERE ${V2_STAKE(s.table)} > 0)`,
            paidWins: `COUNT(*) FILTER (WHERE ${V2_PAYOUT(s.table)} > 0)`,
            wagered: `COALESCE(SUM(${V2_STAKE(s.table)}), 0)`,
            won: `COALESCE(SUM(${V2_PAYOUT(s.table)}), 0)`,
            refunded: '0',
            refunds: '0',
          }
        : {}),
    };
  }),
  {
    key: 'og',
    label: 'Original Games',
    category: 'originals',
    table: 'og_transactions',
    owner: 'user_id',
    time: 'created_at',
    currency: 'currency',
    currencySql: plainCurrencySql('currency'),
    game: 'game_code',
    // No alias of its own: the rollback probe names the table.
    where: ` AND kind IN ('bet', 'win') AND status = 'applied'`,
    bets: `COUNT(*) FILTER (WHERE kind = 'bet' AND NOT ${OG_ROLLED_BACK('og_transactions')})`,
    paidWins: `COUNT(*) FILTER (WHERE kind = 'win' AND amount > 0 AND NOT ${OG_ROLLED_BACK('og_transactions')})`,
    wagered: `COALESCE(SUM(amount) FILTER (WHERE kind = 'bet' AND NOT ${OG_ROLLED_BACK('og_transactions')}), 0)`,
    won: `COALESCE(SUM(amount) FILTER (WHERE kind = 'win' AND NOT ${OG_ROLLED_BACK('og_transactions')}), 0)`,
    refunded: `COALESCE(SUM(amount) FILTER (WHERE kind = 'bet' AND ${OG_ROLLED_BACK('og_transactions')}), 0)`,
    refunds: `COUNT(*) FILTER (WHERE kind = 'bet' AND ${OG_ROLLED_BACK('og_transactions')})`,
  },
]);

/** The casino sources of one category (`casino` | `originals`), or all of them. */
const casinoSources = (category) => (category ? CASINO_SOURCES.filter((s) => s.category === category) : CASINO_SOURCES);

/** How many games per source the per-game breakdown considers. */
const MAX_GAMES_PER_SOURCE = 500;
const TOP_ITEMS = 10;

const SETTLED = `LOWER(result_status) IN ('won', 'loss', 'lost')`;
const OPEN = `(result_status IS NULL OR LOWER(result_status) = 'pending')`;
const SPORTS_CURRENCY = `UPPER(COALESCE(NULLIF(original_currency, ''), 'USD'))`;
const SPORTS_STAKE = 'COALESCE(original_amount, stake_amount, 0)';

const point = () => ({ bets: 0, paidWins: 0, refunds: 0, wagered: S.ZERO, won: S.ZERO, refunded: S.ZERO, openStake: S.ZERO, openBets: 0 });

class WagerStatsService {
  constructor({ models, logger, config }) {
    this.models = models;
    this.logger = logger;
    this.config = config;
  }

  async stats({ staff, area, currency, channel, category, ...query }) {
    const window = S.resolveWindow(query);

    const [scope, buckets, rates] = await Promise.all([
      S.resolveScope({ models: this.models, config: this.config, logger: this.logger }, staff),
      S.bucketsFor(this.models, window),
      currency ? null : S.loadRates(this.models),
    ]);
    const convertTo = currency ? null : await reportingCurrency(this.models, staff);

    const replacements = S.replacementsFor(window, scope, currency ? { currency } : {});
    const empty = S.isEmptyScope(scope);

    const data = empty
      ? { series: [], items: [], uniqueUsers: 0 }
      : area === 'casino'
        ? await this.#casino(this.#owned(scope, channel), currency, replacements, casinoSources(category))
        : await this.#sports(this.#owned(scope, channel), currency, replacements);

    return this.#fold({ area, window, buckets, rates, currency, convertTo, ...data });
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Player ka scope SQL — tree (`S.scopeSql`) + Direct Users | Agent Users tab (`channel`).
   * Channel na ho = pehle jaisa.
   */
  #owned(scope, channel) {
    const tab = channel ? ` AND u.parent_staff_id IS ${channel === 'direct' ? '' : 'NOT '}NULL` : '';
    return (column) => S.scopeSql(column, scope) + (tab ? ` AND ${column} IN (SELECT u.id FROM users u WHERE TRUE${tab})` : '');
  }

  async #casino(owned, currency, replacements, sources) {
    const filters = (s) =>
      `${S.windowSql(s.time)}${owned(s.owner)}${s.where}${currency ? ` AND ${s.currencySql} = :currency` : ''}`;
    const currencyExpr = (s) => s.currencySql;
    const stats = (s) =>
      `${s.bets}::int AS bets, ${s.paidWins}::int AS "paidWins", ${s.refunds}::int AS refunds,
       (${s.wagered})::text AS wagered, (${s.won})::text AS won, (${s.refunded})::text AS refunded`;

    const perSource = await Promise.all(
      sources.map(async (s) => {
        const [series, games] = await Promise.all([
          S.select(
            this.models,
            `SELECT ${S.bucketSql(s.time)} AS bucket, ${currencyExpr(s)} AS currency, ${stats(s)}
               FROM ${s.table} WHERE ${filters(s)} GROUP BY 1, 2`,
            replacements
          ),
          S.select(
            this.models,
            `SELECT ${s.game}::text AS game, ${currencyExpr(s)} AS currency, ${stats(s)}
               FROM ${s.table} WHERE ${filters(s)}
              GROUP BY 1, 2 ORDER BY ${s.wagered} DESC LIMIT ${MAX_GAMES_PER_SOURCE}`,
            replacements
          ),
        ]);
        return {
          series: series.map((r) => ({ ...r, group: s.label })),
          games: games.map((r) => ({ ...r, source: s })),
        };
      })
    );

    const owners = sources.map(
      (s) => `SELECT ${s.owner}::text AS owner FROM ${s.table} WHERE ${filters(s)}`
    );
    const [unique] = await S.select(
      this.models,
      `SELECT COUNT(DISTINCT owner)::int AS n FROM (${owners.join(' UNION ')}) AS o`,
      replacements
    );

    const games = perSource.flatMap((p) => p.games);
    const names = await this.#gameNames(games);

    return {
      series: perSource.flatMap((p) => p.series),
      // The breakdown: by provider (vendor) and by game.
      items: games.map((g) => {
        const meta = names.get(`${g.source.key}:${g.game}`) ?? {};
        return {
          ...g,
          vendor: meta.vendor || (g.source.key === 'inhouse' ? 'Originals' : g.source.label),
          category: g.source.category,
          name: meta.name || g.game || 'Unknown game',
        };
      }),
      uniqueUsers: Number(unique?.n ?? 0),
      dimension: 'Provider',
    };
  }

  /** Game ids to names and vendors, from the catalogs that own them. */
  async #gameNames(games) {
    const ids = (key) => [...new Set(games.filter((g) => g.source.key === key && g.game).map((g) => g.game))];
    const gis = ids('gis');
    const js = [...new Set([...ids('jsgames'), ...ids('jsgamesv2')])];
    const og = ids('og');

    const [gisRows, jsRows, ogRows] = await Promise.all([
      gis.length
        ? S.select(this.models, 'SELECT uuid AS id, name, provider AS vendor FROM gis_games WHERE uuid IN (:ids)', { ids: gis })
        : [],
      js.length
        ? S.select(this.models, 'SELECT game_uid AS id, game_name AS name, vendor FROM js_games WHERE game_uid IN (:ids)', { ids: js })
        : [],
      og.length ? S.select(this.models, `SELECT code AS id, name, 'Original Games' AS vendor FROM og_games WHERE code IN (:ids)`, { ids: og }) : [],
    ]);

    const map = new Map();
    for (const r of gisRows) map.set(`gis:${r.id}`, r);
    for (const r of ogRows) map.set(`og:${r.id}`, r);
    for (const r of jsRows) {
      map.set(`jsgames:${r.id}`, r);
      map.set(`jsgamesv2:${r.id}`, r);
    }
    return map;
  }

  // ══════════════════════════════════════════════════════════════════════

  async #sports(owned, currency, replacements) {
    const betFilters = `${S.windowSql('created_at')}${owned('user_id')}${currency ? ` AND ${SPORTS_CURRENCY} = :currency` : ''}`;
    const betStats = `COUNT(*) FILTER (WHERE ${SETTLED})::int AS bets,
       COUNT(*) FILTER (WHERE LOWER(result_status) = 'won')::int AS "paidWins",
       COUNT(*) FILTER (WHERE LOWER(result_status) = 'refund')::int AS refunds,
       COUNT(*) FILTER (WHERE ${OPEN})::int AS "openBets",
       COALESCE(SUM(${SPORTS_STAKE}) FILTER (WHERE ${SETTLED}), 0)::text AS wagered,
       COALESCE(SUM(${SPORTS_STAKE}) FILTER (WHERE LOWER(result_status) = 'refund'), 0)::text AS refunded,
       COALESCE(SUM(${SPORTS_STAKE}) FILTER (WHERE ${OPEN}), 0)::text AS "openStake"`;

    // Payouts: Sports Exchange settlement credits (mssports.credits_ledger, reason settlement = stake + profit), windowed on the ledger's own (indexed)
    // `created_at`, joined to the bet by primary key for its owner and currency.
    // A refund credit carries the bet_id too, but it returns a stake that was
    // never turnover; and a bet refunded or voided after settlement is not in
    // `wagered`, so whatever it was paid is not in `won` either.
    const payoutFilters = `${S.windowSql('l.created_at')} AND l.bet_id IS NOT NULL AND l.amount > 0
      AND l.reason = 'settlement'
      AND LOWER(COALESCE(b.result_status, '')) NOT IN ('refund', 'refunded', 'voided_after_settlement')${owned('b.user_id')}${
      currency ? ` AND UPPER(COALESCE(NULLIF(b.original_currency, ''), 'USD')) = :currency` : ''
    }`;
    const market = `COALESCE(NULLIF(UPPER(game_type), ''), 'OTHER')`;

    const [stakes, payouts, markets, marketPayouts, events, unique] = await Promise.all([
      S.select(
        this.models,
        `SELECT ${S.bucketSql('created_at')} AS bucket, ${SPORTS_CURRENCY} AS currency, ${betStats}
           FROM mssports."SportsBet" WHERE ${betFilters} GROUP BY 1, 2`,
        replacements
      ),
      S.select(
        this.models,
        `SELECT ${S.bucketSql('l.created_at')} AS bucket, UPPER(COALESCE(NULLIF(b.original_currency, ''), 'USD')) AS currency,
                COALESCE(SUM(l.amount), 0)::text AS won
           FROM mssports.credits_ledger l JOIN mssports."SportsBet" b ON b.id = l.bet_id
          WHERE ${payoutFilters} GROUP BY 1, 2`,
        replacements
      ),
      S.select(
        this.models,
        `SELECT ${market} AS game, ${SPORTS_CURRENCY} AS currency, ${betStats}
           FROM mssports."SportsBet" WHERE ${betFilters} GROUP BY 1, 2`,
        replacements
      ),
      S.select(
        this.models,
        `SELECT COALESCE(NULLIF(UPPER(b.game_type), ''), 'OTHER') AS game,
                UPPER(COALESCE(NULLIF(b.original_currency, ''), 'USD')) AS currency,
                COALESCE(SUM(l.amount), 0)::text AS won
           FROM mssports.credits_ledger l JOIN mssports."SportsBet" b ON b.id = l.bet_id
          WHERE ${payoutFilters} GROUP BY 1, 2`,
        replacements
      ),
      S.select(
        this.models,
        `SELECT COALESCE(NULLIF(event_name, ''), NULLIF(match_title, ''), match_id, 'Unknown event') AS name,
                ${SPORTS_CURRENCY} AS currency, ${betStats}
           FROM mssports."SportsBet" WHERE ${betFilters}
          GROUP BY 1, 2 ORDER BY SUM(${SPORTS_STAKE}) DESC LIMIT ${MAX_GAMES_PER_SOURCE}`,
        replacements
      ),
      S.select(
        this.models,
        `SELECT COUNT(DISTINCT user_id)::int AS n FROM mssports."SportsBet" WHERE ${betFilters}`,
        replacements
      ),
    ]);

    const won = new Map(marketPayouts.map((r) => [`${r.game}|${r.currency}`, r.won]));
    const marketKeys = new Set(markets.map((r) => `${r.game}|${r.currency}`));

    return {
      series: [...stakes, ...payouts.map((r) => ({ ...r, bets: 0 }))].map((r) => ({ ...r, group: 'Sports' })),
      items: [
        ...markets.map((r) => ({ ...r, vendor: r.game, name: null, won: won.get(`${r.game}|${r.currency}`) ?? '0' })),
        // A market paid in the window whose bets were placed before it.
        ...marketPayouts
          .filter((r) => !marketKeys.has(`${r.game}|${r.currency}`))
          .map((r) => ({ ...r, vendor: r.game, name: null, bets: 0, wagered: '0' })),
        // Events carry stakes only — a payout is not attributed per event.
        ...events.map((r) => ({ ...r, vendor: null, won: null })),
      ],
      uniqueUsers: Number(unique[0]?.n ?? 0),
      dimension: 'Market',
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  #fold({ area, window, buckets, rates, currency, convertTo, series: rows, items, uniqueUsers, dimension }) {
    const converter = S.createConverter(rates, currency, convertTo);
    const totals = point();
    const series = new Map(buckets.map((b) => [b, point()]));
    const byCurrency = new Map();
    const byGroup = new Map();

    const add = (target, row, convert) => {
      target.bets += Number(row.bets ?? 0);
      target.paidWins += Number(row.paidWins ?? 0);
      target.refunds += Number(row.refunds ?? 0);
      target.openBets += Number(row.openBets ?? 0);
      for (const key of ['wagered', 'won', 'refunded', 'openStake']) {
        if (row[key] == null) continue;
        const value = convert(S.minor(row[key]), key);
        if (value !== null) target[key] += value;
      }
    };

    for (const row of rows) {
      // Native totals per currency first: the filter's options.
      const cur = byCurrency.get(row.currency) ?? { currency: row.currency, ...point() };
      add(cur, row, (v) => v);
      byCurrency.set(row.currency, cur);

      // Convert each amount once, and reuse it for every aggregate.
      const converted = {};
      add(totals, row, (v, key) => {
        converted[key] = converter.convert(v, row.currency, key === 'wagered' ? Number(row.bets ?? 0) : 0);
        return converted[key];
      });
      const reuse = (_, key) => converted[key];

      if (!series.has(row.bucket)) series.set(row.bucket, point());
      add(series.get(row.bucket), row, reuse);

      const group = byGroup.get(row.group) ?? point();
      add(group, row, reuse);
      byGroup.set(row.group, group);
    }

    // The breakdown: providers / markets, and the top games / events.
    const vendors = new Map();
    const named = new Map();
    const quiet = S.createConverter(rates, currency, convertTo);
    for (const item of items) {
      const target = item.vendor
        ? (vendors.get(item.vendor) ?? vendors.set(item.vendor, point()).get(item.vendor))
        : null;
      const label = item.name;
      const game = label ? (named.get(label) ?? named.set(label, { ...point(), vendor: item.vendor }).get(label)) : null;
      const convert = (v) => quiet.convert(v, item.currency);
      if (target) add(target, item, convert);
      if (game) add(game, item, convert);
    }

    const out = (p) => {
      const ggr = p.wagered - p.won;
      return {
        bets: p.bets,
        wagered: S.dec(p.wagered),
        won: S.dec(p.won),
        ggr: S.dec(ggr),
        margin: p.wagered ? S.ratio(ggr, p.wagered) : null,
        paidWins: p.paidWins,
        refunds: p.refunds,
        refunded: S.dec(p.refunded),
        ...(area === 'sports' ? { openBets: p.openBets, openStake: S.dec(p.openStake) } : {}),
      };
    };
    const byWagered = (a, b) => (b[1].wagered > a[1].wagered ? 1 : b[1].wagered < a[1].wagered ? -1 : b[1].bets - a[1].bets);

    return {
      area,
      from: window.from,
      to: window.to,
      granularity: window.granularity,
      tz: window.tz,
      currency: converter.currency,
      converted: converter.converted,
      totals: {
        ...out(totals),
        uniqueUsers,
        averageBet: S.average(totals.wagered, totals.bets),
        /** Paid wins over stakes — the share of bets that returned something. */
        winRate: S.ratio(totals.paidWins, totals.bets),
      },
      series: [...series.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([bucket, p]) => ({ bucket, ...out(p) })),
      bySource: [...byGroup.entries()].sort(byWagered).map(([key, p]) => ({ key, ...out(p) })),
      breakdown: {
        dimension: dimension ?? 'Provider',
        rows: [...vendors.entries()].sort(byWagered).map(([key, p]) => ({ key, ...out(p) })),
      },
      top: {
        label: area === 'casino' ? 'Game' : 'Event',
        rows: [...named.entries()]
          .sort(byWagered)
          .slice(0, TOP_ITEMS)
          .map(([key, p]) => ({ key, vendor: p.vendor ?? null, ...out(p), ...(area === 'sports' ? { won: null, ggr: null, margin: null } : {}) })),
      },
      byCurrency: [...byCurrency.values()]
        .sort((a, b) => b.bets - a.bets)
        .map((c) => ({ currency: c.currency, ...out(c) })),
      unconverted: converter.unconverted(),
    };
  }
}

/** The sports turnover rule, for other reports that must agree with this one (player-stats). */
const SPORTS_TURNOVER = Object.freeze({ settled: SETTLED, currency: SPORTS_CURRENCY, stake: SPORTS_STAKE });

module.exports = { WagerStatsService, CASINO_SOURCES, casinoSources, SPORTS_TURNOVER };
